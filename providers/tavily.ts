/**
 * Tavily provider — site map exploration.
 *
 * Uses Tavily Map API to explore a site's URL structure.
 * Returns list of discovered URLs.
 */
import type { WebAccessConfig } from "../config.js";
import type { MapResult } from "../types.js";
import { WebAccessError } from "../types.js";
import { retryWithBackoff, providerError, fetchWithTimeout } from "./shared.js";

export interface MapOptions {
  maxDepth?: number;
  instructions?: string;
}

export async function tavilyMap(
  url: string,
  config: WebAccessConfig,
  options: MapOptions = {},
  signal?: AbortSignal,
): Promise<MapResult> {
  if (!config.tavilyApiKey) {
    throw new WebAccessError("provider_not_configured", "map: TAVILY_API_KEY not configured.");
  }

  const endpoint = `${(config.tavilyApiUrl ?? "https://api.tavily.com").replace(/\/$/, "")}/map`;
  const maxDepth = Math.min(Math.max(Math.trunc(options.maxDepth ?? 1), 1), 3);
  const payload = {
    url,
    max_depth: maxDepth,
    max_breadth: config.mapMaxBreadth ?? 20,
    limit: config.mapLimit ?? 50,
    timeout: Math.round((config.mapTimeoutMs ?? 150_000) / 1000),
  } as Record<string, unknown>;

  if (options.instructions) {
    payload.instructions = options.instructions;
  }

  try {
    const raw = await retryWithBackoff(
      async () => {
        const res = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.tavilyApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }, config.tavilyTimeoutMs!, signal);
      return res.json();
      },
      { maxRetries: config.retryMaxAttempts!, signal },
    );

    const data = raw as Record<string, unknown>;
    return {
      baseUrl: (data.base_url as string) ?? (data.baseUrl as string) ?? url,
      results: Array.isArray(data.results) ? data.results.map(String) : [],
    };
  } catch (err) {
    throw providerError(err, "Tavily Map", signal);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Parallel discovery search (for grok_search additional_sources)
// ═══════════════════════════════════════════════════════════════════

import type { Source } from "../types.js";

/** Search Tavily as supplementary discovery. */
export async function tavilySearch(
  query: string,
  count: number,
  config: WebAccessConfig,
  signal?: AbortSignal,
): Promise<Source[]> {
  if (!config.tavilyApiKey) return [];
  const endpoint = `${(config.tavilyApiUrl ?? "https://api.tavily.com").replace(/\/$/, "")}/search`;

  const raw = await retryWithBackoff(
    async () => {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.tavilyApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, max_results: count }),
      }, Math.min(config.tavilyTimeoutMs ?? 90_000, 15_000), signal);
      return res.json();
    },
    { maxRetries: 1, signal },
  );

  const results = (raw as Record<string, unknown>)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .map(r => ({ url: String(r.url ?? ""), title: String(r.title ?? "") } as Source))
    .filter(s => s.url.startsWith("http"));
}

/** Search Firecrawl as supplementary discovery. */
export async function firecrawlSearch(
  query: string,
  config: WebAccessConfig,
  signal?: AbortSignal,
): Promise<Source[]> {
  if (!config.firecrawlApiKey) return [];
  const endpoint = `${(config.firecrawlApiUrl ?? "https://api.firecrawl.dev/v2").replace(/\/$/, "")}/search`;

  const raw = await retryWithBackoff(
    async () => {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.firecrawlApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, limit: 3 }),
      }, Math.min(config.firecrawlTimeoutMs ?? 90_000, 15_000), signal);
      return res.json();
    },
    { maxRetries: 1, signal },
  );

  const results = (raw as Record<string, unknown>)?.data;
  // Firecrawl returns { data: { web: [...], images: [...] } }
  const items = results && typeof results === "object"
    ? (results as Record<string, unknown>).web
    : undefined;
  if (!Array.isArray(items)) return [];
  return items
    .filter(r => r != null && typeof r === "object")
    .map(r => ({ url: String((r as Record<string, unknown>).url ?? "") } as Source))
    .filter(s => s.url.startsWith("http"));
}
