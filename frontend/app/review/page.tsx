"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@/components/States";
import { getReview, setClaimStatus } from "@/lib/api";
import type { ReviewClaim, ReviewResponse } from "@/lib/types";

// The review queue: AI-extracted facts most likely to be wrong come first, each with the reasons
// and the passage to check it against. A reviewer settles one fact per keypress.

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: ReviewResponse };

export default function ReviewPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [done, setDone] = useState<{ verified: number; rejected: number }>({ verified: 0, rejected: 0 });
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ kind: "loading" });
    getReview(40)
      .then((data) => setState({ kind: "ready", data }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = "Review queue · KathaGraph";
  }, []);

  const queue = state.kind === "ready" ? state.data.claims : [];
  const current = queue[0];

  const decide = useCallback(
    async (c: ReviewClaim, status: "verified" | "rejected" | "skip") => {
      setError(null);
      if (status !== "skip") {
        setBusy(c.id);
        try {
          await setClaimStatus(c.id, status);
          setDone((d) => ({ ...d, [status]: d[status] + 1 }));
        } catch (e) {
          setError((e as Error).message);
          setBusy(null);
          return;
        }
        setBusy(null);
      }
      setState((s) => {
        if (s.kind !== "ready") return s;
        const rest = s.data.claims.filter((x) => x.id !== c.id);
        return { kind: "ready", data: { ...s.data, claims: status === "skip" ? [...rest, c] : rest } };
      });
    },
    [],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!current || busy || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === "v") decide(current, "verified");
      else if (k === "r") decide(current, "rejected");
      else if (k === "s") decide(current, "skip");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, busy, decide]);

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-3xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Review</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Check what the AI read</h1>
      <p className="mt-2 max-w-2xl text-[17px] text-dust">
        Every fact the AI pulled from a document starts unverified. These are the ones most likely to be wrong, first:
        check each against its passage, then verify or reject it. Rejected facts stop counting anywhere in the archive.
      </p>
      <p className="mt-2 text-[14px]">
        Also:{" "}
        <Link href="/duplicates" className="text-water underline underline-offset-2">
          monuments that may be recorded twice →
        </Link>
      </p>

      {state.kind === "loading" && (
        <div role="status" className="mt-8 space-y-3">
          <span className="sr-only">Loading the review queue</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Couldn't load the review queue" message={state.message} onRetry={load} />
        </div>
      )}

      {state.kind === "ready" && (
        <>
          <Stats data={state.data} done={done} />
          {error && <p className="mt-4 rounded border border-rust/30 bg-rust-soft px-4 py-2 text-[15px] text-rust">{error}</p>}
          {current ? (
            <ReviewCard c={current} busy={busy === current.id} onDecide={(s) => decide(current, s)} />
          ) : (
            <div className="mt-8 rounded-md border border-dashed border-line px-5 py-10 text-center">
              <p className="font-serif text-lg text-ink">Queue cleared</p>
              <p className="mt-1 text-[15px] text-dust">
                Nothing left that needs a second look right now.{" "}
                <button onClick={load} className="text-water underline underline-offset-2">
                  Load more
                </button>
              </p>
            </div>
          )}
          {queue.length > 1 && (
            <section className="mt-8">
              <h2 className="text-[13px] uppercase tracking-wide text-dust">Up next ({queue.length - 1})</h2>
              <ol className="mt-2 divide-y divide-line rounded-md border border-line bg-paper">
                {queue.slice(1, 8).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[15px]">
                    <span className="min-w-0 truncate">
                      <span className="text-dust">{c.entity.name} · {c.field_label}:</span> {c.value}
                    </span>
                    <RiskBadge risk={c.risk} />
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Stats({ data, done }: { data: ReviewResponse; done: { verified: number; rejected: number } }) {
  const t = data.totals;
  const verified = t.verified + done.verified;
  const rejected = t.rejected + done.rejected;
  const unverified = Math.max(0, t.unverified - done.verified - done.rejected);
  const total = verified + rejected + unverified || 1;
  return (
    <div className="mt-6 rounded-md border border-line bg-paper p-4">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-sand" aria-hidden="true">
        <div className="bg-water" style={{ width: `${(100 * verified) / total}%` }} />
        <div className="bg-rust" style={{ width: `${(100 * rejected) / total}%` }} />
      </div>
      <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-dust">
        <span>
          <strong className="text-water">{verified}</strong> verified
        </span>
        <span>
          <strong className="text-rust">{rejected}</strong> rejected
        </span>
        <span>
          <strong className="text-ink">{unverified}</strong> still unverified
        </span>
        {done.verified + done.rejected > 0 && <span>· {done.verified + done.rejected} reviewed this session</span>}
      </p>
    </div>
  );
}

function RiskBadge({ risk }: { risk: number }) {
  const [label, cls] =
    risk >= 5 ? ["Check first", "bg-rust-soft text-rust"] : risk >= 3 ? ["Worth checking", "bg-ochre-soft text-ochre"] : ["Likely fine", "bg-water-soft text-water"];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${cls}`}>{label}</span>;
}

function ReviewCard({ c, busy, onDecide }: { c: ReviewClaim; busy: boolean; onDecide: (s: "verified" | "rejected" | "skip") => void }) {
  const link = c.source.source_url || c.source.file_url;
  return (
    <article className="mt-6 rounded-md border border-line bg-paper p-5 sm:p-6" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/monument/${c.entity.id}`} className="text-[15px] font-medium text-water underline-offset-2 hover:underline">
          {c.entity.name}
        </Link>
        <RiskBadge risk={c.risk} />
      </div>
      <p className="mt-3 text-[13px] uppercase tracking-wide text-dust">{c.field_label}</p>
      <p className="mt-1 font-serif text-2xl text-ink">{c.value}</p>

      {c.reasons.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {c.reasons.map((r) => (
            <li key={r} className="rounded-full border border-line bg-sand px-2.5 py-0.5 text-[13px] text-dust">
              {r}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded border-l-4 border-ochre bg-sand/60 px-4 py-3">
        <p className="text-[12px] uppercase tracking-wide text-dust">The passage it came from</p>
        <p className="mt-1 font-serif text-[16px] leading-relaxed text-ink">
          <Marked text={c.excerpt || "(no passage stored)"} mark={c.quote ?? ""} />
        </p>
        <p className="mt-2 text-[12px] text-dust">
          {c.source.origin === "web" ? "Published reference" : "Field record"} · {c.source.filename}
          {link && (
            <>
              {" · "}
              <a href={link} target="_blank" rel="noreferrer" className="text-water underline underline-offset-2">
                Open source
              </a>
            </>
          )}
          {c.method === "ocr" ? " · read by OCR" : " · extracted by AI"}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <button disabled={busy} onClick={() => onDecide("verified")} className="rounded-md bg-water px-3 py-2.5 font-medium text-paper hover:opacity-90 disabled:opacity-50">
          Verify <kbd className="ml-1 hidden rounded bg-paper/20 px-1 text-[12px] sm:inline">V</kbd>
        </button>
        <button disabled={busy} onClick={() => onDecide("rejected")} className="rounded-md bg-rust px-3 py-2.5 font-medium text-paper hover:opacity-90 disabled:opacity-50">
          Reject <kbd className="ml-1 hidden rounded bg-paper/20 px-1 text-[12px] sm:inline">R</kbd>
        </button>
        <button disabled={busy} onClick={() => onDecide("skip")} className="rounded-md border border-line px-3 py-2.5 font-medium text-ink hover:bg-sand disabled:opacity-50">
          Skip <kbd className="ml-1 hidden rounded bg-sand px-1 text-[12px] sm:inline">S</kbd>
        </button>
      </div>
    </article>
  );
}

/** Highlights the quoted words inside the passage. */
function Marked({ text, mark }: { text: string; mark: string }) {
  const m = mark.trim();
  const i = m ? text.toLowerCase().indexOf(m.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <Fragment>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + m.length)}</mark>
      {text.slice(i + m.length)}
    </Fragment>
  );
}
