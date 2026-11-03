"""'Same place?': finds monuments recorded twice under different names, and merges them on request.

Fieldwork from different teams names one place many ways ("Ambaji" / "Ambaji Mata Temple").
The matcher joins obvious spellings automatically; the doubtful ones are left for a person to decide
here, because merging two different places would mix their evidence. A "different places" answer
is remembered, so the same pair is not suggested again.
"""
from difflib import SequenceMatcher
from itertools import combinations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import matching, models3d
from .accounts import require_user
from .db import get_conn

router = APIRouter()

NAME_RATIO = 0.85
NEAR_KM = 0.3
FAR_KM = 5.0


def _core(key: str) -> str:
    """The distinctive part of a name key: 'somnath mandir' -> 'somnath'."""
    return " ".join(w for w in key.split() if w not in matching.GENERIC_WORDS)


def compare(a: dict, b: dict) -> tuple[float, list[str]] | None:
    """How likely two monuments are the same place, with the reasons. None = clearly different."""
    ca, cb = models3d.category_for(a["name"]), models3d.category_for(b["name"])
    if ca != cb and "site" not in (ca, cb):
        return None  # a cave and a fort at the same hill are two structures, not one
    if (a.get("nature") or "built") != (b.get("nature") or "built"):
        return None  # a town and its fort, or a lake and a temple on its shore, are not one place
    both_exact = all(x["lat"] is not None and x.get("coord_precision") != "approximate" for x in (a, b))
    km = matching.distance_km(a["lat"], a["lng"], b["lat"], b["lng"]) if both_exact else None
    if km is not None and km > FAR_KM:
        return None
    # Compare the distinctive words only: "Somnath Temple" and "Neminath temple" share just "-nath temple"
    cores = [(x, y) for x in {_core(k) for k in a["keys"]} for y in {_core(k) for k in b["keys"]} if x and y]
    ratio = max((SequenceMatcher(None, x, y).ratio() for x, y in cores), default=0)
    contains = any(set(x.split()) <= set(y.split()) or set(y.split()) <= set(x.split()) for x, y in cores)
    reasons, score = [], 0.0
    if ratio >= NAME_RATIO:
        score += ratio
        reasons.append("Same name" if ratio == 1 else f"Names are {round(ratio * 100)}% alike")
    elif contains:
        score += 0.6
        reasons.append("One name contains the other")
    if km is not None and km <= NEAR_KM:
        score += 0.5
        reasons.append(f"Pinned {round(km * 1000)} m apart")
    if not reasons or score < 0.6:
        return None
    return round(score, 2), reasons


@router.get("/duplicates")
def duplicates(limit: int = 30):
    """Pairs of monuments that may be the same place, most likely first."""
    with get_conn() as conn:
        ents = [e for e in matching._all_entities(conn) if e["type"] == "monument"]
        extra = {r["id"]: r for r in conn.execute(
            "select id, coord_precision, nature from entities where type = 'monument'").fetchall()}
        counts = {r["id"]: r for r in conn.execute(
            """select e.id,
                      (select count(*) from entity_sources es where es.entity_id = e.id) as n_sources,
                      (select count(*) from claims c where c.entity_id = e.id and c.status <> 'rejected') as n_claims
               from entities e where e.type = 'monument'""").fetchall()}
        dismissed = {(r["a"], r["b"]) for r in conn.execute("select a, b from entity_not_same").fetchall()}
    for e in ents:
        e["coord_precision"] = (extra.get(e["id"]) or {}).get("coord_precision")
        e["nature"] = (extra.get(e["id"]) or {}).get("nature")
    pairs = []
    for a, b in combinations(ents, 2):
        if (min(a["id"], b["id"]), max(a["id"], b["id"])) in dismissed:
            continue
        found = compare(a, b)
        if found:
            score, reasons = found
            pairs.append({"score": score, "reasons": reasons, "a": _side(a, counts), "b": _side(b, counts)})
    pairs.sort(key=lambda p: -p["score"])
    return {"pairs": pairs[: max(1, min(limit, 100))], "total": len(pairs)}


def _side(e: dict, counts: dict) -> dict:
    c = counts.get(e["id"]) or {}
    return {
        "id": e["id"], "name": e["name"], "aliases": [a for a in e["aliases"] if a != e["name"]][:5],
        "lat": e["lat"], "lng": e["lng"], "category": models3d.category_for(e["name"]),
        "n_sources": c.get("n_sources", 0), "n_claims": c.get("n_claims", 0),
    }


class MergeIn(BaseModel):
    duplicate_id: int


def merge_into(conn, keep: int, dup: int) -> None:
    """Move everything recorded for `dup` onto `keep`, then remove `dup`. Its name becomes an alias."""
    conn.execute("update claims set entity_id = %s where entity_id = %s", (keep, dup))
    conn.execute(
        """insert into entity_sources (entity_id, source_id, tag)
           select %s, source_id, tag from entity_sources where entity_id = %s
           on conflict (entity_id, source_id) do nothing""", (keep, dup))
    conn.execute(
        """insert into entity_aliases (entity_id, alias, language)
           select %s, alias, language from entity_aliases where entity_id = %s
           on conflict (entity_id, alias) do nothing""", (keep, dup))
    conn.execute(
        """insert into entity_aliases (entity_id, alias, language)
           select %s, name, 'en' from entities where id = %s on conflict (entity_id, alias) do nothing""", (keep, dup))
    conn.execute(
        """update entities k set lat = d.lat, lng = d.lng, coord_precision = d.coord_precision
           from entities d where k.id = %s and d.id = %s and k.lat is null and d.lat is not null""", (keep, dup))
    conn.execute("update models set entity_id = %s where entity_id = %s", (keep, dup))
    conn.execute("update sources set entity_id = %s where entity_id = %s", (keep, dup))
    conn.execute("delete from entities where id = %s", (dup,))


@router.post("/entities/{keep_id}/merge", dependencies=[Depends(require_user)])  # merging deletes a record: signed-in people only
def merge(keep_id: int, body: MergeIn):
    """Same place: keep `keep_id`, fold the duplicate into it (facts, files, aliases, models, location)."""
    if keep_id == body.duplicate_id:
        raise HTTPException(400, "A monument can't be merged into itself.")
    with get_conn() as conn:
        found = conn.execute(
            "select id, name from entities where id = any(%s) and type = 'monument'",
            ([keep_id, body.duplicate_id],),
        ).fetchall()
        if len(found) != 2:
            raise HTTPException(404, "One of those monuments doesn't exist (it may have been merged already).")
        merge_into(conn, keep_id, body.duplicate_id)
        kept = conn.execute("select id, name from entities where id = %s", (keep_id,)).fetchone()
    return {"kept": kept, "merged": body.duplicate_id}


class NotSameIn(BaseModel):
    a: int
    b: int


@router.post("/duplicates/dismiss")
def dismiss(body: NotSameIn):
    """Different places: remember it, so the pair isn't suggested again."""
    a, b = sorted((body.a, body.b))
    if a == b:
        raise HTTPException(400, "Pick two different monuments.")
    with get_conn() as conn:
        conn.execute("insert into entity_not_same (a, b) values (%s, %s) on conflict do nothing", (a, b))
    return {"a": a, "b": b, "same": False}
