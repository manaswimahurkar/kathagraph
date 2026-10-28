"""Reading GPS and capture time from photo metadata."""
from io import BytesIO

from PIL import Image

from app.exif import extract


def _photo_with_gps() -> bytes:
    img = Image.new("RGB", (10, 10))
    exif = img.getexif()
    exif[0x0132] = "2024:01:05 10:20:30"          # DateTime
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2] = "N", (23.0, 10.0, 0.0)       # 23 deg 10' N
    gps[3], gps[4] = "E", (72.0, 35.0, 0.0)       # 72 deg 35' E
    buf = BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def test_gps_and_date_are_read():
    meta = extract(_photo_with_gps())
    assert round(meta["lat"], 3) == 23.167
    assert round(meta["lng"], 3) == 72.583
    assert meta["captured_at"].year == 2024


def test_not_an_image_never_crashes():
    assert extract(b"not an image") == {"exif": {}, "lat": None, "lng": None, "captured_at": None}
