import { apiUrl, ApiError } from "./api";

// Admin calls carry the X-Admin-Token header. The token is kept only for this browser tab
// (sessionStorage), so closing the tab locks the admin page again.

const KEY = "kg-admin-token";

export function adminToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the page asks again */
  }
}

export async function adminFetch<T>(path: string, init: RequestInit = {}, token = adminToken()): Promise<T> {
  const url = apiUrl(path);
  if (!url) throw new ApiError("The admin page needs the live backend.");
  const headers = new Headers(init.headers);
  if (token) headers.set("X-Admin-Token", token);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError("Can't reach the archive server (it may be waking up). Try again in a moment.");
  }
  if (!res.ok) {
    let detail = `The server answered ${res.status}.`;
    try {
      const b = await res.json();
      if (typeof b?.detail === "string") detail = b.detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface AdminStatus {
  files: Record<string, number>;
  file_types: Record<string, number>;
  failed: { id: number; filename: string; type: string; error: string | null; created_at: string }[];
  waiting: { id: number; filename: string; type: string; status: string; created_at: string }[];
  facts: Record<string, number>;
  entities: Record<string, number>;
  translated_sources: number;
  users: { id: number; name: string; email: string; reason: string | null; created_at: string; uploads: number; reviews: number }[];
  recent: { id: number; filename: string; type: string; status: string; origin: string | null; author: string | null; created_at: string }[];
}
