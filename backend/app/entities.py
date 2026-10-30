"""API routes for monuments (entities), their claims, conflicts and gaps."""
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, Field

from . import analysis, matching, models3d
from .storage import StorageError, upload_bytes
from .db import get_conn
from .pipeline import reprocess_source
from . import wiki, wikidata

router = APIRouter()

CLAIM_STATUSES = {"unverified", "verified", "rejected"}


def _entity_detail(conn, entity_id: int) -> dict | None:
    ent = conn.execute(
        "select id, name, type, lat, lng, coord_precision from entities where id = %s", (entity_id,)
    ).fetchone()
    if not ent:
        return None
    ent["category"] = models3d.category_for(ent["name"])
    if ent["lat"] is not None and not ent["coord_precision"]:
        ent["coord_precision"] = "exact"
    models = conn.execute(
        """select id, provider, uid, url, title, author, author_url, licence
           from models where entity_id = %s order by id""",
        (entity_id,),
    ).fetchall()
    aliases = conn.execute(
        "select alias, language from entity_aliases where entity_id = %s and alias <> %s order by language, alias",
        (entity_id, ent["name"]),
    ).fetchall()
    rows = conn.execute(
        """select c.id, c.field, c.value, c.method, c.confidence, c.status, c.quote,
                  ch.text as chunk_text, s.id as source_id, s.filename, s.file_url, ch.page,
                  s.origin, s.source_url
           from claims c join sources s on s.id = c.source_id
           left join chunks ch on ch.id = c.chunk_id
           where c.entity_id = %s order by c.field, c.id""",
        (entity_id,),
    ).fetchall()
    claims = [
        {
            "id": r["id"], "field": r["field"], "value": r["value"], "method": r["method"],
            "confidence": r["confidence"], "status": r["status"],
            "source": {"id": r["source_id"], "filename": r["filename"], "page": r["page"], "file_url": r["file_url"],
                       "origin": r["origin"], "source_url": r["source_url"]},
            "evidence_text": r["quote"] or r["chunk_text"],
        }
        for r in rows
    ]
    sources = conn.execute(
        """select s.id, s.filename, s.type, es.tag, s.file_url, s.lat, s.lng, s.description, s.status,
                  s.origin, s.author, s.licence, s.source_url
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
        "models": models,
    }


def _all_details(conn, etype: str | None) -> list[dict]:
    """Claims, sources, conflicts and gaps for many entities in 4 queries in total
    (instead of 4 per entity), so the map and the priorities page stay fast as the archive grows."""
    ents = conn.execute(
        "select id, name, type, lat, lng, coord_precision from entities where (%s::text is null or type = %s) order by name",
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
        """select es.entity_id, es.source_id, es.tag, s.type, s.origin
           from entity_sources es join sources s on s.id = es.source_id where es.entity_id = any(%s)""", (ids,)
    ).fetchall():
        sources_by[r["entity_id"]].append({"id": r["source_id"], "tag": r["tag"], "type": r["type"], "origin": r["origin"]})
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
            "category": models3d.category_for(d["name"]),
            "coord_precision": d["coord_precision"] or ("exact" if d["lat"] is not None else None),
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
    "purpose": "purpose", "inscription": "inscription", "heritage_status": "heritage status",
}


def build_todo(detail: dict) -> list[dict]:
    """What a fellow should do at this monument on the next field visit:
    document every missing checklist item, add the archive's own record where only published
    material exists, and check on site every disagreement."""
    todo = [{"kind": "document", "item": g["required_item"], "text": g["label"]} for g in detail["gaps"]]
    sources = detail.get("sources", [])
    photos = [s for s in sources if s.get("type") == "photo"]
    if photos and all(s.get("origin") == "web" for s in photos):
        todo.append({"kind": "document", "item": "own_photo",
                     "text": "Only a published photo so far: take our own photographs"})
    if sources and all(s.get("origin") == "web" for s in sources):
        todo.append({"kind": "document", "item": "field_record",
                     "text": "No field record yet, only published references: write field notes on site"})
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
    coord_precision: str | None = None


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
        if body.coord_precision is not None:
            if body.coord_precision not in ("exact", "approximate"):
                raise HTTPException(400, "coord_precision must be exact or approximate.")
            conn.execute("update entities set coord_precision = %s where id = %s", (body.coord_precision, entity_id))
        matching.relink_unlinked_photos(conn)
        return _entity_detail(conn, entity_id)


MODEL_FIELDS = "id, provider, uid, url, title, author, author_url, licence"


@router.post("/entities/{entity_id}/models", status_code=201)
async def add_model(entity_id: int, request: Request):
    """Attach a 3D model to a monument: JSON {"sketchfab_url": "..."} or a multipart field "file" (.glb/.gltf)."""
    with get_conn() as conn:
        if not conn.execute("select 1 from entities where id = %s", (entity_id,)).fetchone():
            raise HTTPException(404, "Monument not found.")

    if request.headers.get("content-type", "").startswith("multipart/"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(400, "Send the model in a form field called 'file'.")
        name = upload.filename or "model.glb"
        if not name.lower().endswith(models3d.ALLOWED_MODEL_FILES):
            raise HTTPException(400, "Only .glb or .gltf 3D files are accepted.")
        data = await upload.read()
        if not data:
            raise HTTPException(400, "That file is empty.")
        if len(data) > models3d.MAX_MODEL_BYTES:
            raise HTTPException(413, "3D files can be at most 50 MB.")
        mime = "model/gltf-binary" if name.lower().endswith(".glb") else "model/gltf+json"
        try:
            url = upload_bytes(data, name, mime)
        except StorageError as e:
            raise HTTPException(502, f"Couldn't store the file: {e}")
        title = str(form.get("title") or name.rsplit(".", 1)[0]).strip()[:200]
        row = ("file", None, url, title, form.get("author") or None, None, form.get("licence") or None)
    else:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, 'Send JSON like {"sketchfab_url": "https://sketchfab.com/3d-models/..."} or a .glb file.')
        try:
            uid = models3d.sketchfab_uid(str((body or {}).get("sketchfab_url", "")))
            info = models3d.sketchfab_info(uid)
        except models3d.ModelError as e:
            raise HTTPException(400, str(e))
        row = ("sketchfab", uid, None, info["title"], info["author"], info["author_url"], info["licence"])

    with get_conn() as conn:
        model = conn.execute(
            f"""insert into models (entity_id, provider, uid, url, title, author, author_url, licence)
                values (%s, %s, %s, %s, %s, %s, %s, %s) returning {MODEL_FIELDS}""",
            (entity_id, *row),
        ).fetchone()
    return model


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


class WikidataImport(BaseModel):
    entity_ids: list[int] | None = None   # default: every monument with an imported Wikipedia article
    photos: bool = True                   # also import the item's main photo from Wikimedia Commons


def _import_wikidata_all(entity_ids: list[int], photos: bool) -> None:
    for eid in entity_ids:
        try:
            result = wikidata.import_monument(eid, photos=photos)
            wikidata.log.info("Wikidata import for monument %s: %s", eid, result)
        except Exception:  # one failed item must not stop the rest
            wikidata.log.exception("Wikidata import failed for monument %s", eid)


@router.post("/import/wikidata", status_code=202)
def import_wikidata(body: WikidataImport, background: BackgroundTasks):
    """Structured facts from Wikidata (built date, architect / patron, heritage status, style, material,
    coordinates) and the item's main photo from Wikimedia Commons, for monuments that have an imported
    English Wikipedia article. Facts are stored as an attributed source (CC0) and quoted line by line;
    photos keep their author and licence and go through the normal photo pipeline."""
    with get_conn() as conn:
        rows = conn.execute(
            """select distinct e.id from entities e join sources s on s.entity_id = e.id
               where e.type = 'monument' and s.type = 'web' and s.source_url like 'https://en.wikipedia.org/%%'
               and (%s::bigint[] is null or e.id = any(%s::bigint[])) order by e.id""",
            (body.entity_ids, body.entity_ids),
        ).fetchall()
    ids = [r["id"] for r in rows]
    if not ids:
        raise HTTPException(400, "None of those monuments has an imported English Wikipedia article.")
    background.add_task(_import_wikidata_all, ids, body.photos)
    return {"queued": ids}


@router.post("/admin/reprocess", status_code=202)
def reprocess_all(background: BackgroundTasks):
    """Run the full pipeline again on every stored file (one at a time)."""
    with get_conn() as conn:
        ids = [r["id"] for r in conn.execute("select id from sources where file_url is not null order by id").fetchall()]
        conn.execute("update sources set status = 'pending' where file_url is not null")
    for sid in ids:
        background.add_task(reprocess_source, sid)
    return {"queued": len(ids)}
