"use client";

import { InfoTip } from "@/components/ui/InfoTip";
import { RichText } from "@/components/ui/RichText";
import { openModule, splitModuleHash, useModuleHash } from "@/lib/client/moduleHash";
import { AREA_TEXT, LEVEL_ICON, LEVEL_TEXT, type Insight, type InsightArea, type Level } from "@/lib/crust/types";

/** Finding cards: level, the headline, the real figures, what it means, what to do, and the source. Game terms link to the Wiki. */
export function InsightList({ insights, empty = "Nothing notable here." }: { insights: Insight[]; empty?: string }) {
  if (!insights.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="insight-cards">
      {insights.map((i) => (
        <li key={i.id} className={`insight-card lvl-${i.level}`}>
          <div className="insight-top">
            <span className="insight-icon" aria-hidden>{LEVEL_ICON[i.level]}</span>
            <span className="insight-level">{LEVEL_TEXT[i.level]}</span>
            <span className="insight-area">{AREA_TEXT[i.area]}</span>
            <InfoTip topic={i.topic} />
          </div>
          <p className="insight-title">
            <RichText text={i.title} />
          </p>
          {i.figures.length > 0 && (
            <dl className="insight-figures">
              {i.figures.map((fig) => (
                <div key={fig.label}>
                  <dt>{fig.label}</dt>
                  <dd className={fig.tone ? `tone-${fig.tone}` : undefined}>{fig.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="insight-detail">
            <RichText text={i.detail} autolink />
          </p>
          {i.actions.length > 0 && (
            <div className="insight-actions">
              <span className="insight-actions-label">What to do</span>
              <ul>
                {i.actions.map((a) => (
                  <li key={a}>
                    <RichText text={a} autolink />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {i.source && <p className="insight-source">Source: {i.source}</p>}
        </li>
      ))}
    </ul>
  );
}

const LEVEL_WORDS: [Level, string, string][] = [
  ["critical", "critical", "critical"],
  ["serious", "serious", "serious"],
  ["warning", "warning", "warnings"],
  ["info", "note", "notes"],
  ["good", "good", "good"],
];

export const FINDINGS_MODULE = "findings";

/** All findings with filter chips by area. The chosen area lives in the URL (#findings/cash), so other modules can link to it. */
export function InsightsBoard({ insights }: { insights: Insight[] }) {
  const [moduleId, path] = splitModuleHash(useModuleHash());
  const requested = moduleId === FINDINGS_MODULE && path ? (path as InsightArea) : null;
  const areas = [...new Set([...insights.map((i) => i.area), ...(requested && requested in AREA_TEXT ? [requested] : [])])];
  const area = requested && requested in AREA_TEXT ? requested : "all";
  const shown = area === "all" ? insights : insights.filter((i) => i.area === area);
  const summary = LEVEL_WORDS.map(([level, one, many]) => {
    const n = insights.filter((i) => i.level === level).length;
    return n ? `${n} ${n === 1 ? one : many}` : null;
  })
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="insight-board">
      <div className="toolbar">
        <div className="chip-filters" role="group" aria-label="Filter findings by area">
          {(["all", ...areas] as const).map((a) => (
            <button key={a} type="button" className="chip-btn" aria-pressed={area === a} onClick={() => openModule(a === "all" ? FINDINGS_MODULE : `${FINDINGS_MODULE}/${a}`)}>
              {a === "all" ? `All (${insights.length})` : `${AREA_TEXT[a]} (${insights.filter((i) => i.area === a).length})`}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {summary && <span className="muted">{summary}</span>}
      </div>
      <InsightList insights={shown} empty={area === "all" ? "No findings for this range." : `No ${AREA_TEXT[area].toLowerCase()} findings right now.`} />
    </div>
  );
}

/** A pointer from a Colony module to the matching advice in Findings (the advice itself stays in the Assistant). */
export function FindingsLink({ insights, area, topic }: { insights: Insight[]; area: InsightArea; topic: string }) {
  const n = insights.filter((i) => i.area === area).length;
  return (
    <p className="xref-bar">
      <span>{n ? `${n} finding${n === 1 ? "" : "s"} about ${topic}.` : `No findings about ${topic} right now.`}</span>
      <a href={`#${FINDINGS_MODULE}/${area}`}>{n ? "Read them in Findings" : "Open Findings"}</a>
    </p>
  );
}
