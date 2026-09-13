"use client";

import { fullDate, integer, percent, signed } from "@/components/charts/format";
import { FindingsLink } from "@/components/insights/InsightList";
import { Fact } from "@/components/ui/Fact";
import { InfoTip } from "@/components/ui/InfoTip";
import { Section } from "@/components/ui/Section";
import type { Analysis, FlowRow } from "@/lib/crust/insights";

function FlowTable({ rows, kind }: { rows: FlowRow[]; kind: "income" | "spending" }) {
  if (!rows.length) return <p className="empty">Nothing recorded in this range.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{kind === "income" ? "Source" : "Category"}</th>
            <th className="num">Total</th>
            <th>Share</th>
            <th className="num">Active days</th>
            <th className="num">Avg per active day</th>
            <th>Biggest day</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <span className="th-inner">
                  {r.label}
                  <InfoTip topic={r.topic} label={r.label} />
                </span>
              </td>
              <td className="num">
                <strong>{integer(r.total)}</strong>
              </td>
              <td>
                <span className="share-bar" aria-hidden>
                  <span style={{ width: `${Math.max(2, r.share * 100)}%`, background: kind === "income" ? "var(--div-pos)" : "var(--div-neg)" }} />
                </span>
                {percent(r.share)}
              </td>
              <td className="num">{r.activeDays}</td>
              <td className="num">{integer(r.avgPerActiveDay)}</td>
              <td>{r.biggest ? `${integer(r.biggest.amount)} · ${fullDate(r.biggest.date)}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FlowsSection({ a }: { a: Analysis }) {
  const fl = a.flows;

  return (
    <>
      <dl className="fact-grid">
        <Fact label="Income" value={integer(fl.incomeTotal)} topic="income" />
        <Fact label="Spending" value={integer(fl.spendTotal)} topic="spending" />
        <Fact label="Net" value={signed(fl.net, integer)} tone={fl.net > 0 ? "good" : fl.net < 0 ? "bad" : undefined} />
        <Fact label="Days with income" value={`${fl.incomeDays} of ${a.rangeDays}`} />
        <Fact label="Not broken down" value={signed(fl.untracked, integer)} sub="balance change outside these categories" topic="netCashFlow" />
      </dl>

      <Section id="flows-income" variant="sub" title="Income by source" subtitle={`${fl.income.length} source${fl.income.length === 1 ? "" : "s"}`} info="income">
        <FlowTable rows={fl.income} kind="income" />
      </Section>
      <Section id="flows-spending" variant="sub" title="Spending by category" subtitle={`${fl.spend.length} categor${fl.spend.length === 1 ? "y" : "ies"}`} info="spending">
        <FlowTable rows={fl.spend} kind="spending" />
      </Section>
      <FindingsLink insights={a.insights} area="income" topic="income and spending" />
    </>
  );
}
