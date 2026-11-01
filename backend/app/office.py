"""Reads the files fieldwork actually ends up in: slide decks (.pptx), Word reports (.docx) and
whole folders (.zip). Office files are ZIP archives of XML, so they are read directly, with no extra
dependencies.

- A deck becomes one page per slide (its text plus speaker notes), so a fact can be cited as "slide 3".
- Photos embedded in a deck or report come out as separate images, each named after the slide title
  or document title it sits under: that name carries the context ("Adalaj Stepwell") that lets the
  pipeline link the photo to its monument.
- A folder keeps its folder names in each file name for the same reason.
"""
import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from io import BytesIO
from xml.etree import ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/package/2006/relationships",
}
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
MIN_IMAGE_BYTES = 15_000      # smaller ones are logos, icons and bullets
MAX_IMAGES = 25               # per deck or report: each image costs an AI description
MAX_ZIP_FILES = 200
MAX_ZIP_TOTAL = 300 * 1024 * 1024


class OfficeError(ValueError):
    pass


@dataclass
class Image:
    name: str          # suggested file name carrying context
    data: bytes
    page: int | None   # slide number, if from a deck
    context: str       # slide or document title


@dataclass
class Document:
    pages: list[tuple[int | None, str]] = field(default_factory=list)
    images: list[Image] = field(default_factory=list)
    title: str = ""


def _open(data: bytes) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile as e:
        raise OfficeError("This file is damaged or not a real Office/ZIP file.") from e


def _slug(text: str, limit: int = 60) -> str:
    return re.sub(r"[^\w]+", "_", text, flags=re.UNICODE).strip("_")[:limit]


def _texts(xml: bytes, tag: str) -> list[str]:
    """Paragraph texts: runs (<a:t> or <w:t>) joined within each paragraph."""
    root = ET.fromstring(xml)
    para_tag = "{%s}p" % (NS["a"] if tag == "a" else NS["w"])
    run_tag = "{%s}t" % NS[tag]
    out = []
    for p in root.iter(para_tag):
        line = "".join(t.text or "" for t in p.iter(run_tag)).strip()
        if line:
            out.append(line)
    return out


def _rels(z: zipfile.ZipFile, part: str) -> dict[str, str]:
    """Relationship id -> target path, for one part of the package."""
    folder, name = posixpath.split(part)
    rel_path = posixpath.join(folder, "_rels", name + ".rels")
    if rel_path not in z.namelist():
        return {}
    out = {}
    for rel in ET.fromstring(z.read(rel_path)).iter("{%s}Relationship" % NS["r"]):
        if rel.get("TargetMode") == "External":
            continue
        out[rel.get("Id")] = posixpath.normpath(posixpath.join(folder, rel.get("Target", "")))
    return out


def _slide_title(xml: bytes) -> str:
    """The title placeholder's text, else the first line on the slide."""
    root = ET.fromstring(xml)
    for sp in root.iter("{%s}sp" % NS["p"]):
        ph = sp.find(".//p:nvPr/p:ph", NS)
        if ph is not None and ph.get("type") in ("title", "ctrTitle"):
            text = " ".join(t.text or "" for t in sp.iter("{%s}t" % NS["a"])).strip()
            if text:
                return text
    lines = _texts(xml, "a")
    return lines[0] if lines else ""


def _image_refs(xml: bytes) -> list[str]:
    root = ET.fromstring(xml)
    ids = [b.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
           for b in root.iter("{%s}blip" % NS["a"])]
    return [i for i in ids if i]


def read_pptx(data: bytes, stem: str = "deck") -> Document:
    z = _open(data)
    names = z.namelist()
    slides = sorted(
        (n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
        key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)),
    )
    if not slides:
        raise OfficeError("No slides found: is this a PowerPoint (.pptx) file?")
    doc = Document()
    seen_media: set[str] = set()
    for number, part in enumerate(slides, 1):
        xml = z.read(part)
        title = _slide_title(xml)
        if number == 1:
            doc.title = title
        lines = _texts(xml, "a")
        rels = _rels(z, part)
        # Speaker notes often hold the real field observations
        notes = [t for rid, target in rels.items() if "notesSlide" in target and target in names
                 for t in _texts(z.read(target), "a")]
        text = "\n".join(lines)
        if notes:
            text += "\n\nSpeaker notes:\n" + "\n".join(notes)
        if text.strip():
            doc.pages.append((number, f"Slide {number}: {title}\n{text}" if title else f"Slide {number}\n{text}"))
        for i, rid in enumerate(_image_refs(xml), 1):
            target = rels.get(rid)
            if not target or target in seen_media or not target.lower().endswith(IMAGE_EXT) or target not in names:
                continue
            seen_media.add(target)
            blob = z.read(target)
            if len(blob) < MIN_IMAGE_BYTES or len(doc.images) >= MAX_IMAGES:
                continue
            ext = posixpath.splitext(target)[1].lower()
            name = f"{_slug(title) or 'slide'}_{_slug(stem, 40)}_slide{number}_{i}{ext}"
            doc.images.append(Image(name=name, data=blob, page=number, context=title))
    return doc


def read_docx(data: bytes, stem: str = "report") -> Document:
    z = _open(data)
    if "word/document.xml" not in z.namelist():
        raise OfficeError("No document body found: is this a Word (.docx) file?")
    lines = _texts(z.read("word/document.xml"), "w")
    doc = Document(title=lines[0] if lines else stem)
    if lines:
        doc.pages.append((None, "\n".join(lines)))
    rels = _rels(z, "word/document.xml")
    for i, rid in enumerate(_image_refs(z.read("word/document.xml")), 1):
        target = rels.get(rid)
        if not target or not target.lower().endswith(IMAGE_EXT) or target not in z.namelist():
            continue
        blob = z.read(target)
        if len(blob) < MIN_IMAGE_BYTES or len(doc.images) >= MAX_IMAGES:
            continue
        ext = posixpath.splitext(target)[1].lower()
        doc.images.append(Image(name=f"{_slug(doc.title) or 'document'}_{_slug(stem, 40)}_image{i}{ext}",
                                data=blob, page=None, context=doc.title))
    return doc


def expand_zip(data: bytes, allowed: tuple[str, ...]) -> tuple[list[tuple[str, bytes]], list[str]]:
    """Files inside a folder archive, with folder names kept in the file name
    ("Adalaj Stepwell/IMG_01.jpg" -> "Adalaj_Stepwell_IMG_01.jpg"). Returns (files, skipped names)."""
    z = _open(data)
    files, skipped, total = [], [], 0
    for info in z.infolist():
        path = info.filename
        base = posixpath.basename(path)
        if info.is_dir() or path.startswith("__MACOSX/") or base.startswith((".", "~$")):
            continue
        if not base.lower().endswith(allowed):
            skipped.append(path)
            continue
        if len(files) >= MAX_ZIP_FILES:
            skipped.append(path)
            continue
        total += info.file_size
        if total > MAX_ZIP_TOTAL:
            raise OfficeError("This folder is too large once unpacked (over 300 MB).")
        folder = posixpath.dirname(path)
        stem, ext = posixpath.splitext(base)
        name = "_".join(p for p in (_slug(folder.replace("/", " ")), _slug(stem)) if p) + ext.lower()
        files.append((name, z.read(info)))
    return files, skipped
