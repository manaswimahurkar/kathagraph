import type { Metadata, Viewport } from "next";
// Self-hosted fonts: no Google Fonts request at build or page load.
// Hind covers Devanagari, so Hindi OCR text renders in the same family as the UI.
import "@fontsource/hind/400.css";
import "@fontsource/hind/500.css";
import "@fontsource/hind/600.css";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/400-italic.css";
import "@fontsource/spectral/600.css";
import "@fontsource/rozha-one/400.css";
import "@fontsource/hind-vadodara/400.css";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import WorldBackground from "@/components/WorldBackground";
import { THEME_BOOT_SCRIPT } from "@/lib/prefs";

export const metadata: Metadata = {
  title: { default: "KathaGraph", template: "%s · KathaGraph" },
  description: "An evidence-aware heritage archive: every fact linked to its source, disagreements shown, gaps listed.",
};

export const viewport: Viewport = { themeColor: "#17110c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* apply the saved light/dark theme before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <WorldBackground />
        <SiteHeader />
        <div className="pointer-events-none relative z-10">{children}</div>
      </body>
    </html>
  );
}
