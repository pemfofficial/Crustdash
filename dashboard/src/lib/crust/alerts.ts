// Custom alerts: what can be watched, how a rule is evaluated against live data, and how it reads.
// Client-safe (no node imports).

export type AlertKind =
  | "sellAbove"
  | "sellBelow"
  | "buyBelow"
  | "buyAbove"
  | "vsBaseAbove"
  | "vsBaseBelow"
  | "near30High"
  | "near30Low"
  | "supplyBelow"
  | "supplyAbove"
  | "holdAbove"
  | "holdBelow"
  | "worthAbove"
  | "creditsBelow"
  | "creditsAbove";

export type Unit = "credits" | "percent" | "units";

/** Live values for one resource, as alerts see them. */
export type AlertSubject = {
  name: string;
  label: string;
  sell: number | null;
  buy: number | null;
  vsBase: number | null;
  sellRangePos: number | null;
  volumeRatio: number | null;
  held: number | null;
  heldValue: number | null;
  /** Where holdings come from: the live game or the last save. */
  heldSource: "live" | "save" | null;
};

export type AlertRule = {
  id: string;
  kind: AlertKind;
  /** Resource name (e.g. "TitanPlate") or CREDITS_TARGET. */
  target: string;
  threshold: number;
  /** true: fire every time the condition becomes true again. false: fire once, then switch off. */
  repeat: boolean;
  enabled: boolean;
  /** Ready to fire; cleared on firing and restored once the condition is false again. */
  armed: boolean;
  createdAt: number;
  lastFiredAt: number | null;
  firedCount: number;
};

export type AlertKindDef = {
  kind: AlertKind;
  label: string;
  short: string;
  unit: Unit;
  scope: "resource" | "credits";
  hint: string;
  suggest: (s: AlertSubject | null, credits: number | null) => number;
};

export const CREDITS_TARGET = "__credits";

const r = (n: number) => Math.max(0, Math.round(n));

export const ALERT_GROUPS: { id: string; label: string; blurb: string; kinds: AlertKindDef[] }[] = [
  {
    id: "price",
    label: "Price",
    blurb: "The live price on the Online Market.",
    kinds: [
      { kind: "sellAbove", label: "Sell price rises to", short: "Sell ≥", unit: "credits", scope: "resource", hint: "Know when it’s worth selling.", suggest: (s) => r((s?.sell ?? 0) * 1.1) },
      { kind: "sellBelow", label: "Sell price drops to", short: "Sell ≤", unit: "credits", scope: "resource", hint: "Know when selling stops paying.", suggest: (s) => r((s?.sell ?? 0) * 0.9) },
      { kind: "buyBelow", label: "Buy price drops to", short: "Buy ≤", unit: "credits", scope: "resource", hint: "Restock when it’s cheap.", suggest: (s) => r((s?.buy ?? 0) * 0.9) },
      { kind: "buyAbove", label: "Buy price rises to", short: "Buy ≥", unit: "credits", scope: "resource", hint: "Know when buying gets expensive.", suggest: (s) => r((s?.buy ?? 0) * 1.1) },
    ],
  },
  {
    id: "position",
    label: "Market position",
    blurb: "Where the price sits compared with its base price, its last 30 days, and market supply.",
    kinds: [
      { kind: "vsBaseAbove", label: "Price is above base by at least", short: "vs base ≥", unit: "percent", scope: "resource", hint: "Base price is the market’s normal price for this resource.", suggest: () => 10 },
      { kind: "vsBaseBelow", label: "Price is below base by at least", short: "vs base ≤", unit: "percent", scope: "resource", hint: "Enter 10 for “10% below base”.", suggest: () => 10 },
      { kind: "near30High", label: "Sell price is near its 30-day high (position ≥)", short: "30-day range ≥", unit: "percent", scope: "resource", hint: "90 = in the top 10% of the last 30 days’ prices.", suggest: () => 90 },
      { kind: "near30Low", label: "Sell price is near its 30-day low (position ≤)", short: "30-day range ≤", unit: "percent", scope: "resource", hint: "10 = in the bottom 10% of the last 30 days’ prices.", suggest: () => 10 },
      { kind: "supplyBelow", label: "Market supply falls to (% of normal)", short: "Supply ≤", unit: "percent", scope: "resource", hint: "On the market, low supply comes with higher prices.", suggest: () => 50 },
      { kind: "supplyAbove", label: "Market supply rises to (% of normal)", short: "Supply ≥", unit: "percent", scope: "resource", hint: "High supply comes with lower prices.", suggest: () => 150 },
    ],
  },
  {
    id: "inventory",
    label: "Inventory & value",
    blurb: "How much you hold and what it would sell for.",
    kinds: [
      { kind: "holdAbove", label: "You hold at least", short: "Hold ≥", unit: "units", scope: "resource", hint: "Useful for “tell me when I have enough to sell or fill a contract”.", suggest: (s) => r((s?.held ?? 0) + 100) },
      { kind: "holdBelow", label: "You hold at most", short: "Hold ≤", unit: "units", scope: "resource", hint: "Useful for “warn me before production runs dry”.", suggest: (s) => r((s?.held ?? 0) * 0.5) },
      { kind: "worthAbove", label: "Your stock is worth at least", short: "Worth ≥", unit: "credits", scope: "resource", hint: "Holdings × current sell price.", suggest: (s) => r((s?.heldValue ?? 0) * 1.2) },
    ],
  },
  {
    id: "credits",
    label: "Credits",
    blurb: "Your live credit balance.",
    kinds: [
      { kind: "creditsBelow", label: "Credits drop to", short: "Credits ≤", unit: "credits", scope: "credits", hint: "An early warning before you run out.", suggest: (_s, c) => r((c ?? 0) * 0.5) },
      { kind: "creditsAbove", label: "Credits reach", short: "Credits ≥", unit: "credits", scope: "credits", hint: "Know when you can afford the next big purchase.", suggest: (_s, c) => r((c ?? 0) * 1.5) },
    ],
  },
];

export const KIND_DEFS = Object.fromEntries(ALERT_GROUPS.flatMap((g) => g.kinds).map((k) => [k.kind, k])) as Record<AlertKind, AlertKindDef>;

export type Evaluation = { met: boolean; value: number | null; unavailable: string | null };

const compare = (value: number | null | undefined, op: ">=" | "<=", threshold: number, missing: string): Evaluation =>
  value == null || !Number.isFinite(value)
    ? { met: false, value: null, unavailable: missing }
    : { met: op === ">=" ? value >= threshold : value <= threshold, value, unavailable: null };

const pct = (v: number | null) => (v == null ? null : v * 100);

export function evaluateRule(rule: AlertRule, subject: AlertSubject | null, credits: number | null): Evaluation {
  const t = rule.threshold;
  if (rule.kind === "creditsBelow") return compare(credits, "<=", t, "Live credits aren’t available yet");
  if (rule.kind === "creditsAbove") return compare(credits, ">=", t, "Live credits aren’t available yet");
  if (!subject) return { met: false, value: null, unavailable: "Not in the current data" };
  switch (rule.kind) {
    case "sellAbove":
      return compare(subject.sell, ">=", t, "Can’t be sold on the market");
    case "sellBelow":
      return compare(subject.sell, "<=", t, "Can’t be sold on the market");
    case "buyBelow":
      return compare(subject.buy, "<=", t, "Can’t be bought on the market");
    case "buyAbove":
      return compare(subject.buy, ">=", t, "Can’t be bought on the market");
    case "vsBaseAbove":
      return compare(pct(subject.vsBase), ">=", t, "Not traded on the market");
    case "vsBaseBelow":
      return compare(pct(subject.vsBase), "<=", -Math.abs(t), "Not traded on the market");
    case "near30High":
      return compare(pct(subject.sellRangePos), ">=", t, "No 30-day price history yet");
    case "near30Low":
      return compare(pct(subject.sellRangePos), "<=", t, "No 30-day price history yet");
    case "supplyBelow":
      return compare(pct(subject.volumeRatio), "<=", t, "Not traded on the market");
    case "supplyAbove":
      return compare(pct(subject.volumeRatio), ">=", t, "Not traded on the market");
    case "holdAbove":
      return compare(subject.held, ">=", t, "Holdings unknown");
    case "holdBelow":
      return compare(subject.held, "<=", t, "Holdings unknown");
    case "worthAbove":
      return compare(subject.heldValue, ">=", t, "Holdings or price unknown");
  }
  return { met: false, value: null, unavailable: "Unknown alert type" };
}

const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatThreshold(kind: AlertKind, value: number): string {
  const def = KIND_DEFS[kind];
  if (kind === "vsBaseAbove") return `+${num.format(Math.abs(value))}%`;
  if (kind === "vsBaseBelow") return `−${num.format(Math.abs(value))}%`;
  if (def.unit === "percent") return `${num.format(value)}%`;
  return `${num.format(value)}${def.unit === "credits" ? " cr" : ""}`;
}

export function formatValue(kind: AlertKind, value: number | null): string {
  if (value == null) return "—";
  const def = KIND_DEFS[kind];
  if (kind === "vsBaseAbove" || kind === "vsBaseBelow") return `${value >= 0 ? "+" : "−"}${num.format(Math.abs(value))}%`;
  if (def.unit === "percent") return `${num.format(value)}%`;
  return `${num.format(value)}${def.unit === "credits" ? " credits" : " units"}`;
}

export function describeRule(rule: AlertRule, label: string): string {
  const def = KIND_DEFS[rule.kind];
  return `${def.scope === "credits" ? "Credits" : label} · ${def.short} ${formatThreshold(rule.kind, rule.threshold)}`;
}

export const newAlertId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** A saved copy of a draft rule with a fresh id and creation time (call from event handlers, not render). */
export const finalizeAlert = (draft: AlertRule): AlertRule => ({ ...draft, id: newAlertId(), createdAt: Date.now() });
