/**
 * Exa search provider — low-noise, authoritative source search.
 *
 * Two modes:
 *   search      — natural-language query → curated results (auto-prompt on)
 *   findSimilar — URL → similar pages
 */
import type { WebAccessConfig } from "../config.js";
import type { SearchResult, Source } from "../types.js";
import { WebAccessError } from "../types.js";
import { retryWithBackoff, providerError, fetchWithTimeout } from "./shared.js";

// ═══════════════════════════════════════════════════════════════════
// Response Parsing
// ═══════════════════════════════════════════════════════════════════

export function parseExaResponse(data: unknown, query: string): SearchResult {
  if (!data || typeof data !== "object") {
    throw new WebAccessError("network_error", "Unexpected Exa response format");
  }

  const obj = data as Record<string, unknown>;
  const results = Array.isArray(obj.results) ? obj.results : [];

  const contentParts: string[] = [`## Exa Search: ${query}\n`];
  const sources: Source[] = [];
  const seenUrls = new Set<string>();

  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    const title = typeof r.title === "string" ? r.title.trim() : "";
    const url = typeof r.url === "string" ? r.url.trim() : (typeof r.id === "string" ? r.id.trim() : "");
    if (!url) continue;

    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      const source: Source = { url };
      if (title) source.title = title;
      sources.push(source);
    }

    const header = title || url;
    contentParts.push(`### ${header}`);

    const meta: string[] = [];
    const score = typeof r.score === "number" ? r.score.toFixed(3) : undefined;
    if (score) meta.push(`score: ${score}`);
    const author = typeof r.author === "string" ? r.author.trim() : "";
    if (author) meta.push(author);
    const published = typeof r.publishedDate === "string" ? r.publishedDate.trim() : "";
    if (published) meta.push(published);
    if (meta.length > 0) contentParts.push(`*${meta.join(" · ")}*`);

    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (text) contentParts.push(`${text.slice(0, 300)}${text.length > 300 ? "…" : ""}`);

    contentParts.push(`[${url}](${url})\n`);
  }

  if (sources.length === 0) {
    return { content: "", primarySources: [] };
  }

  return { content: contentParts.join("\n").trim(), primarySources: sources };
}

// ═══════════════════════════════════════════════════════════════════
// Options
// ═══════════════════════════════════════════════════════════════════

export interface ExaOptions {
  numResults?: number;
  includeDomains?: string[];
  url?: string;
  startPublishedDate?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════════════════════════════

export async function exaSearch(
  query: string,
  config: WebAccessConfig,
  options: ExaOptions = {},
  signal?: AbortSignal,
): Promise<SearchResult> {
  if (!config.exaApiKey) {
    throw new WebAccessError("provider_not_configured", "exa_search: EXA_API_KEY not configured.");
  }

  const baseUrl = (config.exaBaseUrl ?? "https://api.exa.ai").replace(/\/$/, "");
  const numResults = Math.min(Math.max(options.numResults ?? 5, 1), 20);

  const isSimilar = !!options.url;

  const endpoint = isSimilar ? `${baseUrl}/findSimilar` : `${baseUrl}/search`;

  const payload: Record<string, unknown> = isSimilar
    ? { url: options.url, numResults }
    : {
        query: query.slice(0, 200),
        numResults,
        type: "neural",
        useAutoprompt: true,
        contents: { text: true },
      };

  if (!isSimilar && options.includeDomains?.length) {
    payload.includeDomains = options.includeDomains;
  }
  if (!isSimilar && options.startPublishedDate) {
    payload.startPublishedDate = options.startPublishedDate;
  }

  try {
    const raw = await retryWithBackoff(
      async () => {
        const res = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-api-key": config.exaApiKey!,
          },
          body: JSON.stringify(payload),
        }, config.exaTimeoutMs!, signal);
        return res.json();
      },
      { maxRetries: config.retryMaxAttempts!, signal },
    );

    return parseExaResponse(raw, query);
  } catch (err) {
    throw providerError(err, "Exa", signal);
  }
}
