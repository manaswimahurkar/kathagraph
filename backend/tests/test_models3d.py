"""Monument categories and Sketchfab link parsing."""
import pytest

from app.models3d import ModelError, category_for, sketchfab_uid


@pytest.mark.parametrize("name, category", [
    ("Adalaj Stepwell", "stepwell"), ("Rani ki Vav", "stepwell"), ("Navghan Kuvo", "stepwell"),
    ("Sun Temple, Modhera", "temple"), ("Palitana temples", "temple"), ("Somnath Temple", "temple"),
    ("Sidi Saiyyed Mosque", "mosque"), ("Sarkhej Roza", "tomb"), ("Mahabat Maqbara complex", "tomb"),
    ("Uparkot Fort", "fort"), ("Teen Darwaza", "fort"), ("Talaja Caves", "cave"),
    ("Kankaria Lake", "lake"), ("Temples at Narayan Sarovar", "temple"), ("Narayan Sarovar", "lake"), ("Sahasralinga Tank", "lake"), ("Lakshmi Vilas Palace, Vadodara", "palace"),
    ("Aina Mahal", "palace"), ("Sabarmati Ashram", "museum"), ("Lothal", "site"), ("Dholavira", "site"),
])
def test_category_from_name(name, category):
    assert category_for(name) == category


def test_sketchfab_uid_from_model_page_and_embed_links():
    uid = "c95c5018af984e9daf3fd25b66abcb78"
    assert sketchfab_uid(f"https://sketchfab.com/3d-models/adalaj-stepwell-detail-{uid}") == uid
    assert sketchfab_uid(f"https://sketchfab.com/models/{uid}/embed") == uid


def test_bad_sketchfab_link_is_refused():
    with pytest.raises(ModelError):
        sketchfab_uid("https://example.com/model")
