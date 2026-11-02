"""Stories, journeys, crafts and digital-twin readiness: the pure logic behind them."""
from datetime import datetime, timedelta

from app import living, places, translate


def test_places_named_in_a_text_are_found_once_longest_first():
    found = places.find_places("Block-printed by Khatri families in Ajrakhpur and Dhamadka, Kutch (Kachchh).")
    names = [p["name"] for p in found]
    assert names[:2] == ["Ajrakhpur", "Dhamadka"] and "Kutch" in names
    assert "Kachchh" not in names  # same point as Kutch: not repeated
    assert all(p["precision"] == "approximate" for p in found)
    assert places.find_places("Woven in a village somewhere") == []
    assert places.find_places("Rann of Kutch salt flats")[0]["name"] == "Rann Of Kutch"


def test_bearing_and_compass_sides():
    assert round(living.bearing(23.0, 72.0, 23.1, 72.0)) == 0      # due north
    assert round(living.bearing(23.0, 72.0, 23.0, 72.1)) == 90     # due east
    assert [living.sector(d) for d in (0, 44, 46, 180, 337, 359)] == [0, 1, 1, 4, 7, 0]


def test_trips_split_on_long_gaps():
    t0 = datetime(2024, 1, 1)
    pts = [{"at": t0 + timedelta(days=d)} for d in (0, 1, 2, 12, 13, 40)]
    trips = living.split_trips(pts)
    assert [len(t) for t in trips] == [3, 2, 1]


def test_trail_order_visits_nearest_next():
    pts = [{"name": n, "lat": 23.0, "lng": lng} for n, lng in [("C", 72.2), ("A", 72.0), ("D", 72.9), ("B", 72.1)]]
    assert [p["name"] for p in living.order_by_nearest(pts)] == ["A", "B", "C", "D"]
    assert living.route_km(living.order_by_nearest(pts)) > 90


def _photo(i, lat=None, lng=None, tag="exterior_photo", heading=None):
    return {"id": i, "file_url": f"u{i}", "tag": tag, "author": None, "lat": lat, "lng": lng,
            "exif_json": {"GPSImgDirection": heading} if heading is not None else {}}


def test_twin_places_photos_around_the_monument_and_names_missing_sides():
    mon = {"id": 1, "name": "Adalaj Stepwell", "lat": 23.1667, "lng": 72.5800}
    photos = [_photo(1, 23.1677, 72.5800),            # ~110 m north
              _photo(2, 23.1667, 72.5810),            # east
              _photo(3, heading=0),                   # no GPS, facing north -> standing on the south side
              _photo(4, 23.30, 72.58),                # 15 km away: not of this monument
              _photo(5, tag="interior_photo")]
    r = living.twin_report(mon, photos, 0)
    assert r["photos"] == 5 and r["placed"] == 3
    assert r["coverage"][0] == 1 and r["coverage"][2] == 1 and r["coverage"][4] == 1
    assert r["shots"][3]["side"] is None
    assert any("north-east" in t and "west" in t for t in r["todo"])
    assert r["stage"] == "starting" and 0 < r["score"] < 0.5


def test_twin_stage_ready_and_modelled():
    mon = {"id": 1, "name": "X", "lat": 23.0, "lng": 72.0}
    ring = [_photo(i, 23.0 + 0.001 * __import__("math").cos(i), 72.0 + 0.001 * __import__("math").sin(i)) for i in range(48)]
    r = living.twin_report(mon, ring, 0)
    assert r["sides"][0] == "north" and sum(1 for c in r["coverage"] if c) >= 6 and r["stage"] == "ready"
    assert living.twin_report(mon, ring, 1)["stage"] == "modelled"
    assert living.twin_report({**mon, "lat": None, "lng": None}, ring[:2], 0)["todo"][1].startswith("Pin the monument")


def test_only_regional_script_text_is_translated():
    assert translate.needs_translation("અડાલજની વાવ ઈ.સ. ૧૪૯૯માં રાણી રૂડાબાઈએ બંધાવી હતી.")
    assert translate.needs_translation("रानी की वाव पाटन में स्थित है और यह एक प्रसिद्ध बावड़ी है।")
    assert not translate.needs_translation("Adalaj stepwell was built in 1499 by Queen Rudabai, says the plaque (वाव).")
    assert not translate.needs_translation("वाव")
