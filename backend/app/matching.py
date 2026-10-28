"""Decides which monument (entity) a file or a claim belongs to.

Records about the same place arrive under different spellings and scripts
("Adalaj Stepwell", "Adalaj ni Vav", "अडालज की वाव"). Names are reduced to a
key without generic words, then compared against every known name and alias.
Photos with no readable text are linked by filename or by GPS distance.
"""
import math
import re
from difflib import SequenceMatcher
from pathlib import Path

CONNECTORS = {
    "the", "a", "an", "of", "and", "at", "in", "step",
    "ni", "ki", "ka", "ke", "no", "na", "की", "का", "के",
    "img", "image", "photo", "pic", "dsc", "jpg", "jpeg", "png", "file", "wikimedia", "commons",
}
# Different words for the same kind of structure -> one canonical word
SYNONYMS = {
    "stepwell": "vav", "stepwells": "vav", "well": "vav", "vaav": "vav", "baoli": "vav", "bawdi": "vav",
    "baori": "vav", "bawri": "vav", "वाव": "vav", "बावड़ी": "vav", "बावडी": "vav", "बावली": "vav",
    "temple": "mandir", "मंदिर": "mandir",
    "qila": "fort", "killa": "fort", "किला": "fort",
    "palace": "mahal", "महल": "mahal",
    "talav": "lake", "talao": "lake",
}
TYPE_WORDS = {"vav", "mandir", "fort", "mahal", "tank", "kund", "lake"}
MATCH_RATIO = 0.85
GPS_RADIUS_KM = 2.0


def name_key(name: str) -> str:
    """'Adalaj ni Vav' and 'Adalaj Stepwell' -> 'adalaj vav'."""
    words = re.findall(r"[a-z\u0900-\u097f]+", name.lower())
    words = [SYNONYMS.get(w, w) for w in words if w not in CONNECTORS and len(w) > 1]
    return " ".join(dict.fromkeys(words))  # drop repeats, keep order


def core_words(key: str) -> set[str]:
    """The distinctive part of a name, without the structure type: 'adalaj vav' -> {'adalaj'}."""
    return {w for w in key.split() if w not in TYPE_WORDS}


def keys_match(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b or SequenceMatcher(None, a, b).ratio() >= MATCH_RATIO:
        return True
    # 'rani vav' vs 'rani vav patan': same kind of structure, one name contains the other
    wa, wb = set(a.split()), set(b.split())
    same_type = (wa & TYPE_WORDS) == (wb & TYPE_WORDS) and (wa & TYPE_WORDS)
    return bool(same_type and core_words(a) and core_words(b) and (wa <= wb or wb <= wa))


def filename_words(filename: str) -> set[str]:
    stem = Path(filename).stem.replace("_", " ").replace("-", " ").replace(".", " ")
    return set(name_key(stem).split())


def distance_km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _all_entities(conn) -> list[dict]:
    rows = conn.execute(
        """select e.id, e.name, e.type, e.lat, e.lng,
                  coalesce(array_agg(a.alias) filter (where a.alias is not null), '{}') as aliases
           from entities e left join entity_aliases a on a.entity_id = e.id
           group by e.id order by e.id"""
    ).fetchall()
    for r in rows:
        r["keys"] = {k for k in (name_key(n) for n in [r["name"], *r["aliases"]]) if k}
    return rows


def _alias_language(alias: str) -> str:
    return "hi" if re.search(r"[\u0900-\u097f]", alias) else "en"


def add_aliases(conn, entity_id: int, names: list[str]) -> None:
    for alias in {n.strip() for n in names if n and n.strip()}:
        conn.execute(
            "insert into entity_aliases (entity_id, alias, language) values (%s, %s, %s) on conflict do nothing",
            (entity_id, alias, _alias_language(alias)),
        )


def find_entity(conn, name: str, aliases: list[str]) -> int | None:
    wanted = {k for k in (name_key(n) for n in [name, *aliases]) if k}
    for ent in _all_entities(conn):
        if any(keys_match(w, k) for w in wanted for k in ent["keys"]):
            return ent["id"]
    return None


def get_or_create(conn, name: str, etype: str, aliases: list[str]) -> int:
    entity_id = find_entity(conn, name, aliases)
    if entity_id is None:
        entity_id = conn.execute(
            "insert into entities (name, type) values (%s, %s) returning id", (name, etype)
        ).fetchone()["id"]
    add_aliases(conn, entity_id, [name, *aliases])
    return entity_id


def link(conn, entity_id: int, source_id: int, tag: str | None) -> None:
    conn.execute(
        """insert into entity_sources (entity_id, source_id, tag) values (%s, %s, %s)
           on conflict (entity_id, source_id) do update set tag = coalesce(excluded.tag, entity_sources.tag)""",
        (entity_id, source_id, tag),
    )


def match_photo(conn, filename: str, lat, lng) -> int | None:
    """Find the monument a photo shows, by its filename, then by GPS."""
    entities = [e for e in _all_entities(conn) if e["type"] == "monument"]
    words = filename_words(filename)
    # Full name in the filename first ("Adalaj_Stepwell_03.jpg"), then just the
    # distinctive part ("Adalaj_03.jpg") if exactly one monument fits.
    for ent in entities:
        if any(set(k.split()) <= words for k in ent["keys"] if k):
            return ent["id"]
    partial = [e["id"] for e in entities if any(core_words(k) and core_words(k) <= words for k in e["keys"])]
    if len(set(partial)) == 1:
        return partial[0]
    if lat is not None and lng is not None:
        best, best_km = None, GPS_RADIUS_KM
        for ent in entities:
            if ent["lat"] is not None and ent["lng"] is not None:
                km = distance_km(lat, lng, ent["lat"], ent["lng"])
                if km <= best_km:
                    best, best_km = ent["id"], km
        return best
    return None


def link_photo(conn, source: dict) -> int | None:
    """Link one photo source to a monument; give the monument coordinates if it has none."""
    entity_id = match_photo(conn, source["filename"], source["lat"], source["lng"])
    if entity_id is None:
        return None
    link(conn, entity_id, source["id"], source.get("tag"))
    if source["lat"] is not None:
        conn.execute(
            "update entities set lat = %s, lng = %s where id = %s and lat is null",
            (source["lat"], source["lng"], entity_id),
        )
    return entity_id


def relink_unlinked_photos(conn) -> int:
    """Photos uploaded before their monument existed get linked now."""
    rows = conn.execute(
        """select s.id, s.filename, s.lat, s.lng, s.tag from sources s
           where s.type = 'photo' and s.status = 'done'
             and not exists (select 1 from entity_sources es where es.source_id = s.id)"""
    ).fetchall()
    return sum(1 for r in rows if link_photo(conn, r) is not None)
