interface BarListItem {
  label: string;
  value: number;
}

export function BarList({ items }: { items: BarListItem[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-700 dark:text-slate-300">{item.label}</span>
            <span className="text-slate-500 dark:text-slate-400">{item.value.toLocaleString()}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-accent-400 transition-[width]"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
