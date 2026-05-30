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
  if (Number.isFinite(n) && n > 0) return n;
  const date = Date.parse(raw.trim());
  if (!Number.isNaN(date)) {
    const delay = (date - Date.now()) / 1000;
    return delay > 0 ? delay : undefined;
  }
  return undefined;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; signal?: AbortSignal; baseDelayMs?: number },
): Promise<T> {
  const { maxRetries, signal, baseDelayMs = 1_000 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    signal?.throwIfAborted();

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const kind = classifyError(error);
      if ((kind === ErrorKind.Retryable || kind === ErrorKind.RateLimited) && attempt < maxRetries) {
        const retryAfter = parseRetryAfter(error);
        const delay = retryAfter
          ? retryAfter * 1000
          : baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
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
  if (isTimeout) {
    throw new WebAccessError("timeout", `${label} request timed out.`, error);
  }
  const kind = classifyError(error);
  if (kind === ErrorKind.Auth) {
    throw new WebAccessError("auth_error", `${label} API authentication failed. Check API key.`, error);
  }
  if (kind === ErrorKind.RateLimited) {
    throw new WebAccessError("rate_limited", `${label} rate limited. Retry later.`, error);
  }
  if (kind === ErrorKind.Fatal) {
    throw new WebAccessError("network_error", `${label} API error: ${(error as Error).message}`, error);
  }
  throw new WebAccessError("network_error", `${label} request failed after retries: ${(error as Error).message}`, error);
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
    // Attach headers to the error for Retry-After extraction
    const wrapped = {
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
      json: () => res.json(),
      headers: res.headers,
    } as FetchWithTimeoutResult;

    if (!wrapped.ok) {
      const body = await wrapped.text().catch(() => "");
      const err = new Error(`HTTP ${wrapped.status}: ${body.slice(0, 300)}`) as Error & { status: number; headers: Record<string, string> };
      err.status = wrapped.status;
      err.headers = Object.fromEntries(wrapped.headers.entries());
      throw err;
    }

    return wrapped;
  } catch (error) {
    if (timedOut) throw providerError(error, url, signal, true);
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
