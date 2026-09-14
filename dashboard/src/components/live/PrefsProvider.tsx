"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { requestOpenSection } from "@/components/ui/Section";
import { useStoredState } from "@/lib/client/useStoredState";
import { normalizeRule, type AlertRule } from "@/lib/crust/alerts";

export type SoundPrefs = { enabled: boolean; volume: number };

type Prefs = {
  /** Pinned resources: EResourceType name → highlight color. */
  pins: Record<string, string>;
  setPin: (name: string, color: string) => void;
  removePin: (name: string) => void;
  alerts: AlertRule[];
  addAlert: (rule: AlertRule) => void;
  updateAlert: (id: string, patch: Partial<AlertRule>) => void;
  removeAlert: (id: string) => void;
  sound: SoundPrefs;
  setSound: (next: SoundPrefs) => void;
};

const PrefsContext = createContext<Prefs | null>(null);

// Stable defaults: useStoredState memoizes on them
const NO_PINS: Record<string, string> = {};
const NO_ALERTS: AlertRule[] = [];
const DEFAULT_SOUND: SoundPrefs = { enabled: true, volume: 0.6 };
const normalizeAll = (list: unknown[]) => list.map(normalizeRule).filter((r): r is AlertRule => r !== null);

export function usePrefs(): Prefs {
  const v = useContext(PrefsContext);
  if (!v) throw new Error("usePrefs must be used inside <PrefsProvider>");
  return v;
}

/** Per-browser preferences (localStorage): pins, alert rules, and alert sound. */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const [pins, setPins] = useStoredState("crustdash:pins", NO_PINS);
  const [storedAlerts, setStoredAlerts] = useStoredState("crustdash:alerts", NO_ALERTS);
  // Alerts saved by older versions ({ kind, target }) are converted to the current rule shape on read and on the next save
  const alerts = useMemo(() => normalizeAll(storedAlerts), [storedAlerts]);
  const setAlerts = useCallback((update: (a: AlertRule[]) => AlertRule[]) => setStoredAlerts((a) => update(normalizeAll(a))), [setStoredAlerts]);
  const [sound, setSound] = useStoredState("crustdash:sound", DEFAULT_SOUND);

  const value = useMemo<Prefs>(
    () => ({
      pins,
      setPin: (name, color) => setPins((p) => ({ ...p, [name]: color })),
      removePin: (name) =>
        setPins((p) => {
          const next = { ...p };
          delete next[name];
          return next;
        }),
      alerts,
      addAlert: (rule) => setAlerts((a) => [...a, rule]),
      updateAlert: (id, patch) => setAlerts((a) => a.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))),
      removeAlert: (id) => setAlerts((a) => a.filter((rule) => rule.id !== id)),
      sound,
      setSound,
    }),
    [pins, alerts, sound, setPins, setAlerts, setSound],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const FOCUS_RESOURCE_EVENT = "crustdash:focus-resource";

/** Scroll to a resource's row and flash it (the resources table listens for this). */
export function focusResource(name: string) {
  window.dispatchEvent(new CustomEvent(FOCUS_RESOURCE_EVENT, { detail: name }));
}

/** Open the Resources module and flash one resource's row. */
export function showResource(name: string) {
  requestOpenSection("resources");
  window.setTimeout(() => focusResource(name), 60);
}
