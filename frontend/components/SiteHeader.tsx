"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { USE_MOCK } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import UserMenu from "./UserMenu";

const NAV: { href: string; label: string; short?: string }[] = [
  { href: "/", label: "Map" },
  { href: "/search", label: "Search" },
  { href: "/ask", label: "Ask" },
  { href: "/timeline", label: "Timeline" },
  { href: "/stories", label: "Stories & crafts", short: "Stories" },
  { href: "/next", label: "Field visits", short: "Visits" },
  { href: "/field", label: "I'm here", short: "Here" },
  { href: "/inscription", label: "Inscriptions", short: "Read" },
  { href: "/review", label: "Review" },
  { href: "/upload", label: "Upload" },
];

/** Logo: a domed jharokha (carved window) looking into a stepwell, its terraces stepping down to the water. */
export function KathaMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 46" aria-hidden="true" className={className}>
      <circle cx="20" cy="2.6" r="2" fill="#e3a84e" />
      <path d="M20 5.2C26.5 5.2 31.5 9.4 32.6 15C35 15.2 36.6 17 36.6 19.4V45H3.4V19.4C3.4 17 5 15.2 7.4 15C8.5 9.4 13.5 5.2 20 5.2Z" fill="#e3a84e" />
      <path d="M11 15.4C12.6 11.4 16 9.4 20 9.4C24 9.4 27.4 11.4 29 15.4" fill="none" stroke="#7a5216" strokeWidth="1.5" />
      <rect x="7.6" y="20" width="24.8" height="25" fill="#2a1d12" />
      <path d="M7.6 20H32.4V25H28.2V30H24.2V35H15.8V30H11.8V25H7.6Z" fill="#f3dfb8" />
      <rect x="15.8" y="35" width="8.4" height="5" fill="#86c7bd" />
    </svg>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const { theme, setTheme } = usePrefs();
  // On a phone, keep the current page's link in view in the sideways-scrolling row.
  useEffect(() => {
    document
      .querySelector('nav[aria-label="Main"] [aria-current="page"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);
  return (
    <header className="kg-lintel sticky top-0 z-[1000] backdrop-blur">
      {USE_MOCK && (
        <p className="bg-ochre-soft px-4 py-1.5 text-center text-[13px] text-ink">
          Showing demo data for three Gujarat stepwells. It is illustrative, not an archival record.
        </p>
      )}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-ink sm:gap-2.5">
          <KathaMark className="h-8 w-7 sm:h-10 sm:w-9" />
          <span className="kg-title font-display text-lg leading-none tracking-wide max-[400px]:hidden sm:text-[22px]">KathaGraph</span>
          <span lang="hi" className="hidden font-display text-base leading-none text-ochre sm:inline">
            कथा
          </span>
        </Link>
        {/* Nine links don't fit on a phone: the row scrolls sideways there, with a fade hinting at more. */}
        <nav
          aria-label="Main"
          className="min-w-0 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none] lg:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex items-center text-[14px] sm:gap-1 sm:text-[15px]">
            {NAV.map((n) => {
              const active =
                n.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(n.href) || (n.href === "/stories" && /^\/(journeys|crafts|teams)/.test(pathname));
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`whitespace-nowrap rounded px-1.5 py-1.5 transition-colors sm:px-3 ${
                      active ? "kg-tablet" : "text-dust hover:bg-sand hover:text-ink"
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
        <UserMenu />
      </div>
      <div className="kg-frieze" aria-hidden="true" />
    </header>
  );
}
