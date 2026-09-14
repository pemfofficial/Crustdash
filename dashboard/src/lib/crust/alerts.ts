// Custom alerts: what can be watched, how a rule is checked against live data, and how it reads.
// Client-safe (no node imports).
//
// A rule watches one number (a source), compares it (a comparator) with a threshold, and fires when the comparison
// becomes true. Sources: a resource's market or stock figure, a named metric (credits, power, missions, the game…),
// or any value the game reports.

export type Unit = "credits" | "percent" | "signedPercent" | "count" | "perDay" | "flag" | "date";
export type Comparator = "atLeast" | "atMost" | "equals" | "risesBy" | "fallsBy" | "changes";
export type ResourceField = "sell" | "buy" | "vsBase" | "range30" | "supply" | "held" | "worth";

export type MetricId =
  | "credits"
  | "netWorth"
  | "stockpileWorth"
  | "reputation"
  | "contractSlots"
  | "power"
  | "cpu"
  | "drones"
  | "miningDrones"
  | "colonists"
  | "modules"
  | "researchTotal"
  | "researchFundamental"
  | "researchEngineering"
  | "researchSocial"
  | "minedWalls"
  | "missionsActive"
  | "missionStepsDone"
  | "missionStepProgress"
  | "bestHeldAboveBase"
  | "worstHeldBelowBase"
  | "resourcesAboveBase"
  | "lowestSupply"
  | "highestHeldRange30"
  | "gamePaused"
  | "gameConnected"
  | "inGameDate"
  | "urgentNotifications"
  | "pressingNotifications"
  | "openTasks";

export type AlertSource =
  | { type: "resource"; resource: string; field: ResourceField }
  | { type: "metric"; metric: MetricId }
  | { type: "glossary"; address: string };

export type AlertRule = {
  id: string;
  /** Optional name shown instead of the generated description. */
  name?: string;
  source: AlertSource;
  comparator: Comparator;
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

export type AlertMission = { name: string; done: number; total: number; currentName: string | null; currentProgress: number | null };

/** Everything rules are checked against. Built once per live update by AlertDataProvider. */
export type AlertContext = {
  credits: number | null;
  subjects: Map<string, AlertSubject>;
  glossary: Record<string, { value: number | null }>;
  /** The live link is up and the game is sending data. */
  connected: boolean;
  paused: boolean;
  inGameTime: { year: number; month: number; day: number } | null;
  missions: AlertMission[];
  notifications: { urgent: number; pressing: number };
  openTasks: number;
  resourceLabel: (name: string) => string;
};

type Reading = { value: number | null; detail?: string | null; unavailable?: string | null };

/** Event detail for "flash the live credits" (the credits widget listens for it). */
export const CREDITS_TARGET = "__credits";

// ------------------------------------------------------------------ catalog
export const COMPARATOR_TEXT: Record<Comparator, { label: string; short: string; needsThreshold: boolean }> = {
  atLeast: { label: "reaches or goes above", short: "≥", needsThreshold: true },
  atMost: { label: "drops to or below", short: "≤", needsThreshold: true },
  equals: { label: "is", short: "=", needsThreshold: true },
  risesBy: { label: "rises by at least", short: "rises by", needsThreshold: true },
  fallsBy: { label: "falls by at least", short: "falls by", needsThreshold: true },
  changes: { label: "changes at all", short: "changes", needsThreshold: false },
};

const NUMERIC: Comparator[] = ["atLeast", "atMost", "risesBy", "fallsBy", "changes"];
const COUNTS: Comparator[] = ["atLeast", "atMost", "equals", "risesBy", "fallsBy", "changes"];
const FLAG: Comparator[] = ["equals"];

type FieldDef = { label: string; unit: Unit; hint: string; comparators: Comparator[]; suggest: (s: AlertSubject | null) => number };
const round = (n: number) => Math.round(n);

export const RESOURCE_FIELDS: Record<ResourceField, FieldDef> = {
  sell: { label: "Sell price", unit: "credits", hint: "What the market pays you per unit right now.", comparators: NUMERIC, suggest: (s) => round((s?.sell ?? 0) * 1.1) },
  buy: { label: "Buy price", unit: "credits", hint: "What you pay per unit right now.", comparators: NUMERIC, suggest: (s) => round((s?.buy ?? 0) * 0.9) },
  vsBase: { label: "Price vs base", unit: "signedPercent", hint: "How far the price is from its normal (base) price. Use −10 for 10% below.", comparators: NUMERIC, suggest: () => 10 },
  range30: { label: "Position in its 30-day range", unit: "percent", hint: "0 = at its 30-day low, 100 = at its 30-day high.", comparators: NUMERIC, suggest: () => 90 },
  supply: { label: "Market supply", unit: "percent", hint: "100 = the market’s normal volume. Low supply comes with higher prices.", comparators: NUMERIC, suggest: () => 50 },
  held: { label: "Amount you hold", unit: "count", hint: "Live while the game runs this save, otherwise from the last save.", comparators: COUNTS, suggest: (s) => round((s?.held ?? 0) + 100) },
  worth: { label: "What your stock is worth", unit: "credits", hint: "Holdings × today’s sell price.", comparators: NUMERIC, suggest: (s) => round((s?.heldValue ?? 0) * 1.2) },
};

export type MetricGroup = "Economy" | "Colony" | "Missions" | "Market" | "Game" | "Assistant";
type MetricDef = {
  label: string;
  group: MetricGroup;
  unit: Unit;
  hint: string;
  comparators: Comparator[];
  /** For flags: what 1 and 0 mean. */
  flag?: [on: string, off: string];
  suggest: (current: number | null) => number;
  read: (c: AlertContext) => Reading;
};

const NOT_REPORTED = "The game hasn’t reported this yet";
const game = (address: string) => (c: AlertContext): Reading => {
  const value = c.glossary[address]?.value ?? null;
  return value == null ? { value: null, unavailable: NOT_REPORTED } : { value };
};
const sumOf = (addresses: string[]) => (c: AlertContext): Reading => {
  const values = addresses.map((a) => c.glossary[a]?.value).filter((v): v is number => v != null);
  return values.length ? { value: values.reduce((s, v) => s + v, 0) } : { value: null, unavailable: NOT_REPORTED };
};
const byResource = (pick: (s: AlertSubject) => number | null, choose: "max" | "min", only: (s: AlertSubject) => boolean, missing: string) => (c: AlertContext): Reading => {
  let best: { value: number; label: string } | null = null;
  for (const s of c.subjects.values()) {
    const v = pick(s);
    if (v == null || !only(s)) continue;
    if (!best || (choose === "max" ? v > best.value : v < best.value)) best = { value: v, label: s.label };
  }
  return best ? { value: best.value, detail: best.label } : { value: null, unavailable: missing };
};
const percentOf = (x: number | null) => (x == null ? null : Math.round(x * 1000) / 10);
const isHeld = (s: AlertSubject) => (s.held ?? 0) > 0;
const whenConnected = (read: (c: AlertContext) => Reading) => (c: AlertContext): Reading => (c.connected ? read(c) : { value: null, unavailable: "Waiting for the game" });

export const METRICS: Record<MetricId, MetricDef> = {
  credits: {
    label: "Credits", group: "Economy", unit: "credits", hint: "Your live credit balance.", comparators: NUMERIC,
    suggest: (v) => round((v ?? 100000) * 0.5), read: (c) => (c.credits == null ? { value: null, unavailable: "Live credits aren’t available yet" } : { value: c.credits }),
  },
  netWorth: { label: "Net worth", group: "Economy", unit: "credits", hint: "Capitalization: credits plus everything you own.", comparators: NUMERIC, suggest: (v) => round((v ?? 1000000) * 1.2), read: game("G.Stats.GlobalCapitalisation") },
  stockpileWorth: {
    label: "Stockpile worth", group: "Economy", unit: "credits", hint: "Everything you hold, at today’s sell prices.", comparators: NUMERIC, suggest: (v) => round((v ?? 100000) * 1.2),
    read: (c) => {
      const values = [...c.subjects.values()].map((s) => s.heldValue).filter((v): v is number => v != null);
      return values.length ? { value: values.reduce((s, v) => s + v, 0) } : { value: null, unavailable: "No market prices yet" };
    },
  },
  reputation: { label: "Global reputation", group: "Economy", unit: "count", hint: "Affects loans, market prices and the hiring pool.", comparators: COUNTS, suggest: (v) => (v ?? 40) - 5, read: game("G.Balance.GlobalReputation") },
  contractSlots: { label: "Contract slots", group: "Economy", unit: "count", hint: "How many contracts you can run at once.", comparators: COUNTS, suggest: (v) => (v ?? 2) + 1, read: game("G.Contract.MaxActiveContract") },
  power: { label: "Power balance", group: "Colony", unit: "count", hint: "Generation minus consumption. Below 0 means a deficit.", comparators: COUNTS, suggest: () => 0, read: game("G.Stats.ElectricityBalance") },
  cpu: { label: "CPU available", group: "Colony", unit: "count", hint: "Computing power left for new modules and drones.", comparators: COUNTS, suggest: () => 20, read: game("G.Balance.AvailableCPU") },
  drones: { label: "Drones", group: "Colony", unit: "count", hint: "All drones on the base.", comparators: COUNTS, suggest: (v) => (v ?? 10) + 1, read: game("G.Stats.DroneCount") },
  miningDrones: { label: "Mining drones", group: "Colony", unit: "count", hint: "Drones set up for mining.", comparators: COUNTS, suggest: (v) => (v ?? 0) + 1, read: game("G.Stats.MinerRobotCount") },
  colonists: { label: "Colonists", group: "Colony", unit: "count", hint: "People living on the base.", comparators: COUNTS, suggest: (v) => (v ?? 0) + 1, read: game("G.Stats.ColonistCount") },
  modules: {
    label: "Modules built", group: "Colony", unit: "count", hint: "Everything built, as the game counts it (ruins not counted).", comparators: COUNTS, suggest: (v) => (v ?? 0) + 5,
    read: (c) => {
      const counts = Object.entries(c.glossary).filter(([a]) => /^G\.Stats\.\w+SysCount$/i.test(a) && !/RuinedMeteor/i.test(a));
      return counts.length ? { value: counts.reduce((s, [, e]) => s + (e.value ?? 0), 0) } : { value: null, unavailable: NOT_REPORTED };
    },
  },
  researchTotal: { label: "Research income, all branches", group: "Colony", unit: "perDay", hint: "Science points per day.", comparators: NUMERIC, suggest: (v) => (v ?? 0) + 10, read: sumOf(["G.Research.FunIncome", "G.Research.EngIncome", "G.Research.SocIncome"]) },
  researchFundamental: { label: "Fundamental research income", group: "Colony", unit: "perDay", hint: "Fundamental points per day.", comparators: NUMERIC, suggest: (v) => (v ?? 0) + 5, read: game("G.Research.FunIncome") },
  researchEngineering: { label: "Engineering research income", group: "Colony", unit: "perDay", hint: "Engineering points per day.", comparators: NUMERIC, suggest: (v) => (v ?? 0) + 5, read: game("G.Research.EngIncome") },
  researchSocial: { label: "Social research income", group: "Colony", unit: "perDay", hint: "Social points per day.", comparators: NUMERIC, suggest: (v) => (v ?? 0) + 5, read: game("G.Research.SocIncome") },
  minedWalls: { label: "Underground cells dug", group: "Colony", unit: "count", hint: "How much the drones have excavated.", comparators: COUNTS, suggest: (v) => (v ?? 0) + 500, read: game("G.Stats.MinedWallsCount") },
  missionsActive: {
    label: "Missions in progress", group: "Missions", unit: "count", hint: "Rises when a new mission starts.", comparators: COUNTS, suggest: () => 1,
    read: (c) => ({ value: c.missions.length }),
  },
  missionStepsDone: {
    label: "Mission steps done", group: "Missions", unit: "count", hint: "Across all missions in progress. “Rises by 1” fires when any step is finished.", comparators: COUNTS, suggest: () => 1,
    read: (c) => ({ value: c.missions.reduce((s, m) => s + m.done, 0) }),
  },
  missionStepProgress: {
    label: "Current step progress", group: "Missions", unit: "percent", hint: "The most advanced current mission step, as a percentage.", comparators: NUMERIC, suggest: () => 100,
    read: (c) => {
      const steps = c.missions.filter((m) => m.currentProgress != null);
      if (!steps.length) return { value: null, unavailable: "No mission step with measurable progress" };
      const top = steps.reduce((a, b) => ((b.currentProgress ?? 0) > (a.currentProgress ?? 0) ? b : a));
      return { value: percentOf(top.currentProgress), detail: `${top.name}: ${top.currentName ?? "current step"}` };
    },
  },
  bestHeldAboveBase: {
    label: "Best price vs base among what you hold", group: "Market", unit: "signedPercent", hint: "Fires with the resource that’s furthest above its base price.", comparators: NUMERIC, suggest: () => 15,
    read: byResource((s) => percentOf(s.vsBase), "max", isHeld, "Nothing you hold is traded"),
  },
  worstHeldBelowBase: {
    label: "Lowest price vs base among what you hold", group: "Market", unit: "signedPercent", hint: "Use −15 for “something I hold is 15% below base”.", comparators: NUMERIC, suggest: () => -15,
    read: byResource((s) => percentOf(s.vsBase), "min", isHeld, "Nothing you hold is traded"),
  },
  resourcesAboveBase: {
    label: "Resources priced 10% or more above base", group: "Market", unit: "count", hint: "Across the whole market.", comparators: COUNTS, suggest: () => 5,
    read: (c) => {
      const traded = [...c.subjects.values()].filter((s) => s.vsBase != null);
      return traded.length ? { value: traded.filter((s) => (s.vsBase ?? 0) >= 0.1).length } : { value: null, unavailable: "No market prices yet" };
    },
  },
  lowestSupply: {
    label: "Lowest market supply", group: "Market", unit: "percent", hint: "The scarcest resource, as a percentage of its normal volume.", comparators: NUMERIC, suggest: () => 25,
    read: byResource((s) => percentOf(s.volumeRatio), "min", (s) => s.volumeRatio != null, "No market data yet"),
  },
  highestHeldRange30: {
    label: "Highest 30-day position among what you hold", group: "Market", unit: "percent", hint: "100 = something you hold is at its 30-day high: a good moment to sell.", comparators: NUMERIC, suggest: () => 95,
    read: byResource((s) => percentOf(s.sellRangePos), "max", isHeld, "No 30-day history yet"),
  },
  gamePaused: {
    label: "Game is paused", group: "Game", unit: "flag", flag: ["Paused", "Running"], hint: "Choose Paused or Running.", comparators: FLAG, suggest: () => 1,
    read: whenConnected((c) => ({ value: c.paused ? 1 : 0 })),
  },
  gameConnected: {
    label: "Game connection", group: "Game", unit: "flag", flag: ["Connected", "Disconnected"], hint: "Choose Disconnected to hear when the game stops sending data (a crash, or you quit).", comparators: FLAG, suggest: () => 0,
    read: (c) => ({ value: c.connected ? 1 : 0 }),
  },
  inGameDate: {
    label: "In-game date", group: "Game", unit: "date", hint: "Reaches or passes a date on the game’s calendar.", comparators: ["atLeast"], suggest: (v) => v ?? 20800101,
    read: (c) => (c.inGameTime ? { value: c.inGameTime.year * 10000 + c.inGameTime.month * 100 + c.inGameTime.day } : { value: null, unavailable: "Waiting for the game" }),
  },
  urgentNotifications: { label: "Urgent notifications", group: "Assistant", unit: "count", hint: "Alerts that fired and critical findings.", comparators: COUNTS, suggest: () => 1, read: (c) => ({ value: c.notifications.urgent }) },
  pressingNotifications: { label: "Pressing notifications", group: "Assistant", unit: "count", hint: "Warnings worth dealing with soon.", comparators: COUNTS, suggest: () => 1, read: (c) => ({ value: c.notifications.pressing }) },
  openTasks: { label: "Open tasks", group: "Assistant", unit: "count", hint: "Tasks in your task list for this save.", comparators: COUNTS, suggest: () => 0, read: (c) => ({ value: c.openTasks }) },
};

export const METRIC_GROUPS: MetricGroup[] = ["Economy", "Colony", "Missions", "Market", "Game", "Assistant"];

// ------------------------------------------------------------------ reading and checking
const resourceReading = (source: Extract<AlertSource, { type: "resource" }>, c: AlertContext): Reading => {
  const s = c.subjects.get(source.resource);
  if (!s) return { value: null, unavailable: "Not in the current data" };
  switch (source.field) {
    case "sell":
      return s.sell == null ? { value: null, unavailable: "Can’t be sold on the market" } : { value: s.sell };
    case "buy":
      return s.buy == null ? { value: null, unavailable: "Can’t be bought on the market" } : { value: s.buy };
    case "vsBase":
      return s.vsBase == null ? { value: null, unavailable: "Not traded on the market" } : { value: percentOf(s.vsBase) };
    case "range30":
      return s.sellRangePos == null ? { value: null, unavailable: "No 30-day price history yet" } : { value: percentOf(s.sellRangePos) };
    case "supply":
      return s.volumeRatio == null ? { value: null, unavailable: "Not traded on the market" } : { value: percentOf(s.volumeRatio) };
    case "held":
      return s.held == null ? { value: null, unavailable: "Holdings unknown" } : { value: s.held };
    case "worth":
      return s.heldValue == null ? { value: null, unavailable: "Holdings or price unknown" } : { value: s.heldValue };
  }
};

export function readSource(source: AlertSource, c: AlertContext): Reading {
  if (source.type === "resource") return resourceReading(source, c);
  if (source.type === "metric") return METRICS[source.metric]?.read(c) ?? { value: null, unavailable: "Unknown value" };
  const value = c.glossary[source.address]?.value ?? null;
  return value == null ? { value: null, unavailable: NOT_REPORTED } : { value };
}

export type SourceInfo = { unit: Unit; comparators: Comparator[]; hint: string; flag?: [string, string] };

export function sourceInfo(source: AlertSource): SourceInfo {
  if (source.type === "resource") return RESOURCE_FIELDS[source.field];
  if (source.type === "metric") return METRICS[source.metric];
  return { unit: "count", comparators: COUNTS, hint: "A value the game keeps for its own logic, reported live by the mod." };
}

export type Evaluation = { met: boolean; value: number | null; detail: string | null; unavailable: string | null };

/** Check a rule. `baseline` is the value when the rule was armed, for rises/falls/changes rules. */
export function evaluateRule(rule: AlertRule, c: AlertContext, baseline: number | null = null): Evaluation {
  const reading = readSource(rule.source, c);
  const value = reading.value;
  const base = { value, detail: reading.detail ?? null, unavailable: reading.unavailable ?? null };
  if (value == null || !Number.isFinite(value)) return { ...base, met: false, value: null };
  const t = rule.threshold;
  switch (rule.comparator) {
    case "atLeast":
      return { ...base, met: value >= t };
    case "atMost":
      return { ...base, met: value <= t };
    case "equals":
      return { ...base, met: value === t };
    case "risesBy":
      return { ...base, met: baseline != null && value - baseline >= t };
    case "fallsBy":
      return { ...base, met: baseline != null && baseline - value >= t };
    case "changes":
      return { ...base, met: baseline != null && value !== baseline };
  }
}

/** Rules that compare with where the value started need a baseline. */
export const usesBaseline = (rule: Pick<AlertRule, "comparator">) => rule.comparator === "risesBy" || rule.comparator === "fallsBy" || rule.comparator === "changes";

// ------------------------------------------------------------------ describing
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** Negative numbers get a true minus sign, matching the signed percentages. */
const plain = (value: number) => (value < 0 ? `−${num.format(-value)}` : num.format(value));

export function formatAmount(unit: Unit, value: number | null, flag?: [string, string]): string {
  if (value == null) return "—";
  switch (unit) {
    case "credits":
      return `${plain(value)} cr`;
    case "percent":
      return `${plain(value)}%`;
    case "signedPercent":
      return `${value > 0 ? "+" : value < 0 ? "−" : ""}${num.format(Math.abs(value))}%`;
    case "perDay":
      return `${plain(value)} a day`;
    case "flag":
      return flag ? (value ? flag[0] : flag[1]) : value ? "Yes" : "No";
    case "date": {
      const year = Math.floor(value / 10000);
      const month = Math.floor((value % 10000) / 100);
      const day = value % 100;
      return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    }
    default:
      return plain(value);
  }
}

/** A game value's address as words: "G.Stats.MinedWallsCount" -> "Mined Walls Count". */
export const glossaryLabel = (address: string) => (address.split(".").pop() ?? address).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");

export function sourceLabel(source: AlertSource, resourceLabel: (name: string) => string): string {
  if (source.type === "resource") return `${resourceLabel(source.resource)}: ${RESOURCE_FIELDS[source.field].label.toLowerCase()}`;
  if (source.type === "metric") return METRICS[source.metric]?.label ?? source.metric;
  return `Game value: ${glossaryLabel(source.address)}`;
}

export function describeCondition(rule: Pick<AlertRule, "source" | "comparator" | "threshold">): string {
  const info = sourceInfo(rule.source);
  const comparator = COMPARATOR_TEXT[rule.comparator];
  if (!comparator.needsThreshold) return comparator.label;
  if (info.unit === "flag") return `is ${formatAmount("flag", rule.threshold, info.flag).toLowerCase()}`;
  const amount = rule.comparator === "risesBy" || rule.comparator === "fallsBy" ? formatAmount(info.unit === "signedPercent" ? "percent" : info.unit, Math.abs(rule.threshold)) : formatAmount(info.unit, rule.threshold, info.flag);
  return `${comparator.label} ${amount}`;
}

export function describeRule(rule: AlertRule, resourceLabel: (name: string) => string): string {
  return rule.name?.trim() || `${sourceLabel(rule.source, resourceLabel)} ${describeCondition(rule)}`;
}

/** A short group name for listing alerts. */
export function sourceGroup(source: AlertSource): string {
  if (source.type === "resource") return "Resources";
  if (source.type === "metric") return METRICS[source.metric]?.group ?? "Other";
  return "Game values";
}

// ------------------------------------------------------------------ creating, templates, older saved alerts
export const newAlertId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export type AlertDraft = Pick<AlertRule, "source" | "comparator" | "threshold" | "repeat"> & { name?: string };

/** A saved rule from a draft, with a fresh id and creation time (call from event handlers, not render). */
export const finalizeAlert = (draft: AlertDraft): AlertRule => ({
  ...draft,
  id: newAlertId(),
  enabled: true,
  armed: true,
  createdAt: Date.now(),
  lastFiredAt: null,
  firedCount: 0,
});

export type AlertTemplate = { id: string; label: string; hint: string; draft: (c: AlertContext) => AlertDraft };

const metric = (id: MetricId, comparator: Comparator, threshold: number, repeat = true): AlertDraft => ({ source: { type: "metric", metric: id }, comparator, threshold, repeat });

export const ALERT_TEMPLATES: AlertTemplate[] = [
  { id: "power-deficit", label: "Power goes into deficit", hint: "Power balance drops below 0.", draft: () => metric("power", "atMost", -1) },
  { id: "cpu-low", label: "CPU running low", hint: "Less than 20 CPU left.", draft: () => metric("cpu", "atMost", 20) },
  { id: "credits-low", label: "Credits running low", hint: "Credits drop to half of today’s balance.", draft: (c) => metric("credits", "atMost", Math.round((c.credits ?? 100000) * 0.5)) },
  { id: "mission-step", label: "A mission step is done", hint: "Any step of a mission in progress finishes.", draft: () => metric("missionStepsDone", "risesBy", 1) },
  { id: "mission-new", label: "A new mission starts", hint: "The number of missions in progress rises.", draft: () => metric("missionsActive", "risesBy", 1) },
  { id: "urgent", label: "Something urgent comes up", hint: "An urgent notification appears.", draft: () => metric("urgentNotifications", "risesBy", 1) },
  { id: "sell-high", label: "Something I hold sells high", hint: "A resource you hold is 15% or more above its base price.", draft: () => metric("bestHeldAboveBase", "atLeast", 15) },
  { id: "disconnected", label: "The game disconnects", hint: "The game stops sending data (a crash, or you quit).", draft: () => metric("gameConnected", "equals", 0) },
  { id: "paused", label: "The game is paused", hint: "Handy if you step away with the game running.", draft: () => metric("gamePaused", "equals", 1) },
  { id: "drone-lost", label: "A drone is lost", hint: "The drone count falls.", draft: () => metric("drones", "fallsBy", 1) },
  { id: "colonists-change", label: "Colonists change", hint: "Someone joins or leaves the base.", draft: () => metric("colonists", "changes", 0) },
  { id: "reputation-drop", label: "Reputation drops", hint: "Global reputation falls by 1 or more.", draft: () => metric("reputation", "fallsBy", 1) },
];

const LEGACY: Record<string, { field?: ResourceField; metric?: MetricId; comparator: Comparator; negate?: boolean }> = {
  sellAbove: { field: "sell", comparator: "atLeast" },
  sellBelow: { field: "sell", comparator: "atMost" },
  buyBelow: { field: "buy", comparator: "atMost" },
  buyAbove: { field: "buy", comparator: "atLeast" },
  vsBaseAbove: { field: "vsBase", comparator: "atLeast" },
  vsBaseBelow: { field: "vsBase", comparator: "atMost", negate: true },
  near30High: { field: "range30", comparator: "atLeast" },
  near30Low: { field: "range30", comparator: "atMost" },
  supplyBelow: { field: "supply", comparator: "atMost" },
  supplyAbove: { field: "supply", comparator: "atLeast" },
  holdAbove: { field: "held", comparator: "atLeast" },
  holdBelow: { field: "held", comparator: "atMost" },
  worthAbove: { field: "worth", comparator: "atLeast" },
  creditsBelow: { metric: "credits", comparator: "atMost" },
  creditsAbove: { metric: "credits", comparator: "atLeast" },
};

/** Saved alerts from before sources existed ({ kind, target }) become the equivalent new rule. */
export function normalizeRule(raw: unknown): AlertRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AlertRule> & { kind?: string; target?: string };
  if (r.source && r.comparator) return r as AlertRule;
  const legacy = r.kind ? LEGACY[r.kind] : undefined;
  if (!legacy || typeof r.id !== "string") return null;
  const source: AlertSource = legacy.metric ? { type: "metric", metric: legacy.metric } : { type: "resource", resource: r.target ?? "", field: legacy.field as ResourceField };
  return {
    id: r.id,
    source,
    comparator: legacy.comparator,
    threshold: legacy.negate ? -Math.abs(r.threshold ?? 0) : (r.threshold ?? 0),
    repeat: r.repeat ?? true,
    enabled: r.enabled ?? true,
    armed: r.armed ?? true,
    createdAt: r.createdAt ?? 0,
    lastFiredAt: r.lastFiredAt ?? null,
    firedCount: r.firedCount ?? 0,
  };
}
