import type { EntitySummary } from "@/lib/types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Sources / disagreements / gaps for one monument, used on the map and in the list. */
export function CountChips({ entity }: { entity: Pick<EntitySummary, "n_sources" | "n_conflicts" | "n_gaps"> }) {
  const { n_sources, n_conflicts, n_gaps } = entity;
  return (
    <ul className="flex flex-wrap gap-1.5 text-[13px] leading-none">
      <li className="rounded-full bg-ink/8 px-2.5 py-1.5 text-ink">{plural(n_sources, "source", "sources")}</li>
      <li
        className={`rounded-full px-2.5 py-1.5 ${
          n_conflicts > 0 ? "bg-ochre-soft font-medium text-ochre" : "bg-ink/5 text-dust"
        }`}
      >
        {n_conflicts > 0 ? plural(n_conflicts, "disagreement", "disagreements") : "No disagreements"}
      </li>
      <li
        className={`rounded-full border border-dashed px-2.5 py-[5px] ${
          n_gaps > 0 ? "border-dust text-ink" : "border-transparent bg-water-soft text-water"
        }`}
      >
        {n_gaps > 0 ? plural(n_gaps, "gap", "gaps") : "Fully documented"}
      </li>
    </ul>
  );
}
