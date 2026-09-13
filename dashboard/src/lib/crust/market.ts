// Parses CrustWatcher market snapshots into per-resource rows and live market findings.
// Client-safe: no node imports (don't import stats.ts / resources.ts here).
//
// Observed market model (HealthlyMarketInstance_C):
//   sell = floor(CurrentPrices), buy = CurrentPrices × BasePricePercentage (markup)
//   price is clamped to BasePrices × [MarketMaxPriceNegativeDeviation, MarketMaxPricePositiveDeviation]
//   low CurrentMarketVolume (supply) ↔ higher price; MarketVolumeBuffer = 2 × BaseMarketVolume − CurrentMarketVolume
//   Selling/BuyingPriceHistory: EResourceType id → FloatArr of 30 daily prices, oldest first (verified by day shifts)
// In-game text (Online Market): "the more of a certain type of resource you put on the market, the lower its price will be."
import type { Insight } from "./types";

export type Lot = { LOTType: number; Name: string; Id: number };
type LotEntry = { key: Lot; value: number };
export type FloatArr = { FloatArr: number[] };

export type RawMarket = {
  ResourcesToSell?: number[];
  ResourcesToBuy?: number[];
  CurrentPricesToSell?: LotEntry[];
  CurrentPricesToBuy?: LotEntry[];
  CurrentPrices?: LotEntry[];
  BasePrices?: LotEntry[];
  BaseMarketVolume?: LotEntry[];
  CurrentMarketVolume?: LotEntry[];
  MarketVolumeBuffer?: LotEntry[];
  MarketMaxPricePositiveDeviation?: LotEntry[];
  MarketMaxPriceNegativeDeviation?: LotEntry[];
  SellingPriceHistory?: Record<string, FloatArr>;
  BuyingPriceHistory?: Record<string, FloatArr>;
};

export type GameTime = { year: number; month: number; day: number; hour: number; minute: number };

export type SnapshotData = {
  markets?: RawMarket[];
  game?: { GameSpeed?: number; GameSpeedState?: number; CreditsAtMonthStart?: number; inGameTime?: GameTime | null };
  credits?: { value?: number | null; base?: number | null };
  stats?: { ModuleCounts?: Record<string, number> };
};

export type MarketRow = {
  name: string;
  id: number | null;
  label: string;
  base: number;
  current: number;
  sell: number | null;
  buy: number | null;
  vsBase: number;
  bandMin: number;
  bandMax: number;
  volume: number;
  baseVolume: number;
  volumeRatio: number;
  headroom: number;
  sellHistory: number[];
  buyHistory: number[];
  sellRangePos: number | null;
  buyRangePos: number | null;
  sellHigh30: number | null;
  sellLow30: number | null;
  buyAvg30: number | null;
  held: number;
  heldValue: number;
};

const byName = (entries?: LotEntry[]) => new Map((entries ?? []).map((e) => [e.key.Name, e.value]));
export const camelLabel = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");

function rangePos(value: number | null, series: number[]): number | null {
  if (value == null || series.length < 2) return null;
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  return hi === lo ? 0.5 : Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
}

export function buildMarketRows(
  market: RawMarket,
  history: RawMarket | null,
  opts: { enumNames: Record<string, string>; displayNames?: Record<string, string>; holdings?: Record<string, number> },
): MarketRow[] {
  const nameToId = new Map<string, number>();
  for (const [id, n] of Object.entries(opts.enumNames)) nameToId.set(n.replace(/^EResourceType::/, ""), Number(id));

  const base = byName(market.BasePrices);
  const cur = byName(market.CurrentPrices);
  const sell = byName(market.CurrentPricesToSell);
  const buy = byName(market.CurrentPricesToBuy);
  const vol = byName(market.CurrentMarketVolume);
  const baseVol = byName(market.BaseMarketVolume);
  const buffer = byName(market.MarketVolumeBuffer);
  const hi = byName(market.MarketMaxPricePositiveDeviation);
  const lo = byName(market.MarketMaxPriceNegativeDeviation);

  const names = [...new Set([...base.keys(), ...sell.keys(), ...buy.keys()])];
  return names
    .map((name): MarketRow => {
      const id = nameToId.get(name) ?? null;
      const b = base.get(name) ?? 0;
      const c = cur.get(name) ?? b;
      const s = sell.has(name) ? sell.get(name)! : null;
      const bu = buy.has(name) ? buy.get(name)! : null;
      const sellHistory = id != null ? history?.SellingPriceHistory?.[String(id)]?.FloatArr ?? [] : [];
      const buyHistory = id != null ? history?.BuyingPriceHistory?.[String(id)]?.FloatArr ?? [] : [];
      const v = vol.get(name) ?? 0;
      const bv = baseVol.get(name) ?? 0;
      const held = opts.holdings?.[name] ?? 0;
      const display = id != null ? opts.displayNames?.[String(id)] : undefined;
      return {
        name,
        id,
        label: display || camelLabel(name),
        base: b,
        current: c,
        sell: s,
        buy: bu,
        vsBase: b ? c / b - 1 : 0,
        bandMin: b * (lo.get(name) ?? 1),
        bandMax: b * (hi.get(name) ?? 1),
        volume: v,
        baseVolume: bv,
        volumeRatio: bv ? v / bv : 0,
        headroom: buffer.get(name) ?? Math.max(0, bv * 2 - v),
        sellHistory,
        buyHistory,
        sellRangePos: rangePos(s, sellHistory),
        buyRangePos: rangePos(bu, buyHistory),
        sellHigh30: sellHistory.length ? Math.max(...sellHistory) : null,
        sellLow30: sellHistory.length ? Math.min(...sellHistory) : null,
        buyAvg30: buyHistory.length ? buyHistory.reduce((t, x) => t + x, 0) / buyHistory.length : null,
        held,
        heldValue: s != null ? held * s : 0,
      };
    })
    .sort((a, b) => b.heldValue - a.heldValue || a.label.localeCompare(b.label));
}

const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const f = (n: number) => n0.format(Math.round(n));
const pct = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x * 100))}%`;
const MARKET_SOURCE = "Live market data; in-game Online Market description (“the more of a resource you put on the market, the lower its price”).";

/** Live market findings: when to sell, when to wait, when selling everything would flood the market, what's cheap. */
export function marketInsights(rows: MarketRow[]): Insight[] {
  const out: Insight[] = [];
  // Ignore holdings too small to matter (< 2% of the stockpile's value) so findings stay about real money
  const stockValue = rows.reduce((s, r) => s + r.heldValue, 0);
  const held = rows.filter((r) => r.sell != null && r.held > 0 && r.heldValue >= stockValue * 0.02);

  for (const r of held
    .filter((r) => (r.sellRangePos ?? 0) >= 0.8 || r.vsBase >= 0.1)
    .sort((a, b) => b.heldValue - a.heldValue)
    .slice(0, 3)) {
    const reasons = [
      ...(r.vsBase >= 0.1 ? [`**${pct(r.vsBase)}** over its ==base price==`] : []),
      ...(r.sellRangePos != null && r.sellRangePos >= 0.8 ? [`in the **top ${Math.max(1, Math.round((1 - r.sellRangePos) * 100))}%** of its 30-day range`] : []),
    ];
    out.push({
      id: `sell-${r.name}`,
      level: "good",
      area: "market",
      topic: "sellPrice",
      title: `Good time to sell **${r.label}**`,
      figures: [
        { label: "Sell price", value: f(r.sell!) },
        { label: "vs base", value: pct(r.vsBase), tone: r.vsBase >= 0 ? "good" : "bad" },
        ...(r.sellHigh30 != null ? [{ label: "30-day high", value: f(r.sellHigh30) }] : []),
        { label: "Your stock", value: `${f(r.held)} ≈ ${f(r.heldValue)} cr` },
      ],
      detail: `It sells ${reasons.join(" and ")}. Market supply is at **${Math.round(r.volumeRatio * 100)}%** of normal.`,
      actions: [
        "Sell in batches: _each unit you sell adds supply and lowers the price_.",
        "Set a ==sell price drops to== alert to catch the turn.",
      ],
      source: MARKET_SOURCE,
      subjects: [r.name],
    });
  }

  for (const r of held
    .filter((r) => r.sellRangePos != null && r.sellRangePos <= 0.2 && r.vsBase <= -0.05)
    .sort((a, b) => b.heldValue - a.heldValue)
    .slice(0, 2)) {
    out.push({
      id: `wait-${r.name}`,
      level: "info",
      area: "market",
      topic: "range30",
      title: `**${r.label}** is near its 30-day low`,
      figures: [
        { label: "Sell price", value: f(r.sell!) },
        { label: "vs base", value: pct(r.vsBase), tone: "bad" },
        ...(r.sellHigh30 != null ? [{ label: "30-day high", value: f(r.sellHigh30) }] : []),
        { label: "Your stock", value: f(r.held) },
      ],
      detail: `Selling now gets **${f(r.sell!)}** a unit; it sold for up to **${f(r.sellHigh30 ?? r.sell!)}** in the last 30 days.`,
      actions: ["_If you can wait_, hold it and set a ==sell price rises to== alert."],
      source: "Live market data (30-day price history).",
      subjects: [r.name],
    });
  }

  for (const r of held.filter((r) => r.held > r.headroom && r.headroom > 0).sort((a, b) => b.heldValue - a.heldValue).slice(0, 2)) {
    out.push({
      id: `flood-${r.name}`,
      level: "warning",
      area: "market",
      topic: "marketSupply",
      title: `Selling all your **${r.label}** at once would flood the market`,
      figures: [
        { label: "You hold", value: f(r.held) },
        { label: "Room before supply maxes out", value: f(r.headroom) },
        { label: "Price floor", value: f(r.bandMin) },
      ],
      detail: `The market can take about **${f(r.headroom)}** more before supply hits its maximum. _More supply pushes the price toward its floor_ of **${f(r.bandMin)}**.`,
      actions: ["Sell in smaller batches and let supply recover between them."],
      source: MARKET_SOURCE,
      subjects: [r.name],
    });
  }

  const scarce = rows
    .filter((r) => r.sell != null && r.baseVolume > 0 && r.volumeRatio <= 0.5 && r.vsBase >= 0.05)
    .sort((a, b) => a.volumeRatio - b.volumeRatio)
    .slice(0, 3);
  if (scarce.length) {
    out.push({
      id: "scarce",
      level: "info",
      area: "market",
      topic: "marketSupply",
      title: `Short supply, higher prices: ${scarce.map((r) => `**${r.label}**`).join(", ")}`,
      figures: scarce.map((r) => ({ label: r.label, value: `${Math.round(r.volumeRatio * 100)}% supply · ${pct(r.vsBase)}` })),
      detail: "These markets hold less than half their normal supply, and they sell above base.",
      actions: ["If you can produce them, this is when selling pays most."],
      source: MARKET_SOURCE,
      subjects: scarce.map((r) => r.name),
    });
  }

  const cheap = rows
    .filter((r) => r.buy != null && r.buyRangePos != null && r.buyRangePos <= 0.15 && r.buyAvg30 != null && r.buy < r.buyAvg30)
    .sort((a, b) => a.buy! / a.buyAvg30! - b.buy! / b.buyAvg30!)
    .slice(0, 3);
  if (cheap.length) {
    out.push({
      id: "cheap",
      level: "info",
      area: "market",
      topic: "buyPrice",
      title: `Cheap to buy right now: ${cheap.map((r) => `**${r.label}**`).join(", ")}`,
      figures: cheap.map((r) => ({ label: r.label, value: `${f(r.buy!)} (avg ${f(r.buyAvg30!)})`, tone: "good" as const })),
      detail: "Each is near the bottom of its 30-day buy-price range.",
      actions: ["Stock up if you’ll need them for production or contracts."],
      source: "Live market data (30-day price history).",
      subjects: cheap.map((r) => r.name),
    });
  }

  return out;
}
