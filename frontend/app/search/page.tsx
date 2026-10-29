"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import SearchBar from "@/components/SearchBar";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { search } from "@/lib/api";
import type { SearchResult } from "@/lib/types";

const EXAMPLES = ["Rudabai", "construction year", "बावड़ी", "UNESCO"];

export default function SearchPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <SearchView />
    </Suspense>
  );
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; results: SearchResult[]; mode?: "semantic" | "keyword" };

function SearchView() {
  const q = (useSearchParams().get("q") ?? "").trim();
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = useCallback(() => {
    if (!q) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });
    search(q)
      .then((r) => setState({ kind: "ready", results: r.results, mode: r.mode }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, [q]);

  useEffect(run, [run]);

  useEffect(() => {
    document.title = q ? `“${q}” · KathaGraph` : "Search · KathaGraph";
  }, [q]);

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-3xl px-4 pb-16 pt-6 sm:pt-10">
      <SearchBar key={q} initial={q} autoFocus={!q} />

      {state.kind === "idle" && (
        <div className="mt-10">
          <h1 className="font-display text-4xl sm:text-5xl">Search the archive</h1>
          <p className="mt-2 max-w-xl text-[17px] text-dust">
            Searches the text of every field note and scanned document, in English and Hindi. Each result links back to
            the file it came from.
          </p>
          <p className="mt-6 text-sm text-dust">Try one of these:</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <Link
                  href={`/search?q=${encodeURIComponent(ex)}`}
                  className="inline-block rounded-full border border-line bg-paper px-3 py-1 text-[15px] hover:border-ink/40"
                >
                  {ex}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.kind === "loading" && (
        <div role="status" aria-live="polite" className="mt-8 space-y-4">
          <span className="sr-only">Searching</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-md border border-line bg-paper p-5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-3 h-5 w-full" />
              <Skeleton className="mt-2 h-5 w-4/5" />
            </div>
          ))}
        </div>
      )}

      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Search didn't work" message={state.message} onRetry={run} />
        </div>
      )}

      {state.kind === "ready" && (
        <section className="mt-8" aria-live="polite">
          <h1 className="text-[15px] text-dust">
            {state.results.length === 0
              ? "No results"
              : `${state.results.length} ${state.results.length === 1 ? "passage" : "passages"}`}{" "}
            for <span className="font-medium text-ink">“{q}”</span>
            {state.results.length > 0 && state.mode === "semantic" && " · matched by meaning, in any language"}
            {state.results.length > 0 && state.mode === "keyword" && " · matched by keywords"}
          </h1>

          {state.results.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="Nothing in the archive matches that yet">
                Try a monument name, a person, or a word in Hindi. If the files aren't in the archive,{" "}
                <Link href="/upload" className="text-water underline underline-offset-2">
                  upload them
                </Link>
                .
              </EmptyState>
            </div>
          ) : (
            <ol className="mt-4 space-y-4">
              {state.results.map((r) => (
                <ResultCard key={r.chunk_id} result={r} query={q} />
              ))}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}

function ResultCard({ result, query }: { result: SearchResult; query: string }) {
  const entity = result.entities[0];
  const sourceHref = entity ? `/monument/${entity.id}#source-${result.source.id}` : null;

  return (
    <li className="rounded-md border border-line bg-paper p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          {result.entities.length > 0 ? (
            result.entities.map((e, i) => (
              <Fragment key={e.id}>
                {i > 0 && ", "}
                <Link href={`/monument/${e.id}`} className="font-medium text-water underline-offset-2 hover:underline">
                  {e.name}
                </Link>
              </Fragment>
            ))
          ) : (
            <span className="text-dust">Not linked to a monument yet</span>
          )}
        </p>
        <span className="text-[13px] text-dust">{Math.round(result.score * 100)}% match</span>
      </div>

      <p className="mt-2 font-serif text-[17px] leading-relaxed">
        <Highlight text={result.text} query={query} />
      </p>

      <p className="mt-3 text-[13px] text-dust">
        From{" "}
        {sourceHref ? (
          <Link href={sourceHref} className="text-water underline decoration-water/40 underline-offset-2 hover:decoration-water">
            {result.source.filename}
          </Link>
        ) : (
          <span className="text-ink">{result.source.filename}</span>
        )}
        {result.source.page != null && `, page ${result.source.page}`}
      </p>
    </li>
  );
}

// Small words that would light up every passage if highlighted
const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "by", "for", "is", "was", "it", "its", "who", "what",
  "when", "where", "which", "how", "did", "does", "this", "that", "with", "from",
  "का", "की", "के", "में", "से", "ने", "को", "है", "था", "थी", "और",
]);

/** Wraps every occurrence of each meaningful query word in <mark>. Works for Devanagari too. */
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = [...new Set(query.split(/\s+/).filter((t) => t.length > 1 && !STOPWORDS.has(t.toLowerCase())))];
  if (terms.length === 0) return <>{text}</>;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}
