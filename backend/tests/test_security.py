"""Admin token and rate limits."""
import pytest
from fastapi import HTTPException

from app.security import RateLimiter, require_admin


def test_admin_jobs_are_off_without_a_token(monkeypatch):
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    with pytest.raises(HTTPException) as e:
        require_admin("anything")
    assert e.value.status_code == 403


def test_admin_token_must_match(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret-token")
    require_admin("s3cret-token")  # allowed
    for wrong in (None, "", "s3cret", "s3cret-token "):
        with pytest.raises(HTTPException) as e:
            require_admin(wrong)
        assert e.value.status_code == 401


def test_rate_limit_per_client_and_window():
    rl = RateLimiter(3, 60)
    assert [rl.hit("a", t) for t in (0, 1, 2)] == [None, None, None]
    assert rl.hit("a", 3) == pytest.approx(57)     # 4th call within the minute waits
    assert rl.hit("b", 3) is None                  # other clients are unaffected
    assert rl.hit("a", 60.5) is None               # the first call has left the window
