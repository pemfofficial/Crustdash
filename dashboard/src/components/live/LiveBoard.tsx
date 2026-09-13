"use client";

import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Sparkline } from "@/components/charts/Figures";
import { compact, formatGameClock, formatGameDate, integer, signed, signedPercent } from "@/components/charts/format";
import { NotificationSummary, type Bucket } from "@/components/notifications/Notifications";
import { openTasks, stepProgressText } from "@/components/tasks/TaskCenter";
import type { MissionsState } from "@/components/tasks/useMissions";
import { Modal } from "@/components/ui/Modal";
import { WikiLink } from "@/components/ui/RichText";
import { useTasks } from "@/lib/client/taskStore";
import { useStoredState } from "@/lib/client/useStoredState";
import { CREDITS_TARGET } from "@/lib/crust/alerts";
import type { MarketRow } from "@/lib/crust/market";
import { wikiForResource } from "@/lib/wiki/client";
import { useLive, type LiveData } from "./LiveProvider";
import { LiveSessionCharts } from "./LiveSessionCharts";
import { FOCUS_RESOURCE_EVENT, showResource, usePrefs } from "./PrefsProvider";
import { useMarketRows, useResourceLabel } from "./useMarketRows";

export type BoardContext = {
  holdings: Record<string, number>;
  holdingsSource: "live" | "save";
  savedCredits: number | null;
  /** The running game has another save loaded (or didn't say which). */
  mismatch: boolean;
  isLiveRange: boolean;
  notifications: Record<Bucket, number>;
  missions: MissionsState;
  profileName: string;
};

type Size = 1 | 2 | 3 | 4;
type WidgetProps = { ctx: BoardContext; live: LiveData; rows: MarketRow[]; resource?: string };
type Group = "Colony" | "Economy" | "Resources" | "Market" | "Missions & tasks" | "Session";
type WidgetDef = { label: string; group: Group; blurb: string; size: Size; needsResource?: boolean; Component: (p: WidgetProps) => ReactNode };
export type Placed = { uid: string; type: string; size: Size; resource?: string };
type Layout = { label: string; widgets: Placed[] };
type Board = { active: string; layouts: Record<string, Layout> };

const DASH = "—";
/** A fresh id for a widget or saved layout (call from event handlers). */
const newUid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const glossaryValue = (live: LiveData, address: string) => live.glossary[address]?.value ?? null;
const shown = (v: number | null, fmt: (n: number) => string = integer) => (v == null ? DASH : fmt(v));

function Readout({ value, sub, tone }: { value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <>
      <div className={`w-value${tone ? ` tone-${tone}` : ""}`}>{value}</div>
      {sub && <div className="w-sub">{sub}</div>}
    </>
  );
}

// ------------------------------------------------------------------ widgets
function ClockWidget({ live }: WidgetProps) {
  const t = live.inGameTime;
  if (!t) return <Readout value={DASH} sub="Waiting for the game" />;
  return <Readout value={formatGameClock(t)} sub={`${formatGameDate(t)}, ${live.paused ? "paused" : "running"}`} />;
}

function CreditsWidget({ ctx, live }: WidgetProps) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const onFocus = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== CREDITS_TARGET) return;
      setFlash(true);
      window.setTimeout(() => document.getElementById("live-credits")?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
      window.setTimeout(() => setFlash(false), 3400);
    };
    window.addEventListener(FOCUS_RESOURCE_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_RESOURCE_EVENT, onFocus);
  }, []);
  const credits = ctx.mismatch ? ctx.savedCredits : (live.credits ?? ctx.savedCredits);
  const monthStart = ctx.mismatch ? null : (live.game?.CreditsAtMonthStart ?? null);
  const change = credits != null && monthStart != null ? credits - monthStart : null;
  return (
    <div id="live-credits" className={`w-flash${flash ? " flash" : ""}`}>
      <Readout
        value={shown(credits)}
        tone={change == null ? undefined : change >= 0 ? "good" : "bad"}
        sub={ctx.mismatch || live.credits == null ? "From the last save" : change != null ? `${signed(change, integer)} this in-game month` : "Live"}
      />
    </div>
  );
}

function NetWorthWidget({ ctx, live }: WidgetProps) {
  const v = ctx.mismatch ? null : glossaryValue(live, "G.Stats.GlobalCapitalisation");
  return <Readout value={shown(v, compact)} sub={v == null ? "Needs the matching save running" : `${integer(Math.floor(v / 1000))} capitalization points`} />;
}

function StockpileWidget({ ctx, rows }: WidgetProps) {
  const total = rows.reduce((s, r) => s + r.heldValue, 0);
  return <Readout value={compact(total)} sub={ctx.holdingsSource === "live" ? "Live holdings at sell prices" : "Last save’s holdings at sell prices"} />;
}

function ElectricityWidget({ live }: WidgetProps) {
  const v = glossaryValue(live, "G.Stats.ElectricityBalance");
  return <Readout value={shown(v, (n) => signed(n, integer))} tone={v == null ? undefined : v >= 0 ? "good" : "bad"} sub={v == null ? DASH : v >= 0 ? "Power surplus" : "Power deficit"} />;
}

function CpuWidget({ live }: WidgetProps) {
  return <Readout value={shown(glossaryValue(live, "G.Balance.AvailableCPU"))} sub="CPU available for modules and drones" />;
}

function ResearchWidget({ live }: WidgetProps) {
  const lines: [string, string][] = [
    ["Fundamental", "G.Research.FunIncome"],
    ["Engineering", "G.Research.EngIncome"],
    ["Social", "G.Research.SocIncome"],
  ];
  return (
    <dl className="w-split">
      {lines.map(([label, address]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{shown(glossaryValue(live, address))}</dd>
        </div>
      ))}
    </dl>
  );
}

function DronesWidget({ live }: WidgetProps) {
  const total = glossaryValue(live, "G.Stats.DroneCount");
  const standard = glossaryValue(live, "G.Stats.DefaultRobotCount");
  const mining = glossaryValue(live, "G.Stats.MinerRobotCount");
  return <Readout value={shown(total)} sub={standard == null ? DASH : `${integer(standard)} standard, ${integer(mining ?? 0)} mining`} />;
}

function ColonistsWidget({ live }: WidgetProps) {
  return <Readout value={shown(glossaryValue(live, "G.Stats.ColonistCount"))} sub="Colonists on the base" />;
}

function ModulesWidget({ live }: WidgetProps) {
  const counts = Object.entries(live.glossary).filter(([a]) => /^G\.Stats\.\w+SysCount$/i.test(a) && !/RuinedMeteor/i.test(a));
  const total = counts.reduce((s, [, e]) => s + (e.value ?? 0), 0);
  return <Readout value={counts.length ? integer(total) : DASH} sub="Modules built (ruins not counted)" />;
}

function ReputationWidget({ live }: WidgetProps) {
  return (
    <Readout
      value={shown(glossaryValue(live, "G.Balance.GlobalReputation"))}
      sub={
        <>
          Global reputation, see <WikiLink id="bank-and-reputation">what it affects</WikiLink>
        </>
      }
    />
  );
}

function ResourceWidget({ rows, resource, ctx }: WidgetProps) {
  const label = useResourceLabel();
  const row = rows.find((r) => r.name === resource);
  if (!resource) return <Readout value={DASH} sub="Pick a resource in Customize" />;
  const held = row?.held ?? ctx.holdings[resource] ?? null;
  const wiki = wikiForResource(resource);
  return (
    <button
      type="button"
      className="w-button"
      onClick={() => showResource(resource)}
    >
      <Readout value={shown(held)} sub={row?.sell != null ? `Sells for ${integer(row.sell)}, ${signedPercent(row.vsBase)} vs base` : wiki ? `${label(resource)} (not traded)` : label(resource)} />
      {row && row.sellHistory.length > 1 && <Sparkline values={row.sellHistory} width={150} height={30} />}
    </button>
  );
}

const KEY_RESOURCES = ["Regolith", "TitanOxide", "IronOxide", "SiliconOxide", "Titan", "Steel", "Silicon", "Concrete", "Parts", "TitanPlate", "Microchip", "Slag"];

function KeyResourcesWidget({ rows, ctx }: WidgetProps) {
  const label = useResourceLabel();
  return (
    <ul className="w-resources">
      {KEY_RESOURCES.map((name) => {
        const row = rows.find((r) => r.name === name);
        const held = row?.held ?? ctx.holdings[name] ?? 0;
        return (
          <li key={name}>
            <button
              type="button"
              className="w-resource"
              onClick={() => showResource(name)}
            >
              <span className="w-resource-name">{label(name)}</span>
              <span className="w-resource-held">{integer(held)}</span>
              <span className="w-resource-price">{row?.sell != null ? `${integer(row.sell)} cr` : "not traded"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TopHoldingsWidget({ rows }: WidgetProps) {
  const top = [...rows].filter((r) => r.heldValue > 0).sort((a, b) => b.heldValue - a.heldValue).slice(0, 8);
  if (!top.length) return <Readout value={DASH} sub="Nothing held that the market buys" />;
  return (
    <table className="w-table">
      <thead>
        <tr>
          <th scope="col">Resource</th>
          <th scope="col" className="num">
            Held
          </th>
          <th scope="col" className="num">
            Worth
          </th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => (
          <tr key={r.name}>
            <td>{r.label}</td>
            <td className="num">{integer(r.held)}</td>
            <td className="num">{compact(r.heldValue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PinnedWidget({ rows }: WidgetProps) {
  const { pins } = usePrefs();
  const pinned = rows.filter((r) => pins[r.name]);
  if (!pinned.length) return <p className="w-sub">Pin resources with ☆ in the Resources table and they appear here.</p>;
  return (
    <div className="pinned-cards">
      {pinned.map((r) => (
        <button
          key={r.name}
          type="button"
          className="pinned-card"
          style={{ ["--pin" as string]: pins[r.name] } as CSSProperties}
          onClick={() => showResource(r.name)}
        >
          <span className="pinned-name">{r.label}</span>
          <span className="pinned-prices">
            <strong>{r.sell == null ? DASH : integer(r.sell)}</strong> sell, <strong>{r.buy == null ? DASH : integer(r.buy)}</strong> buy
          </span>
          <span className="muted">
            {signedPercent(r.vsBase)} vs base, hold {integer(r.held)}
          </span>
          {r.sellHistory.length > 1 && <Sparkline values={r.sellHistory} width={150} height={30} />}
        </button>
      ))}
    </div>
  );
}

function MarketPulseWidget({ rows }: WidgetProps) {
  const above = rows.filter((r) => r.vsBase > 0.05).length;
  const below = rows.filter((r) => r.vsBase < -0.05).length;
  return <Readout value={rows.length ? `${above} of ${rows.length}` : DASH} sub={`priced above base, ${below} below`} />;
}

function MoversWidget({ rows }: WidgetProps) {
  const movers = rows.filter((r) => r.sell != null).sort((a, b) => Math.abs(b.vsBase) - Math.abs(a.vsBase)).slice(0, 6);
  if (!movers.length) return <Readout value={DASH} sub="Waiting for live prices" />;
  return (
    <ul className="w-list">
      {movers.map((r) => (
        <li key={r.name}>
          <span>{r.label}</span>
          <span className={r.vsBase >= 0 ? "tone-good" : "tone-bad"}>{signedPercent(r.vsBase)}</span>
        </li>
      ))}
    </ul>
  );
}

function CheapBuysWidget({ rows }: WidgetProps) {
  const cheap = rows.filter((r) => r.buy != null && r.buyRangePos != null && r.buyRangePos <= 0.2).sort((a, b) => (a.buyRangePos ?? 0) - (b.buyRangePos ?? 0)).slice(0, 6);
  if (!cheap.length) return <Readout value={DASH} sub="Nothing near its 30-day low" />;
  return (
    <ul className="w-list">
      {cheap.map((r) => (
        <li key={r.name}>
          <span>{r.label}</span>
          <span>{integer(r.buy ?? 0)} cr</span>
        </li>
      ))}
    </ul>
  );
}

function MissionsWidget({ ctx }: WidgetProps) {
  const { missions, loaded } = ctx.missions;
  if (!missions.length) return <Readout value={loaded ? "None" : DASH} sub={loaded ? "No missions in progress in the last save" : "Reading your save…"} />;
  return (
    <ul className="w-missions">
      {missions.slice(0, 3).map((m) => (
        <li key={m.id}>
          <button type="button" className="w-mission" onClick={() => openTasks(m.id)}>
            <span className="w-mission-name">{m.name}</span>
            <span className="w-mission-step">{m.current?.name ?? (m.startedThisSession ? "Steps appear after the next save" : "All steps done")}</span>
            {m.current && stepProgressText(m.current) && <span className="w-sub">{stepProgressText(m.current)}</span>}
            {m.total > 0 && (
              <span className="mission-row-bar" aria-hidden>
                <span style={{ width: `${(m.done / m.total) * 100}%` }} />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function TasksWidget({ ctx }: WidgetProps) {
  const { tasks } = useTasks();
  const open = tasks.filter((t) => !t.done && (t.profile == null || t.profile === ctx.profileName));
  return (
    <button type="button" className="w-button" onClick={() => openTasks()}>
      <Readout value={integer(open.length)} sub={open.length ? open.slice(0, 3).map((t) => t.title).join("; ") : "No open tasks"} />
    </button>
  );
}

function NotificationsWidget({ ctx }: WidgetProps) {
  return <NotificationSummary counts={ctx.notifications} />;
}

function SessionWidget({ ctx }: WidgetProps) {
  const { pins } = usePrefs();
  return ctx.isLiveRange ? (
    <LiveSessionCharts pins={pins} />
  ) : (
    <p className="w-sub">
      Pick <strong>● Live</strong> under Save history in the menu to chart credits and prices across this play session.
    </p>
  );
}

export const WIDGETS: Record<string, WidgetDef> = {
  clock: { label: "In-game time", group: "Colony", blurb: "Date and clock, and whether the game is paused.", size: 1, Component: ClockWidget },
  credits: { label: "Credits", group: "Economy", blurb: "Live balance and this in-game month’s change.", size: 1, Component: CreditsWidget },
  netWorth: { label: "Net worth", group: "Economy", blurb: "Capitalization, as the game values your company.", size: 1, Component: NetWorthWidget },
  stockpile: { label: "Stockpile worth", group: "Economy", blurb: "Your holdings at today’s sell prices.", size: 1, Component: StockpileWidget },
  reputation: { label: "Reputation", group: "Economy", blurb: "Global reputation: loans, prices and the hiring pool.", size: 1, Component: ReputationWidget },
  electricity: { label: "Power balance", group: "Colony", blurb: "Generation minus consumption right now.", size: 1, Component: ElectricityWidget },
  cpu: { label: "CPU", group: "Colony", blurb: "Computing power available to modules and drones.", size: 1, Component: CpuWidget },
  research: { label: "Research income", group: "Colony", blurb: "Science points a day, by branch.", size: 2, Component: ResearchWidget },
  drones: { label: "Drones", group: "Colony", blurb: "Standard and mining drones.", size: 1, Component: DronesWidget },
  colonists: { label: "Colonists", group: "Colony", blurb: "People living on the base.", size: 1, Component: ColonistsWidget },
  modules: { label: "Modules", group: "Colony", blurb: "Everything built, as the game counts it.", size: 1, Component: ModulesWidget },
  resource: { label: "Resource", group: "Resources", blurb: "One resource: holdings, price and 30-day trend.", size: 1, needsResource: true, Component: ResourceWidget },
  keyResources: { label: "Key resources", group: "Resources", blurb: "The raw and refined materials you check most.", size: 4, Component: KeyResourcesWidget },
  topHoldings: { label: "Top holdings", group: "Resources", blurb: "What your stockpile is worth, biggest first.", size: 2, Component: TopHoldingsWidget },
  pinned: { label: "Pinned resources", group: "Resources", blurb: "The resources you pinned in the Resources table.", size: 4, Component: PinnedWidget },
  marketPulse: { label: "Market pulse", group: "Market", blurb: "How many prices sit above or below base.", size: 1, Component: MarketPulseWidget },
  movers: { label: "Biggest price moves", group: "Market", blurb: "Resources furthest from their base price.", size: 2, Component: MoversWidget },
  cheapBuys: { label: "Cheap to buy", group: "Market", blurb: "Buy prices near their 30-day low.", size: 2, Component: CheapBuysWidget },
  missions: { label: "Missions", group: "Missions & tasks", blurb: "The current step of each mission, with live progress.", size: 2, Component: MissionsWidget },
  tasks: { label: "Tasks", group: "Missions & tasks", blurb: "Your open tasks.", size: 1, Component: TasksWidget },
  notifications: { label: "Notifications", group: "Missions & tasks", blurb: "Urgent, pressing and recommended items.", size: 2, Component: NotificationsWidget },
  session: { label: "This session", group: "Session", blurb: "Credits and prices across this play session.", size: 4, Component: SessionWidget },
};

const GROUP_ORDER: Group[] = ["Colony", "Economy", "Resources", "Market", "Missions & tasks", "Session"];

const layout = (label: string, spec: [string, Size?, string?][]): Layout => ({
  label,
  widgets: spec.map(([type, size, resource], i) => ({ uid: `${type}-${i}`, type, size: size ?? WIDGETS[type].size, ...(resource ? { resource } : {}) })),
});

// The default mirrors what the game keeps on screen: time, money, power, research, CPU, drones, the mission tracker
const PRESETS: Record<string, Layout> = {
  hud: layout("In-game HUD", [
    ["clock"],
    ["credits"],
    ["electricity"],
    ["cpu"],
    ["research"],
    ["drones"],
    ["netWorth"],
    ["missions"],
    ["notifications"],
    ["keyResources"],
    ["pinned"],
    ["stockpile"],
    ["marketPulse"],
    ["reputation"],
    ["tasks"],
  ]),
  trader: layout("Trader", [["credits"], ["stockpile"], ["marketPulse"], ["reputation"], ["movers"], ["cheapBuys"], ["topHoldings", 2], ["pinned"], ["session"]]),
  builder: layout("Builder", [["electricity"], ["cpu"], ["drones"], ["modules"], ["missions"], ["tasks"], ["colonists"], ["keyResources"], ["research"], ["notifications"]]),
  minimal: layout("Minimal", [["clock"], ["credits"], ["missions"]]),
};
const DEFAULT_BOARD: Board = { active: "hud", layouts: PRESETS };

function AddWidgetModal({ rows, onAdd, onClose, present }: { rows: MarketRow[]; onAdd: (type: string, resource?: string) => void; onClose: () => void; present: Set<string> }) {
  const [query, setQuery] = useState("");
  const [resource, setResource] = useState("");
  const label = useResourceLabel();
  const ids = useId();
  const q = query.trim().toLowerCase();
  const matches = Object.entries(WIDGETS).filter(([, d]) => !q || `${d.label} ${d.blurb} ${d.group}`.toLowerCase().includes(q));
  const resources = [...rows].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Modal open onClose={onClose} label="Add a widget" size="lg">
      <div className="board-add">
        <div className="modal-head">
          <h2 className="modal-title">Add a widget</h2>
          <p className="modal-sub">Widgets read the running game live. Customize again any time to move, resize or remove them.</p>
        </div>
        <input className="text-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search widgets" aria-label="Search widgets" data-autofocus />
        {GROUP_ORDER.map((group) => {
          const items = matches.filter(([, d]) => d.group === group);
          if (!items.length) return null;
          return (
            <section key={group} className="board-add-group" aria-labelledby={`${ids}-${group}`}>
              <h3 id={`${ids}-${group}`} className="mission-h">
                {group}
              </h3>
              <ul className="board-add-list">
                {items.map(([type, d]) => (
                  <li key={type} className="board-add-item">
                    <span className="board-add-name">{d.label}</span>
                    <span className="board-add-blurb">{d.blurb}</span>
                    {d.needsResource ? (
                      <span className="board-add-row">
                        <select className="text-input" value={resource} onChange={(e) => setResource(e.target.value)} aria-label="Resource for this widget">
                          <option value="">Choose a resource</option>
                          {resources.map((r) => (
                            <option key={r.name} value={r.name}>
                              {label(r.name)}
                            </option>
                          ))}
                        </select>
                        <button type="button" className="btn" disabled={!resource} onClick={() => onAdd(type, resource)}>
                          Add
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn" onClick={() => onAdd(type)}>
                        {present.has(type) ? "Add another" : "Add"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

/** Live now as a board of widgets you arrange yourself. Layouts are saved in this browser. */
export function LiveBoard({ ctx }: { ctx: BoardContext }) {
  const live = useLive();
  const rows = useMarketRows(ctx.holdings);
  const label = useResourceLabel();
  const [stored, setBoard] = useStoredState<Board>("crustdash:live-board", DEFAULT_BOARD);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);

  const board: Board = useMemo(() => {
    const layouts = { ...PRESETS, ...stored.layouts };
    return { active: layouts[stored.active] ? stored.active : "hud", layouts };
  }, [stored]);
  const current = board.layouts[board.active];
  const widgets = current.widgets.filter((w) => WIDGETS[w.type]);
  const isPreset = board.active in PRESETS;

  const setWidgets = (next: Placed[]) => setBoard((b) => ({ active: board.active, layouts: { ...PRESETS, ...b.layouts, [board.active]: { ...current, widgets: next } } }));
  const move = (uid: string, to: number) => {
    const from = widgets.findIndex((w) => w.uid === uid);
    if (from < 0 || to < 0 || to >= widgets.length || from === to) return;
    const next = [...widgets];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setWidgets(next);
  };
  const resize = (uid: string, delta: 1 | -1) => setWidgets(widgets.map((w) => (w.uid === uid ? { ...w, size: Math.max(1, Math.min(4, w.size + delta)) as Size } : w)));
  const remove = (uid: string) => setWidgets(widgets.filter((w) => w.uid !== uid));
  const titleOf = (w: Placed) => (w.type === "resource" && w.resource ? label(w.resource) : WIDGETS[w.type].label);

  return (
    <div className="board-wrap">
      <div className="board-toolbar">
        <label className="board-layout">
          <span className="field-label">Layout</span>
          <select className="text-input" value={board.active} onChange={(e) => setBoard((b) => ({ ...b, active: e.target.value }))}>
            {Object.entries(board.layouts).map(([id, l]) => (
              <option key={id} value={id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        {editing && newName == null && (
          <>
            <button type="button" className="btn" onClick={() => setAdding(true)}>
              Add widget
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setNewName(`${current.label} copy`)}>
              Save as new layout
            </button>
            {isPreset ? (
              <button type="button" className="btn btn-quiet" onClick={() => setWidgets(PRESETS[board.active].widgets)}>
                Reset to default
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-quiet danger"
                onClick={() =>
                  setBoard((b) => {
                    const layouts = { ...b.layouts };
                    delete layouts[board.active];
                    return { active: "hud", layouts };
                  })
                }
              >
                Delete layout
              </button>
            )}
          </>
        )}
        {newName != null && (
          <form
            className="board-name"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              const id = newUid("custom");
              setBoard((b) => ({ active: id, layouts: { ...b.layouts, [id]: { label: name, widgets } } }));
              setNewName(null);
            }}
          >
            <input className="text-input" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Layout name" autoFocus />
            <button type="submit" className="btn btn-primary">
              Save
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setNewName(null)}>
              Cancel
            </button>
          </form>
        )}
        <button type="button" className={`btn${editing ? " btn-primary" : ""}`} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? "Done" : "Customize"}
        </button>
      </div>
      {editing && <p className="board-hint">Drag widgets to reorder, or use the arrows. Changes save as you make them.</p>}

      <div className={`board${editing ? " is-editing" : ""}`}>
        {widgets.map((w, i) => {
          const def = WIDGETS[w.type];
          const Component = def.Component;
          return (
            <section
              key={w.uid}
              className={`widget size-${w.size}${dragging === w.uid ? " is-dragging" : ""}`}
              aria-label={titleOf(w)}
              draggable={editing}
              onDragStart={(e) => {
                setDragging(w.uid);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (editing && dragging) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) move(dragging, i);
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <header className="widget-head">
                <h2 className="widget-title">{titleOf(w)}</h2>
                {editing && (
                  <div className="widget-tools">
                    <button type="button" className="icon-btn" aria-label={`Move ${titleOf(w)} earlier`} disabled={i === 0} onClick={() => move(w.uid, i - 1)}>
                      ◀
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Move ${titleOf(w)} later`} disabled={i === widgets.length - 1} onClick={() => move(w.uid, i + 1)}>
                      ▶
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Make ${titleOf(w)} narrower`} disabled={w.size === 1} onClick={() => resize(w.uid, -1)}>
                      −
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Make ${titleOf(w)} wider`} disabled={w.size === 4} onClick={() => resize(w.uid, 1)}>
                      +
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${titleOf(w)}`} onClick={() => remove(w.uid)}>
                      ✕
                    </button>
                  </div>
                )}
              </header>
              <div className="widget-body">
                <Component ctx={ctx} live={live} rows={rows} resource={w.resource} />
              </div>
            </section>
          );
        })}
        {editing && (
          <button type="button" className="widget-add" onClick={() => setAdding(true)}>
            + Add widget
          </button>
        )}
      </div>

      {adding && (
        <AddWidgetModal
          rows={rows}
          present={new Set(widgets.map((w) => w.type))}
          onClose={() => setAdding(false)}
          onAdd={(type, resource) => {
            setWidgets([...widgets, { uid: newUid(type), type, size: WIDGETS[type].size, ...(resource ? { resource } : {}) }]);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
