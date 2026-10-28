"""Background processing for each uploaded file.

Stage 1: photo metadata (EXIF/GPS).
Stage 2 (next): OCR and text extraction. Stage 3: embeddings. Stage 4: claims.
"""
import logging

from psycopg.types.json import Jsonb

from . import exif
from .db import get_conn

log = logging.getLogger("kathagraph.pipeline")


def _set_status(source_id: int, status: str, error: str | None = None):
    with get_conn() as conn:
        conn.execute("update sources set status = %s, error = %s where id = %s", (status, error, source_id))


def process_source(source_id: int, data: bytes, kind: str):
    _set_status(source_id, "processing")
    try:
        if kind == "photo":
            meta = exif.extract(data)
            with get_conn() as conn:
                conn.execute(
                    "update sources set exif_json = %s, lat = %s, lng = %s, captured_at = %s where id = %s",
                    (Jsonb(meta["exif"]), meta["lat"], meta["lng"], meta["captured_at"], source_id),
                )
        # Stage 2 adds: OCR for photos/PDFs, plain text for notes -> chunks table
        _set_status(source_id, "done")
    except Exception as e:  # one bad file must never take the server down
        log.exception("Processing failed for source %s", source_id)
        _set_status(source_id, "failed", str(e)[:500])
