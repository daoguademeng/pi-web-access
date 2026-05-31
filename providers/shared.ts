/**
 * Shared utilities for all web-access providers.
 * Retry logic, error classification, signal helpers.
 */
import { WebAccessError } from "../types.js";

// ═══════════════════════════════════════════════════════════════════
// Error Classification
// ═══════════════════════════════════════════════════════════════════

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const AUTH_ERROR_STATUSES = new Set([401, 403]);
const RATE_LIMIT_STATUSES = new Set([429]);

export enum ErrorKind { Retryable, Auth, Fatal, RateLimited }

export function classifyError(error: unknown): ErrorKind {
  if (error instanceof WebAccessError) return ErrorKind.Fatal;
  if (error instanceof DOMException && error.name === "AbortError") {
    return ErrorKind.Fatal;
  }
  if (error instanceof TypeError && error.message.includes("fetch")) return ErrorKind.Retryable;

  const status = extractStatus(error);
  if (status === undefined) return ErrorKind.Retryable;
  if (AUTH_ERROR_STATUSES.has(status)) return ErrorKind.Auth;
  if (RATE_LIMIT_STATUSES.has(status)) return ErrorKind.RateLimited;
  if (RETRYABLE_STATUSES.has(status)) return ErrorKind.Retryable;
  return ErrorKind.Fatal;
}

function extractStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const s = (error as { status: unknown }).status;
    if (typeof s === "number") return s === 0 ? undefined : s;
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════
// Retry
// ═══════════════════════════════════════════════════════════════════

function parseRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const headers = (error as { headers?: unknown }).headers;
  if (!headers || typeof headers !== "object") return undefined;
  const raw = (headers as Record<string, string>)["retry-after"];
  if (!raw) return undefined;
  const n = Number(raw.trim());
  if (Number.isFinite(n) && n > 0) return Math.min(n, 60);
  const date = Date.parse(raw.trim());
  if (!Number.isNaN(date)) {
    const delay = (date - Date.now()) / 1000;
    return delay > 0 ? Math.min(delay, 60) : undefined;
  }
  return undefined;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; signal?: AbortSignal; baseDelayMs?: number },
): Promise<T> {
  const { maxRetries, signal, baseDelayMs = 1_000 } = options;
  const maxAttempts = Math.max(1, Math.trunc(maxRetries));
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    signal?.throwIfAborted();

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const kind = classifyError(error);
      if ((kind === ErrorKind.Retryable || kind === ErrorKind.RateLimited) && attempt < maxAttempts - 1) {
        const retryAfter = parseRetryAfter(error);
        const delay = retryAfter
          ? retryAfter * 1000
          : baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (onAbort) signal?.removeEventListener("abort", onAbort);
            resolve();
          }, delay);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        });
        continue;
      }
      break;
    }
  }

  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════
// Provider Error Wrapper
// ═══════════════════════════════════════════════════════════════════

export function providerError(
  error: unknown,
  label: string,
  signal?: AbortSignal,
  isTimeout = false,
): never {
  if (signal?.aborted) throw error;
  if (error instanceof WebAccessError) throw error;
  if (isTimeout) {
    throw new WebAccessError("timeout", `${label} request timed out.`);
  }
  const kind = classifyError(error);
  if (kind === ErrorKind.Auth) {
    throw new WebAccessError("auth_error", `${label} API authentication failed. Check API key.`);
  }
  if (kind === ErrorKind.RateLimited) {
    throw new WebAccessError("rate_limited", `${label} rate limited. Retry later.`);
  }
  if (kind === ErrorKind.Fatal) {
    throw new WebAccessError("network_error", `${label} API error.`);
  }
  throw new WebAccessError("network_error", `${label} request failed after retries.`);
}

// ═══════════════════════════════════════════════════════════════════
// HTTP fetch with timeout
// ═══════════════════════════════════════════════════════════════════

export interface FetchWithTimeoutResult {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

/**
 * fetch() with configurable timeout.
 * Returns the fetch response or throws on timeout/network error.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<FetchWithTimeoutResult> {
  const controller = new AbortController();
  const linkedSignal = signal
    ? combineSignals(signal, controller.signal)
    : controller.signal;

  let timedOut = false;
  const onTimeout = () => { timedOut = true; controller.abort(); };
  const timer = setTimeout(onTimeout, timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: linkedSignal });

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`) as Error & { status: number; headers: Record<string, string> };
      err.status = res.status;
      err.headers = Object.fromEntries(res.headers.entries());
      throw err;
    }

    return res as FetchWithTimeoutResult;
  } catch (error) {
    if (timedOut) throw providerError(error, url, signal, true);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function readResponseTextLimited(res: { headers: Headers; text: () => Promise<string>; } | Response, maxBytes = 5_000_000): Promise<string> {
  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new WebAccessError("no_results", `response too large (${contentLength} bytes; limit ${maxBytes}).`);
  }
  const body = (res as Response).body;
  if (!body || typeof body.getReader !== "function") {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new WebAccessError("no_results", `response too large (limit ${maxBytes} bytes).`);
    }
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new WebAccessError("no_results", `response too large (limit ${maxBytes} bytes).`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

// ═══════════════════════════════════════════════════════════════════
// Signal Helpers
// ═══════════════════════════════════════════════════════════════════

export function combineSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([s1, s2]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  s1.addEventListener("abort", abort, { once: true });
  s2.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
