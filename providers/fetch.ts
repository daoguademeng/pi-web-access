/**
 * Fetch provider — HEAD pre-check → smart routing.
 *
 * Routing:
 *   text/*, application/json → direct HTTP GET (zero API cost)
 *   text/html → Tavily → Firecrawl fallback
 *   binary → rejected with guidance
 */
import type { WebAccessConfig } from "../config.js";
import type { FetchResult } from "../types.js";
import { WebAccessError } from "../types.js";
import { retryWithBackoff, providerError, fetchWithTimeout, readResponseTextLimited } from "./shared.js";

// ═══════════════════════════════════════════════════════════════════
// URL normalization
// ═══════════════════════════════════════════════════════════════════

/** Rewrite known hosted file URLs to raw/plain-text equivalents. */
export function normalizeFetchUrl(url: string): string {
  // GitHub blob → raw (handles branch names with slashes, dots, dashes)
  const gh = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+?)\/([^/]+)$/);
  if (gh) {
    return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}/${gh[4]}`;
  }
  return url;
}

// ═══════════════════════════════════════════════════════════════════
// Content-type detection
// ═══════════════════════════════════════════════════════════════════

const DIRECT_TEXT_TYPES = new Set([
  "text/plain", "text/markdown", "text/x-python", "text/x-csrc",
  "text/x-c++src", "text/x-rust", "text/javascript", "text/typescript",
  "text/css", "text/csv", "text/xml", "text/toml", "text/yaml",
  "text/x-toml", "text/x-yaml", "application/json", "application/xml",
  "application/x-yaml", "application/x-toml", "application/javascript",
]);

const BINARY_PREFIXES = [
  "application/pdf", "application/zip", "application/gzip",
  "application/octet-stream", "image/", "video/", "audio/", "font/",
];

function isDirectText(ct: string): boolean {
  const base = ct.split(";")[0]!.trim().toLowerCase();
  if (DIRECT_TEXT_TYPES.has(base)) return true;
  if (base.startsWith("text/")) return true;
  return false;
}

function isBinary(ct: string): boolean {
  return BINARY_PREFIXES.some(p => ct.toLowerCase().startsWith(p));
}

// ═══════════════════════════════════════════════════════════════════
// Content sniffing (HEAD failure fallback — read first bytes)
// ═══════════════════════════════════════════════════════════════════

async function sniffContentType(url: string, config: WebAccessConfig, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Range: "bytes=0-511" },
    }, Math.min(config.mapTimeoutMs ?? 30_000, 30_000), signal);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type");
    if (ct) return ct;
    // Peek at first bytes
    const textSample = await readResponseTextLimited(res, 512);
    const buf = new TextEncoder().encode(textSample);
    // Binary check
    for (const byte of buf) {
      if (byte === 0) return "application/octet-stream";
    }
    const text = textSample.slice(0, 100);
    if (text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html")) return "text/html";
    if (text.trimStart().startsWith("{")) return "application/json";
    return "text/plain";
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Tavily Extract
// ═══════════════════════════════════════════════════════════════════

async function tavilyExtract(
  url: string,
  config: WebAccessConfig,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!config.tavilyApiKey) return null;
  const endpoint = `${(config.tavilyApiUrl ?? "https://api.tavily.com").replace(/\/$/, "")}/extract`;

  const raw = await retryWithBackoff(
    async () => {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.tavilyApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ urls: [url], format: "markdown" }),
      }, config.tavilyTimeoutMs!, signal);
      return res.json();
    },
    { maxRetries: config.retryMaxAttempts!, signal },
  );

  const results = (raw as Record<string, unknown>)?.results;
  if (Array.isArray(results) && results.length > 0) {
    const content = (results[0] as Record<string, unknown>)?.raw_content;
    return typeof content === "string" && content.trim() ? content : null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Firecrawl Scrape
// ═══════════════════════════════════════════════════════════════════

async function firecrawlScrape(
  url: string,
  config: WebAccessConfig,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!config.firecrawlApiKey) return null;
  const endpoint = `${(config.firecrawlApiUrl ?? "https://api.firecrawl.dev/v2").replace(/\/$/, "")}/scrape`;

  const raw = await retryWithBackoff(
    async () => {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.firecrawlApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, formats: ["markdown"], timeout: 60_000 }),
      }, config.firecrawlTimeoutMs!, signal);
      return res.json();
    },
    { maxRetries: config.retryMaxAttempts!, signal },
  );

  const markdown = (raw as Record<string, unknown>)?.data;
  if (markdown && typeof markdown === "object") {
    const content = (markdown as Record<string, unknown>).markdown;
    return typeof content === "string" && content.trim() ? content : null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Fetch page — smart routing
// ═══════════════════════════════════════════════════════════════════

export async function fetchPage(
  url: string,
  config: WebAccessConfig,
  signal?: AbortSignal,
): Promise<FetchResult> {
  const normalizedUrl = normalizeFetchUrl(url);

  // ── HEAD pre-check ──────────────────────────────────────────────
  let contentType: string | null = null;
  try {
    const headRes = await fetchWithTimeout(normalizedUrl, { method: "HEAD", redirect: "error" }, Math.min(config.mapTimeoutMs ?? 30_000, 30_000), signal);
    contentType = headRes.headers.get("content-type") ?? null;
  } catch {
    // HEAD failed — try byte-range sniffing
    contentType = await sniffContentType(normalizedUrl, config, signal);
  }

  // ── Binary → reject ────────────────────────────────────────────
  if (contentType && isBinary(contentType)) {
    throw new WebAccessError(
      "no_results",
      `fetch: binary content (${contentType}). Use bash curl to download this file.`,
    );
  }

  // ── Direct text fetch ──────────────────────────────────────────
  if (contentType && isDirectText(contentType) && !contentType.startsWith("text/html")) {
    try {
      const res = await fetchWithTimeout(normalizedUrl, { redirect: "error" }, Math.min(config.mapTimeoutMs ?? 30_000, 30_000), signal);
      const text = await readResponseTextLimited(res as unknown as Response);
      return { url: normalizedUrl, provider: "direct", content: text };
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }

  // ── HTML path: Tavily → Firecrawl ───────────────────────────────
  const errors: string[] = [];

  if (config.tavilyApiKey) {
    try {
      const content = await tavilyExtract(normalizedUrl, config, signal);
      if (content) return { url: normalizedUrl, provider: "tavily", content };
      errors.push("Tavily: returned empty");
    } catch (err) {
      if (signal?.aborted) throw err;
      try { throw providerError(err, "Tavily", signal); } catch (wrapped) {
        if (wrapped instanceof WebAccessError && wrapped.code === "auth_error") throw wrapped;
        if (wrapped instanceof WebAccessError && wrapped.code !== "network_error") throw wrapped;
        errors.push(`Tavily: ${(wrapped as Error).message}`);
      }
    }
  }

  if (config.firecrawlApiKey) {
    try {
      const content = await firecrawlScrape(normalizedUrl, config, signal);
      if (content) return { url: normalizedUrl, provider: "firecrawl", content };
      errors.push("Firecrawl: returned empty");
    } catch (err) {
      if (signal?.aborted) throw err;
      try { throw providerError(err, "Firecrawl", signal); } catch (wrapped) {
        if (wrapped instanceof WebAccessError && wrapped.code === "auth_error") throw wrapped;
        if (wrapped instanceof WebAccessError && wrapped.code !== "network_error") throw wrapped;
        errors.push(`Firecrawl: ${(wrapped as Error).message}`);
      }
    }
  }

  if (errors.length === 0) {
    // No provider configured and direct fetch failed — try fetch without timeout
    try {
      const res = await fetchWithTimeout(normalizedUrl, { redirect: "error" }, Math.min(config.mapTimeoutMs ?? 30_000, 30_000), signal);
      // Check content type from the actual response
      const ct = res.headers.get("content-type") ?? "";
      if (ct && isBinary(ct)) {
        throw new WebAccessError("no_results", `fetch: binary content (${ct}). Use bash curl.`);
      }
      const text = await readResponseTextLimited(res as unknown as Response);
      return { url: normalizedUrl, provider: "direct", content: text };
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(`direct: ${(err as Error).message}`);
    }
  }

  const detail = errors.length > 0 ? ` Errors: ${errors.join("; ")}` : "";
  throw new WebAccessError(
    "no_results",
    `fetch: could not retrieve content.${detail}`.trim(),
  );
}
