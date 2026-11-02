"use client";

// Time travel on the home map: a year chosen on the slider, shared between the slider (UI)
// and the 3D map. The map reads the year every frame with getTimeTravel(), so dragging or playing
// the slider never re-renders the whole map; it only re-renders when time travel is switched on or off.

import { useEffect, useState, useSyncExternalStore } from "react";
import { getTimeline } from "./api";
import type { TimelineResponse } from "./types";

export interface TimeTravel {
  active: boolean;
  year: number; // negative = BCE
  playing: boolean;
}

let state: TimeTravel = { active: false, year: 1499, playing: false };
const listeners = new Set<() => void>();

export function getTimeTravel(): TimeTravel {
  return state;
}

export function setTimeTravel(patch: Partial<TimeTravel>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const SERVER: TimeTravel = { active: false, year: 1499, playing: false };

/** The whole state: for the slider UI. */
export function useTimeTravel(): TimeTravel {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTimeTravel,
    () => SERVER,
  );
}

/** Only whether time travel is on: for the map, so it doesn't re-render on every year. */
export function useTimeTravelActive(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state.active,
    () => false,
  );
}

// ---------------------------------------------------------------------------
// Dates from GET /timeline, loaded once and shared.

export interface Dated {
  lo: number; // earliest year any source gives
  hi: number; // latest year any source gives
  disputed: boolean; // sources give different dates
  verified: boolean; // a person has checked the date
  variants: { value: string; sources: string[] }[];
  /** A settlement's date is when it was founded; a structure's is when it was built. */
  founded: boolean;
  /** A natural place (mountain, island…): there all along, so always shown. */
  natural: boolean;
}

export type TimelineState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; dated: Map<number, Dated>; undated: { id: number; name: string }[]; data: TimelineResponse };

let cached: Promise<TimelineResponse> | null = null;

export function useTimelineData(enabled: boolean): TimelineState {
  const [s, setS] = useState<TimelineState>({ kind: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    cached ??= getTimeline();
    cached
      .then((data) => {
        if (!alive) return;
        const dated = new Map<number, Dated>();
        for (const m of data.monuments) {
          if (!m.span) continue;
          dated.set(m.id, {
            lo: Math.min(m.span[0], m.span[1]),
            hi: Math.max(m.span[0], m.span[1]),
            disputed: m.disputed,
            verified: m.verified,
            variants: m.variants.filter((v) => v.span).map((v) => ({ value: v.value, sources: v.sources })),
            founded: m.date_meaning === "founded" || m.nature === "settlement",
            natural: false,
          });
        }
        for (const n of data.natural ?? []) {
          dated.set(n.id, { lo: YEAR_MIN, hi: YEAR_MIN, disputed: false, verified: true, variants: [], founded: false, natural: true });
        }
        setS({ kind: "ready", dated, undated: data.undated.map((u) => ({ id: u.id, name: u.name })), data });
      })
      .catch((e: Error) => {
        cached = null; // allow a retry
        if (alive) setS({ kind: "error", message: e.message });
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return s;
}

/** What a monument looks like at a given year. rise: 0 (not built) to 1 (standing). */
export function stateAt(d: Dated | undefined, year: number): { rise: number; alpha: number; flicker: boolean } {
  if (!d) return { rise: 0, alpha: 0, flicker: false }; // no date: hidden while travelling in time
  if (d.natural) return { rise: 1, alpha: 1, flicker: false }; // a mountain or island was always there
  if (year >= d.hi) return { rise: 1, alpha: 1, flicker: false };
  if (year >= d.lo) return { rise: 0.75, alpha: 0.6, flicker: d.disputed }; // within its date range
  return { rise: 0, alpha: 0, flicker: false };
}

// ---------------------------------------------------------------------------
// The slider's time scale: stretched where monuments are dense, squeezed where they're sparse.

const KNOTS: [number, number][] = [
  [-3600, 0],
  [-300, 0.09],
  [500, 0.2],
  [1000, 0.36],
  [1300, 0.52],
  [1600, 0.72],
  [1900, 0.9],
  [2030, 1],
];
export const YEAR_MIN = -3600;
export const YEAR_MAX = 2030;

export function posOf(y: number): number {
  for (let i = 1; i < KNOTS.length; i++) {
    const [a, pa] = KNOTS[i - 1];
    const [b, pb] = KNOTS[i];
    if (y <= b) return pa + ((pb - pa) * (y - a)) / (b - a);
  }
  return 1;
}

export function yearOf(p: number): number {
  for (let i = 1; i < KNOTS.length; i++) {
    const [a, pa] = KNOTS[i - 1];
    const [b, pb] = KNOTS[i];
    if (p <= pb) return Math.round(a + ((b - a) * (p - pa)) / (pb - pa));
  }
  return YEAR_MAX;
}

export const fmtYear = (y: number) => (y < 0 ? `${-y} BCE` : `${y} CE`);

/** Broad periods for orientation only; boundaries are approximate. */
export const ERAS: [number, number, string][] = [
  [-3600, -1900, "Harappan"],
  [-320, 550, "Early historic"],
  [550, 780, "Maitraka"],
  [940, 1244, "Chaulukya (Solanki)"],
  [1244, 1304, "Vaghela"],
  [1407, 1573, "Gujarat Sultanate"],
  [1573, 1756, "Mughal"],
  [1756, 1947, "Maratha and colonial"],
  [1947, 2030, "Independent India"],
];

export const eraOf = (y: number) => ERAS.find(([a, b]) => y >= a && y < b)?.[2] ?? "";
