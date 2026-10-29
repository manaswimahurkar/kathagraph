"use client";

// Viewer preferences shared across the site: the map style and light/dark theme.
// Stored in this browser only; the site works the same without storage.

import { useSyncExternalStore } from "react";

export type MapBase = "ancient" | "satellite";
export type Theme = "light" | "dark";

interface Prefs {
  base: MapBase;
  theme: Theme;
}

const KEY = "kg-prefs";
const DEFAULTS: Prefs = { base: "ancient", theme: "dark" };

function read(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return {
      base: raw.base === "satellite" ? "satellite" : DEFAULTS.base,
      theme: raw.theme === "light" ? "light" : DEFAULTS.theme,
    };
  } catch {
    return DEFAULTS;
  }
}

let current: Prefs | null = null;
const listeners = new Set<() => void>();

function get(): Prefs {
  if (!current) current = typeof window === "undefined" ? DEFAULTS : read();
  return current;
}

function set(patch: Partial<Prefs>) {
  current = { ...get(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: still works for this visit */
  }
  document.documentElement.dataset.theme = current.theme;
  listeners.forEach((l) => l());
}

export function usePrefs() {
  const prefs = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get,
    () => DEFAULTS,
  );
  return {
    ...prefs,
    setBase: (base: MapBase) => set({ base }),
    setTheme: (theme: Theme) => set({ theme }),
  };
}

/** Runs before the page paints, so a saved light theme doesn't flash dark first. */
export const THEME_BOOT_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${KEY}")||"{}");document.documentElement.dataset.theme=p.theme==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;
