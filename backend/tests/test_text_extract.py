"""Reading text from notes, chunking it, and detecting its language."""
from app.text_extract import chunk, detect_language, extract


def test_note_in_two_scripts_is_read_and_line_endings_cleaned():
    data = "Adalaj Stepwell, completed in 1499.\r\nअडालज की वाव".encode("utf-8")
    result = extract("note", data)
    assert result.pages == [(None, "Adalaj Stepwell, completed in 1499.\nअडालज की वाव")]


def test_empty_note_gives_no_text():
    assert extract("note", b"   ").pages == []


def test_language_detection():
    assert detect_language("अडालज की वाव") == "hi"
    assert detect_language("Adalaj stepwell") == "en"
    assert detect_language("अडालज की वाव Adalaj stepwell") == "mixed"


def test_short_text_is_one_chunk():
    assert chunk("A short note.") == ["A short note."]


def test_long_text_is_split_without_losing_content():
    text = "Sentence about the stepwell. " * 100
    pieces = chunk(text, size=300, overlap=50)
    assert len(pieces) > 1
    assert all(len(p) <= 300 for p in pieces)
    assert pieces[0].startswith("Sentence") and text.strip().endswith(pieces[-1][-20:])
