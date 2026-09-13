"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { compact, integer } from "@/components/charts/format";
import { usePrefs } from "@/components/live/PrefsProvider";
import { useMarketRows } from "@/components/live/useMarketRows";
import { evaluateExpression, toPlainNumber } from "@/lib/calc/expression";
import type { GameTime, MarketRow } from "@/lib/crust/market";

type Mode = "keypad" | "trade" | "contract" | "goal";
const MODES: { id: Mode; label: string }[] = [
  { id: "keypad", label: "Keypad" },
  { id: "trade", label: "Trade" },
  { id: "contract", label: "Contract" },
  { id: "goal", label: "Goal" },
];

type Props = {
  holdings: Record<string, number>;
  holdingsSource: "live" | "save";
  /** Credits for this profile: live when the running game has this save loaded, else the last save's. */
  credits: number | null;
  creditsSource: "live" | "save";
  /** In-game date for this profile, when the running game has this save loaded. */
  gameTime: GameTime | null;
  /** Recorded income minus spending per day over the chosen range. */
  recordedNetPerDay: number;
  /** Average balance change per day over the last 30 in-game days. */
  trendPerDay: number | null;
  size?: "full" | "compact";
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });
const signedCr = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${integer(Math.abs(n))} cr`;
const num = (s: string) => {
  const v = Number(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
};

/** The colony calculator: a keypad, plus trade, contract and credit-goal calculators fed by live data. */
export function Calculator({ holdings, holdingsSource, credits, creditsSource, gameTime, recordedNetPerDay, trendPerDay, size = "full" }: Props) {
  const [mode, setMode] = useState<Mode>("keypad");
  return (
    <div className={`calc-device${size === "compact" ? " is-compact" : ""}`}>
      <div className="calc-bezel" aria-hidden />
      <div className="calc-modes" role="tablist" aria-label="Calculator mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className="calc-mode" onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={MODES.find((m) => m.id === mode)?.label}>
        {mode === "keypad" && <Keypad credits={credits} creditsSource={creditsSource} />}
        {mode === "trade" && <TradeCalc holdings={holdings} holdingsSource={holdingsSource} credits={credits} />}
        {mode === "contract" && <ContractCalc holdings={holdings} />}
        {mode === "goal" && <GoalCalc recordedNetPerDay={recordedNetPerDay} trendPerDay={trendPerDay} credits={credits} creditsSource={creditsSource} gameTime={gameTime} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ keypad

const KEYS = ["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "±", "0", ".", "="];
const KEY_MAP: Record<string, string> = { "*": "×", "/": "÷", "-": "−", "+": "+", Enter: "=", "=": "=", Backspace: "⌫", Escape: "C", "(": "(", ")": ")", ".": ".", "%": "%", "^": "^" };

function Keypad({ credits, creditsSource }: { credits: number | null; creditsSource: "live" | "save" }) {
  const [expr, setExpr] = useState("");
  const [tape, setTape] = useState<{ id: number; expr: string; result: string }[]>([]);
  const preview = evaluateExpression(expr);

  const press = (key: string) => {
    if (key === "C") return setExpr("");
    if (key === "⌫") return setExpr((e) => e.slice(0, -1));
    if (key === "=") {
      const r = evaluateExpression(expr);
      if (r.ok) {
        setTape((t) => [{ id: Date.now(), expr, result: fmt(r.value) }, ...t].slice(0, 8));
        setExpr(toPlainNumber(r.value));
      }
      return;
    }
    if (key === "±") return setExpr((e) => (e.startsWith("−(") && e.endsWith(")") ? e.slice(2, -1) : e ? `−(${e})` : "−"));
    setExpr((e) => e + key);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLButtonElement && e.key === "Enter") return; // let Enter activate a focused key
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      press(e.key);
    } else if (KEY_MAP[e.key]) {
      e.preventDefault();
      press(KEY_MAP[e.key]);
    }
  };

  return (
    <div className="calc-keypad" tabIndex={0} onKeyDown={onKeyDown} aria-label="Keypad. Type numbers and operators; Enter calculates, Escape clears.">
      <div className="calc-screen" aria-live="polite">
        {tape.length > 0 && (
          <ol className="calc-tape" aria-label="Recent results">
            {[...tape].reverse().map((t) => (
              <li key={t.id}>
                <span>{t.expr}</span>
                <span>= {t.result}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="calc-expr">{expr || "0"}</div>
        <div className="calc-result">{expr && preview.ok ? `= ${fmt(preview.value)}` : expr && !preview.ok ? preview.error : " "}</div>
      </div>
      <div className="calc-inserts">
        {credits != null && (
          <button type="button" className="calc-chip" onClick={() => press(String(Math.round(credits)))}>
            Insert {creditsSource === "live" ? "live" : "saved"} credits ({integer(credits)})
          </button>
        )}
        <button type="button" className="calc-chip" onClick={() => press("%")}>%</button>
        <button type="button" className="calc-chip" onClick={() => press("^")}>xʸ</button>
        <button type="button" className="calc-chip" onClick={() => press("⌫")} aria-label="Delete last character">⌫</button>
      </div>
      <div className="calc-keys">
        {KEYS.map((k) => (
          <button key={k} type="button" className={`calc-key${"÷×−+".includes(k) ? " op" : ""}${k === "=" ? " eq" : ""}${k === "C" ? " clear" : ""}`} onClick={() => press(k)}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ shared bits

function useTradableRows(holdings: Record<string, number>) {
  const rows = useMarketRows(holdings);
  const { pins } = usePrefs();
  return useMemo(() => [...rows].sort((a, b) => (pins[b.name] ? 1 : 0) - (pins[a.name] ? 1 : 0) || a.label.localeCompare(b.label)), [rows, pins]);
}

function ResourceSelect({ rows, value, onChange, label = "Resource" }: { rows: MarketRow[]; value: string; onChange: (name: string) => void; label?: string }) {
  const { pins } = usePrefs();
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="text-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {rows.map((r) => (
          <option key={r.name} value={r.name}>
            {pins[r.name] ? "★ " : ""}
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Readout({ rows }: { rows: { label: string; value: string; tone?: "good" | "bad"; big?: boolean }[] }) {
  return (
    <dl className="calc-screen calc-readout">
      {rows.map((r) => (
        <div key={r.label} className={`calc-readout-row${r.big ? " big" : ""}`}>
          <dt>{r.label}</dt>
          <dd className={r.tone ? `screen-${r.tone}` : undefined}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const MarketOffline = () => <p className="calc-note">Market prices come from the running game. Start The Crust and load a save to use this.</p>;

// ------------------------------------------------------------------ trade

function TradeCalc({ holdings, holdingsSource, credits }: { holdings: Record<string, number>; holdingsSource: "live" | "save"; credits: number | null }) {
  const rows = useTradableRows(holdings);
  const [name, setName] = useState("");
  const [side, setSide] = useState<"sell" | "buy">("sell");
  const [qty, setQty] = useState("100");
  if (!rows.length) return <MarketOffline />;

  const r = rows.find((x) => x.name === name) ?? rows[0];
  const q = Math.max(0, Math.floor(num(qty)));
  const price = side === "sell" ? r.sell : r.buy;
  const quick =
    side === "sell"
      ? [
          { label: `All I hold (${integer(r.held)})`, value: r.held },
          { label: `Room left in market (${integer(r.headroom)})`, value: r.headroom },
        ]
      : [{ label: `Market supply (${integer(r.volume)})`, value: r.volume }];

  return (
    <div className="calc-form">
      <div className="calc-fields">
        <ResourceSelect rows={rows} value={r.name} onChange={setName} />
        <fieldset className="field">
          <legend className="field-label">Order</legend>
          <div className="segmented" role="radiogroup" aria-label="Buy or sell">
            {(["sell", "buy"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={side === s} className="seg-btn" onClick={() => setSide(s)}>
                {s === "sell" ? "Sell" : "Buy"}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span className="field-label">Quantity</span>
          <input className="text-input" type="number" inputMode="numeric" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
      </div>
      <div className="calc-inserts">
        {quick.map((b) => (
          <button key={b.label} type="button" className="calc-chip" onClick={() => setQty(String(Math.floor(b.value)))}>
            {b.label}
          </button>
        ))}
      </div>

      {price == null ? (
        <p className="calc-warn">{r.label} can’t be {side === "sell" ? "sold" : "bought"} on the market.</p>
      ) : (
        <>
          <Readout
            rows={[
              { label: side === "sell" ? "You receive" : "You pay", value: `${integer(q * price)} cr`, big: true },
              { label: "Price per unit", value: `${integer(price)} cr` },
              { label: "Compared with base price", value: signedCr(q * (price - r.base)), tone: (side === "sell" ? price >= r.base : price <= r.base) ? "good" : "bad" },
              ...(credits != null ? [{ label: "Credits after", value: `${integer(credits + (side === "sell" ? q * price : -q * price))} cr` }] : []),
              { label: `You’d hold (${holdingsSource === "live" ? "live" : "from last save"})`, value: integer(Math.max(0, r.held + (side === "sell" ? -q : q))) },
              ...(r.buy != null && r.sell != null ? [{ label: "Buy-then-sell spread", value: signedCr(-(r.buy - r.sell) * q), tone: "bad" as const }] : []),
            ]}
          />
          {side === "sell" && q > r.held && <p className="calc-warn">You hold {integer(r.held)}, fewer than {integer(q)}.</p>}
          {side === "sell" && q > r.headroom && (
            <p className="calc-warn">
              The market can take about {integer(r.headroom)} more before its supply maxes out. Selling past that pushes the price toward its floor of {integer(r.bandMin)}.
            </p>
          )}
          {side === "buy" && q > r.volume && <p className="calc-warn">The market holds {integer(r.volume)} right now.</p>}
          <p className="calc-note">Uses today’s price. Prices move with supply as you trade, and each capsule shipment has a transport cost that isn’t included.</p>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ contract

type Line = { id: number; name: string; qty: string };

function ContractCalc({ holdings }: { holdings: Record<string, number> }) {
  const rows = useTradableRows(holdings);
  const [reward, setReward] = useState("100000");
  const [capsule, setCapsule] = useState("0");
  const [lines, setLines] = useState<Line[]>([{ id: 1, name: "", qty: "100" }]);
  if (!rows.length) return <MarketOffline />;

  const priced = lines.map((line) => {
    const r = rows.find((x) => x.name === line.name) ?? rows[0];
    const q = Math.max(0, Math.floor(num(line.qty)));
    const fromStock = Math.min(q, Math.max(0, r.held));
    const shortfall = q - fromStock;
    return {
      line,
      r,
      q,
      buyAll: r.buy != null ? q * r.buy : null,
      mixed: r.sell != null && r.buy != null ? fromStock * r.sell + shortfall * r.buy : shortfall === 0 && r.sell != null ? q * r.sell : null,
      fromStock,
      shortfall,
    };
  });
  const incomplete = priced.some((p) => p.buyAll == null || p.mixed == null);
  const buyAll = priced.reduce((s, p) => s + (p.buyAll ?? 0), 0);
  const mixed = priced.reduce((s, p) => s + (p.mixed ?? 0), 0);
  const capsuleCost = num(capsule);
  const profitBuy = num(reward) - buyAll - capsuleCost;
  const profitStock = num(reward) - mixed - capsuleCost;
  const update = (id: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <div className="calc-form">
      <div className="calc-fields">
        <label className="field">
          <span className="field-label">Contract reward (credits)</span>
          <input className="text-input" type="number" inputMode="numeric" value={reward} onChange={(e) => setReward(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Capsule cost (credits)</span>
          <input className="text-input" type="number" inputMode="numeric" value={capsule} onChange={(e) => setCapsule(e.target.value)} />
        </label>
      </div>

      <fieldset className="field calc-lines">
        <legend className="field-label">Resources the contract asks for</legend>
        {priced.map(({ line, r, q, fromStock, shortfall }) => (
          <div key={line.id} className="calc-line">
            <select className="text-input" aria-label="Resource" value={r.name} onChange={(e) => update(line.id, { name: e.target.value })}>
              {rows.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.label}
                </option>
              ))}
            </select>
            <input className="text-input" type="number" inputMode="numeric" aria-label={`Quantity of ${r.label}`} value={line.qty} onChange={(e) => update(line.id, { qty: e.target.value })} />
            <button type="button" className="icon-btn" aria-label={`Remove ${r.label}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((l) => l.id !== line.id))}>
              ✕
            </button>
            <span className="calc-line-note">
              {q > 0 && `${integer(fromStock)} from stock, ${integer(shortfall)} to buy; buy price ${r.buy == null ? "not available" : `${integer(r.buy)} per unit`}`}
            </span>
          </div>
        ))}
        <button type="button" className="btn btn-quiet" onClick={() => setLines((ls) => [...ls, { id: Math.max(0, ...ls.map((l) => l.id)) + 1, name: "", qty: "100" }])}>
          + Add resource
        </button>
      </fieldset>

      <Readout
        rows={[
          { label: "Profit using your stock", value: signedCr(profitStock), tone: profitStock >= 0 ? "good" : "bad", big: true },
          { label: "Profit if you buy everything", value: signedCr(profitBuy), tone: profitBuy >= 0 ? "good" : "bad" },
          { label: "Resources at live buy prices", value: `${integer(buyAll)} cr` },
          { label: "Your stock at sell price + the rest bought", value: `${integer(mixed)} cr` },
        ]}
      />
      {incomplete && <p className="calc-warn">Some resources can’t be bought or sold on the market, so their cost isn’t counted.</p>}
      <p className="calc-note">
        “Using your stock” counts what you already hold at the price you’d get for selling it instead. The game’s AI Analyst leaves out capsule costs and market demand
        limits, so add your capsule cost above.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ goal / runway

type GoalProps = {
  recordedNetPerDay: number;
  trendPerDay: number | null;
  credits: number | null;
  creditsSource: "live" | "save";
  gameTime: GameTime | null;
};

function GoalCalc({ recordedNetPerDay, trendPerDay, credits, creditsSource, gameTime: t }: GoalProps) {
  const [current, setCurrent] = useState<string | null>(null);
  const [target, setTarget] = useState("500000");
  const [pace, setPace] = useState<"trend" | "recorded" | "custom">(trendPerDay != null ? "trend" : "recorded");
  const [custom, setCustom] = useState("1000");

  const cur = current != null ? num(current) : credits ?? 0;
  const perDay = pace === "trend" ? trendPerDay ?? 0 : pace === "recorded" ? recordedNetPerDay : num(custom);
  const gap = num(target) - cur;
  const inGameDate = (days: number) =>
    t ? new Date(Date.UTC(t.year, t.month - 1, t.day) + days * 86400000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : null;

  const rows: { label: string; value: string; tone?: "good" | "bad"; big?: boolean }[] = [];
  if (gap <= 0) {
    rows.push({ label: "Target", value: "Already reached", tone: "good", big: true });
  } else if (perDay > 0) {
    const days = gap / perDay;
    rows.push({ label: "Days to reach target", value: integer(Math.ceil(days)), big: true, tone: "good" });
    const date = inGameDate(days);
    if (date) rows.push({ label: "In-game date", value: date });
  } else {
    rows.push({ label: "Days to reach target", value: "Never at this pace", tone: "bad", big: true });
    if (perDay < 0 && cur > 0) {
      const days = cur / -perDay;
      rows.push({ label: "Credits run out in", value: days < 1 ? "Less than a day" : `${integer(Math.floor(days))} day${Math.floor(days) === 1 ? "" : "s"}`, tone: "bad" });
      const date = inGameDate(days);
      if (date) rows.push({ label: "Around", value: date });
    }
  }
  rows.push({ label: "Still needed", value: `${integer(Math.max(0, gap))} cr` }, { label: "Pace used", value: `${signedCr(perDay)} / day` });

  return (
    <div className="calc-form">
      <div className="calc-fields">
        <label className="field">
          <span className="field-label">Current credits</span>
          <input className="text-input" type="number" inputMode="numeric" value={current ?? String(Math.round(cur))} onChange={(e) => setCurrent(e.target.value)} />
          {current != null && credits != null && (
            <button type="button" className="calc-chip" onClick={() => setCurrent(null)}>
              Use {creditsSource === "live" ? "live" : "saved"} credits ({compact(credits)})
            </button>
          )}
        </label>
        <label className="field">
          <span className="field-label">Target credits</span>
          <input className="text-input" type="number" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
      </div>
      <fieldset className="field">
        <legend className="field-label">Daily pace</legend>
        {trendPerDay != null && (
          <label className="check-row">
            <input type="radio" name="goal-pace" checked={pace === "trend"} onChange={() => setPace("trend")} />
            Balance trend, last 30 in-game days: <strong>{signedCr(trendPerDay)}</strong>
          </label>
        )}
        <label className="check-row">
          <input type="radio" name="goal-pace" checked={pace === "recorded"} onChange={() => setPace("recorded")} />
          Recorded income minus spending, this range: <strong>{signedCr(recordedNetPerDay)}</strong>
        </label>
        <label className="check-row">
          <input type="radio" name="goal-pace" checked={pace === "custom"} onChange={() => setPace("custom")} />
          My own estimate
          <input className="text-input" type="number" inputMode="numeric" aria-label="Credits per day" value={custom} onFocus={() => setPace("custom")} onChange={(e) => setCustom(e.target.value)} />
        </label>
      </fieldset>
      <Readout rows={rows} />
      <p className="calc-note">
        Pace figures come from your saves{creditsSource === "save" ? ", and so do current credits while this save isn’t running" : ""}. A single large purchase or contract payout can swing the trend.
      </p>
    </div>
  );
}
