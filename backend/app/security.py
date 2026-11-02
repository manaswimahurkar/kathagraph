"""Guards for the API: an admin token for maintenance jobs, and per-client rate limits on the
endpoints that call the AI (each call costs quota, so one client must not be able to use it all).

The public site has no login: anyone may read, search, ask, upload and review. What needs the
admin token are jobs that re-run AI work over the whole archive, imports, and deleting files.
"""
import hmac
import os
import threading
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Allow the call only with the right X-Admin-Token header. With no ADMIN_TOKEN set on the
    server, admin jobs are switched off entirely (fail closed)."""
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected:
        raise HTTPException(403, "Admin jobs are switched off on this server (no ADMIN_TOKEN set).")
    if not x_admin_token or not hmac.compare_digest(x_admin_token.encode(), expected.encode()):
        raise HTTPException(401, "This needs the admin token (X-Admin-Token header).")


class RateLimiter:
    """At most `limit` calls per `window` seconds per client, counted in memory.
    Per instance: with several API instances, move the counters to Redis."""

    def __init__(self, limit: int, window: float = 60.0, name: str = "this"):
        self.limit, self.window, self.name = limit, window, name
        self.calls: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def hit(self, client: str, now: float | None = None) -> float | None:
        """Record a call. Returns None if allowed, else the seconds to wait."""
        now = time.monotonic() if now is None else now
        with self.lock:
            q = self.calls[client]
            while q and now - q[0] >= self.window:
                q.popleft()
            if len(q) >= self.limit:
                return self.window - (now - q[0])
            q.append(now)
            if len(self.calls) > 10_000:  # forget idle clients so memory stays bounded
                for k in [k for k, v in self.calls.items() if not v]:
                    del self.calls[k]
            return None

    def __call__(self, request: Request) -> None:
        wait = self.hit(client_ip(request))
        if wait is not None:
            raise HTTPException(429, f"Too many {self.name} requests. Try again in {int(wait) + 1} s.")


def client_ip(request: Request) -> str:
    # Behind Render's proxy the caller's address is the first entry of X-Forwarded-For
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


ask_limit = RateLimiter(20, 60, "questions")
inscription_limit = RateLimiter(10, 60, "inscription")
upload_limit = RateLimiter(30, 60, "upload")
