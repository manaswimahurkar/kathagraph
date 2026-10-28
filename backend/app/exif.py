"""Reads camera metadata (EXIF) from photos: GPS position and capture time."""
import math
from datetime import datetime
from io import BytesIO

from PIL import ExifTags, Image

EXIF_IFD = 0x8769
GPS_IFD = 0x8825


def _clean(value):
    """Turn an EXIF value into something JSON/Postgres can store, or None."""
    if isinstance(value, bytes):
        return None
    if isinstance(value, str):
        return value.replace("\x00", "").strip() or None
    if isinstance(value, (int, float)) or hasattr(value, "numerator"):
        try:
            f = float(value)
        except (TypeError, ZeroDivisionError, ValueError):
            return None
        return f if math.isfinite(f) else None
    return None


def _to_degrees(dms, ref) -> float | None:
    try:
        d, m, s = (float(x) for x in dms)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    deg = d + m / 60 + s / 3600
    if ref in ("S", "W"):
        deg = -deg
    return deg if math.isfinite(deg) else None


def extract(data: bytes) -> dict:
    """Return {"exif": {...}, "lat", "lng", "captured_at"}. Never raises."""
    result = {"exif": {}, "lat": None, "lng": None, "captured_at": None}
    try:
        exif = Image.open(BytesIO(data)).getexif()
    except Exception:
        return result
    if not exif:
        return result

    tags = {}
    for tag_id, value in list(exif.items()) + list(exif.get_ifd(EXIF_IFD).items()):
        name = ExifTags.TAGS.get(tag_id)
        clean = _clean(value)
        if name and name not in ("GPSInfo", "ExifOffset") and clean is not None:
            tags[name] = clean
    result["exif"] = tags

    gps = exif.get_ifd(GPS_IFD)
    if gps and 2 in gps and 4 in gps:
        lat = _to_degrees(gps[2], gps.get(1))
        lng = _to_degrees(gps[4], gps.get(3))
        if lat is not None and lng is not None and -90 <= lat <= 90 and -180 <= lng <= 180 and (lat, lng) != (0, 0):
            result["lat"], result["lng"] = lat, lng

    stamp = tags.get("DateTimeOriginal") or tags.get("DateTime")
    if isinstance(stamp, str):
        try:
            result["captured_at"] = datetime.strptime(stamp, "%Y:%m:%d %H:%M:%S")
        except ValueError:
            pass
    return result
