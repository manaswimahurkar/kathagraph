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
            <ul className="mt-6 flex flex-wrap gap-2">
              {crafts.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelected(c.id)}
                    aria-pressed={selected === c.id}
                    className={`rounded-full border px-3.5 py-1.5 text-[15px] ${
                      selected === c.id ? "border-rust bg-rust text-paper" : "border-line bg-paper text-ink hover:border-ink/40"
                    }`}
                  >
                    {c.name}
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
  return (
    <article className="rounded-md border border-line bg-paper p-5" aria-live="polite">
      <h2 className="font-display text-3xl">{c.name}</h2>
      {c.aliases.length > 0 && <p className="mt-1 text-[15px] text-dust">Also called {c.aliases.join(", ")}</p>}
      <p className="mt-1 text-[13px] text-dust">
        {c.n_sources} {c.n_sources === 1 ? "source" : "sources"} · {c.places.length} {c.places.length === 1 ? "place" : "places"}{" "}
        ·{" "}
        <Link href={`/monument/${c.id}`} className="text-water underline underline-offset-2">
          full record, evidence graph and sources →
        </Link>
      </p>

      {c.photos.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {c.photos.slice(0, 3).map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={u} src={u} alt={`${c.name}, field photo`} className="aspect-square w-full rounded object-cover" loading="lazy" />
          ))}
        </div>
      )}

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
    </article>
  );
}
