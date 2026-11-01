"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorState, Skeleton } from "@/components/States";
import { getEntities, getPriorities, upload } from "@/lib/api";
import type { EntitySummary, PriorityMonument } from "@/lib/types";

// "I'm here": field mode for a phone at a site. Finds the nearest monument by GPS, shows exactly what
// still needs documenting there, and sends photos and notes straight into the archive. Files are named
// after the monument, so the pipeline links them to it even when a phone strips the photo's GPS.

const NEAR_KM = 5;

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
const fmtKm = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(d < 10 ? 1 : 0)} km`);
const slug = (name: string) => name.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

type Where = { kind: "none" } | { kind: "locating" } | { kind: "denied"; message: string } | { kind: "at"; lat: number; lng: number; simulated?: string };

export default function FieldPage() {
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [todos, setTodos] = useState<Map<number, PriorityMonument>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [where, setWhere] = useState<Where>({ kind: "none" });
  const [chosen, setChosen] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([getEntities(), getPriorities()])
      .then(([e, p]) => {
        setEntities(e.entities.filter((x) => x.lat != null && x.lng != null));
        setTodos(new Map(p.monuments.map((m) => [m.id, m])));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = "I'm here · Field mode · KathaGraph";
  }, []);

  function locate() {
    if (!("geolocation" in navigator)) return setWhere({ kind: "denied", message: "This device can't share its location." });
    setWhere({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setWhere({ kind: "at", lat: p.coords.latitude, lng: p.coords.longitude });
        setChosen(null);
      },
      (err) => setWhere({ kind: "denied", message: err.code === 1 ? "Location permission was refused." : "Couldn't get a location fix." }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  const nearby = useMemo(() => {
    if (!entities || where.kind !== "at") return [];
    return entities
      .map((e) => ({ e, d: km(where.lat, where.lng, e.lat!, e.lng!) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
  }, [entities, where]);

  const here = chosen ?? (nearby[0] && nearby[0].d <= NEAR_KM ? nearby[0].e.id : null);
  const site = entities?.find((e) => e.id === here) ?? null;

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-xl px-4 pb-16 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Field mode</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">I&apos;m here</h1>
      <p className="mt-2 text-[17px] text-dust">
        At a site with your phone? Find the monument you&apos;re standing at, see what the archive still lacks, and add
        photos and notes on the spot.
      </p>

      {loadError && (
        <div className="mt-6">
          <ErrorState title="Couldn't load the monuments" message={loadError} onRetry={load} />
        </div>
      )}
      {!entities && !loadError && <Skeleton className="mt-6 h-14 w-full" />}

      {entities && (
        <>
          <button
            onClick={locate}
            disabled={where.kind === "locating"}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-water px-4 py-4 text-lg font-medium text-paper hover:opacity-90 disabled:opacity-60"
          >
            <span aria-hidden="true">◎</span>
            {where.kind === "locating" ? "Finding you…" : "Use my location"}
          </button>
          {where.kind === "denied" && <p className="mt-2 text-[14px] text-rust">{where.message} Pick the site below instead.</p>}

          <label className="mt-4 block text-[14px] text-dust">
            {where.kind === "at" ? "Or pick another site:" : "Not at a site? Try it as if you were at:"}
            <select
              value={here ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                const ent = entities.find((x) => x.id === id);
                if (!ent) return;
                setChosen(id);
                if (where.kind !== "at") setWhere({ kind: "at", lat: ent.lat!, lng: ent.lng!, simulated: ent.name });
              }}
              className="mt-1 block w-full rounded-md border border-line bg-paper px-3 py-2.5 text-[16px] text-ink"
            >
              <option value="" disabled>
                Choose a monument
              </option>
              {[...entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>

          {where.kind === "at" && !where.simulated && nearby.length > 0 && (
            <section className="mt-6">
              <h2 className="text-[13px] uppercase tracking-wide text-dust">Nearest monuments</h2>
              <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-paper">
                {nearby.map(({ e, d }) => (
                  <li key={e.id}>
                    <button
                      onClick={() => setChosen(e.id)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${here === e.id ? "bg-water-soft" : "hover:bg-sand"}`}
                    >
                      <span className="text-ink">{e.name}</span>
                      <span className="shrink-0 text-[14px] text-dust">{fmtKm(d)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {nearby[0].d > NEAR_KM && !chosen && (
                <p className="mt-2 text-[14px] text-dust">
                  No monument in the archive within {NEAR_KM} km. If you&apos;re at an unrecorded site, your photos still go
                  in: their GPS puts them on the map.
                </p>
              )}
            </section>
          )}

          {site && <SiteKit key={site.id} site={site} todo={todos.get(site.id)} where={where.kind === "at" ? where : null} />}
        </>
      )}
    </main>
  );
}

function SiteKit({ site, todo, where }: { site: EntitySummary; todo?: PriorityMonument; where: { lat: number; lng: number } | null }) {
  const storeKey = `kg-field-done-${site.id}`;
  const [ticked, setTicked] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storeKey) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const camera = useRef<HTMLInputElement>(null);

  function toggle(key: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storeKey, JSON.stringify([...next]));
      } catch {
        /* private mode: ticks just won't persist */
      }
      return next;
    });
  }

  async function send(files: File[], label: string) {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setPct(0);
    try {
      const res = await upload(files, setPct);
      const dup = res.sources.filter((s) => s.status === "duplicate").length;
      setSent((s) => [`${label}${dup ? ` (${dup} already in the archive)` : ""}`, ...s]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function sendPhotos(list: FileList | null) {
    if (!list) return;
    const base = `${slug(site.name)}_field_${stamp()}`;
    const files = [...list].map((f, i) => new File([f], `${base}_${i + 1}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`, { type: f.type }));
    send(files, `${files.length} photo${files.length === 1 ? "" : "s"}`);
  }

  function sendNote() {
    const text = note.trim();
    if (!text) return;
    const header = [
      `Field note: ${site.name}`,
      `Date: ${new Date().toISOString().slice(0, 10)}`,
      where ? `Location: ${where.lat.toFixed(5)}, ${where.lng.toFixed(5)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const file = new File([`${header}\n\n${text}\n`], `${slug(site.name)}_fieldnote_${stamp()}.txt`, { type: "text/plain" });
    send([file], "Field note").then(() => setNote(""));
  }

  const items = todo?.todo ?? [];
  const left = items.filter((t, i) => !ticked.has(`${t.item}-${i}`)).length;

  return (
    <section className="mt-6 rounded-md border border-water/40 bg-paper p-5" aria-live="polite">
      <p className="text-[13px] uppercase tracking-wide text-water">You&apos;re at</p>
      <h2 className="mt-0.5 font-display text-3xl leading-tight">{site.name}</h2>
      <p className="mt-1 text-[14px] text-dust">
        {site.completeness != null && <>Documentation {site.completeness}% complete · </>}
        <Link href={`/monument/${site.id}`} className="text-water underline underline-offset-2">
          Open its record
        </Link>
      </p>

      <h3 className="mt-5 font-medium text-ink">
        To do here {items.length > 0 && <span className="text-dust">({left} of {items.length} left)</span>}
      </h3>
      {items.length === 0 ? (
        <p className="mt-1 text-[15px] text-dust">Nothing missing on record. Extra angles and details are still welcome.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((t, i) => {
            const key = `${t.item}-${i}`;
            const on = ticked.has(key);
            return (
              <li key={key}>
                <label className="flex cursor-pointer items-start gap-3 rounded px-1 py-1 hover:bg-sand">
                  <input type="checkbox" checked={on} onChange={() => toggle(key)} className="mt-1 size-4 accent-[var(--color-water)]" />
                  <span className={`text-[15px] ${on ? "text-dust line-through" : t.kind === "verify" ? "text-rust" : "text-ink"}`}>
                    {t.kind === "verify" ? "Check on site: " : ""}
                    {t.text.replace(/^Check the /, "")}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5 grid gap-2">
        <button
          onClick={() => camera.current?.click()}
          disabled={busy}
          className="rounded-md bg-water px-4 py-3 font-medium text-paper hover:opacity-90 disabled:opacity-60"
        >
          Take or add photos
        </button>
        <input ref={camera} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => sendPhotos(e.target.files)} />
        <label className="mt-2 block text-[14px] text-dust" htmlFor="field-note">
          Quick field note (what you see, inscriptions, what locals say)
        </label>
        <textarea
          id="field-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="rounded-md border border-line bg-sand/40 px-3 py-2 text-[16px] text-ink"
          placeholder="e.g. Inscription on the first-floor wall is partly eroded; caretaker says…"
        />
        <button onClick={sendNote} disabled={busy || !note.trim()} className="rounded-md border border-water px-4 py-2.5 font-medium text-water hover:bg-water-soft disabled:opacity-50">
          Save note to the archive
        </button>
      </div>

      {busy && <p className="mt-3 text-[14px] text-dust">Uploading… {pct}%</p>}
      {error && <p className="mt-3 text-[14px] text-rust">{error}</p>}
      {sent.length > 0 && (
        <ul className="mt-3 space-y-1 text-[14px] text-water">
          {sent.map((s, i) => (
            <li key={i}>✓ {s} added. It will be processed and linked to {site.name}.</li>
          ))}
        </ul>
      )}
    </section>
  );
}
