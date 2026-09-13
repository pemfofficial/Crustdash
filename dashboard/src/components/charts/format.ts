const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDpFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export const compact = (n: number) => (Math.abs(n) < 10000 ? intFmt.format(n) : compactFmt.format(n));
export const integer = (n: number) => intFmt.format(n);
export const oneDp = (n: number) => oneDpFmt.format(n);
export const signed = (n: number, f: (n: number) => string = compact) => (n > 0 ? "+" : n < 0 ? "−" : "") + f(Math.abs(n));
export const percent = (n: number) => `${oneDpFmt.format(n * 100)}%`;

// In-game dates are year 2080+; always render in UTC so the calendar day matches the save.
export const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const monthLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
export const fullDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
export const shortDateTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
export const longDateTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

/** "Nice" axis ticks (1/2/2.5/5 × 10^k steps). The first tick is ≤ min and the last tick is ≥ max. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  // Previously the loop stopped at max + step/2, so a max just above a tick (85 over 80) fell off the axis
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/** A ratio as a signed percentage: 0.12 -> "+12%", -0.08 -> "−8%"; "—" when missing. */
export function signedPercent(ratio: number | null): string {
  if (ratio == null) return "—";
  return `${ratio > 0 ? "+" : ratio < 0 ? "−" : ""}${Math.abs(Math.round(ratio * 100))}%`;
}

type GameClock = { year: number; month: number; day: number; hour: number; minute: number };
const twoDigits = (n: number) => String(n).padStart(2, "0");

/** In-game date, e.g. "Mar 27, 2080". */
export const formatGameDate = (t: GameClock) =>
  new Date(Date.UTC(t.year, t.month - 1, t.day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** In-game time of day, e.g. "13:33". */
export const formatGameClock = (t: GameClock) => `${twoDigits(t.hour)}:${twoDigits(t.minute)}`;

/** Compact in-game timestamp for the status bar, e.g. "2080-03-27 13:33". */
export const formatGameStamp = (t: GameClock) => `${t.year}-${twoDigits(t.month)}-${twoDigits(t.day)} ${formatGameClock(t)}`;
