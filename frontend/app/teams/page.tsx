"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Explainer from "@/components/Explainer";
import LivingTabs from "@/components/LivingTabs";
import { ErrorState, Skeleton } from "@/components/States";
import { listSources } from "@/lib/api";
import { groupTeams, monthYear as when, type TeamSummary } from "@/lib/teams";

// Fellowship and field teams: whose fieldwork is in the archive. Built from upload credits, so a
// fellowship's photos and notes stay visible and useful instead of ending as a report in a folder.

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; teams: TeamSummary[] };

export default function TeamsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    listSources()
      .then(({ sources }) => setState({ kind: "ready", teams: groupTeams(sources) }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = "Fellowship teams · KathaGraph";
  }, []);

  const cohorts = state.kind === "ready" ? state.teams.filter((t) => t.cohort) : [];
  const people = state.kind === "ready" ? state.teams.filter((t) => !t.cohort) : [];

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-5xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Living heritage</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Fellowship teams</h1>
      <p className="mt-2 max-w-3xl text-[17px] text-dust">
        Fieldwork usually ends as a report in a folder that nobody opens again. Here, every team&apos;s photos and notes stay
        part of the archive: see where they went, what they found, and which gaps they closed.
      </p>
      <LivingTabs current="/teams" />
      <Explainer
        what={
          <>
            A page for every fellowship, field team or student who has added their own fieldwork to the archive. It
            shows where they went (rebuilt from their photos), their photos, the facts the archive read from their notes
            and whether a person has checked them, and the gaps they closed: things no other source had, like the only
            interior photograph of a stepwell.
          </>
        }
        how={
          <>
            Open a team to see their work site by site, and what is still missing for the next team. To add your own
            team, fill in &ldquo;Your name&rdquo; and &ldquo;Programme or cohort&rdquo; on the{" "}
            <Link href="/upload" className="text-water underline underline-offset-2">
              upload page
            </Link>
            .
          </>
        }
      />

      {state.kind === "loading" && <Skeleton className="mt-8 h-64 w-full" />}
      {state.kind === "error" && (
        <div className="mt-8">
          <ErrorState title="Couldn't load the teams" message={state.message} onRetry={load} />
        </div>
      )}

      {state.kind === "ready" && (
        <>
          {state.teams.length === 0 && (
            <p className="mt-8 rounded-md border border-dashed border-line px-4 py-4 text-[15px] text-dust">
              No credited fieldwork yet. On the{" "}
              <Link href="/upload" className="text-water underline underline-offset-2">
                upload page
              </Link>
              , fill in &ldquo;Your name&rdquo; and &ldquo;Programme or cohort&rdquo; (e.g. Explorer Fellowship 2024): the team&apos;s
              page appears here.
            </p>
          )}

          {cohorts.length > 0 && (
            <section className="mt-8">
              <h2 className="text-[13px] uppercase tracking-wide text-dust">Programmes and cohorts</h2>
              <ul className="mt-2 grid gap-3 sm:grid-cols-2">
                {cohorts.map((t) => (
                  <TeamCard key={t.key} t={t} />
                ))}
              </ul>
            </section>
          )}

          {people.length > 0 && (
            <section className="mt-8">
              <h2 className="text-[13px] uppercase tracking-wide text-dust">Individual contributors</h2>
              <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {people.map((t) => (
                  <TeamCard key={t.key} t={t} />
                ))}
              </ul>
            </section>
          )}

          {state.teams.length > 0 && (
            <p className="mt-8 text-[14px] text-dust">
              Teams are grouped by the &ldquo;Programme or cohort&rdquo; typed when uploading. To add your fellowship, fill it in on
              the{" "}
              <Link href="/upload" className="text-water underline underline-offset-2">
                upload page
              </Link>{" "}
              and spell it the same way each time.
            </p>
          )}
        </>
      )}
    </main>
  );
}

function TeamCard({ t }: { t: TeamSummary }) {
  const span = t.first && t.last ? (when(t.first) === when(t.last) ? when(t.first) : `${when(t.first)} – ${when(t.last)}`) : "";
  return (
    <li>
      <Link
        href={`/teams/${t.key}`}
        className="block h-full rounded-md border border-line bg-paper px-4 py-3 transition hover:border-water hover:ring-2 hover:ring-water/20"
      >
        <span className="font-serif text-xl text-ink">{t.name}</span>
        <span className="mt-0.5 block text-[13.5px] text-dust">
          {t.photos} {t.photos === 1 ? "photo" : "photos"} · {t.documents} {t.documents === 1 ? "note or document" : "notes & documents"}{span && <> · {span}</>}
        </span>
        {t.members.length > 0 && (
          <span className="mt-1 block truncate text-[13.5px] text-ink">
            {t.members.slice(0, 4).join(", ")}
            {t.members.length > 4 && ` and ${t.members.length - 4} more`}
          </span>
        )}
        <span className="mt-2 block text-[13.5px] text-water">See their work →</span>
      </Link>
    </li>
  );
}
