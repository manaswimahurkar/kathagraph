"""Parsing Wikipedia API answers and storing articles with their attribution."""
from datetime import date

from app.wiki import parse_response, stored_text

ANSWER = {"query": {"pages": [{
    "title": "Rani ki vav", "fullurl": "https://en.wikipedia.org/wiki/Rani_ki_vav",
    "extract": "Rani ki vav is a stepwell in Patan.",
    "coordinates": [{"lat": 23.8589, "lon": 72.1018, "primary": True}],
    "langlinks": [{"lang": "hi", "title": "रानी की वाव"}],
}]}}


def test_article_fields_are_read():
    a = parse_response(ANSWER)
    assert a["title"] == "Rani ki vav"
    assert (a["lat"], a["lng"]) == (23.8589, 72.1018)
    assert a["hindi_title"] == "रानी की वाव"


def test_missing_article_gives_none():
    assert parse_response({"query": {"pages": [{"title": "Nope", "missing": True}]}}) is None


def test_article_without_coordinates_or_hindi_still_works():
    a = parse_response({"query": {"pages": [{"title": "X", "fullurl": "u", "extract": "Some text."}]}})
    assert a["lat"] is None and a["hindi_title"] is None


def test_stored_text_carries_attribution_and_is_trimmed():
    a = parse_response(ANSWER)
    a["text"] = ("Line of history.\n" * 2000)
    s = stored_text(a, "en", today=date(2026, 10, 29))
    assert s.startswith("PUBLISHED REFERENCE (not a field record)")
    assert "https://en.wikipedia.org/wiki/Rani_ki_vav" in s and "CC BY-SA 4.0" in s and "2026-10-29" in s
    assert len(s) < 9600 and s.rstrip().endswith("[…]")
