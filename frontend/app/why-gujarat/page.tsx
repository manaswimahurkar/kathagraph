"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import GujaratMap2D, { type MapPoint } from "@/components/GujaratMap2D";
import { getEntities } from "@/lib/api";
import type { EntitySummary } from "@/lib/types";

// Why the archive starts with one state, and why that state is Gujarat: the reasoning, the team's
// own connection to it, and what changes (and what doesn't) when it grows to the rest of India.

// The team's own words. Kept here, not invented: an empty list hides the section.
const OUR_STORY: string[] = [
  "We chose Gujarat as a nod to IIT Gandhinagar, the institute that set this challenge and gave us the opportunity to build KathaGraph. It is their state, their Explorer Fellows’ field and their question, so if this archive is useful anywhere first, it should be useful there.",
  "Working on it, we learned about stepwells, scripts and crafts we had only read about. That is what we want KathaGraph to do for everyone who opens it.",
];

const REASONS: { title: string; text: string }[] = [
  {
    title: "Where the question was asked",
    text:
      "This challenge comes from IIT Gandhinagar, whose Explorer Fellows travel across India and come home to Gujarat with their photos, decks and notes. An archive for them should first make sense of the heritage on their doorstep, where its records can be checked and revisited in person.",
  },
  {
    title: "Five thousand years in one state",
    text:
      "From the Harappan cities of Dholavira and Lothal to the Solanki stepwells, the sultanate mosques of Ahmedabad and Champaner and the temples of Somnath and Palitana, Gujarat holds an unbroken record of how people built, prayed and found water. Four of its sites are UNESCO World Heritage Sites.",
  },
  {
    title: "Two scripts, one archive",
    text:
      "Records here come in Gujarati, Hindi and English, often side by side on one plaque. That makes Gujarat the honest test for an archive that must read, translate and search across languages, not just in English.",
  },
  {
    title: "Living heritage, not only stone",
    text:
      "Patola and Bandhani, Ajrak and Rogan, the embroidery of Kutch: crafts and stories here are as much heritage as the monuments, and as much at risk of being lost in a folder.",
  },
  {
    title: "Deep before wide",
    text:
      "A few thousand thin map pins would look impressive and help no one. One state done deeply shows the whole idea working: every fact quoted, every disagreement visible, every gap turned into the next field visit.",
  },
];

const SCALE: { title: string; text: string }[] = [
  { title: "Stays the same", text: "Uploads, OCR, translation, fact extraction with quotes, disagreement and gap detection, search, Ask, review. None of it knows it is in Gujarat." },
  { title: "Changes", text: "The 3D map's outline and terrain, the list of places used to pin crafts and stories, and the reference articles imported for each new region." },
  { title: "Next", text: "Rajasthan's stepwells and Maharashtra's caves are the natural neighbours: the same kinds of sites, new scripts (Marathi), the same pipeline." },
];

const UNESCO = [
  { name: "Champaner-Pavagadh", year: 2004 },
  { name: "Rani ki Vav, Patan", year: 2014 },
  { name: "Historic City of Ahmedabad", year: 2017 },
  { name: "Dholavira", year: 2021 },
];

export default function WhyGujaratPage() {
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  useEffect(() => {
    document.title = "Why Gujarat · KathaGraph";
    getEntities().then((r) => setEntities(r.entities)).catch(() => setEntities([]));
  }, []);

  const points: MapPoint[] = useMemo(
    () =>
      entities
        .filter((e) => e.lat != null && e.lng != null)
        .map((e) => ({ id: e.id, lat: e.lat as number, lng: e.lng as number, label: e.name, tone: "ochre" as const, size: 0.5 })),
    [entities],
  );

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-5xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">About this archive</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-6xl">Why Gujarat</h1>
      <p className="mt-3 max-w-3xl font-serif text-[20px] leading-relaxed text-ink">
        KathaGraph begins with one state on purpose. Gujarat is where this challenge was set, where five thousand years of
        building sit within a day&apos;s drive, and where records arrive in three languages at once. It is the right place to
        prove that a heritage archive can be both alive and trustworthy, before it grows to the rest of India.
      </p>

      {OUR_STORY.length > 0 && (
        <section className="mt-10 rounded-md border-l-4 border-ochre bg-sand/50 px-5 py-5 sm:px-7">
          <h2 className="font-display text-2xl">Why it matters to us</h2>
          {OUR_STORY.map((para, i) => (
            <p key={i} className="mt-3 font-serif text-[18px] leading-relaxed text-ink">
              {para}
            </p>
          ))}
          <p className="mt-3 text-[14px] text-dust">Manaswi Mahurkar and Sameehan Divekar</p>
        </section>
      )}

      <section className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <div className="rounded-md border border-line bg-paper p-3">
            <GujaratMap2D points={points} label={`Map of Gujarat with the ${points.length} sites in the archive`} />
            <p className="mt-2 px-1 text-[13px] text-dust">
              {points.length > 0 ? `${points.length} sites in the archive today, across the state.` : "Loading the sites…"}
            </p>
          </div>
          <div className="mt-4 rounded-md border border-line bg-paper p-4">
            <p className="text-[12px] uppercase tracking-wide text-dust">UNESCO World Heritage in Gujarat</p>
            <ul className="mt-2 space-y-1.5">
              {UNESCO.map((u) => (
                <li key={u.name} className="flex items-baseline justify-between gap-3 text-[15px]">
                  <span className="text-ink">{u.name}</span>
                  <span className="tabular-nums text-dust">{u.year}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <ol className="space-y-5">
          {REASONS.map((r, i) => (
            <li key={r.title} className="flex gap-4">
              <span aria-hidden="true" className="kg-tablet grid size-10 shrink-0 place-items-center rounded font-display text-lg">
                {i + 1}
              </span>
              <div>
                <h3 className="font-display text-xl text-ink">{r.title}</h3>
                <p className="mt-1 text-[16px] leading-relaxed text-dust">{r.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <div className="kg-frieze mb-6" aria-hidden="true" />
        <h2 className="font-display text-3xl">From Gujarat to India</h2>
        <p className="mt-2 max-w-3xl text-[17px] text-dust">
          Gujarat is the pilot, not the limit. The system underneath was built for any region; growing it is mostly a
          matter of data, not new code.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {SCALE.map((s) => (
            <div key={s.title} className="rounded-md border border-line bg-paper p-4">
              <h3 className="font-display text-lg text-ochre">{s.title}</h3>
              <p className="mt-1 text-[15px] leading-relaxed text-ink">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
        <Link href="/" className="font-medium text-water underline underline-offset-2">
          Explore the map →
        </Link>
        <Link href="/stories" className="font-medium text-water underline underline-offset-2">
          Stories &amp; crafts →
        </Link>
        <Link href="/upload" className="font-medium text-water underline underline-offset-2">
          Add your own field records →
        </Link>
      </p>
    </main>
  );
}
