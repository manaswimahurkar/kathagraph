"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@/components/States";
import { getSourceText } from "@/lib/api";
import type { SourceText } from "@/lib/types";

// One file, read in full. Hindi and Gujarati pages sit beside their English machine translation,
// so a researcher who cannot read the script can still use the document, and one who can can check it.

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: SourceText };

const LANG: Record<string, string> = { hi: "Hindi", gu: "Gujarati", en: "English", mixed: "Mixed languages" };
const TYPE: Record<string, string> = {
  photo: "Photo", pdf: "PDF", note: "Note", csv: "Table", web: "Web article", slides: "Slide deck", doc: "Word report",
};

export default function SourcePage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [view, setView] = useState<"both" | "original" | "english">("both");

  const load = useCallback(() => {
    setState({ kind: "loading" });
    getSourceText(Number(id))
      .then((data) => {
        setState({ kind: "ready", data });
        document.title = `${data.source.filename} · KathaGraph`;
      })
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, [id]);
  useEffect(load, [load]);

  if (state.kind === "loading")
    return (
      <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-5xl px-4 pb-16 pt-10">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-6 h-96 w-full" />
      </main>
    );
  if (state.kind === "error")
    return (
      <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-5xl px-4 pb-16 pt-10">
        <ErrorState title="Couldn't open this file" message={state.message} onRetry={load} />
      </main>
    );

  const { source: s, pages, entities, embedded_photos } = state.data;
  const translated = pages.some((p) => p.text_en);
  const link = s.source_url || s.file_url;

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-6xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">
        {TYPE[s.type] ?? s.type} · {s.origin === "web" ? "Published reference" : "Field record"}
      </p>
      <h1 className="mt-1 break-words font-display text-3xl leading-[1.1] sm:text-4xl">{s.filename}</h1>
      <p className="mt-2 text-[14px] text-dust">
        {[s.author && `by ${s.author}`, s.licence, `added ${new Date(s.created_at).toLocaleDateString("en-IN")}`]
          .filter(Boolean)
          .join(" · ")}
        {link && (
          <>
            {" · "}
            <a href={link} target="_blank" rel="noreferrer" className="text-water underline underline-offset-2">
              open the original file
            </a>
          </>
        )}
        {s.parent_source_id && (
          <>
            {" · "}
            <Link href={`/source/${s.parent_source_id}`} className="text-water underline underline-offset-2">
              the document it came from
            </Link>
          </>
        )}
      </p>
      {entities.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-2 text-[14px]">
          <span className="text-dust">About:</span>
          {entities.map((e) => (
            <Link key={e.id} href={`/monument/${e.id}`} className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-water hover:border-water">
              {e.name}
            </Link>
          ))}
        </p>
      )}

      {translated && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-md border border-water/30 bg-water-soft px-4 py-2.5 text-[14px]">
          <span>
            <strong className="text-water">Translated.</strong> This file is in Hindi or Gujarati. The English beside it is a
            machine translation: names and dates are kept as written, but check the original before you quote it.
          </span>
          <span role="group" aria-label="Show" className="ml-auto flex overflow-hidden rounded-md border border-line bg-paper">
            {(["both", "original", "english"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-3 py-1 capitalize ${view === v ? "bg-water text-paper" : "text-ink hover:bg-sand"}`}
              >
                {v === "both" ? "Side by side" : v}
              </button>
            ))}
          </span>
        </div>
      )}

      {pages.length === 0 ? (
        <p className="mt-8 rounded-md border border-dashed border-line px-5 py-8 text-center text-[15px] text-dust">
          No text was read from this file{s.status !== "done" ? ` (it is ${s.status})` : ""}.
          {s.type === "photo" && " Photos only get text read when they show writing."}
        </p>
      ) : (
        <ol className="mt-6 space-y-6">
          {pages.map((p, i) => {
            const both = view === "both" && p.text_en;
            return (
              <li key={i} className="rounded-md border border-line bg-paper">
                <p className="border-b border-line px-4 py-2 text-[12px] uppercase tracking-wide text-dust">
                  {p.page != null ? `${s.type === "slides" ? "Slide" : "Page"} ${p.page}` : "Text"} · {LANG[p.language] ?? p.language}
                </p>
                <div className={`grid ${both ? "md:grid-cols-2 md:divide-x" : ""} divide-line`}>
                  {(view !== "english" || !p.text_en) && (
                    <div className="px-4 py-3">
                      {both && <p className="mb-1 text-[12px] text-dust">Original</p>}
                      <p lang={p.language === "gu" ? "gu" : p.language === "hi" ? "hi" : undefined} className="whitespace-pre-wrap font-serif text-[16px] leading-relaxed text-ink">
                        {p.text}
                      </p>
                    </div>
                  )}
                  {p.text_en && view !== "original" && (
                    <div className="bg-water-soft/40 px-4 py-3">
                      <p className="mb-1 text-[12px] text-water">English · machine translation</p>
                      <p lang="en" className="whitespace-pre-wrap font-serif text-[16px] leading-relaxed text-ink">
                        {p.text_en}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {embedded_photos.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-2xl">Photos found inside</h2>
          <p className="mt-1 text-[14px] text-dust">Each was taken out of this file and filed as its own photo record.</p>
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {embedded_photos.map((p) => (
              <li key={p.id}>
                <Link href={`/source/${p.id}`}>
                  {p.file_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.file_url} alt={p.filename} loading="lazy" className="aspect-square w-full rounded object-cover" />
                  ) : (
                    <span className="block aspect-square rounded bg-sand" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
