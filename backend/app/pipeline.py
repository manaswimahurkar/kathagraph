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
        # A published article is about one monument; generic names in it ("the Jama Mosque") mean that one
        row = conn.execute("select entity_id from sources where id = %s", (source_id,)).fetchone()
        home = row["entity_id"] if row else None
        for ent in found:
            if matching.is_generic(ent["name"]):
                if home is None:
                    log.info("Source %s: skipped facts about %r (name fits many places)", source_id, ent["name"])
                    continue
                entity_id = home
            else:
                entity_id = matching.get_or_create(conn, ent["name"], ent["type"], ent["aliases"])
            if entity_id not in entity_ids:
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
    children: list[tuple[int, bytes]] = []
    with _one_at_a_time:
        try:
            children = _process(source_id, data, kind) or []
        finally:
            del data
            gc.collect()
    # Photos taken out of a deck or report: each is processed like any uploaded photo,
    # after the parent, so they can fall back on the monument the parent was linked to.
    for child_id, child_data in children:
        process_source(child_id, child_data, "photo")


def _save_embedded_images(source_id: int, images: list) -> list[tuple[int, bytes]]:
    """Store photos found inside a deck or report as their own sources, credited like the parent."""
    import hashlib
    from .storage import StorageError, upload_bytes

    with get_conn() as conn:
        parent = conn.execute("select author, origin from sources where id = %s", (source_id,)).fetchone()
    out = []
    for img in images:
        digest = hashlib.sha256(img.data).hexdigest()
        with get_conn() as conn:
            if conn.execute("select 1 from sources where content_hash = %s", (digest,)).fetchone():
                continue
            child = conn.execute(
                """insert into sources (type, filename, content_hash, parent_source_id, author, origin)
                   values ('photo', %s, %s, %s, %s, %s) returning id""",
                (img.name, digest, source_id, parent["author"], parent["origin"]),
            ).fetchone()["id"]
        ext = img.name.rsplit(".", 1)[-1].lower()
        try:
            url = upload_bytes(img.data, img.name, "image/png" if ext == "png" else "image/jpeg")
        except StorageError as e:
            _set_status(child, "failed", str(e)[:500])
            continue
        with get_conn() as conn:
            conn.execute("update sources set file_url = %s, status = 'pending' where id = %s", (url, child))
        out.append((child, img.data))
    return out


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
            extracted = text_extract.extract(kind, data, source["filename"].rsplit(".", 1)[0])
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

        # 4b. English translation of Hindi / Gujarati text, stored beside the original
        if source_text.strip() and gemini.available():
            from . import translate
            if translate.needs_translation(source_text):
                try:
                    translate.translate_source(source_id)
                except gemini.GeminiError as e:
                    warnings.append(f"Not translated: {e}")

        # 5. Facts from the source's own text (never from the AI photo description)
        linked = []
        if source_text.strip() and gemini.available():
            try:
                found = claims.extract(source_text, source["filename"])
                linked = _save_claims(source_id, found, [c for c in chunks if not c[1].startswith("[AI")])
                with get_conn() as conn:  # the full read already looks for legends and crafts
                    conn.execute("update sources set stories_checked = true where id = %s", (source_id,))
            except gemini.GeminiError as e:
                warnings.append(f"Facts not extracted: {e}")

        # 6. Link the file to its monument(s). Imported items (a Wikipedia article, a Commons photo)
        #    always belong to the monument they were imported for; other photos are matched by
        #    the names in their text, then by filename, then by GPS.
        with get_conn() as conn:
            home = conn.execute("select entity_id from sources where id = %s", (source_id,)).fetchone()["entity_id"]
            if home:
                matching.link(conn, home, source_id, tag if kind == "photo" else "reference")
            if kind == "photo":
                if linked:
                    for eid in linked:
                        matching.link(conn, eid, source_id, tag)
                elif not home:
                    found_id = matching.link_photo(conn, {"id": source_id, "filename": source["filename"],
                                                          "lat": meta["lat"], "lng": meta["lng"], "tag": tag})
                    if found_id is None:
                        # A photo from a deck or report: if the document is about one monument, so is the photo
                        parent = conn.execute("select parent_source_id from sources where id = %s",
                                              (source_id,)).fetchone()["parent_source_id"]
                        if parent:
                            ents = conn.execute("select entity_id from entity_sources where source_id = %s",
                                                (parent,)).fetchall()
                            if len(ents) == 1:
                                matching.link(conn, ents[0]["entity_id"], source_id, tag)
            matching.relink_unlinked_photos(conn)

        children = []
        if extracted.images:
            children = _save_embedded_images(source_id, extracted.images)
            if children:
                warnings.append(f"{len(children)} photo(s) found inside; each is processed as its own file.")
        _set_status(source_id, "done", " ".join(warnings) or None)
        log.info("Source %s done: %d chunk(s), %d entity link(s)", source_id, len(chunks), len(linked))
        return children
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


def rechunk_source(source_id: int) -> int:
    """Re-split a file's stored text with the current chunker, without re-running OCR or fact
    extraction. Old passages are stitched back into the original text, split again, embedded,
    and each fact is pointed at the new passage that holds its quote. Returns the new passage count
    (0 if nothing changed). AI photo descriptions are left as they are."""
    with get_conn() as conn:
        rows = conn.execute(
            "select id, page, text from chunks where source_id = %s order by id", (source_id,)
        ).fetchall()
    old = [r for r in rows if not r["text"].startswith("[AI")]
    if not old:
        return 0
    pages: dict = {}
    for r in old:
        pages.setdefault(r["page"], []).append(r["text"])
    pieces = [(page, piece, text_extract.detect_language(piece))
              for page, texts in pages.items()
              for piece in text_extract.chunk(text_extract.stitch(texts))]
    if [p[1] for p in pieces] == [r["text"] for r in old]:
        return 0

    vectors = embeddings.embed([p[1] for p in pieces], "RETRIEVAL_DOCUMENT") if embeddings.available() else None
    with get_conn() as conn:  # one transaction: the file is never left without passages
        new_chunks = []
        for i, (page, piece, lang) in enumerate(pieces):
            cid = conn.execute(
                """insert into chunks (source_id, page, text, language, embedding)
                   values (%s, %s, %s, %s, %s::vector) returning id""",
                (source_id, page, piece, lang, embeddings.to_pg(vectors[i]) if vectors else None),
            ).fetchone()["id"]
            new_chunks.append((cid, piece))
        for c in conn.execute(
            "select id, quote from claims where source_id = %s and chunk_id = any(%s)",
            (source_id, [r["id"] for r in old]),
        ).fetchall():
            conn.execute("update claims set chunk_id = %s where id = %s",
                         (_find_chunk(c["quote"] or "", new_chunks), c["id"]))
        conn.execute("delete from chunks where id = any(%s)", ([r["id"] for r in old],))
    return len(pieces)
