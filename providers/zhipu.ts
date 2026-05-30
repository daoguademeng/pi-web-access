/**
 * Zhipu (BigModel) web_search provider — Chinese/domestic/realtime search.
 */
import type { WebAccessConfig } from "../config.js";
import type { SearchResult, Source } from "../types.js";
import { WebAccessError } from "../types.js";
import { retryWithBackoff, providerError, fetchWithTimeout } from "./shared.js";

// ═══════════════════════════════════════════════════════════════════
// Response Parsing
// ═══════════════════════════════════════════════════════════════════

export function parseZhipuResponse(data: unknown, query: string): SearchResult {
  if (!data || typeof data !== "object") {
    throw new WebAccessError("network_error", "Unexpected Zhipu response format");
  }

  const obj = data as Record<string, unknown>;
  const results = Array.isArray(obj.search_result) ? obj.search_result : [];

  const contentParts: string[] = [`## Zhipu Search: ${query}\n`];
  const sources: Source[] = [];
  const seenUrls = new Set<string>();

  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    const title = typeof r.title === "string" ? r.title.trim() : "";
    const link = typeof r.link === "string" ? r.link.trim()
      : typeof r.url === "string" ? r.url.trim() : "";
    const description = typeof r.content === "string" ? r.content.trim() : "";
    const media = typeof r.media === "string" ? r.media.trim() : "";
    const published = typeof r.publish_date === "string" ? r.publish_date.trim() : "";

    if (!link) continue;

    if (!seenUrls.has(link)) {
      seenUrls.add(link);
      const source: Source = { url: link };
      if (title) source.title = title;
      sources.push(source);
    }

    const header = title || link;
    contentParts.push(`### ${header}`);
    if (media || published) {
      const meta = [media, published].filter(Boolean).join(" · ");
      contentParts.push(`*${meta}*`);
    }
    if (description) contentParts.push(description);
    contentParts.push(`[${link}](${link})\n`);
  }

  if (sources.length === 0) {
    return { content: "", primarySources: [] };
  }

  return { content: contentParts.join("\n").trim(), primarySources: sources };
}

// ═══════════════════════════════════════════════════════════════════
// Options
// ═══════════════════════════════════════════════════════════════════

export interface ZhipuOptions {
  count?: number;
  recencyFilter?: "oneDay" | "oneWeek" | "oneMonth" | "oneYear" | "noLimit";
  domainFilter?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════════════════════════════

export async function zhipuSearch(
  query: string,
  config: WebAccessConfig,
  options: ZhipuOptions = {},
  signal?: AbortSignal,
): Promise<SearchResult> {
  if (!config.zhipuApiKey) {
    throw new WebAccessError("provider_not_configured", "zhipu_search: ZHIPU_API_KEY not configured.");
  }

  const endpoint = `${(config.zhipuApiUrl ?? "https://open.bigmodel.cn/api").replace(/\/$/, "")}/paas/v4/web_search`;
  const searchEngine = config.zhipuSearchEngine ?? "search_pro_quark";

  const payload = {
    search_query: query.slice(0, 70),
    search_engine: searchEngine,
    count: Math.min(Math.max(options.count ?? 10, 1), 50),
    search_intent: true,
    search_recency_filter: options.recencyFilter ?? "noLimit",
    content_size: "medium",
  } as Record<string, unknown>;

  if (options.domainFilter) {
    payload.search_domain_filter = options.domainFilter;
  }

  try {
    const raw = await retryWithBackoff(
      async () => {
        const res = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.zhipuApiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        }, config.zhipuTimeoutMs!, signal);
        return res.json();
      },
      { maxRetries: config.retryMaxAttempts!, signal },
    );

    return parseZhipuResponse(raw, query);
  } catch (err) {
    throw providerError(err, "Zhipu", signal);
  }
}
