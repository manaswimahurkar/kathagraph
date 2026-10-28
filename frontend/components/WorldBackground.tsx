"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEntities } from "@/lib/useEntities";
import type { MapView } from "./GujaratMap3D";

// WebGL only exists in the browser, and the map loads after the page so it never blocks the content.
const GujaratMap3D = dynamic(() => import("./GujaratMap3D"), { ssr: false, loading: () => null });

function viewFor(path: string): MapView {
  if (path === "/") return { kind: "home" };
  const m = path.match(/^\/monument\/(\d+)/);
  if (m) return { kind: "monument", id: Number(m[1]) };
  if (path.startsWith("/search")) return { kind: "search" };
  if (path.startsWith("/upload")) return { kind: "upload" };
  return { kind: "other" };
}

/** The 3D map of Gujarat behind every page. Only the home page lets you drag and zoom it. */
export default function WorldBackground() {
  const pathname = usePathname();
  const view = viewFor(pathname);
  const { state } = useEntities();
  const entities = state.kind === "ready" ? state.entities : [];
  const interactive = view.kind === "home";

  return (
    <div
      aria-hidden={!interactive}
      className={`fixed inset-0 z-0 bg-[#17110c] ${interactive ? "" : "pointer-events-none"}`}
    >
      <GujaratMap3D view={view} entities={entities} interactive={interactive} />
    </div>
  );
}
