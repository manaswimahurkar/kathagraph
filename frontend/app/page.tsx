"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Health = { ok: boolean; db: boolean; pgvector?: boolean; error?: string };

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">KathaGraph</h1>
      <p className="mt-2 text-stone-600">
        What do we know about this heritage site, why do we believe it, and what is still missing?
      </p>

      <section className="mt-8 rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="font-medium">System status</h2>
        {error && <p className="mt-2 text-red-600">Backend unreachable: {error}</p>}
        {!error && !health && <p className="mt-2 text-stone-500">Checking…</p>}
        {health && (
          <ul className="mt-2 space-y-1 text-sm">
            <li>API: {health.ok ? "✅ up" : "❌ down"}</li>
            <li>Database: {health.db ? "✅ connected" : `❌ ${health.error ?? "not connected"}`}</li>
            <li>pgvector: {health.pgvector ? "✅ enabled" : "❌ missing"}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
