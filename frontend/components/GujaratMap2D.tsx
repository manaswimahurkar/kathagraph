"use client";

import { GUJARAT_BBOX, GUJARAT_OUTLINE, project } from "@/lib/geo";

// A flat, light map of Gujarat drawn as SVG: fast, printable, works without WebGL or map tiles.
// Used for stories, journeys and crafts, where the point is the pattern across the state.

export interface MapPoint {
  id: string | number;
  lat: number;
  lng: number;
  label?: string;
  tone?: "water" | "ochre" | "rust" | "ink";
  size?: number;
  approximate?: boolean;
}
export interface MapRoute {
  id: string;
  points: { lat: number; lng: number }[];
  tone?: "water" | "ochre" | "rust";
  numbered?: boolean;
}

const PAD = 2;
const [X0, Z0] = project(GUJARAT_BBOX.west, GUJARAT_BBOX.north);
const [X1, Z1] = project(GUJARAT_BBOX.east, GUJARAT_BBOX.south);
const VIEW = `${X0 - PAD} ${Z0 - PAD} ${X1 - X0 + 2 * PAD} ${Z1 - Z0 + 2 * PAD}`;
const OUTLINE = GUJARAT_OUTLINE.map(
  (ring) => "M" + ring.map(([lon, lat]) => project(lon, lat).map((v) => v.toFixed(2)).join(",")).join("L") + "Z",
).join("");

const COLOR = { water: "var(--color-water)", ochre: "var(--color-ochre)", rust: "var(--color-rust)", ink: "var(--color-ink)" };

export default function GujaratMap2D({
  points = [],
  routes = [],
  selected,
  onSelect,
  label,
  className = "",
}: {
  points?: MapPoint[];
  routes?: MapRoute[];
  selected?: string | number | null;
  onSelect?: (id: string | number) => void;
  label: string;
  className?: string;
}) {
  return (
    <svg viewBox={VIEW} role="img" aria-label={label} className={`h-auto w-full ${className}`}>
      <defs>
        <pattern id="kg-map-hatch" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="1.2" stroke="var(--color-line)" strokeWidth="0.25" />
        </pattern>
      </defs>
      <path d={OUTLINE} fill="var(--color-sand)" stroke="var(--color-dust)" strokeWidth="0.18" strokeLinejoin="round" />
      <path d={OUTLINE} fill="url(#kg-map-hatch)" opacity="0.5" />

      {routes.map((r) => {
        const pts = r.points.map((p) => project(p.lng, p.lat));
        const d = pts.map(([x, z], i) => `${i ? "L" : "M"}${x.toFixed(2)},${z.toFixed(2)}`).join("");
        const on = selected === r.id;
        return (
          <g key={r.id} className="kg-route" opacity={selected == null || on ? 1 : 0.18}>
            <path d={d} fill="none" stroke={COLOR[r.tone ?? "water"]} strokeWidth={on ? 0.42 : 0.28}
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray={on ? "none" : "0.9 0.5"} />
            {r.numbered && on &&
              pts.map(([x, z], i) => (
                <g key={i}>
                  <circle cx={x} cy={z} r={0.75} fill="var(--color-paper)" stroke={COLOR[r.tone ?? "water"]} strokeWidth="0.15" />
                  <text x={x} y={z + 0.3} textAnchor="middle" fontSize="0.8" fontWeight={700} fill={COLOR[r.tone ?? "water"]}>
                    {i + 1}
                  </text>
                </g>
              ))}
          </g>
        );
      })}

      {points.map((p) => {
        const [x, z] = project(p.lng, p.lat);
        const on = selected === p.id;
        const r = (p.size ?? 0.55) * (on ? 1.5 : 1);
        return (
          <g
            key={p.id}
            onClick={onSelect ? () => onSelect(p.id) : undefined}
            className={onSelect ? "cursor-pointer" : undefined}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onKeyDown={onSelect ? (e) => (e.key === "Enter" || e.key === " ") && onSelect(p.id) : undefined}
            aria-label={p.label}
          >
            {p.approximate && <circle cx={x} cy={z} r={r * 2.2} fill={COLOR[p.tone ?? "ochre"]} opacity="0.12" />}
            <circle cx={x} cy={z} r={r} fill={COLOR[p.tone ?? "ochre"]} stroke="var(--color-paper)" strokeWidth="0.15" />
            {p.label && <title>{p.label}</title>}
            {on && p.label && (
              <text x={x + r + 0.5} y={z + 0.35} fontSize="1.05" fill="var(--color-ink)" stroke="var(--color-paper)"
                strokeWidth="0.3" paintOrder="stroke" fontWeight={600}>
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
