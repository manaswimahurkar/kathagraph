"""Structured facts from Wikidata, and the item's photo from Wikimedia Commons.

Wikidata statements (inception, architect, heritage designation, ...) become claims with
method "import": each is quoted from a stored, attributed copy of the statements, so it can be
checked and compared with what articles, inscriptions and field notes say, like any other claim.
Wikidata is CC0. The item's main image (P18) is imported from Commons with its author and licence,
as a published photo; it goes through the normal photo pipeline (AI description, tags, OCR).
"""
import hashlib
import html
import logging
import re
from datetime import date
from urllib.parse import unquote

import httpx

from . import embeddings, text_extract
from .db import get_conn
from .storage import upload_bytes
from .wiki import USER_AGENT

log = logging.getLogger("kathagraph.wikidata")

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
LICENCE = "CC0 1.0 (public domain dedication)"
PHOTO_WIDTH = 1600

# Wikidata property -> our claim field
PROPERTIES = {
    "P571": "built_date",           # inception
    "P84": "builder",               # architect
    "P88": "builder",               # commissioned by
    "P149": "architectural_style",
    "P186": "material",
    "P1435": "heritage_status",     # heritage designation
}
FREE_LICENCE = re.compile(r"^(cc[- ]?by|cc[- ]?zero|cc0|public domain|pd\b|attribution)", re.I)


class WikidataError(RuntimeError):
    pass


def _get(url: str, params: dict) -> dict:
    try:
        resp = httpx.get(url, params={**params, "format": "json"}, headers={"User-Agent": USER_AGENT}, timeout=30)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise WikidataError(f"Could not reach {url.split('/')[2]}: {e}") from e
    return resp.json()


# ---------- formatting (pure, tested) ----------

def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def format_time(value: dict) -> str | None:
    """A Wikidata time value at the precision it was recorded with:
    year (1063), decade (1060s), century (11th century), millennium; BCE when negative."""
    m = re.match(r"^([+-])(\d+)-", value.get("time", ""))
    if not m:
        return None
    year, bce = int(m.group(2)), m.group(1) == "-"
    era = " BCE" if bce else ""
    precision = value.get("precision", 9)
    if precision >= 9:
        return f"{year}{era}" if bce else str(year)
    if precision == 8:
        return f"{year // 10 * 10}s{era}"
    if precision == 7:
        return f"{_ordinal((year - 1) // 100 + 1)} century{era}"
    return f"{_ordinal((year - 1) // 1000 + 1)} millennium{era}"


def statements(item: dict) -> tuple[list[tuple[str, str, str | None]], dict]:
    """(field, raw value, item id or None) for the properties we use, plus coordinates and image."""
    out, extra = [], {"lat": None, "lng": None, "images": []}
    claims = item.get("claims") or {}
    for pid, field in PROPERTIES.items():
        for st in claims.get(pid, []):
            if st.get("rank") == "deprecated":
                continue
            snak = st.get("mainsnak") or {}
            if snak.get("snaktype") != "value":
                continue
            dv = (snak.get("datavalue") or {}).get("value")
            if isinstance(dv, dict) and "time" in dv:
                text = format_time(dv)
                if text:
                    out.append((field, text, None))
            elif isinstance(dv, dict) and dv.get("id"):
                out.append((field, dv["id"], dv["id"]))
    for st in claims.get("P625", [])[:1]:
        dv = ((st.get("mainsnak") or {}).get("datavalue") or {}).get("value") or {}
        extra["lat"], extra["lng"] = dv.get("latitude"), dv.get("longitude")
    for st in claims.get("P18", [])[:2]:
        dv = ((st.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(dv, str):
            extra["images"].append(dv)
    return out, extra


def statement_text(qid: str, label: str, facts: list[tuple[str, str]], today: date | None = None) -> tuple[str, str]:
    """The stored copy: attribution header, then one line per statement (each line is a claim's quote).
    Returns (full text, body used for duplicate detection)."""
    body = f"{label} ({qid})\n" + "\n".join(f"{field.replace('_', ' ')}: {value}" for field, value in facts)
    header = (
        "PUBLISHED REFERENCE (structured data, not a field record)\n"
        f"Source: Wikidata, item {qid} \"{label}\"\n"
        f"URL: https://www.wikidata.org/wiki/{qid}\n"
        f"Licence: {LICENCE}\n"
        f"Retrieved: {(today or date.today()).isoformat()}\n\n"
    )
    return header + body, body


def clean_html(text: str | None) -> str | None:
    if not text:
        return None
    text = html.unescape(re.sub(r"<[^>]+>", "", text)).strip()
    return re.sub(r"\s+", " ", text)[:300] or None


def photo_credit(info: dict) -> dict | None:
    """Author, licence and links from Commons imageinfo; None if the licence isn't a free one."""
    meta = info.get("extmetadata") or {}
    val = lambda k: (meta.get(k) or {}).get("value")  # noqa: E731
    licence = clean_html(val("LicenseShortName"))
    if not licence or not FREE_LICENCE.search(licence):
        return None
    return {
        "author": clean_html(val("Artist")) or clean_html(val("Credit")) or "Unknown author (see source page)",
        "licence": licence + (f" ({val('LicenseUrl')})" if val("LicenseUrl") else ""),
        "source_url": info.get("descriptionurl"),
        "thumb_url": info.get("thumburl") or info.get("url"),
        "description": clean_html(val("ImageDescription")),
    }


# ---------- network ----------

def qid_for_article(title: str, lang: str = "en") -> str | None:
    data = _get(f"https://{lang}.wikipedia.org/w/api.php", {
        "action": "query", "formatversion": "2", "redirects": "1", "prop": "pageprops",
        "ppprop": "wikibase_item", "titles": title,
    })
    pages = (data.get("query") or {}).get("pages") or []
    return ((pages[0].get("pageprops") or {}).get("wikibase_item")) if pages else None


def fetch_item(qid: str) -> dict:
    data = _get(WIKIDATA_API, {"action": "wbgetentities", "ids": qid, "props": "claims|labels", "languages": "en"})
    item = (data.get("entities") or {}).get(qid)
    if not item or "missing" in item:
        raise WikidataError(f"Wikidata has no item {qid}.")
    return item


def labels(ids: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(ids), 50):
        data = _get(WIKIDATA_API, {"action": "wbgetentities", "ids": "|".join(ids[i:i + 50]),
                                   "props": "labels", "languages": "en"})
        for qid, ent in (data.get("entities") or {}).items():
            label = ((ent.get("labels") or {}).get("en") or {}).get("value")
            if label:
                out[qid] = label
    return out


def commons_info(filename: str) -> dict | None:
    data = _get(COMMONS_API, {
        "action": "query", "formatversion": "2", "titles": f"File:{filename}", "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime", "iiurlwidth": str(PHOTO_WIDTH),
    })
    pages = (data.get("query") or {}).get("pages") or []
    infos = pages[0].get("imageinfo") if pages else None
    return infos[0] if infos else None


# ---------- import ----------

def article_title_for(conn, entity_id: int) -> str | None:
    """The English Wikipedia article imported *for* this monument (not ones that merely mention it)."""
    row = conn.execute(
        """select source_url from sources
           where entity_id = %s and type = 'web' and source_url like 'https://en.wikipedia.org/wiki/%%'
           order by id limit 1""",
        (entity_id,),
    ).fetchone()
    if not row:
        return None
    return unquote(row["source_url"].rsplit("/wiki/", 1)[1]).replace("_", " ")


def _new_source(conn, *, type_: str, filename: str, digest: str, author: str, licence: str,
                source_url: str, entity_id: int) -> int | None:
    if conn.execute("select 1 from sources where content_hash = %s", (digest,)).fetchone():
        return None
    return conn.execute(
        """insert into sources (type, filename, content_hash, origin, author, licence, source_url, entity_id)
           values (%s, %s, %s, 'web', %s, %s, %s, %s) returning id""",
        (type_, filename, digest, author, licence, source_url, entity_id),
    ).fetchone()["id"]


def import_facts(entity_id: int, qid: str, item: dict) -> dict:
    """Store the item's statements as one source, with one claim per statement."""
    raw, extra = statements(item)
    names = labels(sorted({ref for _, _, ref in raw if ref}))
    facts = list(dict.fromkeys((field, names.get(ref, value) if ref else value) for field, value, ref in raw))
    facts = [(f, v) for f, v in facts if not re.fullmatch(r"Q\d+", v)]  # drop items with no English label
    label = ((item.get("labels") or {}).get("en") or {}).get("value") or qid

    with get_conn() as conn:
        if extra["lat"] is not None:
            conn.execute("update entities set lat = %s, lng = %s, coord_precision = 'exact' where id = %s and lat is null",
                         (extra["lat"], extra["lng"], entity_id))
    if not facts:
        return {"qid": qid, "facts": 0, "images": extra["images"]}

    text, body = statement_text(qid, label, facts)
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    filename = f"wikidata_{qid}.txt"
    with get_conn() as conn:
        source_id = _new_source(conn, type_="web", filename=filename, digest=digest,
                                author="Wikidata contributors", licence=LICENCE,
                                source_url=f"https://www.wikidata.org/wiki/{qid}", entity_id=entity_id)
    if source_id is None:
        return {"qid": qid, "facts": 0, "images": extra["images"], "note": "already imported"}

    url = upload_bytes(text.encode("utf-8"), filename, "text/plain; charset=utf-8")
    vector = None
    if embeddings.available():
        try:
            vector = embeddings.to_pg(embeddings.embed([text], "RETRIEVAL_DOCUMENT")[0])
        except embeddings.EmbeddingError as e:
            log.warning("No search vector for %s: %s", qid, e)
    with get_conn() as conn:
        conn.execute("update sources set file_url = %s, status = 'done' where id = %s", (url, source_id))
        chunk_id = conn.execute(
            "insert into chunks (source_id, text, language, embedding) values (%s, %s, 'en', %s::vector) returning id",
            (source_id, text, vector),
        ).fetchone()["id"]
        conn.execute(
            "insert into entity_sources (entity_id, source_id, tag) values (%s, %s, 'reference') on conflict do nothing",
            (entity_id, source_id),
        )
        for field, value in facts:
            conn.execute(
                """insert into claims (entity_id, field, value, quote, source_id, chunk_id, method, confidence)
                   values (%s, %s, %s, %s, %s, %s, 'import', 0.9)""",
                (entity_id, field, value, f"{field.replace('_', ' ')}: {value}", source_id, chunk_id),
            )
    return {"qid": qid, "facts": len(facts), "images": extra["images"], "source_id": source_id}


def import_photo(entity_id: int, filename: str) -> int | None:
    """Download a Commons photo (resized) with its credit and run the photo pipeline on it."""
    from .pipeline import process_source  # avoid an import cycle

    info = commons_info(filename)
    credit = photo_credit(info) if info else None
    if not credit or not credit["thumb_url"]:
        log.info("Skipped Commons file %r (missing or not freely licensed)", filename)
        return None
    try:
        resp = httpx.get(credit["thumb_url"], headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise WikidataError(f"Could not download {filename}: {e}") from e
    data = resp.content
    digest = hashlib.sha256(data).hexdigest()
    stored_name = "commons_" + re.sub(r"[^\w.]+", "_", filename)[:80]
    with get_conn() as conn:
        source_id = _new_source(conn, type_="photo", filename=stored_name, digest=digest,
                                author=credit["author"], licence=credit["licence"],
                                source_url=credit["source_url"], entity_id=entity_id)
    if source_id is None:
        return None
    url = upload_bytes(data, stored_name, info.get("mime") or "image/jpeg")
    with get_conn() as conn:
        conn.execute("update sources set file_url = %s where id = %s", (url, source_id))
    process_source(source_id, data, "photo")
    return source_id


def import_monument(entity_id: int, title: str | None = None, photos: bool = True) -> dict:
    """Wikidata facts (and the main Commons photo) for one monument."""
    with get_conn() as conn:
        title = title or article_title_for(conn, entity_id)
    if not title:
        return {"entity_id": entity_id, "found": False, "reason": "no Wikipedia article imported for it"}
    qid = qid_for_article(title)
    if not qid:
        return {"entity_id": entity_id, "found": False, "reason": f"no Wikidata item for {title!r}"}
    result = {"entity_id": entity_id, "found": True, **import_facts(entity_id, qid, fetch_item(qid))}
    result["photos"] = []
    if photos:
        for image in result.pop("images", [])[:1]:
            try:
                sid = import_photo(entity_id, image)
                if sid:
                    result["photos"].append(sid)
            except WikidataError as e:
                log.warning("Photo skipped for %s: %s", entity_id, e)
    else:
        result.pop("images", None)
    return result
