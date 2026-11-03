// Open data: download a monument's record, or the whole archive, as CSV (opens in Excel / Google Sheets)
// or JSON (for code). Every fact keeps its exact quote, its source, the source's credit and licence,
// and its review status, so the data stays evidence-aware outside KathaGraph too.

import { fieldLabelFor, type EntityDetail, type EntitySummary } from "./types";
import { originOf } from "./insights";

export const SITE_URL = "https://kathagraph.vercel.app";

export const STATUS_MEANING: Record<string, string> = {
  unverified: "Read from the source by AI; not yet checked by a person",
  verified: "Checked against the source by a reviewer",
  rejected: "Checked by a reviewer and found wrong; kept for transparency",
};

export interface FactRow {
  monument_id: number;
  monument: string;
  field: string;
  field_label: string;
  value: string;
  quote: string;
  status: string;
  disputed: "yes" | "no";
  confidence: string;
  method: string;
  source_id: number;
  source_file: string;
  source_page: string;
  source_origin: string;
  source_credit: string;
  source_licence: string;
  source_link: string;
  record_url: string;
}

/** One row per fact, with its quote, source and status. */
export function factRows(e: EntityDetail): FactRow[] {
  const sources = new Map(e.sources.map((s) => [s.id, s]));
  const disputed = new Set(e.conflicts.map((c) => c.field));
  return e.claims.map((c) => {
    const s = sources.get(c.source.id);
    return {
      monument_id: e.id,
      monument: e.name,
      field: c.field,
      field_label: fieldLabelFor(c.field, e.nature),
      value: c.value,
      quote: c.evidence_text ?? "",
      status: c.status,
      disputed: disputed.has(c.field) ? "yes" : "no",
      confidence: c.confidence == null ? "" : c.confidence.toFixed(2),
      method: c.method,
      source_id: c.source.id,
      source_file: c.source.filename,
      source_page: c.source.page == null ? "" : String(c.source.page),
      source_origin: s ? originOf(s) : "",
      source_credit: s?.author ?? "",
      source_licence: s?.licence ?? "",
      source_link: s?.source_url ?? s?.file_url ?? "",
      record_url: `${SITE_URL}/monument/${e.id}`,
    };
  });
}

/** One row per monument: where it is and how well documented. */
export function monumentRow(e: EntitySummary | EntityDetail) {
  const d = "claims" in e ? e : null;
  return {
    id: e.id,
    name: e.name,
    nature: e.nature ?? "built",
    category: e.category ?? "",
    lat: e.lat ?? "",
    lng: e.lng ?? "",
    location_precision: e.coord_precision ?? "",
    documentation_percent: e.completeness ?? "",
    sources: d ? d.sources.length : (e as EntitySummary).n_sources,
    facts: d ? d.claims.length : "",
    verified_facts: d ? d.claims.filter((c) => c.status === "verified").length : "",
    disagreements: d ? d.conflicts.length : (e as EntitySummary).n_conflicts,
    missing: d ? d.gaps.map((g) => g.label).join("; ") : (e as EntitySummary).n_gaps,
    aliases: d ? d.aliases.map((a) => a.alias).join("; ") : "",
    record_url: `${SITE_URL}/monument/${e.id}`,
  };
}

export const DATA_NOTES = {
  status: STATUS_MEANING,
  licences:
    "Each source carries its own credit and licence (e.g. Wikipedia text is CC BY-SA). Reuse a fact under its source's terms and credit that source.",
  conflicts: "Fields where sources give different values. All values are kept; none is chosen silently.",
  gaps: "Evidence the archive still lacks for this site.",
};

/** The JSON form of one record: the archive's own data, plus what the fields mean. */
export function recordJson(e: EntityDetail) {
  return {
    exported_from: "KathaGraph, an evidence-aware heritage archive of Gujarat",
    record_url: `${SITE_URL}/monument/${e.id}`,
    exported_at: new Date().toISOString(),
    notes: DATA_NOTES,
    monument: e,
  };
}

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text. Starts with a byte-order mark so Excel shows Hindi and Gujarati correctly. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "﻿";
  const cols = Object.keys(rows[0]);
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "record"
  );
}

/** Save text as a file on the visitor's device. */
export function saveFile(filename: string, text: string, type: "csv" | "json") {
  const blob = new Blob([text], { type: type === "csv" ? "text/csv;charset=utf-8" : "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Run `fn` over items, a few at a time, reporting progress. */
export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onProgress?: (done: number) => void,
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch {
        out[i] = null;
      }
      onProgress?.(++done);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
