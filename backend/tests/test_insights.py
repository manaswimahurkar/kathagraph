from app.insights import _around, date_span, risk, to_common_era


def test_risk_puts_disputed_unquoted_single_source_facts_first():
    bad = {"quote": "built by Veer Singh", "chunk_text": "built in memory of Rana Veer Singh", "method": "llm", "confidence": 0.9}
    good = {"quote": "Queen Rudabai", "chunk_text": "Queen Rudabai had it built", "method": "llm", "confidence": 0.9}
    s_bad, why = risk(bad, disputed=True, corroborating_sources=0)
    s_good, _ = risk(good, disputed=False, corroborating_sources=3)
    assert s_bad > s_good
    assert "Other sources give a different value" in why
    assert "The quoted words were not found in the source" in why
    assert "Only one source says this" in why


def test_date_span_covers_every_readable_date():
    assert date_span(["1026", "1026-1027", "11th century"]) == (1001, 1100)
    assert date_span(["2400 BCE"]) == (-2400, -2400)
    assert date_span(["unknown"]) is None


def test_era_conversion():
    assert to_common_era("vikram_samvat", 1555) == (1498, 1499)
    assert to_common_era("shaka", 1200) == (1278, 1279)
    lo, hi = to_common_era("hijri", 827)  # Ahmad Shah's Jama Masjid inscription: 1423/24 CE
    assert lo <= 1424 and hi >= 1423
    assert to_common_era("unknown", 1500) is None
    assert to_common_era("vikram_samvat", None) is None


def test_excerpt_centres_on_the_quote():
    text = "x" * 500 + " Queen Rudabai had it built " + "y" * 500
    out = _around(text, "Queen Rudabai")
    assert "Queen Rudabai" in out and out.startswith("…") and out.endswith("…")


def test_recent_or_unreadable_dates_rank_higher():
    base = {"quote": "x", "chunk_text": "x", "method": "llm", "confidence": 0.9, "field": "built_date"}
    recent, why = risk({**base, "value": "2021"}, disputed=False, corroborating_sources=1)
    old, _ = risk({**base, "value": "1063"}, disputed=False, corroborating_sources=1)
    garbled, why2 = risk({**base, "value": "2400rd century"}, disputed=False, corroborating_sources=1)
    assert recent > old and garbled > old
    assert any("recent" in w for w in why) and "Date can't be read" in why2
