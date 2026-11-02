"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, signIn, signUp } from "@/lib/api";
import { useAccount } from "@/lib/auth";

// Join or sign in. An account is optional: it credits your uploads and fact reviews to you and
// lists them under "My contributions".

const REASONS = [
  { id: "research", label: "I research history or heritage" },
  { id: "study", label: "I'm a student" },
  { id: "fellowship", label: "I document sites on a fellowship or field trip" },
  { id: "travel", label: "I'm planning a visit" },
  { id: "archive", label: "I work with an archive, museum or institution" },
  { id: "craft", label: "I practise or study a craft" },
  { id: "curious", label: "Just curious" },
];

export default function JoinPage() {
  const router = useRouter();
  const user = useAccount();
  const [mode, setMode] = useState<"join" | "signin">("join");
  const [next, setNext] = useState("/me");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Join · KathaGraph";
    const p = new URLSearchParams(window.location.search);
    const n = p.get("next");
    if (n && n.startsWith("/") && !n.startsWith("//") && n !== "/join") setNext(n);
    if (p.get("mode") === "signin") setMode("signin");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "join") {
        const label = REASONS.find((r) => r.id === reason)?.label;
        const why = [label, note.trim()].filter(Boolean).join(" · ");
        await signUp({ name: name.trim(), email: email.trim(), password, reason: why || undefined });
      } else {
        await signIn(email.trim(), password);
      }
      router.push(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[16px] text-ink placeholder:text-dust focus:border-water";

  return (
    <main className="kg-sheet mx-auto w-[calc(100%-1.5rem)] max-w-xl px-4 pb-14 pt-6 sm:pt-10">
      <p className="text-[13px] tracking-wide text-ochre">Contributors</p>
      <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">{mode === "join" ? "Join the archive" : "Welcome back"}</h1>
      <p className="mt-2 text-[16px] text-dust">
        Anyone can explore, upload and check facts without an account. With one, everything you add or check is credited to
        you and gathered under <b className="text-ink">My contributions</b>.
      </p>

      {user ? (
        <div className="mt-6 rounded-md border border-line bg-sand/50 px-4 py-4 text-[16px]">
          You&apos;re signed in as <b>{user.name}</b>.{" "}
          <Link href="/me" className="text-water underline underline-offset-2">
            Go to my contributions →
          </Link>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Join or sign in" className="mt-6 grid grid-cols-2 overflow-hidden rounded-md border border-line">
            {(["join", "signin"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`py-2 text-[15px] font-medium ${mode === m ? "kg-tablet" : "bg-paper text-dust hover:text-ink"}`}
              >
                {m === "join" ? "Create an account" : "Sign in"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            {mode === "join" && (
              <label className="block text-[14px] font-medium text-ink">
                Your name
                <input required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="As you'd like to be credited" />
              </label>
            )}
            <label className="block text-[14px] font-medium text-ink">
              Email
              <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="you@example.com" />
            </label>
            <label className="block text-[14px] font-medium text-ink">
              Password
              <input
                required
                type="password"
                minLength={mode === "join" ? 8 : 1}
                autoComplete={mode === "join" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
                placeholder={mode === "join" ? "At least 8 characters" : ""}
              />
            </label>

            {mode === "join" && (
              <fieldset>
                <legend className="text-[14px] font-medium text-ink">What brought you here?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {REASONS.map((r) => (
                    <label
                      key={r.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-[14px] ${
                        reason === r.id ? "border-water bg-water-soft text-ink" : "border-line bg-paper text-dust hover:border-ink/30"
                      }`}
                    >
                      <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="mt-1 accent-[var(--color-water)]" />
                      {r.label}
                    </label>
                  ))}
                </div>
                <input
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={`${field} mt-2`}
                  placeholder="Anything else? e.g. the site or craft you care about (optional)"
                />
              </fieldset>
            )}

            {error && <p role="alert" className="rounded border border-rust/30 bg-rust-soft px-3 py-2 text-[15px] text-rust">{error}</p>}

            <button type="submit" disabled={busy} className="w-full rounded-md bg-water px-4 py-2.5 text-[16px] font-medium text-paper hover:opacity-90 disabled:opacity-50">
              {busy ? "One moment…" : mode === "join" ? "Create my account" : "Sign in"}
            </button>
            <p className="text-[13px] text-dust">
              Your email stays private: it is never shown on the site. Passwords are stored only as a secure hash.
            </p>
          </form>
        </>
      )}
    </main>
  );
}
