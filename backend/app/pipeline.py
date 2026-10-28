"""Background processing for each uploaded file.

Stage 1: photo metadata (EXIF/GPS).
Stage 2: text extraction + OCR (Hindi + English) -> chunks table.
Stage 3 (next): embeddings for semantic search. Stage 4: claims.
"""
import logging

from psycopg.types.json import Jsonb

from . import exif, text_extract
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

        extracted = text_extract.extract(kind, data)
        with get_conn() as conn:
            conn.execute("delete from chunks where source_id = %s", (source_id,))  # safe to re-run
            for page, text in extracted.pages:
                for piece in text_extract.chunk(text):
                    conn.execute(
                        "insert into chunks (source_id, page, text, language) values (%s, %s, %s, %s)",
                        (source_id, page, piece, text_extract.detect_language(piece)),
                    )

        # status 'done' with a note (e.g. OCR unavailable) is still a success
        _set_status(source_id, "done", extracted.warning)
        log.info("Source %s done (%d page(s) of text)", source_id, len(extracted.pages))
    except Exception as e:  # one bad file must never take the server down
        log.exception("Processing failed for source %s", source_id)
        _set_status(source_id, "failed", str(e)[:500])
