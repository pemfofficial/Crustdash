"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameTime, RawMarket, SnapshotData } from "@/lib/crust/market";

export type LiveStatus = "connecting" | "waiting" | "live" | "stale" | "error";
export type GlossaryEntry = { name: string | null; category: string | null; value: number | null };

type LineMsg = {
  type?: string;
  t?: number;
  seq?: number;
  full?: boolean;
  data?: SnapshotData;
  enums?: { EResourceType?: Record<string, string> };
  slot?: string;
  resourceDisplayNames?: Record<string, string>;
  entries?: { a: string; n?: string | null; c?: string | null; v?: number | null }[];
};

export type LiveData = {
  seq: number;
  /** Watcher wall-clock time (epoch seconds) of the latest snapshot. */
  snapshotT: number | null;
  /** Latest fast-changing market fields merged over the last full market read (watcher v2.1+). */
  market: RawMarket | null;
  /** The last market read that carried 30-day price histories. */
  history: RawMarket | null;
  game: SnapshotData["game"] | null;
  inGameTime: GameTime | null;
  paused: boolean;
  credits: number | null;
  moduleCounts: Record<string, number> | null;
  enumNames: Record<string, string>;
  displayNames: Record<string, string>;
  slot: string | null;
  glossary: Record<string, GlossaryEntry>;
  /** The first value seen for each glossary entry this session (spots quests that start while you play). */
  glossaryStart: Record<string, number | null>;
};

export type LiveClock = { status: LiveStatus; ageMs: number | null };

const STALE_MS = 8000;
const EMPTY: LiveData = {
  seq: 0,
  snapshotT: null,
  market: null,
  history: null,
  game: null,
  inGameTime: null,
  paused: false,
  credits: null,
  moduleCounts: null,
  enumNames: {},
  displayNames: {},
  slot: null,
  glossary: {},
  glossaryStart: {},
};

// Two contexts: data changes every snapshot (~2 s); the clock ticks every second. Keeping them apart
// stops big tables re-rendering once a second just to update "last update 3s ago".
const LiveDataContext = createContext<LiveData | null>(null);
const LiveClockContext = createContext<LiveClock | null>(null);

export function useLive(): LiveData {
  const v = useContext(LiveDataContext);
  if (!v) throw new Error("useLive must be used inside <LiveProvider>");
  return v;
}

export function useLiveClock(): LiveClock {
  const v = useContext(LiveClockContext);
  if (!v) throw new Error("useLiveClock must be used inside <LiveProvider>");
  return v;
}

/** One EventSource for the whole page; every live component reads from here. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LiveData>(EMPTY);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [now, setNow] = useState(() => Date.now());
  const lastFull = useRef<RawMarket | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/live");

    es.addEventListener("session", () => {
      lastFull.current = null;
      setData((d) => ({ ...EMPTY, enumNames: d.enumNames }));
      setStatus((s) => (s === "connecting" || s === "error" ? "waiting" : s));
    });
    es.addEventListener("waiting", () => setStatus((s) => (s === "live" ? s : "waiting")));
    es.addEventListener("line", (e) => {
      let msg: LineMsg;
      try {
        msg = JSON.parse((e as MessageEvent).data);
      } catch {
        return;
      }

      if (msg.type === "enums" && msg.enums?.EResourceType) {
        const names = msg.enums.EResourceType;
        setData((d) => ({ ...d, enumNames: names }));
      } else if (msg.type === "session_info") {
        setData((d) => ({ ...d, slot: msg.slot ?? d.slot, displayNames: msg.resourceDisplayNames ?? d.displayNames }));
      } else if (msg.type === "glossary" && msg.entries) {
        const entries = msg.entries;
        setData((d) => {
          const glossary = { ...d.glossary };
          let glossaryStart = d.glossaryStart;
          for (const en of entries) {
            glossary[en.a] = { name: en.n ?? null, category: en.c ?? null, value: en.v ?? null };
            if (!(en.a in glossaryStart)) {
              if (glossaryStart === d.glossaryStart) glossaryStart = { ...glossaryStart };
              glossaryStart[en.a] = en.v ?? null;
            }
          }
          return { ...d, glossary, glossaryStart };
        });
      } else if (msg.type === "snapshot" && msg.data) {
        const snap = msg.data;
        const m = snap.markets?.[0];
        let merged: RawMarket | null = null;
        let history: RawMarket | null = null;
        if (m) {
          // v2.0 wrote every field each poll; v2.1 writes slow fields only on "full" polls
          const isFull = msg.full === true || Array.isArray(m.BasePrices);
          if (isFull) lastFull.current = m;
          merged = isFull ? m : { ...(lastFull.current ?? {}), ...m };
          if (m.SellingPriceHistory) history = m;
        }
        setData((d) => {
          const game = snap.game ?? d.game;
          const t = game?.inGameTime && game.inGameTime.year > 1 ? game.inGameTime : null;
          return {
            ...d,
            seq: msg.seq ?? d.seq,
            snapshotT: msg.t ?? d.snapshotT,
            market: merged ?? d.market,
            history: history ?? d.history,
            game,
            inGameTime: t,
            paused: game?.GameSpeed === 0,
            credits: snap.credits?.value ?? d.credits,
            moduleCounts: snap.stats?.ModuleCounts ?? d.moduleCounts,
          };
        });
        if (m) setStatus("live");
      }
    });
    es.onerror = () => setStatus("error");
    es.onopen = () => setStatus((s) => (s === "error" || s === "connecting" ? "waiting" : s));

    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      es.close();
      clearInterval(tick);
    };
  }, []);

  const clock = useMemo<LiveClock>(() => {
    const ageMs = data.snapshotT ? now - data.snapshotT * 1000 : null;
    return { status: status === "live" && ageMs != null && ageMs > STALE_MS ? "stale" : status, ageMs };
  }, [data.snapshotT, now, status]);

  return (
    <LiveDataContext.Provider value={data}>
      <LiveClockContext.Provider value={clock}>{children}</LiveClockContext.Provider>
    </LiveDataContext.Provider>
  );
}

export function formatAge(ms: number | null): string {
  if (ms == null) return "?";
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

/** What the live link is doing, in words. `short` suits the status bar. */
export function liveStatusText(status: LiveStatus, ageMs: number | null, { short = false }: { short?: boolean } = {}): string {
  switch (status) {
    case "live":
      return "Live";
    case "stale":
      return `Last update ${formatAge(ageMs)} ago`;
    case "waiting":
      return "Waiting for the game";
    case "error":
      return short ? "Reconnecting" : "Reconnecting to the dashboard server";
    default:
      return "Connecting…";
  }
}

export const liveDotClass = (status: LiveStatus) => `live-dot ${status === "live" ? "on" : status === "stale" ? "stale" : ""}`;
