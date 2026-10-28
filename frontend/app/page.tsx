"use client";

import Link from "next/link";
import { CountChips } from "@/components/CountChips";
import SearchBar from "@/components/SearchBar";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { useEntities } from "@/lib/useEntities";

// The 3D map of Gujarat fills the screen behind this page (see WorldBackground in the layout).
// This page only adds the floating panel: what KathaGraph is, search, and the list of monuments.

export default function HomePage() {
  const { state, retry } = useEntities();
  const entities = state.kind === "ready" ? state.entities : [];
  const unmapped = entities.filter((e) => e.lat == null || e.lng == null).length;

  return (
    <div className="relative flex min-h-[calc(100svh-6.5rem)] flex-col justify-end px-3 pb-3 lg:block lg:px-6 lg:pb-0 lg:pt-6">
      <aside className="kg-panel kg-rise-1 flex max-h-[46svh] w-full flex-col lg:max-h-[calc(100svh-9rem)] lg:w-[400px]">
        <div className="shrink-0 border-b border-line/70 p-4 sm:p-5 sm:pb-4">
          <h1 className="font-display text-[1.5rem] leading-[1.1] sm:text-[1.9rem]">What do we actually know about each monument?</h1>
          <p className="mt-2 hidden font-serif text-[15px] leading-relaxed text-dust sm:block">
            Every fact points back to the photo, scan or field note it came from. Where sources disagree, you see both.
            Where the record has holes, we list them.
          </p>
          <div className="mt-4">
            <SearchBar />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl">Monuments</h2>
            {state.kind === "ready" && <span className="text-sm text-dust">{entities.length} in the archive</span>}
          </div>

          {state.kind === "loading" && (
            <ul className="mt-3 space-y-3" aria-label="Loading monuments">
              {[0, 1, 2].map((i) => (
                <li key={i} className="rounded-sm border border-line bg-paper p-4">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="mt-3 h-6 w-full" />
                </li>
              ))}
            </ul>
          )}

          {state.kind === "error" && (
            <div className="mt-3">
              <ErrorState title="Couldn't load the monuments" message={state.message} onRetry={retry} />
            </div>
          )}

          {state.kind === "ready" && entities.length === 0 && (
            <div className="mt-3">
              <EmptyState title="No monuments yet">
                Upload photos, scans or field notes and the archive will place each monument on the map.{" "}
                <Link href="/upload" className="text-water underline underline-offset-2">
                  Upload files
                </Link>
              </EmptyState>
            </div>
          )}

          {state.kind === "ready" && entities.length > 0 && (
            <ul className="mt-3 space-y-3">
              {entities.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/monument/${e.id}`}
                    className="group block rounded-sm border border-line bg-paper p-4 shadow-[3px_3px_0_var(--color-line)] transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[4px_5px_0_var(--color-line)]"
                  >
                    <span className="block text-[12px] tracking-wide text-ochre">Record no. {String(e.id).padStart(3, "0")}</span>
                    <span className="font-display text-xl group-hover:underline group-hover:underline-offset-4">{e.name}</span>
                    {(e.lat == null || e.lng == null) && <span className="ml-2 text-[13px] text-dust">no location yet</span>}
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
            <p className="mt-4 flex items-center gap-2 text-[13px] text-dust">
              <span className="inline-block text-ochre" aria-hidden="true">◆</span>
              Monuments where sources disagree. Click a name on the map to open its record.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
