"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ErrorState } from "@/components/States";
import { readInscription, upload } from "@/lib/api";
import type { InscriptionReading } from "@/lib/types";

// Inscription reader: an AI reading of an inscription photo (transcription, translation, names, dates).
// Dates in Vikram Samvat, Shaka or Hijri are converted to the Common Era by fixed rules on the server,
// never by the model. Nothing is stored unless the user chooses to add the photo to the archive.

const CALENDAR: Record<string, string> = {
  vikram_samvat: "Vikram Samvat",
  shaka: "Shaka era",
  hijri: "Hijri (AH)",
  common_era: "Common Era",
  unknown: "calendar unclear",
};
const LEGIBILITY: Record<string, [string, string]> = {
  good: ["Clearly legible", "bg-water-soft text-water"],
  partial: ["Partly legible", "bg-ochre-soft text-ochre"],
  poor: ["Hard to read", "bg-rust-soft text-rust"],
};
const yr = (y: number) => (y < 0 ? `${-y} BCE` : `${y} CE`);

type State =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; reading: InscriptionReading };

export default function InscriptionPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "Inscription reader · KathaGraph";
  }, []);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function choose(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setSaved(null);
    setState({ kind: "idle" });
  }

  function read() {
    if (!file) return;
    setState({ kind: "reading" });
    readInscription(file)
      .then((reading) => setState({ kind: "ready", reading }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    try {
      const res = await upload([file]);
      const s = res.sources[0];
      setSaved(s?.status === "duplicate" ? "This photo is already in the archive." : "Added to the archive. It will be read, searched and linked to its monument in a minute or two.");
    } catch (e) {
      setSaved(`Couldn't add it: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-4xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Inscriptions</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Read an inscription</h1>
      <p className="mt-2 max-w-2xl text-[17px] text-dust">
        Photograph an inscription and get a first reading: the text in its own script, a transliteration, an English
        translation, the people and places it names, and its dates converted to the Common Era. It is a starting point
        for an expert, not a final reading.
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(e.dataTransfer.files[0]);
            }}
            className="grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-md border-2 border-dashed border-line bg-paper text-center hover:border-water"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen photo
              <img src={preview} alt="The inscription photo you chose" className="h-full w-full object-contain" />
            ) : (
              <span className="px-6 text-[15px] text-dust">
                <span className="block font-serif text-lg text-ink">Choose or drop a photo</span>
                On a phone, this opens the camera. Shoot straight on, in even light.
              </span>
            )}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <button
            onClick={read}
            disabled={!file || state.kind === "reading"}
            className="mt-3 w-full rounded-md bg-water px-4 py-3 font-medium text-paper hover:opacity-90 disabled:opacity-50"
          >
            {state.kind === "reading" ? "Reading the inscription…" : "Read inscription"}
          </button>
          {state.kind === "reading" && (
            <p className="mt-2 text-[13px] text-dust" role="status">
              Reading the script, translating and checking dates. This takes 10–30 seconds.
            </p>
          )}
        </div>

        <div>
          {state.kind === "idle" && (
            <div className="rounded-md border border-line bg-paper p-5 text-[15px] text-dust">
              <p className="font-medium text-ink">What you get</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Transcription in Devanagari, Gujarati, Nagari, Persian or other scripts</li>
                <li>Transliteration and an English translation</li>
                <li>Dates in Vikram Samvat, Shaka or Hijri converted to the Common Era by fixed rules</li>
                <li>Every uncertain word flagged, never silently guessed</li>
              </ul>
            </div>
          )}
          {state.kind === "error" && <ErrorState title="Couldn't read it" message={state.message} onRetry={read} />}
          {state.kind === "ready" && <Reading r={state.reading} />}
          {state.kind === "ready" && state.reading.is_inscription && (
            <div className="mt-4 rounded-md border border-line bg-paper p-4">
              <p className="text-[15px] text-ink">Keep this inscription in the archive?</p>
              <p className="mt-1 text-[13px] text-dust">
                The photo is stored with its GPS, read by OCR, searchable, and linked to its monument. The AI reading
                above is not stored as fact.
              </p>
              <button
                onClick={save}
                disabled={saving || !!saved}
                className="mt-3 rounded-md border border-water px-4 py-2 text-[15px] font-medium text-water hover:bg-water-soft disabled:opacity-60"
              >
                {saving ? "Adding…" : "Add photo to the archive"}
              </button>
              {saved && <p className="mt-2 text-[14px] text-ink">{saved}</p>}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Reading({ r }: { r: InscriptionReading }) {
  if (!r.is_inscription) {
    return (
      <div className="rounded-md border border-dashed border-line px-5 py-8 text-center">
        <p className="font-serif text-lg text-ink">No inscription found</p>
        <p className="mt-1 text-[15px] text-dust">Try a closer, straight-on photo of the carved or painted text.</p>
      </div>
    );
  }
  const [legLabel, legCls] = LEGIBILITY[r.legibility] ?? LEGIBILITY.partial;
  return (
    <article className="space-y-4" aria-live="polite">
      <p className="rounded border border-ochre/40 bg-ochre-soft px-3 py-2 text-[14px] text-ink">{r.notice}</p>
      <div className="flex flex-wrap gap-2 text-[13px]">
        <span className="rounded-full bg-sand px-2.5 py-0.5 text-ink">Script: {r.script}</span>
        <span className="rounded-full bg-sand px-2.5 py-0.5 text-ink">Language: {r.language}</span>
        <span className={`rounded-full px-2.5 py-0.5 font-medium ${legCls}`}>{legLabel}</span>
      </div>

      <Block title="Transcription">
        <p className="whitespace-pre-wrap font-serif text-[19px] leading-relaxed text-ink">{r.transcription}</p>
      </Block>
      {r.transliteration && (
        <Block title="Transliteration">
          <p className="whitespace-pre-wrap font-serif italic text-ink/90">{r.transliteration}</p>
        </Block>
      )}
      <Block title="English translation">
        <p className="whitespace-pre-wrap font-serif text-[17px] leading-relaxed text-ink">{r.translation_en}</p>
      </Block>

      {r.dates.length > 0 && (
        <Block title="Dates">
          <ul className="space-y-2">
            {r.dates.map((d, i) => (
              <li key={i} className="text-[15px]">
                <span className="font-medium text-ink">{d.as_written}</span>
                <span className="text-dust"> · {CALENDAR[d.calendar] ?? d.calendar}</span>
                {d.common_era && (
                  <span className="ml-1 rounded bg-water-soft px-1.5 py-0.5 text-water">
                    = {d.common_era[0] === d.common_era[1] ? yr(d.common_era[0]) : `${yr(d.common_era[0])}–${d.common_era[1]}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-dust">Converted by fixed calendar rules, not by the AI.</p>
        </Block>
      )}

      {r.names.length > 0 && (
        <Block title="Names mentioned">
          <ul className="flex flex-wrap gap-2">
            {r.names.map((n) => (
              <li key={n}>
                <Link href={`/search?q=${encodeURIComponent(n)}`} className="inline-block rounded-full border border-line bg-paper px-3 py-1 text-[14px] hover:border-ink/40">
                  {n}
                </Link>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {r.uncertain.length > 0 && (
        <Block title="Uncertain readings">
          <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink">
            {r.uncertain.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Block>
      )}
    </article>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-paper p-4">
      <h2 className="text-[12px] uppercase tracking-wide text-dust">{title}</h2>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
