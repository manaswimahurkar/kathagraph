"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchBar({ initial = "", autoFocus = false }: { initial?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <form role="search" onSubmit={submit} className="flex w-full gap-2">
      <label htmlFor="kg-search" className="sr-only">
        Search the archive
      </label>
      <input
        id="kg-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={autoFocus}
        placeholder="Search in English or Hindi, e.g. Rudabai, बावड़ी"
        className="min-w-0 flex-1 rounded-md border border-line bg-paper px-4 py-2.5 text-[15px] text-ink placeholder:text-dust/70 focus:border-water focus:outline-none"
      />
      <button
        type="submit"
        disabled={!q.trim()}
        className="shrink-0 rounded-md bg-water px-5 py-2.5 text-[15px] font-medium text-paper transition-opacity disabled:opacity-50"
      >
        Search
      </button>
    </form>
  );
}
