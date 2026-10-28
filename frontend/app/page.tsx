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
    <>
      {/* Hero: text over the 3D world (the world itself is rendered in the layout) */}
      <section className="relative flex min-h-[calc(100svh-7rem)] items-end overflow-hidden pb-10 sm:items-center sm:pb-0">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/45 to-transparent sm:bg-gradient-to-r sm:from-ink/85 sm:via-ink/50 sm:to-transparent"
        />
        <p
          lang="hi"
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-10 right-0 select-none font-display text-[11rem] leading-none text-paper/[0.08] sm:text-[18rem]"
        >
          कथा
        </p>
        <div className="relative mx-auto w-full max-w-6xl px-4 text-paper">
          <div className="max-w-xl">
            <h1 className="kg-rise-1 font-display text-[2.6rem] leading-[1.08] sm:text-6xl">
              What do we actually know about each monument?
            </h1>
            <p className="kg-rise-2 mt-5 font-serif text-lg leading-relaxed text-paper/85 sm:text-xl">
              Every fact here points back to the photo, scan or field note it came from. Where sources disagree, you see
              both. Where the record has holes, we list them.
            </p>
            <div className="kg-rise-3 mt-8">
              <SearchBar />
              <a href="#archive" className="mt-5 inline-block text-[15px] text-paper/80 underline underline-offset-4 hover:text-paper">
                Explore the archive by place
              </a>
            </div>
          </div>
        </div>
      </section>

    <main id="archive" className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-6xl scroll-mt-24 px-4 pb-12 pt-8 !mt-0">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-display text-3xl sm:text-4xl">The archive, by place</h2>
        <p className="text-[15px] text-dust">Click a pin to open its record.</p>
      </div>

      <section aria-label="Monuments" className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="relative h-[55vh] min-h-[340px] overflow-hidden rounded-sm border-[6px] border-paper shadow-[0_0_0_1px_var(--color-line),0_10px_30px_rgb(42_36_29/0.15)] lg:h-[560px]">
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
            <h3 className="font-display text-2xl">Monuments</h3>
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
                    className="group block rounded-sm border border-line bg-paper p-4 shadow-[3px_3px_0_var(--color-line)] transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[4px_5px_0_var(--color-line)]"
                  >
                    <span className="block text-[12px] tracking-wide text-ochre">Record no. {String(e.id).padStart(3, "0")}</span>
                    <span className="font-display text-xl group-hover:underline group-hover:underline-offset-4">
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
    </>
  );
}
