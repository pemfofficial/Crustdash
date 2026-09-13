"use client";

import { Meter } from "@/components/charts/Figures";
import { integer, signed } from "@/components/charts/format";
import { FindingsLink } from "@/components/insights/InsightList";
import { WikiLink } from "@/components/ui/RichText";
import { wikiForBuilding } from "@/lib/wiki/client";
import { Fact } from "@/components/ui/Fact";
import { Section } from "@/components/ui/Section";
import type { Analysis } from "@/lib/crust/insights";

export function BuildingsSection({ a }: { a: Analysis }) {
  const perDrone = a.cpu.droneCount > 0 ? a.cpu.drones / a.cpu.droneCount : null;

  return (
    <>
      <div className="hero-row">
        <div className="hero-block meter-block">
          <Meter label="CPU reserved" value={a.cpu.reserved} max={a.cpu.limit} format={integer} />
        </div>
        <dl className="fact-grid">
          <Fact label="Buildings" value={integer(a.modules.now)} sub={`${signed(a.modules.change, integer)} over this range`} topic="buildings" />
          <Fact label="CPU: modules" value={integer(a.cpu.modules)} topic="cpu" />
          <Fact label="CPU: drones" value={integer(a.cpu.drones)} sub={perDrone ? `${a.cpu.droneCount} drones, ${Number.isInteger(perDrone) ? perDrone : perDrone.toFixed(1)} each` : undefined} topic="drones" />
          <Fact label="CPU: transport" value={integer(a.cpu.transport)} />
        </dl>
      </div>

      <Section id="buildings-table" variant="sub" title="Buildings by type" subtitle={`${a.buildings.length} types`} info="buildings">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Building</th>
                <th className="num">Count</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {a.buildings.map((b) => (
                <tr key={b.key}>
                  <td>
                    {(() => {
                      const wiki = wikiForBuilding(b.key, b.label);
                      return wiki ? <WikiLink id={wiki.id}>{b.label}</WikiLink> : b.label;
                    })()}
                  </td>
                  <td className="num">{integer(b.now)}</td>
                  <td className="num">{signed(b.change, integer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <FindingsLink insights={a.insights} area="capacity" topic="capacity and CPU" />
    </>
  );
}
