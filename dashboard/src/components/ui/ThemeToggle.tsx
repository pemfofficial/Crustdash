"use client";

import { useSyncExternalStore } from "react";

type Mode = "dark" | "light";
export const THEME_KEY = "crustdash:theme";
const THEME_EVENT = "crustdash:theme-change";

/** Inline script for <head>: the terminal (dark) theme unless Daylight was chosen, applied before first paint. */
export const themeBootScript = `try{var t=localStorage.getItem("${THEME_KEY}");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}`;

function subscribe(listener: () => void) {
  window.addEventListener(THEME_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(THEME_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function readMode(): Mode {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function setTheme(next: Mode) {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, readMode, () => "dark" as Mode);
  return (
    <div className="segmented" role="radiogroup" aria-label="Color theme">
      {(["dark", "light"] as const).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} className="seg-btn" onClick={() => setTheme(m)}>
          {m === "dark" ? "Terminal" : "Daylight"}
        </button>
      ))}
    </div>
  );
}
