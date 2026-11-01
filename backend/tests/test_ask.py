from app.ask import _label, _record_text, clean_citations


def test_citations_to_missing_passages_are_dropped():
    text, used = clean_citations("Built in 1499 [2]. Some say 1498 [9].", [2, 7], n_passages=3)
    assert text == "Built in 1499 [2]. Some say 1498."
    assert used == [2]


def test_labels_say_whether_a_passage_is_a_field_record_or_published():
    assert _label({"filename": "note_A.txt", "origin": "field"}).endswith("(field record)")
    assert "Wikipedia" in _label({"filename": "wikipedia_en_Adalaj.txt", "origin": "web"})
    assert "Wikidata" in _label({"filename": "wikidata_Q1.txt", "origin": "web"})


def test_record_marks_verified_rejected_and_disagreements():
    d = {
        "name": "Adalaj Stepwell",
        "claims": [
            {"field": "built_date", "value": "1499", "status": "verified", "source": {"id": 5, "filename": "b.txt"}},
            {"field": "built_date", "value": "1498", "status": "unverified", "source": {"id": 6, "filename": "a.txt"}},
            {"field": "builder", "value": "Veer Singh", "status": "rejected", "source": {"id": 6, "filename": "a.txt"}},
        ],
        "conflicts": [{"field": "built_date", "claims": [{"value": "1499"}, {"value": "1498"}]}],
        "gaps": [{"label": "Interior / structural photograph"}],
    }
    text = _record_text(d, {5: 1})
    assert "1499 VERIFIED [1]" in text
    assert "1498 (source: a.txt)" in text
    assert "Veer Singh" not in text
    assert "SOURCES DISAGREE" in text and "NOT YET DOCUMENTED: Interior" in text
