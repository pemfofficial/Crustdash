"use client";

import { useMemo } from "react";
import { useLive } from "./LiveProvider";
import { buildMarketRows, camelLabel, type MarketRow } from "@/lib/crust/market";
import type { AlertSubject } from "@/lib/crust/alerts";

export type HoldingsSource = "live" | "save";

// The game's statistics glossary keeps live counts as G.Stats.<EResourceType name>Count. Checked against a save:
// credits matched the live reading 108/108 times; untouched resources matched exactly at load.
const COUNT_KEY = /^G\.Stats\.(.+)Count$/;
// NoneCount mirrors the electricity balance and CreditsCount is the credit balance: neither is a holding
const NOT_HOLDINGS = new Set(["None", "Credits"]);
const MIN_LIVE_COUNTS = 5;

/** Holdings to show: live counts from the running game when they belong to this save, else the last save. */
export function useHoldings(saveHoldings: Record<string, number>, profileName: string): { holdings: Record<string, number>; source: HoldingsSource } {
  const { glossary, enumNames, slot } = useLive();
  return useMemo(() => {
    const known = new Set(Object.values(enumNames).map((n) => n.replace(/^EResourceType::/, "")));
    const live: Record<string, number> = {};
    for (const [address, entry] of Object.entries(glossary)) {
      const match = COUNT_KEY.exec(address);
      if (!match || NOT_HOLDINGS.has(match[1]) || entry.value == null) continue;
      if (known.size ? known.has(match[1]) : match[1] in saveHoldings) live[match[1]] = entry.value;
    }
    // Only when the game named its save and it's this profile: an unnamed session could be any save
    const usable = Object.keys(live).length >= MIN_LIVE_COUNTS && slot === profileName;
    return usable ? { holdings: { ...saveHoldings, ...live }, source: "live" } : { holdings: saveHoldings, source: "save" };
  }, [glossary, enumNames, slot, saveHoldings, profileName]);
}

/** Live market rows (27 lots) joined with holdings; memoized on the live snapshot. */
export function useMarketRows(holdings?: Record<string, number>): MarketRow[] {
  const { market, history, enumNames, displayNames } = useLive();
  return useMemo(
    () => (market ? buildMarketRows(market, history, { enumNames, displayNames, holdings }) : []),
    [market, history, enumNames, displayNames, holdings],
  );
}

/** Display name for any resource: the game's own name when the watcher sent it, else a spaced-out enum name. */
export function useResourceLabel() {
  const { enumNames, displayNames } = useLive();
  return useMemo(() => {
    const idByName = new Map<string, string>();
    for (const [id, n] of Object.entries(enumNames)) idByName.set(n.replace(/^EResourceType::/, ""), id);
    return (name: string) => {
      const id = idByName.get(name);
      return (id && displayNames[id]) || camelLabel(name);
    };
  }, [enumNames, displayNames]);
}

export function rowToSubject(row: MarketRow, heldSource: AlertSubject["heldSource"]): AlertSubject {
  return {
    name: row.name,
    label: row.label,
    sell: row.sell,
    buy: row.buy,
    vsBase: row.base ? row.vsBase : null,
    sellRangePos: row.sellRangePos,
    volumeRatio: row.baseVolume ? row.volumeRatio : null,
    held: row.held,
    heldValue: row.sell != null ? row.heldValue : null,
    heldSource,
  };
}

/** Alert subjects for every resource: market rows plus held resources that aren't traded (e.g. Slag). */
export function useAlertSubjects(holdings: Record<string, number>, source: HoldingsSource = "save"): Map<string, AlertSubject> {
  const rows = useMarketRows(holdings);
  const label = useResourceLabel();
  return useMemo(() => {
    const map = new Map(rows.map((r) => [r.name, rowToSubject(r, source)]));
    for (const [name, held] of Object.entries(holdings)) {
      if (map.has(name) || NOT_HOLDINGS.has(name)) continue;
      map.set(name, { name, label: label(name), sell: null, buy: null, vsBase: null, sellRangePos: null, volumeRatio: null, held, heldValue: null, heldSource: source });
    }
    return map;
  }, [rows, holdings, label, source]);
}
