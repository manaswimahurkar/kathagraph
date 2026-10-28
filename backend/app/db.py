import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")


@contextmanager
def get_conn():
    """Open one connection per request. Simple and fine for a hackathon;
    swap for a connection pool (psycopg_pool) when scaling."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        yield conn
