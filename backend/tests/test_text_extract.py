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


def _old_chunker(text, size=900, overlap=150):
    """The chunker used before v0.8: overlapping starts could fall mid-word."""
    text = text.strip()
    pieces, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            w = text[start:end]
            cut = max(w.rfind("\n\n"), w.rfind("\n"), w.rfind(". "), w.rfind("।"))
            if cut > size // 2:
                end = start + cut + 1
        p = text[start:end].strip()
        if p:
            pieces.append(p)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return pieces


def _sample_text(seed):
    import random
    rnd = random.Random(seed)
    words = "temple stepwell carved king queen built century stone river pilgrims inscription Solanki Patan".split()
    out = []
    for _ in range(rnd.randint(20, 120)):
        s = " ".join(rnd.choice(words) for _ in range(rnd.randint(3, 30)))
        out.append(s.capitalize() + rnd.choice([". ", ".\n", "। ", ", "]))
    return "".join(out), {w.lower() for w in words}


def test_passages_start_and_end_on_whole_words():
    for seed in range(100):
        text, vocab = _sample_text(seed)
        for piece in chunk(text):
            first, last = piece.split()[0], piece.split()[-1]
            assert first.strip(".,।").lower() in vocab, (seed, piece[:30])
            assert last.strip(".,।").lower() in vocab, (seed, piece[-30:])


def test_passages_prefer_to_start_at_a_sentence():
    text = ("The stepwell was built by Queen Udayamati in memory of King Bhima. " * 40).strip()
    for piece in chunk(text)[1:]:
        assert piece.startswith("The stepwell"), piece[:30]


def test_stitch_rebuilds_text_cut_by_the_old_chunker():
    from app.text_extract import stitch
    for seed in range(100):
        text, _ = _sample_text(seed)
        assert stitch(_old_chunker(text)) == text.strip()
