"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "ops_dashboard_theme";

// Kept in sync with the inline script in layout.tsx, which runs this same
// resolution before first paint (to avoid a flash of the light theme) and
// sets the class directly — this function is the "after hydration" path,
// e.g. re-deriving state on mount and reacting to OS-theme changes.
function resolveTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors
        hover:bg-slate-100 hover:text-slate-700
        dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
