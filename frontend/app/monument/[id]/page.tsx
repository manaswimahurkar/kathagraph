"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { ApiError, getEntity, setClaimStatus } from "@/lib/api";
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
    <main className="mx-auto max-w-4xl px-4 pb-20 pt-6 sm:pt-8">
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

  return (
    <article className="mt-5">
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
          <JumpLink href="#sources">{entity.sources.length} sources</JumpLink>
        </nav>
      </header>

      <KnownFacts claims={entity.claims} citation={citation} disputed={disputed} onChanged={onChanged} />
      <Disagreements entity={entity} citation={citation} />
      <MissingDocs entity={entity} />
      <SourceList entity={entity} />
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

// ---------- Sources disagree ----------

function Disagreements({ entity, citation }: { entity: EntityDetail; citation: Map<number, number> }) {
  return (
    <Section
      id="disagreements"
      title="Sources disagree"
      intro="Where two sources give different answers, both are shown. KathaGraph doesn't pick a winner; verify or reject the facts above to settle it."
    >
      {entity.conflicts.length === 0 ? (
        <EmptyState title="No disagreements between sources">
          Sources that mention the same detail give the same answer (rejected facts are left out).
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {entity.conflicts.map((conflict) => (
            <div key={conflict.field} className="rounded-md border border-ochre/35 bg-ochre-soft/50 p-4 sm:p-5">
              <h3 className="font-medium text-ochre">
                {fieldLabel(conflict.field)}: {conflict.claims.length} sources, {new Set(conflict.claims.map((c) => c.value)).size} different answers
              </h3>
              <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row">
                {conflict.claims.map((c, i) => (
                  <div key={c.claim_id} className="contents">
                    {i > 0 && (
                      <div aria-hidden="true" className="grid place-items-center font-serif text-3xl text-ochre sm:px-1">
                        ≠
                      </div>
                    )}
                    <figure className="flex-1 rounded border border-line bg-paper p-4">
                      <p className="font-display text-4xl">{c.value}</p>
                      <figcaption className="mt-2 text-sm text-dust">
                        according to <span className="text-ink">{c.source.filename}</span>{" "}
                        <Cite sourceId={c.source.id} n={citation.get(c.source.id)} />
                      </figcaption>
                    </figure>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------- Missing documentation ----------

function MissingDocs({ entity }: { entity: EntityDetail }) {
  return (
    <Section
      id="missing"
      title="Missing documentation"
      intro="Compared against the archive's checklist for a monument. Take this list on the next field visit."
    >
      {entity.gaps.length === 0 ? (
        <EmptyState title="Nothing missing">This monument has everything on the checklist.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {entity.gaps.map((g) => (
            <li key={g.required_item} className="flex items-center gap-3 rounded-md border border-dashed border-dust/50 bg-paper/60 px-4 py-3">
              <span aria-hidden="true" className="size-4 shrink-0 rounded-[3px] border-2 border-dust/70" />
              <span className="text-[16px]">{g.label}</span>
              <span className="sr-only">(missing)</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------- Sources ----------

const TYPE_LABEL = { photo: "Photo", pdf: "PDF scan", note: "Field note", csv: "Spreadsheet" } as const;

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
