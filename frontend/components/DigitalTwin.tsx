"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getTwin, photoBundleUrl } from "@/lib/api";
import type { TwinReport } from "@/lib/types";
import { Skeleton } from "./States";

// The path from crowdsourced photos to a 3D digital twin, made visible: where every photo was taken
// from, which sides of the monument are still missing, how close the set is to a reconstruction,
// and a one-click photogrammetry bundle. A finished model uploaded on this page shows at the top.

const TwinScene = dynamic(() => import("./TwinScene"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

const STAGE: Record<TwinReport["stage"], { label: string; text: string; cls: string }> = {
  starting: { label: "Just starting", text: "Too few photos to rebuild in 3D yet.", cls: "bg-rust-soft text-rust" },
  collecting: { label: "Collecting", text: "Getting there: fill the missing sides.", cls: "bg-ochre-soft text-ochre" },
  ready: { label: "Ready to reconstruct", text: "Enough overlapping photos from enough sides.", cls: "bg-water-soft text-water" },
  modelled: { label: "3D model built", text: "A model is shown at the top of this page.", cls: "bg-water-soft text-water" },
};
const TAG: Record<string, string> = {
  exterior_photo: "exterior", interior_photo: "interior", inscription: "inscription", carving_detail: "carving detail", other: "other",
};

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function DigitalTwin({ entityId }: { entityId: number }) {
  const [report, setReport] = useState<TwinReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [gl, setGl] = useState(true);

  useEffect(() => {
    setGl(webglOk());
    getTwin(entityId).then(setReport).catch((e: Error) => setError(e.message));
  }, [entityId]);

  if (error) return <p className="text-[15px] text-dust">The 3D readiness check isn&apos;t available right now ({error}).</p>;
  if (!report) return <Skeleton className="h-[380px] w-full" />;

  const stage = STAGE[report.stage];
  const pct = Math.round(report.score * 100);
  const bundle = photoBundleUrl(entityId);
  const shot = report.shots.find((s) => s.id === hover);
  const sidesDone = report.coverage.filter(Boolean).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="relative h-[340px] overflow-hidden rounded-md border border-line bg-paper sm:h-[420px]">
        {report.photos === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center text-[15px] text-dust">
            No photos of this monument yet. The first photos you upload start its 3D record.
          </div>
        ) : gl ? (
          <TwinScene report={report} onHover={setHover} />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-[15px] text-dust">
            This browser can&apos;t show 3D. The coverage numbers on the right still apply.
          </div>
        )}
        <p className="pointer-events-none absolute left-3 top-3 rounded bg-paper/85 px-2 py-1 text-[12px] text-dust">
          Drag to turn · ▲ marks north · coloured ring = sides covered, red = missing
        </p>
        {shot && (
          <p className="pointer-events-none absolute bottom-3 left-3 rounded bg-paper/90 px-2 py-1 text-[13px] text-ink">
            {TAG[shot.tag ?? "other"] ?? shot.tag} photo
            {shot.side != null && ` · from the ${report.sides[shot.side]}`}
            {shot.distance_m != null && ` · ${shot.distance_m} m away`}
            {shot.author && ` · ${shot.author}`}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-medium ${stage.cls}`}>{stage.label}</span>
          <span className="text-[14px] text-dust">{stage.text}</span>
        </div>
        <div className="mt-3" aria-label={`Reconstruction readiness ${pct} percent`}>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-sand" aria-hidden="true">
            <div className="bg-water transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-[13px] text-dust">{pct}% ready</p>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat n={`${report.photos}/${report.target}`} label="photos" />
          <Stat n={`${sidesDone}/8`} label="sides covered" />
          <Stat n={String(report.placed)} label="photos placed" />
        </dl>
        <CompassRose coverage={report.coverage} sides={report.sides} />
        {report.todo.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[14px]">
            {report.todo.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-ochre">→</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {bundle && report.photos > 0 && (
            <a href={bundle} className="rounded-md bg-water px-3 py-2 text-[14px] font-medium text-paper hover:opacity-90">
              Download photogrammetry bundle
            </a>
          )}
          <Link href="/upload" className="rounded-md border border-line px-3 py-2 text-[14px] font-medium text-ink hover:bg-sand">
            Add photos
          </Link>
        </div>
        <p className="mt-2 text-[12px] text-dust">
          The bundle holds every photo plus <code>cameras.csv</code> (GPS and compass heading of each shot). Open it in
          Meshroom or COLMAP to build the model, then add the .glb with “Add a 3D model” at the top of this page.
        </p>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="rounded border border-line bg-paper px-2 py-2">
      <dt className="sr-only">{label}</dt>
      <dd className="font-serif text-xl text-ink">{n}</dd>
      <dd className="text-[12px] text-dust">{label}</dd>
    </div>
  );
}

/** The same coverage as the 3D ring, readable without WebGL and by screen readers. */
function CompassRose({ coverage, sides }: { coverage: number[]; sides: string[] }) {
  const max = Math.max(1, ...coverage);
  return (
    <figure className="mt-3 flex items-center gap-4">
      <svg viewBox="-50 -50 100 100" className="h-28 w-28 shrink-0" aria-hidden="true">
        {coverage.map((n, i) => {
          const a0 = ((i * 45 - 22.5) * Math.PI) / 180;
          const a1 = ((i * 45 + 22.5) * Math.PI) / 180;
          const r = 18 + (n ? 26 * (n / max) : 0) + 4;
          const p = (a: number, rr: number) => `${(Math.sin(a) * rr).toFixed(1)},${(-Math.cos(a) * rr).toFixed(1)}`;
          return (
            <path key={i} d={`M${p(a0, 14)}L${p(a0, r)}A${r},${r} 0 0 1 ${p(a1, r)}L${p(a1, 14)}A14,14 0 0 0 ${p(a0, 14)}Z`}
              fill={n ? "var(--color-water)" : "var(--color-rust-soft)"} opacity={n ? 0.4 + 0.6 * (n / max) : 1}
              stroke="var(--color-paper)" strokeWidth="1" />
          );
        })}
        <text x="0" y="-46" textAnchor="middle" fontSize="9" fill="var(--color-dust)">N</text>
      </svg>
      <figcaption className="text-[13px] text-dust">
        {coverage.map((n, i) => (
          <span key={i} className="mr-2 inline-block">
            <span className={n ? "text-water" : "text-rust"}>{sides[i]}</span> {n}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
