"""Works out, for one monument, where sources disagree and what is missing."""
import re
from difflib import SequenceMatcher

from .claims import SINGLE_VALUED

# Different names for the same thing, so they are not reported as a disagreement.
# Kept short and explicit on purpose: every entry is a documented equivalence.
EQUIVALENT_NAMES = {
    "dynasty": {
        "chaulukya": "solanki", "chalukya of gujarat": "solanki", "chalukyas of gujarat": "solanki",
        "solanki": "solanki", "solankis": "solanki",
        "vaghela": "vaghela", "vaghelas": "vaghela",
    },
}

# Devanagari -> rough Latin spelling, so "रुडाबाई" and "Rudabai" compare as the same name.
# Deliberately simple (no full transliteration scheme): it only has to be close enough
# for the fuzzy comparison below.
_CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
    "ष": "sh", "स": "s", "ह": "h", "ळ": "l", "ड़": "r", "ढ़": "rh",
}
_VOWELS = {"अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऋ": "ri"}
_SIGNS = {"ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ृ": "ri",
          "ं": "n", "ँ": "n", "ः": "h", "्": "", "़": ""}
_DIGITS = {chr(0x0966 + i): str(i) for i in range(10)}


def gujarati_to_devanagari(text: str) -> str:
    """Gujarati letters sit at the same positions as Devanagari, 0x180 higher: \u0aaa (પ) -> \u092a (प)."""
    return "".join(chr(ord(c) - 0x180) if "\u0a80" <= c <= "\u0aff" else c for c in text)


def to_latin(text: str) -> str:
    out = []
    chars = list(gujarati_to_devanagari(text))
    for i, c in enumerate(chars):
        nxt = chars[i + 1] if i + 1 < len(chars) else ""
        if c in _CONSONANTS:
            out.append(_CONSONANTS[c])
            # inherent "a", except before a vowel sign / virama, or at the end of a word
            if nxt not in _SIGNS and nxt and ("\u0900" <= nxt <= "\u097f"):
                out.append("a")
        elif c in _VOWELS:
            out.append(_VOWELS[c])
        elif c in _SIGNS:
            out.append(_SIGNS[c])
        elif c in _DIGITS:
            out.append(_DIGITS[c])
        else:
            out.append(c)
    return "".join(out)


TITLES = {"queen", "rani", "king", "raja", "rana", "sultan", "maharaja", "maharani", "emperor", "sri", "shri"}


def normalise(field: str, value: str) -> str:
    v = to_latin(value.strip()).lower()
    if field == "built_date":
        m = re.search(r"\b(\d{3,4})\b", v)
        if m:
            return m.group(1)
    v = re.sub(r"[^\w\s]", " ", v)
    words = [w for w in v.split() if w not in TITLES and w not in {"dynasty", "the"}]
    key = " ".join(words)
    return EQUIVALENT_NAMES.get(field, {}).get(key, key)


ROMAN = {"i", "ii", "iii", "iv", "v", "vi", "vii", "viii"}
_HONORIFIC_SUFFIX = re.compile(r"(deva|dev)$")
_ORDINAL = r"(\d{1,2})(?:st|nd|rd|th)"


def _name_parts(key: str) -> tuple[list[str], str]:
    """Regnal numbers apart, honorific '-deva' dropped: 'bhima i' -> (['i'], 'bhima'), 'bhimadev' -> ([], 'bhima')."""
    words = key.split()
    numerals = [w for w in words if w in ROMAN]
    rest = [_HONORIFIC_SUFFIX.sub("", w) if len(w) > 5 else w for w in words if w not in ROMAN]
    return numerals, " ".join(rest)


def _same_name(a: str, b: str) -> bool:
    if a == b:
        return True
    na, ra = _name_parts(a)
    nb, rb = _name_parts(b)
    if na and nb and na != nb:  # Bhima I and Bhima II are different kings
        return False
    if SequenceMatcher(None, a, b).ratio() >= 0.85:
        return True
    return bool(ra) and (ra == rb or SequenceMatcher(None, ra, rb).ratio() >= 0.85)


def year_range(value: str) -> tuple[int, int] | None:
    """The span of years a date statement allows, at its own precision:
    '1026' -> (1026, 1026); '1026-1027' -> (1026, 1027); '1060s' -> (1060, 1069);
    '11th century' -> (1001, 1100); '2400 BCE' -> (-2400, -2400); 'VS 1555' -> (1498, 1499)."""
    v = to_latin(value).lower().replace("\u2013", "-").replace("\u2014", "-")
    bce = bool(re.search(r"\b(bce|bc)\b", v))
    sign = -1 if bce else 1
    vikram = bool(re.search(r"\b(vs|v\.s\.|vikram|samvat)\b", v))
    m = re.search(_ORDINAL + r"\s*millennium", v)
    if m:
        n = int(m.group(1))
        lo, hi = (n - 1) * 1000 + 1, n * 1000
        return (-hi, -lo) if bce else (lo, hi)
    m = re.search(_ORDINAL + r"\s*century", v)
    if m:
        n = int(m.group(1))
        lo, hi = (n - 1) * 100 + 1, n * 100
        return (-hi, -lo) if bce else (lo, hi)
    m = re.search(r"\b(\d{3,4})s\b", v)
    if m:
        y = int(m.group(1))
        return (sign * y, sign * (y + 9)) if not bce else (-(y + 9), -y)
    m = re.search(r"\b(\d{3,4})\s*-\s*(\d{2,4})\b", v)
    if m:
        a, b = m.group(1), m.group(2)
        b = a[: len(a) - len(b)] + b if len(b) < len(a) else b  # 1026-27 -> 1026-1027
        lo, hi = sorted((int(a), int(b)))
        if vikram:
            lo, hi = lo - 57, hi - 56
        return (-hi, -lo) if bce else (lo, hi)
    m = re.search(r"\b(\d{3,4})\b", v)
    if m:
        y = int(m.group(1))
        if vikram:  # Vikram Samvat runs 56-57 years ahead of the Common Era
            return (y - 57, y - 56)
        return (sign * y, sign * y)
    return None


def _overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]


def _agree(field: str, a: str, b: str) -> bool:
    """Do two values of the same field say compatible things?"""
    if field == "built_date":
        ra, rb = year_range(a), year_range(b)
        if ra and rb:
            return _overlap(ra, rb)
    return _same_name(normalise(field, a), normalise(field, b))


def _same(a: str, b: str) -> bool:
    return _same_name(a, b)


def value_groups(claims: list[dict]) -> dict[int, str]:
    """For every claim, the label of the group of values that say the same thing
    ("Rudabai", "Queen Rudabai" and "रुडाबाई" -> "Rudabai"), so views can draw one fact, not three.
    The label is the most-cited spelling, preferring Latin script."""
    out: dict[int, str] = {}
    for field in {c["field"] for c in claims}:
        buckets: list[list[dict]] = []
        for c in (c for c in claims if c["field"] == field):
            for b in buckets:
                if all(_agree(field, c["value"], k["value"]) for k in b):
                    b.append(c)
                    break
            else:
                buckets.append([c])
        for b in buckets:
            counts: dict[str, int] = {}
            for c in b:
                counts[c["value"]] = counts.get(c["value"], 0) + 1
            label = max(counts, key=lambda v: (counts[v], v.isascii(), -len(v)))
            for c in b:
                out[c["id"]] = label
    return out


def conflicts(claims: list[dict]) -> list[dict]:
    """Same field, clearly different values, from different statements."""
    out = []
    for field in sorted(SINGLE_VALUED):
        group = [c for c in claims if c["field"] == field and c["status"] != "rejected"]
        buckets: list[list[dict]] = []
        for c in group:
            # A value joins a group only if it agrees with every value already in it,
            # so "11th century" can't link "1026" and "1099" into one group.
            for b in buckets:
                if all(_agree(field, c["value"], k["value"]) for k in b):
                    b.append(c)
                    break
            else:
                buckets.append([c])
        if len(buckets) > 1:
            out.append({
                "field": field,
                "claims": [
                    {"claim_id": c["id"], "value": c["value"], "status": c["status"], "source": c["source"]}
                    for b in buckets for c in b
                ],
            })
    return out


def gaps(checklist: list[dict], claims: list[dict], sources: list[dict], has_location: bool) -> list[dict]:
    """Checklist items with no evidence yet."""
    live = [c for c in claims if c["status"] != "rejected"]
    fields = {c["field"] for c in live}
    tags = {s["tag"] for s in sources if s.get("tag")}
    have = {
        "exterior_photo": "exterior_photo" in tags,
        "interior_photo": "interior_photo" in tags,
        "inscription": "inscription" in tags or "inscription" in fields,
        "built_date": "built_date" in fields,
        "builder": "builder" in fields,
        "location": has_location or "location" in fields,
    }
    return [
        {"required_item": item["required_item"], "label": item["label"]}
        for item in checklist
        if not have.get(item["required_item"], False)
    ]
