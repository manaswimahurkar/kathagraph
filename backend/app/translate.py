"""English translations of regional-language documents (Hindi, Gujarati), page by page.

The original text is never replaced: translations are stored beside it and always labelled as
machine translations, so a researcher can read both and check one against the other.
"""
import logging

from . import gemini, text_extract
from .db import get_conn

log = logging.getLogger("kathagraph.translate")

MAX_PAGES = 12
MAX_CHARS = 6000

SCHEMA = {
    "type": "OBJECT",
    "properties": {"translation": {"type": "STRING"}},
    "required": ["translation"],
}
PROMPT = """Translate this text from a heritage archive into plain, faithful English for researchers.
- Keep every name, date, number and place exactly as written (transliterate names into Latin letters).
- Keep the line and paragraph breaks.
- Do not add explanations, summaries or anything that is not in the text.
- Where the text is unreadable OCR noise, write [illegible].
Text ({language}):
---
{text}
---"""
LANGUAGE = {"hi": "Hindi", "gu": "Gujarati", "mixed": "mixed Hindi/Gujarati and English"}


def needs_translation(text: str) -> bool:
    """True when a real share of the text is in Devanagari or Gujarati script."""
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 20:
        return False
    regional = sum(1 for c in letters if "ऀ" <= c <= "૿")
    return regional / len(letters) >= 0.25


def translate(text: str) -> str:
    lang = LANGUAGE.get(text_extract.detect_language(text), "Hindi or Gujarati")
    out = gemini.generate_json([{"text": PROMPT.format(language=lang, text=text[:MAX_CHARS])}], SCHEMA, temperature=0.0)
    return str(out.get("translation", "")).strip()


def translate_source(source_id: int) -> int:
    """Translate a source's regional-language pages into English. Returns pages translated."""
    with get_conn() as conn:
        rows = conn.execute(
            "select page, text from chunks where source_id = %s and text not like '[AI%%' order by page nulls first, id",
            (source_id,),
        ).fetchall()
        done = {r["page"] for r in conn.execute(
            "select page from translations where source_id = %s", (source_id,)).fetchall()}
    pages: dict[int, list[str]] = {}
    for r in rows:
        pages.setdefault(r["page"] or 0, []).append(r["text"])
    count = 0
    for page, parts in list(pages.items())[:MAX_PAGES]:
        if page in done:
            continue
        text = text_extract.stitch(parts)
        if not needs_translation(text):
            continue
        english = translate(text)
        if not english:
            continue
        with get_conn() as conn:
            conn.execute(
                """insert into translations (source_id, page, text_en) values (%s, %s, %s)
                   on conflict (source_id, page) do update set text_en = excluded.text_en, created_at = now()""",
                (source_id, page, english),
            )
        count += 1
    return count


def backfill() -> None:
    """Translate every stored regional-language document that has no translation yet."""
    with get_conn() as conn:
        ids = [r["id"] for r in conn.execute(
            """select distinct c.source_id as id from chunks c
               where c.language in ('hi', 'gu', 'mixed')
                 and not exists (select 1 from translations t where t.source_id = c.source_id)
               order by 1"""
        ).fetchall()]
    for sid in ids:
        try:
            n = translate_source(sid)
            log.info("Translated %d page(s) of source %s", n, sid)
        except gemini.GeminiError as e:
            log.warning("Translation of source %s failed: %s", sid, e)
