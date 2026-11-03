"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import GujaratMap2D, { type MapPoint, type MapRoute } from "@/components/GujaratMap2D";
import LivingTabs from "@/components/LivingTabs";
import { ErrorState, Skeleton } from "@/components/States";
import { getJourneys } from "@/lib/api";
import type { Journey, JourneysResponse } from "@/lib/types";

// Routes through the archive. Heritage trails join every mapped monument of one kind in a sensible
// visiting order; field journeys replay the route a fellowship team actually took, from their photos.

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: JourneysResponse };

const TONE: Record<string, MapRoute["tone"]> = { stepwell: "water", temple: "ochre", mosque: "rust", fort: "rust" };

function when(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export default function JourneysPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ kind: "loading" });
    getJourneys()
      .then((data) => {
        setState({ kind: "ready", data });
        setSelected(data.field[0]?.id ?? data.trails[0]?.id ?? null);
      })
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = "Routes & journeys · KathaGraph";
  }, []);

  const all: Journey[] = state.kind === "ready" ? [...state.data.field, ...state.data.trails] : [];
  const current = all.find((j) => j.id === selected) ?? null;

  const routes: MapRoute[] = useMemo(
    () =>
      all.map((j) => ({
        id: j.id,
        points: j.stops,
        tone: j.kind === "field" ? "rust" : TONE[j.category ?? ""] ?? "water",
        numbered: true,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );
  const points: MapPoint[] = (current?.stops ?? []).map((s, i) => ({
    id: `${current?.id}-${i}`,
    lat: s.lat,
    lng: s.lng,
    label: s.name,
    tone: "ink",
    size: 0.01, // stops are drawn as numbered circles by the route
  }));

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-6xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Living heritage</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Routes through Gujarat</h1>
      <p className="mt-2 max-w-3xl text-[17px] text-dust">
        Explore the region along a route instead of a list. Field journeys are rebuilt from where and when each
        team&apos;s photos were taken; heritage trails link every mapped monument of one kind in a sensible visiting order.
      </p>
      <LivingTabs current="/journeys" />

      {state.kind === "loading" && <Skeleton className="mt-8 h-[420px] w-full" />}
      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Couldn't load the routes" message={state.message} onRetry={load} />
        </div>
      )}

      {state.kind === "ready" && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-md border border-line bg-paper p-3">
              <GujaratMap2D routes={routes} points={points} selected={selected} label={current ? `Route: ${current.title}` : "Routes in Gujarat"} />
              {current && (
                <p className="mt-2 px-1 text-[13px] text-dust">
                  <strong className="text-ink">{current.title}</strong> · {current.stops.length} stops · about {current.km} km in
                  straight lines
                  {current.kind === "field" && current.start && <> · {when(current.start)} – {when(current.end)}</>}
                </p>
              )}
            </div>
            {current && (
              <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {current.stops.map((s, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-[14px]">
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-sand text-[11px] font-semibold text-dust">{i + 1}</span>
                    {s.id ? (
                      <Link href={`/monument/${s.id}`} className="text-water underline-offset-2 hover:underline">
                        {s.name}
                      </Link>
                    ) : (
                      <span>{s.name}</span>
                    )}
                    {s.photos && s.photos > 1 && <span className="text-[12px] text-dust">· {s.photos} photos</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="space-y-6">
            <section>
              <h2 className="text-[13px] uppercase tracking-wide text-dust">Field journeys</h2>
              {state.data.field.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-line px-4 py-4 text-[15px] text-dust">
                  No field journeys yet. Upload a team&apos;s photos with location turned on, and put the team name in
                  &ldquo;Credit&rdquo; on the upload page: their route appears here.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {state.data.field.map((j) => (
                    <JourneyCard key={j.id} j={j} on={selected === j.id} onPick={() => setSelected(j.id)} />
                  ))}
                </ul>
              )}
              {state.data.field.length > 0 && (
                <p className="mt-2 text-[14px]">
                  <Link href="/teams" className="text-water underline-offset-2 hover:underline">
                    See each team&apos;s photos, facts and the gaps they closed →
                  </Link>
                </p>
              )}
            </section>
            <section>
              <h2 className="text-[13px] uppercase tracking-wide text-dust">Heritage trails</h2>
              <ul className="mt-2 space-y-2">
                {state.data.trails.map((j) => (
                  <JourneyCard key={j.id} j={j} on={selected === j.id} onPick={() => setSelected(j.id)} />
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}

function JourneyCard({ j, on, onPick }: { j: Journey; on: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        onClick={onPick}
        aria-pressed={on}
        className={`w-full rounded-md border bg-paper px-4 py-3 text-left transition ${on ? "border-water ring-2 ring-water/25" : "border-line hover:border-ink/30"}`}
      >
        <span className="font-serif text-lg text-ink">{j.title}</span>
        <span className="mt-0.5 block text-[13px] text-dust">
          {j.stops.length} stops · ~{j.km} km
          {j.kind === "field" ? (
            <>
              {" "}· {j.photos} photos · {when(j.start)}
              {!j.timed && " · order from upload time (photos had no capture date)"}
            </>
          ) : (
            <> · {j.stops.slice(0, 3).map((s) => s.name).join(" → ")}{j.stops.length > 3 ? " → …" : ""}</>
          )}
        </span>
      </button>
    </li>
  );
}
