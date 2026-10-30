from datetime import date

import pytest

from app.wikidata import clean_html, format_time, photo_credit, statement_text, statements


@pytest.mark.parametrize("value, text", [
    ({"time": "+1063-00-00T00:00:00Z", "precision": 9}, "1063"),
    ({"time": "+1499-03-01T00:00:00Z", "precision": 11}, "1499"),
    ({"time": "+1060-00-00T00:00:00Z", "precision": 8}, "1060s"),
    ({"time": "+1200-00-00T00:00:00Z", "precision": 7}, "12th century"),
    ({"time": "+1101-00-00T00:00:00Z", "precision": 7}, "12th century"),
    ({"time": "-2200-00-00T00:00:00Z", "precision": 9}, "2200 BCE"),
    ({"time": "-3000-00-00T00:00:00Z", "precision": 6}, "3rd millennium BCE"),
    ({"time": "+1021-00-00T00:00:00Z", "precision": 7}, "11th century"),
])
def test_dates_keep_their_precision(value, text):
    assert format_time(value) == text


def _snak(value):
    return {"rank": "normal", "mainsnak": {"snaktype": "value", "datavalue": {"value": value}}}


def test_statements_pick_our_fields_coordinates_and_image():
    item = {"claims": {
        "P571": [_snak({"time": "+1063-00-00T00:00:00Z", "precision": 9})],
        "P88": [_snak({"id": "Q123"})],
        "P1435": [_snak({"id": "Q9259"}), {**_snak({"id": "Q1"}), "rank": "deprecated"}],
        "P625": [_snak({"latitude": 23.85, "longitude": 72.1})],
        "P18": [_snak("Rani ki vav 02.jpg")],
        "P31": [_snak({"id": "Q1"})],
        "P84": [{"rank": "normal", "mainsnak": {"snaktype": "somevalue"}}],
    }}
    facts, extra = statements(item)
    assert facts == [("built_date", "1063", None), ("builder", "Q123", "Q123"), ("heritage_status", "Q9259", "Q9259")]
    assert extra == {"lat": 23.85, "lng": 72.1, "images": ["Rani ki vav 02.jpg"]}


def test_statement_text_has_attribution_and_one_quotable_line_per_fact():
    text, body = statement_text("Q1", "Rani ki Vav", [("built_date", "1063"), ("builder", "Udayamati")],
                                today=date(2026, 10, 30))
    assert "Source: Wikidata, item Q1" in text and "CC0" in text and "Retrieved: 2026-10-30" in text
    assert "built date: 1063" in text and "builder: Udayamati" in text
    assert "Retrieved" not in body  # duplicates are judged on the facts, not the date


def test_photo_credit_keeps_author_and_licence():
    info = {"descriptionurl": "https://commons.wikimedia.org/wiki/File:X.jpg", "thumburl": "https://u/x.jpg",
            "extmetadata": {"Artist": {"value": '<a href="//commons.wikimedia.org/wiki/User:Bernard">Bernard Gagnon</a>'},
                            "LicenseShortName": {"value": "CC BY-SA 3.0"},
                            "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/3.0"}}}
    credit = photo_credit(info)
    assert credit["author"] == "Bernard Gagnon"
    assert credit["licence"].startswith("CC BY-SA 3.0")
    assert credit["source_url"].endswith("File:X.jpg")


def test_photo_without_free_licence_is_skipped():
    assert photo_credit({"extmetadata": {"LicenseShortName": {"value": "Fair use"}}}) is None
    assert photo_credit({"extmetadata": {}}) is None


def test_clean_html():
    assert clean_html("<b>A&amp;B</b>\n  photo") == "A&B photo"
