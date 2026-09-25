import type { LucideIcon } from "lucide-react";

interface MetricTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  sublabel?: string;
  from: string; // Tailwind gradient "from-*" class
  to: string; // Tailwind gradient "to-*" class
}

// Same gradient-icon-badge look as the homepage's dashboard tiles
// (app/page.tsx), factored out for reuse on pages that want a horizontal
// row of at-a-glance numbers instead of a vertical stack of sections —
// first used by the subscriptions page's overview row.
export function MetricTile({ icon: Icon, label, value, sublabel, from, to }: MetricTileProps) {
  return (
    <div className="card p-5">
      <span
        className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${from} ${to} text-white shadow-sm`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{value}</p>
      {sublabel && <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{sublabel}</p>}
    </div>
  );
}
