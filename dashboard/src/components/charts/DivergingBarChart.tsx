"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { compact, dayLabel, fullDate, integer, monthLabel, niceTicks, signed } from "./format";

type Props = {
  title: string;
  subtitle?: string;
  /** Epoch ms per value (daily). */
  x: number[];
  values: (number | null)[];
  height?: number;
  positiveLabel?: string;
  negativeLabel?: string;
};

const M = { top: 12, right: 12, bottom: 28, left: 60 };
const WEEKLY_AFTER = 120;

/** Bars above/below a zero baseline (diverging: blue up, red down, gray baseline). Aggregates to weeks past 120 days. */
export function DivergingBarChart({ title, subtitle, x, values, height = 220, positiveLabel = "Net gain", negativeLabel = "Net loss" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(Math.max(280, el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [showTable]);

  const { bx, bv, weekly } = useMemo(() => {
    if (x.length <= WEEKLY_AFTER) return { bx: x, bv: values, weekly: false };
    const ox: number[] = [];
    const ov: (number | null)[] = [];
    for (let i = 0; i < x.length; i += 7) {
      const nums = values.slice(i, i + 7).filter((v): v is number => v != null);
      ox.push(x[i]);
      ov.push(nums.length ? nums.reduce((a, b) => a + b, 0) : null);
    }
    return { bx: ox, bv: ov, weekly: true };
  }, [x, values]);

  const nums = bv.filter((v): v is number => v != null);
  const ticks = niceTicks(Math.min(0, ...nums), Math.max(0, ...nums), 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const plotW = width - M.left - M.right;
  const plotH = height - M.top - M.bottom;
  const sy = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const zero = sy(0);
  const band = plotW / Math.max(1, bv.length);
  const barW = Math.max(1, Math.min(24, band - 2)); // 2px surface gap between neighbours
  const barX = (i: number) => M.left + i * band + (band - barW) / 2;
  const tickIdx = Array.from({ length: Math.min(5, bx.length) }, (_, i) => Math.round((i * (bx.length - 1)) / Math.max(1, Math.min(5, bx.length) - 1)));
  const spanDays = bx.length ? (bx[bx.length - 1] - bx[0]) / 86400000 : 0;

  const barPath = (i: number, v: number) => {
    const x0 = barX(i);
    const y = sy(v);
    const h = Math.abs(zero - y);
    const rad = Math.min(4, barW / 2, h);
    if (v >= 0) return `M${x0},${zero}V${y + rad}Q${x0},${y} ${x0 + rad},${y}H${x0 + barW - rad}Q${x0 + barW},${y} ${x0 + barW},${y + rad}V${zero}Z`;
    return `M${x0},${zero}V${y - rad}Q${x0},${y} ${x0 + rad},${y}H${x0 + barW - rad}Q${x0 + barW},${y} ${x0 + barW},${y - rad}V${zero}Z`;
  };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const scale = width / rect.width;
    const i = Math.floor(((e.clientX - rect.left) * scale - M.left) / band);
    setHover(i >= 0 && i < bv.length ? i : null);
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(bv.length - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? bv.length) - 1));
    else if (e.key === "Escape") setHover(null);
  };

  const label = (ms: number) => (weekly ? `Week of ${fullDate(ms)}` : fullDate(ms));
  const hoverX = hover != null ? barX(hover) + barW / 2 : 0;

  return (
    <figure className="card chart">
      <header className="chart-head">
        <div>
          <figcaption className="chart-title">{title}</figcaption>
          {subtitle && <p className="chart-sub">{subtitle}{weekly ? " Grouped by week." : ""}</p>}
        </div>
        <button type="button" className="ghost-btn" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Chart" : "Table"}
        </button>
      </header>
      <ul className="legend">
        <li><span className="swatch" style={{ background: "var(--div-pos)" }} />{positiveLabel}</li>
        <li><span className="swatch" style={{ background: "var(--div-neg)" }} />{negativeLabel}</li>
      </ul>

      {showTable ? (
        <div className="table-wrap table-scroll">
          <table className="data-table">
            <thead><tr><th>{weekly ? "Week" : "Day"}</th><th className="num">Net</th></tr></thead>
            <tbody>
              {bx.map((ms, i) => (
                <tr key={ms}><td>{label(ms)}</td><td className="num">{bv[i] == null ? "—" : signed(bv[i]!, integer)}</td></tr>
              )).reverse()}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="plot-wrap" style={{ height }}>
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMin meet" role="img" aria-label={title}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + plotW} y1={sy(t)} y2={sy(t)} className={t === 0 ? "axis-base" : "grid"} />
                <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="tick">{compact(t)}</text>
              </g>
            ))}
            {tickIdx.map((i, k) => (
              <text key={`${i}-${k}`} x={barX(i) + barW / 2} y={height - 8} textAnchor={k === 0 ? "start" : k === tickIdx.length - 1 ? "end" : "middle"} className="tick">
                {spanDays > 120 ? monthLabel(bx[i]) : dayLabel(bx[i])}
              </text>
            ))}
            {bv.map((v, i) =>
              v == null || v === 0 ? null : (
                <path key={i} d={barPath(i, v)} style={{ fill: v > 0 ? "var(--div-pos)" : "var(--div-neg)", opacity: hover == null || hover === i ? 1 : 0.55 }} />
              ),
            )}
            <line x1={M.left} x2={M.left + plotW} y1={zero} y2={zero} className="axis-base" />
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
              onFocus={() => setHover((h) => h ?? bv.length - 1)}
              onBlur={() => setHover(null)}
              onKeyDown={onKey}
              className="hit"
            />
          </svg>
          {hover != null && (
            <div className="tooltip" style={{ top: M.top, ...(hoverX > width * 0.6 ? { right: width - hoverX + 12 } : { left: hoverX + 12 }) }}>
              <div className="tooltip-head">{label(bx[hover])}</div>
              <div className="tooltip-row">
                <span className="swatch" style={{ background: (bv[hover] ?? 0) >= 0 ? "var(--div-pos)" : "var(--div-neg)" }} />
                <strong>{bv[hover] == null ? "No data" : signed(bv[hover]!, integer)}</strong>
                <span className="muted">{(bv[hover] ?? 0) >= 0 ? positiveLabel : negativeLabel}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
