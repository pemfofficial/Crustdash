"use client";

import { DivergingBarChart } from "@/components/charts/DivergingBarChart";
import { LineChart } from "@/components/charts/LineChart";
import { fullDate, integer, signed } from "@/components/charts/format";
import { FindingsLink } from "@/components/insights/InsightList";
import { Fact } from "@/components/ui/Fact";
import { Section } from "@/components/ui/Section";
import type { Analysis } from "@/lib/crust/insights";

export function CreditsSection({ a }: { a: Analysis }) {
  const c = a.credits;
  const tone = c.change > 0 ? "delta-good" : c.change < 0 ? "delta-bad" : "delta-neutral";

  return (
    <>
      <div className="hero-row">
        <div className="hero-block">
          <div className="hero-label">Credits at last save</div>
          <div className="hero-value">{integer(c.now)}</div>
          <div className={`stat-delta ${tone}`}>
            <span aria-hidden>{c.change > 0 ? "▲" : c.change < 0 ? "▼" : "■"}</span> {signed(c.change, integer)}{" "}
            <span className="muted">over this range</span>
          </div>
        </div>
        <dl className="fact-grid">
          <Fact label="Highest" value={c.high ? integer(c.high.value) : "—"} sub={c.high ? fullDate(c.high.date) : undefined} />
          <Fact label="Lowest" value={c.low ? integer(c.low.value) : "—"} sub={c.low ? fullDate(c.low.date) : undefined} />
          <Fact
            label="Net per day (recorded)"
            value={signed(c.avgNetPerDay, integer)}
            tone={c.avgNetPerDay > 0 ? "good" : c.avgNetPerDay < 0 ? "bad" : undefined}
            topic="netCashFlow"
          />
          <Fact label="Surplus / deficit days" value={`${c.surplusDays} / ${c.deficitDays}`} sub={`of ${a.rangeDays} days`} />
          <Fact
            label="Runway"
            value={c.runwayDays == null ? "Not shrinking" : `${integer(c.runwayDays)} days`}
            sub="at the last 30 days’ pace"
            topic="runway"
            tone={c.runwayDays != null && c.runwayDays < 30 ? "bad" : undefined}
          />
        </dl>
      </div>

      <div className="grid-2">
        <LineChart
          title="Credit balance"
          subtitle="End of each in-game day"
          x={a.days}
          series={[{ key: "credits", label: "Credits", slot: 1, values: c.series }]}
          yFormat="integer"
        />
        <DivergingBarChart
          title="Daily net cash flow"
          subtitle="Recorded income minus spending."
          x={a.days}
          values={a.dailyNet}
          positiveLabel="Earned more than spent"
          negativeLabel="Spent more than earned"
        />
      </div>

      <Section id="credits-movements" variant="sub" title="Biggest balance changes" subtitle={`top ${c.movements.length} days`} info="netCashFlow">
        {c.movements.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="num">Change</th>
                  <th>What the game recorded that day</th>
                </tr>
              </thead>
              <tbody>
                {c.movements.map((m) => {
                  const explained = m.parts.reduce((s, p) => s + p.amount, 0);
                  const rest = m.change - explained;
                  return (
                    <tr key={m.date}>
                      <td>{fullDate(m.date)}</td>
                      <td className={`num ${m.change > 0 ? "tone-good" : "tone-bad"}`}>
                        <strong>{signed(m.change, integer)}</strong>
                      </td>
                      <td className="wrap-cell">
                        <span className="part-chips">
                          {m.parts.map((p) => (
                            <span key={p.label} className="part-chip">
                              {p.label} <strong>{signed(p.amount, integer)}</strong>
                            </span>
                          ))}
                          {Math.abs(rest) >= 1 && (
                            <span className="part-chip quiet">
                              Not broken down <strong>{signed(rest, integer)}</strong>
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Your balance didn’t change in this range.</p>
        )}
      </Section>

      <FindingsLink insights={a.insights} area="cash" topic="cash" />
    </>
  );
}
