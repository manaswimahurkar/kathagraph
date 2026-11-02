"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { initials, useAccount } from "@/lib/auth";

/** Top-right of the header: "Join" when signed out, the contributor's avatar when signed in. */
export default function UserMenu() {
  const user = useAccount();
  const pathname = usePathname();
  if (!user) {
    return (
      <Link
        href={`/join?next=${encodeURIComponent(pathname || "/")}`}
        className="ml-1 whitespace-nowrap rounded border border-[#b48c5c]/60 px-2.5 py-1.5 text-[14px] text-ink hover:bg-sand sm:ml-2 sm:px-3 sm:text-[15px]"
      >
        Join
      </Link>
    );
  }
  return (
    <Link
      href="/me"
      title={`${user.name}: my profile and contributions`}
      aria-label={`${user.name}: my profile and contributions`}
      aria-current={pathname === "/me" ? "page" : undefined}
      className="kg-tablet ml-1 grid size-9 shrink-0 place-items-center rounded-full font-display text-[15px] sm:ml-2 sm:size-10"
    >
      {initials(user.name)}
    </Link>
  );
}
