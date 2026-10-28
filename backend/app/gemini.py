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
    pass


def available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def post_with_retry(url: str, body: dict, attempts: int = 4, timeout: float = 90) -> dict:
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
            raise GeminiError(f"Gemini error {resp.status_code}: {resp.text[:300]}")
        return resp.json()
    raise GeminiError("Gemini did not respond")


def generate_json(parts: list[dict], schema: dict, temperature: float = 0.1) -> dict:
    """Ask Gemini for an answer that follows `schema` (OpenAPI-style)."""
    model = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "temperature": temperature,
        },
    }
    data = post_with_retry(f"{API}/{model}:generateContent", body)
    try:
        candidate = data["candidates"][0]
        text = "".join(p.get("text", "") for p in candidate["content"]["parts"] if not p.get("thought"))
        return json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        reason = (data.get("promptFeedback") or {}).get("blockReason") or "unreadable answer"
        raise GeminiError(f"Gemini gave no usable answer ({reason})") from e


def image_part(data: bytes, max_side: int = 1024) -> dict:
    """Downscale a photo and package it for Gemini."""
    img = ImageOps.exif_transpose(Image.open(BytesIO(data))).convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = BytesIO()
    img.save(buf, "JPEG", quality=85)
    return {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}}
