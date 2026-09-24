import type { Config } from "tailwindcss";

const config: Config = {
  // Class-based (not media-query-based) so a manual toggle can override the
  // OS preference and persist it — see components/ThemeToggle.tsx.
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Vivid indigo/violet — replaces the old flat blue. Pairs with
        // `accent` (cyan) for gradients across buttons, the nav mark, and
        // stat card highlights. Same scale used in both light and dark mode;
        // only the surface/text/border tokens below change per mode.
        brand: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
        },
        accent: {
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        "card-hover": "0 4px 12px -2px rgb(124 58 237 / 0.12), 0 2px 6px -2px rgb(15 23 42 / 0.06)",
        "card-dark": "0 1px 2px 0 rgb(0 0 0 / 0.2), 0 1px 3px 0 rgb(0 0 0 / 0.3)",
        "card-dark-hover": "0 4px 16px -2px rgb(139 92 246 / 0.25), 0 2px 8px -2px rgb(0 0 0 / 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
