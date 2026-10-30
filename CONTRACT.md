# KathaGraph API contract

> **Live API:** https://kathagraph-api.onrender.com · interactive docs at `/docs`. Status: all endpoints below are implemented (backend v0.5.0).

The frontend and backend both build against this file. If you change a shape, update it here and tell your partner.

Database tables: see `backend/schema.sql`.

---

## `GET /health`
```json
{ "ok": true, "db": true, "pgvector": true }
```

---

## `POST /upload`
`multipart/form-data`, field `files` (one or more files).

Response `202 Accepted`. Processing (EXIF → OCR → embed → claims) happens in the background.
```json
{
  "sources": [
    { "id": 12, "filename": "adalaj_inscription.jpg", "type": "photo", "status": "pending" }
  ]
}
```

## `GET /sources/{id}`
Used to poll processing status.
```json
{
  "id": 12, "filename": "adalaj_inscription.jpg", "type": "photo",
  "status": "done",               // pending | processing | done | failed
  "error": null,
  "lat": 23.1667, "lng": 72.5800,
  "file_url": "https://.../adalaj_inscription.jpg"
}
```

---

## `GET /search?q=<text>&limit=10`
Semantic search over chunks. Works for English and Hindi queries.
```json
{
  "query": "who built the stepwell",
  "results": [
    {
      "chunk_id": 88,
      "text": "…the stepwell was commissioned by…",
      "score": 0.82,
      "source": { "id": 4, "filename": "field_report_2024.pdf", "type": "pdf", "page": 3 },
      "entities": [ { "id": 1, "name": "Adalaj Stepwell" } ]
    }
  ]
}
```

---

## `GET /entities?type=monument`
Feeds the map.
```json
{
  "entities": [
    { "id": 1, "name": "Adalaj Stepwell", "type": "monument",
      "lat": 23.1667, "lng": 72.5800,
      "n_sources": 14, "n_conflicts": 1, "n_gaps": 2 }
  ]
}
```

## `GET /entities/{id}`
The main page: what we know, where the facts come from, where sources disagree, and what's missing.
```json
{
  "id": 1, "name": "Adalaj Stepwell", "type": "monument",
  "lat": 23.1667, "lng": 72.5800,
  "aliases": [ { "alias": "अडालज की वाव", "language": "hi" } ],

  "claims": [
    {
      "id": 31, "field": "built_date", "value": "1498",
      "method": "llm", "confidence": 0.7, "status": "unverified",
      "source": { "id": 4, "filename": "field_report_2024.pdf", "page": 3 },
      "evidence_text": "…completed in 1498…"
    }
  ],

  "conflicts": [
    {
      "field": "built_date",
      "claims": [
        { "claim_id": 31, "value": "1498", "source": { "id": 4, "filename": "field_report_2024.pdf" } },
        { "claim_id": 40, "value": "1499", "source": { "id": 9, "filename": "notes_team_b.txt" } }
      ]
    }
  ],

  "gaps": [
    { "required_item": "interior_photo", "label": "Interior / structural photograph" },
    { "required_item": "inscription",    "label": "Inscription photo or transcription" }
  ],

  "sources": [
    { "id": 4, "filename": "field_report_2024.pdf", "type": "pdf", "tag": null },
    { "id": 7, "filename": "IMG_2231.jpg", "type": "photo", "tag": "exterior_photo" }
  ]
}
```

## `PATCH /claims/{id}`
A researcher verifies or rejects a claim.
```json
// request
{ "status": "verified" }
// response
{ "id": 31, "status": "verified" }
```

---

## Errors (every endpoint)
```json
{ "detail": "human-readable message" }
```
- `400` bad input (wrong file type, empty query)
- `404` not found
- `413` file too large (limit: 20 MB)
- `500` unexpected (logged)

> Example values above (dates, coordinates, names) are placeholders showing the shape only. Don't treat them as facts.


---

## Added during the build (backend v0.5.0)

All of these are live; the shapes above are unchanged, only extra fields were added.

| Endpoint | What it does |
|---|---|
| `GET /sources?limit=100` | List uploaded files, newest first: `{ "sources": [ { id, filename, type, status, error, lat, lng, captured_at, file_url, tag, description, created_at } ] }` |
| `GET /sources/{id}/text` | Text extracted from one file: `{ "source": {...}, "chunks": [ { id, page, language, text } ] }` |
| `POST /sources/{id}/reprocess` | Run the pipeline again on one file → `202 { id, status: "pending" }` |
| `POST /entities` | Register a monument by hand: body `{ name, type?, lat?, lng?, aliases? }` → `201` + the full monument (same shape as `GET /entities/{id}`) |
| `PATCH /entities/{id}` | Fix a monument's `name` or set `lat`/`lng` → the full monument |
| `POST /admin/reindex` | Build search vectors for text that has none yet → `{ "embedded": n }` |
| `POST /admin/reprocess` | Re-run the pipeline on every file (slow; runs in the background) → `{ "queued": n }` |

**Extra fields**
- `GET /search` → adds `"mode": "semantic" | "keyword"`, and per result `language` and `source.file_url`.
- `GET /entities` → each monument also has `n_claims`.
- `GET /entities/{id}` → each source has `tag` (`exterior_photo` / `interior_photo` / `inscription` / `carving_detail` / `other`), `description` (AI description of a photo, label it as AI), `lat`, `lng`, `status`; each conflict claim has `status`.
- `sources[].status` while processing: `pending` → `processing` → `done` | `failed`. When `done`, `error` may hold a warning (e.g. "OCR skipped"); show it as a note, not a failure.

---

## Added Thu afternoon (backend v0.7)

| Endpoint | What it does |
|---|---|
| `POST /import/wikipedia` | Body `{ "titles": ["Rani ki vav"], "hindi": true }` → `202 { queued: [...] }`. Imports English (+ Hindi) Wikipedia text as sources of type `web` (CC BY-SA, attribution in the stored text), runs extraction, links to the monument, sets coordinates. |
| `GET /priorities` | Monuments ranked by fieldwork needed: `{ totals: {monuments, missing_items, disagreements}, monuments: [{ id, name, lat, lng, n_sources, n_gaps, n_conflicts, todo: [{ kind: "document" \| "verify", item, text }] }] }` |
| `POST /entities/{id}/models` | JSON `{ "sketchfab_url": "..." }` or multipart field `file` (.glb/.gltf, ≤ 50 MB) → `201 { id, provider: "sketchfab" \| "file", uid, url, title, author, author_url, licence }`. 400 bad link/file type, 413 too large, 404 unknown monument. |

**New fields**
- `GET /entities` and `GET /entities/{id}`: `category` (`temple | stepwell | fort | mosque | tomb | cave | lake | palace | museum | site`, from the name) and `coord_precision` (`"exact" | "approximate" | null` when no location).
- `GET /entities/{id}`: `models: [...]` (same shape as the POST response).
- `PATCH /entities/{id}`: also accepts `coord_precision`.
- Source `type` can be `web` (published reference, never a field record).

## Added Fri 30 Oct (backend v0.8)

- `GET /search` → shape unchanged. Passages now start and end on whole words (sentences where possible), and at most **2 passages per source** are returned, so one long article can't fill the page.
- `POST /admin/rechunk?after_id=0&batch=5` → re-splits stored text with the new chunker (no OCR or fact extraction re-run; facts keep pointing at the passage holding their quote). Call repeatedly with the returned `next_after_id` until it is `null`.
  → `{ "rechunked": {source_id: n_passages}, "unchanged": [ids], "failed": {id: error}, "next_after_id": id | null }`
- Monument matching: names that fit many places ("Jama Mosque", "temples on the island", "५ मन्दिर") no longer create or join a monument. In an imported Wikipedia article they mean the article's own monument; elsewhere those facts are skipped.
- `category`: "temple" is now checked before "lake", so "Temples at Narayan Sarovar" is a temple.
- **Provenance on every source** (needs `backend/migrations/2026-10-30_provenance.sql`): sources in `/entities/{id}`, `/sources/{id}` and `/search` results carry
  `origin` (`"field"` = uploaded by a contributor, `"web"` = imported from Wikipedia / Wikidata / Commons), `author`, `licence`, `source_url`. Claims' `source` also has `origin` and `source_url`.
- `POST /import/wikidata` `{ "entity_ids": [..] | null, "photos": true }` → `202 { "queued": [ids] }`. For monuments with an imported English Wikipedia article:
  Wikidata facts (`built_date`, `builder`, `architectural_style`, `material`, `heritage_status`) stored as source `wikidata_Q….txt` (CC0) with one quoted line per fact, `method: "import"`;
  coordinates when the monument has none; the item's main photo from Wikimedia Commons as a `photo` source with `origin: "web"`, `author`, `licence`, `source_url` (free licences only).
- `/priorities` todo: new items `own_photo` ("Only a published photo so far: take our own photographs") and `field_record` ("No field record yet, only published references: write field notes on site").
