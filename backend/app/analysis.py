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

TITLES = {"queen", "rani", "king", "raja", "rana", "sultan", "maharaja", "maharani", "emperor", "sri", "shri"}


def normalise(field: str, value: str) -> str:
    v = value.strip().lower()
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
