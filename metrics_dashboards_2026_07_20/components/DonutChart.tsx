interface Segment {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let cursor = 0;
  const stops = segments
    .map((s) => {
      const start = (cursor / total) * 360;
      cursor += s.value;
      const end = (cursor / total) * 360;
      return `${s.color} ${start}deg ${end}deg`;
    })
    .join(", ");

  return (
    <div className="flex items-center gap-6">
      <div className="relative h-32 w-32 rounded-full" style={{ background: `conic-gradient(${stops})` }}>
        <div className="absolute inset-4 rounded-full bg-white" />
      </div>
      <ul className="space-y-2 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-slate-700">{s.label}</span>
            <span className="text-slate-400">{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
