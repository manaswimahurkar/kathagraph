// Typed client for the KathaGraph API (shapes in lib/types.ts, from CONTRACT.md).
//
// THE SWITCH: NEXT_PUBLIC_API_URL
//   empty or "mock"            -> demo data from lib/mock.ts
//   https://your-api.onrender  -> the real backend

import type {
  ClaimStatus,
  ClaimStatusResponse,
  EntitiesResponse,
  EntityDetail,
  Health,
  SearchResponse,
  SourceDetail,
  UploadResponse,
} from "./types";
import * as mock from "./mock";

const RAW_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
export const USE_MOCK = RAW_URL === "" || RAW_URL.toLowerCase() === "mock";
const API_URL = USE_MOCK ? "" : RAW_URL;
const TIMEOUT_MS = 20_000;

/** Every failure, real or mock, comes out as one of these. `status` is null for network errors. */
export class ApiError extends Error {
  constructor(message: string, public status: number | null = null) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE = "Can't reach the archive server. Check your connection, then try again.";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(timedOut ? "The archive server took too long to answer." : OFFLINE);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError(await readDetail(res), res.status);
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

export function getSource(id: number): Promise<SourceDetail> {
  return USE_MOCK ? viaMock(() => mock.getSource(id)) : request(`/sources/${id}`);
}

/**
 * POST /upload with multipart field "files".
 * Uses XMLHttpRequest because fetch can't report upload progress. onProgress gets 0–100.
 */
export function upload(files: File[], onProgress?: (pct: number) => void): Promise<UploadResponse> {
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
      const fallback = xhr.status === 413 ? "File is larger than 20 MB." : `Upload failed (${xhr.status}).`;
      reject(new ApiError(detail ?? fallback, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError(OFFLINE));
    xhr.ontimeout = () => reject(new ApiError("The upload took too long. Try a smaller file."));

    const form = new FormData();
    for (const f of files) form.append("files", f);
    xhr.send(form);
  });
}
