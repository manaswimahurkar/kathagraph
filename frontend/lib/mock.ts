// DEMO DATA: illustrative, not real archival records.
// Used while NEXT_PUBLIC_API_URL is empty or set to "mock". Shapes match CONTRACT.md.
// Two sources deliberately disagree on some monuments so the conflict view has something to show.

import type {
  Claim,
  ClaimStatus,
  ClaimStatusResponse,
  Conflict,
  EntitiesResponse,
  EntityDetail,
  EntitySource,
  Gap,
  SearchResponse,
  SourceDetail,
  SourceType,
  UploadResponse,
} from "./types";

/** Thrown by mock endpoints; lib/api.ts turns it into the same ApiError the real API gives. */
export class MockHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- files ----------
interface MockSource extends EntitySource {
  entity_id: number;
  lat: number | null;
  lng: number | null;
}

const SOURCES: MockSource[] = [
  { id: 101, entity_id: 1, filename: "demo_adalaj_fieldnote_A.txt", type: "note", tag: null, lat: null, lng: null },
  { id: 102, entity_id: 1, filename: "demo_adalaj_fieldnote_B.txt", type: "note", tag: null, lat: null, lng: null },
  { id: 103, entity_id: 1, filename: "demo_adalaj_exterior_01.jpg", type: "photo", tag: "exterior_photo", lat: 23.1667, lng: 72.5803 },
  { id: 104, entity_id: 1, filename: "demo_adalaj_exterior_02.jpg", type: "photo", tag: "exterior_photo", lat: 23.1666, lng: 72.5801 },
  { id: 105, entity_id: 1, filename: "demo_adalaj_plaque_scan_hi.pdf", type: "pdf", tag: null, lat: null, lng: null },
  { id: 201, entity_id: 2, filename: "demo_ranikivav_fieldnote.txt", type: "note", tag: null, lat: null, lng: null },
  { id: 202, entity_id: 2, filename: "demo_ranikivav_steps_01.jpg", type: "photo", tag: "exterior_photo", lat: 23.8589, lng: 72.1016 },
  { id: 203, entity_id: 2, filename: "demo_ranikivav_panels_02.jpg", type: "photo", tag: "interior_photo", lat: 23.859, lng: 72.1018 },
  { id: 204, entity_id: 2, filename: "demo_ranikivav_report_scan.pdf", type: "pdf", tag: null, lat: null, lng: null },
  { id: 301, entity_id: 3, filename: "demo_dadaharir_fieldnote.txt", type: "note", tag: null, lat: null, lng: null },
  { id: 302, entity_id: 3, filename: "demo_dadaharir_entrance.jpg", type: "photo", tag: "exterior_photo", lat: 23.0432, lng: 72.6049 },
];

// ---------- text chunks (what OCR / parsing produced) ----------
interface MockChunk {
  id: number;
  source_id: number;
  page: number | null;
  text: string;
}

const CHUNKS: MockChunk[] = [
  { id: 1001, source_id: 101, page: null, text: "Adalaj stepwell, five levels deep, cut in sandstone. The guide said it was finished in 1499 for Queen Rudabai, after her husband Rana Veer Singh died in battle." },
  { id: 1002, source_id: 102, page: null, text: "Second visit. The board at the entrance gives the construction year as 1498. Octagonal opening above the well; carvings of elephants and kalash motifs along the walls." },
  { id: 1003, source_id: 105, page: 1, text: "अडालज की बावड़ी का निर्माण रानी रूडाबाई ने अपने पति राणा वीर सिंह की स्मृति में करवाया था। यह पाँच मंज़िला है।" },
  { id: 2001, source_id: 201, page: null, text: "Rani ki Vav, Patan. Built around 1063 CE by Queen Udayamati in memory of King Bhima I of the Chaulukya dynasty. We counted 7 levels of steps down to the well." },
  { id: 2002, source_id: 204, page: 3, text: "The stepwell descends in six terraced levels, with more than 500 principal sculptures, most of them avatars of Vishnu. Inscribed as a UNESCO World Heritage Site in 2014." },
  { id: 3001, source_id: 301, page: null, text: "Dada Harir stepwell in Asarwa, Ahmedabad. Built in 1499 by Bai Harir Sultani during the reign of Mahmud Begada. Sandstone, five levels, Persian and Sanskrit inscriptions near the entrance." },
];

// ---------- claims (one fact from one source) ----------
interface MockClaim {
  id: number;
  entity_id: number;
  field: string;
  value: string;
  source_id: number;
  chunk_id: number | null;
  method: Claim["method"];
  confidence: number;
  status: ClaimStatus;
}

let nextClaimId = 1;
function c(entity_id: number, field: string, value: string, source_id: number, chunk_id: number | null, method: Claim["method"], confidence: number, status: ClaimStatus = "unverified"): MockClaim {
  return { id: nextClaimId++, entity_id, field, value, source_id, chunk_id, method, confidence, status };
}

const CLAIMS: MockClaim[] = [
  // Adalaj: two field notes disagree on the year
  c(1, "built_date", "1499", 101, 1001, "llm", 0.82),
  c(1, "built_date", "1498", 102, 1002, "llm", 0.77),
  c(1, "builder", "Queen Rudabai", 101, 1001, "llm", 0.9, "verified"),
  c(1, "builder", "Queen Rudabai", 105, 1003, "ocr", 0.64),
  c(1, "storeys", "5", 101, 1001, "llm", 0.88, "verified"),
  c(1, "material", "Sandstone", 101, 1001, "llm", 0.85),
  c(1, "location", "23.1667, 72.5803", 103, null, "exif", 0.99, "verified"),
  // Rani ki Vav: note and report disagree on the number of levels
  c(2, "built_date", "c. 1063 CE", 201, 2001, "llm", 0.8),
  c(2, "builder", "Queen Udayamati", 201, 2001, "llm", 0.91, "verified"),
  c(2, "dynasty", "Chaulukya (Solanki)", 201, 2001, "llm", 0.86),
  c(2, "storeys", "7", 201, 2001, "llm", 0.72),
  c(2, "storeys", "6", 204, 2002, "ocr", 0.69),
  c(2, "status", "UNESCO World Heritage Site (2014)", 204, 2002, "ocr", 0.93, "verified"),
  c(2, "location", "23.8589, 72.1016", 202, null, "exif", 0.99, "verified"),
  // Dada Harir: no disagreements yet, several gaps
  c(3, "built_date", "1499", 301, 3001, "llm", 0.84),
  c(3, "builder", "Bai Harir Sultani", 301, 3001, "llm", 0.87),
  c(3, "material", "Sandstone", 301, 3001, "llm", 0.8),
  c(3, "storeys", "5", 301, 3001, "llm", 0.78),
];

// ---------- monuments ----------
interface MockEntity {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
  aliases: { alias: string; language: string | null }[];
  gaps: Gap[];
}

const GAP = {
  interior: { required_item: "interior_photo", label: "Interior / structural photograph" },
  inscription: { required_item: "inscription", label: "Inscription photo or transcription" },
  location: { required_item: "location", label: "Reliable GPS location" },
} satisfies Record<string, Gap>;

const ENTITIES: MockEntity[] = [
  {
    id: 1, name: "Adalaj Stepwell", lat: 23.1667, lng: 72.5803,
    aliases: [
      { alias: "Adalaj ni Vav", language: "gu-Latn" },
      { alias: "Rudabai Stepwell", language: "en" },
      { alias: "अडालज की बावड़ी", language: "hi" },
    ],
    gaps: [GAP.interior, GAP.inscription],
  },
  {
    id: 2, name: "Rani ki Vav", lat: 23.8589, lng: 72.1016,
    aliases: [
      { alias: "The Queen's Stepwell", language: "en" },
      { alias: "રાણકી વાવ", language: "gu" },
      { alias: "रानी की वाव", language: "hi" },
    ],
    gaps: [GAP.inscription],
  },
  {
    id: 3, name: "Dada Harir Stepwell", lat: 23.0432, lng: 72.6049,
    aliases: [{ alias: "Bai Harir ni Vav", language: "gu-Latn" }],
    gaps: [GAP.interior, GAP.inscription, GAP.location],
  },
];

// ---------- helpers that mirror the backend logic ----------
const sourceById = (id: number) => SOURCES.find((s) => s.id === id)!;

/** Same rule as the claim_conflicts view: same entity + same field, >1 distinct value, rejected claims ignored. */
function conflictsFor(entityId: number): Conflict[] {
  const byField = new Map<string, MockClaim[]>();
  for (const cl of CLAIMS) {
    if (cl.entity_id !== entityId || cl.status === "rejected") continue;
    byField.set(cl.field, [...(byField.get(cl.field) ?? []), cl]);
  }
  const out: Conflict[] = [];
  for (const [field, list] of byField) {
    if (new Set(list.map((x) => x.value)).size < 2) continue;
    out.push({
      field,
      claims: list.map((x) => {
        const s = sourceById(x.source_id);
        return { claim_id: x.id, value: x.value, source: { id: s.id, filename: s.filename } };
      }),
    });
  }
  return out;
}

function toClaim(x: MockClaim): Claim {
  const s = sourceById(x.source_id);
  const chunk = CHUNKS.find((ch) => ch.id === x.chunk_id);
  return {
    id: x.id, field: x.field, value: x.value, method: x.method, confidence: x.confidence, status: x.status,
    source: { id: s.id, filename: s.filename, page: chunk?.page ?? null },
    evidence_text: chunk?.text ?? null,
  };
}

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

// ---------- mock endpoints ----------

export async function getEntities(): Promise<EntitiesResponse> {
  await delay();
  return {
    entities: ENTITIES.map((e) => ({
      id: e.id, name: e.name, type: "monument", lat: e.lat, lng: e.lng,
      n_sources: SOURCES.filter((s) => s.entity_id === e.id).length,
      n_conflicts: conflictsFor(e.id).length,
      n_gaps: e.gaps.length,
    })),
  };
}

export async function getEntity(id: number): Promise<EntityDetail> {
  await delay();
  const e = ENTITIES.find((x) => x.id === id);
  if (!e) throw new MockHttpError(404, `No monument with id ${id}.`);
  return {
    id: e.id, name: e.name, type: "monument", lat: e.lat, lng: e.lng,
    aliases: e.aliases,
    claims: CLAIMS.filter((x) => x.entity_id === id).map(toClaim),
    conflicts: conflictsFor(id),
    gaps: e.gaps,
    sources: SOURCES.filter((s) => s.entity_id === id).map(({ id, filename, type, tag }) => ({ id, filename, type, tag })),
  };
}

/** Keyword matching stands in for the backend's semantic search. */
export async function search(q: string, limit = 10): Promise<SearchResponse> {
  await delay(450);
  const query = q.trim();
  if (!query) throw new MockHttpError(400, "Type something to search for.");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = CHUNKS.map((ch) => {
    const text = ch.text.toLowerCase();
    return { ch, score: terms.filter((t) => text.includes(t)).length / terms.length };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ ch, score }) => {
      const s = sourceById(ch.source_id);
      const e = ENTITIES.find((x) => x.id === s.entity_id);
      return {
        chunk_id: ch.id,
        text: ch.text,
        score: Math.round(score * 100) / 100,
        source: { id: s.id, filename: s.filename, type: s.type, page: ch.page },
        entities: e ? [{ id: e.id, name: e.name }] : [],
      };
    });
  return { query, results };
}

export async function patchClaim(id: number, status: ClaimStatus): Promise<ClaimStatusResponse> {
  await delay(250);
  const cl = CLAIMS.find((x) => x.id === id);
  if (!cl) throw new MockHttpError(404, `No claim with id ${id}.`);
  cl.status = status;
  return { id, status };
}

// ---------- uploads: accepted, then "processed" in the background ----------
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = /\.(jpe?g|png|webp|tiff?|heic|pdf|txt|md|csv)$/i;

interface MockUpload {
  detail: SourceDetail;
  polls: number;
  failWith: string | null;
}
const UPLOADS = new Map<number, MockUpload>();
let nextSourceId = 900;

function typeOf(name: string): SourceType {
  if (/\.(jpe?g|png|webp|tiff?|heic)$/i.test(name)) return "photo";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.csv$/i.test(name)) return "csv";
  return "note";
}

export async function upload(files: File[]): Promise<UploadResponse> {
  await delay(500);
  const tooBig = files.find((f) => f.size > MAX_BYTES);
  if (tooBig) throw new MockHttpError(413, `${tooBig.name} is larger than 20 MB.`);
  const wrong = files.find((f) => !ALLOWED.test(f.name));
  if (wrong) throw new MockHttpError(400, `${wrong.name}: only photos, PDFs, text notes and CSV files can be uploaded.`);

  return {
    sources: files.map((f) => {
      const id = nextSourceId++;
      const type = typeOf(f.name);
      UPLOADS.set(id, {
        detail: { id, filename: f.name, type, status: "pending", error: null, lat: null, lng: null, file_url: null },
        polls: 0,
        failWith: f.size === 0 ? "The file is empty." : /blur/i.test(f.name) ? "OCR found no readable text." : null,
      });
      return { id, filename: f.name, type, status: "pending" as const };
    }),
  };
}

// Demo photos: real, freely licensed photos of these stepwells from Wikimedia Commons,
// loaded in the browser. Each stepwell's lead photo comes from its Wikipedia page summary.
const COMMONS = (file: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1200`;
const DEMO_PHOTOS: Record<number, { wiki?: string; url?: string }> = {
  103: { wiki: "Adalaj_Stepwell" },
  202: { wiki: "Rani_ki_Vav" },
  203: { url: COMMONS("Rani ki vav - Patan - Gujarat - Wall Decorations.jpg") },
  302: { wiki: "Dada_Harir_Stepwell" },
};

async function demoPhotoUrl(sourceId: number): Promise<string | null> {
  const p = DEMO_PHOTOS[sourceId];
  if (!p) return null;
  if (p.url) return p.url;
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${p.wiki}`);
    const body = await res.json();
    return body?.originalimage?.source ?? body?.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

export async function getSource(id: number): Promise<SourceDetail> {
  await delay(200);
  const archived = SOURCES.find((s) => s.id === id);
  if (archived) {
    return {
      id, filename: archived.filename, type: archived.type, status: "done", error: null,
      lat: archived.lat, lng: archived.lng,
      file_url: archived.type === "photo" ? await demoPhotoUrl(id) : null,
    };
  }
  const u = UPLOADS.get(id);
  if (!u) throw new MockHttpError(404, `No source with id ${id}.`);
  u.polls += 1;
  if (u.detail.status === "pending" && u.polls >= 1) u.detail.status = "processing";
  if (u.detail.status === "processing" && u.polls >= 3) {
    u.detail.status = u.failWith ? "failed" : "done";
    u.detail.error = u.failWith;
  }
  return { ...u.detail };
}
