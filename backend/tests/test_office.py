import zipfile
from io import BytesIO

import pytest

from app.office import OfficeError, expand_zip, read_docx, read_pptx

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
PHOTO = b"\xff\xd8" + b"x" * 20_000  # big enough to count as a photo, not an icon
ICON = b"\x89PNG" + b"x" * 500


def _zip(files: dict[str, bytes]) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


def _slide(title: str, body: list[str], images: list[str]) -> bytes:
    pics = "".join(f'<p:pic><p:blipFill><a:blip r:embed="{rid}"/></p:blipFill></p:pic>' for rid in images)
    paras = "".join(f"<a:p><a:r><a:t>{t}</a:t></a:r></a:p>" for t in body)
    return (f'<p:sld xmlns:p="{P}" xmlns:a="{A}" xmlns:r="{R}"><p:cSld><p:spTree>'
            f'<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
            f'<p:txBody><a:p><a:r><a:t>{title}</a:t></a:r></a:p></p:txBody></p:sp>'
            f'<p:sp><p:txBody>{paras}</p:txBody></p:sp>{pics}</p:spTree></p:cSld></p:sld>').encode()


def _rels(entries: dict[str, str]) -> bytes:
    rows = "".join(f'<Relationship Id="{i}" Type="x" Target="{t}"/>' for i, t in entries.items())
    return f'<Relationships xmlns="{PKG}">{rows}</Relationships>'.encode()


def _deck() -> bytes:
    notes = f'<p:notes xmlns:p="{P}" xmlns:a="{A}"><a:p><a:r><a:t>Caretaker says the well was restored in 2002.</a:t></a:r></a:p></p:notes>'.encode()
    return _zip({
        "ppt/slides/slide1.xml": _slide("Explorer Fellowship 2024", ["Team Patan"], []),
        "ppt/slides/slide2.xml": _slide("Adalaj Stepwell", ["Built 1499 by Queen Rudabai"], ["rId2", "rId3"]),
        "ppt/slides/slide10.xml": _slide("Rani ki Vav", ["Seven levels"], ["rId2"]),
        "ppt/slides/_rels/slide2.xml.rels": _rels({"rId2": "../media/image1.jpeg", "rId3": "../media/image2.png",
                                                   "rId9": "../notesSlides/notesSlide2.xml"}),
        "ppt/slides/_rels/slide10.xml.rels": _rels({"rId2": "../media/image3.jpg"}),
        "ppt/notesSlides/notesSlide2.xml": notes,
        "ppt/media/image1.jpeg": PHOTO,
        "ppt/media/image2.png": ICON,
        "ppt/media/image3.jpg": PHOTO + b"2",
    })


def test_deck_gives_one_page_per_slide_in_order_with_notes():
    doc = read_pptx(_deck(), "fellowship_deck")
    assert [p for p, _ in doc.pages] == [1, 2, 3]
    assert doc.title == "Explorer Fellowship 2024"
    assert "Slide 2: Adalaj Stepwell" in doc.pages[1][1] and "Queen Rudabai" in doc.pages[1][1]
    assert "Caretaker says the well was restored" in doc.pages[1][1]
    assert doc.pages[2][1].startswith("Slide 3: Rani ki Vav")


def test_deck_photos_carry_their_slide_title_and_icons_are_skipped():
    doc = read_pptx(_deck(), "fellowship_deck")
    names = [i.name for i in doc.images]
    assert names == ["Adalaj_Stepwell_fellowship_deck_slide2_1.jpeg", "Rani_ki_Vav_fellowship_deck_slide3_1.jpg"]
    assert doc.images[0].page == 2 and doc.images[0].context == "Adalaj Stepwell"


def test_word_report_text_and_images():
    body = (f'<w:document xmlns:w="{W}" xmlns:a="{A}" xmlns:r="{R}"><w:body>'
            '<w:p><w:r><w:t>Field report: Sun Temple, Modhera</w:t></w:r></w:p>'
            '<w:p><w:r><w:t>The kund has 108 shrines.</w:t></w:r></w:p>'
            '<w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p></w:body></w:document>').encode()
    data = _zip({"word/document.xml": body, "word/_rels/document.xml.rels": _rels({"rId5": "media/image1.jpeg"}),
                 "word/media/image1.jpeg": PHOTO})
    doc = read_docx(data, "report_2024")
    assert doc.pages == [(None, "Field report: Sun Temple, Modhera\nThe kund has 108 shrines.")]
    assert doc.images[0].name == "Field_report_Sun_Temple_Modhera_report_2024_image1.jpeg"


def test_folder_keeps_folder_names_and_skips_junk():
    data = _zip({"Adalaj Stepwell/IMG_01.JPG": PHOTO, "Adalaj Stepwell/notes.txt": b"Inscription on floor 1",
                 "__MACOSX/Adalaj Stepwell/._IMG_01.JPG": b"x", "Adalaj Stepwell/.DS_Store": b"x",
                 "Adalaj Stepwell/video.mp4": b"x"})
    files, skipped = expand_zip(data, (".jpg", ".txt"))
    assert sorted(n for n, _ in files) == ["Adalaj_Stepwell_IMG_01.jpg", "Adalaj_Stepwell_notes.txt"]
    assert skipped == ["Adalaj Stepwell/video.mp4"]


def test_damaged_files_give_a_clear_error():
    with pytest.raises(OfficeError):
        read_pptx(b"not a zip")
    with pytest.raises(OfficeError):
        read_docx(_zip({"x.txt": b"hi"}))
