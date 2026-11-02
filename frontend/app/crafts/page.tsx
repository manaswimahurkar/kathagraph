"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import GujaratMap2D, { type MapPoint } from "@/components/GujaratMap2D";
import LivingTabs from "@/components/LivingTabs";
import { ErrorState, Skeleton } from "@/components/States";
import { getCrafts } from "@/lib/api";
import type { Craft, CraftsResponse } from "@/lib/types";

// Indigenous crafts as records of their own, not footnotes to buildings: how each is made, who
// practises it, from what, and every place the archive documents it, each fact traced to a file.

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: CraftsResponse };

const FIELDS: [string, string][] = [
  ["technique", "How it is made"],
  ["practitioners", "Who practises it"],
  ["material", "Materials"],
  ["location", "Where"],
  ["purpose", "Used for"],
  ["legend", "Stories told about it"],
  ["built_date", "Since"],
];

export default function CraftsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(() => {
    setState({ kind: "loading" });
    getCrafts()
      .then((data) => {
        setState({ kind: "ready", data });
        setSelected(data.crafts[0]?.id ?? null);
      })
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = "Crafts · KathaGraph";
  }, []);

  const crafts = state.kind === "ready" ? state.data.crafts : [];
  const current = crafts.find((c) => c.id === selected) ?? null;

  const points: MapPoint[] = useMemo(
    () =>
      crafts.flatMap((c) =>
        c.places.map((p, i) => ({
          id: `${c.id}-${i}`,
          lat: p.lat,
          lng: p.lng,
          label: `${c.name} · ${p.name}`,
          tone: c.id === selected ? ("rust" as const) : ("ochre" as const),
          size: c.id === selected ? 0.75 : 0.45,
          approximate: p.precision === "approximate",
        })),
      ),
    [crafts, selected],
  );

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-6xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Living heritage</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Crafts of Gujarat</h1>
      <p className="mt-2 max-w-3xl text-[17px] text-dust">
        Weaving, block printing, embroidery, painting: traditions recorded as records of their own. How each is made,
        who keeps it alive and where, every fact traced to the file that states it.
      </p>
      <LivingTabs current="/crafts" />

      {state.kind === "loading" && <Skeleton className="mt-8 h-[420px] w-full" />}
      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Couldn't load the crafts" message={state.message} onRetry={load} />
        </div>
      )}

      {state.kind === "ready" &&
        (crafts.length === 0 ? (
          <div className="mt-8 rounded-md border border-dashed border-line px-5 py-10 text-center">
            <p className="font-serif text-lg text-ink">No crafts recorded yet</p>
            <p className="mt-1 text-[15px] text-dust">
              Upload notes from a visit to an artisan: the craft, its technique and its makers become a record here.
            </p>
          </div>
        ) : (
          <>
            {/* A shelf of crafts: each with its photo, or a woven pattern when the archive has none yet */}
            <ul className="mt-6 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]" aria-label="Crafts">
              {crafts.map((c, i) => (
                <li key={c.id} className="shrink-0">
                  <button
                    onClick={() => setSelected(c.id)}
                    aria-pressed={selected === c.id}
                    className={`group block w-36 overflow-hidden rounded-md border text-left transition ${
                      selected === c.id ? "border-rust ring-2 ring-rust/40" : "border-line hover:border-ink/40"
                    }`}
                  >
                    <CraftThumb c={c} seed={i} className="h-24 w-full" />
                    <span className={`block truncate px-2.5 py-2 text-[14px] ${selected === c.id ? "bg-rust text-paper" : "bg-paper text-ink"}`}>
                      {c.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div className="lg:sticky lg:top-24 lg:self-start">
                <div className="rounded-md border border-line bg-paper p-3">
                  <GujaratMap2D
                    points={points}
                    onSelect={(id) => setSelected(Number(String(id).split("-")[0]))}
                    label="Map of Gujarat with the places where each craft is documented"
                  />
                  <p className="mt-2 px-1 text-[13px] text-dust">
                    Red: {current?.name ?? "the selected craft"}. Gold: other crafts. A halo means the town or district
                    named in a document, not an exact workshop.
                  </p>
                </div>
              </div>
              {current && <CraftRecord c={current} />}
            </div>
          </>
        ))}
    </main>
  );
}

function CraftRecord({ c }: { c: Craft }) {
  const hero = c.photos[0];
  const how = c.facts.technique?.[0]?.value;
  return (
    <article className="overflow-hidden rounded-md border border-line bg-paper" aria-live="polite">
      <div className="relative">
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero.url} alt={`${c.name}`} className="h-56 w-full object-cover sm:h-72" />
        ) : (
          <CraftThumb c={c} seed={c.id} className="h-40 w-full sm:h-48" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#1c140d]/90 via-[#1c140d]/30 to-transparent" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 p-5">
          <h2 className="kg-title font-display text-4xl leading-none text-[#f6efe2] sm:text-5xl">{c.name}</h2>
          {how && <p className="mt-2 max-w-xl text-[15px] text-[#e9dcc4]">{how}</p>}
        </div>
        {hero && (hero.author || hero.licence) && (
          <p className="absolute right-2 top-2 rounded bg-[#1c140d]/70 px-2 py-0.5 text-[11px] text-[#e9dcc4]">
            Photo: {[hero.author, hero.licence?.replace(/\s*\(https?:[^)]*\)/, "")].filter(Boolean).join(", ")}
          </p>
        )}
      </div>
      <div className="p-5">
      {c.aliases.length > 0 && <p className="text-[15px] text-dust">Also called {c.aliases.join(", ")}</p>}
      <p className="mt-1 text-[13px] text-dust">
        {c.n_sources} {c.n_sources === 1 ? "source" : "sources"} · {c.places.length} {c.places.length === 1 ? "place" : "places"}{" "}
        ·{" "}
        <Link href={`/monument/${c.id}`} className="text-water underline underline-offset-2">
          full record, evidence graph and sources →
        </Link>
      </p>

      <dl className="mt-4 divide-y divide-line">
        {FIELDS.filter(([f]) => c.facts[f]?.length).map(([f, label]) => (
          <div key={f} className="py-3">
            <dt className="text-[12px] uppercase tracking-wide text-dust">{label}</dt>
            {c.facts[f].map((x, i) => (
              <dd key={i} className="mt-1">
                <span className="font-serif text-[17px] text-ink">{x.value}</span>
                <span className="ml-2 text-[12px] text-dust">
                  <Link href={`/source/${x.source_id}`} className="underline underline-offset-2">
                    {x.filename}
                  </Link>
                  {x.status === "verified" && " · ✓ checked"}
                </span>
              </dd>
            ))}
          </div>
        ))}
      </dl>

      {c.places.length > 0 && (
        <div className="mt-2">
          <p className="text-[12px] uppercase tracking-wide text-dust">Documented at</p>
          <ul className="mt-1 flex flex-wrap gap-2 text-[14px]">
            {c.places.map((p, i) => (
              <li key={i} className="rounded border border-line bg-sand/50 px-2 py-0.5">
                {p.entity_id ? (
                  <Link href={`/monument/${p.entity_id}`} className="text-water">
                    {p.name}
                  </Link>
                ) : (
                  p.name
                )}{" "}
                <span className="text-[12px] text-dust">({p.how})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.missing.length > 0 && (
        <p className="mt-4 rounded border border-ochre/30 bg-ochre-soft px-3 py-2 text-[14px]">
          <span className="font-medium text-ochre">Still to document: </span>
          {c.missing.join(", ")}.{" "}
          <Link href="/upload" className="text-water underline underline-offset-2">
            Add field notes or photos
          </Link>
        </p>
      )}
      </div>
    </article>
  );
}

/** A craft's photo, or, when the archive has none yet, a woven pattern in the site's colours. */
function CraftThumb({ c, seed, className = "" }: { c: Craft; seed: number; className?: string }) {
  const p = c.photos[0];
  if (p) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.url} alt="" loading="lazy" className={`${className} object-cover`} />;
  }
  const tones = ["#9b3b2a", "#9a6316", "#2e5e5b", "#6b4a1c"];
  const a = tones[seed % tones.length];
  const b = tones[(seed + 1) % tones.length];
  return (
    <span
      aria-hidden="true"
      className={`${className} block`}
      style={{
        backgroundColor: a,
        backgroundImage: `repeating-linear-gradient(45deg, ${b} 0 6px, transparent 6px 14px), repeating-linear-gradient(-45deg, rgba(246,239,226,0.25) 0 2px, transparent 2px 14px)`,
      }}
    />
  );
}
