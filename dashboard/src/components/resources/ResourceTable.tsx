"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AlertEditor } from "@/components/alerts/AlertEditor";
import { Sparkline } from "@/components/charts/Figures";
import { LineChart } from "@/components/charts/LineChart";
import { compact, integer, oneDp, signed } from "@/components/charts/format";
import { useLive } from "@/components/live/LiveProvider";
import { FOCUS_RESOURCE_EVENT, usePrefs } from "@/components/live/PrefsProvider";
import { useMarketRows, useResourceLabel } from "@/components/live/useMarketRows";
import { Fact } from "@/components/ui/Fact";
import { InfoTip } from "@/components/ui/InfoTip";
import type { AlertSubject } from "@/lib/crust/alerts";
import type { ResourceRow } from "@/lib/crust/insights";
import type { TopicId } from "@/lib/crust/topics";
import { WikiFact } from "@/components/wiki/WikiFact";
import { PinModal } from "./PinModal";

type SortKey = "label" | "held" | "change" | "sell" | "buy" | "vsBase" | "range" | "supply" | "worth";
type View = "all" | "tradable" | "held" | "pinned";

type Row = {
  name: string;
  label: string;
  tradable: boolean;
  held: number | null;
  change: number | null;
  perDay: number | null;
  pattern: ResourceRow["pattern"] | null;
  stockSpark: number[];
  sell: number | null;
  buy: number | null;
  vsBase: number | null;
  range: number | null;
  supply: number | null;
  worth: number | null;
  base: number | null;
  bandMin: number | null;
  bandMax: number | null;
  sellHistory: number[];
  buyHistory: number[];
};

const DAY = 86400000;
const VIEW_TEXT: Record<View, string> = { all: "All", tradable: "Tradable", held: "Held", pinned: "Pinned" };
const PATTERN_TEXT: Record<ResourceRow["pattern"], string> = { accumulating: "Only growing", depleting: "Only falling", steady: "Unchanged", mixed: "In use" };

const COLUMNS: { key: SortKey | null; label: string; num?: boolean; topic?: TopicId }[] = [
  { key: "label", label: "Resource", topic: "resources" },
  { key: "held", label: "You hold", num: true, topic: "holdings" },
  { key: "change", label: "Change", num: true },
  { key: null, label: "Stock trend" },
  { key: "sell", label: "Sell", num: true, topic: "sellPrice" },
  { key: "buy", label: "Buy", num: true, topic: "buyPrice" },
  { key: "vsBase", label: "vs base", num: true, topic: "basePrice" },
  { key: null, label: "30-day sell" },
  { key: "range", label: "30-day range", topic: "range30" },
  { key: "supply", label: "Supply", num: true, topic: "marketSupply" },
  { key: "worth", label: "Worth", num: true, topic: "stockValue" },
];

const vsBaseText = (x: number | null) =>
  x == null ? "—" : `${x > 0.005 ? "▲ +" : x < -0.005 ? "▼ −" : "■ "}${Math.abs(Math.round(x * 100))}%`;

function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6v-5a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z" />
    </svg>
  );
}

type Props = {
  saveRows: ResourceRow[];
  holdings: Record<string, number>;
  holdingsSource: "live" | "save";
  rangeLabel: string;
  lastDay: number | null;
};

/** One table for every resource: holdings and trend from saves, prices and market position live. */
export function ResourceTable({ saveRows, holdings, holdingsSource, rangeLabel, lastDay }: Props) {
  const live = useLive();
  const market = useMarketRows(holdings);
  const labelOf = useResourceLabel();
  const { pins, alerts } = usePrefs();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "worth", dir: "desc" });
  const [selected, setSelected] = useState<string | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);
  const [alerting, setAlerting] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const byName = new Map<string, Row>();
    const blank = (name: string, label: string): Row => ({
      name,
      label,
      tradable: false,
      held: holdings[name] ?? null,
      change: null,
      perDay: null,
      pattern: null,
      stockSpark: [],
      sell: null,
      buy: null,
      vsBase: null,
      range: null,
      supply: null,
      worth: null,
      base: null,
      bandMin: null,
      bandMax: null,
      sellHistory: [],
      buyHistory: [],
    });
    for (const s of saveRows) {
      byName.set(s.name, { ...blank(s.name, labelOf(s.name)), held: holdings[s.name] ?? s.now, change: s.change, perDay: s.perDay, pattern: s.pattern, stockSpark: s.spark });
    }
    for (const m of market) {
      const r = byName.get(m.name) ?? blank(m.name, m.label);
      byName.set(m.name, {
        ...r,
        label: m.label,
        tradable: true,
        sell: m.sell,
        buy: m.buy,
        vsBase: m.base ? m.vsBase : null,
        range: m.sellRangePos,
        supply: m.baseVolume ? m.volumeRatio : null,
        worth: m.sell != null && r.held != null ? r.held * m.sell : null,
        base: m.base || null,
        bandMin: m.bandMin || null,
        bandMax: m.bandMax || null,
        sellHistory: m.sellHistory,
        buyHistory: m.buyHistory,
      });
    }
    return [...byName.values()].filter((r) => r.name !== "None");
  }, [saveRows, market, holdings, labelOf]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (!q || r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) &&
        (view === "all" || (view === "tradable" && r.tradable) || (view === "held" && (r.held ?? 0) > 0) || (view === "pinned" && Boolean(pins[r.name]))),
    );
    const value = (r: Row): number | string | null => (sort.key === "label" ? r.label : r[sort.key]);
    const compare = (a: Row, b: Row) => {
      const va = value(a);
      const vb = value(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // missing values always sink, whatever the direction
      if (vb == null) return -1;
      const d = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sort.dir === "asc" ? d : -d;
    };
    return [...list].sort((a, b) => (pins[b.name] ? 1 : 0) - (pins[a.name] ? 1 : 0) || compare(a, b));
  }, [rows, query, view, sort, pins]);

  useEffect(() => {
    const onFocus = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      if (!rows.some((r) => r.name === name)) return;
      setQuery("");
      setView("all");
      setSelected(name);
      setFlash(name);
      // Give the module switch (hash change) time to show this table before scrolling to the row
      window.setTimeout(() => document.getElementById(`res-${name}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
      window.setTimeout(() => setFlash((current) => (current === name ? null : current)), 3400);
    };
    window.addEventListener(FOCUS_RESOURCE_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_RESOURCE_EVENT, onFocus);
  }, [rows]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "label" ? "asc" : "desc" }));

  const selectedRow =
    rows.find((r) => r.name === selected && r.sellHistory.length > 1) ?? visible.find((r) => r.sellHistory.length > 1) ?? null;
  const t = live.inGameTime;
  const today = t ? Date.UTC(t.year, t.month - 1, t.day) : lastDay;
  const historyLen = selectedRow ? Math.max(selectedRow.sellHistory.length, selectedRow.buyHistory.length) : 0;
  const historyX = today != null ? Array.from({ length: historyLen }, (_, i) => today - (historyLen - 1 - i) * DAY) : [];
  const pad = (arr: number[]) => Array.from({ length: historyLen }, (_, i) => arr[i - (historyLen - arr.length)] ?? null);

  const subjectOf = (r: Row): AlertSubject => ({
    name: r.name,
    label: r.label,
    sell: r.sell,
    buy: r.buy,
    vsBase: r.vsBase,
    sellRangePos: r.range,
    volumeRatio: r.supply,
    held: r.held,
    heldValue: r.worth,
    heldSource: holdingsSource,
  });
  const pinningRow = rows.find((r) => r.name === pinning);
  const alertingRow = rows.find((r) => r.name === alerting);

  return (
    <>
      <div className="res-toolbar">
        <input type="search" className="text-input" placeholder="Filter resources…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter resources by name" />
        <div className="segmented" role="radiogroup" aria-label="Which resources to show">
          {(Object.keys(VIEW_TEXT) as View[]).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} className="seg-btn" onClick={() => setView(v)}>
              {VIEW_TEXT[v]}
            </button>
          ))}
        </div>
        <span className="muted">
          {visible.length} of {rows.length} · holdings {holdingsSource === "live" ? "live from the game" : "from your last save"} · change over {rangeLabel}
          {!live.market && " · prices appear while the game runs"}
        </span>
      </div>

      <div className="table-wrap">
        <table className="data-table resource-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = c.key != null && sort.key === c.key;
                return (
                  <th key={c.label} className={c.num ? "num" : undefined} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    <span className="th-inner">
                      {c.key ? (
                        <button type="button" className="sort-btn" onClick={() => toggleSort(c.key!)}>
                          {c.label}
                          <span className="sort-arrow" aria-hidden>{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                        </button>
                      ) : (
                        c.label
                      )}
                      {c.topic && <InfoTip topic={c.topic} label={c.label} />}
                    </span>
                  </th>
                );
              })}
              <th>
                <span className="sr-only">Pin and alerts</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const pin = pins[r.name];
              const alertCount = alerts.filter((a) => a.target === r.name && a.enabled).length;
              const classes = [pin ? "pinned" : "", selectedRow?.name === r.name ? "row-selected" : "", flash === r.name ? "flash" : ""].filter(Boolean).join(" ");
              return (
                <tr key={r.name} id={`res-${r.name}`} className={classes || undefined} style={pin ? ({ ["--pin" as string]: pin } as CSSProperties) : undefined}>
                  <td>
                    <button type="button" className="link-btn" onClick={() => setSelected(r.name)} aria-pressed={selectedRow?.name === r.name}>
                      {r.label}
                    </button>
                    {!r.tradable && <span className="cell-sub">{live.market ? "Not on the market" : "Market offline"}</span>}
                  </td>
                  <td className="num">{r.held == null ? "—" : integer(r.held)}</td>
                  <td className="num">
                    {r.change == null ? "—" : signed(r.change, integer)}
                    {r.perDay != null && r.perDay !== 0 && <span className="cell-sub">{signed(r.perDay, oneDp)}/day</span>}
                  </td>
                  <td>
                    {r.stockSpark.length > 1 ? <Sparkline values={r.stockSpark} /> : <span className="muted">—</span>}
                    {r.pattern && <span className="cell-sub">{PATTERN_TEXT[r.pattern]}</span>}
                  </td>
                  <td className="num">{r.sell == null ? "—" : integer(r.sell)}</td>
                  <td className="num">{r.buy == null ? "—" : integer(r.buy)}</td>
                  <td className="num">{vsBaseText(r.vsBase)}</td>
                  <td>{r.sellHistory.length > 1 ? <Sparkline values={r.sellHistory} /> : <span className="muted">—</span>}</td>
                  <td>
                    {r.range == null ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className="range" role="img" aria-label={`${Math.round(r.range * 100)}% of the way from the 30-day low to the high`} title={`${Math.round(r.range * 100)}% of the way from the 30-day low to the high`}>
                        <span className="range-dot" style={{ left: `${r.range * 100}%` }} />
                      </span>
                    )}
                  </td>
                  <td className="num">{r.supply == null ? "—" : `${Math.round(r.supply * 100)}%`}</td>
                  <td className="num">{r.worth == null ? "—" : compact(r.worth)}</td>
                  <td>
                    {/* Flex lives on a wrapper: a flex <td> stops behaving like a table cell */}
                    <div className="row-actions">
                    <button type="button" className="icon-btn" aria-pressed={Boolean(pin)} aria-label={pin ? `${r.label} is pinned: change color or unpin` : `Pin ${r.label}`} title={pin ? "Pinned: change color or unpin" : "Pin to top"} onClick={() => setPinning(r.name)}>
                      <span aria-hidden style={pin ? { color: pin } : undefined}>{pin ? "★" : "☆"}</span>
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Alerts for ${r.label}${alertCount ? ` (${alertCount} on)` : ""}`} title="Set an alert" onClick={() => setAlerting(r.name)}>
                      <BellIcon />
                      {alertCount > 0 && <span className="badge-count">{alertCount}</span>}
                    </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedRow && historyLen > 1 && historyX.length ? (
        <div className="resource-detail">
          <LineChart
            title={`${selectedRow.label}: 30-day prices`}
            subtitle="Daily sell and buy price. Click a resource name above to switch."
            x={historyX}
            series={[
              { key: "sell", label: "Sell price", slot: 1, values: pad(selectedRow.sellHistory) },
              { key: "buy", label: "Buy price", slot: 2, values: pad(selectedRow.buyHistory) },
            ]}
            zeroBaseline={false}
            yFormat="integer"
          />
          <dl className="fact-grid detail-facts">
            <Fact label="Base price" value={selectedRow.base == null ? "—" : integer(selectedRow.base)} topic="basePrice" />
            <Fact
              label="Price band"
              value={selectedRow.bandMin == null || selectedRow.bandMax == null ? "—" : `${integer(selectedRow.bandMin)}–${integer(selectedRow.bandMax)}`}
              sub="the lowest and highest the price can go"
            />
            <Fact label="30-day sell low / high" value={`${integer(Math.min(...selectedRow.sellHistory))} / ${integer(Math.max(...selectedRow.sellHistory))}`} topic="range30" />
            <Fact label="Market supply" value={selectedRow.supply == null ? "—" : `${Math.round(selectedRow.supply * 100)}% of normal`} topic="marketSupply" />
            <Fact label="Your stock" value={selectedRow.held == null ? "—" : integer(selectedRow.held)} sub={selectedRow.worth == null ? undefined : `≈ ${compact(selectedRow.worth)} at today’s sell price`} topic="stockValue" />
            <WikiFact resourceKey={selectedRow.name} label={selectedRow.label} />
          </dl>
        </div>
      ) : (
        <p className="empty">{live.market ? "Price history arrives with the next full market read (about every 30 seconds)." : "Price charts appear while the game runs."}</p>
      )}

      {pinningRow && <PinModal name={pinningRow.name} label={pinningRow.label} onClose={() => setPinning(null)} />}
      {alertingRow && (
        <AlertEditor target={alertingRow.name} label={alertingRow.label} subject={subjectOf(alertingRow)} credits={live.credits} onClose={() => setAlerting(null)} />
      )}
    </>
  );
}
