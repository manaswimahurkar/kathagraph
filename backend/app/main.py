import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import get_conn

app = FastAPI(title="KathaGraph API", version="0.1.0")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
