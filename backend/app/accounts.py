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


# ---------- names people are credited under ----------

# Names appear on every file and fact a person contributes, so joke and abusive names are refused.
# Whole words are matched (so "Bhaskar" or "Dickens" pass); a short list of unambiguous words is
# also caught inside longer names ("poopface"). Letters are normalised first: l33t-speak and
# stretched letters ("pooooop") do not get around it.
_BLOCKED_WORDS = {
    "poop", "poo", "pee", "fart", "butt", "ass", "arse", "asshole", "shit", "crap", "fuck", "fucker", "bitch",
    "bastard", "dick", "cock", "penis", "vagina", "boob", "boobs", "tits", "sex", "sexy", "porn", "slut", "whore",
    "nigga", "retard", "idiot", "stupid", "dumb", "loser", "noob",
    "chutiya", "chutia", "bhenchod", "behenchod", "madarchod", "bsdk", "gandu", "lund", "lauda",
    "randi", "harami", "kutta", "kutti", "saala", "kamina",
    "admin", "administrator", "moderator", "kathagraph", "anonymous", "nobody", "none", "null", "undefined",
    "asdf", "qwerty", "xyz", "abc", "lol", "lmao", "bot",
}
_BLOCKED_INSIDE = {"poop", "fuck", "shit", "chutiya", "bhenchod", "behenchod", "madarchod", "porn", "asshole", "bitch"}
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"})


def _fold(text: str) -> str:
    """Lower case, l33t-speak undone, and any letter repeated 3+ times cut to 2 ("pooooop" -> "poop")."""
    return re.sub(r"(.)\1{2,}", r"\1\1", text.lower().translate(_LEET))


def name_problem(name: str) -> str | None:
    """Why a display name can't be used, or None if it is fine."""
    name = (name or "").strip()
    letters = [c for c in name if c.isalpha()]
    if len(name) < 2 or len(letters) < 2:
        return "Please give a name of at least two letters."
    if len(name) > 60:
        return "Please keep the name under 60 characters."
    if re.search(r"https?://|www\.|@|\.(com|in|org|net)\b", name, re.I):
        return "A name can't be a web address or an email."
    if len(set(c.lower() for c in letters)) == 1:
        return "Please use your real name, or the name you'd like to be credited as."
    folded = _fold(name)
    words = re.findall(r"[^\W\d_]+", folded)
    joined = "".join(words)
    if any(w in _BLOCKED_WORDS for w in words) or any(b in joined for b in _BLOCKED_INSIDE):
        return "Please use your real name, or the name you'd like to be credited as."
    return None


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
    problem = name_problem(name)
    if problem:
        raise HTTPException(400, problem)
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
            problem = name_problem(body.name)
            if problem:
                raise HTTPException(400, problem)
            conn.execute("update users set name = %s where id = %s", (body.name.strip(), user["id"]))
        if body.reason is not None:
            conn.execute("update users set reason = %s where id = %s", (body.reason.strip() or None, user["id"]))
        row = conn.execute("select id, name, email, reason, created_at from users where id = %s", (user["id"],)).fetchone()
    return _public(row)


class DeleteAccount(BaseModel):
    password: str = Field(min_length=1, max_length=200)


@router.post("/me/delete", status_code=204, dependencies=[Depends(auth_limit)])
def delete_me(body: DeleteAccount, user: dict = Depends(require_user)):
    """Delete the signed-in account for good, after checking the password again.

    What goes: the account (name, email, password hash, reason) and every sign-in session.
    What stays: the files and fact reviews they gave the archive, because other records and
    facts now rest on them. They stay unlinked from any account, and the uploader's name on
    them is replaced by "Former contributor"."""
    with get_conn() as conn:
        row = conn.execute("select password_hash from users where id = %s", (user["id"],)).fetchone()
        if not row or not check_password(body.password, row["password_hash"]):
            raise HTTPException(403, "That password is not right.")  # 403, not 401: still signed in
        conn.execute("update sources set author = 'Former contributor' where contributor_id = %s", (user["id"],))
        conn.execute("delete from users where id = %s", (user["id"],))  # sessions go with it (cascade)
    return None


# ---------- admin view of the archive ----------

from .security import require_admin  # noqa: E402  (kept beside the admin view it guards)


@router.get("/admin/status", dependencies=[Depends(require_admin)])
def admin_status():
    """Everything an archive keeper needs at a glance: files by status (failed ones with their
    error), facts by review status, monuments by kind, and the contributors who have joined."""
    with get_conn() as conn:
        files = {r["status"]: r["n"] for r in conn.execute(
            "select status, count(*) as n from sources group by status").fetchall()}
        kinds = {r["type"]: r["n"] for r in conn.execute(
            "select type, count(*) as n from sources group by type").fetchall()}
        failed = conn.execute(
            """select id, filename, type, error, created_at from sources
               where status = 'failed' order by id desc limit 50""").fetchall()
        waiting = conn.execute(
            """select id, filename, type, status, created_at from sources
               where status in ('pending', 'processing') order by id limit 50""").fetchall()
        facts = {r["status"]: r["n"] for r in conn.execute(
            "select status, count(*) as n from claims group by status").fetchall()}
        entities = {r["k"]: r["n"] for r in conn.execute(
            """select case when type = 'monument' then coalesce(nature, 'built') else type end as k, count(*) as n
               from entities group by 1""").fetchall()}
        translated = conn.execute("select count(distinct source_id) as n from translations").fetchone()["n"]
        users = conn.execute(
            """select u.id, u.name, u.email, u.reason, u.created_at,
                      (select count(*) from sources s where s.contributor_id = u.id) as uploads,
                      (select count(*) from claims c where c.reviewed_by = u.id) as reviews
               from users u order by u.id desc limit 100""").fetchall()
        recent = conn.execute(
            """select s.id, s.filename, s.type, s.status, s.origin, s.author, s.created_at
               from sources s order by s.id desc limit 15""").fetchall()
    return {"files": files, "file_types": kinds, "failed": failed, "waiting": waiting, "facts": facts,
            "entities": entities, "translated_sources": translated, "users": users, "recent": recent}
