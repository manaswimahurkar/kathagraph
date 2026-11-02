from app.matching import name_key
from app.merge import compare


def _e(i, name, lat=None, lng=None, aliases=(), precision="exact"):
    names = [name, *aliases]
    return {"id": i, "name": name, "lat": lat, "lng": lng, "aliases": list(aliases),
            "coord_precision": precision if lat is not None else None,
            "keys": {k for k in (name_key(n) for n in names) if k}}


def test_contained_name_nearby_is_suggested():
    found = compare(_e(1, "Ambaji", 24.33, 72.85), _e(2, "Ambaji Mata Temple", 24.331, 72.851))
    assert found and "One name contains the other" in found[1] and any("m apart" in r for r in found[1])


def test_similar_spellings_are_suggested():
    found = compare(_e(1, "Navlakha temple"), _e(2, "Navlakha Mandir"))
    assert found and found[0] >= 0.75


def test_far_apart_places_are_never_suggested():
    assert compare(_e(1, "Jama Mosque, Ahmedabad", 23.02, 72.58), _e(2, "Jama Mosque, Champaner", 22.48, 73.53)) is None


def test_unrelated_names_are_not_suggested():
    assert compare(_e(1, "Lothal"), _e(2, "Dholavira")) is None


def test_names_sharing_only_a_common_ending_are_not_suggested():
    assert compare(_e(1, "Somnath Temple"), _e(2, "Neminath temple")) is None
    assert compare(_e(1, "Shantinath temple"), _e(2, "Parshvanath temple")) is None


def test_different_structures_at_one_site_are_not_suggested():
    assert compare(_e(1, "Uparkot Caves", 21.52, 70.47), _e(2, "Uparkot Fort", 21.522, 70.471)) is None
    assert compare(_e(1, "Narayan Sarovar"), _e(2, "Temples at Narayan Sarovar")) is None


def test_a_town_and_its_fort_are_not_one_place():
    from app.merge import compare
    town = {"id": 1, "name": "Lakhpat", "keys": ["lakhpat"], "lat": 23.82, "lng": 68.78, "nature": "settlement"}
    fort = {"id": 2, "name": "Lakhpat Fort", "keys": ["lakhpat fort"], "lat": 23.82, "lng": 68.78, "nature": "built"}
    assert compare(town, fort) is None
    assert compare({**town, "nature": "built"}, fort) is not None
