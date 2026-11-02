"""Three views that turn the evidence store into work and understanding:

- /review: the AI-extracted facts most likely to be wrong, ranked, so a reviewer checks those first.
- /timeline: every monument placed in time, with the uncertainty of its date kept as a range.
- /inscription/read: an AI reading of an inscription photo (transcription, translation, names, dates),
  with calendar dates converted to the Common Era by fixed rules here, not by the model.
"""
import logging
import re
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from . import analysis, gemini, models3d
from .claims import quote_in_source
from .db import get_conn
from .security import inscription_limit
from .entities import FIELD_LABELS

log = logging.getLogger("kathagraph.insights")
router = APIRouter()


# ---------- review queue ----------

def risk(claim: dict, disputed: bool, corroborating_sources: int) -> tuple[int, list[str]]:
    """How likely an unverified AI fact is to be wrong, and why. Higher = check first."""
    score, why = 0, []
    if disputed:
        score += 3
        why.append("Other sources give a different value")
    if claim.get("quote") and claim.get("chunk_text") and not quote_in_source(claim["quote"], claim["chunk_text"]):
        score += 3
        why.append("The quoted words were not found in the source")
    elif not claim.get("quote"):
        score += 1
        why.append("No supporting quote")
    if claim.get("field") == "built_date":
        span = analysis.year_range(claim.get("value") or "")
        if span is None:
            score += 2
            why.append("Date can't be read")
        elif span[0] >= 1950:
            score += 2
            why.append("Very recent for a heritage site: may be a listing or restoration year")
    if claim.get("method") == "ocr":
        score += 1
        why.append("Read by OCR")
    if (claim.get("confidence") or 0) <= 0.5:
        score += 1
        why.append("Low confidence")
    if corroborating_sources == 0:
        score += 1
        why.append("Only one source says this")
    elif corroborating_sources >= 2:
        score -= 2
    return score, why


@router.get("/review")
def review(limit: int = 30):
    """Unverified facts, riskiest first, each with the reasons and the evidence to check it against."""
    limit = max(1, min(limit, 100))
    with get_conn() as conn:
        rows = conn.execute(
            """select c.id, c.entity_id, e.name as entity_name, c.field, c.value, c.quote, c.method,
                      c.confidence, c.status, s.id as source_id, s.filename, s.origin, s.file_url, s.source_url,
                      ch.text as chunk_text
               from claims c join entities e on e.id = c.entity_id
               join sources s on s.id = c.source_id
               left join chunks ch on ch.id = c.chunk_id
               where c.status <> 'rejected' and e.type = 'monument'"""
        ).fetchall()
        counts = {r["status"]: r["n"] for r in conn.execute(
            "select status, count(*) as n from claims group by status").fetchall()}

    by_entity: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        r["source"] = {"id": r["source_id"], "filename": r["filename"]}
        by_entity[r["entity_id"]].append(r)

    queue = []
    for eid, claims in by_entity.items():
        disputed = {c["field"] for c in analysis.conflicts(claims)}
        groups = analysis.value_groups(claims)
        sources_for = defaultdict(set)
        for c in claims:
            sources_for[(c["field"], groups[c["id"]])].add(c["source_id"])
        for c in claims:
            if c["status"] != "unverified" or c["method"] not in ("llm", "ocr"):
                continue
            others = len(sources_for[(c["field"], groups[c["id"]])] - {c["source_id"]})
            score, why = risk(c, c["field"] in disputed, others)
            queue.append({
                "id": c["id"], "entity": {"id": eid, "name": c["entity_name"]},
                "field": c["field"], "field_label": FIELD_LABELS.get(c["field"], c["field"].replace("_", " ")),
                "value": c["value"], "quote": c["quote"], "method": c["method"], "confidence": c["confidence"],
                "risk": score, "reasons": why,
                "excerpt": _around(c["chunk_text"] or "", c["quote"] or c["value"]),
                "source": {"id": c["source_id"], "filename": c["filename"], "origin": c["origin"],
                           "file_url": c["file_url"], "source_url": c["source_url"]},
            })
    queue.sort(key=lambda q: (-q["risk"], q["entity"]["name"], q["field"]))
    return {
        "totals": {"unverified": counts.get("unverified", 0), "verified": counts.get("verified", 0),
                   "rejected": counts.get("rejected", 0), "in_queue": len(queue)},
        "claims": queue[:limit],
    }


def _around(text: str, needle: str, width: int = 360) -> str:
    """The part of a passage around the quoted words, so the reviewer sees them in context."""
    if not text:
        return ""
    i = text.lower().find((needle or "").lower()[:40]) if needle else -1
    if i < 0:
        return text[:width]
    start = max(0, i - width // 3)
    return ("…" if start else "") + text[start:start + width] + ("…" if start + width < len(text) else "")


# ---------- timeline ----------

def date_span(values: list[str]) -> tuple[int, int] | None:
    """Earliest start and latest end over every date statement that can be read."""
    spans = [s for s in (analysis.year_range(v) for v in values) if s]
    if not spans:
        return None
    return min(s[0] for s in spans), max(s[1] for s in spans)


@router.get("/timeline")
def timeline():
    """Monuments in time. `span` covers every recorded date (verified dates win when present);
    `variants` keeps each version with its sources, so disagreement stays visible."""
    with get_conn() as conn:
        ents = conn.execute(
            "select id, name, lat, lng, nature from entities where type = 'monument' order by name").fetchall()
        claims = conn.execute(
            """select c.id, c.entity_id, c.field, c.value, c.status, c.source_id, s.filename
               from claims c join sources s on s.id = c.source_id
               where c.status <> 'rejected' and c.field in ('built_date', 'dynasty')"""
        ).fetchall()
    by_entity: dict[int, list[dict]] = defaultdict(list)
    for c in claims:
        by_entity[c["entity_id"]].append(c)

    dated, undated, natural = [], [], []
    for e in ents:
        nature = e["nature"] or "built"
        if nature == "natural":  # a mountain or an island has no date of construction
            natural.append({"id": e["id"], "name": e["name"], "category": models3d.category_for(e["name"]),
                            "nature": nature, "lat": e["lat"], "lng": e["lng"]})
            continue
        cs = by_entity.get(e["id"], [])
        dates = [c for c in cs if c["field"] == "built_date"]
        verified = [c for c in dates if c["status"] == "verified"]
        basis = verified or dates
        span = date_span([c["value"] for c in basis])
        dynasties = Counter(analysis.value_groups([c for c in cs if c["field"] == "dynasty"]).values())
        item = {"id": e["id"], "name": e["name"], "category": models3d.category_for(e["name"]),
                "dynasty": dynasties.most_common(1)[0][0] if dynasties else None,
                "nature": nature, "date_meaning": "founded" if nature == "settlement" else "built"}
        if not span:
            undated.append(item)
            continue
        groups = analysis.value_groups(dates)
        variants: dict[str, dict] = {}
        for c in dates:
            g = groups[c["id"]]
            v = variants.setdefault(g, {"value": g, "span": analysis.year_range(g), "sources": [], "verified": False})
            v["sources"].append(c["filename"])
            v["verified"] = v["verified"] or c["status"] == "verified"
        dated.append({**item, "span": list(span), "verified": bool(verified),
                      "disputed": len(variants) > 1 and not verified,
                      "variants": sorted(variants.values(), key=lambda v: (v["span"] or (0, 0))[0])})
    dated.sort(key=lambda d: (d["span"][0], d["span"][1]))
    return {"monuments": dated, "undated": undated, "natural": natural}


# ---------- reading a monument's date again ----------

DATE_SCHEMA = {
    "type": "OBJECT",
    "properties": {"dates": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "value": {"type": "STRING"}, "quote": {"type": "STRING"}, "confidence": {"type": "NUMBER"},
    }, "required": ["value", "quote", "confidence"]}}},
    "required": ["dates"],
}
DATE_PROMPT = """From the text below about {name}, find when it was {meaning}.
{rule}
- NOT the year it was discovered, excavated, restored, renovated, listed as a World Heritage Site or protected.
- value: a CE year as digits ("1499"), a BCE year as "2650 BCE", a range ("2650 BCE - 1450 BCE"), or a century
  ("15th century"). Convert Vikram Samvat by subtracting 57.
- quote: the exact words from the text, copied verbatim in the original language.
- If the text does not say, return {{"dates": []}}.
Text:
---
{text}
---"""


def redate_entity(entity_id: int) -> int:
    """Ask again, from the monument's own texts, only for its date of construction (or founding).
    Returns the number of new date claims saved."""
    from . import claims as claims_mod
    with get_conn() as conn:
        ent = conn.execute("select id, name, nature from entities where id = %s", (entity_id,)).fetchone()
        if not ent:
            return 0
        rows = conn.execute(
            """select ch.id, ch.source_id, ch.text from entity_sources es
               join sources s on s.id = es.source_id join chunks ch on ch.source_id = s.id
               where es.entity_id = %s and s.type <> 'photo' and ch.text not like '[AI%%'
               order by s.id, ch.page nulls first, ch.id""", (entity_id,)).fetchall()
        existing = {r["value"] for r in conn.execute(
            "select value from claims where entity_id = %s and field = 'built_date'", (entity_id,)).fetchall()}
    if not rows or not gemini.available():
        return 0
    settlement = ent["nature"] == "settlement"
    meaning = "founded or first settled" if settlement else "built"
    rule = ("- For an ancient city, give the period it was first settled (e.g. its Harappan phase)."
            if settlement else "- The year construction was completed, or the period it was built.")
    by_source: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        by_source[r["source_id"]].append(r)
    saved = 0
    for source_id, chunks in by_source.items():
        text = "\n\n".join(c["text"] for c in chunks)[:12000]
        try:
            out = gemini.generate_json([{"text": DATE_PROMPT.format(name=ent["name"], meaning=meaning, rule=rule, text=text)}],
                                       DATE_SCHEMA, temperature=0.0)
        except gemini.GeminiError as e:
            log.warning("Redate %s / source %s failed: %s", entity_id, source_id, e)
            continue
        for d in out.get("dates", [])[:2]:
            value, quote = str(d.get("value", "")).strip(), str(d.get("quote", "")).strip()
            if not value or value in existing or analysis.year_range(value) is None:
                continue
            chunk_id = next((c["id"] for c in chunks if quote and quote[:40] in c["text"]), chunks[0]["id"])
            try:
                conf = max(0.0, min(1.0, float(d.get("confidence", 0.5))))
            except (TypeError, ValueError):
                conf = 0.5
            with get_conn() as conn:
                conn.execute(
                    """insert into claims (entity_id, field, value, quote, source_id, chunk_id, method, confidence)
                       values (%s, 'built_date', %s, %s, %s, %s, 'llm', %s)""",
                    (entity_id, value, quote or None, source_id, chunk_id,
                     claims_mod.calibrate(conf, quote, text)),
                )
            existing.add(value)
            saved += 1
    log.info("Redate %s: %d new date(s)", entity_id, saved)
    return saved


# ---------- inscription reader ----------

INSCRIPTION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "is_inscription": {"type": "BOOLEAN"},
        "script": {"type": "STRING"},
        "language": {"type": "STRING"},
        "legibility": {"type": "STRING", "enum": ["good", "partial", "poor"]},
        "transcription": {"type": "STRING"},
        "transliteration": {"type": "STRING"},
        "translation_en": {"type": "STRING"},
        "dates": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "as_written": {"type": "STRING"},
            "calendar": {"type": "STRING", "enum": ["vikram_samvat", "shaka", "hijri", "common_era", "unknown"]},
            "year": {"type": "INTEGER"},
        }, "required": ["as_written", "calendar"]}},
        "names": {"type": "ARRAY", "items": {"type": "STRING"}},
        "uncertain": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["is_inscription", "script", "language", "legibility", "transcription", "translation_en", "dates", "names", "uncertain"],
}

INSCRIPTION_PROMPT = """You are helping an epigraphy archive of Gujarat's heritage read an inscription photo.
Read exactly what is carved or painted. Do not fill gaps from memory of famous inscriptions.
- is_inscription: false if the photo shows no inscription or text.
- script (e.g. Devanagari, Gujarati, Nagari, Brahmi, Arabic/Persian Naskh, Latin) and language (e.g. Sanskrit, Gujarati, Persian).
- legibility: good / partial / poor.
- transcription: in the original script, line by line; write [...] for illegible parts.
- transliteration: in Latin letters (IAST where possible).
- translation_en: plain English.
- dates: every date as written, with its calendar (vikram_samvat for Samvat/VS, shaka, hijri for AH, common_era) and
  the year number as written (do not convert it).
- names: people, places and dynasties named.
- uncertain: each word or reading you are not sure of, with a short reason.
"""

# Era offsets: a year in the era corresponds to these Common Era years (the era year starts mid-year)
ERA_OFFSET = {"vikram_samvat": (-57, -56), "shaka": (78, 79)}


def to_common_era(calendar: str, year: int | None) -> tuple[int, int] | None:
    """Convert a dated era year to the Common Era span it falls in. Hijri years are lunar (about 354 days)."""
    if not year:
        return None
    if calendar in ERA_OFFSET:
        a, b = ERA_OFFSET[calendar]
        return year + a, year + b
    if calendar == "hijri":
        start = 622 + (year - 1) * 354.367 / 365.2425
        return int(start), int(start + 354.367 / 365.2425) + 1
    if calendar == "common_era":
        return year, year
    return None


@router.post("/inscription/read", dependencies=[Depends(inscription_limit)])
async def read_inscription(file: UploadFile = File(...)):
    """An AI reading of an inscription photo, for a reviewer to check against the stone. Nothing is stored:
    to keep it, upload the photo to the archive, where it is OCR'd and linked like any other file."""
    if not gemini.available():
        raise HTTPException(503, "Reading inscriptions needs the Gemini key, which isn't configured.")
    name = (file.filename or "").lower()
    if not re.search(r"\.(jpe?g|png|webp)$", name):
        raise HTTPException(400, "Send a photo (.jpg, .png or .webp).")
    data = await file.read()
    if not data:
        raise HTTPException(400, "That file is empty.")
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Photos can be at most 15 MB.")
    try:
        out = gemini.generate_json([{"text": INSCRIPTION_PROMPT}, gemini.image_part(data, max_side=1600)],
                                   INSCRIPTION_SCHEMA, temperature=0.0)
    except gemini.GeminiError as e:
        raise HTTPException(502, f"Couldn't read the inscription right now: {e}")
    except Exception as e:  # unreadable image
        raise HTTPException(400, f"Couldn't open that image: {e}")
    for d in out.get("dates") or []:
        span = to_common_era(d.get("calendar", "unknown"), d.get("year"))
        d["common_era"] = list(span) if span else None
    out["notice"] = "AI reading. Check every word against the inscription before treating it as a fact."
    return out
