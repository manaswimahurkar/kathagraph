"""The AI's confidence is checked against the source text, never taken at face value."""
from app.claims import calibrate, quote_in_source

SOURCE = "Survey report: The Adalaj ni Vav near Gandhinagar was built in 1498 by Rani Rudabai."


def test_quote_found_even_with_different_spacing_and_case():
    assert quote_in_source("built  in 1498 by RANI Rudabai", SOURCE)


def test_invented_quote_is_not_found():
    assert not quote_in_source("completed in 1499", SOURCE)


def test_verified_quote_is_capped_below_certainty():
    assert calibrate(1.0, "built in 1498", SOURCE) == 0.9


def test_unverifiable_quote_is_capped_at_half():
    assert calibrate(1.0, "commissioned by the Sultan", SOURCE) == 0.5


def test_low_model_confidence_is_kept():
    assert calibrate(0.4, "built in 1498", SOURCE) == 0.4


def test_empty_quote_counts_as_unverified():
    assert calibrate(0.95, "", SOURCE) == 0.5
