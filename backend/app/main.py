import hashlib
import logging
import mimetypes
import os
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import embeddings, office, text_extract, translate
from .db import get_conn
from .ask import router as ask_router
from .entities import router as entities_router
from .insights import router as insights_router
from .living import router as living_router
from .merge import router as merge_router
from .pipeline import embed_chunks, process_source, rechunk_source
from .storage import StorageError, upload_bytes

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("kathagraph")

app = FastAPI(title="KathaGraph API", version="0.6.0")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(entities_router)
app.include_router(ask_router)
app.include_router(insights_router)
app.include_router(merge_router)
app.include_router(living_router)


@app.on_event("startup")
def recover_interrupted():
    """Files that were mid-processing when the server stopped would otherwise
    say 'processing' forever. Mark them so they can be reprocessed."""
    try:
        with get_conn() as conn:
            n = conn.execute(
                """update sources set status = 'failed',
                          error = 'Interrupted by a server restart. Use reprocess to run it again.'
                   where status in ('pending', 'processing')"""
            ).rowcount
        if n:
            log.warning("Marked %d interrupted file(s) as failed", n)
    except Exception:
        log.exception("Could not check for interrupted files")

MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_FILES_PER_UPLOAD = 50
KINDS = {
    ".jpg": "photo", ".jpeg": "photo", ".png": "photo", ".webp": "photo", ".tif": "photo", ".tiff": "photo",
    ".pdf": "pdf",
    ".txt": "note", ".md": "note",
    ".csv": "csv",
    ".pptx": "slides", ".docx": "doc",
}
CONTAINER = ".zip"  # a folder: unpacked into the files above
BIG_KINDS = {"slides", "doc"}
MAX_BIG_BYTES = 50 * 1024 * 1024  # decks and reports carry their photos
MAX_ZIP_BYTES = 100 * 1024 * 1024
SOURCE_FIELDS = ("id, filename, type, status, error, lat, lng, captured_at, file_url, tag, description, created_at, "
                 "origin, author, licence, source_url, parent_source_id")


def credit(contributor: str | None, cohort: str | None) -> str | None:
    """'Asha Patel · Explorer Fellowship 2024' from the optional upload fields."""
    parts = [p.strip()[:80] for p in (contributor, cohort) if p and p.strip()]
    return " · ".join(parts) or None


@app.get("/")
def root():
    return {"name": "KathaGraph API", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    """Checks the API is up AND can reach the database (with pgvector)."""
    try:
        with get_conn() as conn:
            row = conn.execute(
                "select exists(select 1 from pg_extension where extname = 'vector') as has_vector"
            ).fetchone()
        return {"ok": True, "db": True, "pgvector": row["has_vector"]}
    except Exception as e:  # report DB problems instead of crashing
        return {"ok": True, "db": False, "error": str(e)}


@app.post("/upload", status_code=202)
async def upload(
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    contributor: str | None = Form(None),
    cohort: str | None = Form(None),
):
    """Accept files (photos, PDFs, notes, CSVs, slide decks, Word reports, or a .zip folder of them),
    store them, and queue each one for processing. `contributor` and `cohort` credit whoever documented them."""
    if not files:
        raise HTTPException(400, "No files were sent.")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(400, f"Upload at most {MAX_FILES_PER_UPLOAD} files at a time, or put them in a .zip folder.")
    author = credit(contributor, cohort)

    # Validate everything first, so a bad file doesn't leave a half-finished upload
    batch, skipped = [], []
    for f in files:
        name = f.filename or "unnamed"
        suffix = Path(name).suffix.lower()
        data = await f.read()
        if not data:
            raise HTTPException(400, f"'{name}' is empty.")
        if suffix == CONTAINER:
            if len(data) > MAX_ZIP_BYTES:
                raise HTTPException(413, f"'{name}' is larger than 100 MB. Split the folder into smaller parts.")
            try:
                inner, left_out = office.expand_zip(data, tuple(KINDS))
            except office.OfficeError as e:
                raise HTTPException(400, f"'{name}': {e}")
            skipped += left_out
            for inner_name, inner_data in inner:
                kind = KINDS[Path(inner_name).suffix.lower()]
                limit = MAX_BIG_BYTES if kind in BIG_KINDS else MAX_FILE_BYTES
                if inner_data and len(inner_data) <= limit:
                    batch.append((inner_name, kind, inner_data, mimetypes.guess_type(inner_name)[0]))
                else:
                    skipped.append(inner_name)
            continue
        kind = KINDS.get(suffix)
        if kind is None:
            allowed = ", ".join(sorted([*KINDS, CONTAINER]))
            raise HTTPException(400, f"'{name}' is not a supported file type. Allowed: {allowed}")
        limit = MAX_BIG_BYTES if kind in BIG_KINDS else MAX_FILE_BYTES
        if len(data) > limit:
            raise HTTPException(413, f"'{name}' is larger than {limit // (1024 * 1024)} MB.")
        batch.append((name, kind, data, f.content_type))
    if not batch:
        raise HTTPException(400, "Nothing in that upload is a file type the archive can read.")
    if len(batch) > office.MAX_ZIP_FILES:
        raise HTTPException(400, f"Upload at most {office.MAX_ZIP_FILES} files at a time.")

    created = []
    seen_in_batch: dict[str, int] = {}
    for name, kind, data, content_type in batch:
        digest = hashlib.sha256(data).hexdigest()
        # The same file uploaded again (by anyone, under any name) is not processed twice
        with get_conn() as conn:
            existing = conn.execute(
                "select id, filename from sources where content_hash = %s order by id limit 1", (digest,)
            ).fetchone()
        if existing or digest in seen_in_batch:
            original = existing["id"] if existing else seen_in_batch[digest]
            created.append({"id": original, "filename": name, "type": kind, "status": "duplicate",
                            "duplicate_of": original,
                            "error": f"Identical to a file already in the archive (source #{original})."})
            continue
        with get_conn() as conn:
            row = conn.execute(
                "insert into sources (type, filename, content_hash, author) values (%s, %s, %s, %s) returning id",
                (kind, name, digest, author),
            ).fetchone()
        source_id = row["id"]
        seen_in_batch[digest] = source_id
        try:
            url = upload_bytes(data, name, content_type)
        except StorageError as e:
            log.error("Storage failed for %s: %s", name, e)
            with get_conn() as conn:
                conn.execute("update sources set status = 'failed', error = %s where id = %s", (str(e)[:500], source_id))
            created.append({"id": source_id, "filename": name, "type": kind, "status": "failed", "error": str(e)})
            continue
        with get_conn() as conn:
            conn.execute("update sources set file_url = %s where id = %s", (url, source_id))
        background.add_task(process_source, source_id, data, kind)
        created.append({"id": source_id, "filename": name, "type": kind, "status": "pending"})

    return JSONResponse({"sources": created, "skipped": skipped}, status_code=202)


@app.get("/sources")
def list_sources(limit: int = 100):
    limit = max(1, min(limit, 500))
    with get_conn() as conn:
        rows = conn.execute(f"select {SOURCE_FIELDS} from sources order by id desc limit %s", (limit,)).fetchall()
    return {"sources": rows}


@app.get("/sources/{source_id}")
def get_source(source_id: int):
    with get_conn() as conn:
        row = conn.execute(f"select {SOURCE_FIELDS} from sources where id = %s", (source_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Source not found.")
    return row


@app.delete("/sources/{source_id}")
def delete_source(source_id: int):
    """Remove a file and everything extracted from it (text, claims, links)."""
    with get_conn() as conn:
        row = conn.execute("delete from sources where id = %s returning id", (source_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Source not found.")
        # Monuments left with no evidence at all are removed too
        conn.execute(
            """delete from entities e where not exists (select 1 from entity_sources es where es.entity_id = e.id)
               and not exists (select 1 from claims c where c.entity_id = e.id) and e.lat is null"""
        )
    return {"deleted": source_id}


@app.get("/sources/{source_id}/text")
def get_source_text(source_id: int):
    """The text extracted from one file: its passages, and its pages put back together for reading,
    each with an English machine translation when the original is in Hindi or Gujarati."""
    with get_conn() as conn:
        src = conn.execute(f"select {SOURCE_FIELDS} from sources where id = %s", (source_id,)).fetchone()
        if not src:
            raise HTTPException(404, "Source not found.")
        chunks = conn.execute(
            "select id, page, language, text from chunks where source_id = %s order by page nulls first, id",
            (source_id,),
        ).fetchall()
        english = {r["page"]: r["text_en"] for r in conn.execute(
            "select page, text_en from translations where source_id = %s", (source_id,)).fetchall()}
        entities = conn.execute(
            """select e.id, e.name, e.type from entity_sources es join entities e on e.id = es.entity_id
               where es.source_id = %s order by e.name""", (source_id,)).fetchall()
        children = conn.execute(
            "select id, filename, file_url, tag from sources where parent_source_id = %s order by id", (source_id,)
        ).fetchall()
    by_page: dict[int, list[str]] = {}
    for c in chunks:
        if not c["text"].startswith("[AI"):
            by_page.setdefault(c["page"] or 0, []).append(c["text"])
    pages = []
    for page, parts in by_page.items():
        text = text_extract.stitch(parts)
        pages.append({"page": page or None, "text": text, "language": text_extract.detect_language(text),
                      "text_en": english.get(page)})
    return {"source": src, "chunks": chunks, "pages": pages, "entities": entities, "embedded_photos": children}


@app.post("/admin/translate", status_code=202)
def translate_all(background: BackgroundTasks):
    """Translate every stored Hindi or Gujarati document that has no English translation yet."""
    background.add_task(translate.backfill)
    return {"queued": True}


def _escape_like(word: str) -> str:
    return word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


MAX_PER_SOURCE = 2
PER_SOURCE_POOL = 5  # fetch this many times `limit` candidates before thinning


@app.get("/search")
def search(q: str, limit: int = 10):
    """Search all archive text. Meaning-based (any language) when Gemini is
    configured, keyword-based otherwise or if Gemini is unavailable."""
    q = q.strip()
    if not q:
        raise HTTPException(400, "Type something to search for.")
    limit = max(1, min(limit, 50))
    fields = """c.id as chunk_id, c.text, c.page, c.language,
                s.id as source_id, s.filename, s.type, s.file_url,
                s.origin, s.author, s.licence, s.source_url"""

    rows, mode = None, "keyword"
    if embeddings.available():
        try:
            vec = embeddings.to_pg(embeddings.embed([q], "RETRIEVAL_QUERY")[0])
            with get_conn() as conn:
                rows = conn.execute(
                    f"""select {fields}, 1 - (c.embedding <=> %s::vector) as score
                        from chunks c join sources s on s.id = c.source_id
                        where c.embedding is not null
                        order by c.embedding <=> %s::vector
                        limit %s""",
                    (vec, vec, limit * PER_SOURCE_POOL),
                ).fetchall()
            mode = "semantic"
        except embeddings.EmbeddingError as e:
            log.warning("Semantic search unavailable, using keywords: %s", e)

    if mode == "keyword":
        words = [w for w in q.split() if len(w) > 1][:8] or [q]
        patterns = [f"%{_escape_like(w)}%" for w in words]
        with get_conn() as conn:
            rows = conn.execute(
                f"""select {fields},
                        (select count(*) from unnest(%s::text[]) p where c.text ilike p)::float / %s as score
                    from chunks c join sources s on s.id = c.source_id
                    where c.text ilike any(%s::text[])
                    order by score desc, c.id desc
                    limit %s""",
                (patterns, len(patterns), patterns, limit * PER_SOURCE_POOL),
            ).fetchall()

    # At most MAX_PER_SOURCE passages from any one file, so a long article can't fill the page
    per_source: dict[int, int] = {}
    kept = []
    for r in rows:
        if per_source.get(r["source_id"], 0) < MAX_PER_SOURCE:
            per_source[r["source_id"]] = per_source.get(r["source_id"], 0) + 1
            kept.append(r)
    rows = kept[:limit]

    # Which monuments each result's file is linked to (filled in by stage 4)
    source_ids = list({r["source_id"] for r in rows})
    linked: dict[int, list] = {}
    if source_ids:
        with get_conn() as conn:
            for e in conn.execute(
                """select es.source_id, e.id, e.name from entity_sources es
                   join entities e on e.id = es.entity_id where es.source_id = any(%s)""",
                (source_ids,),
            ).fetchall():
                linked.setdefault(e["source_id"], []).append({"id": e["id"], "name": e["name"]})

    return {
        "query": q,
        "mode": mode,
        "results": [
            {
                "chunk_id": r["chunk_id"],
                "text": r["text"],
                "score": round(float(r["score"]), 3),
                "language": r["language"],
                "source": {
                    "id": r["source_id"], "filename": r["filename"], "type": r["type"],
                    "page": r["page"], "file_url": r["file_url"],
                    "origin": r["origin"], "author": r["author"], "licence": r["licence"],
                    "source_url": r["source_url"],
                },
                "entities": linked.get(r["source_id"], []),
            }
            for r in rows
        ],
    }


@app.post("/admin/rechunk")
def rechunk(after_id: int = 0, batch: int = 5):
    """Re-split stored text with the current chunker (passages start and end on whole words).
    Works through files in id order, `batch` at a time; call again with the returned `next_after_id`
    until it is null."""
    batch = max(1, min(batch, 20))
    with get_conn() as conn:
        ids = [r["id"] for r in conn.execute(
            "select distinct source_id as id from chunks where source_id > %s order by source_id limit %s",
            (after_id, batch),
        ).fetchall()]
    done, failed = {}, {}
    for sid in ids:
        try:
            done[sid] = rechunk_source(sid)
        except Exception as e:  # keep going; the old passages stay in place for this file
            log.exception("Re-chunk failed for source %s", sid)
            failed[sid] = str(e)[:200]
    return {"rechunked": {k: v for k, v in done.items() if v}, "unchanged": [k for k, v in done.items() if not v],
            "failed": failed, "next_after_id": ids[-1] if len(ids) == batch else None}


@app.post("/admin/reindex")
def reindex():
    """Build search vectors for any text that doesn't have one yet
    (e.g. files uploaded before the Gemini key was added)."""
    if not embeddings.available():
        raise HTTPException(400, "GEMINI_API_KEY is not set.")
    with get_conn() as conn:
        rows = conn.execute("select id, text from chunks where embedding is null order by id limit 500").fetchall()
    try:
        embed_chunks([r["id"] for r in rows], [r["text"] for r in rows])
    except embeddings.EmbeddingError as e:
        raise HTTPException(502, f"Gemini failed: {e}")
    return {"embedded": len(rows)}
