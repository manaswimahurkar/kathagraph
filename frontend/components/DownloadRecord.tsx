"use client";

import Link from "next/link";
import { factRows, recordJson, saveFile, slugify, toCsv } from "@/lib/exportData";
import type { EntityDetail } from "@/lib/types";

/** "Use this record": download one monument's facts as CSV or its full record as JSON. */
export default function DownloadRecord({ entity }: { entity: EntityDetail }) {
  const base = `kathagraph-${String(entity.id).padStart(3, "0")}-${slugify(entity.name)}`;
  const verified = entity.claims.filter((c) => c.status === "verified").length;

  return (
    <div className="rounded-md border border-line bg-paper p-4">
      <p className="text-[15px] text-ink">
        Download this record to cite it, analyse it or keep it in another archive. Every fact comes with its exact quote,
        its source (credit, licence and link) and whether a person has checked it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => saveFile(`${base}-facts.csv`, toCsv(factRows(entity) as unknown as Record<string, unknown>[]), "csv")}
          className="rounded-md bg-water px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90"
        >
          Facts as CSV <span className="font-normal opacity-80">(Excel, Sheets)</span>
        </button>
        <button
          type="button"
          onClick={() => saveFile(`${base}.json`, JSON.stringify(recordJson(entity), null, 2), "json")}
          className="rounded-md border border-line px-4 py-2 text-[14px] text-ink hover:border-ink/40"
        >
          Full record as JSON
        </button>
      </div>
      <p className="mt-2 text-[13px] text-dust">
        {entity.claims.length} facts ({verified} checked by a person), {entity.conflicts.length} disagreements,{" "}
        {entity.sources.length} sources. Reuse each fact under its source&apos;s licence.{" "}
        <Link href="/data" className="text-water underline-offset-2 hover:underline">
          Download the whole archive
        </Link>
      </p>
    </div>
  );
}
