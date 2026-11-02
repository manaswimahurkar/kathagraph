"""Passwords, emails and tokens for contributor accounts."""
from app import accounts


def test_password_hash_round_trip_and_never_stores_the_password():
    stored = accounts.hash_password("stepwell-1499")
    assert stored.startswith("scrypt$") and "stepwell" not in stored
    assert accounts.check_password("stepwell-1499", stored)
    assert not accounts.check_password("stepwell-1498", stored)
    assert accounts.hash_password("stepwell-1499") != stored  # a fresh salt every time
    assert not accounts.check_password("x", "garbage")


def test_emails_are_normalised_and_checked():
    assert accounts.normalise_email("  Asha.Patel@Example.COM ") == "asha.patel@example.com"
    assert accounts.valid_email("asha@iitgn.ac.in")
    for bad in ("asha", "asha@", "@iitgn.ac.in", "a b@c.in", "asha@iitgn"):
        assert not accounts.valid_email(bad)


def test_only_a_hash_of_the_token_is_kept():
    assert accounts.token_hash("abc") != "abc" and len(accounts.token_hash("abc")) == 64
    assert accounts._bearer("Bearer tok123") == "tok123"
    assert accounts._bearer("Basic xyz") is None and accounts._bearer(None) is None
