"""Database connections, shared through a pool.

Opening a Postgres connection costs a TLS handshake and an authentication round trip
(~100 ms to Supabase). A pool keeps a few connections open and lends them out, so a
request reuses one instead of opening its own, and a burst of requests waits briefly for
a free connection instead of exceeding the database's connection limit.

Sizing: DB_POOL_MAX (default 8) per API instance. Supabase's pooler allows a limited number
of client connections per project, so instances x DB_POOL_MAX must stay below it.
If the pool library is missing or fails to start, the app falls back to one connection
per request, so the site never goes down because of the pool.
"""
import logging
import os
import threading
from contextlib import contextmanager

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

load_dotenv()

log = logging.getLogger("kathagraph.db")

DATABASE_URL = os.getenv("DATABASE_URL")
POOL_MIN = int(os.getenv("DB_POOL_MIN", "1"))
POOL_MAX = int(os.getenv("DB_POOL_MAX", "8"))
POOL_TIMEOUT = float(os.getenv("DB_POOL_TIMEOUT", "30"))

_pool = None
_pool_failed = False
_lock = threading.Lock()


def _get_pool():
    """The shared pool, created on first use (so importing the app never needs a database)."""
    global _pool, _pool_failed
    if _pool is not None or _pool_failed or not DATABASE_URL:
        return _pool
    with _lock:
        if _pool is None and not _pool_failed:
            try:
                from psycopg_pool import ConnectionPool

                pool = ConnectionPool(
                    DATABASE_URL,
                    min_size=POOL_MIN,
                    max_size=POOL_MAX,
                    timeout=POOL_TIMEOUT,
                    max_idle=300,           # close connections idle for 5 minutes
                    max_lifetime=1800,      # and recycle every connection after 30 minutes
                    kwargs={"row_factory": dict_row},
                    check=ConnectionPool.check_connection,  # drop connections the server closed
                    open=False,
                    name="kathagraph",
                )
                pool.open(wait=False)
                _pool = pool
                log.info("Database pool ready (%d-%d connections)", POOL_MIN, POOL_MAX)
            except Exception:
                _pool_failed = True
                log.exception("Database pool unavailable; using one connection per request")
    return _pool


@contextmanager
def get_conn():
    """A connection for one unit of work. Commits when the block ends, rolls back on an error."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")
    pool = _get_pool()
    if pool is not None:
        with pool.connection() as conn:
            yield conn
        return
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        yield conn


def pool_stats() -> dict:
    """Pool size and use, for /health."""
    pool = _get_pool()
    if pool is None:
        return {"pooled": False}
    s = pool.get_stats()
    return {"pooled": True, "size": s.get("pool_size"), "available": s.get("pool_available"),
            "waiting": s.get("requests_waiting", 0), "max": POOL_MAX}


def close_pool() -> None:
    if _pool is not None:
        _pool.close()
