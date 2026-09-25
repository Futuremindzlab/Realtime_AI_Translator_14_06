"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "ops_dashboard_theme";

// Kept in sync with the inline script in layout.tsx, which runs this same
// resolution before first paint (to avoid a flash of the light theme) and
// sets the class directly — this function is the "after hydration" path,
// e.g. re-deriving state on mount. Defaults to dark absent a stored choice
// (this dashboard is dark-first by design, not just OS-preference-following)
// — see layout.tsx's THEME_INIT_SCRIPT for the fuller reasoning.
function resolveTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme(resolveTheme());
  }, []);

  useEffect(() => {
    if (theme === null) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Renders nothing until mounted rather than guessing — avoids a
  // hydration mismatch between server-rendered markup (which has no
  // localStorage/matchMedia access) and the client's actual preference.
  if (theme === null) {
    return <span className="h-8 w-8" />;
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      // Given a visible border/background at rest (not just on hover) — the
      // hover-only ghost version blended into the nav bar closely enough
      // that it went unnoticed as an actual control.
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors
        hover:bg-slate-100 hover:text-slate-700
        dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
