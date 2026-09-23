"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { loadStoredSession, type Session } from "@/lib/session";

// Each page manages its own sign-in gate independently (see app/*/page.tsx) —
// this only decides which links to *show*, not who can load a page; the
// backend is what actually enforces OWNER-only routes. Re-reads
// sessionStorage on every path change so the nav updates right after a
// page's own sign-in/sign-out, without needing a shared auth context.
export function NavBar() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(loadStoredSession());
    // sessionStorage isn't reactive — a page's own sign-in/out only fires a
    // "storage" event in OTHER tabs, so pick up same-tab changes on focus too.
    const refresh = () => setSession(loadStoredSession());
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    const interval = setInterval(refresh, 1000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      clearInterval(interval);
    };
  }, []);

  const linkClass =
    "text-sm font-medium text-slate-600 transition-colors hover:text-brand-600";

  return (
    <nav className="sticky top-0 z-10 flex items-center gap-6 border-b border-slate-200/80 bg-white/80 px-6 py-4 backdrop-blur-md">
      <a href="/" className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-accent-500 text-white shadow-sm">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="font-semibold text-slate-900">Metrics Dashboards</span>
      </a>

      {session?.role === "OWNER" && (
        <>
          <a href="/user_analytics" className={linkClass}>User Analytics</a>
          <a href="/payments" className={linkClass}>Payments</a>
          <a href="/subscriptions" className={linkClass}>Subscriptions</a>
          <a href="/infra_security" className={linkClass}>Infra &amp; Security</a>
        </>
      )}

      <a href="/my-history" className={linkClass}>My History</a>

      <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
        {session ? session.email : "Not signed in"}
      </span>
    </nav>
  );
}
