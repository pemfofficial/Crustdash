"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// localStorage as an external store: every component reading a key re-renders when it changes (this tab via
// the listener set, other tabs via the storage event). The server snapshot is null, so hydration matches.
type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseOr<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** useState persisted to localStorage (per browser). Pass a stable `initial` (a constant, not a new literal). */
export function useStoredState<T>(key: string, initial: T) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const value = useMemo(() => parseOr(raw, initial), [raw, initial]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = parseOr(readRaw(key), initial);
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {}
      for (const listener of listeners) listener();
    },
    [key, initial],
  );

  return [value, setValue] as const;
}
