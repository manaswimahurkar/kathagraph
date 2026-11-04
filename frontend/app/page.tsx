"use client";

import Link from "next/link";
import { useState } from "react";
import SearchBar from "@/components/SearchBar";
import TimeSlider, { TimeTravelButton } from "@/components/TimeSlider";
import { useTimeTravelActive } from "@/lib/timeTravel";
import { useEntities } from "@/lib/useEntities";

// The home page is the 3D map of Gujarat itself (drawn by WorldBackground in the layout).
// Monuments open as pop-up cards when you click them on the map; this page only adds
// a floating search bar and a notice if the monuments can't be loaded.
// On phones the panel folds down to the search box and two buttons, so the map stays visible;
// "More" opens the rest. While travelling in time, the panel hides on phones (it returns when time travel closes).

export default function HomePage() {
  const { state, retry } = useEntities();
  const entities = state.kind === "ready" ? state.entities : [];
  const unmapped = entities.filter((e) => e.lat == null || e.lng == null);
  const [more, setMore] = useState(false); // phones only: show the rest of the panel
  const extra = more ? "" : "hidden sm:block";
  const travelling = useTimeTravelActive(); // phones: the search panel steps aside so the map shows above the slider

  return (
    <div className="relative min-h-[calc(100svh-6.5rem)] px-3 pt-3 sm:px-6 sm:pt-5">
      <div className={`kg-panel kg-rise-1 w-full max-w-md p-3 ${travelling ? "hidden sm:block" : ""}`}>
        <h1 className="sr-only">KathaGraph: what do we actually know about each monument?</h1>
        <SearchBar langsOnPhone={more} />

        {/* phones: a slim row instead of the full panel */}
        <div className="mt-2 flex items-center justify-between gap-2 sm:hidden">
          {state.kind === "ready" && entities.length > 0 ? <TimeTravelButton compact /> : <span />}
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            aria-expanded={more}
            aria-controls="home-more"
            className="rounded-md border border-line px-3 py-1.5 text-[13.5px] text-dust hover:text-ink"
          >
            {more ? "Less ▴" : "More ▾"}
          </button>
        </div>

        {state.kind === "error" && (
          <div role="alert" className="mt-2 rounded border border-rust/30 bg-rust-soft px-3 py-2 text-[14px]">
            <p className="font-medium text-rust">Couldn&apos;t load the monuments</p>
            <p className="text-ink">{state.message}</p>
            <button onClick={retry} className="mt-1.5 text-[13px] font-medium text-rust underline underline-offset-2">
              Try again
            </button>
          </div>
        )}

        <div id="home-more" className={extra}>
        <div className="hidden sm:block">{state.kind === "ready" && entities.length > 0 && <TimeTravelButton />}</div>
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
              `${entities.length - unmapped.length} ${entities.length - unmapped.length === 1 ? "monument" : "monuments"} on the map. Click one to see what the archive knows.`
            ))}{" "}
          <Link href="/why-gujarat" className="whitespace-nowrap text-water underline underline-offset-2">
            Why Gujarat?
          </Link>
          {" · "}
          <Link href="/data" className="whitespace-nowrap text-water underline underline-offset-2">
            Open data
          </Link>
        </p>


        {unmapped.length > 0 && (
          <details className="mt-2 border-t border-line pt-2 text-[13px]">
            <summary className="cursor-pointer text-dust hover:text-ink">
              {unmapped.length} more {unmapped.length === 1 ? "site needs" : "sites need"} a GPS location
            </summary>
            <ul className="mt-1.5 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              {unmapped.map((e) => (
                <li key={e.id}>
                  <Link href={`/monument/${e.id}`} className="rounded-full border border-line px-2.5 py-0.5 text-ink hover:border-ink/40">
                    {e.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
        </div>
      </div>
      <TimeSlider entities={entities} />
    </div>
  );
}
