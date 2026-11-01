"use client";

import { useMemo, useState } from "react";
import { fieldLabel, type Claim, type EntityDetail, type EntitySource } from "@/lib/types";

/**
 * How the evidence connects: the monument at the centre, the kinds of fact around it, each value
 * a source states, and the sources on the outer ring. Values that disagree are linked in red.
 * Hover a source to see everything it says; click a value to read the exact quotes behind it.
 * Plain SVG, no graph library: a radial layout is enough for one monument's record.
 */

const FIELD_ORDER = ["built_date", "builder", "dynasty", "architectural_style", "material", "purpose", "heritage_status", "location"];
const R_FIELD = 118;
const R_VALUE = 228;
const R_SOURCE = 475;
const LABEL_W = 215; // room for the longest label beside an outer node

type ValueNode = {
  key: string;
  field: string;
  label: string;
  claims: Claim[];
  sourceIds: number[];
  verified: boolean;
  disputed: boolean;
  x: number;
  y: number;
  angle: number;
};
type SourceNode = { id: number; label: string; web: boolean; x: number; y: number; angle: number };

function shortSource(filename: string): string {
  if (filename.startsWith("wikipedia_en_")) return "Wikipedia (English)";
  if (filename.startsWith("wikipedia_hi_")) return "Wikipedia (Hindi)";
  if (filename.startsWith("wikidata_")) return "Wikidata";
  if (filename.startsWith("commons_")) return "Commons photo";
  const stem = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");
  return stem.length > 20 ? `${stem.slice(0, 19)}…` : stem;
}

function clip(text: string, n = 18): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

/** The monument's name on up to two short lines, to fit the centre circle. */
function centreLines(name: string): string[] {
  const words = name.replace(/,/g, "").split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= 12) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return lines.length > 2 ? [lines[0], clip(lines.slice(1).join(" "), 12)] : lines.map((l) => clip(l, 12));
}

const polar = (r: number, a: number) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });

function useLayout(entity: EntityDetail) {
  return useMemo(() => {
    const live = entity.claims.filter((c) => c.status !== "rejected" && c.field !== "inscription");
    const disputedFields = new Set(entity.conflicts.map((c) => c.field));
    const fields = [...new Set(live.map((c) => c.field))].sort(
      (a, b) => (FIELD_ORDER.indexOf(a) + 1 || 99) - (FIELD_ORDER.indexOf(b) + 1 || 99),
    );
    const sector = (2 * Math.PI) / Math.max(fields.length, 1);

    const fieldNodes = fields.map((f, i) => {
      const angle = -Math.PI / 2 + i * sector;
      return { field: f, angle, ...polar(R_FIELD, angle) };
    });

    const values: ValueNode[] = [];
    fieldNodes.forEach((fn) => {
      const groups = new Map<string, Claim[]>();
      for (const c of live.filter((c) => c.field === fn.field)) {
        const k = (c.group ?? c.value).trim().toLowerCase(); // same fact in other spellings/scripts = one node
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
      const list = [...groups.entries()].slice(0, 6);
      const spread = Math.min(sector * 0.8, 0.22 * list.length);
      list.forEach(([k, claims], j) => {
        const angle = fn.angle + (list.length === 1 ? 0 : -spread / 2 + (spread * j) / (list.length - 1));
        values.push({
          key: `${fn.field}:${k}`,
          field: fn.field,
          label: claims[0].group ?? claims[0].value,
          claims,
          sourceIds: [...new Set(claims.map((c) => c.source.id))],
          verified: claims.some((c) => c.status === "verified"),
          disputed: disputedFields.has(fn.field) && list.length > 1,
          angle,
          ...polar(R_VALUE, angle),
        });
      });
    });

    // Sources sit on the outer ring near the values they support, to keep lines short.
    const bySource = new Map<number, number[]>();
    values.forEach((v) => v.sourceIds.forEach((s) => bySource.set(s, [...(bySource.get(s) ?? []), v.angle])));
    const meta = new Map<number, EntitySource>(entity.sources.map((s) => [s.id, s]));
    const claimFile = new Map<number, string>(entity.claims.map((c) => [c.source.id, c.source.filename]));
    const ordered = [...bySource.entries()]
      .map(([id, angles]) => {
        const sx = angles.reduce((a, t) => a + Math.cos(t), 0);
        const sy = angles.reduce((a, t) => a + Math.sin(t), 0);
        return { id, want: Math.atan2(sy, sx) };
      })
      .sort((a, b) => a.want - b.want);
    // Keep each source as close as possible to its facts, but never closer than `gap` to a neighbour.
    const gap = Math.min(0.42, (2 * Math.PI) / Math.max(ordered.length, 1));
    const placed = ordered.map((o) => o.want);
    for (let pass = 0; pass < 40; pass++) {
      let moved = false;
      for (let i = 0; i < placed.length; i++) {
        const j = (i + 1) % placed.length;
        if (placed.length < 2 || (j === 0 && placed.length < 3)) continue;
        let d = placed[j] - placed[i];
        if (j === 0) d += 2 * Math.PI;
        if (d < gap) {
          const push = (gap - d) / 2;
          placed[i] -= push;
          placed[j] += push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    const sources: SourceNode[] = ordered.map((o, i) => {
      const s = meta.get(o.id);
      const filename = s?.filename ?? claimFile.get(o.id) ?? `source ${o.id}`;
      const web = s ? s.origin === "web" || s.type === "web" : filename.startsWith("wiki") || filename.startsWith("commons_");
      const angle = placed[i];
      return { id: o.id, label: shortSource(filename), web, angle, ...polar(R_SOURCE, angle) };
    });

    // Crop the canvas to what is drawn (plus room for labels), so the graph fills its frame.
    const xs = [0, ...values.map((v) => v.x), ...sources.map((s) => s.x)];
    const ys = [0, ...values.map((v) => v.y), ...sources.map((s) => s.y)];
    const minX = Math.min(...xs) - LABEL_W;
    const minY = Math.min(...ys) - 40;
    const viewBox = `${minX} ${minY} ${Math.max(...xs) + LABEL_W - minX} ${Math.max(...ys) + 40 - minY}`;

    return { fieldNodes, values, sources, viewBox };
  }, [entity]);
}

export default function KnowledgeGraph({ entity }: { entity: EntityDetail }) {
  const { fieldNodes, values, sources, viewBox } = useLayout(entity);
  const [hoverSource, setHoverSource] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const pickedValue = values.find((v) => v.key === picked) ?? null;

  if (values.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line px-5 py-6 text-center text-[15px] text-dust">
        No facts recorded yet, so there is nothing to connect. Upload a field note or scan to start the graph.
      </p>
    );
  }

  const lit = (v: ValueNode) =>
    (hoverSource === null || v.sourceIds.includes(hoverSource)) && (picked === null || v.key === picked);
  const srcPos = new Map(sources.map((s) => [s.id, s]));
  const disputedPairs: [ValueNode, ValueNode][] = [];
  fieldNodes.forEach((f) => {
    const vs = values.filter((v) => v.field === f.field && v.disputed);
    for (let i = 0; i + 1 < vs.length; i++) disputedPairs.push([vs[i], vs[i + 1]]);
  });

  return (
    <figure>
      <div className="overflow-hidden rounded-md border border-line bg-paper">
        <svg
          viewBox={viewBox}
          className="mx-auto block h-auto w-full max-w-[760px] select-none"
          role="img"
          aria-label={`Evidence graph for ${entity.name}: ${values.length} facts from ${sources.length} sources`}
          onClick={() => setPicked(null)}
        >
          {/* source -> value */}
          {values.flatMap((v) =>
            v.sourceIds.map((sid) => {
              const s = srcPos.get(sid);
              if (!s) return null;
              const on = lit(v) && (hoverSource === null || hoverSource === sid);
              return (
                <line
                  key={`${v.key}-${sid}`}
                  x1={s.x} y1={s.y} x2={v.x} y2={v.y}
                  stroke={s.web ? "var(--color-dust)" : "var(--color-ochre)"}
                  strokeWidth={on ? 1.6 : 1}
                  opacity={on ? 0.75 : 0.12}
                />
              );
            }),
          )}
          {/* centre -> field -> value */}
          {fieldNodes.map((f) => (
            <line key={`c-${f.field}`} x1={0} y1={0} x2={f.x} y2={f.y} stroke="var(--color-line)" strokeWidth={2} />
          ))}
          {values.map((v) => {
            const f = fieldNodes.find((n) => n.field === v.field)!;
            return (
              <line key={`f-${v.key}`} x1={f.x} y1={f.y} x2={v.x} y2={v.y} stroke="var(--color-line)" strokeWidth={1.5} opacity={lit(v) ? 1 : 0.3} />
            );
          })}
          {/* disagreements */}
          {disputedPairs.map(([a, b]) => (
            <path
              key={`d-${a.key}-${b.key}`}
              d={`M ${a.x} ${a.y} Q ${((a.x + b.x) / 2) * 1.18} ${((a.y + b.y) / 2) * 1.18} ${b.x} ${b.y}`}
              fill="none"
              stroke="var(--color-rust)"
              strokeWidth={2.5}
              strokeDasharray="6 5"
            />
          ))}

          {/* centre */}
          <circle r={62} fill="var(--color-water)" />
          <text textAnchor="middle" fill="var(--color-paper)" fontSize={18} fontWeight={600}>
            {centreLines(entity.name).map((line, i, all) => (
              <tspan key={i} x={0} dy={i === 0 ? `${0.35 - (all.length - 1) * 0.6}em` : "1.2em"}>
                {line}
              </tspan>
            ))}
          </text>

          {fieldNodes.map((f) => (
            <g key={f.field}>
              <circle cx={f.x} cy={f.y} r={11} fill="var(--color-sand)" stroke="var(--color-dust)" strokeWidth={1.5} />
              <text x={f.x} y={f.y - 17} textAnchor="middle" fontSize={17} fill="var(--color-dust)" fontWeight={600}>
                {fieldLabel(f.field)}
              </text>
            </g>
          ))}

          {values.map((v) => {
            const right = Math.cos(v.angle) >= 0;
            return (
              <g
                key={v.key}
                className="cursor-pointer"
                opacity={lit(v) ? 1 : 0.25}
                onClick={(e) => {
                  e.stopPropagation();
                  setPicked(picked === v.key ? null : v.key);
                }}
              >
                <title>{`${fieldLabel(v.field)}: ${v.label} (${v.sourceIds.length} source${v.sourceIds.length === 1 ? "" : "s"})`}</title>
                <circle
                  cx={v.x}
                  cy={v.y}
                  r={9 + Math.min(v.sourceIds.length, 4) * 2.5}
                  fill={v.disputed ? "var(--color-rust-soft)" : "var(--color-water-soft)"}
                  stroke={v.disputed ? "var(--color-rust)" : "var(--color-water)"}
                  strokeWidth={picked === v.key ? 3.5 : 2}
                />
                {v.verified && (
                  <text x={v.x} y={v.y} textAnchor="middle" dy="0.35em" fontSize={14} fill="var(--color-water)" fontWeight={700}>
                    ✓
                  </text>
                )}
                <text
                  x={v.x + (right ? 24 : -24)}
                  y={v.y}
                  dy="0.35em"
                  textAnchor={right ? "start" : "end"}
                  fontSize={19}
                  fill={v.disputed ? "var(--color-rust)" : "var(--color-ink)"}
                >
                  {clip(v.label)}
                </text>
              </g>
            );
          })}

          {sources.map((s) => {
            const right = Math.cos(s.angle) >= 0;
            return (
              <g
                key={s.id}
                className="cursor-pointer"
                onMouseEnter={() => setHoverSource(s.id)}
                onMouseLeave={() => setHoverSource(null)}
                onFocus={() => setHoverSource(s.id)}
                onBlur={() => setHoverSource(null)}
                tabIndex={0}
                opacity={hoverSource === null || hoverSource === s.id ? 1 : 0.35}
              >
                <title>{s.label}</title>
                <rect
                  x={s.x - 9} y={s.y - 9} width={18} height={18} rx={3}
                  fill={s.web ? "var(--color-sand)" : "var(--color-ochre-soft)"}
                  stroke={s.web ? "var(--color-dust)" : "var(--color-ochre)"}
                  strokeWidth={2}
                />
                <text
                  x={s.x + (right ? 15 : -15)}
                  y={s.y}
                  dy="0.35em"
                  textAnchor={right ? "start" : "end"}
                  fontSize={16}
                  fill="var(--color-dust)"
                >
                  {s.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-dust">
        <Legend shape="circle" fill="var(--color-water-soft)" stroke="var(--color-water)" text="Fact (bigger = more sources)" />
        <Legend shape="circle" fill="var(--color-rust-soft)" stroke="var(--color-rust)" text="Sources disagree" />
        <Legend shape="square" fill="var(--color-ochre-soft)" stroke="var(--color-ochre)" text="Field record" />
        <Legend shape="square" fill="var(--color-sand)" stroke="var(--color-dust)" text="Published reference" />
        <span>✓ verified by a reviewer · hover a source, click a fact</span>
      </figcaption>

      {pickedValue && (
        <div className="mt-3 rounded-md border border-line bg-paper p-4" aria-live="polite">
          <p className="text-[13px] uppercase tracking-wide text-dust">{fieldLabel(pickedValue.field)}</p>
          <p className={`mt-1 font-serif text-lg ${pickedValue.disputed ? "text-rust" : "text-ink"}`}>{pickedValue.label}</p>
          <ul className="mt-2 space-y-2">
            {pickedValue.claims.map((c) => (
              <li key={c.id} className="text-[14px]">
                {c.evidence_text && <q className="font-serif text-ink/90">{clip(c.evidence_text, 220)}</q>}
                <span className="block text-[12px] text-dust">
                  {shortSource(c.source.filename)}
                  {c.status === "verified" ? " · verified" : " · not yet verified"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}

function Legend({ shape, fill, stroke, text }: { shape: "circle" | "square"; fill: string; stroke: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={12} height={12} aria-hidden="true">
        {shape === "circle" ? (
          <circle cx={6} cy={6} r={5} fill={fill} stroke={stroke} strokeWidth={1.5} />
        ) : (
          <rect x={1} y={1} width={10} height={10} rx={2} fill={fill} stroke={stroke} strokeWidth={1.5} />
        )}
      </svg>
      {text}
    </span>
  );
}
