import type { Metadata, Viewport } from "next";
// Self-hosted fonts: no Google Fonts request at build or page load.
// Hind covers Devanagari, so Hindi OCR text renders in the same family as the UI.
import "@fontsource/hind/400.css";
import "@fontsource/hind/500.css";
import "@fontsource/hind/600.css";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/400-italic.css";
import "@fontsource/spectral/600.css";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: { default: "KathaGraph", template: "%s · KathaGraph" },
  description: "An evidence-aware heritage archive: every fact linked to its source, disagreements shown, gaps listed.",
};

export const viewport: Viewport = { themeColor: "#ede3d1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
