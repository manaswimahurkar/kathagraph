"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { USE_MOCK } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";

const NAV: { href: string; label: string; short?: string }[] = [
  { href: "/", label: "Map" },
  { href: "/search", label: "Search" },
  { href: "/next", label: "Field visits", short: "Visits" },
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
  const { theme, setTheme } = usePrefs();
  return (
    <header className="sticky top-0 z-[1000] bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
      {USE_MOCK && (
        <p className="bg-ochre-soft px-4 py-1.5 text-center text-[13px] text-ink">
          Showing demo data for three Gujarat stepwells. It is illustrative, not an archival record.
        </p>
      )}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-ink sm:gap-2.5">
          <StepsMark className="h-4 w-6 sm:h-5 sm:w-7" />
          <span className="font-display text-lg leading-none tracking-wide max-[400px]:hidden sm:text-[22px]">KathaGraph</span>
          <span lang="hi" className="hidden font-display text-base leading-none text-ochre sm:inline">
            कथा
          </span>
        </Link>
        <nav aria-label="Main">
          <ul className="flex items-center text-[14px] sm:gap-1 sm:text-[15px]">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`whitespace-nowrap rounded px-1.5 py-1.5 transition-colors sm:px-3 ${
                      active ? "bg-ink text-paper" : "text-dust hover:bg-sand hover:text-ink"
                    }`}
                  >
                    {n.short ? (
                      <>
                        <span className="sm:hidden">{n.short}</span>
                        <span className="hidden sm:inline">{n.label}</span>
                      </>
                    ) : (
                      n.label
                    )}
                  </Link>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={theme === "dark" ? "Light mode" : "Dark mode"}
                className="ml-0.5 grid size-8 place-items-center sm:ml-1 sm:size-9 rounded text-dust hover:bg-sand hover:text-ink"
              >
                {theme === "dark" ? (
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <circle cx="12" cy="12" r="4.5" />
                    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
                  </svg>
                )}
              </button>
            </li>
          </ul>
        </nav>
      </div>
      <div className="kg-frieze" aria-hidden="true" />
    </header>
  );
}
