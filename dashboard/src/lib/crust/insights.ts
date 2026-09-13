// Turns Stats.bin series into daily tables, section data, and findings backed by real figures.
// Advice text cites the game's own descriptions (Game.locres), the wiki, or the dev diaries.
import { statLabel, type StatSeries } from "./stats";
import { LEVEL_ORDER, type Insight, type Level } from "./types";
import type { TopicId } from "./topics";

export type { Insight, Level };

export const RANGE_PRESETS = [
  { key: "live", label: "Live", days: 30 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;

type FlowDef = { label: string; topic: TopicId };

// Per-day flow stats: each day's amount matches that day's change in credits (verified against saves)
export const INCOME: Record<string, FlowDef> = {
  ContractRewards: { label: "Contract rewards", topic: "contracts" },
  IncomeTrades: { label: "Market sales", topic: "trades" },
  IncomePOI: { label: "Points of interest", topic: "poi" },
  IncomeConstructions: { label: "Construction refunds", topic: "construction" },
  BankIncome: { label: "Bank", topic: "bank" },
};
export const SPEND: Record<string, FlowDef> = {
  OutcomeTrades: { label: "Market purchases", topic: "trades" },
  OutcomeConstructions: { label: "Construction", topic: "construction" },
  Colonists: { label: "Colonists", topic: "colonists" },
  ContractPenalty: { label: "Contract penalties", topic: "contracts" },
  POIPenalty: { label: "Point-of-interest penalties", topic: "poi" },
  BankPayment: { label: "Loan payments", topic: "bank" },
  ZondPurchases: { label: "Probe purchases", topic: "poi" },
  RentArea: { label: "Area rent", topic: "spending" },
  OutpostPurchase: { label: "Outpost purchases", topic: "spending" },
};

// Singular nouns for "one … of 165,865" phrasing
const SPEND_NOUN: Record<string, string> = {
  OutcomeTrades: "market purchase",
  OutcomeConstructions: "construction payment",
  Colonists: "colonist payment",
  ContractPenalty: "contract penalty",
  POIPenalty: "point-of-interest penalty",
  BankPayment: "loan payment",
  ZondPurchases: "probe purchase",
  RentArea: "rent payment",
  OutpostPurchase: "outpost purchase",
};

// Net worth parts. GlobalCapitalization = every *Capitalization + PlayerCredits (verified against saves).
// Colors follow the part, never its rank.
export const WORTH_PARTS = [
  { key: "ResourcesCapitalization", label: "Stored resources", slot: 1 },
  { key: "RobotsCapitalization", label: "Drones", slot: 2 },
  { key: "ModulesCapitalization", label: "Modules", slot: 3 },
  { key: "PlayerCredits", label: "Credits", slot: 4 },
  { key: "VehicleCapitalization", label: "Vehicles", slot: 5 },
] as const;
const OTHER_WORTH_LABELS: Record<string, string> = {
  ModulesUpgradesCapitalization: "Module upgrades",
  ConveyorsCapitalization: "Conveyors",
  WiresCapitalization: "Electrical wires",
  GasPipesCapitalization: "Gas pipes",
  RocketsCapitalization: "Rockets",
  ColonistsCapitalization: "Colonists",
  OutpostsCapitalization: "Outposts",
  RoomsCapitalization: "Rooms",
  TransportUpgradesCapitalization: "Transport upgrades",
};

export type ResourceRow = {
  key: string;
  name: string;
  label: string;
  now: number;
  change: number;
  perDay: number;
  spark: number[];
  pattern: "accumulating" | "depleting" | "steady" | "mixed";
};
export type FlowRow = {
  key: string;
  label: string;
  topic: TopicId;
  total: number;
  share: number;
  activeDays: number;
  avgPerActiveDay: number;
  biggest: { date: number; amount: number } | null;
};
export type CountRow = { key: string; label: string; now: number; change: number };
export type Movement = { date: number; change: number; parts: { label: string; amount: number }[] };
export type WorthPart = {
  key: string;
  label: string;
  slot: number;
  now: number;
  start: number;
  change: number;
  share: number;
  members: { label: string; now: number }[];
};

export type Analysis = {
  days: number[];
  rangeDays: number;
  lastDay: number | null;
  credits: {
    now: number;
    start: number;
    change: number;
    series: (number | null)[];
    spark: number[];
    high: { value: number; date: number } | null;
    low: { value: number; date: number } | null;
    surplusDays: number;
    deficitDays: number;
    avgNetPerDay: number;
    driftPerDay30: number | null;
    runwayDays: number | null;
    movements: Movement[];
  };
  dailyNet: number[];
  netWorth: {
    now: number;
    start: number;
    change: number;
    changePct: number | null;
    spark: number[];
    parts: WorthPart[];
    cashShare: number | null;
    lines: { key: string; label: string; slot: number; values: (number | null)[] }[];
  };
  flows: {
    income: FlowRow[];
    spend: FlowRow[];
    incomeTotal: number;
    spendTotal: number;
    net: number;
    untracked: number;
    incomeDays: number;
    spendDays: number;
  };
  cpu: { reserved: number; limit: number; modules: number; drones: number; transport: number; droneCount: number };
  modules: { now: number; change: number };
  resources: ResourceRow[];
  buildings: CountRow[];
  insights: Insight[];
};

const DAY = 86400000;
type Daily = { days: number[]; values: Map<string, (number | null)[]> };

export function toDaily(stats: StatSeries[]): Daily {
  const flows = new Set([...Object.keys(INCOME), ...Object.keys(SPEND)]);
  const perStat = new Map<string, Map<number, number>>();
  const daySet = new Set<number>();
  const floor = Date.UTC(2000, 0, 1);
  for (const s of stats) {
    const m = new Map<number, number>();
    const isFlow = flows.has(s.name);
    for (const p of s.points) {
      if (!p.date) continue;
      const ms = Date.parse(p.date);
      if (!(ms > floor)) continue;
      const day = Math.floor(ms / DAY) * DAY;
      daySet.add(day);
      // Flows sum within a day; levels (quantities, counts) keep the day's last sample
      m.set(day, isFlow ? (m.get(day) ?? 0) + p.value : p.value);
    }
    perStat.set(s.name, m);
  }
  const days = [...daySet].sort((a, b) => a - b);
  const values = new Map<string, (number | null)[]>();
  for (const [name, m] of perStat) values.set(name, days.map((d) => m.get(d) ?? null));
  return { days, values };
}

const nums = (a: (number | null)[]) => a.filter((v): v is number => v != null);
const lastOf = (a: (number | null)[]) => {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]!;
  return 0;
};
const firstOf = (a: (number | null)[]) => {
  for (const v of a) if (v != null) return v;
  return 0;
};
const sum = (a: (number | null)[]) => nums(a).reduce((s, v) => s + v, 0);

/** Least-squares slope in units per day. */
function slope(a: (number | null)[]): number {
  const pts = a.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return 0;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den ? num / den : 0;
}

function pattern(a: (number | null)[]): ResourceRow["pattern"] {
  const v = nums(a);
  let ups = 0;
  let downs = 0;
  for (let i = 1; i < v.length; i++) {
    if (v[i] > v[i - 1]) ups++;
    else if (v[i] < v[i - 1]) downs++;
  }
  if (ups === 0 && downs === 0) return "steady";
  if (downs === 0) return "accumulating";
  if (ups === 0) return "depleting";
  return "mixed";
}

const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const f = (n: number) => n0.format(Math.round(n));
const fs = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + n0.format(Math.abs(Math.round(n)));
const plural = (n: number, word: string) => `${f(n)} ${word}${Math.round(n) === 1 ? "" : "s"}`;
const dl = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function analyze(stats: StatSeries[], rangeDays: number | null): Analysis {
  const full = toDaily(stats);
  const start = rangeDays == null ? 0 : Math.max(0, full.days.length - rangeDays);
  const days = full.days.slice(start);
  const get = (name: string) => (full.values.get(name) ?? []).slice(start);
  const getFull = (name: string) => full.values.get(name) ?? [];
  const lastDay = days.length ? days[days.length - 1] : null;

  // ---------------------------------------------------------------- credits and flows
  const creditsSeries = get("PlayerCredits");
  const cNow = lastOf(creditsSeries);
  const cStart = firstOf(creditsSeries);
  let high: { value: number; date: number } | null = null;
  let low: { value: number; date: number } | null = null;
  creditsSeries.forEach((v, i) => {
    if (v == null) return;
    if (!high || v > high.value) high = { value: v, date: days[i] };
    if (!low || v < low.value) low = { value: v, date: days[i] };
  });

  const inSeries = Object.fromEntries(Object.keys(INCOME).map((k) => [k, get(k)]));
  const outSeries = Object.fromEntries(Object.keys(SPEND).map((k) => [k, get(k)]));
  const incomeDaily = days.map((_, i) => Object.values(inSeries).reduce((s, arr) => s + (arr[i] ?? 0), 0));
  const spendDaily = days.map((_, i) => Object.values(outSeries).reduce((s, arr) => s + (arr[i] ?? 0), 0));
  const dailyNet = days.map((_, i) => incomeDaily[i] - spendDaily[i]);
  const span = Math.max(1, days.length - 1);
  const incomeTotal = sum(incomeDaily);
  const spendTotal = sum(spendDaily);
  // A day's flows explain the change from the previous day's balance, so the first day is outside the range's change
  const trackedChange = sum(dailyNet.slice(1));
  const untracked = cNow - cStart - trackedChange;

  const movements: Movement[] = [];
  for (let i = 1; i < days.length; i++) {
    const before = creditsSeries[i - 1];
    const after = creditsSeries[i];
    if (before == null || after == null || before === after) continue;
    const parts = [
      ...Object.entries(inSeries).map(([k, arr]) => ({ label: INCOME[k].label, amount: arr[i] ?? 0 })),
      ...Object.entries(outSeries).map(([k, arr]) => ({ label: SPEND[k].label, amount: -(arr[i] ?? 0) })),
    ]
      .filter((p) => p.amount !== 0)
      .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
    movements.push({ date: days[i], change: after - before, parts });
  }
  movements.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
  movements.splice(8);

  const credits30 = getFull("PlayerCredits").slice(-30);
  const driftPerDay30 = nums(credits30).length >= 2 ? (lastOf(credits30) - firstOf(credits30)) / Math.max(1, credits30.length - 1) : null;
  const runwayDays = driftPerDay30 != null && driftPerDay30 < 0 && cNow > 0 ? cNow / -driftPerDay30 : null;

  const flowRows = (defs: Record<string, FlowDef>, series: Record<string, (number | null)[]>): FlowRow[] => {
    const rows = Object.entries(defs).map(([key, def]) => {
      const s = series[key];
      let biggest: FlowRow["biggest"] = null;
      s.forEach((v, i) => {
        if (v && (!biggest || v > biggest.amount)) biggest = { date: days[i], amount: v };
      });
      const total = sum(s);
      const activeDays = nums(s).filter((v) => v !== 0).length;
      return { key, label: def.label, topic: def.topic, total, share: 0, activeDays, avgPerActiveDay: activeDays ? total / activeDays : 0, biggest };
    });
    const total = rows.reduce((t, r) => t + r.total, 0);
    for (const r of rows) r.share = total ? r.total / total : 0;
    return rows.filter((r) => r.total !== 0).sort((a, b) => b.total - a.total);
  };
  const income = flowRows(INCOME, inSeries);
  const spend = flowRows(SPEND, outSeries);

  // ---------------------------------------------------------------- net worth
  const globalSeries = get("GlobalCapitalization");
  const gNow = lastOf(globalSeries);
  const gStart = firstOf(globalSeries);
  const namedKeys = new Set<string>(WORTH_PARTS.map((p) => p.key));
  const otherKeys = [...full.values.keys()].filter((k) => k.endsWith("Capitalization") && k !== "GlobalCapitalization" && !namedKeys.has(k));
  const parts: WorthPart[] = WORTH_PARTS.map((p) => {
    const s = get(p.key);
    const now = lastOf(s);
    const st = firstOf(s);
    return { key: p.key, label: p.label, slot: p.slot, now, start: st, change: now - st, share: gNow ? now / gNow : 0, members: [] };
  });
  const otherNow = otherKeys.reduce((s, k) => s + lastOf(get(k)), 0);
  const otherStart = otherKeys.reduce((s, k) => s + firstOf(get(k)), 0);
  parts.push({
    key: "__other",
    label: "Everything else",
    slot: 6,
    now: otherNow,
    start: otherStart,
    change: otherNow - otherStart,
    share: gNow ? otherNow / gNow : 0,
    members: otherKeys
      .map((k) => ({ label: OTHER_WORTH_LABELS[k] ?? statLabel(k.replace(/Capitalization$/, "")), now: lastOf(get(k)) }))
      .filter((m) => m.now !== 0)
      .sort((a, b) => b.now - a.now),
  });
  const lines = [
    { key: "ResourcesCapitalization", label: "Stored resources", slot: 1 },
    { key: "RobotsCapitalization", label: "Drones", slot: 2 },
    { key: "ModulesCapitalization", label: "Modules", slot: 3 },
    { key: "PlayerCredits", label: "Credits", slot: 4 },
  ].map((l) => ({ ...l, values: get(l.key) }));

  // ---------------------------------------------------------------- capacity, resources, buildings
  const cpu = {
    reserved: lastOf(get("ReservedCPU")),
    limit: lastOf(get("LimitCPU")),
    modules: lastOf(get("CPUStat.Modules")),
    drones: lastOf(get("CPUStat.Drones")),
    transport: lastOf(get("CPUStat.Transport")),
    droneCount: lastOf(get("EResourceType::Drone")),
  };
  const modulesSeries = get("AllModulesCount");
  const modules = { now: lastOf(modulesSeries), change: lastOf(modulesSeries) - firstOf(modulesSeries) };

  const resources: ResourceRow[] = [...full.values.keys()]
    .filter((k) => k.startsWith("EResourceType::") && k !== "EResourceType::None")
    .map((key) => {
      const s = get(key);
      return {
        key,
        name: key.slice("EResourceType::".length),
        label: statLabel(key),
        now: lastOf(s),
        change: lastOf(s) - firstOf(s),
        perDay: slope(s),
        spark: nums(s).slice(-30),
        pattern: pattern(s),
      };
    })
    .filter((r) => r.now !== 0 || r.change !== 0 || nums(getFull(r.key)).some((v) => v !== 0))
    .sort((a, b) => b.now - a.now);

  const buildings: CountRow[] = [...full.values.keys()]
    .filter((k) => /Sys$/i.test(k) && !k.startsWith("RuinedMeteor"))
    .map((key) => {
      const s = get(key);
      return { key, label: statLabel(key), now: lastOf(s), change: lastOf(s) - firstOf(s) };
    })
    .filter((r) => r.now !== 0 || r.change !== 0)
    .sort((a, b) => b.now - a.now);

  // ---------------------------------------------------------------- findings
  const insights: Insight[] = [];
  const add = (i: Insight) => insights.push(i);

  // Cash: runway or growth (always judged on the last 30 days, independent of the range)
  if (runwayDays != null && driftPerDay30 != null) {
    const days30 = full.days.slice(-30);
    const big = { amount: 0, date: 0, label: "", noun: "" };
    for (const [k, def] of Object.entries(SPEND)) {
      getFull(k)
        .slice(-30)
        .forEach((v, i) => {
          if (v && v > big.amount) Object.assign(big, { amount: v, date: days30[i], label: def.label, noun: SPEND_NOUN[k] ?? def.label.toLowerCase() });
        });
    }
    const drop = -driftPerDay30 * Math.max(1, credits30.length - 1);
    const lumpy = big.amount > drop * 0.5;
    const level: Level = lumpy ? (runwayDays < 30 ? "warning" : "info") : runwayDays < 30 ? "critical" : runwayDays < 90 ? "warning" : "info";
    add({
      id: "cash-runway",
      level,
      area: "cash",
      topic: "runway",
      title: `About **${plural(runwayDays, "day")}** of credits left at the recent pace`,
      figures: [
        { label: "Credits now", value: f(cNow) },
        { label: "Avg change per day (30 days)", value: fs(driftPerDay30), tone: "bad" },
        ...(lumpy ? [{ label: "Largest single spend", value: `${f(big.amount)} · ${big.label}` }] : []),
      ],
      detail: lumpy
        ? `Most of the drop is **one** ==${big.noun}== of **${f(big.amount)}** on _${dl(big.date)}_, so everyday spending is lower than this average suggests.`
        : `Your balance fell by about **${f(-driftPerDay30)}** per in-game day over the last 30 days.`,
      actions: [
        "Sell surplus on the ==Online Market==. _The more of one resource you put on the market, the lower its price_, so sell in batches.",
        "Hold back optional building: ==conveyors and electrical wires cost credits== to lay.",
        ...(runwayDays < 30
          ? ["Need a bridge? The ==Bank== in the Commercial Center offers loans with monthly payments; _the interest rate depends on your global reputation_."]
          : []),
      ],
      source: "Advice from the game’s own texts: the low-balance warning, the Online Market description and the Bank screen.",
    });
  } else if (driftPerDay30 != null && driftPerDay30 > 0) {
    add({
      id: "cash-growing",
      level: "good",
      area: "cash",
      topic: "credits",
      title: `Credits are growing by about **${f(driftPerDay30)} a day**`,
      figures: [
        { label: "Credits now", value: f(cNow) },
        { label: "Avg change per day (30 days)", value: fs(driftPerDay30), tone: "good" },
      ],
      detail: "Your balance rose on average over the last 30 in-game days.",
      actions: ["Keep a buffer: _every capsule shipment, for contracts and for market trades, has a transport cost_."],
      source: "In-game low-balance advisor text.",
    });
  }

  if (days.length > 1 && Math.abs(untracked) > Math.max(1000, Math.abs(cNow - cStart) * 0.25)) {
    add({
      id: "cash-untracked",
      level: "info",
      area: "cash",
      topic: "netCashFlow",
      title: `**${f(Math.abs(untracked))}** credits ${untracked < 0 ? "left" : "arrived"} outside the game’s income and spending categories`,
      figures: [
        { label: "Balance change", value: fs(cNow - cStart) },
        { label: "Explained by categories", value: fs(trackedChange) },
        { label: "Not broken down", value: fs(untracked), tone: untracked < 0 ? "bad" : "good" },
      ],
      detail: "The game’s statistics record contract rewards, trades, construction, penalties, the bank and a few more. The rest of the change isn’t itemized.",
      actions: ["Compare with anything you paid for or received directly in this period that isn’t one of those categories."],
      source: "Stats.bin income and spending series.",
    });
  }

  // Net worth
  const gPct = gStart ? (gNow - gStart) / gStart : null;
  if (gPct != null && days.length > 1 && Math.abs(gPct) >= 0.02) {
    const mover = [...parts].sort((x, y) => Math.abs(y.change) - Math.abs(x.change))[0];
    add({
      id: "networth-change",
      level: gPct > 0 ? "good" : gPct <= -0.1 ? "warning" : "info",
      area: "networth",
      topic: "netWorth",
      title: `Net worth ${gPct > 0 ? "rose" : "fell"} **${Math.abs(Math.round(gPct * 100))}%** in this range`,
      figures: [
        { label: "Net worth now", value: f(gNow) },
        { label: "Change", value: fs(gNow - gStart), tone: gPct > 0 ? "good" : "bad" },
        { label: "Biggest mover", value: `${mover.label} ${fs(mover.change)}` },
      ],
      detail: `The largest shift came from ==${mover.label.toLowerCase()}==.`,
      actions: [
        "Stored resources only become credits when sold, at the market’s price that day.",
        "Modules count at what they cost to build, and drones at their base market price.",
      ],
      source: "Capitalization series in Stats.bin; patch notes on the capitalization calculation (Game.locres).",
    });
  }

  const resCap = lastOf(get("ResourcesCapitalization"));
  if (gNow > 0 && resCap / gNow > 0.35) {
    add({
      id: "networth-stockpiles",
      level: cNow < resCap * 0.05 ? "warning" : "info",
      area: "networth",
      topic: "resources",
      title: `**${Math.round((resCap / gNow) * 100)}%** of your net worth is stored resources`,
      figures: [
        { label: "Stored resources", value: f(resCap) },
        { label: "Credits", value: f(cNow) },
        { label: "Cash share of net worth", value: `${((cNow / gNow) * 100).toFixed(1)}%`, tone: cNow < resCap * 0.05 ? "bad" : undefined },
      ],
      detail: `The game values your stockpiles at **${f(resCap)}** while you hold **${f(cNow)}** credits.`,
      actions: [
        "The game’s valuation can differ from what the market pays today: check the live ==sell prices== in Resources.",
        "Sell in batches: _selling adds supply and lowers the price_.",
      ],
      source: "Capitalization in Stats.bin; in-game Online Market description.",
    });
  }

  // Production: resources that only grow, resources running out
  const hoarded = resources.filter((r) => r.pattern === "accumulating" && r.change > 0 && days.length >= 7).sort((a, b) => b.change - a.change).slice(0, 3);
  if (hoarded.length) {
    const hasSlag = hoarded.some((r) => r.name === "Slag");
    add({
      id: "production-hoarded",
      level: "info",
      area: "production",
      topic: hasSlag ? "slag" : "resources",
      title: `Only ever growing: ${hoarded.map((r) => `**${r.label}**`).join(", ")}`,
      figures: hoarded.map((r) => ({ label: r.label, value: `${fs(r.change)} (now ${f(r.now)})` })),
      detail: "These never dropped in this range, so nothing consumed or sold them.",
      actions: [
        ...(hasSlag ? ["Slag has uses: the ==Smart Concrete Factory== turns slag and silicon into smart concrete, and many ==contracts== ask for slag."] : []),
        "If one is tradable, check its live sell price and position in Resources before selling.",
      ],
      source: hasSlag ? "In-game Smart Concrete Factory and contract texts (Game.locres)." : "Stats.bin resource series.",
    });
  }

  for (const r of resources.filter((r) => r.perDay < 0 && r.now > 0).slice(0, 12)) {
    const left = r.now / -r.perDay;
    if (left >= 30) continue;
    add({
      id: `production-running-out-${r.name}`,
      level: left < 7 ? "serious" : "warning",
      area: "production",
      topic: "resources",
      title: `**${r.label}** runs out in about **${plural(left, "day")}**`,
      figures: [
        { label: "Left", value: f(r.now) },
        { label: "Trend per day", value: `−${Math.abs(r.perDay).toFixed(1)}`, tone: "bad" },
      ],
      detail: `At the current trend of about **${Math.abs(r.perDay).toFixed(1)}** a day.`,
      actions: ["Buy on the ==Online Market== or raise production.", "Set a ==“you hold at most”== alert in Resources to get warned early."],
      source: "Stats.bin resource series (trend over this range).",
    });
  }

  // Income
  if (incomeTotal > 0 && income[0] && income[0].share > 0.8) {
    const top = income[0];
    const incomeDays = incomeDaily.filter((v) => v > 0).length;
    add({
      id: "income-concentration",
      level: "info",
      area: "income",
      topic: top.topic,
      title: `**${Math.round(top.share * 100)}%** of income came from ==${top.label.toLowerCase()}==`,
      figures: [
        { label: top.label, value: f(top.total) },
        { label: "All income", value: f(incomeTotal) },
        { label: "Days with income", value: `${incomeDays} of ${days.length}` },
      ],
      detail: `Income arrived on only **${incomeDays}** of ${days.length} in-game days.`,
      actions: [
        "Add a second source: with ==auto-trading==, client ships buy your resources automatically when your price is competitive.",
        "Mission Control Center upgrades add more simultaneous ==auto-sell orders==.",
      ],
      source: "Dev Diary #25 (auto-trading); in-game upgrade descriptions.",
    });
  } else if (incomeTotal === 0 && days.length > 7) {
    add({
      id: "income-none",
      level: "warning",
      area: "income",
      topic: "income",
      title: "**No recorded income** in this range",
      figures: [
        { label: "Spending", value: f(spendTotal) },
        { label: "Days", value: f(days.length) },
      ],
      detail: "No contract rewards, market sales, point-of-interest rewards, refunds or bank income were recorded.",
      actions: ["Contracts need the ==Access to the Tender System== research and a ==Landing Platform==.", "The ==Online Market== turns surplus into credits."],
      source: "In-game contract system and Online Market descriptions.",
    });
  }

  const penalties = spend.filter((r) => r.key === "ContractPenalty" || r.key === "POIPenalty");
  const penaltyTotal = penalties.reduce((s, r) => s + r.total, 0);
  if (penaltyTotal > 0) {
    add({
      id: "income-penalties",
      level: "warning",
      area: "income",
      topic: "contracts",
      title: `**${f(penaltyTotal)}** credits lost to penalties`,
      figures: penalties.map((r) => ({ label: r.label, value: f(r.total), tone: "bad" as const })),
      detail: "Late and cancelled contracts, and some points of interest, carry penalties.",
      actions: ["Before accepting a contract, remember the AI Analyst’s profit estimate _doesn’t include capsule costs or market demand limits_."],
      source: "In-game contract and AI Analyst texts (Game.locres).",
    });
  }

  const bought = spend.find((r) => r.key === "OutcomeTrades")?.total ?? 0;
  const sold = income.find((r) => r.key === "IncomeTrades")?.total ?? 0;
  if (bought > 0 && sold === 0) {
    add({
      id: "income-bought-not-sold",
      level: "info",
      area: "income",
      topic: "trades",
      title: `Bought **${f(bought)}** on the market and **sold nothing**`,
      figures: [
        { label: "Market purchases", value: f(bought), tone: "bad" },
        { label: "Market sales", value: "0" },
      ],
      detail: "All your market activity in this range was buying.",
      actions: ["Selling surplus offsets purchases. Check which resources you hold that sell above base in Resources."],
      source: "Stats.bin trade series.",
    });
  }

  const construction = spend.find((r) => r.key === "OutcomeConstructions");
  if (construction && spendTotal > 0 && construction.share > 0.5) {
    add({
      id: "income-construction-share",
      level: "info",
      area: "income",
      topic: "construction",
      title: `**${Math.round(construction.share * 100)}%** of spending was construction`,
      figures: [
        { label: "Construction", value: f(construction.total) },
        { label: "All spending", value: f(spendTotal) },
      ],
      detail: "Most of your credits went into building.",
      actions: ["Construction costs are added to your ==capitalization==, so this spending shows up in net worth."],
      source: "Patch notes on the capitalization calculation (Game.locres).",
    });
  }

  // Capacity
  if (cpu.limit > 0) {
    const ratio = cpu.reserved / cpu.limit;
    const smallSolar = lastOf(get("SolarPanelSys"));
    const perDrone = cpu.droneCount > 0 ? cpu.drones / cpu.droneCount : null;
    const figures = [
      { label: "CPU used", value: `${f(cpu.reserved)} / ${f(cpu.limit)}` },
      { label: "Modules", value: f(cpu.modules) },
      { label: "Drones", value: `${f(cpu.drones)}${perDrone ? ` (${Number.isInteger(perDrone) ? perDrone : perDrone.toFixed(1)} each)` : ""}` },
      { label: "Transport", value: f(cpu.transport) },
    ];
    const solarTip = `You run **${f(smallSolar)} Small Solar Panels**: _one Large Solar Panel makes almost as much energy as a dozen Small ones, for far less CPU_.`;
    if (ratio >= 0.75) {
      add({
        id: "capacity-cpu-tight",
        level: ratio >= 0.9 ? "critical" : "warning",
        area: "capacity",
        topic: "cpu",
        title: `CPU is **${Math.round(ratio * 100)}%** used`,
        figures,
        detail: "Every module and drone uses CPU. At the limit you can’t keep building.",
        actions: [
          "Build ==Data Centers== to raise the limit; _they need a lot of microcircuits and microprocessors_.",
          ...(smallSolar >= 8 ? [solarTip] : []),
          "Replace low-efficiency modules: _more technologically advanced modules use less CPU_.",
        ],
        source: "In-game advisor texts about CPU and Data Centers (Game.locres).",
      });
    } else if (ratio < 0.5) {
      add({
        id: "capacity-cpu-ok",
        level: "good",
        area: "capacity",
        topic: "cpu",
        title: `CPU has room: **${f(cpu.reserved)} of ${f(cpu.limit)}** used`,
        figures,
        detail: `About **${Math.round((1 - ratio) * 100)}%** of your CPU is free for new modules and drones.`,
        actions: smallSolar >= 8 ? [`For later: ${solarTip}`] : [],
        source: "In-game advisor texts about CPU (Game.locres).",
      });
    }
  }

  insights.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return {
    days,
    rangeDays: days.length,
    lastDay,
    credits: {
      now: cNow,
      start: cStart,
      change: cNow - cStart,
      series: creditsSeries,
      spark: nums(creditsSeries).slice(-30),
      high,
      low,
      surplusDays: dailyNet.filter((v) => v > 0).length,
      deficitDays: dailyNet.filter((v) => v < 0).length,
      avgNetPerDay: (incomeTotal - spendTotal) / span,
      driftPerDay30,
      runwayDays,
      movements,
    },
    dailyNet,
    netWorth: {
      now: gNow,
      start: gStart,
      change: gNow - gStart,
      changePct: gPct,
      spark: nums(globalSeries).slice(-30),
      parts,
      cashShare: gNow ? cNow / gNow : null,
      lines,
    },
    flows: {
      income,
      spend,
      incomeTotal,
      spendTotal,
      net: incomeTotal - spendTotal,
      untracked,
      incomeDays: incomeDaily.filter((v) => v > 0).length,
      spendDays: spendDaily.filter((v) => v > 0).length,
    },
    cpu,
    modules,
    resources,
    buildings,
    insights,
  };
}
