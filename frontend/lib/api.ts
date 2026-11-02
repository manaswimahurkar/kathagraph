// Typed client for the KathaGraph API (shapes in lib/types.ts, from CONTRACT.md).
//
// THE SWITCH: NEXT_PUBLIC_API_URL
//   empty or "mock"            -> demo data from lib/mock.ts
//   https://your-api.onrender  -> the real backend

import type {
  AskResponse,
  DuplicatesResponse,
  InscriptionReading,
  ReviewResponse,
  TimelineResponse,
  ClaimStatus,
  ClaimStatusResponse,
  EntitiesResponse,
  EntityDetail,
  EntityModel,
  Health,
  PrioritiesResponse,
  SearchResponse,
  SourceDetail,
  UploadResponse,
  SourceText,
  StoriesResponse,
  JourneysResponse,
  CraftsResponse,
  TwinReport,
} from "./types";
import * as mock from "./mock";
import { authToken, setSession, type Account } from "./auth";

const RAW_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
export const USE_MOCK = RAW_URL === "" || RAW_URL.toLowerCase() === "mock";
const API_URL = USE_MOCK ? "" : RAW_URL;
const TIMEOUT_MS = 20_000;
// The free backend host sleeps after ~15 idle minutes and takes 30-60 s to wake up.
// Reads that time out or can't connect get one more, longer try before showing an error.
const WAKE_TIMEOUT_MS = 70_000;

/** Every failure, real or mock, comes out as one of these. `status` is null for network errors. */
export class ApiError extends Error {
  constructor(message: string, public status: number | null = null) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE = "Can't reach the archive server. Check your connection, then try again.";
const STILL_WAKING = "The archive server is still waking up (free hosting sleeps when idle). Try again in a moment.";

async function readDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    /* body wasn't JSON */
  }
  if (res.status === 404) return "Not found.";
  if (res.status === 413) return "File is larger than 20 MB.";
  if (res.status >= 500) return "The server hit an unexpected error.";
  return `The server answered ${res.status}.`;
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const isRead = !init?.method || init.method === "GET";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), retry ? TIMEOUT_MS : WAKE_TIMEOUT_MS);
  let res: Response;
  try {
    const token = authToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    res = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal, cache: "no-store" });
  } catch (e) {
    // Only reads are retried: repeating a write (e.g. PATCH) could apply it twice
    if (retry && isRead) return request<T>(path, init, false);
    const timedOut = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(timedOut ? (isRead ? STILL_WAKING : "The archive server took too long to answer.") : OFFLINE);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && authToken() && !path.startsWith("/auth/")) setSession(null); // expired sign-in
  if (!res.ok) throw new ApiError(await readDetail(res), res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Runs a mock endpoint and converts its errors to ApiError, so pages can't tell the difference. */
async function viaMock<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof mock.MockHttpError) throw new ApiError(e.message, e.status);
    throw e;
  }
}

// ---------- endpoints ----------

export function getHealth(): Promise<Health> {
  return USE_MOCK ? Promise.resolve({ ok: true, db: true, pgvector: true }) : request("/health");
}

export async function getEntities(type = "monument"): Promise<EntitiesResponse> {
  return USE_MOCK ? viaMock(() => mock.getEntities()) : request(`/entities?type=${encodeURIComponent(type)}`);
}

export function getEntity(id: number): Promise<EntityDetail> {
  return USE_MOCK ? viaMock(() => mock.getEntity(id)) : request(`/entities/${id}`);
}

export function search(q: string, limit = 10): Promise<SearchResponse> {
  return USE_MOCK
    ? viaMock(() => mock.search(q, limit))
    : request(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export function setClaimStatus(id: number, status: ClaimStatus): Promise<ClaimStatusResponse> {
  return USE_MOCK
    ? viaMock(() => mock.patchClaim(id, status))
    : request(`/claims/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
}

/**
 * POST /entities/{id}/models: add a 3D model to a monument, either a Sketchfab link
 * (JSON { sketchfab_url }) or a .glb/.gltf file (multipart field "file").
 */
export function addModel(entityId: number, input: { sketchfabUrl: string; sketchfabUid: string } | { file: File }): Promise<EntityModel> {
  if (USE_MOCK) {
    return viaMock(() => mock.addModel(entityId, "file" in input ? { file: input.file } : { sketchfabUid: input.sketchfabUid }));
  }
  if ("file" in input) {
    const form = new FormData();
    form.append("file", input.file);
    // false = no retry, and the longer 70 s timeout: 3D files can be large
    return request(`/entities/${entityId}/models`, { method: "POST", body: form }, false);
  }
  return request(`/entities/${entityId}/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sketchfab_url: input.sketchfabUrl }),
  });
}

/** POST /ask: a question answered only from the archive's records. Answers can take 10-20 s. */
export function ask(question: string, entityId?: number): Promise<AskResponse> {
  if (USE_MOCK) return Promise.reject(new ApiError("Ask the archive needs the live backend (set NEXT_PUBLIC_API_URL)."));
  return request(
    "/ask",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, entity_id: entityId ?? null }),
    },
    false, // no retry, and the longer timeout: writing an answer takes a while
  );
}

const NEEDS_LIVE = "This feature needs the live backend (set NEXT_PUBLIC_API_URL).";

/** GET /review: unverified AI facts, riskiest first. */
export function getReview(limit = 30): Promise<ReviewResponse> {
  return USE_MOCK ? Promise.reject(new ApiError(NEEDS_LIVE)) : request(`/review?limit=${limit}`);
}

/** GET /timeline: every dated monument with its date range. */
export function getTimeline(): Promise<TimelineResponse> {
  return USE_MOCK ? Promise.reject(new ApiError(NEEDS_LIVE)) : request("/timeline");
}

/** POST /inscription/read: an AI reading of an inscription photo. Takes 10-30 s. */
export function readInscription(file: File): Promise<InscriptionReading> {
  if (USE_MOCK) return Promise.reject(new ApiError(NEEDS_LIVE));
  const form = new FormData();
  form.append("file", file);
  return request("/inscription/read", { method: "POST", body: form }, false);
}

/** GET /duplicates: pairs of monuments that may be the same place. */
export function getDuplicates(): Promise<DuplicatesResponse> {
  return USE_MOCK ? Promise.reject(new ApiError(NEEDS_LIVE)) : request("/duplicates");
}

/** POST /entities/{keep}/merge: fold `duplicateId` into `keepId`. */
export function mergeMonuments(keepId: number, duplicateId: number): Promise<{ kept: { id: number; name: string } }> {
  return request(`/entities/${keepId}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duplicate_id: duplicateId }),
  });
}

/** POST /duplicates/dismiss: these two are different places; don't suggest them again. */
export function markDifferent(a: number, b: number): Promise<unknown> {
  return request("/duplicates/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a, b }),
  });
}

export function getPriorities(): Promise<PrioritiesResponse> {
  return USE_MOCK ? viaMock(() => mock.getPriorities()) : request("/priorities");
}

/** GET /sources/{id}/text: the full text of a file, page by page, with English translations. */
export function getSourceText(id: number): Promise<SourceText> {
  return USE_MOCK ? Promise.reject(new ApiError(NEEDS_LIVE)) : request(`/sources/${id}/text`);
}

export function getStories(): Promise<StoriesResponse> {
  return USE_MOCK ? Promise.reject(new ApiError(NEEDS_LIVE)) : request("/stories");
}

export function getJourneys(): Promise<JourneysResponse> {
  return USE_MOCK ? Promise.reject(new ApiError(NEEDS_LIVE)) : request("/journeys");
}

export function getCrafts(): Promise<CraftsResponse> {
  return USE_MOCK ? Promise.reject(new ApiError(NEEDS_LIVE)) : request("/crafts");
}

/** GET /entities/{id}/twin: how ready a monument's photos are for a 3D reconstruction. */
export function getTwin(id: number): Promise<TwinReport> {
  return USE_MOCK ? Promise.reject(new ApiError(NEEDS_LIVE)) : request(`/entities/${id}/twin`);
}

/** A direct download link: every photo of a monument plus cameras.csv, for photogrammetry. */
export function photoBundleUrl(id: number): string | null {
  return USE_MOCK ? null : `${API_URL}/entities/${id}/photo-bundle`;
}

export function getSource(id: number): Promise<SourceDetail> {
  return USE_MOCK ? viaMock(() => mock.getSource(id)) : request(`/sources/${id}`);
}

/**
 * POST /upload with multipart field "files".
 * Uses XMLHttpRequest because fetch can't report upload progress. onProgress gets 0–100.
 */
export function upload(
  files: File[],
  onProgress?: (pct: number) => void,
  credit?: { contributor?: string; cohort?: string },
): Promise<UploadResponse> {
  if (USE_MOCK) {
    let pct = 0;
    const tick = setInterval(() => onProgress?.((pct = Math.min(90, pct + 18))), 100);
    return viaMock(() => mock.upload(files)).finally(() => {
      clearInterval(tick);
      onProgress?.(100);
    });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/upload`);
    const token = authToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { detail?: unknown } | UploadResponse | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body && "sources" in body) {
        resolve(body);
        return;
      }
      const detail = body && "detail" in body && typeof body.detail === "string" ? body.detail : null;
      const fallback = xhr.status === 413 ? "File is too large." : `Upload failed (${xhr.status}).`;
      reject(new ApiError(detail ?? fallback, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError(OFFLINE));
    xhr.ontimeout = () => reject(new ApiError("The upload took too long. Try a smaller file."));

    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (credit?.contributor?.trim()) form.append("contributor", credit.contributor.trim());
    if (credit?.cohort?.trim()) form.append("cohort", credit.cohort.trim());
    xhr.send(form);
  });
}

// ---------- contributor accounts ----------

export interface MyContributions {
  user: Account;
  email_verified: boolean;
  totals: { uploads: number; facts: number; verified: number; rejected: number; monuments: number };
  uploads: { id: number; filename: string; type: string; status: string; created_at: string; n_facts: number; entities: { id: number; name: string }[] }[];
  reviews: { id: number; field: string; value: string; status: string; reviewed_at: string | null; entity_id: number; entity_name: string }[];
}

const NEEDS_ACCOUNTS = "Accounts need the live backend (set NEXT_PUBLIC_API_URL).";

export async function signUp(input: { name: string; email: string; password: string; reason?: string }): Promise<Account> {
  if (USE_MOCK) throw new ApiError(NEEDS_ACCOUNTS);
  const r = await request<{ token: string; user: Account }>("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  setSession(r);
  return r.user;
}

export async function signIn(email: string, password: string): Promise<Account> {
  if (USE_MOCK) throw new ApiError(NEEDS_ACCOUNTS);
  const r = await request<{ token: string; user: Account }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  setSession(r);
  return r.user;
}

export async function signOut(): Promise<void> {
  try {
    if (!USE_MOCK) await request("/auth/logout", { method: "POST" });
  } catch {
    /* signed out locally either way */
  }
  setSession(null);
}

export function getMe(): Promise<MyContributions> {
  return USE_MOCK ? Promise.reject(new ApiError(NEEDS_ACCOUNTS)) : request("/me");
}

export function updateMe(input: { name?: string; reason?: string }): Promise<Account> {
  return request("/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}
