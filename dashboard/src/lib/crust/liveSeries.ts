// Session time series for the LIVE view, built incrementally from the watcher's NDJSON log.
// Each poll reads only the bytes appended since the last one, so polling stays cheap as the file grows.
import path from "node:path";
import { stat } from "node:fs/promises";
import { newestSessionFile, readRange } from "./live";

export type SessionPoint = { t: number; g: number | null; credits: number | null; paused: boolean };
export type PricePoint = { t: number; g: number | null; sell: number | null; buy: number | null; supply: number | null };
export type LiveSeries = {
  file: string | null;
  slot: string | null;
  points: SessionPoint[];
  /** Every resource with recorded prices. */
  names: string[];
  /** The resource whose prices are included (the first requested one that exists, else the first available). */
  selected: string | null;
  prices: Record<string, PricePoint[]>;
};

type LotEntry = { key: { Name: string }; value: number };
type SnapshotLine = {
  type?: string;
  t?: number;
  slot?: string;
  data?: {
    game?: { GameSpeed?: number; inGameTime?: { year: number; month: number; day: number; hour: number; minute: number } | null };
    credits?: { value?: number | null };
    markets?: { CurrentPricesToSell?: LotEntry[]; CurrentPricesToBuy?: LotEntry[]; CurrentMarketVolume?: LotEntry[]; BaseMarketVolume?: LotEntry[] }[];
  };
};

type Cache = {
  file: string;
  offset: number;
  partial: string;
  slot: string | null;
  points: SessionPoint[];
  prices: Map<string, PricePoint[]>;
  baseVolume: Map<string, number>;
};

const MAX_POINTS = 20000; // ~11 hours at one snapshot every 2 s
const CHUNK = 8 * 1024 * 1024;
const store = globalThis as typeof globalThis & { __crustSeries?: Cache; __crustSeriesLock?: Promise<unknown> };

const byName = (entries?: LotEntry[]) => new Map((entries ?? []).map((e) => [e.key.Name, e.value]));
const trim = <T,>(arr: T[]) => {
  if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
};

function ingest(cache: Cache, line: string) {
  if (!line.startsWith("{")) return;
  let msg: SnapshotLine;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type === "session_info" && msg.slot) cache.slot = msg.slot;
  if (msg.type !== "snapshot" || !msg.data) return;

  const d = msg.data;
  const t = msg.t ?? 0;
  const it = d.game?.inGameTime;
  const g = it && it.year > 1 ? Date.UTC(it.year, it.month - 1, it.day, it.hour, it.minute) : null;
  cache.points.push({ t, g, credits: d.credits?.value ?? null, paused: d.game?.GameSpeed === 0 });
  trim(cache.points);

  const m = d.markets?.[0];
  if (!m) return;
  for (const [name, v] of byName(m.BaseMarketVolume)) cache.baseVolume.set(name, v);
  const sell = byName(m.CurrentPricesToSell);
  const buy = byName(m.CurrentPricesToBuy);
  const vol = byName(m.CurrentMarketVolume);
  for (const name of new Set([...sell.keys(), ...buy.keys(), ...vol.keys()])) {
    let arr = cache.prices.get(name);
    if (!arr) cache.prices.set(name, (arr = []));
    const base = cache.baseVolume.get(name);
    const v = vol.get(name);
    arr.push({ t, g, sell: sell.get(name) ?? null, buy: buy.get(name) ?? null, supply: base && v != null ? v / base : null });
    trim(arr);
  }
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 1; i <= max; i++) out.push(arr[Math.min(arr.length - 1, Math.round(i * step) - 1)]);
  return out;
}

async function update(): Promise<Cache | null> {
  const file = await newestSessionFile();
  if (!file) return null;
  const size = (await stat(file)).size;
  let cache = store.__crustSeries;
  if (!cache || cache.file !== file || size < cache.offset) {
    cache = { file, offset: 0, partial: "", slot: null, points: [], prices: new Map(), baseVolume: new Map() };
    store.__crustSeries = cache;
  }
  while (cache.offset < size) {
    const end = Math.min(size, cache.offset + CHUNK);
    const text = cache.partial + (await readRange(file, cache.offset, end)).toString("utf8");
    cache.offset = end;
    const lines = text.split("\n");
    cache.partial = lines.pop() ?? "";
    for (const line of lines) ingest(cache, line);
  }
  return cache;
}

/**
 * Latest session series, downsampled to at most `maxPoints` per series. Prices are included only for the requested
 * resources (all 27 made each 10-second poll ~780 KB). Concurrent callers share one update.
 */
export async function readLiveSeries(maxPoints = 360, wanted: string[] = []): Promise<LiveSeries> {
  const run = (store.__crustSeriesLock ?? Promise.resolve()).then(update, update);
  store.__crustSeriesLock = run;
  const cache = await run;
  if (!cache) return { file: null, slot: null, points: [], names: [], selected: null, prices: {} };
  const names = [...cache.prices.keys()].sort();
  const picked = wanted.filter((n) => cache.prices.has(n));
  if (!picked.length && names.length) picked.push(names[0]);
  return {
    file: path.basename(cache.file),
    slot: cache.slot,
    points: downsample(cache.points, maxPoints),
    names,
    selected: picked[0] ?? null,
    prices: Object.fromEntries(picked.map((name) => [name, downsample(cache.prices.get(name) ?? [], maxPoints)])),
  };
}
