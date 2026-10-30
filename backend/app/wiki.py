"""Imports published, openly licensed reference text about a monument from Wikipedia.

Each article (English, and Hindi where one exists) becomes a source of type "web":
it is stored with an attribution header (title, link, licence, retrieval date), runs
through the same pipeline as any upload (search vectors, fact extraction with quotes),
and is linked to the monument the article is about. The article's coordinates place
the monument on the map when it has no location yet.

Wikipedia text is CC BY-SA 4.0; the header keeps the attribution with the stored copy.
"""
import hashlib
import logging
import re
from datetime import date

import httpx

from . import matching
from .db import get_conn
from .pipeline import _set_status, process_source
from .storage import StorageError, upload_bytes

log = logging.getLogger("kathagraph.wiki")

USER_AGENT = "KathaGraph/0.7 (heritage archive hackathon project; https://github.com/manaswimahurkar/kathagraph)"
MAX_CHARS = 9000  # the lead and history sections; keeps fact extraction fast
LICENCE = "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)"


class WikiError(RuntimeError):
    pass


def parse_response(data: dict) -> dict | None:
    """Pull title, text, url, coordinates and the Hindi title out of an API response."""
    pages = (data.get("query") or {}).get("pages") or []
    if not pages:
        return None
    page = pages[0]
    if page.get("missing") or page.get("invalid"):
        return None
    text = (page.get("extract") or "").strip()
    if not text:
        return None
    coords = (page.get("coordinates") or [{}])[0]
    hindi = next((l.get("title") for l in page.get("langlinks") or [] if l.get("lang") == "hi"), None)
    return {
        "title": page.get("title", ""),
        "text": text,
        "url": page.get("fullurl") or "",
        "lat": coords.get("lat"),
        "lng": coords.get("lon"),
        "hindi_title": hindi,
    }


def fetch_article(title: str, lang: str = "en") -> dict | None:
    params = {
        "action": "query", "format": "json", "formatversion": "2", "redirects": "1",
        "prop": "extracts|coordinates|info|langlinks", "explaintext": "1",
        "inprop": "url", "lllang": "hi", "titles": title,
    }
    try:
        resp = httpx.get(f"https://{lang}.wikipedia.org/w/api.php", params=params,
                         headers={"User-Agent": USER_AGENT}, timeout=30)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise WikiError(f"Could not reach Wikipedia ({lang}): {e}") from e
    return parse_response(resp.json())


def stored_text(article: dict, lang: str, today: date | None = None) -> str:
    """The article text with its attribution on top, trimmed to the lead and early sections."""
    body = article["text"]
    if len(body) > MAX_CHARS:
        cut = body.rfind("\n", 0, MAX_CHARS)
        body = body[: cut if cut > MAX_CHARS // 2 else MAX_CHARS].rstrip() + "\n[…]"
    header = (
        f"PUBLISHED REFERENCE (not a field record)\n"
        f"Source: Wikipedia ({'Hindi' if lang == 'hi' else 'English'}), \"{article['title']}\"\n"
        f"URL: {article['url']}\n"
        f"Licence: {LICENCE}\n"
        f"Retrieved: {(today or date.today()).isoformat()}\n\n"
    )
    return header + body


def _slug(title: str) -> str:
    return re.sub(r"[^\w]+", "_", title, flags=re.UNICODE).strip("_")[:60] or "article"


def _save_source(article: dict, lang: str, entity_id: int) -> tuple[int, bytes] | None:
    """Store one article as a source. Returns None if the same text is already in the archive."""
    data = stored_text(article, lang).encode("utf-8")
    # Duplicates are judged on the article text, not the retrieval date in the header
    digest = hashlib.sha256(article["text"].encode("utf-8")).hexdigest()
    filename = f"wikipedia_{lang}_{_slug(article['title'])}.txt"
    with get_conn() as conn:
        if conn.execute("select 1 from sources where content_hash = %s", (digest,)).fetchone():
            return None
        source_id = conn.execute(
            """insert into sources (type, filename, content_hash, lat, lng, exif_json,
                                   origin, author, licence, source_url, entity_id)
               values ('web', %s, %s, %s, %s, jsonb_build_object('web', jsonb_build_object(
                 'url', %s::text, 'lang', %s::text, 'entity_id', %s::bigint)),
                 'web', 'Wikipedia contributors', %s, %s, %s)
               returning id""",
            (filename, digest, article["lat"], article["lng"], article["url"], lang, entity_id,
             LICENCE, article["url"], entity_id),
        ).fetchone()["id"]
    try:
        url = upload_bytes(data, filename, "text/plain; charset=utf-8")
    except StorageError as e:
        _set_status(source_id, "failed", str(e)[:500])
        return None
    with get_conn() as conn:
        conn.execute("update sources set file_url = %s where id = %s", (url, source_id))
    return source_id, data


def import_monument(title: str, include_hindi: bool = True) -> dict:
    """Fetch a monument's Wikipedia article(s), store them and run the pipeline on each."""
    article = fetch_article(title, "en")
    if not article:
        log.warning("No English Wikipedia article found for %r", title)
        return {"title": title, "found": False, "sources": []}
    hindi = None
    if include_hindi and article["hindi_title"]:
        try:
            hindi = fetch_article(article["hindi_title"], "hi")
        except WikiError as e:
            log.warning("Hindi article skipped: %s", e)

    with get_conn() as conn:
        aliases = [hindi["title"]] if hindi else []
        entity_id = matching.get_or_create(conn, article["title"], "monument", aliases)
        if article["lat"] is not None:
            conn.execute("update entities set lat = %s, lng = %s where id = %s and lat is null",
                         (article["lat"], article["lng"], entity_id))

    created = []
    for doc, lang in [(article, "en")] + ([(hindi, "hi")] if hindi else []):
        saved = _save_source(doc, lang, entity_id)
        if saved:
            source_id, data = saved
            process_source(source_id, data, "web")
            created.append(source_id)
    with get_conn() as conn:
        matching.relink_unlinked_photos(conn)
    return {"title": article["title"], "found": True, "entity_id": entity_id, "sources": created}
