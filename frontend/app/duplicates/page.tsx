"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@/components/States";
import { getDuplicates, markDifferent, mergeMonuments } from "@/lib/api";
import { useAccount } from "@/lib/auth";
import type { DuplicatePair, DuplicateSide, DuplicatesResponse } from "@/lib/types";

// "Same place?": monuments that may be recorded twice under different names. A person decides,
// because merging two different places would mix their evidence. "Different places" is remembered.

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: DuplicatesResponse };

export default function DuplicatesPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const user = useAccount();

  const load = useCallback(() => {
    setState({ kind: "loading" });
    getDuplicates()
      .then((data) => setState({ kind: "ready", data }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = "Same place? · KathaGraph";
  }, []);

  const key = (p: DuplicatePair) => `${p.a.id}-${p.b.id}`;

  async function act(p: DuplicatePair, action: "keepA" | "keepB" | "different") {
    setBusy(key(p));
    setError(null);
    try {
      if (action === "different") {
        await markDifferent(p.a.id, p.b.id);
        setDone((d) => [`${p.a.name} and ${p.b.name} kept as different places.`, ...d]);
      } else {
        const [keep, dup] = action === "keepA" ? [p.a, p.b] : [p.b, p.a];
        await mergeMonuments(keep.id, dup.id);
        setDone((d) => [`Merged “${dup.name}” into “${keep.name}”. Its name is kept as an alias.`, ...d]);
      }
      // Drop this pair and any other pair that mentioned a monument that no longer exists
      setState((s) => {
        if (s.kind !== "ready") return s;
        const gone = action === "keepA" ? p.b.id : action === "keepB" ? p.a.id : null;
        const pairs = s.data.pairs.filter((x) => key(x) !== key(p) && (gone === null || (x.a.id !== gone && x.b.id !== gone)));
        return { kind: "ready", data: { ...s.data, pairs } };
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-4xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Review</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Same place?</h1>
      <p className="mt-2 max-w-2xl text-[17px] text-dust">
        Different teams record the same monument under different names. The archive joins obvious spellings by itself;
        these pairs are less certain, so a person decides. Merging moves every file, fact and photo onto one record and
        keeps the other name as an alias.
      </p>
      <p className="mt-2 text-[14px]">
        <Link href="/review" className="text-water underline underline-offset-2">
          ← Back to checking AI facts
        </Link>
      </p>
      {!user && (
        <p className="mt-4 rounded border border-ochre/40 bg-ochre-soft px-4 py-2 text-[15px] text-ink">
          Merging joins two records for good, so it needs an account.{" "}
          <Link href="/join?next=/duplicates" className="font-medium text-water underline underline-offset-2">
            Join or sign in
          </Link>{" "}
          to merge. Anyone can mark two records as different places.
        </p>
      )}

      {state.kind === "loading" && <Skeleton className="mt-8 h-64 w-full" />}
      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Couldn't load the suggestions" message={state.message} onRetry={load} />
        </div>
      )}
      {error && <p className="mt-4 rounded border border-rust/30 bg-rust-soft px-4 py-2 text-[15px] text-rust">{error}</p>}
      {done.length > 0 && (
        <ul className="mt-4 space-y-1 text-[14px] text-water" aria-live="polite">
          {done.map((d, i) => (
            <li key={i}>✓ {d}</li>
          ))}
        </ul>
      )}

      {state.kind === "ready" &&
        (state.data.pairs.length === 0 ? (
          <div className="mt-8 rounded-md border border-dashed border-line px-5 py-10 text-center">
            <p className="font-serif text-lg text-ink">No likely duplicates</p>
            <p className="mt-1 text-[15px] text-dust">Every monument looks like a distinct place right now.</p>
          </div>
        ) : (
          <ol className="mt-6 space-y-4">
            {state.data.pairs.map((p) => (
              <li key={key(p)} className="rounded-md border border-line bg-paper p-4 sm:p-5">
                <ul className="flex flex-wrap gap-2">
                  {p.reasons.map((r) => (
                    <li key={r} className="rounded-full bg-ochre-soft px-2.5 py-0.5 text-[13px] text-ochre">
                      {r}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Side s={p.a} />
                  <Side s={p.b} />
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <button disabled={busy === key(p) || !user} onClick={() => act(p, "keepA")} className="rounded-md bg-water px-3 py-2 text-[14px] font-medium text-paper hover:opacity-90 disabled:opacity-50">
                    Same place: keep “{p.a.name}”
                  </button>
                  <button disabled={busy === key(p) || !user} onClick={() => act(p, "keepB")} className="rounded-md bg-water px-3 py-2 text-[14px] font-medium text-paper hover:opacity-90 disabled:opacity-50">
                    Same place: keep “{p.b.name}”
                  </button>
                  <button disabled={busy === key(p)} onClick={() => act(p, "different")} className="rounded-md border border-line px-3 py-2 text-[14px] font-medium text-ink hover:bg-sand disabled:opacity-50">
                    Different places
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ))}
    </main>
  );
}

function Side({ s }: { s: DuplicateSide }) {
  return (
    <div className="rounded border border-line bg-sand/40 p-3">
      <Link href={`/monument/${s.id}`} className="font-serif text-lg text-water underline-offset-2 hover:underline">
        {s.name}
      </Link>
      <p className="mt-0.5 text-[13px] capitalize text-dust">
        {s.category} · {s.n_sources} {s.n_sources === 1 ? "source" : "sources"} · {s.n_claims} {s.n_claims === 1 ? "fact" : "facts"}
      </p>
      {s.lat != null && s.lng != null && (
        <p className="text-[13px] text-dust">
          {s.lat.toFixed(4)}° N, {s.lng.toFixed(4)}° E
        </p>
      )}
      {s.aliases.length > 0 && <p className="mt-1 text-[13px] text-ink">Also: {s.aliases.join(", ")}</p>}
    </div>
  );
}
