"""Ask the archive: a question in any language, answered only from the archive's own records.

Retrieval: the passages closest in meaning to the question (at most 2 per file), plus the
structured record of the monuments those passages belong to: known facts, where sources
disagree, and what is still undocumented. Gemini writes a short answer from that material
alone, citing passage numbers. Disagreements are reported, never resolved silently, and a
question the archive can't answer gets "not recorded yet" instead of a guess.
"""
import logging
import re
from collections import Counter

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import embeddings, gemini
from .db import get_conn
from .entities import FIELD_LABELS, _entity_detail

log = logging.getLogger("kathagraph.ask")
router = APIRouter()

MAX_PASSAGES = 8
PER_SOURCE = 2
MAX_MONUMENTS = 2
EXCERPT = 420

ANSWER_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "answer": {"type": "STRING"},
        "citations": {"type": "ARRAY", "items": {"type": "INTEGER"}},
        "disagreements": {"type": "ARRAY", "items": {"type": "STRING"}},
        "not_recorded": {"type": "ARRAY", "items": {"type": "STRING"}},
        "confidence": {"type": "STRING", "enum": ["high", "medium", "low"]},
    },
    "required": ["answer", "citations", "disagreements", "not_recorded", "confidence"],
}

INSTRUCTIONS = """You answer questions for KathaGraph, an evidence-aware archive of Gujarat's heritage.
Answer ONLY from the numbered passages and the monument records below. Never use outside knowledge.

Rules:
- Write the answer in the same language as the question (Hindi, English or Gujarati). 2 to 5 sentences.
- After every statement, cite the passage it comes from as [n]. Only cite numbers that exist.
- Field records (written by contributors on site) and published references (Wikipedia, Wikidata,
  Commons) are both evidence; say which kind supports a point when it matters.
- If sources disagree, do NOT pick a winner. Give each version with its citation, and add one
  plain sentence per disagreement to "disagreements" (e.g. "Construction year: 1498 [2] vs 1499 [5]").
  A fact marked VERIFIED was confirmed by a reviewer and may be stated as such.
- If the material does not answer the question (or part of it), say so plainly in the answer and
  list what is missing in "not_recorded" (e.g. "Interior photographs"). Never guess.
- confidence: "high" if the passages state the answer directly and agree, "medium" if partly or
  with disagreement, "low" if the archive barely covers it.
"""


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    entity_id: int | None = None  # ask about one monument (e.g. from its page)


def _passages(question: str, entity_id: int | None) -> tuple[list[dict], str]:
    fields = """c.id as chunk_id, c.text, c.page, s.id as source_id, s.filename, s.type, s.file_url,
                s.origin, s.author, s.licence, s.source_url"""
    scope = "and exists (select 1 from entity_sources es where es.source_id = s.id and es.entity_id = %s)" \
        if entity_id else ""
    scope_args = (entity_id,) if entity_id else ()
    rows, mode = [], "keyword"
    if embeddings.available():
        try:
            vec = embeddings.to_pg(embeddings.embed([question], "RETRIEVAL_QUERY")[0])
            with get_conn() as conn:
                rows = conn.execute(
                    f"""select {fields} from chunks c join sources s on s.id = c.source_id
                        where c.embedding is not null {scope}
                        order by c.embedding <=> %s::vector limit 40""",
                    (*scope_args, vec),
                ).fetchall()
            mode = "semantic"
        except embeddings.EmbeddingError as e:
            log.warning("Ask: semantic retrieval unavailable, using keywords: %s", e)
    if mode == "keyword":
        words = [w for w in re.findall(r"\w+", question) if len(w) > 2][:8] or [question]
        patterns = [f"%{w}%" for w in words]
        with get_conn() as conn:
            rows = conn.execute(
                f"""select {fields} from chunks c join sources s on s.id = c.source_id
                    where c.text ilike any(%s::text[]) {scope} limit 40""",
                (patterns, *scope_args),
            ).fetchall()
    kept, per = [], Counter()
    for r in rows:
        if per[r["source_id"]] < PER_SOURCE:
            per[r["source_id"]] += 1
            kept.append(r)
        if len(kept) == MAX_PASSAGES:
            break
    return kept, mode


def _monuments(passages: list[dict], entity_id: int | None) -> list[dict]:
    """The monuments the retrieved passages are about, most-mentioned first."""
    if entity_id:
        ids = [entity_id]
    else:
        source_ids = [p["source_id"] for p in passages]
        if not source_ids:
            return []
        with get_conn() as conn:
            links = conn.execute(
                """select es.entity_id, es.source_id from entity_sources es join entities e on e.id = es.entity_id
                   where es.source_id = any(%s) and e.type = 'monument'""",
                (source_ids,),
            ).fetchall()
        weight = Counter()
        for i, p in enumerate(passages):  # earlier (closer) passages count more
            for l in links:
                if l["source_id"] == p["source_id"]:
                    weight[l["entity_id"]] += MAX_PASSAGES - i
        ids = [eid for eid, _ in weight.most_common(MAX_MONUMENTS)]
    out = []
    with get_conn() as conn:
        for eid in ids:
            d = _entity_detail(conn, eid)
            if d:
                out.append(d)
    return out


def _record_text(d: dict, cite_of: dict[int, int]) -> str:
    """A monument's structured record, with citations pointing at passage numbers where possible."""
    lines = [f"MONUMENT: {d['name']}"]
    for c in d["claims"]:
        if c["status"] == "rejected":
            continue
        n = cite_of.get(c["source"]["id"])
        tag = " VERIFIED" if c["status"] == "verified" else ""
        ref = f" [{n}]" if n else f" (source: {c['source']['filename']})"
        lines.append(f"- {FIELD_LABELS.get(c['field'], c['field'])}: {c['value']}{tag}{ref}")
    for k in d["conflicts"]:
        values = sorted({c["value"] for c in k["claims"]})
        lines.append(f"- SOURCES DISAGREE on {FIELD_LABELS.get(k['field'], k['field'])}: " + " / ".join(values))
    if d["gaps"]:
        lines.append("- NOT YET DOCUMENTED: " + "; ".join(g["label"] for g in d["gaps"]))
    return "\n".join(lines)


def _label(p: dict) -> str:
    if p["origin"] == "web":
        kind = "published reference"
        if p["filename"].startswith("wikidata_"):
            kind += ", Wikidata"
        elif p["filename"].startswith("wikipedia_"):
            kind += ", Wikipedia"
        elif p["filename"].startswith("commons_"):
            kind += ", Wikimedia Commons"
    else:
        kind = "field record"
    return f"{p['filename']} ({kind})"


def clean_citations(answer: str, listed: list, n_passages: int) -> tuple[str, list[int]]:
    """Drop citation marks that point at no passage; return the cleaned answer and the passages used."""
    valid = set(range(1, n_passages + 1))
    text = re.sub(r"\s?\[(\d+)\]", lambda m: m.group(0) if int(m.group(1)) in valid else "", answer or "")
    used = {int(n) for n in re.findall(r"\[(\d+)\]", text)}
    used |= {n for n in (listed or []) if isinstance(n, int) and n in valid}
    return text.strip(), sorted(used)


@router.post("/ask")
def ask(body: AskIn):
    """Answer a question from the archive's own records only, with numbered citations,
    explicit disagreements and an honest list of what isn't recorded yet."""
    question = body.question.strip()
    if not gemini.available():
        raise HTTPException(503, "Answers need the Gemini key, which isn't configured.")
    passages, mode = _passages(question, body.entity_id)
    monuments = _monuments(passages, body.entity_id)
    if not passages and not monuments:
        return {"question": question, "answer": None, "confidence": "low", "citations": [],
                "disagreements": [], "not_recorded": [question], "monuments": [], "mode": mode,
                "message": "The archive has nothing on this yet. Upload a photo, scan or field note to start the record."}

    cite_of = {}
    for i, p in enumerate(passages, 1):
        cite_of.setdefault(p["source_id"], i)
    context = "\n\n".join(f"[{i}] {_label(p)}\n{p['text'][:2000]}" for i, p in enumerate(passages, 1))
    records = "\n\n".join(_record_text(d, cite_of) for d in monuments)
    prompt = f"{INSTRUCTIONS}\nQUESTION: {question}\n\nPASSAGES:\n{context or '(none)'}\n\nMONUMENT RECORDS:\n{records or '(none)'}"
    try:
        out = gemini.generate_json([{"text": prompt}], ANSWER_SCHEMA, temperature=0.1)
    except gemini.GeminiError as e:
        raise HTTPException(502, f"Couldn't write an answer right now: {e}")

    answer, used = clean_citations(out.get("answer") or "", out.get("citations") or [], len(passages))
    return {
        "question": question,
        "answer": answer,
        "confidence": out.get("confidence") or "low",
        "disagreements": out.get("disagreements") or [],
        "not_recorded": out.get("not_recorded") or [],
        "citations": [
            {
                "n": i, "chunk_id": p["chunk_id"], "excerpt": p["text"][:EXCERPT],
                "used": i in used,
                "source": {
                    "id": p["source_id"], "filename": p["filename"], "type": p["type"], "page": p["page"],
                    "file_url": p["file_url"], "origin": p["origin"], "author": p["author"],
                    "licence": p["licence"], "source_url": p["source_url"],
                },
            }
            for i, p in enumerate(passages, 1)
        ],
        "monuments": [
            {"id": d["id"], "name": d["name"], "n_conflicts": len(d["conflicts"]), "n_gaps": len(d["gaps"])}
            for d in monuments
        ],
        "mode": mode,
    }
