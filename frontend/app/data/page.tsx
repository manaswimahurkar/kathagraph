"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getEntities, getEntity } from "@/lib/api";
import { DATA_NOTES, factRows, mapLimited, monumentRow, saveFile, SITE_URL, STATUS_MEANING, toCsv } from "@/lib/exportData";
import type { EntityDetail } from "@/lib/types";

// Open data: the whole archive as files a researcher, student or another archive can use.

type State =
  | { kind: "idle" }
  | { kind: "loading"; done: number; total: number }
  | { kind: "error"; message: string }
  | { kind: "ready"; records: EntityDetail[]; failed: number; at: string };

const COLUMNS: [string, string][] = [
  ["monument, field, value", "Which site, what is being stated (e.g. builder, date of construction) and the value"],
  ["quote", "The exact words in the source that the fact was read from"],
  ["status", "unverified, verified or rejected (see below)"],
  ["disputed", "yes when sources give different values for this field of this site"],
  ["source_file, source_page", "The file in the archive the fact comes from, and the page or slide"],
  ["source_origin", "field = uploaded by a contributor; web = imported from Wikipedia, Wikidata or Commons"],
  ["source_credit, source_licence, source_link", "Who to credit, under what licence, and where the original is"],
  ["record_url", "The monument's page on KathaGraph"],
];

export default function OpenDataPage() {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    document.title = "Open data · KathaGraph";
  }, []);

  async function prepare() {
    setState({ kind: "loading", done: 0, total: 0 });
    try {
      const { entities } = await getEntities();
      const list = entities.filter((e) => e.type === "monument");
      setState({ kind: "loading", done: 0, total: list.length });
      const got = await mapLimited(list, 4, (e) => getEntity(e.id), (done) =>
        setState({ kind: "loading", done, total: list.length }),
      );
      const records = got.filter((r): r is EntityDetail => r != null).sort((a, b) => a.id - b.id);
      setState({ kind: "ready", records, failed: got.length - records.length, at: new Date().toISOString().slice(0, 10) });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Couldn't reach the archive." });
    }
  }

  const ready = state.kind === "ready" ? state : null;
  const facts = ready ? ready.records.reduce((n, r) => n + r.claims.length, 0) : 0;

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-3xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Open data</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Download the archive</h1>
      <p className="mt-2 text-[17px] text-dust">
        For universities, researchers and digital archivists. Every fact keeps its exact quote, its source and whether a
        person has checked it, so the evidence travels with the data.
      </p>

      <section className="mt-6 rounded-md border border-line bg-paper p-5">
        {state.kind === "idle" && (
          <>
            <p className="text-[15px]">
              The download is put together from the live archive now, so it always matches what the site shows.
            </p>
            <button
              type="button"
              onClick={prepare}
              className="mt-3 rounded-md bg-water px-5 py-2.5 text-[15px] font-medium text-paper hover:opacity-90"
            >
              Prepare the download
            </button>
          </>
        )}

        {state.kind === "loading" && (
          <div aria-live="polite">
            <p className="text-[15px]">
              {state.total === 0 ? "Finding every monument…" : `Collecting records: ${state.done} of ${state.total}`}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand">
              <div
                className="h-full bg-water transition-[width]"
                style={{ width: `${state.total ? Math.round((state.done / state.total) * 100) : 5}%` }}
              />
            </div>
          </div>
        )}

        {state.kind === "error" && (
          <div>
            <p className="text-rust">Couldn&apos;t collect the archive: {state.message}</p>
            <button type="button" onClick={prepare} className="mt-2 text-water underline underline-offset-2">
              Try again
            </button>
          </div>
        )}

        {ready && (
          <>
            <p className="text-[15px]">
              Ready: <b className="font-medium">{ready.records.length}</b> monuments and <b className="font-medium">{facts}</b>{" "}
              facts, as of {ready.at}.
              {ready.failed > 0 && <span className="text-rust"> {ready.failed} records couldn&apos;t be loaded and are left out.</span>}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <DownloadButton
                title="All facts"
                note="CSV, one row per fact"
                primary
                onClick={() =>
                  saveFile(
                    `kathagraph-facts-${ready.at}.csv`,
                    toCsv(ready.records.flatMap((r) => factRows(r)) as unknown as Record<string, unknown>[]),
                    "csv",
                  )
                }
              />
              <DownloadButton
                title="All monuments"
                note="CSV, one row per site"
                onClick={() => saveFile(`kathagraph-monuments-${ready.at}.csv`, toCsv(ready.records.map(monumentRow)), "csv")}
              />
              <DownloadButton
                title="Everything"
                note="JSON, full records"
                onClick={() =>
                  saveFile(
                    `kathagraph-archive-${ready.at}.json`,
                    JSON.stringify(
                      {
                        exported_from: "KathaGraph, an evidence-aware heritage archive of Gujarat",
                        site: SITE_URL,
                        exported_at: new Date().toISOString(),
                        notes: DATA_NOTES,
                        monuments: ready.records,
                      },
                      null,
                      2,
                    ),
                    "json",
                  )
                }
              />
            </div>
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">What&apos;s in the facts file</h2>
        <dl className="mt-3 divide-y divide-line rounded-md border border-line bg-paper">
          {COLUMNS.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[14rem_1fr]">
              <dt className="font-mono text-[13px] text-ink">{k}</dt>
              <dd className="text-[14px] text-dust">{v}</dd>
            </div>
          ))}
        </dl>

        <h3 className="mt-6 font-medium text-ink">What the status means</h3>
        <ul className="mt-1.5 space-y-1 text-[15px]">
          {Object.entries(STATUS_MEANING).map(([k, v]) => (
            <li key={k}>
              <span className="font-mono text-[13px] text-ink">{k}</span> <span className="text-dust">· {v}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-6 font-medium text-ink">Reusing the data</h3>
        <p className="mt-1.5 text-[15px] text-dust">
          Each fact carries its own source&apos;s licence. Text imported from Wikipedia is CC BY-SA, so credit Wikipedia and
          share alike. Photos and notes from contributors are credited to them. Cite KathaGraph and the monument&apos;s
          record link alongside the original source. Single records can also be downloaded from the bottom of any{" "}
          <Link href="/" className="text-water underline-offset-2 hover:underline">
            monument&apos;s page
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

function DownloadButton({ title, note, onClick, primary }: { title: string; note: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-2.5 text-left ${primary ? "bg-water text-paper hover:opacity-90" : "border border-line text-ink hover:border-ink/40"}`}
    >
      <span className="block text-[15px] font-medium">↓ {title}</span>
      <span className={`block text-[12.5px] ${primary ? "opacity-85" : "text-dust"}`}>{note}</span>
    </button>
  );
}
