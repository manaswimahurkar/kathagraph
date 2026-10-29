"""API routes for monuments (entities), their claims, conflicts and gaps."""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from . import analysis, matching
from .db import get_conn
from .pipeline import reprocess_source
from . import wiki

router = APIRouter()

CLAIM_STATUSES = {"unverified", "verified", "rejected"}


def _entity_detail(conn, entity_id: int) -> dict | None:
    ent = conn.execute("select id, name, type, lat, lng from entities where id = %s", (entity_id,)).fetchone()
    if not ent:
        return None
    aliases = conn.execute(
        "select alias, language from entity_aliases where entity_id = %s and alias <> %s order by language, alias",
        (entity_id, ent["name"]),
    ).fetchall()
    rows = conn.execute(
        """select c.id, c.field, c.value, c.method, c.confidence, c.status, c.quote,
                  ch.text as chunk_text, s.id as source_id, s.filename, s.file_url, ch.page
           from claims c join sources s on s.id = c.source_id
           left join chunks ch on ch.id = c.chunk_id
           where c.entity_id = %s order by c.field, c.id""",
        (entity_id,),
    ).fetchall()
    claims = [
        {
            "id": r["id"], "field": r["field"], "value": r["value"], "method": r["method"],
            "confidence": r["confidence"], "status": r["status"],
            "source": {"id": r["source_id"], "filename": r["filename"], "page": r["page"], "file_url": r["file_url"]},
            "evidence_text": r["quote"] or r["chunk_text"],
        }
        for r in rows
    ]
    sources = conn.execute(
        """select s.id, s.filename, s.type, es.tag, s.file_url, s.lat, s.lng, s.description, s.status
           from entity_sources es join sources s on s.id = es.source_id
           where es.entity_id = %s order by s.type, s.id""",
        (entity_id,),
    ).fetchall()
    checklist = conn.execute(
        "select required_item, label from checklist_items where entity_type = %s order by id", (ent["type"],)
    ).fetchall()
    return {
        **ent,
        "aliases": aliases,
        "claims": claims,
        "conflicts": analysis.conflicts(claims),
        "gaps": analysis.gaps(checklist, claims, sources, ent["lat"] is not None),
        "sources": sources,
    }


def _all_details(conn, etype: str | None) -> list[dict]:
    """Claims, sources, conflicts and gaps for many entities in 4 queries in total
    (instead of 4 per entity), so the map and the priorities page stay fast as the archive grows."""
    ents = conn.execute(
        "select id, name, type, lat, lng from entities where (%s::text is null or type = %s) order by name",
        (etype, etype),
    ).fetchall()
    if not ents:
        return []
    ids = [e["id"] for e in ents]
    claims_by: dict[int, list] = {i: [] for i in ids}
    for r in conn.execute(
        """select c.id, c.entity_id, c.field, c.value, c.status, s.id as source_id, s.filename
           from claims c join sources s on s.id = c.source_id where c.entity_id = any(%s)""",
        (ids,),
    ).fetchall():
        claims_by[r["entity_id"]].append({
            "id": r["id"], "field": r["field"], "value": r["value"], "status": r["status"],
            "source": {"id": r["source_id"], "filename": r["filename"]},
        })
    sources_by: dict[int, list] = {i: [] for i in ids}
    for r in conn.execute(
        "select es.entity_id, es.source_id, es.tag from entity_sources es where es.entity_id = any(%s)", (ids,)
    ).fetchall():
        sources_by[r["entity_id"]].append({"id": r["source_id"], "tag": r["tag"]})
    checklists: dict[str, list] = {}
    for r in conn.execute("select entity_type, required_item, label from checklist_items order by id").fetchall():
        checklists.setdefault(r["entity_type"], []).append(r)
    out = []
    for e in ents:
        claims, sources = claims_by[e["id"]], sources_by[e["id"]]
        out.append({
            **e, "claims": claims, "sources": sources,
            "conflicts": analysis.conflicts(claims),
            "gaps": analysis.gaps(checklists.get(e["type"], []), claims, sources, e["lat"] is not None),
        })
    return out


@router.get("/entities")
def list_entities(type: str | None = None):
    with get_conn() as conn:
        details = _all_details(conn, type)
    return {"entities": [
        {
            "id": d["id"], "name": d["name"], "type": d["type"], "lat": d["lat"], "lng": d["lng"],
            "n_sources": len(d["sources"]), "n_claims": len(d["claims"]),
            "n_conflicts": len(d["conflicts"]), "n_gaps": len(d["gaps"]),
        }
        for d in details
    ]}


@router.get("/entities/{entity_id}")
def get_entity(entity_id: int):
    with get_conn() as conn:
        d = _entity_detail(conn, entity_id)
    if not d:
        raise HTTPException(404, "Monument not found.")
    return d


FIELD_LABELS = {
    "built_date": "date of construction", "builder": "builder / patron", "dynasty": "dynasty",
    "location": "location", "architectural_style": "architectural style", "material": "material",
    "purpose": "purpose", "inscription": "inscription",
}


def build_todo(detail: dict) -> list[dict]:
    """What a fellow should do at this monument on the next field visit:
    document every missing checklist item, and check on site every disagreement."""
    todo = [{"kind": "document", "item": g["required_item"], "text": g["label"]} for g in detail["gaps"]]
    for c in detail["conflicts"]:
        values = list(dict.fromkeys(k["value"] for k in c["claims"]))
        label = FIELD_LABELS.get(c["field"], c["field"].replace("_", " "))
        todo.append({
            "kind": "verify", "item": c["field"],
            "text": f"Check the {label} on site: sources say " + " / ".join(values),
        })
    return todo


@router.get("/priorities")
def priorities(limit: int = 100):
    """The archive as a to-do list: monuments ranked by how much fieldwork they still need
    (missing documentation first, then unresolved disagreements, then fewest sources)."""
    limit = max(1, min(limit, 200))
    with get_conn() as conn:
        details = _all_details(conn, "monument")
    rows = [
        {
            "id": d["id"], "name": d["name"], "lat": d["lat"], "lng": d["lng"],
            "n_sources": len(d["sources"]), "n_gaps": len(d["gaps"]), "n_conflicts": len(d["conflicts"]),
            "todo": build_todo(d),
        }
        for d in details
    ]
    rows.sort(key=lambda x: (-x["n_gaps"], -x["n_conflicts"], x["n_sources"], x["name"]))
    return {
        "monuments": rows[:limit],
        "totals": {
            "monuments": len(rows),
            "missing_items": sum(x["n_gaps"] for x in rows),
            "disagreements": sum(x["n_conflicts"] for x in rows),
        },
    }


class EntityIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str = "monument"
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    aliases: list[str] = []


@router.post("/entities", status_code=201)
def create_entity(body: EntityIn):
    """Register a monument by hand (e.g. with its known location)."""
    if body.type not in {"monument", "motif", "craft", "place", "person"}:
        raise HTTPException(400, "Unknown entity type.")
    with get_conn() as conn:
        entity_id = matching.get_or_create(conn, body.name.strip(), body.type, body.aliases)
        if body.lat is not None and body.lng is not None:
            conn.execute("update entities set lat = %s, lng = %s where id = %s", (body.lat, body.lng, entity_id))
        matching.relink_unlinked_photos(conn)
        return _entity_detail(conn, entity_id)


class EntityPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


@router.patch("/entities/{entity_id}")
def update_entity(entity_id: int, body: EntityPatch):
    with get_conn() as conn:
        if not conn.execute("select 1 from entities where id = %s", (entity_id,)).fetchone():
            raise HTTPException(404, "Monument not found.")
        if body.name:
            conn.execute("update entities set name = %s where id = %s", (body.name.strip(), entity_id))
            matching.add_aliases(conn, entity_id, [body.name])
        if body.lat is not None and body.lng is not None:
            conn.execute("update entities set lat = %s, lng = %s where id = %s", (body.lat, body.lng, entity_id))
        matching.relink_unlinked_photos(conn)
        return _entity_detail(conn, entity_id)


class ClaimPatch(BaseModel):
    status: str


@router.patch("/claims/{claim_id}")
def update_claim(claim_id: int, body: ClaimPatch):
    """A researcher marks an AI-proposed claim as verified or rejected."""
    if body.status not in CLAIM_STATUSES:
        raise HTTPException(400, "Status must be unverified, verified or rejected.")
    with get_conn() as conn:
        row = conn.execute(
            "update claims set status = %s where id = %s returning id, status", (body.status, claim_id)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Claim not found.")
    return row


@router.post("/sources/{source_id}/reprocess", status_code=202)
def reprocess_one(source_id: int, background: BackgroundTasks):
    with get_conn() as conn:
        if not conn.execute("select 1 from sources where id = %s", (source_id,)).fetchone():
            raise HTTPException(404, "Source not found.")
        conn.execute("update sources set status = 'pending' where id = %s", (source_id,))
    background.add_task(reprocess_source, source_id)
    return {"id": source_id, "status": "pending"}


class WikiImport(BaseModel):
    titles: list[str] = Field(min_length=1, max_length=20)
    hindi: bool = True


def _import_all(titles: list[str], hindi: bool) -> None:
    for title in titles:
        try:
            wiki.import_monument(title, hindi)
        except Exception:  # one failed article must not stop the rest
            wiki.log.exception("Wikipedia import failed for %r", title)


@router.post("/import/wikipedia", status_code=202)
def import_wikipedia(body: WikiImport, background: BackgroundTasks):
    """Import published reference text (English + Hindi Wikipedia) for monuments by article title.
    Each article is stored with its attribution and licence, processed like any upload,
    and linked to its monument; the article's coordinates place the monument on the map."""
    titles = [t.strip() for t in body.titles if t.strip()]
    if not titles:
        raise HTTPException(400, "Give at least one article title.")
    background.add_task(_import_all, titles, body.hindi)
    return {"queued": titles}


@router.post("/admin/reprocess", status_code=202)
def reprocess_all(background: BackgroundTasks):
    """Run the full pipeline again on every stored file (one at a time)."""
    with get_conn() as conn:
        ids = [r["id"] for r in conn.execute("select id from sources where file_url is not null order by id").fetchall()]
        conn.execute("update sources set status = 'pending' where file_url is not null")
    for sid in ids:
        background.add_task(reprocess_source, sid)
    return {"queued": len(ids)}
