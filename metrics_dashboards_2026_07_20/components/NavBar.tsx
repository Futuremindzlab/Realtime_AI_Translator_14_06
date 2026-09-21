"use client";

import { useEffect, useState } from "react";
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

  const linkClass = "text-sm text-slate-600 hover:text-brand-600";

  return (
    <nav className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-6">
      <span className="font-semibold text-slate-900">Metrics Dashboards</span>

      {session?.role === "OWNER" && (
        <>
          <a href="/user_analytics" className={linkClass}>User Analytics</a>
          <a href="/payments" className={linkClass}>Payments</a>
          <a href="/subscriptions" className={linkClass}>Subscriptions</a>
          <a href="/infra_security" className={linkClass}>Infra &amp; Security</a>
        </>
      )}

      <a href="/my-history" className={linkClass}>My History</a>

      <span className="ml-auto text-xs text-slate-400">
        {session ? session.email : "Not signed in"}
      </span>
    </nav>
  );
}
