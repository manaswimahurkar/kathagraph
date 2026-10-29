"""Background processing for each uploaded file.

Stage 1: photo metadata (EXIF/GPS).
Stage 2: text extraction + OCR (Hindi + English) -> chunks.
Stage 3: embeddings for meaning-based search (Gemini).
Stage 4: AI photo description, fact extraction (claims), linking to monuments.
"""
import gc
import logging
import threading

import httpx
from psycopg.types.json import Jsonb

from . import claims, embeddings, exif, gemini, matching, text_extract
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


def _find_chunk(quote: str, chunks: list[tuple[int, str]]) -> int | None:
    q = quote.strip()[:40]
    for cid, text in chunks:
        if q and q in text:
            return cid
    return chunks[0][0] if chunks else None


def _save_claims(source_id: int, found: list[dict], chunks: list[tuple[int, str]]) -> list[int]:
    entity_ids = []
    with get_conn() as conn:
        for ent in found:
            entity_id = matching.get_or_create(conn, ent["name"], ent["type"], ent["aliases"])
            entity_ids.append(entity_id)
            matching.link(conn, entity_id, source_id, None)
            for c in ent["claims"]:
                conn.execute(
                    """insert into claims (entity_id, field, value, quote, source_id, chunk_id, method, confidence)
                       values (%s, %s, %s, %s, %s, %s, 'llm', %s)""",
                    (entity_id, c["field"], c["value"], c["quote"] or None, source_id,
                     _find_chunk(c["quote"], chunks), c["confidence"]),
                )
    return entity_ids


# One file at a time. Large photos need a lot of memory to decode, OCR and describe;
# several at once can exceed a small server's RAM (Render free tier: 512 MB) and crash it.
# Uploads still return immediately; files simply wait their turn as "pending".
# Scaling path: replace this lock with a job queue and separate worker processes.
_one_at_a_time = threading.Lock()


def process_source(source_id: int, data: bytes, kind: str):
    with _one_at_a_time:
        try:
            _process(source_id, data, kind)
        finally:
            del data
            gc.collect()


def _process(source_id: int, data: bytes, kind: str):
    _set_status(source_id, "processing")
    try:
        warnings: list[str] = []
        with get_conn() as conn:
            source = conn.execute("select id, filename from sources where id = %s", (source_id,)).fetchone()
            # Safe to re-run: clear what a previous run produced
            conn.execute("delete from claims where source_id = %s and method = 'llm'", (source_id,))
            conn.execute("delete from entity_sources where source_id = %s", (source_id,))
            conn.execute("delete from chunks where source_id = %s", (source_id,))

        # 1. Photo metadata
        meta = {"lat": None, "lng": None}
        if kind == "photo":
            meta = exif.extract(data)
            with get_conn() as conn:
                conn.execute(
                    "update sources set exif_json = %s, lat = %s, lng = %s, captured_at = %s where id = %s",
                    (Jsonb(meta["exif"]), meta["lat"], meta["lng"], meta["captured_at"], source_id),
                )

        # 2. AI photo description (makes photos searchable; tags interior/exterior/inscription,
        #    and says whether the photo has writing worth OCR-ing)
        tag, description, needs_ocr = None, None, True
        if kind == "photo" and gemini.available():
            try:
                info = claims.describe_photo(data)
                tag, description, needs_ocr = info["tag"], info["description"], info["has_text"]
                with get_conn() as conn:
                    conn.execute("update sources set tag = %s, description = %s where id = %s",
                                 (tag, description, source_id))
            except gemini.GeminiError as e:
                warnings.append(f"Photo not described: {e}")

        # 3. Text (notes, PDFs, OCR). OCR is the slowest step on a small server, so photos
        #    with no writing in them (most monument photos) skip it.
        if kind == "photo" and not needs_ocr:
            extracted = text_extract.Extracted()
        else:
            extracted = text_extract.extract(kind, data)
        if extracted.warning:
            warnings.append(extracted.warning)
        pieces = [(page, piece, text_extract.detect_language(piece))
                  for page, text in extracted.pages for piece in text_extract.chunk(text)]
        source_text = "\n\n".join(text for _, text in extracted.pages)
        if description:
            pieces.append((None, f"[AI description of photo] {description}", "en"))

        chunks: list[tuple[int, str]] = []
        with get_conn() as conn:
            for page, piece, lang in pieces:
                cid = conn.execute(
                    "insert into chunks (source_id, page, text, language) values (%s, %s, %s, %s) returning id",
                    (source_id, page, piece, lang),
                ).fetchone()["id"]
                chunks.append((cid, piece))

        # 4. Search vectors
        if chunks and embeddings.available():
            try:
                embed_chunks([c[0] for c in chunks], [c[1] for c in chunks])
            except embeddings.EmbeddingError as e:
                log.warning("Embedding failed for source %s: %s", source_id, e)
                warnings.append("Meaning-based search not ready for this file (keyword search still works).")

        # 5. Facts from the source's own text (never from the AI photo description)
        linked = []
        if source_text.strip() and gemini.available():
            try:
                found = claims.extract(source_text, source["filename"])
                linked = _save_claims(source_id, found, [c for c in chunks if not c[1].startswith("[AI")])
            except gemini.GeminiError as e:
                warnings.append(f"Facts not extracted: {e}")

        # 6. Link photos to their monument (filename / GPS), then retry older photos
        with get_conn() as conn:
            if kind == "photo":
                if linked:
                    for eid in linked:
                        matching.link(conn, eid, source_id, tag)
                else:
                    matching.link_photo(conn, {"id": source_id, "filename": source["filename"],
                                               "lat": meta["lat"], "lng": meta["lng"], "tag": tag})
            matching.relink_unlinked_photos(conn)

        _set_status(source_id, "done", " ".join(warnings) or None)
        log.info("Source %s done: %d chunk(s), %d entity link(s)", source_id, len(chunks), len(linked))
    except Exception as e:  # one bad file must never take the server down
        log.exception("Processing failed for source %s", source_id)
        _set_status(source_id, "failed", str(e)[:500])


def reprocess_source(source_id: int) -> None:
    """Download a stored file again and run the whole pipeline on it."""
    with get_conn() as conn:
        src = conn.execute("select id, type, file_url from sources where id = %s", (source_id,)).fetchone()
    if not src or not src["file_url"]:
        return
    try:
        resp = httpx.get(src["file_url"], timeout=60, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        _set_status(source_id, "failed", f"Could not download stored file: {e}")
        return
    process_source(source_id, resp.content, src["type"])
