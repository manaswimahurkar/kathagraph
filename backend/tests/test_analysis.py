import pytest
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


def test_known_equivalent_dynasty_names_are_not_a_conflict():
    found = conflicts([claim(1, "dynasty", "Chaulukya", SRC_A), claim(2, "dynasty", "Solanki dynasty", SRC_B)])
    assert found == []


def test_different_dynasties_are_still_a_conflict():
    found = conflicts([claim(1, "dynasty", "Solanki", SRC_A), claim(2, "dynasty", "Vaghela", SRC_B)])
    assert len(found) == 1


def test_same_name_in_hindi_and_english_is_not_a_conflict():
    found = conflicts([claim(1, "builder", "Rudabai", SRC_A), claim(2, "builder", "रुडाबाई", SRC_B)])
    assert found == []


def test_same_place_in_hindi_and_english_is_not_a_conflict():
    found = conflicts([claim(1, "location", "Adalaj, Gandhinagar", SRC_A), claim(2, "location", "अडालज, गांधीनगर", SRC_B)])
    assert found == []


def test_different_people_in_two_scripts_still_conflict():
    found = conflicts([claim(1, "builder", "Udayamati", SRC_A), claim(2, "builder", "भीम प्रथम", SRC_B)])
    assert len(found) == 1


def test_field_visit_todo_lists_gaps_then_disagreements():
    from app.entities import build_todo
    detail = {
        "gaps": [{"required_item": "interior_photo", "label": "Interior / structural photograph"}],
        "conflicts": [{"field": "built_date", "claims": [{"value": "1498"}, {"value": "1499"}, {"value": "1498"}]}],
    }
    todo = build_todo(detail)
    assert todo[0] == {"kind": "document", "item": "interior_photo", "text": "Interior / structural photograph"}
    assert todo[1]["kind"] == "verify"
    assert todo[1]["text"] == "Check the date of construction on site: sources say 1498 / 1499"


def test_location_wording_is_not_a_conflict():
    found = conflicts([claim(1, "location", "Pavagadh", SRC_A), claim(2, "location", "Pavagadh Hill, Panchmahal", SRC_B)])
    assert found == []


def test_field_visit_todo_asks_for_our_own_record_when_only_published_material_exists():
    from app.entities import build_todo
    detail = {"gaps": [], "conflicts": [], "sources": [
        {"id": 1, "type": "web", "origin": "web"}, {"id": 2, "type": "photo", "origin": "web"}]}
    items = {t["item"] for t in build_todo(detail)}
    assert {"own_photo", "field_record"} <= items

    detail["sources"].append({"id": 3, "type": "photo", "origin": "field"})
    items = {t["item"] for t in build_todo(detail)}
    assert "own_photo" not in items and "field_record" not in items


@pytest.mark.parametrize("value, span", [
    ("1026", (1026, 1026)),
    ("1026-1027", (1026, 1027)),
    ("1026–27", (1026, 1027)),
    ("1060s", (1060, 1069)),
    ("11th century", (1001, 1100)),
    ("early 15th century CE", (1401, 1500)),
    ("2400 BCE", (-2400, -2400)),
    ("3rd millennium BCE", (-3000, -2001)),
    ("VS 1555", (1498, 1499)),
    ("c. 1063 CE", (1063, 1063)),
    ("unknown", None),
])
def test_year_range(value, span):
    from app.analysis import year_range
    assert year_range(value) == span


def _claim(i, field, value):
    return {"id": i, "field": field, "value": value, "status": "unverified", "source": {"id": i, "filename": f"s{i}"}}


def test_dates_at_different_precision_do_not_disagree():
    from app.analysis import conflicts
    claims = [_claim(1, "built_date", "11th century"), _claim(2, "built_date", "1026-1027"), _claim(3, "built_date", "1026")]
    assert conflicts(claims) == []


def test_different_exact_years_still_disagree():
    from app.analysis import conflicts
    claims = [_claim(1, "built_date", "1498"), _claim(2, "built_date", "1499"), _claim(3, "built_date", "VS 1555")]
    found = conflicts(claims)
    assert len(found) == 1 and found[0]["field"] == "built_date"


def test_century_does_not_join_two_different_years():
    from app.analysis import conflicts
    claims = [_claim(1, "built_date", "1026"), _claim(2, "built_date", "1099"), _claim(3, "built_date", "11th century")]
    assert len(conflicts(claims)) == 1


def test_regnal_names_and_honorifics():
    from app.analysis import conflicts
    same = [_claim(1, "builder", "Bhima I"), _claim(2, "builder", "भीमदेव"), _claim(3, "builder", "King Bhimadeva")]
    assert conflicts(same) == []
    different = [_claim(1, "builder", "Bhima I"), _claim(2, "builder", "Bhima II")]
    assert len(conflicts(different)) == 1
    other_king = [_claim(1, "builder", "Bhima I"), _claim(2, "builder", "Karna I")]
    assert len(conflicts(other_king)) == 1


def test_gujarati_names_compare_with_hindi_and_english():
    from app.analysis import conflicts, to_latin
    assert to_latin("રૂડાબાઈ") == "rudabai"
    claims = [_claim(1, "builder", "Rudabai"), _claim(2, "builder", "રૂડાબાઈ"), _claim(3, "builder", "रुडाबाई")]
    assert conflicts(claims) == []


def test_completeness_counts_checklist_and_own_field_record():
    from app.entities import completeness
    assert completeness(6, 0, [{"origin": "field"}]) == 100
    assert completeness(6, 0, [{"origin": "web"}]) == 86
    assert completeness(6, 6, []) == 0
    assert completeness(6, 3, [{"origin": "web"}, {"origin": "field"}]) == 57


def test_value_groups_merge_spellings_and_scripts():
    from app.analysis import value_groups
    claims = [_claim(1, "builder", "Rudabai"), _claim(2, "builder", "रुडाबाई"), _claim(3, "builder", "Queen Rudabai"),
              _claim(4, "builder", "Veer Singh"), _claim(5, "built_date", "1498"), _claim(6, "built_date", "1499"),
              _claim(7, "builder", "Rudabai")]
    g = value_groups(claims)
    assert g[1] == g[2] == g[3] == g[7] == "Rudabai"
    assert g[4] == "Veer Singh"
    assert g[5] != g[6]


def test_garbled_or_impossible_dates_are_not_read():
    from app.analysis import year_range
    assert year_range("2400rd century") is None
    assert year_range("2400") is None
    assert year_range("5th century BCE") == (-500, -401)


def test_century_ranges():
    from app.analysis import year_range
    assert year_range("15th-16th centuries") == (1401, 1600)
    assert year_range("12th to 13th century") == (1101, 1300)
    assert year_range("3rd-2nd century BCE") == (-300, -101)
