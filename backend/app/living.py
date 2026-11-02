"""Living heritage and space: the parts of the archive that are not a single monument record.

- /stories: legends and oral traditions found in the archive's texts, each placed on the map.
- /journeys: heritage trails (monuments of one kind, in walking order) and the routes field teams
  actually travelled, rebuilt from their photos' GPS and time stamps.
- /crafts: crafts and living traditions as records of their own: technique, practitioners,
  material, and every place the archive documents them.
- /entities/{id}/twin and /photo-bundle: how ready a monument's photos are for a 3D digital twin
  (where they were taken from, which sides are missing) and a photogrammetry-ready download.
"""
import csv
import io
import logging
import math
import re
import tempfile
import zipfile
from collections import defaultdict
from datetime import timedelta

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from . import claims, gemini, models3d, places, text_extract
from .db import get_conn
from .security import require_admin
from .matching import distance_km

log = logging.getLogger("kathagraph.living")
router = APIRouter()


# ---------- shared geometry ----------

SECTORS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]


def bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Compass bearing in degrees from point 1 to point 2."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def sector(deg: float) -> int:
    return int(((deg % 360) + 22.5) // 45) % 8


def order_by_nearest(points: list[dict]) -> list[dict]:
    """A short walking/driving order through points: start at the westernmost, then always the nearest."""
    if len(points) < 3:
        return sorted(points, key=lambda p: p["lng"])
    rest = sorted(points, key=lambda p: p["lng"])
    route = [rest.pop(0)]
    while rest:
        last = route[-1]
        nxt = min(rest, key=lambda p: distance_km(last["lat"], last["lng"], p["lat"], p["lng"]))
        rest.remove(nxt)
        route.append(nxt)
    return route


def route_km(points: list[dict]) -> float:
    return round(sum(distance_km(a["lat"], a["lng"], b["lat"], b["lng"]) for a, b in zip(points, points[1:])), 1)


# ---------- stories ----------

@router.get("/stories")
def stories():
    """Every legend in the archive, with the words it came from and where it belongs on the map."""
    with get_conn() as conn:
        rows = conn.execute(
            """select c.id, c.value, c.quote, c.confidence, c.status, c.method,
                      e.id as entity_id, e.name as entity_name, e.type as entity_type, e.lat, e.lng,
                      s.id as source_id, s.filename, s.origin, s.author, s.source_url, s.file_url
               from claims c join entities e on e.id = c.entity_id join sources s on s.id = c.source_id
               where c.field = 'legend' and c.status <> 'rejected'
               order by e.name, c.id"""
        ).fetchall()
        thumbs = {r["entity_id"]: r for r in conn.execute(
            """select distinct on (es.entity_id) es.entity_id, s.file_url, s.author, s.licence
               from entity_sources es join sources s on s.id = es.source_id
               where s.type = 'photo' and s.status = 'done' and s.file_url is not null
               order by es.entity_id, (coalesce(es.tag, s.tag) = 'exterior_photo') desc, s.id""").fetchall()}
    out = []
    for r in rows:
        lat, lng, precision = r["lat"], r["lng"], "exact"
        if lat is None:
            found = places.find_places(f"{r['entity_name']} {r['value']}")
            if found:
                lat, lng, precision = found[0]["lat"], found[0]["lng"], "approximate"
        out.append({
            "id": r["id"], "story": r["value"], "quote": r["quote"], "confidence": r["confidence"],
            "status": r["status"], "method": r["method"],
            "entity": {"id": r["entity_id"], "name": r["entity_name"], "type": r["entity_type"],
                       "category": models3d.category_for(r["entity_name"])},
            "lat": lat, "lng": lng, "precision": precision if lat is not None else None,
            "photo": ({"url": thumbs[r["entity_id"]]["file_url"], "author": thumbs[r["entity_id"]]["author"],
                       "licence": thumbs[r["entity_id"]]["licence"]} if r["entity_id"] in thumbs else None),
            "source": {"id": r["source_id"], "filename": r["filename"], "origin": r["origin"],
                       "author": r["author"], "url": r["source_url"] or r["file_url"]},
        })
    return {"stories": out, "places": len({(s["lat"], s["lng"]) for s in out if s["lat"] is not None})}


def extract_stories_backfill() -> None:
    """Read every stored text once more, for legends and crafts only (older uploads predate them)."""
    from .pipeline import _save_claims  # late import: pipeline imports a lot
    with get_conn() as conn:
        ids = [r["id"] for r in conn.execute(
            """select s.id from sources s
               where s.status = 'done' and not s.stories_checked and s.type in ('pdf','note','web','doc','slides','csv')
                 and exists (select 1 from chunks c where c.source_id = s.id and c.text not like '[AI%%')
               order by s.id"""
        ).fetchall()]
    for sid in ids:
        try:
            with get_conn() as conn:
                src = conn.execute("select filename from sources where id = %s", (sid,)).fetchone()
                rows = conn.execute(
                    "select id, page, text from chunks where source_id = %s and text not like '[AI%%' order by page nulls first, id",
                    (sid,)).fetchall()
            pages: dict[int, list[str]] = defaultdict(list)
            for r in rows:
                pages[r["page"] or 0].append(r["text"])
            text = "\n\n".join(text_extract.stitch(p) for p in pages.values())
            found = claims.extract(text, src["filename"], stories_only=True)
            if found:
                _save_claims(sid, found, [(r["id"], r["text"]) for r in rows])
            with get_conn() as conn:
                conn.execute("update sources set stories_checked = true where id = %s", (sid,))
            log.info("Stories pass on source %s: %d entit(ies)", sid, len(found))
        except gemini.GeminiError as e:
            log.warning("Stories pass on source %s failed: %s", sid, e)
        except Exception:
            log.exception("Stories pass on source %s failed", sid)


@router.post("/admin/extract-stories", status_code=202, dependencies=[Depends(require_admin)])
def extract_stories(background: BackgroundTasks, recheck_crafts: bool = False):
    """Find legends and crafts in every text already in the archive (each file is read once).
    recheck_crafts: also read again the articles imported for crafts, for technique, makers and places."""
    if not gemini.available():
        raise HTTPException(503, "The AI service is not configured.")
    if recheck_crafts:
        with get_conn() as conn:
            conn.execute("""update sources set stories_checked = false
                            where entity_id in (select id from entities where type = 'craft')""")
    background.add_task(extract_stories_backfill)
    return {"queued": True}


# ---------- journeys ----------

TRAIL_NAMES = {
    "stepwell": "The stepwell trail", "temple": "Temples of Gujarat", "mosque": "Indo-Islamic Gujarat",
    "fort": "Forts and gateways", "tomb": "Tombs and dargahs", "cave": "Caves and stupas",
    "palace": "Palaces", "lake": "Lakes and kunds", "museum": "Museums and memorials", "site": "Archaeological sites",
}
GAP = timedelta(days=5)


def split_trips(points: list[dict], gap: timedelta = GAP) -> list[list[dict]]:
    """Time-ordered points split wherever the team stopped for more than `gap`."""
    pts = sorted(points, key=lambda p: p["at"])
    trips: list[list[dict]] = []
    for p in pts:
        if trips and p["at"] - trips[-1][-1]["at"] <= gap:
            trips[-1].append(p)
        else:
            trips.append([p])
    return trips


@router.get("/journeys")
def journeys():
    with get_conn() as conn:
        ents = conn.execute(
            """select e.id, e.name, e.lat, e.lng, e.coord_precision,
                      (select count(*) from entity_sources es where es.entity_id = e.id) as n_sources
               from entities e where e.type = 'monument' and e.lat is not null"""
        ).fetchall()
        photos = conn.execute(
            """select s.id, s.filename, s.file_url, s.author, s.origin, s.created_at,
                      coalesce(s.lat, e.lat) as lat, coalesce(s.lng, e.lng) as lng,
                      coalesce(s.captured_at, s.created_at) as at, s.captured_at is not null as timed,
                      e.id as entity_id, e.name as entity_name
               from sources s
               left join lateral (select en.id, en.name, en.lat, en.lng from entity_sources es
                                  join entities en on en.id = es.entity_id
                                  where es.source_id = s.id and en.type = 'monument' limit 1) e on true
               where s.type = 'photo' and s.origin = 'field' and s.status = 'done'
                 and coalesce(s.lat, e.lat) is not null"""
        ).fetchall()

    # Heritage trails: every mapped monument of one kind, in a sensible visiting order
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for e in ents:
        by_cat[models3d.category_for(e["name"])].append(
            {"id": e["id"], "name": e["name"], "lat": e["lat"], "lng": e["lng"], "n_sources": e["n_sources"]})
    trails = []
    for cat, pts in by_cat.items():
        if len(pts) < 2:
            continue
        stops = order_by_nearest(pts)
        trails.append({"id": f"trail-{cat}", "kind": "trail", "category": cat,
                       "title": TRAIL_NAMES.get(cat, cat.title()), "stops": stops, "km": route_km(stops)})
    trails.sort(key=lambda t: -len(t["stops"]))

    # Field journeys: each team's photos in the order they were taken
    by_team: dict[str, list[dict]] = defaultdict(list)
    for p in photos:
        by_team[p["author"] or "Unattributed field team"].append(dict(p))
    field = []
    for team, pts in by_team.items():
        for n, trip in enumerate(split_trips(pts), 1):
            stops: list[dict] = []
            for p in trip:  # one stop per place visited, in order
                key = p["entity_id"] or (round(p["lat"], 3), round(p["lng"], 3))
                if stops and stops[-1]["key"] == key:
                    stops[-1]["photos"] += 1
                    continue
                stops.append({"key": key, "id": p["entity_id"], "name": p["entity_name"] or p["filename"],
                              "lat": p["lat"], "lng": p["lng"], "at": p["at"].isoformat(), "photos": 1,
                              "timed": p["timed"], "thumb": p["file_url"]})
            if len(stops) < 2:
                continue
            for s in stops:
                s.pop("key")
            field.append({"id": f"field-{len(field) + 1}", "kind": "field", "title": f"{team} · trip {n}" if n > 1 else team,
                          "team": team, "start": trip[0]["at"].isoformat(), "end": trip[-1]["at"].isoformat(),
                          "timed": all(p["timed"] for p in trip), "stops": stops, "km": route_km(stops),
                          "photos": len(trip)})
    return {"trails": trails, "field": field}


# ---------- crafts ----------

@router.get("/crafts")
def crafts():
    with get_conn() as conn:
        ents = conn.execute("select id, name, lat, lng from entities where type = 'craft' order by name").fetchall()
        if not ents:
            return {"crafts": []}
        ids = [e["id"] for e in ents]
        facts = conn.execute(
            """select c.entity_id, c.field, c.value, c.quote, c.status, c.confidence, c.source_id, s.filename, s.origin
               from claims c join sources s on s.id = c.source_id
               where c.entity_id = any(%s) and c.status <> 'rejected' order by c.confidence desc nulls last""",
            (ids,)).fetchall()
        aliases = conn.execute("select entity_id, alias from entity_aliases where entity_id = any(%s)", (ids,)).fetchall()
        # Monuments recorded in the same files as the craft, and field photos of the craft with GPS
        nearby = conn.execute(
            """select distinct es1.entity_id as craft_id, e.id, e.name, e.lat, e.lng
               from entity_sources es1 join entity_sources es2 on es2.source_id = es1.source_id
               join entities e on e.id = es2.entity_id
               where es1.entity_id = any(%s) and e.type in ('monument','place') and e.id <> es1.entity_id and e.lat is not null""",
            (ids,)).fetchall()
        photos = conn.execute(
            """select es.entity_id, s.id, s.file_url, s.lat, s.lng, s.author, s.licence, s.origin
               from entity_sources es join sources s on s.id = es.source_id
               where es.entity_id = any(%s) and s.type = 'photo' and s.status = 'done' order by s.id""",
            (ids,)).fetchall()
        sources = conn.execute(
            "select entity_id, count(*) as n from entity_sources where entity_id = any(%s) group by entity_id", (ids,)).fetchall()
        # The places each craft's own documents name (its Wikipedia article, field notes about it)
        texts = conn.execute(
            """select es.entity_id, s.filename, string_agg(ch.text, ' ') as text
               from entity_sources es join sources s on s.id = es.source_id join chunks ch on ch.source_id = s.id
               where es.entity_id = any(%s) and s.type <> 'photo' and ch.text not like '[AI%%' and ch.language = 'en'
               group by es.entity_id, s.filename""", (ids,)).fetchall()
    n_sources = {r["entity_id"]: r["n"] for r in sources}
    named: dict[int, list[dict]] = defaultdict(list)
    for t in texts:
        for p in places.find_places(t["text"])[:8]:
            named[t["entity_id"]].append({**p, "how": f"named in “{t['filename']}”"})
    out = []
    for e in ents:
        # English sources first, so the record reads in one language; other languages fill the gaps
        f = sorted((x for x in facts if x["entity_id"] == e["id"]), key=lambda x: "_en_" not in x["filename"])
        by_field: dict[str, list[dict]] = defaultdict(list)
        for x in f:
            if len(by_field[x["field"]]) < 3 and all(y["value"].lower() != x["value"].lower() for y in by_field[x["field"]]):
                by_field[x["field"]].append({"value": x["value"], "quote": x["quote"], "status": x["status"],
                                             "source_id": x["source_id"], "filename": x["filename"]})
        where: list[dict] = []
        if e["lat"] is not None:
            where.append({"name": e["name"], "lat": e["lat"], "lng": e["lng"], "how": "recorded location", "precision": "exact"})
        for x in by_field.get("location", []):
            for p in places.find_places(x["value"]):
                where.append({**p, "how": f"named in “{x['filename']}”"})
        where.extend(named.get(e["id"], []))
        for p in photos:
            if p["entity_id"] == e["id"] and p["lat"] is not None:
                where.append({"name": "Field photo", "lat": p["lat"], "lng": p["lng"], "how": "photo GPS", "precision": "exact"})
        for m in nearby:
            if m["craft_id"] == e["id"]:
                where.append({"name": m["name"], "lat": m["lat"], "lng": m["lng"], "how": "recorded with this monument",
                              "precision": "approximate", "entity_id": m["id"]})
        seen, uniq = set(), []
        for w in where:
            k = (round(w["lat"], 2), round(w["lng"], 2))
            if k not in seen:
                seen.add(k)
                uniq.append(w)
        out.append({
            "id": e["id"], "name": e["name"],
            "aliases": sorted({a["alias"] for a in aliases if a["entity_id"] == e["id"] and a["alias"] != e["name"]}),
            "facts": by_field, "places": uniq, "n_sources": n_sources.get(e["id"], 0),
            "photos": [{"url": p["file_url"], "author": p["author"], "licence": p["licence"]}
                       for p in photos if p["entity_id"] == e["id"] and p["file_url"]][:6],
            "missing": [lbl for fld, lbl in [("technique", "how it is made"), ("practitioners", "who practises it"),
                                              ("material", "materials"), ("location", "where it is practised")]
                        if fld not in by_field] + ([] if any(p["entity_id"] == e["id"] for p in photos) else ["photos"]),
        })
    return {"crafts": out}


# ---------- 3D digital twin readiness ----------

TARGET_PHOTOS = 40        # a typical minimum for a usable photogrammetry model of a small structure
PLACED_WITHIN_KM = 1.5    # a photo further than this from the monument is not of it (or its GPS is wrong)


def _heading(exif: dict | None) -> float | None:
    if not isinstance(exif, dict):
        return None
    h = exif.get("GPSImgDirection")
    try:
        h = float(h)
    except (TypeError, ValueError):
        return None
    return h % 360 if 0 <= h <= 360 else None


def twin_report(entity: dict, photos: list[dict], n_models: int) -> dict:
    """Where each photo was taken from, which sides are covered, and what to shoot next."""
    placed, covered, shots = 0, [0] * 8, []
    for p in photos:
        shot = {"id": p["id"], "url": p["file_url"], "tag": p["tag"], "author": p["author"],
                "side": None, "distance_m": None, "heading": _heading(p.get("exif_json"))}
        if entity.get("lat") is not None and p.get("lat") is not None:
            km = distance_km(entity["lat"], entity["lng"], p["lat"], p["lng"])
            if km <= PLACED_WITHIN_KM:
                shot["distance_m"] = round(km * 1000)
                if km > 0.005:  # a camera standing on the pin has no side
                    shot["side"] = sector(bearing(entity["lat"], entity["lng"], p["lat"], p["lng"]))
        if shot["side"] is None and shot["heading"] is not None:
            shot["side"] = sector(shot["heading"] + 180)  # a camera facing north stands on the south side
        if shot["side"] is not None:
            placed += 1
            covered[shot["side"]] += 1
        shots.append(shot)
    n = len(photos)
    kinds = defaultdict(int)
    for p in photos:
        kinds[p["tag"] or "other"] += 1
    sides = sum(1 for c in covered if c)
    score = round(min(1.0, n / TARGET_PHOTOS) * 0.5 + (sides / 8) * 0.35
                  + (0.08 if kinds["interior_photo"] else 0) + (0.07 if kinds["carving_detail"] else 0), 2)
    todo = []
    if n < TARGET_PHOTOS:
        todo.append(f"Take {TARGET_PHOTOS - n} more overlapping photos (each one should share about two-thirds of its view with the last).")
    missing = [SECTORS[i] for i, c in enumerate(covered) if not c]
    if entity.get("lat") is None:
        todo.append("Pin the monument on the map so photos can be placed around it.")
    elif missing and placed:
        todo.append("No photos yet from the " + ", ".join(missing) + " side" + ("s" if len(missing) > 1 else "") + ".")
    elif not placed:
        todo.append("Turn on location in the camera: none of these photos say where they were taken from.")
    if not kinds["interior_photo"]:
        todo.append("Add interior photos so the inside can be modelled too.")
    stage = ("modelled" if n_models else "ready" if n >= TARGET_PHOTOS and sides >= 6
             else "collecting" if n >= 8 else "starting")
    return {"entity": entity, "photos": n, "placed": placed, "coverage": covered, "sides": SECTORS,
            "kinds": dict(kinds), "score": score, "stage": stage, "models": n_models, "todo": todo, "shots": shots,
            "target": TARGET_PHOTOS}


def _twin_rows(entity_id: int):
    with get_conn() as conn:
        ent = conn.execute("select id, name, lat, lng, coord_precision from entities where id = %s", (entity_id,)).fetchone()
        if not ent:
            raise HTTPException(404, "Monument not found.")
        photos = conn.execute(
            """select s.id, s.filename, s.file_url, s.lat, s.lng, s.exif_json, s.captured_at, s.author, s.origin,
                      coalesce(es.tag, s.tag) as tag
               from entity_sources es join sources s on s.id = es.source_id
               where es.entity_id = %s and s.type = 'photo' and s.status = 'done' and s.file_url is not null
               order by s.id""", (entity_id,)).fetchall()
        n_models = conn.execute("select count(*) as n from models where entity_id = %s", (entity_id,)).fetchone()["n"]
    return dict(ent), [dict(p) for p in photos], n_models


@router.get("/entities/{entity_id}/twin")
def twin(entity_id: int):
    ent, photos, n_models = _twin_rows(entity_id)
    return twin_report(ent, photos, n_models)


MAX_BUNDLE_PHOTOS = 60
MAX_BUNDLE_BYTES = 150 * 1024 * 1024


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_")[:80] or "photo"


@router.get("/entities/{entity_id}/photo-bundle")
def photo_bundle(entity_id: int):
    """Every photo of a monument in one zip, with a cameras.csv of positions and headings,
    ready for photogrammetry software (Meshroom, COLMAP, RealityCapture) to build a 3D model."""
    from fastapi.responses import StreamingResponse
    ent, photos, _ = _twin_rows(entity_id)
    if not photos:
        raise HTTPException(404, "This monument has no photos yet.")
    spool = tempfile.SpooledTemporaryFile(max_size=20 * 1024 * 1024)  # spills to disk, so RAM stays low
    rows, total = [], 0
    with zipfile.ZipFile(spool, "w", zipfile.ZIP_STORED) as z, httpx.Client(timeout=30, follow_redirects=True) as http:
        for i, p in enumerate(photos[:MAX_BUNDLE_PHOTOS], 1):
            try:
                r = http.get(p["file_url"])
                r.raise_for_status()
            except httpx.HTTPError as e:
                log.warning("Bundle: photo %s skipped: %s", p["id"], e)
                continue
            if total + len(r.content) > MAX_BUNDLE_BYTES:
                break
            total += len(r.content)
            ext = (p["filename"].rsplit(".", 1)[-1] if "." in p["filename"] else "jpg").lower()
            name = f"{i:03d}_{_safe(p['filename'].rsplit('.', 1)[0])}.{ext}"
            z.writestr(f"images/{name}", r.content)
            rows.append([name, p["lat"], p["lng"], _heading(p["exif_json"]),
                         p["captured_at"].isoformat() if p["captured_at"] else "", p["tag"] or "", p["author"] or "",
                         p["origin"]])
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["image", "latitude", "longitude", "heading_deg", "taken_at", "photo_type", "credit", "origin"])
        w.writerows(rows)
        z.writestr("cameras.csv", buf.getvalue())
        z.writestr("README.txt", (
            f"Photos of {ent['name']} from the KathaGraph archive ({len(rows)} images).\n"
            "To build a 3D model: open the images folder in Meshroom (free) or COLMAP and run the default pipeline.\n"
            "cameras.csv gives each photo's GPS position and compass heading where the camera recorded them;\n"
            "they help the software align photos. Upload the finished .glb on the monument's page.\n"
            "Credit each photographer listed in cameras.csv when you publish the model.\n"))
    spool.seek(0)
    filename = f"{_safe(ent['name'])}_photos.zip"
    return StreamingResponse(iter(lambda: spool.read(1024 * 256), b""), media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
