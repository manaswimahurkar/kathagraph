"""Monument name matching: different spellings and scripts of one place must
merge, different places must not."""
import pytest

from app.matching import distance_km, filename_words, keys_match, name_key


@pytest.mark.parametrize("a, b", [
    ("Adalaj Stepwell", "Adalaj ni Vav"),
    ("Adalaj Step Well", "Adalaj Stepwell"),
    ("Rani ki Vav", "Rani-ni-Vav, Patan"),
    ("Dada Harir Stepwell", "Dada Hari ni Vav"),
    ("Modhera Sun Temple", "Sun Temple, Modhera"),
])
def test_same_monument_matches(a, b):
    assert keys_match(name_key(a), name_key(b))


@pytest.mark.parametrize("a, b", [
    ("Rani ki Vav", "Rani Mahal"),          # same word, different kind of structure
    ("Rani ki Vav", "Adalaj Stepwell"),
    ("Adalaj Stepwell", "Adalaj"),          # a village is not its stepwell
])
def test_different_places_do_not_match(a, b):
    assert not keys_match(name_key(a), name_key(b))


def test_name_key_normalises_synonyms():
    assert name_key("Adalaj ni Vav") == name_key("Adalaj Stepwell") == "adalaj vav"


def test_filename_words_ignore_camera_noise():
    assert filename_words("Adalaj_Stepwell_-_interior_03.jpg") == {"adalaj", "vav", "interior"}


def test_distance_between_adalaj_and_patan_is_about_90_km():
    assert 85 < distance_km(23.1667, 72.5800, 23.8589, 72.1016) < 95


@pytest.mark.parametrize("name", [
    "Jama Mosque", "Jami Masjid", "Friday Mosque", "protection wall", "temples on the island",
    "Jain temples", "५ मन्दिर", "इन मन्दिरों",
])
def test_generic_names_are_not_a_monument_of_their_own(name):
    from app.matching import is_generic
    assert is_generic(name)


@pytest.mark.parametrize("name", [
    "Jama Mosque, Ahmedabad", "Jama Mosque, Champaner", "Rani ki Vav", "Sun Temple, Modhera",
    "Trikamray temple", "Uparkot Caves", "Girnar", "Lothal", "Sidi Saiyyed Mosque",
])
def test_named_monuments_are_not_generic(name):
    from app.matching import is_generic
    assert not is_generic(name)
