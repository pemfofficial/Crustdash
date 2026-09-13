import type { ReactNode } from "react";
import { InfoTip } from "./InfoTip";
import type { TopicId } from "@/lib/crust/topics";

/** One labelled number in a fact grid (render inside <dl className="fact-grid">). */
export function Fact({ label, value, sub, topic, tone }: { label: string; value: ReactNode; sub?: ReactNode; topic?: TopicId; tone?: "good" | "bad" }) {
  return (
    <div className="fact">
      <dt>
        {label}
        {topic && <InfoTip topic={topic} label={label} />}
      </dt>
      <dd className={tone ? `tone-${tone}` : undefined}>{value}</dd>
      {sub && <dd className="fact-sub">{sub}</dd>}
    </div>
  );
}
