"""A small gazetteer of Gujarat towns, districts and regions, so that a place named in a text
("practised by Khatri families in Ajrakhpur, Kutch") can be put on the map without a paid geocoder.

Coordinates are town centres or region centres, so every point found here is marked approximate.
Scaling path: replace with a geocoding service (Mapbox / Google Geocoding) behind the same function.
"""
import re

# name -> (lat, lng, kind)
GAZETTEER: dict[str, tuple[float, float, str]] = {
    "ahmedabad": (23.0225, 72.5714, "city"),
    "gandhinagar": (23.2156, 72.6369, "city"),
    "adalaj": (23.1667, 72.5800, "village"),
    "patan": (23.8493, 72.1266, "town"),
    "modhera": (23.5835, 72.1330, "village"),
    "mehsana": (23.5880, 72.3693, "city"),
    "vadnagar": (23.7850, 72.6380, "town"),
    "palanpur": (24.1725, 72.4380, "city"),
    "banaskantha": (24.1725, 72.4380, "district"),
    "kutch": (23.2420, 69.6669, "district"),
    "kachchh": (23.2420, 69.6669, "district"),
    "bhuj": (23.2420, 69.6669, "city"),
    "mandvi": (22.8333, 69.3500, "town"),
    "anjar": (23.1131, 70.0280, "town"),
    "ajrakhpur": (23.2136, 69.7314, "village"),
    "dhamadka": (23.2500, 69.9800, "village"),
    "nirona": (23.4600, 69.4600, "village"),
    "hodka": (23.6900, 69.7600, "village"),
    "bhujodi": (23.2000, 69.7000, "village"),
    "rann of kutch": (23.7300, 69.8500, "region"),
    "dholavira": (23.8870, 70.2130, "site"),
    "lothal": (22.5215, 72.2496, "site"),
    "surendranagar": (22.7277, 71.6480, "city"),
    "wadhwan": (22.7000, 71.6800, "town"),
    "jamnagar": (22.4707, 70.0577, "city"),
    "rajkot": (22.3039, 70.8022, "city"),
    "morbi": (22.8173, 70.8377, "city"),
    "dwarka": (22.2442, 68.9685, "town"),
    "porbandar": (21.6417, 69.6293, "city"),
    "junagadh": (21.5222, 70.4579, "city"),
    "somnath": (20.8880, 70.4012, "town"),
    "amreli": (21.6032, 71.2221, "city"),
    "bhavnagar": (21.7645, 72.1519, "city"),
    "palitana": (21.5222, 71.8235, "town"),
    "saurashtra": (22.0000, 70.8000, "region"),
    "kathiawar": (22.0000, 70.8000, "region"),
    "khambhat": (22.3180, 72.6190, "town"),
    "cambay": (22.3180, 72.6190, "town"),
    "kheda": (22.7507, 72.6847, "district"),
    "vadodara": (22.3072, 73.1812, "city"),
    "baroda": (22.3072, 73.1812, "city"),
    "sankheda": (22.1700, 73.5800, "town"),
    "chhota udepur": (22.3046, 74.0124, "town"),
    "champaner": (22.4860, 73.5376, "site"),
    "pavagadh": (22.4620, 73.5130, "site"),
    "godhra": (22.7788, 73.6143, "city"),
    "panchmahal": (22.7788, 73.6143, "district"),
    "dahod": (22.8350, 74.2550, "city"),
    "surat": (21.1702, 72.8311, "city"),
    "navsari": (20.9467, 72.9520, "city"),
    "valsad": (20.5992, 72.9342, "city"),
    "dang": (20.7500, 73.6900, "district"),
    "jamnagar district": (22.4707, 70.0577, "district"),
}

_PATTERNS = sorted(GAZETTEER, key=len, reverse=True)


def find_places(text: str) -> list[dict]:
    """Every gazetteer place named in a text, in the order they appear, without repeats.
    Longer names are matched first, so "Rann of Kutch" is not also read as "Kutch"."""
    low = " " + re.sub(r"[^a-z ]+", " ", (text or "").lower()) + " "
    hits = []
    for name in _PATTERNS:
        i = low.find(f" {name} ")
        while i >= 0:
            hits.append((i, name))
            low = low[:i + 1] + "#" * len(name) + low[i + 1 + len(name):]
            i = low.find(f" {name} ")
    found, seen = [], set()
    for _, name in sorted(hits):
        lat, lng, kind = GAZETTEER[name]
        if (lat, lng) not in seen:
            seen.add((lat, lng))
            found.append({"name": name.title(), "lat": lat, "lng": lng, "kind": kind, "precision": "approximate"})
    return found
