"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ErrorState, Skeleton } from "@/components/States";
import { getTimeline } from "@/lib/api";
import type { TimelineMonument, TimelineResponse } from "@/lib/types";

// Gujarat through time: every dated monument as a bar from the earliest to the latest date its
// sources give. A single year is a dot; a century is a bar; disagreeing sources show in red.
// The axis is compressed before 1000 CE so Lothal (c. 2400 BCE) and the 19th century both fit.

const W = 1000;
const LABEL = 250;
const RIGHT = 20;
const ROW = 26;
const TOP = 46;

// Piecewise scale: [year, share of the chart width]
const STOPS: [number, number][] = [
  [-2700, 0],
  [0, 0.14],
  [1000, 0.3],
  [2030, 1],
];
function xOf(year: number): number {
  const y = Math.max(STOPS[0][0], Math.min(STOPS[STOPS.length - 1][0], year));
  for (let i = 1; i < STOPS.length; i++) {
    const [y0, f0] = STOPS[i - 1];
    const [y1, f1] = STOPS[i];
    if (y <= y1) return LABEL + (W - LABEL - RIGHT) * (f0 + ((y - y0) / (y1 - y0)) * (f1 - f0));
  }
  return W - RIGHT;
}

// Broad periods of Gujarat's history (approximate dates), drawn behind the bars for orientation.
const ERAS: { name: string; from: number; to: number }[] = [
  { name: "Harappan", from: -2600, to: -1900 },
  { name: "Maitraka", from: 475, to: 776 },
  { name: "Chaulukya (Solanki)", from: 940, to: 1244 },
  { name: "Vaghela", from: 1244, to: 1304 },
  { name: "Gujarat Sultanate", from: 1407, to: 1573 },
  { name: "Mughal", from: 1573, to: 1756 },
  { name: "Maratha & British", from: 1756, to: 1947 },
];
const TICKS = [-2500, -1500, -500, 500, 1000, 1200, 1400, 1600, 1800, 2000];

const yearLabel = (y: number) => (y < 0 ? `${-y} BCE` : `${y}`);
const spanLabel = ([a, b]: [number, number]) => (a === b ? yearLabel(a) : `${yearLabel(a)} – ${yearLabel(b)}`);

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: TimelineResponse };

export default function TimelinePage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [category, setCategory] = useState<string>("all");
  const [hover, setHover] = useState<TimelineMonument | null>(null);
  const router = useRouter();

  const load = () => {
    setState({ kind: "loading" });
    getTimeline()
      .then((data) => setState({ kind: "ready", data }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  };
  useEffect(load, []);
  useEffect(() => {
    document.title = "Gujarat through time · KathaGraph";
  }, []);

  const data = state.kind === "ready" ? state.data : null;
  const categories = useMemo(() => (data ? ["all", ...new Set(data.monuments.map((m) => m.category))] : ["all"]), [data]);
  const rows = useMemo(() => (data ? data.monuments.filter((m) => category === "all" || m.category === category) : []), [data, category]);
  const height = TOP + rows.length * ROW + 20;

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-5xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Timeline</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Gujarat through time</h1>
      <p className="mt-2 max-w-2xl text-[17px] text-dust">
        Every monument placed by the dates its sources give. A bar spans everything the sources allow, so a disputed or
        vague date is wide, not hidden. Red marks dates the sources disagree on.
      </p>

      {state.kind === "loading" && <Skeleton className="mt-8 h-96 w-full" />}
      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Couldn't load the timeline" message={state.message} onRetry={load} />
        </div>
      )}

      {data && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full border px-3 py-1 text-[14px] capitalize ${
                  category === c ? "border-water bg-water text-paper" : "border-line bg-paper text-ink hover:border-ink/40"
                }`}
              >
                {c === "all" ? `All (${data.monuments.length})` : c}
              </button>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto rounded-md border border-line bg-paper">
            <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full min-w-[720px]" role="img" aria-label="Timeline of Gujarat's monuments">
              {ERAS.map((e, i) => (
                <g key={e.name}>
                  <rect
                    x={xOf(e.from)} y={TOP - 6} width={Math.max(2, xOf(e.to) - xOf(e.from))} height={height - TOP}
                    fill={i % 2 ? "var(--color-sand)" : "var(--color-ochre-soft)"} opacity={0.55}
                  />
                  <text x={(xOf(e.from) + xOf(e.to)) / 2} y={TOP - 12} textAnchor="middle" fontSize={11} fill="var(--color-dust)">
                    {xOf(e.to) - xOf(e.from) > 60 ? e.name : ""}
                  </text>
                </g>
              ))}
              {TICKS.map((t) => (
                <g key={t}>
                  <line x1={xOf(t)} x2={xOf(t)} y1={TOP - 6} y2={height - 14} stroke="var(--color-line)" strokeDasharray="2 4" />
                  <text x={xOf(t)} y={height - 2} textAnchor="middle" fontSize={11} fill="var(--color-dust)">
                    {yearLabel(t)}
                  </text>
                </g>
              ))}

              {rows.map((m, i) => {
                const y = TOP + i * ROW + ROW / 2;
                const [a, b] = m.span;
                const x1 = xOf(a);
                const x2 = xOf(b);
                const colour = m.verified ? "var(--color-water)" : m.disputed ? "var(--color-rust)" : "var(--color-ochre)";
                return (
                  <g
                    key={m.id}
                    className="cursor-pointer"
                    onMouseEnter={() => setHover(m)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => router.push(`/monument/${m.id}`)}
                  >
                    <title>{`${m.name}: ${spanLabel(m.span)}${m.disputed ? " (sources disagree)" : ""}`}</title>
                    <rect x={0} y={y - ROW / 2} width={W} height={ROW} fill={hover?.id === m.id ? "var(--color-sand)" : "transparent"} />
                    <text x={LABEL - 12} y={y} dy="0.35em" textAnchor="end" fontSize={13} fill="var(--color-ink)">
                      {m.name.length > 30 ? `${m.name.slice(0, 29)}…` : m.name}
                    </text>
                    {x2 - x1 < 6 ? (
                      <circle cx={x1} cy={y} r={5} fill={colour} />
                    ) : (
                      <rect
                        x={x1} y={y - 5} width={x2 - x1} height={10} rx={5}
                        fill={colour} opacity={m.disputed ? 0.35 : 0.85}
                        stroke={m.disputed ? colour : "none"} strokeDasharray={m.disputed ? "4 3" : undefined}
                      />
                    )}
                    {m.disputed &&
                      m.variants.map((v) =>
                        v.span ? (
                          <line key={v.value} x1={xOf(v.span[0])} x2={xOf(v.span[0])} y1={y - 8} y2={y + 8} stroke="var(--color-rust)" strokeWidth={2} />
                        ) : null,
                      )}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="mt-3 min-h-[3.5rem] text-[14px] text-dust" aria-live="polite">
            {hover ? (
              <p>
                <strong className="text-ink">{hover.name}</strong>
                {hover.dynasty && <> · {hover.dynasty}</>} · {spanLabel(hover.span)}
                {hover.variants.length > 0 && (
                  <>
                    {" "}· sources say:{" "}
                    {hover.variants.map((v, i) => (
                      <span key={v.value}>
                        {i > 0 && " / "}
                        <span className={hover.disputed ? "text-rust" : "text-ink"}>{v.value}</span> ({v.sources.length})
                      </span>
                    ))}
                  </>
                )}
              </p>
            ) : (
              <p className="flex flex-wrap gap-x-5 gap-y-1">
                <Key colour="var(--color-ochre)" text="Date from sources (not yet verified)" />
                <Key colour="var(--color-water)" text="Verified by a reviewer" />
                <Key colour="var(--color-rust)" text="Sources disagree (each tick = one version)" />
                <span>Shaded bands: broad periods of Gujarat&apos;s history (approximate)</span>
              </p>
            )}
          </div>

          {data.undated.length > 0 && (
            <section className="mt-8 rounded-md border border-ochre/30 bg-ochre-soft p-5">
              <h2 className="font-medium text-ochre">Not yet dated: {data.undated.length} monuments</h2>
              <p className="mt-1 text-[14px] text-ink">
                No source in the archive gives a date for these. An inscription photo or a field note could fix that.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {data.undated.map((m) => (
                  <li key={m.id}>
                    <Link href={`/monument/${m.id}`} className="inline-block rounded-full border border-line bg-paper px-3 py-1 text-[14px] hover:border-ink/40">
                      {m.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Key({ colour, text }: { colour: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-5 rounded-full" style={{ background: colour }} aria-hidden="true" />
      {text}
    </span>
  );
}
