"""Monument categories, and 3D models attached to monuments (Sketchfab links or uploaded glTF files)."""
import re

import httpx

CATEGORIES = ["temple", "stepwell", "fort", "mosque", "tomb", "cave", "lake", "palace", "museum", "site"]

# Checked in order: the first rule whose words appear in the name wins.
_CATEGORY_RULES = [
    ("stepwell", r"\b(step ?wells?|vav|vaav|baoli|bawdi|baori|kuvo)\b|वाव|बावड़ी|बावली"),
    ("cave", r"\bcaves?\b|\bstupa\b|\bmonastery\b"),
    ("mosque", r"\b(mosque|masjid|jali|minarets?)\b"),
    ("tomb", r"\b(tomb|maqbara|roza|dargah|mausoleums?)\b"),
    ("fort", r"\b(fort|qila|killa|darwaza|gate(way)?|uparkot|bhadra)\b"),
    ("palace", r"\b(palace|mahal|vilas)\b"),
    ("museum", r"\b(museum|ashram|smarak|sangrahalaya|mandir, porbandar|kirti mandir)\b"),
    ("lake", r"\b(lake|talav|talao|tank|sarovar|kund)\b"),
    ("temple", r"\b(temples?|mandir|derasar|gurudwara|devalaya|mahalaya|shamlaji|ambaji|palitana|girnar|somnath|dwarkadhish)\b"),
]


def category_for(name: str) -> str:
    n = name.lower()
    for category, pattern in _CATEGORY_RULES:
        if re.search(pattern, n):
            return category
    return "site"


SKETCHFAB_UID = re.compile(r"sketchfab\.com/(?:3d-models/[^/?#]*-|models/)([0-9a-f]{32})")
ALLOWED_MODEL_FILES = (".glb", ".gltf")
MAX_MODEL_BYTES = 50 * 1024 * 1024


class ModelError(ValueError):
    pass


def sketchfab_uid(url: str) -> str:
    m = SKETCHFAB_UID.search(url or "")
    if not m:
        raise ModelError("That doesn't look like a Sketchfab model link (sketchfab.com/3d-models/…).")
    return m.group(1)


def sketchfab_info(uid: str) -> dict:
    """Title, author and licence from Sketchfab's public API."""
    try:
        resp = httpx.get(f"https://api.sketchfab.com/v3/models/{uid}", timeout=20)
    except httpx.HTTPError as e:
        raise ModelError(f"Couldn't reach Sketchfab: {e}") from e
    if resp.status_code == 404:
        raise ModelError("Sketchfab has no public model with that link.")
    if resp.status_code >= 300:
        raise ModelError(f"Sketchfab answered {resp.status_code}.")
    data = resp.json()
    user = data.get("user") or {}
    licence = data.get("license") or {}
    return {
        "title": (data.get("name") or "Untitled model").strip()[:200],
        "author": user.get("displayName") or user.get("username"),
        "author_url": user.get("profileUrl"),
        "licence": licence.get("label") if isinstance(licence, dict) else None,
    }
