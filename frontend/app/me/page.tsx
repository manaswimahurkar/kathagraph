"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@/components/States";
import { getMe, signOut, updateMe, type MyContributions } from "@/lib/api";
import { getSession, initials, updateSessionUser } from "@/lib/auth";

// A contributor's profile: who they are, why they came, and everything they have added or checked.

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: MyContributions };

const STATUS: Record<string, string> = { pending: "waiting", processing: "being read", done: "done", failed: "failed" };
const FIELD: Record<string, string> = {
  built_date: "Date", builder: "Builder", dynasty: "Dynasty", location: "Location", architectural_style: "Style",
  material: "Material", purpose: "Purpose", inscription: "Inscription", heritage_status: "Heritage status",
  legend: "Story", technique: "Technique", practitioners: "Practitioners",
};

export default function MePage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    if (!getSession()) {
      router.replace("/join?next=/me");
      return;
    }
    setState({ kind: "loading" });
    getMe()
      .then((data) => {
        setState({ kind: "ready", data });
        setName(data.user.name);
        setReason(data.user.reason ?? "");
      })
      .catch((e: Error) => {
        if (!getSession()) router.replace("/join?next=/me");
        else setState({ kind: "error", message: e.message });
      });
  }, [router]);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = "My contributions · KathaGraph";
  }, []);

  async function save() {
    const user = await updateMe({ name: name.trim(), reason: reason.trim() });
    updateSessionUser(user);
    setEditing(false);
    setState((s) => (s.kind === "ready" ? { kind: "ready", data: { ...s.data, user } } : s));
  }

  if (state.kind === "loading")
    return (
      <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-4xl px-4 pb-16 pt-10">
        <Skeleton className="h-24 w-2/3" />
        <Skeleton className="mt-6 h-64 w-full" />
      </main>
    );
  if (state.kind === "error")
    return (
      <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-4xl px-4 pb-16 pt-10">
        <ErrorState title="Couldn't load your profile" message={state.message} onRetry={load} />
      </main>
    );

  const { user, totals, uploads, reviews } = state.data;
  const joined = user.created_at ? new Date(user.created_at).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : null;

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-4xl px-4 pb-16 pt-6 sm:pt-10">
      <div className="flex flex-wrap items-center gap-5">
        <span aria-hidden="true" className="kg-tablet grid size-20 shrink-0 place-items-center rounded-full font-display text-3xl sm:size-24 sm:text-4xl">
          {initials(user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] tracking-wide text-ochre">Contributor{joined && ` since ${joined}`}</p>
          {editing ? (
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Your name" className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-2xl text-ink" />
          ) : (
            <h1 className="mt-1 break-words font-display text-4xl leading-[1.05] sm:text-5xl">{user.name}</h1>
          )}
          <p className="mt-1 text-[14px] text-dust">{user.email} · only you can see this</p>
        </div>
      </div>

      <div className="mt-5 rounded-md border-l-4 border-ochre bg-sand/50 px-4 py-3">
        <p className="text-[12px] uppercase tracking-wide text-dust">What brought you here</p>
        {editing ? (
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label="What brought you here" className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[16px] text-ink" />
        ) : (
          <p className="mt-1 font-serif text-[17px] text-ink">{user.reason || "Not said yet."}</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[14px]">
        {editing ? (
          <>
            <button onClick={save} className="rounded-md bg-water px-3 py-1.5 font-medium text-paper">Save</button>
            <button onClick={() => setEditing(false)} className="rounded-md border border-line px-3 py-1.5 text-ink">Cancel</button>
          </>
        ) : (
          <button onClick={() => setEditing(true)} className="rounded-md border border-line px-3 py-1.5 text-ink hover:bg-sand">Edit profile</button>
        )}
        <button
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
          className="rounded-md border border-line px-3 py-1.5 text-dust hover:bg-sand hover:text-ink"
        >
          Sign out
        </button>
      </div>

      <section className="mt-10">
        <div className="kg-frieze mb-6" aria-hidden="true" />
        <h2 className="font-display text-3xl">My contributions</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            [totals.uploads, "files added"],
            [totals.facts, "facts found in them"],
            [totals.monuments, "monuments documented"],
            [totals.verified, "facts I verified"],
            [totals.rejected, "facts I rejected"],
          ].map(([n, label]) => (
            <div key={label} className="rounded-md border border-line bg-paper px-3 py-3 text-center">
              <dd className="font-display text-3xl text-ink">{n}</dd>
              <dt className="text-[13px] text-dust">{label}</dt>
            </div>
          ))}
        </dl>

        {uploads.length === 0 && reviews.length === 0 && (
          <div className="mt-6 rounded-md border border-dashed border-line px-5 py-8 text-center">
            <p className="font-serif text-lg text-ink">Nothing here yet</p>
            <p className="mt-1 text-[15px] text-dust">
              <Link href="/upload" className="text-water underline underline-offset-2">Upload photos or notes</Link> or{" "}
              <Link href="/review" className="text-water underline underline-offset-2">check facts the AI read</Link>: they will appear here.
            </p>
          </div>
        )}

        {uploads.length > 0 && (
          <div className="mt-8">
            <h3 className="text-[13px] uppercase tracking-wide text-dust">Files I added</h3>
            <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-paper">
              {uploads.map((u) => (
                <li key={u.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <span className="min-w-0 break-all text-[15px]">
                    <Link href={`/source/${u.id}`} className="text-water underline-offset-2 hover:underline">{u.filename}</Link>
                    {u.entities.length > 0 && (
                      <span className="block text-[13px] text-dust">
                        {u.entities.map((e, i) => (
                          <span key={e.id}>
                            {i > 0 && ", "}
                            <Link href={`/monument/${e.id}`} className="hover:underline">{e.name}</Link>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="text-[13px] text-dust">
                    {u.n_facts} {u.n_facts === 1 ? "fact" : "facts"} · {STATUS[u.status] ?? u.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {reviews.length > 0 && (
          <div className="mt-8">
            <h3 className="text-[13px] uppercase tracking-wide text-dust">Facts I checked</h3>
            <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-paper">
              {reviews.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[15px]">
                  <span className="min-w-0">
                    <Link href={`/monument/${r.entity_id}`} className="text-water hover:underline">{r.entity_name}</Link>
                    <span className="text-dust"> · {FIELD[r.field] ?? r.field.replace(/_/g, " ")}: </span>
                    {r.value}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${r.status === "verified" ? "bg-water-soft text-water" : r.status === "rejected" ? "bg-rust-soft text-rust" : "bg-sand text-dust"}`}>
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
