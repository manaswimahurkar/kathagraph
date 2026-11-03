"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import GujaratMap2D, { type MapPoint, type MapRoute } from "@/components/GujaratMap2D";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { getEntity, getJourneys, getSourceText, listSources } from "@/lib/api";
import { mapLimited } from "@/lib/exportData";
import { contributionAt, groupTeams, monthYear, parseCredit, teamKey, type SiteContribution, type TeamSummary } from "@/lib/teams";
import { fieldLabelFor, tagLabel, type Journey } from "@/lib/types";

// One fellowship or field team's work: their route, their photos, the facts their notes gave the
// archive, and the gaps they closed. Built entirely from upload credits.

type State =
  | { kind: "loading"; step: string }
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "ready"; team: TeamSummary; sites: SiteContribution[]; routes: Journey[]; unlinked: number };

const STATUS_STYLE: Record<string, string> = {
  verified: "border-water/40 bg-water-soft/50 text-water",
  unverified: "border-line text-dust",
  rejected: "border-rust/40 text-rust line-through",
};

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<State>({ kind: "loading", step: "Finding the team's files…" });

  const load = useCallback(async () => {
    setState({ kind: "loading", step: "Finding the team's files…" });
    try {
      const [{ sources }, journeys] = await Promise.all([listSources(), getJourneys().catch(() => null)]);
      const team = groupTeams(sources).find((t) => t.key === slug);
      if (!team) return setState({ kind: "missing" });
      const ids = new Set(team.sources.map((s) => s.id));

      // which monuments their files are about
      setState({ kind: "loading", step: `Reading ${team.sources.length} files…` });
      const entityIds = new Set<number>();
      const texts = await mapLimited(team.sources.slice(0, 120), 4, (s) => getSourceText(s.id));
      texts.forEach((t) => t?.entities.filter((e) => e.type === "monument").forEach((e) => entityIds.add(e.id)));
      const routes = (journeys?.field ?? []).filter((j) => {
        const c = parseCredit(j.team);
        return c != null && teamKey(c.team) === slug;
      });
      routes.forEach((j) => j.stops.forEach((s) => s.id != null && entityIds.add(s.id)));

      setState({ kind: "loading", step: `Looking at ${entityIds.size} sites…` });
      const records = await mapLimited([...entityIds], 4, (id) => getEntity(id));
      const sites = records
        .filter((r) => r != null)
        .map((r) => contributionAt(r!, ids))
        .filter((c) => c.sourceIds.length > 0)
        .sort((a, b) => b.facts.length + b.sourceIds.length - (a.facts.length + a.sourceIds.length));
      const linked = new Set(sites.flatMap((s) => s.sourceIds));
      setState({ kind: "ready", team, sites, routes, unlinked: team.sources.filter((s) => !linked.has(s.id)).length });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Couldn't load this team." });
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (state.kind === "ready") document.title = `${state.team.name} · KathaGraph`;
  }, [state]);

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-5xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[14px]">
        <Link href="/teams" className="text-water underline-offset-2 hover:underline">
          ← All fellowship teams
        </Link>
      </p>
      {state.kind === "loading" && (
        <div className="mt-4" aria-live="polite">
          <p className="text-dust">{state.step}</p>
          <Skeleton className="mt-3 h-72 w-full" />
        </div>
      )}
      {state.kind === "error" && (
        <div className="mt-6">
          <ErrorState title="Couldn't load this team" message={state.message} onRetry={load} />
        </div>
      )}
      {state.kind === "missing" && (
        <div className="mt-6">
          <EmptyState title="No team by that name">
            The credit may be spelled differently. <Link href="/teams" className="text-water underline">See every team</Link>.
          </EmptyState>
        </div>
      )}
      {state.kind === "ready" && <TeamRecord {...state} />}
    </main>
  );
}

function TeamRecord({ team, sites, routes, unlinked }: { team: TeamSummary; sites: SiteContribution[]; routes: Journey[]; unlinked: number }) {
  const [copied, setCopied] = useState(false);
  const facts = sites.flatMap((s) => s.facts);
  const verified = facts.filter((f) => f.status === "verified").length;
  const only = sites.reduce((n, s) => n + s.onlySource.length, 0);
  const firsts = sites.reduce((n, s) => n + s.firstPhotos.length, 0);
  const questions = sites.reduce((n, s) => n + s.questions.length, 0);
  const span =
    team.first && team.last ? (monthYear(team.first) === monthYear(team.last) ? monthYear(team.first) : `${monthYear(team.first)} – ${monthYear(team.last)}`) : "";

  const mapRoutes: MapRoute[] = useMemo(() => routes.map((j) => ({ id: j.id, points: j.stops, tone: "rust", numbered: true })), [routes]);
  const points: MapPoint[] = sites
    .filter((s) => s.entity.lat != null && s.entity.lng != null)
    .map((s) => ({ id: s.entity.id, lat: s.entity.lat!, lng: s.entity.lng!, label: s.entity.name, tone: "ochre" }));

  const photos = team.sources.filter((s) => s.type === "photo" && s.file_url).slice(0, 12);
  const stillMissing = sites.filter((s) => s.entity.gaps.length > 0);

  return (
    <article className="mt-3">
      <p className="text-[13px] tracking-wide text-ochre">{team.cohort ? "Fellowship or field team" : "Contributor"}</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">{team.name}</h1>
      <p className="mt-2 text-[16px] text-dust">
        {team.members.length > 0 && <>With {team.members.join(", ")}. </>}
        {span && <>Fieldwork {span}.</>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[14px]">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(window.location.href).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="rounded-md border border-line px-3 py-1.5 text-ink hover:border-ink/40"
        >
          {copied ? "Link copied" : "Copy link to this page"}
        </button>
        <Link href="/upload" className="text-water underline-offset-2 hover:underline">
          Add more of this team&apos;s work
        </Link>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat n={sites.length} label="sites documented" />
        <Stat n={team.photos} label="photos" />
        <Stat n={facts.length} label={`facts (${verified} checked)`} />
        <Stat n={only + firsts} label="gaps closed" hint="Facts or kinds of photo no other source in the archive has" tone="ochre" />
      </dl>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-md border border-line bg-paper p-3">
            <GujaratMap2D routes={mapRoutes} points={points} label={`Sites documented by ${team.name}`} />
            <p className="mt-2 px-1 text-[13px] text-dust">
              {routes.length > 0
                ? `Route rebuilt from where and when their photos were taken (${routes.reduce((n, j) => n + j.stops.length, 0)} stops, about ${routes.reduce((n, j) => n + j.km, 0)} km).`
                : "Sites their files are about. A route appears when their photos carry location and time."}
            </p>
          </div>
          {photos.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {photos.map((p) => (
                <Link key={p.id} href={`/source/${p.id}`} className="block aspect-square overflow-hidden rounded bg-sand">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.file_url!} alt={p.description ?? p.filename} loading="lazy" className="h-full w-full object-cover" />
                </Link>
              ))}
            </div>
          )}
        </div>

        <section className="min-w-0">
          <h2 className="font-display text-2xl">What they added, site by site</h2>
          {questions > 0 && (
            <p className="mt-1 text-[14px] text-dust">
              Their notes also raised {questions} {questions === 1 ? "question" : "questions"} where sources disagree: useful leads for
              a reviewer.
            </p>
          )}
          {sites.length === 0 && (
            <p className="mt-2 text-[15px] text-dust">Their files aren&apos;t linked to a monument yet. They may still be processing.</p>
          )}
          <ul className="mt-3 space-y-3">
            {sites.map((s) => (
              <SiteCard key={s.entity.id} s={s} />
            ))}
          </ul>
          {unlinked > 0 && (
            <p className="mt-3 text-[13.5px] text-dust">
              {unlinked} more {unlinked === 1 ? "file isn't" : "files aren't"} linked to a monument yet.
            </p>
          )}
        </section>
      </div>

      {stillMissing.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">For the next team</h2>
          <p className="mt-1 text-[15px] text-dust">What these sites still lack, so the next cohort can pick up where this one stopped.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {stillMissing.slice(0, 8).map((s) => (
              <li key={s.entity.id} className="rounded-md border border-line bg-paper px-4 py-2.5 text-[14px]">
                <Link href={`/monument/${s.entity.id}`} className="font-medium text-ink hover:underline">
                  {s.entity.name}
                </Link>
                <span className="text-dust"> · {s.entity.gaps.map((g) => g.label).join(", ")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[14px]">
            <Link href="/next" className="text-water underline-offset-2 hover:underline">
              Plan the next field visit →
            </Link>
          </p>
        </section>
      )}

      <details className="mt-10 rounded-md border border-line bg-paper px-4 py-3">
        <summary className="cursor-pointer text-[15px] text-ink">All {team.sources.length} files from this team</summary>
        <ul className="mt-2 grid gap-1 text-[14px] sm:grid-cols-2">
          {team.sources.map((f) => (
            <li key={f.id} className="truncate">
              <Link href={`/source/${f.id}`} className="text-water underline-offset-2 hover:underline">
                {f.filename}
              </Link>
              <span className="text-dust"> · {f.type}</span>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function Stat({ n, label, hint, tone }: { n: number; label: string; hint?: string; tone?: "ochre" }) {
  return (
    <div title={hint} className="rounded-md border border-line bg-paper px-3 py-2.5">
      <dt className="sr-only">{label}</dt>
      <dd className={`font-display text-3xl leading-none ${tone === "ochre" ? "text-ochre" : "text-ink"}`}>{n}</dd>
      <dd className="mt-1 text-[13px] text-dust">{label}</dd>
    </div>
  );
}

function SiteCard({ s }: { s: SiteContribution }) {
  const label = (f: string) => fieldLabelFor(f, s.entity.nature);
  const chips: { text: string; tone: string }[] = [
    ...s.firstPhotos.map((t) => ({ text: `Only ${tagLabel(t)?.toLowerCase()} in the archive`, tone: "ochre" })),
    ...(s.onlySource.length ? [{ text: `Only source for ${s.onlySource.map((f) => label(f).toLowerCase()).join(", ")}`, tone: "ochre" }] : []),
    ...(s.confirms.length ? [{ text: `Confirms ${s.confirms.map((f) => label(f).toLowerCase()).join(", ")}`, tone: "water" }] : []),
    ...(s.questions.length ? [{ text: `Disagrees on ${s.questions.map((f) => label(f).toLowerCase()).join(", ")}`, tone: "rust" }] : []),
  ];
  const tone: Record<string, string> = {
    ochre: "border-ochre/40 bg-ochre-soft/50 text-ochre",
    water: "border-water/40 bg-water-soft/50 text-water",
    rust: "border-rust/40 text-rust",
  };

  return (
    <li className="rounded-md border border-line bg-paper px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Link href={`/monument/${s.entity.id}`} className="font-serif text-xl text-ink hover:underline">
          {s.entity.name}
        </Link>
        <span className="text-[13px] text-dust">
          {s.sourceIds.length} {s.sourceIds.length === 1 ? "file" : "files"} · {s.facts.length} {s.facts.length === 1 ? "fact" : "facts"}
        </span>
      </div>
      {chips.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li key={c.text} className={`rounded-full border px-2.5 py-0.5 text-[12.5px] ${tone[c.tone]}`}>
              {c.text}
            </li>
          ))}
        </ul>
      )}
      {s.facts.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {s.facts.slice(0, 5).map((f) => (
            <li key={f.id} className="text-[14px]">
              <span className="text-dust">{label(f.field)}:</span> <span className="text-ink">{f.value}</span>{" "}
              <span className={`ml-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[11.5px] ${STATUS_STYLE[f.status] ?? ""}`}>
                {f.status === "verified" ? "checked" : f.status === "rejected" ? "rejected" : "not checked yet"}
              </span>
              {f.evidence_text && <span className="block truncate text-[13px] italic text-dust">&ldquo;{f.evidence_text}&rdquo;</span>}
            </li>
          ))}
          {s.facts.length > 5 && (
            <li className="text-[13px]">
              <Link href={`/monument/${s.entity.id}#facts`} className="text-water hover:underline">
                {s.facts.length - 5} more facts →
              </Link>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
