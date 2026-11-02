
import { useEffect, useState } from "react";

// The signed-in contributor, kept in this browser. Only the sign-in token and the public profile
// are stored (never the password). Storage can be unavailable (private mode): then the session
// lasts until the tab closes.

export interface Account {
  id: number;
  name: string;
  email: string;
  reason: string | null;
  created_at?: string;
}

const KEY = "kg-account";
let memory: { token: string; user: Account } | null = null;
const listeners = new Set<() => void>();

export function getSession(): { token: string; user: Account } | null {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? JSON.parse(raw) : null;
  } catch {
    memory = null;
  }
  return memory;
}

export function authToken(): string | null {
  return getSession()?.token ?? null;
}

export function setSession(s: { token: string; user: Account } | null) {
  memory = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: keep it in memory */
  }
  listeners.forEach((l) => l());
}

export function updateSessionUser(user: Account) {
  const s = getSession();
  if (s) setSession({ ...s, user });
}

/** The signed-in account (or null), re-rendering when someone signs in or out. */
export function useAccount(): Account | null {
  const [user, setUser] = useState<Account | null>(null);
  useEffect(() => {
    const sync = () => setUser(getSession()?.user ?? null);
    sync();
    listeners.add(sync);
    const onStorage = (e: StorageEvent) => e.key === KEY && ((memory = null), sync());
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return user;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}
