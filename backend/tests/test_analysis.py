"""Conflict and gap detection on a monument's claims."""
from app.analysis import conflicts, gaps, normalise

SRC_A = {"id": 2, "filename": "field_note.txt"}
SRC_B = {"id": 3, "filename": "survey_2019.txt"}


def claim(cid, field, value, source, status="unverified"):
    return {"id": cid, "field": field, "value": value, "status": status, "source": source}


def test_different_years_are_a_conflict():
    found = conflicts([claim(1, "built_date", "1499", SRC_A), claim(2, "built_date", "1498 CE", SRC_B)])
    assert len(found) == 1
    assert found[0]["field"] == "built_date"
    assert {c["value"] for c in found[0]["claims"]} == {"1499", "1498 CE"}


def test_same_year_written_differently_is_not_a_conflict():
    assert conflicts([claim(1, "built_date", "1499", SRC_A), claim(2, "built_date", "1499 CE", SRC_B)]) == []


def test_titles_do_not_create_false_conflicts():
    assert conflicts([claim(1, "builder", "Rudabai", SRC_A), claim(2, "builder", "Queen Rudabai", SRC_B)]) == []


def test_rejected_claims_resolve_a_conflict():
    found = conflicts([
        claim(1, "built_date", "1499", SRC_A),
        claim(2, "built_date", "1498", SRC_B, status="rejected"),
    ])
    assert found == []


def test_multi_valued_fields_never_conflict():
    assert conflicts([claim(1, "material", "sandstone", SRC_A), claim(2, "material", "brick", SRC_B)]) == []


def test_normalise_extracts_year():
    assert normalise("built_date", "completed around 1499 CE") == "1499"


CHECKLIST = [{"required_item": i, "label": i} for i in
             ["exterior_photo", "interior_photo", "inscription", "built_date", "builder", "location"]]


def test_gaps_list_only_missing_evidence():
    claims = [claim(1, "built_date", "1499", SRC_A), claim(2, "builder", "Rudabai", SRC_A)]
    sources = [{"tag": "exterior_photo"}]
    missing = {g["required_item"] for g in gaps(CHECKLIST, claims, sources, has_location=True)}
    assert missing == {"interior_photo", "inscription"}


def test_rejected_claim_does_not_fill_a_gap():
    claims = [claim(1, "built_date", "1499", SRC_A, status="rejected")]
    missing = {g["required_item"] for g in gaps(CHECKLIST, claims, [], has_location=False)}
    assert "built_date" in missing
