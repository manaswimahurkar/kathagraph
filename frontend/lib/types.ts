// API shapes for KathaGraph — mirrors CONTRACT.md exactly.
// If CONTRACT.md changes, update this file (and lib/mock.ts) to match.

/** "web" = published reference text imported from the web (Wikipedia), never a field record. */
export type SourceType = "photo" | "pdf" | "note" | "csv" | "web";
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
  /** Optional: 3D models stored for this monument. */
  models?: EntityModel[];
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
  lat: number | null;
  lng: number | null;
  n_sources: number;
  n_gaps: number;
  n_conflicts: number;
  todo: PriorityTodo[];
}
export interface PrioritiesResponse {
  totals: { monuments: number; missing_items: number; disagreements: number };
  monuments: PriorityMonument[];
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
