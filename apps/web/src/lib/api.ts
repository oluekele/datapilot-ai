// Thin, typed client for the DataPilot API. The browser only talks to its own
// origin; Next.js rewrites /api/v1/* to the API service. The session lives in
// an HttpOnly cookie, so no tokens are ever handled here.

import type { ArtifactFilters, ArtifactPage, Job, OkResponse, OperationParams, OperationType } from "@/lib/types";

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

type ErrorBody = { statusCode?: number; code?: string; message?: string | string[] };

function fallbackMessage(status: number): string {
  if (status === 0) return "We couldn't reach DataPilot. Check your connection and try again.";
  if (status >= 500) return "DataPilot is temporarily unavailable. Please try again shortly.";
  if (status === 404) return "We couldn't find what you were looking for.";
  return "Something went wrong. Please try again.";
}

function toApiError(status: number, raw: string): ApiError {
  let body: ErrorBody | null = null;
  try {
    body = raw ? (JSON.parse(raw) as ErrorBody) : null;
  } catch {
    body = null;
  }
  const message = Array.isArray(body?.message)
    ? body.message.join(". ")
    : typeof body?.message === "string" && body.message.trim()
      ? body.message
      : fallbackMessage(status);
  return new ApiError(body?.statusCode ?? status, body?.code ?? null, message);
}

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type RequestOptions = {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;

  if (method !== "GET") headers["X-Requested-With"] = "datapilot";
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK", fallbackMessage(0));
  }

  const text = await response.text();
  if (!response.ok) throw toApiError(response.status, text);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });

/**
 * Multipart upload with progress reporting. fetch() cannot report upload
 * progress, so this uses XMLHttpRequest with the same conventions as api().
 */
export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress: (fraction: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);
    xhr.setRequestHeader("X-Requested-With", "datapilot");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK", fallbackMessage(0)));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T);
        } catch {
          resolve(undefined as T);
        }
      } else {
        reject(toApiError(xhr.status, xhr.responseText));
      }
    };
    xhr.send(form);
  });
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export function loginUrlFor(path: string): string {
  return `/login?next=${encodeURIComponent(path)}`;
}

export const datasetDownloadUrl = (datasetId: string, versionId: string) =>
  `${API_BASE}/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/download`;

export const datasetReportUrl = (datasetId: string, versionId: string) =>
  `${API_BASE}/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/report`;

// ---------------------------------------------------------------------------
// Analysis operations & artifacts (contract v1.1)
// ---------------------------------------------------------------------------

/** Maximum number of artifacts one archive request may contain. */
export const ARCHIVE_LIMIT = 200;

/** Queue an EXPLORE / ANALYZE / VISUALIZE / TRAIN job on a dataset version. */
export function runOperation<O extends OperationType>(datasetId: string, versionId: string, operation: O, params: OperationParams[O]): Promise<Job> {
  return apiPost<Job>(
    `/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/operations`,
    { operation, params },
  );
}

function filterQuery(filters: ArtifactFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.datasetId) query.set("datasetId", filters.datasetId);
  if (filters.jobId) query.set("jobId", filters.jobId);
  if (filters.kind) query.set("kind", filters.kind);
  if (filters.q?.trim()) query.set("q", filters.q.trim());
  return query;
}

/** Path (relative to API_BASE) for one page of artifacts, newest first. */
export function artifactsPath(filters: ArtifactFilters, options: { limit?: number; cursor?: string | null } = {}): string {
  const query = filterQuery(filters);
  if (options.limit) query.set("limit", String(options.limit));
  if (options.cursor) query.set("cursor", options.cursor);
  const qs = query.toString();
  return `/artifacts${qs ? `?${qs}` : ""}`;
}

export const listArtifacts = (filters: ArtifactFilters, options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}) =>
  apiGet<ArtifactPage>(artifactsPath(filters, options), options.signal);

export const deleteArtifact = (id: string) => apiDelete<OkResponse>(`/artifacts/${encodeURIComponent(id)}`);

export const artifactDownloadUrl = (id: string) => `${API_BASE}/artifacts/${encodeURIComponent(id)}/download`;
export const artifactPreviewUrl = (id: string) => `${API_BASE}/artifacts/${encodeURIComponent(id)}/preview`;

/** ZIP of specific artifacts (at most ARCHIVE_LIMIT ids are sent). */
export const artifactArchiveUrlForIds = (ids: string[]) =>
  `${API_BASE}/artifacts/archive?ids=${ids.slice(0, ARCHIVE_LIMIT).map(encodeURIComponent).join(",")}`;

/** ZIP of every artifact matching dataset / job / kind (the archive endpoint ignores text search). */
export function artifactArchiveUrl(filters: Omit<ArtifactFilters, "q">): string {
  const query = filterQuery({ datasetId: filters.datasetId, jobId: filters.jobId, kind: filters.kind });
  return `${API_BASE}/artifacts/archive?${query.toString()}`;
}
