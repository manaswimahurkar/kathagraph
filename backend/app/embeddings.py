"""Turns text into vectors ("embeddings") for meaning-based search, using
Google Gemini. Running a multilingual model on Render's free 512 MB server
would run out of memory, so this is done through the Gemini API instead.

If GEMINI_API_KEY is not set (or Gemini fails), search falls back to keywords.
"""
import logging
import os

from .gemini import API, GeminiError, post_with_retry

log = logging.getLogger("kathagraph.embeddings")

DIM = 768  # must match chunks.embedding vector(768) in schema.sql
BATCH = 50


class EmbeddingError(RuntimeError):
    pass


def available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def embed(texts: list[str], task: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """task: RETRIEVAL_DOCUMENT for archive text, RETRIEVAL_QUERY for searches."""
    key = os.getenv("GEMINI_API_KEY", "")
    model = os.getenv("GEMINI_EMBED_MODEL", "gemini-embedding-001")
    if not key:
        raise EmbeddingError("GEMINI_API_KEY is not set")

    vectors: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        batch = texts[i:i + BATCH]
        body = {
            "requests": [
                {
                    "model": f"models/{model}",
                    "content": {"parts": [{"text": t[:8000]}]},
                    "taskType": task,
                    "outputDimensionality": DIM,
                }
                for t in batch
            ]
        }
        try:
            data = post_with_retry(f"{API}/{model}:batchEmbedContents", body, timeout=60)
        except GeminiError as e:
            raise EmbeddingError(str(e)) from e
        vectors.extend(e["values"] for e in data["embeddings"])
    return vectors


def to_pg(vector: list[float]) -> str:
    """pgvector's text format: [0.1,0.2,...]"""
    return "[" + ",".join(f"{x:.6f}" for x in vector) + "]"
