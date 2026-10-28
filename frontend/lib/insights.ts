// What the monument page derives from a record, beyond listing facts.
// Pure functions over the GET /entities/{id} response: no extra API calls, easy to test.

import type { Claim, EntityDetail, EntitySource, SourceType } from "./types";

/** The documentation checklist for monuments (seeded in backend/schema.sql). */
export const MONUMENT_CHECKLIST: { required_item: string; label: string }[] = [
  { required_item: "exterior_photo", label: "Exterior photograph" },
  { required_item: "interior_photo", label: "Interior / structural photograph" },
  { required_item: "inscription", label: "Inscription photo or transcription" },
  { required_item: "built_date", label: "Date of construction" },
  { required_item: "builder", label: "Builder / patron" },
  { required_item: "location", label: "Reliable GPS location" },
];

/** Field notes and photos are the team's own records; scans and CSVs are copies of other documents. */
const FIELD_RECORD_TYPES: SourceType[] = ["note", "photo"];

const live = (claims: Claim[]) => claims.filter((c) => c.status !== "rejected");

export interface Corroboration {
  field: string;
  value: string;
  sources: number; // distinct sources that agree
}

/** Details where two or more different sources independently give the same answer. */
export function corroborated(e: EntityDetail): Corroboration[] {
  const byKey = new Map<string, { field: string; value: string; sources: Set<number> }>();
  for (const c of live(e.claims)) {
    const key = `${c.field}\u0000${c.value.trim().toLowerCase()}`;
    const entry = byKey.get(key) ?? { field: c.field, value: c.value, sources: new Set<number>() };
    entry.sources.add(c.source.id);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .filter((x) => x.sources.size >= 2)
    .map((x) => ({ field: x.field, value: x.value, sources: x.sources.size }));
}

export interface Summary {
  facts: number;
  verified: number;
  rejected: number;
  disputedFields: number;
  sourceTypes: Partial<Record<SourceType, number>>;
  checklistDone: number;
  checklistTotal: number;
}

export function summarise(e: EntityDetail): Summary {
  const sourceTypes: Partial<Record<SourceType, number>> = {};
  for (const s of e.sources) sourceTypes[s.type] = (sourceTypes[s.type] ?? 0) + 1;
  const missing = new Set(e.gaps.map((g) => g.required_item));
  return {
    facts: e.claims.length,
    verified: e.claims.filter((c) => c.status === "verified").length,
    rejected: e.claims.filter((c) => c.status === "rejected").length,
    disputedFields: e.conflicts.length,
    sourceTypes,
    checklistDone: MONUMENT_CHECKLIST.filter((i) => !missing.has(i.required_item)).length,
    checklistTotal: MONUMENT_CHECKLIST.length,
  };
}

/**
 * Lesser-known details: facts the backend flags as rarely documented elsewhere (`lesser_known`),
 * plus facts that come only from the team's own field notes and photos, never from a scanned
 * report or document. Disputed details and bare GPS locations are left out.
 */
export function fieldOnly(e: EntityDetail): { claim: Claim; flagged: boolean }[] {
  const typeOf = new Map<number, SourceType>(e.sources.map((s) => [s.id, s.type]));
  const disputed = new Set(e.conflicts.map((c) => c.field));
  const claims = live(e.claims);

  const seen = new Set<string>();
  const out: { claim: Claim; flagged: boolean }[] = [];
  for (const c of claims) {
    const key = `${c.field}\u0000${c.value.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    const backers = claims.filter((x) => `${x.field}\u0000${x.value.trim().toLowerCase()}` === key);
    const flagged = backers.some((x) => x.lesser_known);
    const onlyField = backers.every((x) => FIELD_RECORD_TYPES.includes(typeOf.get(x.source.id) ?? "pdf"));
    if (flagged || (onlyField && !disputed.has(c.field) && c.field !== "location")) {
      seen.add(key);
      out.push({ claim: c, flagged });
    }
  }
  return out;
}

export interface ComparisonRow {
  claim: Claim | null; // the full claim, when it's in the record
  value: string;
  source: EntitySource | { id: number; filename: string; type?: undefined; tag?: undefined };
  answer: number; // 0, 1, 2… one index per distinct answer, for colour-coding
}

/** One table row per source in a disagreement, with how each fact was read and how sure we are. */
export function comparisonRows(e: EntityDetail, field: string): ComparisonRow[] {
  const conflict = e.conflicts.find((c) => c.field === field);
  if (!conflict) return [];
  const answers = [...new Set(conflict.claims.map((c) => c.value))];
  return conflict.claims.map((cc) => ({
    claim: e.claims.find((c) => c.id === cc.claim_id) ?? null,
    value: cc.value,
    source: e.sources.find((s) => s.id === cc.source.id) ?? cc.source,
    answer: answers.indexOf(cc.value),
  }));
}
