import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Metrics Dashboards",
  description: "Internal analytics and infra/security dashboards",
};

// Sets the .dark class on <html> before first paint, so the page never
// flashes light-then-dark for someone who has dark mode saved/preferred.
// Must run synchronously and inline (not a useEffect, which only fires
// after React has already painted the light-theme markup once) — a
// deliberately tiny, self-contained script kept out of the client bundle.
//
// Defaults to dark when nothing is stored yet, rather than deferring to the
// OS's prefers-color-scheme — this dashboard was explicitly asked to be a
// dark-first UI, and most machines default to a light OS theme, which was
// silently overriding that intent for anyone who hadn't manually toggled it
// yet. An explicit choice (either way) in localStorage always wins.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("ops_dashboard_theme");
    var dark = stored ? stored === "dark" : true;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.className} min-h-screen`}>
        <NavBar />
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
