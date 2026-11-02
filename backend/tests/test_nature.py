"""Built, natural and settlement sites are documented and dated differently."""
from app import analysis
from app.entities import build_todo, completeness
from app.wikidata import nature_from_types

BUILT_CHECKLIST = [
    {"required_item": i, "label": l} for i, l in [
        ("exterior_photo", "Exterior photograph"), ("interior_photo", "Interior / structural photograph"),
        ("inscription", "Inscription photo or transcription"), ("built_date", "Date of construction"),
        ("builder", "Builder / patron"), ("location", "Reliable GPS location")]
]


def test_nature_from_wikidata_instance_of():
    assert nature_from_types(["mountain", "pilgrimage site"]) == "natural"
    assert nature_from_types(["island"]) == "natural"
    assert nature_from_types(["artificial lake"]) == "built"      # made by people
    assert nature_from_types(["rock-cut cave temple"]) == "built"
    assert nature_from_types(["city gate"]) == "built"            # not a city
    assert nature_from_types(["archaeological site", "ancient city"]) == "settlement"
    assert nature_from_types(["village", "fort"]) == "settlement"
    assert nature_from_types(["stepwell"]) == "built"
    assert nature_from_types([]) == "built"


def test_natural_sites_are_not_asked_for_a_builder_or_date():
    checklist = analysis.checklist_for("natural", BUILT_CHECKLIST)
    items = [c["required_item"] for c in checklist]
    assert "built_date" not in items and "builder" not in items and "interior_photo" not in items
    claims = [{"field": "legend", "status": "unverified"}, {"field": "heritage_status", "status": "verified"}]
    gaps = analysis.gaps(checklist, claims, [{"tag": "exterior_photo"}], True)
    assert gaps == []
    assert completeness(len(checklist), 0, [{"origin": "field"}]) == 100


def test_settlements_are_founded_not_built():
    checklist = analysis.checklist_for("settlement", BUILT_CHECKLIST)
    labels = {c["required_item"]: c["label"] for c in checklist}
    assert labels["built_date"] == "Date of founding" and labels["builder"] == "Founder or culture"
    assert "interior_photo" not in labels
    # A culture ("Harappan") counts as the founder
    gaps = analysis.gaps(checklist, [{"field": "dynasty", "status": "unverified"}], [], True)
    assert "builder" not in {g["required_item"] for g in gaps}
    assert analysis.checklist_for("built", BUILT_CHECKLIST) is BUILT_CHECKLIST


def _conflict(field, *values):
    return {"field": field, "claims": [{"value": v} for v in values]}


def test_field_visit_tasks_follow_the_kind_of_site():
    detail = {"gaps": [], "sources": [], "conflicts": [_conflict("built_date", "1200", "1500")]}
    assert "date of construction" in build_todo({**detail, "nature": "built"})[0]["text"]
    assert "date of founding" in build_todo({**detail, "nature": "settlement"})[0]["text"]
    assert build_todo({**detail, "nature": "natural"}) == []


def test_bce_ranges_with_an_era_on_each_side():
    assert analysis.year_range("2650 BCE - 1450 BCE") == (-2650, -1450)
    assert analysis.year_range("300 BCE - 200 CE") == (-300, 200)
    assert analysis.year_range("1450 CE - 1500 CE") == (1450, 1500)
