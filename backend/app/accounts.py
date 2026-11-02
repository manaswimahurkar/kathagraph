"""Contributor accounts: sign up, sign in, and a profile of everything a person has added or checked.

Accounts are optional. Anyone can still read, search, upload and review without one; signed in,
uploads and fact reviews are credited to the person automatically and listed under
"My contributions".

Security:
- Passwords are never stored: only a salted scrypt hash (Python's standard library), compared in
  constant time.
- A sign-in returns a random token; only its SHA-256 is stored, so a leaked sessions table cannot
  be used to sign in. Tokens expire after 30 days and are deleted on sign-out.
- Email addresses are private: they are only ever returned to their owner.
- Sign-in and sign-up are rate-limited per client.
- Emails are not verified (the site sends no email yet); the profile says so.
"""
import base64
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .db import get_conn
from .security import RateLimiter

router = APIRouter()

SESSION_DAYS = 30
SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}
REASONS = ["research", "study", "fellowship", "travel", "archive", "craft", "curious", "other"]
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")

auth_limit = RateLimiter(10, 60, "sign-in")


# ---------- passwords and tokens ----------

def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, dklen=32, **SCRYPT)
    return "scrypt${n}${r}${p}${s}${h}".format(
        **SCRYPT, s=base64.b64encode(salt).decode(), h=base64.b64encode(digest).decode())


def check_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, s, h = stored.split("$")
        digest = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(s), dklen=32,
                                n=int(n), r=int(r), p=int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, base64.b64decode(h))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def valid_email(email: str) -> bool:
    return bool(EMAIL.match(email)) and len(email) <= 254


# ---------- who is calling ----------

def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def optional_user(authorization: str | None = Header(default=None)) -> dict | None:
    """The signed-in person, or None. Never fails: a stale token just means "signed out"."""
    token = _bearer(authorization)
    if not token:
        return None
    try:
        with get_conn() as conn:
            return conn.execute(
                """select u.id, u.name, u.email, u.reason, u.created_at from sessions s join users u on u.id = s.user_id
                   where s.token_hash = %s and s.expires_at > now()""", (token_hash(token),)).fetchone()
    except Exception:  # accounts tables missing or DB hiccup: behave as signed out
        return None


def require_user(user: dict | None = Depends(optional_user)) -> dict:
    if not user:
        raise HTTPException(401, "Please sign in.")
    return user


def _public(user: dict) -> dict:
    return {"id": user["id"], "name": user["name"], "email": user["email"], "reason": user.get("reason"),
            "created_at": user.get("created_at")}


def _new_session(conn, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(
        "insert into sessions (token_hash, user_id, expires_at) values (%s, %s, %s)",
        (token_hash(token), user_id, datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)),
    )
    conn.execute("delete from sessions where user_id = %s and expires_at < now()", (user_id,))
    return token


# ---------- endpoints ----------

class SignUp(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=200)
    reason: str | None = Field(default=None, max_length=300)


class SignIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class ProfilePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    reason: str | None = Field(default=None, max_length=300)


@router.post("/auth/signup", status_code=201, dependencies=[Depends(auth_limit)])
def signup(body: SignUp):
    email = normalise_email(body.email)
    if not valid_email(email):
        raise HTTPException(400, "That doesn't look like an email address.")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Please give your name.")
    with get_conn() as conn:
        if conn.execute("select 1 from users where email = %s", (email,)).fetchone():
            raise HTTPException(409, "An account with this email already exists. Sign in instead.")
        user = conn.execute(
            """insert into users (email, name, reason, password_hash) values (%s, %s, %s, %s)
               returning id, name, email, reason, created_at""",
            (email, name, (body.reason or "").strip() or None, hash_password(body.password)),
        ).fetchone()
        token = _new_session(conn, user["id"])
    return {"token": token, "user": _public(user)}


@router.post("/auth/login", dependencies=[Depends(auth_limit)])
def login(body: SignIn):
    email = normalise_email(body.email)
    with get_conn() as conn:
        user = conn.execute(
            "select id, name, email, reason, created_at, password_hash from users where email = %s", (email,)
        ).fetchone()
        if not user or not check_password(body.password, user["password_hash"]):
            raise HTTPException(401, "Email or password is wrong.")
        token = _new_session(conn, user["id"])
    return {"token": token, "user": _public(user)}


@router.post("/auth/logout", status_code=204)
def logout(authorization: str | None = Header(default=None)):
    token = _bearer(authorization)
    if token:
        with get_conn() as conn:
            conn.execute("delete from sessions where token_hash = %s", (token_hash(token),))
    return None


@router.get("/me")
def me(user: dict = Depends(require_user)):
    """The signed-in person's profile and everything they have contributed."""
    with get_conn() as conn:
        uploads = conn.execute(
            """select s.id, s.filename, s.type, s.status, s.created_at,
                      (select count(*) from claims c where c.source_id = s.id and c.status <> 'rejected') as n_facts,
                      coalesce((select json_agg(json_build_object('id', e.id, 'name', e.name))
                                from entity_sources es join entities e on e.id = es.entity_id
                                where es.source_id = s.id), '[]'::json) as entities
               from sources s where s.contributor_id = %s order by s.id desc limit 50""", (user["id"],)).fetchall()
        reviews = conn.execute(
            """select c.id, c.field, c.value, c.status, c.reviewed_at, e.id as entity_id, e.name as entity_name
               from claims c join entities e on e.id = c.entity_id
               where c.reviewed_by = %s order by c.reviewed_at desc nulls last limit 50""", (user["id"],)).fetchall()
        totals = conn.execute(
            """select (select count(*) from sources where contributor_id = %(u)s) as uploads,
                      (select count(*) from claims c join sources s on s.id = c.source_id
                        where s.contributor_id = %(u)s and c.status <> 'rejected') as facts,
                      (select count(*) from claims where reviewed_by = %(u)s and status = 'verified') as verified,
                      (select count(*) from claims where reviewed_by = %(u)s and status = 'rejected') as rejected,
                      (select count(distinct es.entity_id) from entity_sources es join sources s on s.id = es.source_id
                        where s.contributor_id = %(u)s) as monuments""", {"u": user["id"]}).fetchone()
    return {"user": _public(user), "totals": totals, "uploads": uploads, "reviews": reviews,
            "email_verified": False}


@router.patch("/me")
def update_me(body: ProfilePatch, user: dict = Depends(require_user)):
    with get_conn() as conn:
        if body.name is not None:
            conn.execute("update users set name = %s where id = %s", (body.name.strip(), user["id"]))
        if body.reason is not None:
            conn.execute("update users set reason = %s where id = %s", (body.reason.strip() or None, user["id"]))
        row = conn.execute("select id, name, email, reason, created_at from users where id = %s", (user["id"],)).fetchone()
    return _public(row)
