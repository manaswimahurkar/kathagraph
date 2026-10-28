# KathaGraph API contract

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
