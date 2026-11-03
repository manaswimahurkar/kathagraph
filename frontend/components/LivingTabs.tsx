import Link from "next/link";

// Stories, routes and crafts are one part of the site: the living heritage around the monuments.
const TABS = [
  { href: "/stories", label: "Stories & legends" },
  { href: "/journeys", label: "Routes & journeys" },
  { href: "/crafts", label: "Crafts" },
  { href: "/teams", label: "Fellowship teams" },
];

export default function LivingTabs({ current }: { current: string }) {
  return (
    <nav aria-label="Living heritage" className="mt-4 flex flex-wrap gap-2 text-[14px]">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`rounded-full border px-3 py-1 ${
            t.href === current ? "border-water bg-water text-paper" : "border-line bg-paper text-ink hover:border-ink/40"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
