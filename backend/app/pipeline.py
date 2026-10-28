"""Background processing for each uploaded file.

Stage 1: photo metadata (EXIF/GPS).
Stage 2: text extraction + OCR (Hindi + English) -> chunks table.
Stage 3: embeddings for meaning-based search (Gemini).
Stage 4 (next): claims, entity matching, conflicts.
"""
import logging

from psycopg.types.json import Jsonb

from . import embeddings, exif, text_extract
from .db import get_conn

log = logging.getLogger("kathagraph.pipeline")


def _set_status(source_id: int, status: str, error: str | None = None):
    with get_conn() as conn:
        conn.execute("update sources set status = %s, error = %s where id = %s", (status, error, source_id))


def embed_chunks(chunk_ids: list[int], texts: list[str]) -> None:
    """Store embeddings for the given chunks. Raises EmbeddingError on failure."""
    if not chunk_ids:
        return
    vectors = embeddings.embed(texts, "RETRIEVAL_DOCUMENT")
    with get_conn() as conn:
        for cid, vec in zip(chunk_ids, vectors):
            conn.execute("update chunks set embedding = %s::vector where id = %s", (embeddings.to_pg(vec), cid))


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
        warnings = [extracted.warning] if extracted.warning else []

        chunk_ids, texts = [], []
        with get_conn() as conn:
            conn.execute("delete from chunks where source_id = %s", (source_id,))  # safe to re-run
            for page, text in extracted.pages:
                for piece in text_extract.chunk(text):
                    row = conn.execute(
                        "insert into chunks (source_id, page, text, language) values (%s, %s, %s, %s) returning id",
                        (source_id, page, piece, text_extract.detect_language(piece)),
                    ).fetchone()
                    chunk_ids.append(row["id"])
                    texts.append(piece)

        if chunk_ids and embeddings.available():
            try:
                embed_chunks(chunk_ids, texts)
            except embeddings.EmbeddingError as e:
                log.warning("Embedding failed for source %s: %s", source_id, e)
                warnings.append("Meaning-based search not ready for this file (keyword search still works).")

        # status 'done' with a note (e.g. OCR unavailable) is still a success
        _set_status(source_id, "done", " ".join(warnings) or None)
        log.info("Source %s done (%d chunk(s))", source_id, len(chunk_ids))
    except Exception as e:  # one bad file must never take the server down
        log.exception("Processing failed for source %s", source_id)
        _set_status(source_id, "failed", str(e)[:500])
