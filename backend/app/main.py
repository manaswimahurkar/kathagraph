import logging
import os
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import get_conn
from .pipeline import process_source
from .storage import StorageError, upload_bytes

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("kathagraph")

app = FastAPI(title="KathaGraph API", version="0.3.0")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_FILES_PER_UPLOAD = 50
KINDS = {
    ".jpg": "photo", ".jpeg": "photo", ".png": "photo", ".webp": "photo", ".tif": "photo", ".tiff": "photo",
    ".pdf": "pdf",
    ".txt": "note", ".md": "note",
    ".csv": "csv",
}
SOURCE_FIELDS = "id, filename, type, status, error, lat, lng, captured_at, file_url, created_at"


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
async def upload(background: BackgroundTasks, files: list[UploadFile] = File(...)):
    """Accept files, store them, and queue each one for processing."""
    if not files:
        raise HTTPException(400, "No files were sent.")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(400, f"Upload at most {MAX_FILES_PER_UPLOAD} files at a time.")

    # Validate everything first, so a bad file doesn't leave a half-finished upload
    batch = []
    for f in files:
        name = f.filename or "unnamed"
        kind = KINDS.get(Path(name).suffix.lower())
        if kind is None:
            allowed = ", ".join(sorted(KINDS))
            raise HTTPException(400, f"'{name}' is not a supported file type. Allowed: {allowed}")
        data = await f.read()
        if not data:
            raise HTTPException(400, f"'{name}' is empty.")
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, f"'{name}' is larger than 20 MB.")
        batch.append((name, kind, data, f.content_type))

    created = []
    for name, kind, data, content_type in batch:
        with get_conn() as conn:
            row = conn.execute(
                "insert into sources (type, filename) values (%s, %s) returning id",
                (kind, name),
            ).fetchone()
        source_id = row["id"]
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

    return JSONResponse({"sources": created}, status_code=202)


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


@app.get("/sources/{source_id}/text")
def get_source_text(source_id: int):
    """The text extracted from one file, piece by piece (for checking OCR)."""
    with get_conn() as conn:
        src = conn.execute("select id, filename, status, error from sources where id = %s", (source_id,)).fetchone()
        if not src:
            raise HTTPException(404, "Source not found.")
        chunks = conn.execute(
            "select id, page, language, text from chunks where source_id = %s order by page nulls first, id",
            (source_id,),
        ).fetchall()
    return {"source": src, "chunks": chunks}
