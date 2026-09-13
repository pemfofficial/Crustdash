"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { compact, dayLabel, fullDate, integer, longDateTime, monthLabel, niceTicks, shortDateTime } from "./format";

export type LineSeries = {
  key: string;
  label: string;
  /** Categorical slot 1-8; assigned by entity, never by rank. */
  slot: number;
  values: (number | null)[];
};

type Props = {
  title: string;
  subtitle?: string;
  /** Shared x positions (epoch ms), one per value index. */
  x: number[];
  series: LineSeries[];
  height?: number;
  /** Named formatter — functions can't cross the server→client boundary. */
  yFormat?: "compact" | "integer";
  zeroBaseline?: boolean;
  /** "datetime" for intra-day series such as a play session. */
  xFormat?: "date" | "datetime";
};

const M = { top: 12, right: 16, bottom: 28, left: 56 };

export function LineChart({ title, subtitle, x, series, height = 240, yFormat = "compact", zeroBaseline = true, xFormat = "date" }: Props) {
  const formatY = yFormat === "integer" ? integer : compact;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const clipId = `plot-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(Math.max(280, el.getBoundingClientRect().width)); // measure now; the observer handles later resizes
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [showTable]);

  const single = series.length === 1;
  const right = single ? M.right + 56 : M.right; // room for the end-value label
  const plotW = width - M.left - right;
  const plotH = height - M.top - M.bottom;

  const { yTicks, yMin, yMax } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) for (const v of s.values) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (zeroBaseline) lo = Math.min(0, lo);
    const t = niceTicks(lo, hi, 4);
    return { yTicks: t, yMin: t[0], yMax: t[t.length - 1] };
  }, [series, zeroBaseline]);

  const x0 = x[0] ?? 0;
  const x1 = x[x.length - 1] ?? 1;
  const sx = (ms: number) => M.left + (x1 === x0 ? plotW / 2 : ((ms - x0) / (x1 - x0)) * plotW);
  const sy = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const spanDays = (x1 - x0) / 86400000;
  const xTickIdx = useMemo(() => {
    const n = Math.min(5, x.length);
    return Array.from({ length: n }, (_, i) => Math.round((i * (x.length - 1)) / Math.max(1, n - 1)));
  }, [x]);

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${sx(x[i]).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  const nearest = (px: number) => {
    const target = x0 + ((px - M.left) / plotW) * (x1 - x0);
    let lo = 0;
    let hi = x.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] < target) lo = mid; else hi = mid; }
    return Math.abs(x[lo] - target) <= Math.abs(x[hi] - target) ? lo : hi;
  };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    setHover(nearest(e.clientX - rect.left));
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(x.length - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? x.length) - 1));
    else if (e.key === "Escape") setHover(null);
  };

  const lastIdx = (s: LineSeries) => { for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) return i; return -1; };
  const firstIdx = (s: LineSeries) => s.values.findIndex((v) => v != null);
  const hx = hover != null ? sx(x[hover]) : 0;
  const tooltipLeft = hx > width * 0.6;
  const base = sy(Math.max(yMin, 0));

  return (
    <figure className="card chart">
      <header className="chart-head">
        <div>
          <figcaption className="chart-title">{title}</figcaption>
          {subtitle && <p className="chart-sub">{subtitle}</p>}
        </div>
        <button type="button" className="ghost-btn" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Chart" : "Table"}
        </button>
      </header>

      {series.length > 1 && (
        <ul className="legend">
          {series.map((s) => (
            <li key={s.key}>
              <span className="line-key" style={{ background: `var(--series-${s.slot})` }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {showTable ? (
        <div className="table-wrap table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Date</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr>
            </thead>
            <tbody>
              {x.map((ms, i) => (
                <tr key={ms}>
                  <td>{xFormat === "datetime" ? longDateTime(ms) : fullDate(ms)}</td>
                  {series.map((s) => <td key={s.key}>{s.values[i] == null ? "—" : formatY(s.values[i]!)}</td>)}
                </tr>
              )).reverse()}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="plot-wrap" style={{ height }}>
          {/* viewBox + 100% width: scales to fit before the ResizeObserver measures (SSR, slow hydration) */}
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMin meet" role="img" aria-label={title}>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + plotW} y1={sy(t)} y2={sy(t)} className={t === 0 ? "axis-base" : "grid"} />
                <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="tick">{formatY(t)}</text>
              </g>
            ))}
            {xTickIdx.map((i, k) => (
              <text key={`${i}-${k}`} x={sx(x[i])} y={height - 8} textAnchor={k === 0 ? "start" : k === xTickIdx.length - 1 ? "end" : "middle"} className="tick">
                {xFormat === "datetime" ? shortDateTime(x[i]) : spanDays > 120 ? monthLabel(x[i]) : dayLabel(x[i])}
              </text>
            ))}

            {/* Marks never paint outside the plot (they used to run over the legend) */}
            <defs>
              <clipPath id={clipId}>
                <rect x={M.left} y={M.top - 3} width={Math.max(0, plotW)} height={Math.max(0, plotH) + 6} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clipId})`}>
            {single && paths[0] && (
              <path
                d={`${paths[0]}L${sx(x[lastIdx(series[0])])},${base}L${sx(x[firstIdx(series[0])])},${base}Z`}
                style={{ fill: `var(--series-${series[0].slot})`, opacity: 0.1 }}
              />
            )}
            {series.map((s, i) => (
              <path key={s.key} d={paths[i]} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: `var(--series-${s.slot})` }} />
            ))}
            </g>

            {single && lastIdx(series[0]) >= 0 && hover == null && (() => {
              const i = lastIdx(series[0]);
              const v = series[0].values[i]!;
              return (
                <g>
                  <circle cx={sx(x[i])} cy={sy(v)} r={4} strokeWidth={2} className="ring" style={{ fill: `var(--series-${series[0].slot})` }} />
                  <text x={sx(x[i]) + 10} y={sy(v)} dy="0.32em" className="end-label">{formatY(v)}</text>
                </g>
              );
            })()}

            {hover != null && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={M.top} y2={M.top + plotH} className="crosshair" />
                {series.map((s) => s.values[hover] != null && (
                  <circle key={s.key} cx={hx} cy={sy(s.values[hover]!)} r={4} strokeWidth={2} className="ring" style={{ fill: `var(--series-${s.slot})` }} />
                ))}
              </g>
            )}

            <rect
              x={M.left}
              y={M.top}
              width={Math.max(0, plotW)}
              height={Math.max(0, plotH)}
              fill="transparent"
              tabIndex={0}
              aria-label={`${title}: use arrow keys to read values`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover((h) => h ?? x.length - 1)}
              onBlur={() => setHover(null)}
              onKeyDown={onKey}
              className="hit"
            />
          </svg>

          {hover != null && (
            <div className="tooltip" style={{ top: M.top, ...(tooltipLeft ? { right: width - hx + 12 } : { left: hx + 12 }) }}>
              <div className="tooltip-head">{xFormat === "datetime" ? longDateTime(x[hover]) : fullDate(x[hover])}</div>
              {series.map((s) => (
                <div key={s.key} className="tooltip-row">
                  <span className="line-key" style={{ background: `var(--series-${s.slot})` }} />
                  <strong>{s.values[hover] == null ? "—" : formatY(s.values[hover]!)}</strong>
                  <span className="muted">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
