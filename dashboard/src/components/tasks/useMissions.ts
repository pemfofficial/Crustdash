"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useLive, type GlossaryEntry } from "@/components/live/LiveProvider";
import { camelLabel } from "@/lib/crust/market";
import type { Quest, QuestCheckpoint, QuestReport } from "@/lib/crust/questTypes";
import { WIKI_INDEX } from "@/lib/wiki/client";
import type { WikiEntry } from "@/lib/wiki/types";

export type StepState = "done" | "current" | "todo";
export type MissionStep = QuestCheckpoint & {
  /** The watched value right now, from the running game (null when the game isn't reporting it). */
  live: number | null;
  progress: number | null;
  state: StepState;
};
export type MissionStage = { name: string; active: boolean; steps: MissionStep[] };
export type Mission = {
  id: string;
  tag: string;
  name: string;
  description: string;
  stages: MissionStage[];
  current: MissionStep | null;
  currentStage: string | null;
  done: number;
  total: number;
  /** Started while playing: the game hasn't saved its steps yet. */
  startedThisSession: boolean;
  wiki: WikiEntry | null;
};
export type MissionsState = { missions: Mission[]; savedAt: string | null; loaded: boolean; error: string | null };

const POLL_MS = 15000;
/** QuestStatus::NewEnumerator1 is a finished mission: the game keeps its tag but clears its stages. */
const FINISHED_STATUS = "NewEnumerator1";
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const storyArticles = WIKI_INDEX.entries.filter((e) => e.category === "story");
const wikiFor = (name: string) => storyArticles.find((e) => norm(e.title) === norm(name)) ?? null;

// Quest-start flags whose names don't match their title's string-table key
const START_KEY_ALIASES: Record<string, string> = {
  Million: "Broker",
  ProjectAurora: "AuroraTitle",
  CommonEfforts: "CommEff",
  CorporateStealing: "CorpSteal",
};

function titleForStart(flag: string, titles: QuestReport["titles"]): string | null {
  const wanted = norm(START_KEY_ALIASES[flag] ?? flag);
  const exact = titles.find((t) => norm(t.key) === wanted);
  const prefix = titles.find((t) => {
    const key = norm(t.key);
    return key.length >= 5 && (wanted.startsWith(key) || key.startsWith(wanted));
  });
  return (exact ?? prefix)?.title ?? null;
}

// One poller per save, shared by every component that shows missions
type Store = { report: QuestReport | null; subscribe: (listener: () => void) => () => void; get: () => QuestReport | null };
const stores = new Map<string, Store>();

function storeFor(profileId: string): Store {
  const existing = stores.get(profileId);
  if (existing) return existing;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastBody = "";
  const store: Store = {
    report: null,
    get: () => store.report,
    subscribe: (listener) => {
      listeners.add(listener);
      if (!timer) {
        void load();
        timer = setInterval(load, POLL_MS);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
  async function load() {
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/quests`, { cache: "no-store" });
      const body = await res.text();
      if (body === lastBody) return;
      lastBody = body;
      store.report = JSON.parse(body) as QuestReport;
      listeners.forEach((l) => l());
    } catch {
      // The dashboard server is restarting: keep showing the last report
    }
  }
  stores.set(profileId, store);
  return store;
}

function buildMission(q: Quest, glossary: Record<string, GlossaryEntry>): Mission {
  let done = 0;
  let total = 0;
  const stages: MissionStage[] = q.stages.map((stage) => ({
    name: capitalize(stage.name),
    active: stage.active,
    steps: stage.checkpoints.map((cp): MissionStep => {
      const live = cp.glossary ? (glossary[cp.glossary]?.value ?? null) : null;
      const value = live ?? cp.last;
      const reached = live != null && cp.target != null && cp.target > 0 && live >= cp.target;
      const finished = cp.completed || reached;
      total += 1;
      if (finished) done += 1;
      const progress = finished ? 1 : cp.target && cp.target > 0 && value != null ? Math.max(0, Math.min(1, value / cp.target)) : null;
      return { ...cp, live, progress, state: finished ? "done" : "todo" };
    }),
  }));

  // The current step: the first unfinished one, looking in the active stage first
  let current: MissionStep | null = null;
  let currentStage: string | null = null;
  for (const stage of [...stages.filter((s) => s.active), ...stages.filter((s) => !s.active)]) {
    const step = stage.steps.find((s) => s.state !== "done");
    if (step) {
      step.state = "current";
      current = step;
      currentStage = stage.name;
      break;
    }
  }
  const fallback = q.tag.split(".").pop() ?? q.tag;
  const name = capitalize(q.name && q.name !== fallback ? q.name : camelLabel(q.name || fallback));
  return { id: q.tag, tag: q.tag, name, description: q.description, stages, current, currentStage, done, total, startedThisSession: false, wiki: wikiFor(name) };
}

/**
 * Missions in progress: steps from the last save, progress from the running game, plus any mission that
 * started while playing (its steps arrive with the next save).
 */
export function useMissions(profileId: string): MissionsState {
  const store = storeFor(profileId);
  const report = useSyncExternalStore(store.subscribe, store.get, () => null);
  const { glossary, glossaryStart } = useLive();

  return useMemo(() => {
    if (!report) return { missions: [], savedAt: null, loaded: false, error: null };
    const missions = report.quests.filter((q) => q.status !== FINISHED_STATUS).map((q) => buildMission(q, glossary));
    const known = new Set(report.quests.map((q) => norm(q.tag.split(".").pop() ?? "")));
    for (const [address, first] of Object.entries(glossaryStart)) {
      if (!address.startsWith("Q.QuestStart.") || first !== 0 || glossary[address]?.value !== 1) continue;
      const flag = address.slice("Q.QuestStart.".length);
      const title = known.has(norm(flag)) ? null : titleForStart(flag, report.titles);
      if (!title || missions.some((m) => norm(m.name) === norm(title))) continue;
      missions.push({
        id: address,
        tag: address,
        name: title,
        description: "",
        stages: [],
        current: null,
        currentStage: null,
        done: 0,
        total: 0,
        startedThisSession: true,
        wiki: wikiFor(title),
      });
    }
    return { missions, savedAt: report.savedAt, loaded: true, error: report.error ?? null };
  }, [report, glossary, glossaryStart]);
}
