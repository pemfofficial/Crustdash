"use client";

import { useEffect, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import type { LiveSeries } from "@/lib/crust/liveSeries";
import { useResourceLabel } from "./useMarketRows";

const POLL_MS = 10000;

/** One point per in-game minute (the clock doesn't move while paused), in time order. */
function byGameTime<T extends { g: number | null }>(points: T[]): (T & { g: number })[] {
  const latest = new Map<number, T>();
  for (const p of points) if (p.g != null) latest.set(p.g, p);
  return [...latest.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p as T & { g: number });
}

/** Credits and one resource's prices across the current play session, polled every 10 seconds. */
export function LiveSessionCharts({ pins }: { pins: Record<string, string> }) {
  const [data, setData] = useState<LiveSeries | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const labelOf = useResourceLabel();
  // Ask the server for just the charted resource: the chosen one, else the first pinned one
  const wanted = pick ?? Object.keys(pins)[0] ?? "";

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/live/series?names=${encodeURIComponent(wanted)}`, { cache: "no-store" });
        if (res.ok && alive) setData(await res.json());
      } catch {}
    };
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [wanted]);

  if (!data) return <p className="empty">Loading this session…</p>;
  const points = byGameTime(data.points);
  if (points.length < 2) return <p className="empty">Not enough of this session recorded yet. Play for a moment and it will fill in.</p>;

  const names = [...data.names].sort((a, b) => (pins[b] ? 1 : 0) - (pins[a] ? 1 : 0) || labelOf(a).localeCompare(labelOf(b)));
  const current = data.selected;
  const prices = current ? byGameTime(data.prices[current] ?? []) : [];

  return (
    <div className="grid-2">
      <LineChart
        title="Credits this session"
        subtitle={`${points.length} readings in in-game time`}
        x={points.map((p) => p.g)}
        series={[{ key: "credits", label: "Credits", slot: 1, values: points.map((p) => p.credits) }]}
        yFormat="integer"
        zeroBaseline={false}
        xFormat="datetime"
      />
      <div className="stack">
        <label className="check-row">
          Resource
          <select className="text-input" value={current ?? ""} onChange={(e) => setPick(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {pins[n] ? "★ " : ""}
                {labelOf(n)}
              </option>
            ))}
          </select>
        </label>
        {current && prices.length > 1 ? (
          <LineChart
            title={`${labelOf(current)} this session`}
            subtitle="Live sell and buy price in in-game time"
            x={prices.map((p) => p.g)}
            series={[
              { key: "sell", label: "Sell price", slot: 1, values: prices.map((p) => p.sell) },
              { key: "buy", label: "Buy price", slot: 2, values: prices.map((p) => p.buy) },
            ]}
            yFormat="integer"
            zeroBaseline={false}
            xFormat="datetime"
          />
        ) : (
          <p className="empty">No prices recorded for this resource yet.</p>
        )}
      </div>
    </div>
  );
}
