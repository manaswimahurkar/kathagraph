"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/States";
import { adminFetch, adminToken, setAdminToken, type AdminStatus } from "@/lib/admin";

// The archive keeper's console: health at a glance, one-click maintenance jobs, failed files,
// imports, fixes to a single record, and the contributors who have joined. Locked by the admin
// token; without it the page shows nothing and every call is refused by the server.

type Note = { tone: "ok" | "err"; text: string } | null;

export default function AdminPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [note, setNote] = useState<Note>(null);

  const load = useCallback(async (token?: string) => {
    const s = await adminFetch<AdminStatus>("/admin/status", {}, token ?? adminToken());
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    document.title = "Admin · KathaGraph";
    if (!adminToken()) {
      setChecking(false);
      return;
    }
    load()
      .then(() => setUnlocked(true))
      .catch(() => setAdminToken(null))
      .finally(() => setChecking(false));
  }, [load]);

  async function run(label: string, path: string, init: RequestInit = { method: "POST" }) {
    setNote(null);
    try {
      await adminFetch(path, init);
      setNote({ tone: "ok", text: `${label}: started. It runs in the background; refresh in a minute to see the effect.` });
      setTimeout(() => load().catch(() => undefined), 4000);
    } catch (e) {
      setNote({ tone: "err", text: `${label}: ${(e as Error).message}` });
    }
  }

  if (checking) {
    return (
      <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-5xl px-4 pb-16 pt-10">
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }
  if (!unlocked) return <Lock onUnlock={async (t) => { await load(t); setAdminToken(t); setUnlocked(true); }} />;

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-6xl px-4 pb-16 pt-6 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] tracking-wide text-ochre">Archive keeper</p>
          <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">Admin</h1>
        </div>
        <div className="flex gap-2 text-[14px]">
          <button onClick={() => load().catch((e) => setNote({ tone: "err", text: (e as Error).message }))} className="rounded-md border border-line px-3 py-1.5 text-ink hover:bg-sand">
            Refresh
          </button>
          <button
            onClick={() => {
              setAdminToken(null);
              setUnlocked(false);
              setStatus(null);
            }}
            className="rounded-md border border-line px-3 py-1.5 text-dust hover:bg-sand hover:text-ink"
          >
            Lock
          </button>
        </div>
      </div>

      {note && (
        <p role="status" className={`mt-4 rounded border px-4 py-2 text-[15px] ${note.tone === "ok" ? "border-water/30 bg-water-soft text-water" : "border-rust/30 bg-rust-soft text-rust"}`}>
          {note.text}
        </p>
      )}

      {status && <Overview s={status} />}

      <Panel title="Maintenance jobs" intro="Each job reads files already in the archive. It skips anything it has already done, so running one twice is safe.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Job title="Translate documents" text="English translations for Hindi and Gujarati files that have none yet." onRun={() => run("Translate", "/admin/translate")} />
          <Job title="Find stories and crafts" text="Read texts not yet searched for legends and craft details." onRun={() => run("Stories", "/admin/extract-stories")} />
          <Job title="Re-read craft articles" text="Read the articles imported for crafts again, for technique, makers and places." onRun={() => run("Craft articles", "/admin/extract-stories?recheck_crafts=true")} />
          <Job title="Sort sites from Wikidata" text="Mark each monument built, natural or settlement (sites set by hand are left alone)." onRun={() => run("Sort sites", "/admin/classify-nature")} />
        </div>
      </Panel>

      {status && (
        <Panel title={`Files that need attention (${status.failed.length + status.waiting.length})`} intro="Failed files can be read again; files waiting are queued and will be read in turn.">
          {status.failed.length + status.waiting.length === 0 ? (
            <p className="text-[15px] text-dust">Every file has been read. Nothing to do.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line bg-paper">
              {status.failed.map((f) => (
                <FileRow key={f.id} f={f} onRetry={() => run(`Retry ${f.filename}`, `/sources/${f.id}/reprocess`)} onDelete={() => run(`Delete ${f.filename}`, `/sources/${f.id}`, { method: "DELETE" })} />
              ))}
              {status.waiting.map((f) => (
                <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-[15px]">
                  <span className="break-all">{f.filename}</span>
                  <span className="text-[13px] text-dust">{f.status === "processing" ? "being read now" : "waiting its turn"}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ImportPanel onRun={run} />
        <FixPanel onRun={run} />
      </div>

      {status && (
        <Panel title={`Contributors (${status.users.length})`} intro="People who have joined. Emails are private: shown only here and to the person themselves.">
          {status.users.length === 0 ? (
            <p className="text-[15px] text-dust">No one has joined yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line bg-paper">
              <table className="w-full min-w-[640px] text-left text-[14px]">
                <thead className="bg-sand/60 text-[12px] uppercase tracking-wide text-dust">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">What brought them here</th>
                    <th className="px-3 py-2">Joined</th>
                    <th className="px-3 py-2 text-right">Files</th>
                    <th className="px-3 py-2 text-right">Reviews</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {status.users.map((u) => (
                    <tr key={u.id}>
                      <td className="px-3 py-2 text-ink">{u.name}</td>
                      <td className="px-3 py-2 text-dust">{u.email}</td>
                      <td className="px-3 py-2 text-dust">{u.reason ?? "–"}</td>
                      <td className="px-3 py-2 text-dust">{new Date(u.created_at).toLocaleDateString("en-IN")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.uploads}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.reviews}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {status && (
        <Panel title="Latest files" intro="The fifteen most recent files in the archive.">
          <ul className="divide-y divide-line rounded-md border border-line bg-paper">
            {status.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-[14px]">
                <Link href={`/source/${r.id}`} className="min-w-0 break-all text-water hover:underline">
                  {r.filename}
                </Link>
                <span className="text-[13px] text-dust">
                  {r.origin === "web" ? "published reference" : "field record"}
                  {r.author && ` · ${r.author}`} · {r.status}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </main>
  );
}

function Lock({ onUnlock }: { onUnlock: (token: string) => Promise<void> }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-md px-4 pb-14 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Archive keeper</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05]">Admin</h1>
      <p className="mt-2 text-[15px] text-dust">
        This page runs maintenance jobs on the whole archive, so it is locked. Enter the admin token set on the server.
      </p>
      <form
        className="mt-5 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onUnlock(token.trim());
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-[14px] font-medium text-ink">
          Admin token
          <input
            type="password"
            required
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-water"
          />
        </label>
        {error && <p role="alert" className="rounded border border-rust/30 bg-rust-soft px-3 py-2 text-[15px] text-rust">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-water px-4 py-2.5 font-medium text-paper hover:opacity-90 disabled:opacity-50">
          {busy ? "Checking…" : "Unlock"}
        </button>
        <p className="text-[13px] text-dust">The token is remembered only until you close this tab.</p>
      </form>
    </main>
  );
}

function Overview({ s }: { s: AdminStatus }) {
  const n = (o: Record<string, number>, k: string) => o[k] ?? 0;
  const tiles: [string, number, string][] = [
    ["Files read", n(s.files, "done"), `${n(s.files, "pending") + n(s.files, "processing")} waiting · ${n(s.files, "failed")} failed`],
    ["Facts verified", n(s.facts, "verified"), `${n(s.facts, "unverified")} unverified · ${n(s.facts, "rejected")} rejected`],
    ["Built sites", n(s.entities, "built"), `${n(s.entities, "natural")} natural · ${n(s.entities, "settlement")} settlements`],
    ["Crafts", n(s.entities, "craft"), `${s.translated_sources} documents translated`],
    ["Contributors", s.users.length, `${s.users.reduce((a, u) => a + u.uploads, 0)} files · ${s.users.reduce((a, u) => a + u.reviews, 0)} reviews`],
  ];
  return (
    <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map(([label, value, sub]) => (
        <div key={label} className="rounded-md border border-line bg-paper px-3 py-3">
          <dt className="text-[12px] uppercase tracking-wide text-dust">{label}</dt>
          <dd className="font-display text-3xl text-ink">{value}</dd>
          <dd className="text-[12px] text-dust">{sub}</dd>
        </div>
      ))}
    </dl>
  );
}

function Panel({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="kg-frieze mb-5" aria-hidden="true" />
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="mt-1 max-w-3xl text-[15px] text-dust">{intro}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Job({ title, text, onRun }: { title: string; text: string; onRun: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-line bg-paper p-4">
      <div>
        <h3 className="font-medium text-ink">{title}</h3>
        <p className="mt-0.5 text-[14px] text-dust">{text}</p>
      </div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onRun();
          setBusy(false);
        }}
        className="shrink-0 rounded-md bg-water px-3 py-1.5 text-[14px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Starting…" : "Run"}
      </button>
    </div>
  );
}

function FileRow({ f, onRetry, onDelete }: { f: AdminStatus["failed"][number]; onRetry: () => Promise<void>; onDelete: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/source/${f.id}`} className="min-w-0 break-all text-[15px] text-water hover:underline">
          {f.filename}
        </Link>
        <span className="flex gap-2 text-[13px]">
          <button onClick={onRetry} className="rounded border border-line px-2.5 py-1 text-ink hover:bg-sand">Read again</button>
          {confirm ? (
            <>
              <button onClick={onDelete} className="rounded bg-rust px-2.5 py-1 font-medium text-paper">Delete for good</button>
              <button onClick={() => setConfirm(false)} className="rounded border border-line px-2.5 py-1 text-dust">Keep</button>
            </>
          ) : (
            <button onClick={() => setConfirm(true)} className="rounded border border-rust/40 px-2.5 py-1 text-rust hover:bg-rust-soft">Delete</button>
          )}
        </span>
      </div>
      {f.error && <p className="mt-1 text-[13px] text-rust">{f.error}</p>}
    </li>
  );
}

function ImportPanel({ onRun }: { onRun: (label: string, path: string, init?: RequestInit) => Promise<void> }) {
  const [titles, setTitles] = useState("");
  const [kind, setKind] = useState<"monument" | "craft">("monument");
  return (
    <Panel title="Import from Wikipedia" intro="English and Hindi articles, credited and processed like any upload. One title per line, exactly as on Wikipedia.">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const list = titles.split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 20);
          if (!list.length) return;
          await onRun(`Import ${list.length} article(s)`, "/import/wikipedia", { method: "POST", body: JSON.stringify({ titles: list, kind }) });
          setTitles("");
        }}
      >
        <textarea value={titles} onChange={(e) => setTitles(e.target.value)} rows={3} placeholder={"Sun Temple, Modhera\nPatola"} className="w-full rounded-md border border-line bg-paper px-3 py-2 text-[15px] text-ink placeholder:text-dust" />
        <div className="flex flex-wrap items-center gap-3 text-[14px]">
          <label className="flex items-center gap-1.5"><input type="radio" checked={kind === "monument"} onChange={() => setKind("monument")} /> Monument or site</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={kind === "craft"} onChange={() => setKind("craft")} /> Craft</label>
          <button type="submit" className="ml-auto rounded-md bg-water px-3 py-1.5 font-medium text-paper hover:opacity-90">Import</button>
        </div>
      </form>
    </Panel>
  );
}

function FixPanel({ onRun }: { onRun: (label: string, path: string, init?: RequestInit) => Promise<void> }) {
  const [id, setId] = useState("");
  const [nature, setNature] = useState("built");
  const valid = /^\d+$/.test(id.trim());
  return (
    <Panel title="Fix one record" intro="The record number is on each monument page (Record no. 001). Set what kind of site it is, or read its texts again for its date.">
      <div className="space-y-3 text-[14px]">
        <label className="block font-medium text-ink">
          Record number
          <input value={id} onChange={(e) => setId(e.target.value)} inputMode="numeric" placeholder="e.g. 5" className="mt-1 w-32 rounded-md border border-line bg-paper px-3 py-2 text-[15px] text-ink" />
          {valid && (
            <Link href={`/monument/${id.trim()}`} className="ml-3 text-water underline underline-offset-2">open it</Link>
          )}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select value={nature} onChange={(e) => setNature(e.target.value)} className="rounded-md border border-line bg-paper px-2 py-1.5 text-ink">
            <option value="built">Built</option>
            <option value="natural">Natural site</option>
            <option value="settlement">Settlement</option>
          </select>
          <button
            disabled={!valid}
            onClick={() => onRun(`Record ${id}: set as ${nature}`, `/entities/${id.trim()}`, { method: "PATCH", body: JSON.stringify({ nature }) })}
            className="rounded-md border border-line px-3 py-1.5 text-ink hover:bg-sand disabled:opacity-40"
          >
            Set kind
          </button>
          <button
            disabled={!valid}
            onClick={() => onRun(`Record ${id}: read its date again`, `/entities/${id.trim()}/redate`)}
            className="rounded-md border border-line px-3 py-1.5 text-ink hover:bg-sand disabled:opacity-40"
          >
            Read its date again
          </button>
        </div>
      </div>
    </Panel>
  );
}
