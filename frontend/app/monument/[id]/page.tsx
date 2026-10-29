"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Model3D from "@/components/Model3D";
import PhotoGallery from "@/components/PhotoGallery";
import SiteWalkthrough from "@/components/SiteWalkthrough";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { ApiError, getEntity, setClaimStatus } from "@/lib/api";
import { comparisonRows, corroborated, fieldOnly, MONUMENT_CHECKLIST, summarise } from "@/lib/insights";
import { modelsFor } from "@/lib/models";
import { fieldLabel, tagLabel, type Claim, type ClaimStatus, type EntityDetail } from "@/lib/types";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string; notFound: boolean }
  | { kind: "ready"; entity: EntityDetail };

export default function MonumentPage() {
  const { id } = useParams<{ id: string }>();
  const entityId = Number(id);
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(
    (quiet = false) => {
      if (!Number.isInteger(entityId) || entityId <= 0) {
        setState({ kind: "error", message: `"${id}" isn't a valid monument id.`, notFound: true });
        return;
      }
      if (!quiet) setState({ kind: "loading" });
      getEntity(entityId)
        .then((entity) => setState({ kind: "ready", entity }))
        .catch((e: Error) => {
          if (quiet) return; // keep showing what we have
          setState({ kind: "error", message: e.message, notFound: e instanceof ApiError && e.status === 404 });
        });
    },
    [entityId, id],
  );

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (state.kind === "ready") document.title = `${state.entity.name} · KathaGraph`;
  }, [state]);

  // After the page renders, jump to #source-… if the link had one (e.g. from search).
  useEffect(() => {
    if (state.kind !== "ready" || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [state.kind]);

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-4xl px-4 pb-16 pt-6 sm:pt-8">
      <Link href="/" className="text-[15px] text-water underline-offset-4 hover:underline">
        Back to the map
      </Link>

      {state.kind === "loading" && <MonumentSkeleton />}

      {state.kind === "error" && (
        <div className="mt-8">
          {state.notFound ? (
            <EmptyState title="This monument isn't in the archive">
              {state.message}{" "}
              <Link href="/" className="text-water underline underline-offset-2">
                Pick one on the map
              </Link>
            </EmptyState>
          ) : (
            <ErrorState title="Couldn't load this monument" message={state.message} onRetry={() => load()} />
          )}
        </div>
      )}

      {state.kind === "ready" && <MonumentRecord entity={state.entity} onChanged={() => load(true)} />}
    </main>
  );
}

// ---------------------------------------------------------------------------

function MonumentRecord({ entity, onChanged }: { entity: EntityDetail; onChanged: () => void }) {
  // Citation numbers [1], [2]… follow the order of the Sources list.
  const citation = new Map(entity.sources.map((s, i) => [s.id, i + 1]));
  const disputed = new Set(entity.conflicts.map((c) => c.field));

  const models = modelsFor(entity.name, entity.aliases.map((a) => a.alias));

  return (
    <article className="mt-5">
      <Model3D name={entity.name} models={models} />
      <header className="pb-8">
        <p className="text-[13px] tracking-wide text-ochre">Record no. {String(entity.id).padStart(3, "0")}</p>
        <h1 className="mt-1 font-display text-[2.6rem] leading-[1.05] sm:text-6xl">{entity.name}</h1>
        {entity.aliases.length > 0 && (
          <p className="mt-2 text-[17px] text-dust">
            Also recorded as{" "}
            {entity.aliases.map((a, i) => (
              <span key={a.alias}>
                <span lang={a.language ?? undefined} className="text-ink">
                  {a.alias}
                </span>
                {i < entity.aliases.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        )}
        {entity.lat != null && entity.lng != null && (
          <p className="mt-1 text-sm text-dust">
            {entity.lat.toFixed(4)}° N, {entity.lng.toFixed(4)}° E
          </p>
        )}

        <nav aria-label="On this page" className="mt-5 flex flex-wrap gap-2 text-sm">
          <JumpLink href="#facts">{entity.claims.length} facts</JumpLink>
          <JumpLink href="#disagreements" tone={entity.conflicts.length ? "ochre" : undefined}>
            {entity.conflicts.length} {entity.conflicts.length === 1 ? "disagreement" : "disagreements"}
          </JumpLink>
          <JumpLink href="#missing">{entity.gaps.length} missing</JumpLink>
          {entity.lat != null && <JumpLink href="#visit">Walk through</JumpLink>}
          <JumpLink href="#sources">{entity.sources.length} sources</JumpLink>
          <JumpLink href="#contribute">Add material</JumpLink>
        </nav>
      </header>

      <PhotoGallery sources={entity.sources} citation={citation} />
      <AtAGlance entity={entity} />
      <FieldOnly entity={entity} citation={citation} />
      <KnownFacts claims={entity.claims} citation={citation} disputed={disputed} onChanged={onChanged} />
      <Disagreements entity={entity} citation={citation} />
      <MissingDocs entity={entity} />
      {entity.lat != null && entity.lng != null && (
        <Section
          id="visit"
          title="Walk through the site"
          intro="Explore the monument in Google Street View or from above, as it looks today."
        >
          <SiteWalkthrough name={entity.name} lat={entity.lat} lng={entity.lng} />
        </Section>
      )}
      <SourceList entity={entity} />
      <Contribute entity={entity} />
    </article>
  );
}

function JumpLink({ href, tone, children }: { href: string; tone?: "ochre"; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`rounded-full border px-3 py-1 ${
        tone === "ochre" ? "border-ochre/40 bg-ochre-soft text-ochre" : "border-line bg-paper text-ink hover:border-ink/40"
      }`}
    >
      {children}
    </a>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-28 pb-10">
      <div className="kg-frieze mb-7" aria-hidden="true" />
      <h2 id={`${id}-h`} className="font-display text-3xl">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-[15px] text-dust">{intro}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Cite({ sourceId, n, page }: { sourceId: number; n?: number; page?: number | null }) {
  return (
    <a
      href={`#source-${sourceId}`}
      className="whitespace-nowrap text-water underline decoration-water/40 underline-offset-2 hover:decoration-water"
      title="Go to this source"
    >
      [{n ?? "?"}]{page != null ? ` p. ${page}` : ""}
    </a>
  );
}

// ---------- Known facts ----------

const STATUS_STYLE: Record<ClaimStatus, string> = {
  verified: "bg-water-soft text-water",
  unverified: "border border-dashed border-dust/60 text-dust",
  rejected: "bg-rust-soft text-rust",
};

const METHOD_LABEL: Record<Claim["method"], string> = {
  ocr: "read by OCR",
  llm: "extracted by AI",
  exif: "from photo GPS",
  manual: "entered by hand",
};

function KnownFacts({
  claims,
  citation,
  disputed,
  onChanged,
}: {
  claims: Claim[];
  citation: Map<number, number>;
  disputed: Set<string>;
  onChanged: () => void;
}) {
  return (
    <Section
      id="facts"
      title="Known facts"
      intro="Each fact is one claim from one source. The AI suggests; a researcher verifies or rejects."
    >
      {claims.length === 0 ? (
        <EmptyState title="No facts extracted yet">
          Facts appear here once uploaded files finish processing.{" "}
          <Link href="/upload" className="text-water underline underline-offset-2">
            Upload files
          </Link>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-paper">
          {claims.map((c) => (
            <FactRow key={c.id} claim={c} n={citation.get(c.source.id)} disputed={disputed.has(c.field)} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function FactRow({ claim, n, disputed, onChanged }: { claim: Claim; n?: number; disputed: boolean; onChanged: () => void }) {
  const [status, setStatus] = useState<ClaimStatus>(claim.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setStatus(claim.status), [claim.status]);

  async function change(next: ClaimStatus) {
    const prev = status;
    setStatus(next); // optimistic
    setBusy(true);
    setError(null);
    try {
      await setClaimStatus(claim.id, next);
      onChanged(); // refresh conflicts in the background
    } catch (e) {
      setStatus(prev);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rejected = status === "rejected";

  return (
    <li className="grid gap-x-6 gap-y-1 px-4 py-4 sm:grid-cols-[180px_1fr]">
      <div className="text-sm text-dust sm:pt-1">
        {fieldLabel(claim.field)}
        {disputed && (
          <a href="#disagreements" className="mt-0.5 block text-[13px] text-ochre underline-offset-2 hover:underline">
            Sources disagree
          </a>
        )}
      </div>
      <div>
        <p className={`font-serif text-xl ${rejected ? "text-dust line-through" : ""}`}>
          {claim.value} <Cite sourceId={claim.source.id} n={n} page={claim.source.page} />
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-dust">
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[status]}`}>{status}</span>
          <span>
            {METHOD_LABEL[claim.method]}
            {claim.confidence != null && `, ${Math.round(claim.confidence * 100)}% confidence`}
          </span>
          <span className="truncate">{claim.source.filename}</span>
        </div>

        {claim.evidence_text && (
          <details className="group mt-2">
            <summary className="cursor-pointer text-[13px] text-water select-none">Show the passage</summary>
            <blockquote className="mt-2 border-l-2 border-line pl-3 font-serif text-[15px] leading-relaxed italic text-ink/85">
              {claim.evidence_text}
            </blockquote>
          </details>
        )}

        <div className="mt-2.5 flex gap-2">
          {status !== "verified" && (
            <button
              disabled={busy}
              onClick={() => change("verified")}
              className="rounded border border-water/40 px-2.5 py-1 text-[13px] font-medium text-water hover:bg-water-soft disabled:opacity-50"
            >
              Verify
            </button>
          )}
          {status !== "rejected" && (
            <button
              disabled={busy}
              onClick={() => change("rejected")}
              className="rounded border border-line px-2.5 py-1 text-[13px] text-dust hover:border-rust/40 hover:text-rust disabled:opacity-50"
            >
              Reject
            </button>
          )}
          {status !== "unverified" && (
            <button
              disabled={busy}
              onClick={() => change("unverified")}
              className="rounded px-2 py-1 text-[13px] text-dust underline-offset-2 hover:underline disabled:opacity-50"
            >
              Undo
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-1.5 text-[13px] text-rust">
            Couldn't save: {error}
          </p>
        )}
      </div>
    </li>
  );
}

// ---------- Sources disagree: side-by-side comparison ----------

const ANSWER_STYLE = ["bg-ochre-soft text-ochre", "bg-water-soft text-water", "bg-rust-soft text-rust", "bg-sand text-ink"];

function Disagreements({ entity, citation }: { entity: EntityDetail; citation: Map<number, number> }) {
  return (
    <Section
      id="disagreements"
      title="Sources disagree"
      intro="Where sources give different answers, each one is compared side by side. KathaGraph doesn't pick a winner: verify or reject the facts above to settle it."
    >
      {entity.conflicts.length === 0 ? (
        <EmptyState title="No disagreements between sources">
          Sources that mention the same detail give the same answer (rejected facts are left out).
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {entity.conflicts.map((conflict) => {
            const rows = comparisonRows(entity, conflict.field);
            const answers = [...new Set(rows.map((r) => r.value))];
            return (
              <div key={conflict.field}>
                <h3 className="font-medium text-ochre">
                  {fieldLabel(conflict.field)}: {rows.length} sources, {answers.length} different answers
                </h3>
                <p className="mt-1 flex flex-wrap items-center gap-2 font-display text-2xl sm:text-3xl">
                  {answers.map((a, i) => (
                    <span key={a} className="flex items-center gap-2">
                      {i > 0 && <span className="font-serif text-xl text-ochre" aria-label="versus">≠</span>}
                      <span className={`rounded-sm px-2 py-0.5 ${ANSWER_STYLE[i % ANSWER_STYLE.length]}`}>{a}</span>
                    </span>
                  ))}
                </p>
                <div className="mt-3 overflow-x-auto rounded-sm border border-line">
                  <table className="w-full min-w-[560px] text-left text-[14px]">
                    <caption className="sr-only">Comparison of sources for {fieldLabel(conflict.field)}</caption>
                    <thead className="bg-sand/60 text-[13px] text-dust">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Answer</th>
                        <th scope="col" className="px-3 py-2 font-medium">Source</th>
                        <th scope="col" className="px-3 py-2 font-medium">Kind</th>
                        <th scope="col" className="px-3 py-2 font-medium">How it was read</th>
                        <th scope="col" className="px-3 py-2 font-medium">Confidence</th>
                        <th scope="col" className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((r) => (
                        <tr key={`${r.source.id}-${r.value}`}>
                          <td className="px-3 py-2.5">
                            <span className={`rounded-sm px-2 py-0.5 font-serif text-[16px] ${ANSWER_STYLE[r.answer % ANSWER_STYLE.length]}`}>
                              {r.value}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="break-all">{r.source.filename}</span>{" "}
                            <Cite sourceId={r.source.id} n={citation.get(r.source.id)} page={r.claim?.source.page} />
                          </td>
                          <td className="px-3 py-2.5 text-dust">{r.source.type ? TYPE_LABEL[r.source.type] : "–"}</td>
                          <td className="px-3 py-2.5 text-dust">{r.claim ? METHOD_LABEL[r.claim.method] : "–"}</td>
                          <td className="px-3 py-2.5 text-dust">
                            {r.claim?.confidence != null ? `${Math.round(r.claim.confidence * 100)}%` : "–"}
                          </td>
                          <td className="px-3 py-2.5">
                            {r.claim ? (
                              <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${STATUS_STYLE[r.claim.status]}`}>
                                {r.claim.status}
                              </span>
                            ) : (
                              "–"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.some((r) => r.claim?.evidence_text) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] text-water">Compare the original passages</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {rows
                        .filter((r) => r.claim?.evidence_text)
                        .map((r) => (
                          <blockquote
                            key={r.source.id}
                            className="border-l-2 border-line pl-3 font-serif text-[15px] italic leading-relaxed text-ink/85"
                          >
                            {r.claim!.evidence_text}
                            <footer className="mt-1 text-[12px] not-italic text-dust">{r.source.filename}</footer>
                          </blockquote>
                        ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ---------- Missing documentation: the full checklist ----------

function MissingDocs({ entity }: { entity: EntityDetail }) {
  const missing = new Set(entity.gaps.map((g) => g.required_item));
  // Items the backend reports that aren't in our standard list still show as missing.
  const extra = entity.gaps.filter((g) => !MONUMENT_CHECKLIST.some((i) => i.required_item === g.required_item));
  const items = [...MONUMENT_CHECKLIST, ...extra];
  const done = items.filter((i) => !missing.has(i.required_item)).length;
  return (
    <Section
      id="missing"
      title="Missing documentation"
      intro="What a complete record of a monument should include, and what this one still lacks. Take the unticked items on the next field visit."
    >
      <p className="mb-3 text-[15px]">
        <span className="font-display text-2xl">
          {done} of {items.length}
        </span>{" "}
        <span className="text-dust">documented</span>
      </p>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-water" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => {
          const have = !missing.has(i.required_item);
          return (
            <li
              key={i.required_item}
              className={`flex items-center gap-3 rounded-md border px-4 py-3 ${
                have ? "border-line bg-paper" : "border-dashed border-dust/50 bg-paper/60"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-5 shrink-0 place-items-center rounded-[3px] border-2 text-[12px] ${
                  have ? "border-water bg-water text-paper" : "border-dust/70"
                }`}
              >
                {have ? "✓" : ""}
              </span>
              <span className={have ? "text-dust" : "text-[16px]"}>{i.label}</span>
              <span className="sr-only">{have ? "(documented)" : "(missing)"}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ---------- At a glance: patterns across the record ----------

const TYPE_PLURAL: Record<string, [string, string]> = {
  photo: ["photo", "photos"],
  pdf: ["scanned document", "scanned documents"],
  note: ["field note", "field notes"],
  csv: ["spreadsheet", "spreadsheets"],
  web: ["published reference", "published references"],
};

function AtAGlance({ entity }: { entity: EntityDetail }) {
  const s = summarise(entity);
  const agree = corroborated(entity);
  const pct = s.facts ? Math.round((s.verified / s.facts) * 100) : 0;
  return (
    <Section id="glance" title="At a glance" intro="What the archive can say about this monument as a whole, worked out from its facts and files.">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-sm border border-line bg-paper p-4">
          <dt className="text-[13px] text-dust">Checked by a researcher</dt>
          <dd className="mt-1 font-display text-3xl">
            {s.verified}
            <span className="font-serif text-lg text-dust"> of {s.facts} facts</span>
          </dd>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div className="h-full bg-water" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="rounded-sm border border-line bg-paper p-4">
          <dt className="text-[13px] text-dust">Disputed details</dt>
          <dd className="mt-1 font-display text-3xl">
            {s.disputedFields}
            <span className="font-serif text-lg text-dust">
              {" "}
              {s.disputedFields === 1 ? "detail" : "details"} with conflicting answers
            </span>
          </dd>
        </div>
        <div className="rounded-sm border border-line bg-paper p-4">
          <dt className="text-[13px] text-dust">Evidence on file</dt>
          <dd className="mt-1 text-[15px] leading-relaxed">
            {Object.entries(s.sourceTypes)
              .map(([t, n]) => `${n} ${TYPE_PLURAL[t]?.[n === 1 ? 0 : 1] ?? t}`)
              .join(", ") || "None yet"}
          </dd>
        </div>
      </dl>

      <h3 className="mt-6 font-medium">Confirmed by more than one source</h3>
      {agree.length === 0 ? (
        <p className="mt-1 text-[15px] text-dust">No detail is backed by two independent sources yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {agree.map((a) => (
            <li key={`${a.field}-${a.value}`} className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
              <span className="text-dust">{fieldLabel(a.field)}:</span>
              <span className="font-serif text-[17px]">{a.value}</span>
              <span className="rounded-full bg-water-soft px-2 py-0.5 text-[12px] font-medium text-water">{a.sources} sources agree</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------- Lesser-known details ----------

function FieldOnly({ entity, citation }: { entity: EntityDetail; citation: Map<number, number> }) {
  const items = fieldOnly(entity);
  if (items.length === 0) return null;
  return (
    <Section
      id="lesser-known"
      title="Found only in our field records"
      intro="These details come only from the team's own field notes and photos, not from any scanned report or published document. Some may be lesser known; none should be repeated as fact until verified."
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map(({ claim, flagged }) => (
          <li key={claim.id} className="rounded-sm border border-ochre/30 bg-ochre-soft/40 p-4">
            <p className="text-[13px] text-dust">{fieldLabel(claim.field)}</p>
            <p className="mt-0.5 font-serif text-xl">
              {claim.value} <Cite sourceId={claim.source.id} n={citation.get(claim.source.id)} page={claim.source.page} />
            </p>
            <p className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
              {flagged && <span className="rounded-full bg-ochre px-2 py-0.5 font-medium text-paper">Rarely documented elsewhere</span>}
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[claim.status]}`}>{claim.status}</span>
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- Contribute ----------

function Contribute({ entity }: { entity: EntityDetail }) {
  return (
    <Section
      id="contribute"
      title="Have something new about this monument?"
      intro="The archive grows from material that doesn't exist anywhere else yet."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-sm border border-water/30 bg-water-soft/50 p-4">
          <p className="font-medium text-water">Please do upload</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px]">
            <li>photos you took yourself, especially of what&apos;s missing above</li>
            <li>field notes, sketches or measurements you made</li>
            <li>family or community documents that have never been published</li>
          </ul>
        </div>
        <div className="rounded-sm border border-rust/30 bg-rust-soft/50 p-4">
          <p className="font-medium text-rust">Please don&apos;t upload</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px]">
            <li>anything already listed in this record&apos;s sources</li>
            <li>photos or text copied from websites, Wikipedia or books</li>
            <li>anything you don&apos;t have the right to share</li>
          </ul>
        </div>
      </div>
      <Link
        href={`/upload?monument=${entity.id}`}
        className="mt-4 inline-block rounded-md bg-water px-5 py-2.5 text-[15px] font-medium text-paper hover:opacity-90"
      >
        Add new material about {entity.name}
      </Link>
    </Section>
  );
}


// ---------- Sources ----------

const TYPE_LABEL = { photo: "Photo", pdf: "PDF scan", note: "Field note", csv: "Spreadsheet", web: "Wikipedia (published reference)" } as const;

function SourceList({ entity }: { entity: EntityDetail }) {
  return (
    <Section id="sources" title="Sources" intro="Every file linked to this monument. Numbers match the citations above.">
      {entity.sources.length === 0 ? (
        <EmptyState title="No files linked yet" />
      ) : (
        <ol className="divide-y divide-line rounded-md border border-line bg-paper">
          {entity.sources.map((s, i) => (
            <li
              key={s.id}
              id={`source-${s.id}`}
              className="flex scroll-mt-28 flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 target:bg-ochre-soft/60"
            >
              <span className="w-8 shrink-0 font-serif text-dust">[{i + 1}]</span>
              <span className="min-w-0 flex-1 break-all text-[15px]">{s.filename}</span>
              <span className="text-[13px] text-dust">
                {TYPE_LABEL[s.type] ?? s.type}
                {tagLabel(s.tag) && `, ${tagLabel(s.tag)?.toLowerCase()}`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// ---------- Loading ----------

function MonumentSkeleton() {
  return (
    <div role="status" aria-live="polite" className="mt-5">
      <span className="sr-only">Loading monument</span>
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="mt-3 h-5 w-1/2" />
      <div className="mt-6 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-7 w-24 !rounded-full" />
        ))}
      </div>
      {[0, 1].map((s) => (
        <div key={s} className="mt-10 space-y-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}
