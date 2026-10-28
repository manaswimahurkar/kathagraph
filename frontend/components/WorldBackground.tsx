"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { Station } from "./World3D";

// WebGL only exists in the browser, and the 3D world is decoration: it loads after the page
// and never blocks the content. Until it arrives, the paper background shows.
const World3D = dynamic(() => import("./World3D"), { ssr: false, loading: () => null });

function stationFor(path: string): Station {
  if (path === "/") return "home";
  if (path.startsWith("/monument")) return "monument";
  if (path.startsWith("/search")) return "search";
  if (path.startsWith("/upload")) return "upload";
  return "other";
}

export default function WorldBackground() {
  const pathname = usePathname();
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <World3D station={stationFor(pathname)} />
    </div>
  );
}
