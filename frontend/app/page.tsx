"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CountChips } from "@/components/CountChips";
import SearchBar from "@/components/SearchBar";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { getEntities } from "@/lib/api";
import type { EntitySummary } from "@/lib/types";

// Leaflet needs `window`, so the map only renders in the browser.
const MonumentMap = dynamic(() => import("@/components/MonumentMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full !rounded-none" />,
});

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; entities: EntitySummary[] };

export default function HomePage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    getEntities()
      .then((r) => setState({ kind: "ready", entities: r.entities }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, []);

  useEffect(load, [load]);

  const entities = state.kind === "ready" ? state.entities : [];
  const unmapped = entities.filter((e) => e.lat == null || e.lng == null).length;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:pt-10">
      <SearchBar />

      <div className="mt-8 max-w-2xl sm:mt-10">
        <h1 className="font-serif text-3xl leading-tight font-semibold sm:text-[2.6rem]">
          What do we actually know about each monument?
        </h1>
        <p className="mt-3 text-[17px] leading-relaxed text-dust">
          Every fact here points back to the file it came from. Open a monument to see where sources disagree and
          which documentation is still missing.
        </p>
      </div>

      <section aria-label="Monuments" className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="relative h-[55vh] min-h-[340px] overflow-hidden rounded-md border border-line lg:h-[560px]">
          {state.kind === "error" ? (
            <div className="grid h-full place-items-center bg-paper p-6">
              <ErrorState title="Couldn't load the map" message={state.message} onRetry={load} />
            </div>
          ) : state.kind === "loading" ? (
            <Skeleton className="h-full w-full !rounded-none" />
          ) : (
            <MonumentMap entities={entities} />
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-xl font-semibold">Monuments</h2>
            {state.kind === "ready" && <span className="text-sm text-dust">{entities.length} in the archive</span>}
          </div>

          {state.kind === "loading" && (
            <ul className="mt-4 space-y-3" aria-label="Loading monuments">
              {[0, 1, 2].map((i) => (
                <li key={i} className="rounded-md border border-line bg-paper p-4">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="mt-3 h-6 w-full" />
                </li>
              ))}
            </ul>
          )}

          {state.kind === "error" && (
            <p className="mt-4 text-[15px] text-dust">The list will appear once the archive server answers.</p>
          )}

          {state.kind === "ready" && entities.length === 0 && (
            <div className="mt-4">
              <EmptyState title="No monuments yet">
                Upload photos, scans or field notes and the archive will place each monument on the map.{" "}
                <Link href="/upload" className="text-water underline underline-offset-2">
                  Upload files
                </Link>
              </EmptyState>
            </div>
          )}

          {state.kind === "ready" && entities.length > 0 && (
            <ul className="mt-4 space-y-3">
              {entities.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/monument/${e.id}`}
                    className="group block rounded-md border border-line bg-paper p-4 transition-colors hover:border-ink/40"
                  >
                    <span className="font-serif text-lg font-semibold group-hover:underline group-hover:underline-offset-4">
                      {e.name}
                    </span>
                    {(e.lat == null || e.lng == null) && (
                      <span className="ml-2 text-[13px] text-dust">no location yet</span>
                    )}
                    <div className="mt-2.5">
                      <CountChips entity={e} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {unmapped > 0 && (
            <p className="mt-3 text-sm text-dust">
              {unmapped} {unmapped === 1 ? "monument has" : "monuments have"} no GPS yet, so {unmapped === 1 ? "it isn't" : "they aren't"} on the map.
            </p>
          )}

          {state.kind === "ready" && entities.length > 0 && (
            <p className="mt-5 flex items-center gap-2 text-[13px] text-dust">
              <span className="inline-block size-3 rotate-45 rounded-[2px] bg-ochre" aria-hidden="true" />
              Ochre pins have sources that disagree. The number is the source count.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
