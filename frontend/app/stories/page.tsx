"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import GujaratMap2D, { type MapPoint } from "@/components/GujaratMap2D";
import LivingTabs from "@/components/LivingTabs";
import { ErrorState, Skeleton } from "@/components/States";
import { getStories } from "@/lib/api";
import type { StoriesResponse, Story } from "@/lib/types";

// Folklore on the map: every legend the AI found in the archive's texts, pinned to the place it is
// told about, with the exact words it came from. Click a pin or a story to see the other.

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: StoriesResponse };

export default function StoriesPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(() => {
    setState({ kind: "loading" });
    getStories()
      .then((data) => setState({ kind: "ready", data }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = "Stories & legends · KathaGraph";
  }, []);

  const stories = state.kind === "ready" ? state.data.stories : [];
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? stories.filter((s) => `${s.story} ${s.entity.name}`.toLowerCase().includes(q)) : stories;
  }, [stories, filter]);

  // One pin per place; selecting a story selects its place
  const pins: MapPoint[] = useMemo(() => {
    const byEntity = new Map<number, Story[]>();
    shown.forEach((s) => s.lat != null && byEntity.set(s.entity.id, [...(byEntity.get(s.entity.id) ?? []), s]));
    return [...byEntity.values()].map((list) => ({
      id: list[0].entity.id,
      lat: list[0].lat as number,
      lng: list[0].lng as number,
      label: `${list[0].entity.name} · ${list.length} ${list.length === 1 ? "story" : "stories"}`,
      tone: "rust" as const,
      size: 0.45 + Math.min(list.length, 6) * 0.12,
      approximate: list[0].precision === "approximate",
    }));
  }, [shown]);

  const selectedEntity = selected != null ? stories.find((s) => s.id === selected)?.entity.id ?? null : null;

  function pickPlace(entityId: string | number) {
    const first = shown.find((s) => s.entity.id === entityId);
    if (first) {
      setSelected(first.id);
      document.getElementById(`story-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-6xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Living heritage</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Stories the stones tell</h1>
      <p className="mt-2 max-w-3xl text-[17px] text-dust">
        Legends, folk tales and local beliefs found in the archive&apos;s documents, pinned to the places they are told
        about. Each one keeps the exact words it came from, in the original language, so it can be checked.
      </p>
      <LivingTabs current="/stories" />

      {state.kind === "loading" && <Skeleton className="mt-8 h-[420px] w-full" />}
      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Couldn't load the stories" message={state.message} onRetry={load} />
        </div>
      )}

      {state.kind === "ready" &&
        (stories.length === 0 ? (
          <div className="mt-8 rounded-md border border-dashed border-line px-5 py-10 text-center">
            <p className="font-serif text-lg text-ink">No stories found yet</p>
            <p className="mt-1 text-[15px] text-dust">
              Upload a travel journal, a field report or an interview transcript: legends in it appear here.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-md border border-line bg-paper p-3">
                <GujaratMap2D
                  points={pins}
                  selected={selectedEntity}
                  onSelect={pickPlace}
                  label={`Map of Gujarat with ${pins.length} places that have stories`}
                />
                <p className="mt-2 px-1 text-[13px] text-dust">
                  {stories.length} {stories.length === 1 ? "story" : "stories"} at {state.data.places}{" "}
                  {state.data.places === 1 ? "place" : "places"}. Bigger pins hold more stories; a soft halo means the
                  spot is approximate (the town the story names).
                </p>
              </div>
            </div>

            <div>
              <label className="block">
                <span className="sr-only">Filter stories</span>
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter: queen, curse, snake, Patan…"
                  className="w-full rounded-md border border-line bg-paper px-3 py-2 text-[15px] placeholder:text-dust focus:border-water"
                />
              </label>
              <ol className="mt-3 space-y-3">
                {shown.map((s) => (
                  <li
                    key={s.id}
                    id={`story-${s.id}`}
                    className={`scroll-mt-28 rounded-md border bg-paper p-4 transition ${
                      selected === s.id ? "border-rust ring-2 ring-rust/20" : "border-line"
                    }`}
                  >
                    <button onClick={() => setSelected(s.id)} className="flex w-full gap-4 text-left">
                      {s.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.photo.url}
                          alt=""
                          loading="lazy"
                          title={s.photo.author ? `Photo: ${[s.photo.author, s.photo.licence].filter(Boolean).join(", ")}` : undefined}
                          className="size-20 shrink-0 rounded object-cover sm:size-24"
                        />
                      ) : (
                        <span aria-hidden="true" className="grid size-20 shrink-0 place-items-center rounded bg-sand font-display text-3xl text-ochre sm:size-24">
                          {s.entity.name.charAt(0)}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="text-[13px] text-rust">{s.entity.name}</span>
                        <span className="mt-1 block font-serif text-[18px] leading-snug text-ink">{s.story}</span>
                      </span>
                    </button>
                    {s.quote && (
                      <blockquote className="mt-2 border-l-4 border-ochre/60 pl-3 font-serif text-[15px] italic text-dust">
                        “{s.quote}”
                      </blockquote>
                    )}
                    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-dust">
                      <Link href={`/source/${s.source.id}`} className="text-water underline underline-offset-2">
                        {s.source.filename}
                      </Link>
                      <span>{s.source.origin === "web" ? "Published reference" : "Field record"}</span>
                      <span>{s.status === "verified" ? "✓ checked by a person" : "found by AI, not yet checked"}</span>
                      <Link href={`/monument/${s.entity.id}`} className="text-water underline underline-offset-2">
                        Open record →
                      </Link>
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ))}
    </main>
  );
}
