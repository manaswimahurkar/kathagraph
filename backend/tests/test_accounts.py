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


def test_real_names_pass_and_joke_or_abusive_names_do_not():
    ok = ["Manaswi Mahurkar", "Sameehan Divekar", "Bhaskar Rao", "Charles Dickens", "Hassan Ali", "Asha",
          "मनस्वी महुरकर", "સમીહન", "Dr. A. K. Patel", "Jo"]
    for n in ok:
        assert accounts.name_problem(n) is None, n
    bad = ["poop", "Poop", "p00p", "poooooop", "Mr Poop", "poopface", "fuck you", "sh1t", "admin", "asdf",
           "aaaa", "x", "12345", "a1", "www.spam.com", "me@mail.com", "chutiya", "KathaGraph team",
           "pussy", "Pu55y", "pussycat", "big cunt", "bhosdike", "tatti",
           "fingernavagina", "FingerNaVagina", "bigpenis", "sexyboy"]
    for n in bad:
        assert accounts.name_problem(n) is not None, n
