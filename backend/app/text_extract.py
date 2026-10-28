"""Turns any uploaded file into plain text, page by page.

- Notes (.txt/.md) and CSVs: read directly.
- PDFs: use the built-in text layer; pages with no text layer (scans) are OCR'd.
- Photos: OCR'd, but text is kept only if Tesseract is confident it found real
  words, so ordinary monument photos don't fill the archive with gibberish.

OCR uses Tesseract with Hindi + English. It is installed in the Docker image
(Render). On a laptop without Tesseract, OCR is skipped with a clear message.
"""
import logging
from dataclasses import dataclass, field
from io import BytesIO

from PIL import Image, ImageOps

log = logging.getLogger("kathagraph.text")

OCR_LANGS = "hin+eng"
MAX_OCR_SIDE = 2000          # downscale big photos: faster, little accuracy loss
MAX_PDF_PAGES = 30
MIN_CONFIDENCE = 60          # per-word Tesseract confidence (0-100)
MIN_CONFIDENT_WORDS = 5      # fewer than this in a photo = "no real text"


class OcrUnavailable(RuntimeError):
    pass


_langs_cache: str | None = None


def _ocr_langs(pytesseract) -> str:
    """Use Hindi + English when the Hindi pack is installed, else English only."""
    global _langs_cache
    if _langs_cache is None:
        try:
            available = set(pytesseract.get_languages(config=""))
        except Exception:
            available = set()
        wanted = [l for l in OCR_LANGS.split("+") if l in available]
        _langs_cache = "+".join(wanted) or "eng"
        log.info("OCR languages: %s", _langs_cache)
    return _langs_cache


@dataclass
class Extracted:
    pages: list[tuple[int | None, str]] = field(default_factory=list)  # (page number, text)
    warning: str | None = None


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return data.decode(enc).replace("\r\n", "\n")
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace").replace("\r\n", "\n")


def _ocr_image(img: Image.Image, strict: bool) -> str:
    """OCR one image. strict=True keeps only confident words (for photos)."""
    try:
        import pytesseract
        from pytesseract import Output
    except ImportError as e:
        raise OcrUnavailable("pytesseract is not installed") from e

    img = ImageOps.exif_transpose(img).convert("RGB")
    if max(img.size) > MAX_OCR_SIDE:
        img.thumbnail((MAX_OCR_SIDE, MAX_OCR_SIDE))

    try:
        langs = _ocr_langs(pytesseract)
        if not strict:
            return pytesseract.image_to_string(img, lang=langs).strip()
        d = pytesseract.image_to_data(img, lang=langs, output_type=Output.DICT)
    except pytesseract.TesseractNotFoundError as e:
        raise OcrUnavailable("Tesseract OCR is not installed on this machine") from e

    # Rebuild lines from confident words only
    lines: dict[tuple, list[str]] = {}
    confident = 0
    for i, word in enumerate(d["text"]):
        word = (word or "").strip()
        try:
            conf = float(d["conf"][i])
        except (TypeError, ValueError):
            conf = -1
        if not word or conf < MIN_CONFIDENCE:
            continue
        confident += 1
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        lines.setdefault(key, []).append(word)
    if confident < MIN_CONFIDENT_WORDS:
        return ""
    return "\n".join(" ".join(words) for _, words in sorted(lines.items()))


def _from_pdf(data: bytes) -> Extracted:
    from pypdf import PdfReader

    out = Extracted()
    reader = PdfReader(BytesIO(data))
    n = len(reader.pages)
    if n > MAX_PDF_PAGES:
        out.warning = f"Only the first {MAX_PDF_PAGES} of {n} pages were read."
    scanned_pages = []
    for i, page in enumerate(reader.pages[:MAX_PDF_PAGES]):
        try:
            text = (page.extract_text() or "").strip()
        except Exception:
            text = ""
        if len(text) >= 20:
            out.pages.append((i + 1, text))
        else:
            scanned_pages.append(i)

    if scanned_pages:
        try:
            import pypdfium2 as pdfium

            pdf = pdfium.PdfDocument(data)
            for i in scanned_pages:
                img = pdf[i].render(scale=2).to_pil()
                text = _ocr_image(img, strict=False)
                if text:
                    out.pages.append((i + 1, text))
        except OcrUnavailable as e:
            out.warning = f"{len(scanned_pages)} scanned page(s) not read: {e}."
        out.pages.sort(key=lambda p: p[0] or 0)
    return out


def extract(kind: str, data: bytes) -> Extracted:
    if kind in ("note", "csv"):
        text = _decode(data).strip()
        return Extracted(pages=[(None, text)] if text else [])
    if kind == "pdf":
        return _from_pdf(data)
    if kind == "photo":
        try:
            text = _ocr_image(Image.open(BytesIO(data)), strict=True)
        except OcrUnavailable as e:
            return Extracted(warning=f"OCR skipped: {e}.")
        return Extracted(pages=[(None, text)] if text else [])
    return Extracted()


def detect_language(text: str) -> str:
    """'hi' if mostly Devanagari, 'en' if mostly Latin, else 'mixed'."""
    deva = sum(1 for c in text if "\u0900" <= c <= "\u097f")
    latin = sum(1 for c in text if c.isascii() and c.isalpha())
    total = deva + latin
    if total == 0:
        return "unknown"
    if deva / total > 0.7:
        return "hi"
    if latin / total > 0.7:
        return "en"
    return "mixed"


def chunk(text: str, size: int = 900, overlap: int = 150) -> list[str]:
    """Split text into ~size-character pieces on paragraph/sentence boundaries."""
    text = text.strip()
    if len(text) <= size:
        return [text] if text else []
    pieces, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            window = text[start:end]
            cut = max(window.rfind("\n\n"), window.rfind("\n"), window.rfind(". "), window.rfind("\u0964"))
            if cut > size // 2:
                end = start + cut + 1
        piece = text[start:end].strip()
        if piece:
            pieces.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return pieces
