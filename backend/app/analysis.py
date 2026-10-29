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


def to_latin(text: str) -> str:
    out = []
    chars = list(text)
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


def _same(a: str, b: str) -> bool:
    return a == b or SequenceMatcher(None, a, b).ratio() >= 0.85


def conflicts(claims: list[dict]) -> list[dict]:
    """Same field, clearly different values, from different statements."""
    out = []
    for field in sorted(SINGLE_VALUED):
        group = [c for c in claims if c["field"] == field and c["status"] != "rejected"]
        buckets: list[list[dict]] = []
        for c in group:
            key = normalise(field, c["value"])
            for b in buckets:
                if _same(key, normalise(field, b[0]["value"])):
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
