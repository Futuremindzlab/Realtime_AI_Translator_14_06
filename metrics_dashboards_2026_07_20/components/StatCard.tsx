interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
}

export function StatCard({ label, value, delta, deltaTone = "neutral" }: StatCardProps) {
  const deltaColor =
    deltaTone === "up" ? "text-emerald-600" : deltaTone === "down" ? "text-red-600" : "text-slate-500";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {delta && <p className={`mt-1 text-xs font-medium ${deltaColor}`}>{delta}</p>}
    </div>
  );
}
