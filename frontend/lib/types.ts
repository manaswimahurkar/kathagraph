// API shapes for KathaGraph — mirrors CONTRACT.md exactly.
// If CONTRACT.md changes, update this file (and lib/mock.ts) to match.

export type SourceType = "photo" | "pdf" | "note" | "csv";
export type SourceStatus = "pending" | "processing" | "done" | "failed";
export type ClaimMethod = "ocr" | "llm" | "exif" | "manual";
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
  status: SourceStatus;
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
  source: { id: number; filename: string; type: SourceType; page: number | null };
  entities: { id: number; name: string }[];
}
export interface SearchResponse {
  query: string;
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
  status: "Protection status",
  location: "Location",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const TAG_LABELS: Record<string, string> = {
  exterior_photo: "Exterior photo",
  interior_photo: "Interior photo",
  inscription: "Inscription",
  notes: "Field notes",
  report: "Report",
};

export function tagLabel(tag: string | null): string | null {
  if (!tag) return null;
  return TAG_LABELS[tag] ?? tag.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
