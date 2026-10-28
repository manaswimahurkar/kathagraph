"use client";

import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import { useEntities } from "@/lib/useEntities";

// The home page is the 3D map of Gujarat itself (drawn by WorldBackground in the layout).
// Monuments open as pop-up cards when you click them on the map; this page only adds
// a floating search bar and a notice if the monuments can't be loaded.

export default function HomePage() {
  const { state, retry } = useEntities();
  const entities = state.kind === "ready" ? state.entities : [];
  const unmapped = entities.filter((e) => e.lat == null || e.lng == null);

  return (
    <div className="relative min-h-[calc(100svh-6.5rem)] px-3 pt-3 sm:px-6 sm:pt-5">
      <div className="kg-panel kg-rise-1 w-full max-w-md p-3">
        <h1 className="sr-only">KathaGraph: what do we actually know about each monument?</h1>
        <SearchBar />
        <p className="mt-2 px-1 text-[13px] text-dust">
          {state.kind === "loading" && "Placing monuments on the map…"}
          {state.kind === "ready" &&
            (entities.length === 0 ? (
              <>
                No monuments in the archive yet.{" "}
                <Link href="/upload" className="text-water underline underline-offset-2">
                  Upload files
                </Link>{" "}
                to add the first.
              </>
            ) : (
              `${entities.length} ${entities.length === 1 ? "monument" : "monuments"} on the map. Click one to see what the archive knows.`
            ))}
        </p>

        {state.kind === "error" && (
          <div role="alert" className="mt-2 rounded border border-rust/30 bg-rust-soft px-3 py-2 text-[14px]">
            <p className="font-medium text-rust">Couldn&apos;t load the monuments</p>
            <p className="text-ink">{state.message}</p>
            <button onClick={retry} className="mt-1.5 text-[13px] font-medium text-rust underline underline-offset-2">
              Try again
            </button>
          </div>
        )}

        {unmapped.length > 0 && (
          <div className="mt-2 border-t border-line pt-2 text-[13px]">
            <p className="text-dust">Not on the map yet (no GPS):</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {unmapped.map((e) => (
                <li key={e.id}>
                  <Link href={`/monument/${e.id}`} className="rounded-full border border-line px-2.5 py-0.5 text-ink hover:border-ink/40">
                    {e.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
