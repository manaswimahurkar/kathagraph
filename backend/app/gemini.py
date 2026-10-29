"""Small client for Google Gemini: structured JSON answers from text or images.

Free-tier limits are low (a few requests per minute), so every call retries
with back-off on 429/5xx instead of failing straight away.
"""
import base64
import json
import logging
import os
import time
from io import BytesIO

import httpx
from PIL import Image, ImageOps

log = logging.getLogger("kathagraph.gemini")

API = "https://generativelanguage.googleapis.com/v1beta/models"
RETRY_STATUS = {429, 500, 502, 503, 504}


class GeminiError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


_thinking_off_supported = True  # flips to False if the model rejects the setting


def available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def post_with_retry(url: str, body: dict, attempts: int = 3, timeout: float = 60) -> dict:
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise GeminiError("GEMINI_API_KEY is not set")
    for attempt in range(attempts):
        try:
            resp = httpx.post(url, json=body, headers={"x-goog-api-key": key}, timeout=timeout)
        except httpx.HTTPError as e:
            if attempt == attempts - 1:
                raise GeminiError(f"Could not reach Gemini: {e}") from e
            time.sleep(5 * 2 ** attempt)
            continue
        if resp.status_code in RETRY_STATUS and attempt < attempts - 1:
            wait = min(60, 8 * 2 ** attempt)
            log.warning("Gemini busy (%s), retrying in %ss", resp.status_code, wait)
            time.sleep(wait)
            continue
        if resp.status_code >= 300:
            try:
                detail = resp.json()["error"]["message"]
            except Exception:
                detail = resp.text[:200]
            raise GeminiError(f"Gemini error {resp.status_code}: {detail}", resp.status_code)
        return resp.json()
    raise GeminiError("Gemini did not respond")


# 400 is included: a model alias such as "gemini-flash-latest" can move to a newer
# model that rejects a setting the previous one accepted ("invalid argument").
FALLBACK_STATUS = {400, 404, 429, 500, 502, 503, 504, None}


def _models() -> list[str]:
    """Models to try in order; later ones are used when earlier ones are busy or refuse the request."""
    # Lite first: fast and plenty for extraction. Override with the GEMINI_MODELS setting.
    raw = os.getenv("GEMINI_MODELS", "gemini-flash-lite-latest,gemini-flash-latest")
    return [m.strip() for m in raw.split(",") if m.strip()]


def _call(model: str, body: dict) -> dict:
    global _thinking_off_supported
    url = f"{API}/{model}:generateContent"
    config = body["generationConfig"]
    # Extraction is a reading task, not a reasoning one: try switching off slow "thinking".
    # Newer models may reject this setting with a plain 400, so any 400 means: try again without it.
    if _thinking_off_supported:
        config["thinkingConfig"] = {"thinkingBudget": 0}
        try:
            return post_with_retry(url, body, attempts=2)
        except GeminiError as e:
            if e.status != 400:
                raise
            log.info("Model %s refused thinkingBudget=0 (%s); retrying with its default", model, e)
            _thinking_off_supported = False
        finally:
            config.pop("thinkingConfig", None)
    return post_with_retry(url, body, attempts=2)


def generate_json(parts: list[dict], schema: dict, temperature: float = 0.1) -> dict:
    """Ask Gemini for an answer that follows `schema` (OpenAPI-style).
    Falls back to the next model if one is overloaded or unavailable."""
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "temperature": temperature,
        },
    }
    last_error: GeminiError | None = None
    for model in _models():
        try:
            data = _call(model, body)
            break
        except GeminiError as e:
            if e.status not in FALLBACK_STATUS:
                raise
            log.warning("Model %s unavailable (%s); trying the next one", model, e)
            last_error = e
    else:
        raise last_error or GeminiError("No Gemini model available")

    try:
        candidate = data["candidates"][0]
        text = "".join(p.get("text", "") for p in candidate["content"]["parts"] if not p.get("thought"))
        return json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        reason = (data.get("promptFeedback") or {}).get("blockReason") or "unreadable answer"
        raise GeminiError(f"Gemini gave no usable answer ({reason})") from e


def image_part(data: bytes, max_side: int = 1024) -> dict:
    """Downscale a photo and package it for Gemini."""
    img = Image.open(BytesIO(data))
    if img.format == "JPEG":
        img.draft("RGB", (max_side, max_side))  # decode small: saves memory on big photos
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = BytesIO()
    img.save(buf, "JPEG", quality=85)
    return {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}}
