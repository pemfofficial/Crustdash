// Sparkline and meter: the "the number is the chart" forms.

export function Sparkline({ values, width = 96, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = 5; // leaves room for the end dot + ring
  const sx = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const sy = (v: number) => pad + (height - pad * 2) * (1 - (v - lo) / (hi - lo || 1));
  const d = values.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden className="sparkline">
      <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="spark-line" />
      <circle cx={sx(last)} cy={sy(values[last])} r={4} strokeWidth={2} className="ring" style={{ fill: "var(--series-1)" }} />
    </svg>
  );
}

export function Meter({ label, value, max, format }: { label: string; value: number; max: number; format: (n: number) => string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const level = ratio >= 0.9 ? "critical" : ratio >= 0.75 ? "warning" : "ok";
  const levelText = level === "critical" ? "Near limit" : level === "warning" ? "Getting tight" : "Headroom";
  return (
    <div className="card stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {format(value)} <span className="muted stat-of">/ {format(max)}</span>
      </div>
      <div className={`meter meter-${level}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className="meter-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="stat-delta delta-neutral">
        <span aria-hidden>{level === "ok" ? "●" : "▲"}</span> {levelText} · {Math.round(ratio * 100)}%
      </div>
    </div>
  );
}
