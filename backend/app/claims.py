"""Pulls structured facts ("claims") out of archive text, and describes photos.

Design rule: the AI only *proposes* claims. Each claim keeps the exact quote
it came from, its method and a confidence, and starts as "unverified" until a
researcher verifies or rejects it. The AI never decides what is true; where
sources disagree, both claims are kept and shown side by side.
"""
import re

from . import gemini

FIELDS = [
    "built_date", "builder", "dynasty", "location",
    "architectural_style", "material", "purpose", "inscription",
]
# Fields where two different values from two sources = a genuine conflict
SINGLE_VALUED = {"built_date", "builder", "dynasty", "location"}
ENTITY_TYPES = ["monument", "motif", "craft", "place", "person"]
PHOTO_TAGS = ["exterior_photo", "interior_photo", "inscription", "carving_detail", "other"]
MAX_TEXT = 12000

# The model's own confidence is not trusted on its own. A claim whose quoted
# evidence really appears in the source is capped at 0.9 (a verbatim fact can
# still be misread); one whose quote can't be found is capped at 0.5.
MAX_CONF_QUOTE_FOUND = 0.9
MAX_CONF_QUOTE_MISSING = 0.5

CLAIMS_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "entities": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "type": {"type": "STRING", "enum": ENTITY_TYPES},
                    "aliases": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "claims": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "field": {"type": "STRING", "enum": FIELDS},
                                "value": {"type": "STRING"},
                                "quote": {"type": "STRING"},
                                "confidence": {"type": "NUMBER"},
                            },
                            "required": ["field", "value", "quote", "confidence"],
                        },
                    },
                },
                "required": ["name", "type", "aliases", "claims"],
            },
        }
    },
    "required": ["entities"],
}

CLAIMS_PROMPT = """You extract facts about Indian cultural heritage from field documents, for a research archive.

Rules:
- Use ONLY facts explicitly stated in the text below. Never add outside knowledge, even if you know it.
- For every claim, `quote` must be the exact words from the text that state it, copied verbatim in the original language.
- Entity `name`: the common English name (for example "Adalaj Stepwell"), even when the text is in Hindi or Gujarati. List every other spelling or script of that name that appears in the text in `aliases`.
- built_date: the year in CE as digits only (for example "1499"). If the text uses Vikram Samvat, convert by subtracting 57. If only a century is given, write it like "15th century".
- builder: the person who commissioned or built it, name only, without titles such as Queen, Rani, King or Sultan.
- location: town and district, for example "Adalaj, Gandhinagar".
- inscription: only when the text quotes or transcribes an inscription.
- confidence (0 to 1): how clearly the TEXT states the fact, not whether you believe it is historically true.
- If the text contains no heritage facts, return {{"entities": []}}.

Text from the file "{filename}":
---
{text}
---"""

PHOTO_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "tag": {"type": "STRING", "enum": PHOTO_TAGS},
        "description": {"type": "STRING"},
        "has_text": {"type": "BOOLEAN"},
    },
    "required": ["tag", "description", "has_text"],
}

PHOTO_PROMPT = """This photo comes from a field archive of Indian architectural heritage.
1. tag: exterior_photo (outside view of a structure), interior_photo (inside a structure: corridors, wells, chambers),
   inscription (a carved or painted inscription or text panel), carving_detail (close-up of carvings or motifs), or other.
2. description: one or two plain, factual sentences on what is visible (structure, materials, carvings, any script).
3. has_text: true only if the photo contains readable writing (an inscription, a sign, a document, printed or handwritten text).
Do NOT guess the monument's name, date or history."""


def _normalise(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def quote_in_source(quote: str, text: str) -> bool:
    """Does the AI's quoted evidence really occur in the source text?"""
    q = _normalise(quote)
    return len(q) >= 3 and q in _normalise(text)


def calibrate(model_confidence: float, quote: str, text: str) -> float:
    cap = MAX_CONF_QUOTE_FOUND if quote_in_source(quote, text) else MAX_CONF_QUOTE_MISSING
    return round(min(model_confidence, cap), 2)


def extract(text: str, filename: str) -> list[dict]:
    """Return [{name, type, aliases, claims:[{field, value, quote, confidence}]}]."""
    text = text.strip()[:MAX_TEXT]
    if len(text) < 20:
        return []
    result = gemini.generate_json(
        [{"text": CLAIMS_PROMPT.format(filename=filename, text=text)}], CLAIMS_SCHEMA
    )
    entities = []
    for ent in result.get("entities", []):
        name = (ent.get("name") or "").strip()
        if not name:
            continue
        claims = []
        for c in ent.get("claims", []):
            value = str(c.get("value", "")).strip()
            if c.get("field") in FIELDS and value:
                try:
                    conf = max(0.0, min(1.0, float(c.get("confidence", 0.5))))
                except (TypeError, ValueError):
                    conf = 0.5
                quote = str(c.get("quote", "")).strip()
                claims.append({"field": c["field"], "value": value,
                               "quote": quote, "confidence": calibrate(conf, quote, text)})
        entities.append({
            "name": name,
            "type": ent.get("type") if ent.get("type") in ENTITY_TYPES else "monument",
            "aliases": [a.strip() for a in ent.get("aliases", []) if isinstance(a, str) and a.strip()],
            "claims": claims,
        })
    return entities


def describe_photo(data: bytes) -> dict:
    """Return {tag, description, has_text} for a photo."""
    result = gemini.generate_json([{"text": PHOTO_PROMPT}, gemini.image_part(data)], PHOTO_SCHEMA)
    tag = result.get("tag") if result.get("tag") in PHOTO_TAGS else "other"
    has_text = result.get("has_text")
    return {
        "tag": tag,
        "description": str(result.get("description", "")).strip(),
        "has_text": has_text if isinstance(has_text, bool) else True,  # unsure -> run OCR
    }
