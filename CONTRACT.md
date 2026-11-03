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

## Added Sun 1 Nov (backend v0.9)

- `POST /ask` `{ "question": "...", "entity_id": 12 | null }` → answer from the archive's own records only:
  `{ question, answer, confidence: "high"|"medium"|"low", disagreements: [string], not_recorded: [string],
     citations: [{ n, chunk_id, excerpt, used, source: { id, filename, type, page, file_url, origin, author, licence, source_url } }],
     monuments: [{ id, name, n_conflicts, n_gaps }], mode: "semantic"|"keyword", message? }`.
  The answer cites passages as `[n]` (only numbers that exist); `answer` is null with a `message` when the archive has nothing.
  503 without a Gemini key, 502 if Gemini fails.
- `completeness` (0–100) on `/entities`, `/entities/{id}` and `/priorities` rows: checklist coverage plus the archive's own field record.
- Gujarati: OCR reads Gujarati (`guj+hin+eng`); `language` can be `"gu"`; Gujarati names match their Hindi/English spellings.
- `GET /review?limit=30` → `{ totals: {unverified, verified, rejected, in_queue}, claims: [{ id, entity: {id, name}, field, field_label, value, quote, method, confidence, risk, reasons: [string], excerpt, source: {id, filename, origin, file_url, source_url} }] }`, riskiest first. Verify/reject with `PATCH /claims/{id}`.
- `GET /timeline` → `{ monuments: [{ id, name, category, dynasty, span: [startYear, endYear], verified, disputed, variants: [{ value, span, sources, verified }] }], undated: [{ id, name, category, dynasty }] }`. Years BCE are negative.
- `POST /inscription/read` (multipart `file`: jpg/png/webp ≤ 15 MB) → `{ is_inscription, script, language, legibility, transcription, transliteration, translation_en, dates: [{ as_written, calendar, year, common_era: [lo, hi] | null }], names, uncertain, notice }`. Nothing is stored.

## Added Sun 1 Nov evening (backend v1.0) — needs `backend/migrations/2026-11-01_decks_and_merge.sql`

- `POST /upload` now also accepts **`.pptx`** (type `"slides"`, ≤ 50 MB), **`.docx`** (type `"doc"`, ≤ 50 MB) and **`.zip`** folders (≤ 100 MB, ≤ 200 files; unpacked, folder names kept in file names as context). Optional form fields `contributor` and `cohort` are stored as the source's `author` ("Asha Patel · Explorer Fellowship 2024"). Response adds `skipped: [names]` for files in a zip the archive can't read.
  Decks: one page per slide (text + speaker notes), so facts cite "page" = slide number. Photos inside decks/reports become their own `photo` sources (`parent_source_id` = the deck), named after their slide title, credited like the parent, and linked to the parent's monument when the deck is about one.
- `GET /duplicates?limit=30` → `{ pairs: [{ score, reasons, a: {id, name, aliases, lat, lng, category, n_sources, n_claims}, b: {…} }], total }`.
- `POST /entities/{keep_id}/merge` `{ duplicate_id }` → moves facts, files, aliases, models and location onto `keep_id`, deletes the duplicate → `{ kept: {id, name}, merged }`.
- `POST /duplicates/dismiss` `{ a, b }` → remembered as different places; never suggested again.

## v1.2: built, natural and settlement sites

Needs `backend/migrations/2026-11-02_site_nature.sql`.

- `nature`: `"built" | "natural" | "settlement"` on every monument in `GET /entities`, `GET /entities/{id}` and `GET /priorities` rows, and on every item of `GET /timeline`.
  - `built`: a structure people made (temples, stepwells, forts, mosques, tombs, palaces, man-made lakes and tanks, bridges).
  - `natural`: mountains, hills, islands, natural lakes, forests, caves that weren't carved.
  - `settlement`: towns, villages, ancient cities and cultural landscapes that contain many structures.
- Filled from Wikidata "instance of" (P31) on import, or for all monuments with `POST /admin/classify-nature` (202). `PATCH /entities/{id}` accepts `nature`; a value set by hand is never overwritten by Wikidata.
- `GET /timeline` → `{ monuments, undated, natural }`:
  - each item in `monuments` and `undated` has `nature` and `date_meaning`: `"founded"` for settlements (the span is when it was founded or first settled), `"built"` otherwise;
  - natural sites are left out of `monuments` and `undated` and listed in `natural: [{ id, name, category, nature, lat, lng }]`.
- Checklists and `completeness` follow the kind of site:
  - natural: exterior photo, location, protection status (`heritage_status`), sacred or historical associations (`associations`: any legend, purpose, dynasty or builder fact). No date or builder gaps and no "check the date of construction" tasks.
  - settlement: "Date of founding" and "Founder or culture" (a `dynasty` fact counts) instead of date of construction and builder; no interior photo.
- `POST /entities/{id}/redate` (202): reads the monument's own texts again for its date of construction (or founding for a settlement) only, never a discovery, restoration or heritage-listing year.

## v1.1: translations, living heritage, digital twins

Needs `backend/migrations/2026-11-02_translations_and_stories.sql`.

- `GET /sources/{id}/text` → `{ source, chunks, pages: [{ page, text, language, text_en }], entities: [{ id, name, type }], embedded_photos: [{ id, filename, file_url, tag }] }`. `text_en` is a machine translation of a Hindi/Gujarati page, or null.
- `GET /stories` → `{ stories: [{ id, story, quote, confidence, status, method, entity: { id, name, type, category }, lat, lng, precision, source: { id, filename, origin, author, url } }], places }`.
- `GET /journeys` → `{ trails: [Journey], field: [Journey] }`, `Journey = { id, kind: "trail" | "field", title, stops: [{ id, name, lat, lng, … }], km, category?, team?, start?, end?, timed?, photos? }`.
- `GET /crafts` → `{ crafts: [{ id, name, aliases, facts: { field: [{ value, quote, status, source_id, filename }] }, places: [{ name, lat, lng, how, precision, entity_id? }], n_sources, photos, missing }] }`.
- `GET /entities/{id}/twin` → `{ photos, placed, coverage: [8 counts, N clockwise], sides, kinds, score, stage: "starting" | "collecting" | "ready" | "modelled", models, todo, shots: [{ id, url, tag, author, side, distance_m, heading }], target }`.
- `GET /entities/{id}/photo-bundle` → zip of photos + `cameras.csv`.
- Admin backfills (202): `POST /admin/translate`, `POST /admin/extract-stories` (`?recheck_crafts=true` reads craft articles again). `POST /import/wikipedia` accepts `kind: "craft"`.

## v1.3: admin token and rate limits

- Maintenance endpoints need the header `X-Admin-Token: <ADMIN_TOKEN>` (401 without it, 403 if the server has no token set): `DELETE /sources/{id}`, `POST /sources/{id}/reprocess`, `POST /import/wikipedia`, `POST /import/wikidata`, `POST /entities/{id}/redate`, and every `/admin/*`.
- Rate limits per client IP → `429 { detail: "Too many … requests. Try again in N s." }`: `/ask` 20/min, `/inscription/read` 10/min, `/upload` 30/min.
- `GET /health` adds `pool: { pooled, size, available, waiting, max }`.

## v1.4: contributor accounts

Needs `backend/migrations/2026-11-03_accounts.sql`. Accounts are optional; every endpoint works signed out.

- `POST /auth/signup` `{ name, email, password (≥8), reason? }` → `201 { token, user: { id, name, email, reason, created_at } }`; 409 if the email exists. Rate-limited (10/min per client).
- `POST /auth/login` `{ email, password }` → `{ token, user }`; 401 "Email or password is wrong."
- `POST /auth/logout` (Bearer) → 204.
- `GET /me` (Bearer) → `{ user, email_verified: false, totals: { uploads, facts, verified, rejected, monuments }, uploads: [{ id, filename, type, status, created_at, n_facts, entities: [{id, name}] }], reviews: [{ id, field, value, status, reviewed_at, entity_id, entity_name }] }`; 401 when signed out. `PATCH /me` `{ name?, reason? }`.
- Send `Authorization: Bearer <token>` on `/upload` and `PATCH /claims/{id}`: uploads get `contributor_id` (and the account name as credit if the form gives none); reviews record `reviewed_by` and `reviewed_at`.
- `POST /me/delete` (Bearer) `{ password }` → 204: deletes the account and its sessions; uploads and reviews stay, unlinked, credited to "Former contributor". 403 on a wrong password.
- Emails are only ever returned to their owner. Passwords are stored as salted scrypt hashes; only a SHA-256 of each session token is stored; sessions last 30 days.

## v1.5: admin console

- `GET /admin/status` (X-Admin-Token) → `{ files: {status: n}, file_types: {type: n}, failed: [{id, filename, type, error, created_at}], waiting: [...], facts: {status: n}, entities: {built|natural|settlement|craft|…: n}, translated_sources, users: [{id, name, email, reason, created_at, uploads, reviews}], recent: [...] }`.
- The `/admin` page uses it plus the existing admin endpoints; the token is kept in sessionStorage for the tab only.
