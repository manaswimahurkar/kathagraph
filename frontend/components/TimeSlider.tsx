"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import {
  ERAS,
  eraOf,
  fmtYear,
  getTimeTravel,
  posOf,
  setTimeTravel,
  stateAt,
  useTimeTravel,
  useTimelineData,
  YEAR_MAX,
  YEAR_MIN,
  yearOf,
} from "@/lib/timeTravel";
import type { EntitySummary } from "@/lib/types";

const PLAY_SECONDS = 30; // the whole 5,600 years

/**
 * The time-travel bar along the bottom of the home map. Drag it (or press Play) and the 3D map
 * shows only the monuments that stood in that year; ones whose date sources disagree flicker.
 */
export default function TimeSlider({ entities }: { entities: EntitySummary[] }) {
  const tt = useTimeTravel();
  const tl = useTimelineData(tt.active);
  const raf = useRef<number | null>(null);

  const onMap = useMemo(() => new Set(entities.filter((e) => e.lat != null && e.lng != null).map((e) => e.id)), [entities]);
  const names = useMemo(() => new Map(entities.map((e) => [e.id, e.name])), [entities]);

  // Play: move the year along the rail at a steady pace
  useEffect(() => {
    if (!tt.playing) return;
    let last = performance.now();
    const step = (t: number) => {
      const p = posOf(getTimeTravel().year) + (t - last) / 1000 / PLAY_SECONDS;
      last = t;
      if (p >= 1) {
        setTimeTravel({ year: YEAR_MAX, playing: false });
        return;
      }
      setTimeTravel({ year: yearOf(p) });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [tt.playing]);

  // Esc closes time travel
  useEffect(() => {
    if (!tt.active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTimeTravel({ active: false, playing: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tt.active]);

  if (!tt.active) return null;

  const ready = tl.kind === "ready" ? tl : null;
  const all = ready ? [...ready.dated.entries()].filter(([id]) => onMap.has(id)) : [];
  const dated = all.filter(([, d]) => !d.natural);
  const naturalCount = all.length - dated.length;
  let stood = 0;
  let maybe = 0;
  const recent: { id: number; hi: number; founded: boolean }[] = [];
  for (const [id, d] of dated) {
    const s = stateAt(d, tt.year);
    if (s.rise === 1) {
      stood++;
      if (tt.year - d.hi < 60) recent.push({ id, hi: d.hi, founded: d.founded });
    } else if (s.rise > 0) maybe++;
  }
  recent.sort((a, b) => b.hi - a.hi);
  const undated = ready ? ready.undated : [];

  return (
    <section
      aria-label="Travel through time"
      className="kg-panel kg-rise-1 pointer-events-auto fixed inset-x-3 bottom-3 z-20 mx-auto max-w-5xl px-4 pb-3 pt-3 sm:inset-x-6"
    >
      <div className="flex flex-wrap items-start gap-x-5 gap-y-1.5">
        <div className="min-w-[9.5rem]">
          <p className="font-display text-3xl leading-none text-ochre tabular-nums" aria-live="polite">
            {fmtYear(tt.year)}
          </p>
          <p className="mt-1 font-serif text-[15px] italic text-dust">{eraOf(tt.year) || " "}</p>
        </div>

        <div className="order-last w-full min-w-0 text-[14px] sm:order-none sm:w-auto sm:flex-1">
          {tl.kind === "loading" && <p className="text-dust">Loading dates from the archive…</p>}
          {tl.kind === "error" && <p className="text-rust">Couldn&apos;t load the dates: {tl.message}</p>}
          {ready && (
            <>
              <p>
                By <b className="font-medium">{fmtYear(tt.year)}</b>: <b className="font-medium text-ochre">{stood}</b> of{" "}
                {dated.length} dated sites stood
                {maybe > 0 && (
                  <>
                    , and <b className="font-medium text-ochre">{maybe}</b> more may have (sources disagree or give a range)
                  </>
                )}
                .
                {naturalCount > 0 && (
                  <span className="text-dust"> {naturalCount} natural sites (mountains, islands, lakes) are shown throughout.</span>
                )}
              </p>
              {recent.length > 0 && (
                <p className="mt-0.5 truncate text-[13px] text-dust">
                  Recently built or founded:{" "}
                  {recent.slice(0, 3).map((r, i) => (
                    <span key={r.id}>
                      {i > 0 && ", "}
                      <Link href={`/monument/${r.id}`} className="text-ink underline-offset-2 hover:underline">
                        {names.get(r.id)}
                      </Link>{" "}
                      ({r.founded ? "founded " : ""}
                      {fmtYear(r.hi)})
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <button
            type="button"
            onClick={() => {
              if (tt.playing) return setTimeTravel({ playing: false });
              setTimeTravel({ playing: true, year: tt.year >= YEAR_MAX ? YEAR_MIN : tt.year });
            }}
            className="rounded-md bg-water px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90"
          >
            {tt.playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button
            type="button"
            onClick={() => setTimeTravel({ active: false, playing: false })}
            aria-label="Close time travel"
            title="Back to today (Esc)"
            className="grid size-9 place-items-center rounded-md border border-line text-dust hover:text-ink"
          >
            ✕
          </button>
        </div>
      </div>

      {/* the rail: era bands, a tick per monument (gold where its date is disputed), and the slider */}
      <div className="relative mt-3 h-[54px]">
        <div className="absolute inset-x-0 top-0 h-[18px]">
          {ERAS.map(([a, b, name]) => (
            <div
              key={name}
              title={`${name}, about ${fmtYear(a)} to ${fmtYear(b)}`}
              className="absolute top-0 hidden h-[18px] overflow-hidden text-ellipsis whitespace-nowrap border-l border-line pl-1 font-serif text-[11.5px] italic leading-[18px] text-dust odd:bg-ink/[0.04] sm:block"
              style={{ left: `${posOf(Math.max(a, YEAR_MIN)) * 100}%`, width: `${(posOf(Math.min(b, YEAR_MAX)) - posOf(Math.max(a, YEAR_MIN))) * 100}%` }}
            >
              {name}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 top-[20px] h-[10px]" aria-hidden="true">
          {dated.map(([id, d]) => (
            <span
              key={id}
              className={`absolute top-0 h-[10px] w-[2px] -translate-x-1/2 rounded-sm ${d.disputed ? "bg-ochre" : "bg-dust/70"}`}
              style={{ left: `${posOf(d.lo) * 100}%` }}
            />
          ))}
        </div>
        <label htmlFor="kg-year" className="sr-only">
          Year
        </label>
        <input
          id="kg-year"
          type="range"
          min={0}
          max={1000}
          value={Math.round(posOf(tt.year) * 1000)}
          onChange={(e) => setTimeTravel({ year: yearOf(Number(e.target.value) / 1000), playing: false })}
          aria-valuetext={fmtYear(tt.year)}
          className="absolute inset-x-0 top-[30px] w-full accent-[var(--color-ochre)]"
        />
      </div>
      <div className="flex justify-between text-[11.5px] text-dust tabular-nums">
        {[-3600, -300, 500, 1000, 1300, 1600, 1900, 2030].map((y) => (
          <span key={y} className={y === -300 || y === 1300 || y === 1900 ? "hidden sm:inline" : ""}>
            {fmtYear(y)}
          </span>
        ))}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12.5px] text-dust">
        <p className="hidden sm:block">
          <span className="mr-1 inline-block size-2.5 rounded-full border-[1.5px] border-dashed border-ochre align-middle" /> Flickering = sources
          disagree on when it was built. Dates are AI-read from sources; few are checked by a person yet.
        </p>
        {undated.length > 0 && (
          <details className="relative">
            <summary className="cursor-pointer text-water">No date yet: {undated.length} sites</summary>
            <div className="absolute bottom-full right-0 z-10 mb-2 max-h-56 w-72 overflow-y-auto rounded-md border border-line bg-paper p-3 text-[13px] shadow-lg">
              <p className="mb-1.5 text-ink">These sites have no date in the archive, so they&apos;re hidden while travelling in time:</p>
              <ul className="flex flex-wrap gap-1.5">
                {undated.map((u) => (
                  <li key={u.id}>
                    <Link href={`/monument/${u.id}`} className="rounded-full border border-line px-2 py-0.5 text-ink hover:border-ink/40">
                      {u.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

/** The button on the home page that starts time travel. */
export function TimeTravelButton() {
  const tt = useTimeTravel();
  if (tt.active) return null;
  return (
    <button
      type="button"
      onClick={() => setTimeTravel({ active: true, year: YEAR_MIN, playing: true })}
      className="mt-2 flex w-full items-center justify-between gap-3 rounded-md border border-ochre/40 bg-ochre-soft/40 px-3 py-2 text-left text-[14px] hover:bg-ochre-soft/70"
    >
      <span>
        <span className="font-medium text-ink">Travel through time</span>
        <span className="block text-[12.5px] text-dust">Watch Gujarat&apos;s heritage appear, from 3600 BCE to today</span>
      </span>
      <span aria-hidden="true" className="text-ochre">
        ▶
      </span>
    </button>
  );
}
