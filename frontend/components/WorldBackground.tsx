"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useRef } from "react";
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

/**
 * The 3D map of Gujarat behind every page. Only the home page lets you drag and zoom it.
 * On other pages, clicking the map around the page's panel takes you back to the home page.
 */
export default function WorldBackground() {
  const pathname = usePathname();
  const router = useRouter();
  const view = viewFor(pathname);
  const { state } = useEntities();
  const entities = state.kind === "ready" ? state.entities : [];
  const interactive = view.kind === "home";

  // a plain click (not a drag, not a text selection) on the map outside a page goes home
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    downAt.current = { x: e.clientX, y: e.clientY };
  };
  const onClick = (e: React.MouseEvent) => {
    const d = downAt.current;
    downAt.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    if (window.getSelection()?.toString()) return;
    router.push("/");
  };

  return (
    <div
      aria-hidden={!interactive}
      title={interactive ? undefined : "Back to the map"}
      onPointerDown={interactive ? undefined : onDown}
      onClick={interactive ? undefined : onClick}
      className={`fixed inset-0 z-0 bg-[#17110c] ${interactive ? "" : "cursor-zoom-out"}`}
    >
      <GujaratMap3D view={view} entities={entities} interactive={interactive} />
    </div>
  );
}
