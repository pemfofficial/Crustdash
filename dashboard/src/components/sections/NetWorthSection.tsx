"use client";

import { LineChart } from "@/components/charts/LineChart";
import { compact, integer, percent, signed } from "@/components/charts/format";
import { FindingsLink } from "@/components/insights/InsightList";
import { Fact } from "@/components/ui/Fact";
import { InfoTip } from "@/components/ui/InfoTip";
import type { Analysis } from "@/lib/crust/insights";
import type { TopicId } from "@/lib/crust/topics";

const PART_TOPIC: Record<string, TopicId> = {
  ResourcesCapitalization: "resources",
  RobotsCapitalization: "drones",
  ModulesCapitalization: "construction",
  PlayerCredits: "credits",
};

export function NetWorthSection({ a }: { a: Analysis }) {
  const nw = a.netWorth;
  const shown = nw.parts.filter((p) => p.now > 0);
  const largest = [...nw.parts].sort((x, y) => y.now - x.now)[0];
  const mover = [...nw.parts].sort((x, y) => Math.abs(y.change) - Math.abs(x.change))[0];
  const tone = nw.change > 0 ? "delta-good" : nw.change < 0 ? "delta-bad" : "delta-neutral";

  return (
    <>
      <div className="hero-row">
        <div className="hero-block">
          <div className="hero-label">Net worth at last save</div>
          <div className="hero-value">{compact(nw.now)}</div>
          <div className={`stat-delta ${tone}`}>
            <span aria-hidden>{nw.change > 0 ? "▲" : nw.change < 0 ? "▼" : "■"}</span> {signed(nw.change)}
            {nw.changePct != null && ` (${signed(nw.changePct * 100, (n) => n.toFixed(1))}%)`} <span className="muted">over this range</span>
          </div>
        </div>
        <dl className="fact-grid">
          <Fact label="Capitalization points" value={integer(Math.floor(nw.now / 1000))} sub="game rule: 1 per 1,000" topic="netWorth" />
          <Fact label="Cash share" value={nw.cashShare == null ? "—" : percent(nw.cashShare)} sub="credits ÷ net worth" topic="credits" />
          {largest && <Fact label="Largest part" value={largest.label} sub={percent(largest.share)} />}
          {mover && mover.change !== 0 && <Fact label="Biggest change" value={mover.label} sub={signed(mover.change)} tone={mover.change > 0 ? "good" : "bad"} />}
        </dl>
      </div>

      <div className="composition-block">
        <div className="composition" role="img" aria-label="Net worth split into parts; values are in the table below">
          {shown.map((p) => (
            <span key={p.key} className="composition-seg" style={{ flexGrow: p.now, background: `var(--series-${p.slot})` }} title={`${p.label}: ${compact(p.now)} (${percent(p.share)})`} />
          ))}
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Part</th>
                <th className="num">Value</th>
                <th className="num">Share</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {nw.parts.map((p) => (
                <tr key={p.key}>
                  <td className="wrap-cell">
                    <span className="th-inner">
                      <span className="swatch" style={{ background: `var(--series-${p.slot})` }} />
                      {p.label}
                      {PART_TOPIC[p.key] && <InfoTip topic={PART_TOPIC[p.key]} label={p.label} />}
                    </span>
                    {p.members.length > 0 && <span className="cell-sub">{p.members.map((m) => `${m.label} ${compact(m.now)}`).join(" · ")}</span>}
                  </td>
                  <td className="num">{integer(p.now)}</td>
                  <td className="num">{percent(p.share)}</td>
                  <td className={`num ${p.change > 0 ? "tone-good" : p.change < 0 ? "tone-bad" : ""}`}>{signed(p.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <LineChart title="Net worth by part" subtitle="End of each in-game day" x={a.days} series={nw.lines} />

      <FindingsLink insights={a.insights} area="networth" topic="net worth" />
    </>
  );
}
