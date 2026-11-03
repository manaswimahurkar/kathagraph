// Fellowship and field teams, rebuilt from upload credits. The upload form stores
// "Your name · Programme or cohort" (e.g. "Asha Patel · Explorer Fellowship 2024") on every file.
// Files are grouped by the cohort part, spelled loosely: "Explorer Fellowship 2024" and
// "explorer  fellowship 2024" are the same team.

import { slugify } from "./exportData";
import type { EntityDetail, SourceListItem } from "./types";

export interface Credit {
  person: string | null;
  team: string;
  /** true when the credit named a programme or cohort, not only a person */
  cohort: boolean;
}

const IGNORE = new Set(["former contributor", "unattributed field team"]);

export function parseCredit(author: string | null | undefined): Credit | null {
  const a = (author ?? "").replace(/\s+/g, " ").trim();
  if (!a || IGNORE.has(a.toLowerCase())) return null;
  const parts = a.split(" · ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { person: parts.slice(0, -1).join(" · "), team: parts[parts.length - 1], cohort: true };
  return { person: null, team: parts[0], cohort: false };
}

export function monthYear(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "";
}

export const teamKey = (team: string) => slugify(team);

/** Sources contributed in the field (not imported from the web). */
export function isFieldSource(s: SourceListItem): boolean {
  return s.origin === "field" || (s.origin == null && s.type !== "web");
}

export interface TeamSummary {
  key: string;
  name: string;
  cohort: boolean;
  members: string[];
  sources: SourceListItem[];
  photos: number;
  documents: number;
  first: string | null;
  last: string | null;
}

export function groupTeams(sources: SourceListItem[]): TeamSummary[] {
  const by = new Map<string, { spellings: Map<string, number>; members: Set<string>; cohort: boolean; sources: SourceListItem[] }>();
  for (const s of sources) {
    if (!isFieldSource(s) || s.status === "failed") continue;
    const c = parseCredit(s.author);
    if (!c) continue;
    const key = teamKey(c.team);
    const g = by.get(key) ?? { spellings: new Map<string, number>(), members: new Set<string>(), cohort: false, sources: [] as SourceListItem[] };
    g.spellings.set(c.team, (g.spellings.get(c.team) ?? 0) + 1);
    if (c.person) g.members.add(c.person);
    g.cohort ||= c.cohort;
    g.sources.push(s);
    by.set(key, g);
  }
  const out: TeamSummary[] = [];
  for (const [key, g] of by) {
    const name = [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const dates = g.sources.map((s) => s.captured_at ?? s.created_at).filter(Boolean).sort();
    out.push({
      key,
      name,
      cohort: g.cohort,
      members: [...g.members].sort(),
      sources: g.sources,
      photos: g.sources.filter((s) => s.type === "photo").length,
      documents: g.sources.filter((s) => s.type !== "photo").length,
      first: dates[0] ?? null,
      last: dates[dates.length - 1] ?? null,
    });
  }
  // programmes and cohorts first, then by how much they contributed
  return out.sort((a, b) => Number(b.cohort) - Number(a.cohort) || b.sources.length - a.sources.length);
}

export interface SiteContribution {
  entity: EntityDetail;
  sourceIds: number[];
  facts: EntityDetail["claims"];
  /** fields where this team is the only source (rejected facts aside) */
  onlySource: string[];
  /** fields where another source says the same value */
  confirms: string[];
  /** fields where this team's value differs from another source's */
  questions: string[];
  /** photo kinds (exterior_photo…) no other source in the archive has */
  firstPhotos: string[];
}

export function contributionAt(entity: EntityDetail, team: Set<number>): SiteContribution {
  const live = entity.claims.filter((c) => c.status !== "rejected");
  const mine = live.filter((c) => team.has(c.source.id));
  const fields = (cs: typeof live) => [...new Set(cs.map((c) => c.field))];
  const norm = (v: string) => v.trim().toLowerCase();

  const onlySource = fields(mine).filter((f) => live.filter((c) => c.field === f).every((c) => team.has(c.source.id)));
  const confirms = fields(
    mine.filter((m) => live.some((o) => !team.has(o.source.id) && o.field === m.field && (norm(o.value) === norm(m.value) || (o.group && o.group === m.group)))),
  );
  const conflictFields = new Set(entity.conflicts.map((c) => c.field));
  const questions = fields(mine.filter((m) => conflictFields.has(m.field))).filter((f) => !onlySource.includes(f));

  const tagsOf = (mineSide: boolean) =>
    new Set(entity.sources.filter((s) => s.type === "photo" && s.tag && team.has(s.id) === mineSide).map((s) => s.tag as string));
  const others = tagsOf(false);
  const firstPhotos = [...tagsOf(true)].filter((t) => !others.has(t) && t !== "other");

  return {
    entity,
    sourceIds: entity.sources.filter((s) => team.has(s.id)).map((s) => s.id),
    facts: entity.claims.filter((c) => team.has(c.source.id)),
    onlySource,
    confirms,
    questions,
    firstPhotos,
  };
}
