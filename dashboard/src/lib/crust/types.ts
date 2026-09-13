// Shared, client-safe types for findings shown across the dashboard.
import type { TopicId } from "./topics";

export type Level = "good" | "warning" | "serious" | "critical" | "info";
export type InsightArea = "cash" | "networth" | "market" | "production" | "income" | "capacity";

export type Insight = {
  id: string;
  level: Level;
  area: InsightArea;
  /** Explainer shown by the finding's "i". */
  topic: TopicId;
  /** Rich markup (see RichText): **bold**, _italic_, ==highlight==, ++good++, !!bad!! */
  title: string;
  /** The real numbers behind the finding, pre-formatted. */
  figures: { label: string; value: string; tone?: "good" | "bad" }[];
  detail: string;
  actions: string[];
  source?: string;
  /** Resources (EResourceType names) the finding is about, so notifications can jump to them or set alerts. */
  subjects?: string[];
};

export const LEVEL_ORDER: Record<Level, number> = { critical: 0, serious: 1, warning: 2, info: 3, good: 4 };
export const LEVEL_TEXT: Record<Level, string> = { critical: "Critical", serious: "Serious", warning: "Warning", info: "Note", good: "Good" };
export const LEVEL_ICON: Record<Level, string> = { critical: "✕", serious: "◆", warning: "▲", info: "●", good: "✓" };
export const AREA_TEXT: Record<InsightArea, string> = {
  cash: "Cash",
  networth: "Net worth",
  market: "Market",
  production: "Production",
  income: "Income",
  capacity: "Capacity",
};
