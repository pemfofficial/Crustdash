"use client";

import { useEffect, useMemo, useState } from "react";

type Snapshot = { type: "snapshot"; seq: number; t: number; data: Record<string, unknown> };
type Status = "connecting" | "waiting" | "live" | "stale" | "error";

const STALE_MS = 8000;

/** Flattens numeric leaves (e.g. MarketManager.MarketInstances.0.ResourcePriceInfos.3.BasePrice). */
function numericLeaves(value: unknown, prefix = "", out: [string, number][] = [], limit = 400): [string, number][] {
  if (out.length >= limit) return out;
  if (typeof value === "number") out.push([prefix, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => numericLeaves(v, `${prefix}[${i}]`, out, limit));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) numericLeaves(v, prefix ? `${prefix}.${k}` : k, out, limit);
  return out;
}

export function LivePanel() {
  const [status, setStatus] = useState<Status>("connecting");
  const [session, setSession] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState("price");

  useEffect(() => {
    const es = new EventSource("/api/live");
    es.addEventListener("waiting", () => setStatus((s) => (s === "live" ? s : "waiting")));
    es.addEventListener("session", (e) => {
      setSession(JSON.parse((e as MessageEvent).data).file);
      setStatus((s) => (s === "connecting" ? "waiting" : s));
    });
    es.addEventListener("line", (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data);
        if (msg.type === "snapshot") {
          setSnap(msg);
          setLastAt(Date.now());
          setStatus("live");
        }
      } catch {}
    });
    es.onerror = () => setStatus("error");
    es.onopen = () => setStatus((s) => (s === "error" || s === "connecting" ? "waiting" : s));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { es.close(); clearInterval(tick); };
  }, []);

  // Freshness comes from the watcher's timestamp: the stream replays the last snapshot on connect
  const ageMs = snap?.t ? now - snap.t * 1000 : lastAt ? now - lastAt : null;
  const effective: Status = status === "live" && ageMs != null && ageMs > STALE_MS ? "stale" : status;
  const leaves = useMemo(() => (snap ? numericLeaves(snap.data) : []), [snap]);
  const shown = leaves.filter(([k]) => k.toLowerCase().includes(filter.toLowerCase())).slice(0, 60);

  const label = {
    connecting: "Connecting…",
    waiting: session ? "Session found — waiting for game data" : "Waiting for the game (no watcher session yet)",
    live: "Live",
    stale: `Last update ${ageMs != null ? (ageMs < 90000 ? `${Math.round(ageMs / 1000)}s` : `${Math.round(ageMs / 60000)}m`) : "?"} ago — game closed or loading?`,
    error: "Dashboard stream disconnected — retrying",
  }[effective];

  return (
    <div className="chart" aria-live="polite">
      <div className="live-head">
        <h2 className="section-title" style={{ margin: 0 }}>
          <span className={`live-dot ${effective === "live" ? "on" : effective === "stale" ? "stale" : ""}`} aria-hidden />
          Live game feed
        </h2>
        <span className="secondary">
          {label}
          {snap && ` · snapshot #${snap.seq}`}
        </span>
      </div>

      {snap ? (
        <>
          <label className="secondary" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Filter fields
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ font: "inherit", padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            />
            <span className="muted">{leaves.length} numeric fields in last snapshot</span>
          </label>
          <div className="table-wrap table-scroll">
            <table className="data-table">
              <thead><tr><th>Field</th><th className="num">Value</th></tr></thead>
              <tbody>
                {shown.map(([k, v]) => (
                  <tr key={k}><td><code>{k}</code></td><td className="num">{Number.isInteger(v) ? v : v.toFixed(3)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="empty">
          Start The Crust with UE4SS installed and load a save. The CrustWatcher mod writes a snapshot every 2 seconds; press <code>F8</code> in-game for a full field dump.
        </p>
      )}
    </div>
  );
}
