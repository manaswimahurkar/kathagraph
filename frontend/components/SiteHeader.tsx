"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { USE_MOCK } from "@/lib/api";

const NAV = [
  { href: "/", label: "Map" },
  { href: "/search", label: "Search" },
  { href: "/upload", label: "Upload" },
];

/** Logo mark: the cross-section of a stepwell, terraces narrowing down to the water. */
export function StepsMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 20" aria-hidden="true" className={className}>
      <path d="M0 0h28v4h-4v4h-4v4h-4v4h-4v-4H8V8H4V4H0z" fill="currentColor" />
      <rect x="12" y="17" width="4" height="3" fill="var(--color-water)" />
    </svg>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b border-line bg-paper/80 backdrop-blur supports-[backdrop-filter]:bg-paper/70 sticky top-0 z-[1000]">
      {USE_MOCK && (
        <p className="bg-ochre-soft px-4 py-1.5 text-center text-[13px] text-ink">
          Showing demo data for three Gujarat stepwells. It is illustrative, not an archival record.
        </p>
      )}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <StepsMark className="h-5 w-7" />
          <span className="font-serif text-xl font-semibold tracking-tight">KathaGraph</span>
        </Link>
        <nav aria-label="Main">
          <ul className="flex items-center gap-1 text-[15px]">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded px-3 py-1.5 transition-colors ${
                      active ? "bg-ink text-paper" : "text-dust hover:bg-sand hover:text-ink"
                    }`}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
