// API shapes for KathaGraph — mirrors CONTRACT.md exactly.
// If CONTRACT.md changes, update this file (and lib/mock.ts) to match.

/** "web" = published reference text imported from the web (Wikipedia), never a field record. */
export type SourceType = "photo" | "pdf" | "note" | "csv" | "web" | "slides" | "doc";
export type SourceStatus = "pending" | "processing" | "done" | "failed";
export type ClaimMethod = "ocr" | "llm" | "exif" | "manual" | "import";
export type ClaimStatus = "unverified" | "verified" | "rejected";
export type EntityType = "monument" | "motif" | "craft" | "place" | "person";

/** GET /health */
export interface Health {
  ok: boolean;
  db: boolean;
  pgvector?: boolean;
  error?: string;
}

/** POST /upload (multipart, field "files") -> 202 */
export interface UploadedSource {
  id: number;
  filename: string;
  type: SourceType;
  /** "duplicate": identical content is already in the archive; nothing new was stored. */
  status: SourceStatus | "duplicate";
  duplicate_of?: number;
  error?: string | null;
}
export interface UploadResponse {
  sources: UploadedSource[];
  /** Files inside a .zip that the archive can't read (backend v1.0+). */
  skipped?: string[];
}

/** GET /sources/{id} — used to poll processing status */
export interface SourceDetail {
  id: number;
  filename: string;
  type: SourceType;
  status: SourceStatus;
  error: string | null;
  lat: number | null;
  lng: number | null;
  file_url: string | null;
}

/** GET /search?q=&limit= */
export interface SearchResult {
  chunk_id: number;
  text: string;
  score: number;
  source: {
    id: number; filename: string; type: SourceType; page: number | null;
    origin?: "web" | "field" | null; author?: string | null; licence?: string | null; source_url?: string | null;
  };
  entities: { id: number; name: string }[];
}
export interface SearchResponse {
  query: string;
  /** "semantic" = matched by meaning (Gemini embeddings); "keyword" = fallback word matching. */
  mode?: "semantic" | "keyword";
  results: SearchResult[];
}

/** GET /entities?type=monument */
export interface EntitySummary {
  id: number;
  name: string;
  type: EntityType;
  lat: number | null;
  lng: number | null;
  n_sources: number;
  n_conflicts: number;
  n_gaps: number;
  /** Optional: temple | stepwell | fort | mosque | tomb | cave | lake | palace | museum | site. Guessed from the name if absent. */
  category?: string | null;
  /** Optional: "approximate" when the pin is the location of a larger complex the site belongs to. */
  coord_precision?: "exact" | "approximate" | null;
  /** Optional: built, natural or settlement. Treated as built when absent. */
  nature?: SiteNature | null;
  /** Documentation health, 0-100 (backend v0.9+): checklist coverage plus the archive's own field record. */
  completeness?: number | null;
}
export interface EntitiesResponse {
  entities: EntitySummary[];
}

/** GET /entities/{id} */
export interface Alias {
  alias: string;
  language: string | null;
}

export interface Claim {
  id: number;
  field: string; // e.g. built_date, builder, material
  value: string;
  method: ClaimMethod;
  confidence: number | null; // 0..1
  status: ClaimStatus;
  source: { id: number; filename: string; page: number | null };
  evidence_text: string | null;
  /** Backend v0.9+: label shared by values that say the same thing ("Rudabai" / "रुडाबाई"). */
  group?: string;
  /**
   * Optional, not yet in CONTRACT.md: true when the backend has checked that this fact
   * is rarely documented elsewhere. The page also works without it.
   */
  lesser_known?: boolean;
}

export interface ConflictClaim {
  claim_id: number;
  value: string;
  source: { id: number; filename: string };
}
export interface Conflict {
  field: string;
  claims: ConflictClaim[];
}

export interface Gap {
  required_item: string; // e.g. interior_photo
  label: string; // e.g. "Interior / structural photograph"
}

export interface EntitySource {
  id: number;
  filename: string;
  type: SourceType;
  tag: string | null; // e.g. exterior_photo
  /** Returned by the backend since v0.5; optional so mock data still type-checks. */
  file_url?: string | null;
  /** AI description of a photo. Always label it as AI-written. */
  description?: string | null;
  /** Optional: where it came from. "web" = imported from Wikipedia/Wikimedia Commons; "field" = uploaded by a contributor. */
  origin?: "web" | "field" | null;
  /** Optional, for imported material: credit line and licence, e.g. "Bernard Gagnon", "CC BY-SA 3.0". */
  author?: string | null;
  licence?: string | null;
  /** Optional: the page it was imported from (Wikipedia article or Commons file page). */
  source_url?: string | null;
}

/** A 3D model of the monument: a Sketchfab embed, or a .glb/.gltf file stored by the archive. */
export interface EntityModel {
  id: number;
  provider: "sketchfab" | "file";
  uid?: string | null; // Sketchfab model id (provider = sketchfab)
  url?: string | null; // file URL (provider = file)
  title: string;
  author?: string | null;
  author_url?: string | null;
  licence?: string | null;
}

export interface EntityDetail {
  id: number;
  name: string;
  type: EntityType;
  lat: number | null;
  lng: number | null;
  aliases: Alias[];
  claims: Claim[];
  conflicts: Conflict[];
  gaps: Gap[];
  sources: EntitySource[];
  /** Optional (see EntitySummary). */
  category?: string | null;
  coord_precision?: "exact" | "approximate" | null;
  /** Optional: built, natural or settlement. Treated as built when absent. */
  nature?: SiteNature | null;
  /** Optional: 3D models stored for this monument. */
  models?: EntityModel[];
  /** Documentation health, 0-100 (backend v0.9+). */
  completeness?: number | null;
}

/** GET /priorities — the archive as a to-do list for the next field visit. Already sorted: most work first. */
export interface PriorityTodo {
  /** "document": evidence that's missing. "verify": sources disagree, so check it on site. */
  kind: "document" | "verify";
  item: string; // e.g. exterior_photo, built_date
  text: string; // human-readable, ready to show
}
export interface PriorityMonument {
  id: number;
  name: string;
  nature?: SiteNature | null;
  lat: number | null;
  lng: number | null;
  n_sources: number;
  n_gaps: number;
  n_conflicts: number;
  completeness?: number | null;
  todo: PriorityTodo[];
}
export interface PrioritiesResponse {
  totals: { monuments: number; missing_items: number; disagreements: number };
  monuments: PriorityMonument[];
}

/** POST /ask: an answer written only from the archive's records, with numbered citations. */
export interface AskCitation {
  n: number;
  chunk_id: number;
  excerpt: string;
  /** true if the answer actually cites this passage */
  used: boolean;
  source: {
    id: number;
    filename: string;
    type: SourceType;
    page: number | null;
    file_url?: string | null;
    origin?: "web" | "field" | null;
    author?: string | null;
    licence?: string | null;
    source_url?: string | null;
  };
}
export interface AskResponse {
  question: string;
  /** null when the archive holds nothing on the question (see `message`) */
  answer: string | null;
  confidence: "high" | "medium" | "low";
  disagreements: string[];
  not_recorded: string[];
  citations: AskCitation[];
  monuments: { id: number; name: string; n_conflicts: number; n_gaps: number }[];
  mode?: "semantic" | "keyword";
  message?: string;
}

/** GET /review: unverified AI facts, riskiest first. */
export interface ReviewClaim {
  id: number;
  entity: { id: number; name: string };
  field: string;
  field_label: string;
  value: string;
  quote: string | null;
  method: ClaimMethod;
  confidence: number | null;
  risk: number;
  reasons: string[];
  excerpt: string;
  source: { id: number; filename: string; origin?: "web" | "field" | null; file_url?: string | null; source_url?: string | null };
}
export interface ReviewResponse {
  totals: { unverified: number; verified: number; rejected: number; in_queue: number };
  claims: ReviewClaim[];
}

/** GET /timeline. Years BCE are negative. */
export interface TimelineVariant {
  value: string;
  span: [number, number] | null;
  sources: string[];
  verified: boolean;
}
export interface TimelineMonument {
  id: number;
  name: string;
  category: string;
  nature?: SiteNature | null;
  /** "founded" for settlements: the span is when it was founded or first settled. */
  date_meaning?: "built" | "founded" | null;
  dynasty: string | null;
  span: [number, number];
  verified: boolean;
  disputed: boolean;
  variants: TimelineVariant[];
}
export interface TimelineResponse {
  monuments: TimelineMonument[];
  undated: { id: number; name: string; category: string; dynasty: string | null; nature?: SiteNature | null; date_meaning?: "built" | "founded" | null }[];
  /** Natural sites: no construction date, so they're neither dated nor "undated". */
  natural?: { id: number; name: string; category: string; nature: SiteNature; lat: number | null; lng: number | null }[];
}

/** POST /inscription/read: an AI reading, never stored. */
export interface InscriptionReading {
  is_inscription: boolean;
  script: string;
  language: string;
  legibility: "good" | "partial" | "poor";
  transcription: string;
  transliteration?: string;
  translation_en: string;
  dates: { as_written: string; calendar: string; year?: number | null; common_era: [number, number] | null }[];
  names: string[];
  uncertain: string[];
  notice: string;
}

/** GET /duplicates: monuments that may be recorded twice. */
export interface DuplicateSide {
  id: number;
  name: string;
  aliases: string[];
  lat: number | null;
  lng: number | null;
  category: string;
  n_sources: number;
  n_claims: number;
}
export interface DuplicatePair {
  score: number;
  reasons: string[];
  a: DuplicateSide;
  b: DuplicateSide;
}
export interface DuplicatesResponse {
  pairs: DuplicatePair[];
  total: number;
}

/** PATCH /claims/{id} */
export interface ClaimStatusResponse {
  id: number;
  status: ClaimStatus;
}

/** Every error: { "detail": "human-readable message" } */
export interface ApiErrorBody {
  detail: string;
}

// ---------- display helpers ----------

const FIELD_LABELS: Record<string, string> = {
  built_date: "Date of construction",
  builder: "Builder / patron",
  dynasty: "Dynasty",
  material: "Material",
  storeys: "Number of levels",
  architectural_style: "Architectural style",
  purpose: "Purpose",
  inscription: "Inscription",
  status: "Protection status",
  heritage_status: "Heritage status",
  location: "Location",
};

/** What kind of site: something people built, a natural place, or a whole settlement or landscape. */
export type SiteNature = "built" | "natural" | "settlement";

/** The label for a fact's field, adjusted to the kind of site (a town is founded, not built). */
export function fieldLabelFor(field: string, nature?: SiteNature | null): string {
  if (nature === "settlement") {
    if (field === "built_date") return "Date of founding";
    if (field === "builder") return "Founder or culture";
  }
  return fieldLabel(field);
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const TAG_LABELS: Record<string, string> = {
  exterior_photo: "Exterior photo",
  interior_photo: "Interior photo",
  inscription: "Inscription",
  carving_detail: "Carving detail",
  other: "Photo",
  notes: "Field notes",
  reference: "Published reference",
  report: "Report",
};

export function tagLabel(tag: string | null): string | null {
  if (!tag) return null;
  return TAG_LABELS[tag] ?? tag.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// ---------- Living heritage, journeys, digital twin, readable sources (v1.1) ----------

/** GET /sources/{id}/text: a file's text page by page, with English translations of Hindi/Gujarati. */
export interface SourceText {
  source: {
    id: number; filename: string; type: SourceType; status: SourceStatus; error: string | null;
    file_url: string | null; source_url: string | null; origin: "web" | "field" | null;
    author: string | null; licence: string | null; created_at: string; parent_source_id: number | null;
  };
  pages: { page: number | null; text: string; language: string; text_en: string | null }[];
  entities: { id: number; name: string; type: string }[];
  embedded_photos: { id: number; filename: string; file_url: string | null; tag: string | null }[];
}

export interface Story {
  id: number;
  story: string;
  quote: string | null;
  confidence: number | null;
  status: ClaimStatus;
  method: string;
  entity: { id: number; name: string; type: string; category: string };
  lat: number | null;
  lng: number | null;
  precision: "exact" | "approximate" | null;
  source: { id: number; filename: string; origin: "web" | "field" | null; author: string | null; url: string | null };
  photo?: PhotoCredit | null;
}
export interface PhotoCredit { url: string; author: string | null; licence: string | null }
export interface StoriesResponse { stories: Story[]; places: number }

export interface JourneyStop {
  id: number | null; name: string; lat: number; lng: number;
  n_sources?: number; at?: string; photos?: number; timed?: boolean; thumb?: string | null;
}
export interface Journey {
  id: string; kind: "trail" | "field"; title: string; stops: JourneyStop[]; km: number;
  category?: string; team?: string; start?: string; end?: string; timed?: boolean; photos?: number;
}
export interface JourneysResponse { trails: Journey[]; field: Journey[] }

export interface CraftFact { value: string; quote: string | null; status: ClaimStatus; source_id: number; filename: string }
export interface CraftPlace { name: string; lat: number; lng: number; how: string; precision: string; entity_id?: number }
export interface Craft {
  id: number; name: string; aliases: string[]; facts: Record<string, CraftFact[]>;
  places: CraftPlace[]; n_sources: number; photos: PhotoCredit[]; missing: string[];
}
export interface CraftsResponse { crafts: Craft[] }

export interface TwinShot {
  id: number; url: string; tag: string | null; author: string | null;
  side: number | null; distance_m: number | null; heading: number | null;
}
export interface TwinReport {
  entity: { id: number; name: string; lat: number | null; lng: number | null };
  photos: number; placed: number; coverage: number[]; sides: string[]; kinds: Record<string, number>;
  score: number; stage: "starting" | "collecting" | "ready" | "modelled"; models: number;
  todo: string[]; shots: TwinShot[]; target: number;
}
