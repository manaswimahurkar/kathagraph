"""Saves uploaded files to Supabase Storage and returns a public URL.

Render's free disk is wiped on every restart, so files must live in
object storage, not on the server.
"""
import os
import re
import uuid

import httpx


class StorageError(RuntimeError):
    pass


def _config():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    bucket = os.getenv("SUPABASE_BUCKET", "archive")
    if not url or not key:
        raise StorageError("File storage is not configured (set SUPABASE_URL and SUPABASE_SERVICE_KEY)")
    return url, key, bucket


def upload_bytes(data: bytes, filename: str, content_type: str | None) -> str:
    url, key, bucket = _config()
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename)[-80:] or "file"
    path = f"{uuid.uuid4().hex}_{safe_name}"

    headers = {
        "apikey": key,
        "Content-Type": content_type or "application/octet-stream",
        "x-upsert": "false",
    }
    if key.startswith("eyJ"):  # legacy JWT-style keys also go in Authorization
        headers["Authorization"] = f"Bearer {key}"

    resp = httpx.post(f"{url}/storage/v1/object/{bucket}/{path}", content=data, headers=headers, timeout=60)
    if resp.status_code >= 300:
        raise StorageError(f"Storage upload failed ({resp.status_code}): {resp.text[:200]}")
    return f"{url}/storage/v1/object/public/{bucket}/{path}"
