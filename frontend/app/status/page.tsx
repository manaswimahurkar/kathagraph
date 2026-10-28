"use client";

// The original "three green ticks" check, moved here from the home page.
import { useEffect, useState } from "react";
import { getHealth, USE_MOCK } from "@/lib/api";
import type { Health } from "@/lib/types";

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 pt-10">
      <h1 className="font-display text-4xl">System status</h1>
      <p className="mt-2 text-dust">{USE_MOCK ? "Using demo data (NEXT_PUBLIC_API_URL is not set)." : "Checking the live backend."}</p>
      <section className="mt-6 rounded-md border border-line bg-paper p-4">
        {error && <p className="text-rust">Backend unreachable: {error}</p>}
        {!error && !health && <p className="text-dust">Checking…</p>}
        {health && (
          <ul className="space-y-1 text-[15px]">
            <li>API: {health.ok ? "✅ up" : "❌ down"}</li>
            <li>Database: {health.db ? "✅ connected" : `❌ ${health.error ?? "not connected"}`}</li>
            <li>pgvector: {health.pgvector ? "✅ enabled" : "❌ missing"}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
