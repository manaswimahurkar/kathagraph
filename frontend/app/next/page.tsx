"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { getPriorities } from "@/lib/api";
import type { PrioritiesResponse, PriorityMonument, PriorityTodo } from "@/lib/types";

// "What to document next": the archive turned into a to-do list for the next field visit.
// The server already sorts monuments so the ones needing the most fieldwork come first.

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: PrioritiesResponse };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function NextPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    getPriorities()
      .then((data) => setState({ kind: "ready", data }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    document.title = "What to document next · KathaGraph";
  }, []);

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-3xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Field visits</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">What to document next</h1>
      <p className="mt-2 max-w-xl text-[17px] text-dust">
        The archive as a to-do list for the next field trip: missing evidence to collect, and disagreements between
        sources that can only be settled on site.
      </p>

      {state.kind === "loading" && (
        <div role="status" aria-live="polite" className="mt-8 space-y-4">
          <span className="sr-only">Loading the to-do list</span>
          <Skeleton className="h-5 w-2/3" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-md border border-line bg-paper p-5">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="mt-4 h-5 w-full" />
              <Skeleton className="mt-2 h-5 w-4/5" />
            </div>
          ))}
        </div>
      )}

      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Couldn't load the to-do list" message={state.message} onRetry={load} />
        </div>
      )}

      {state.kind === "ready" && <Priorities data={state.data} />}
    </main>
  );
}

function Priorities({ data }: { data: PrioritiesResponse }) {
  const { totals, monuments } = data;

  if (monuments.length === 0) {
    return (
      <div className="mt-8">
        <EmptyState title="No monuments in the archive yet">
          Once field notes and photos are{" "}
          <Link href="/upload" className="text-water underline underline-offset-2">
            uploaded
          </Link>
          , this page lists what each monument is still missing.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <p className="mt-5 rounded-md border border-line bg-sand/60 px-4 py-2.5 text-[15px]">
        <strong className="font-medium">{plural(totals.monuments, "monument", "monuments")}</strong>
        {" · "}
        <strong className="font-medium">{plural(totals.missing_items, "missing item", "missing items")}</strong>
        {" · "}
        <strong className="font-medium text-ochre">
          {plural(totals.disagreements, "disagreement", "disagreements")} to check on site
        </strong>
      </p>

      <ol className="mt-6 space-y-4">
        {monuments.map((m, i) => (
          <MonumentCard key={m.id} rank={i + 1} m={m} />
        ))}
      </ol>
    </>
  );
}

function MonumentCard({ rank, m }: { rank: number; m: PriorityMonument }) {
  const docs = m.todo.filter((t) => t.kind === "document");
  const checks = m.todo.filter((t) => t.kind === "verify");

  return (
    <li className="rounded-md border border-line bg-paper p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-serif text-xl">
          <span className="mr-2 text-[15px] text-dust">{rank}.</span>
          <Link href={`/monument/${m.id}`} className="text-ink underline-offset-4 hover:text-water hover:underline">
            {m.name}
          </Link>
        </h2>
        <p className="text-[13px] text-dust">
          {plural(m.n_sources, "source", "sources")} in the archive
        </p>
      </div>

      {m.todo.length === 0 ? (
        <p className="mt-3 text-[15px] text-dust">Nothing missing: fully documented against our checklist.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {docs.length > 0 && <TodoList title="Missing evidence" items={docs} />}
          {checks.length > 0 && <TodoList title="Check on site" items={checks} />}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/upload?monument=${m.id}`}
          className="rounded-md bg-water px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90"
        >
          Add material
        </Link>
        <Link
          href={`/monument/${m.id}`}
          className="rounded-md border border-line px-4 py-2 text-[14px] text-ink hover:border-ink/40"
        >
          Open record
        </Link>
      </div>
    </li>
  );
}

function TodoList({ title, items }: { title: string; items: PriorityTodo[] }) {
  return (
    <div>
      <p className="text-[12px] uppercase tracking-wide text-dust">{title}</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((t) => (
          <li key={`${t.kind}-${t.item}`} className="flex gap-2.5 text-[15px] leading-snug">
            {t.kind === "document" ? (
              <span aria-hidden="true" className="mt-[3px] inline-block size-4 shrink-0 rounded-[3px] border-2 border-dust/70" />
            ) : (
              <span aria-hidden="true" className="shrink-0 text-ochre">
                ⚠️
              </span>
            )}
            <span>
              <span className="sr-only">{t.kind === "document" ? "To document: " : "To check on site: "}</span>
              {t.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
