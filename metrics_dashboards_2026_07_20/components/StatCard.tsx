interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
}

export function StatCard({ label, value, delta, deltaTone = "neutral" }: StatCardProps) {
  const deltaColor =
    deltaTone === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : deltaTone === "down"
      ? "text-red-600 dark:text-red-400"
      : "text-slate-500 dark:text-slate-400";

  return (
    <div className="card relative overflow-hidden p-5">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 to-accent-400" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{value}</p>
      {delta && <p className={`mt-1 text-xs font-medium ${deltaColor}`}>{delta}</p>}
    </div>
  );
}
