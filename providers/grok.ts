/**
 * Grok search — xAI Responses → OpenAI-compatible fallback.
 * Both black-box to agent. Uses shared retry/error utilities.
 */
import type { WebAccessConfig } from "../config.js";
import type { SearchResult, Source } from "../types.js";
import { WebAccessError } from "../types.js";
import { retryWithBackoff, fetchWithTimeout, providerError, combineSignals } from "./shared.js";
import { tavilySearch, firecrawlSearch } from "./tavily.js";

// ═══════════════════════════════════════════════════════════════════
// Prompt
// ═══════════════════════════════════════════════════════════════════

const SEARCH_INSTRUCTION = `You are a helpful research assistant. Answer the user's question thoroughly using web search results.

Guidelines:
- Infer the user's true intent even when the question is vague. Consider multiple angles.
- Search broadly first (5+ perspectives), then go deep on the 2-3 most relevant ones.
- Prioritize authoritative sources: official docs, Wikipedia, academic papers, reputable journalism.
- Search in English first for breadth, switch to Chinese when the topic demands it.
- Every factual claim should cite its source. More credible sources strengthen the answer.
- Lead with the most likely answer, then provide supporting analysis.
- Define technical terms in plain language. Use real-world analogies for complex concepts.
- Format output in clean Markdown. Use LaTeX for formulas, code blocks for scripts.
- Be direct and concise. No filler or unnecessary follow-up questions.`;

// ═══════════════════════════════════════════════════════════════════
// Current-time context — mirrors CLI's get_local_time_info()
// ═══════════════════════════════════════════════════════════════════

function getLocalTimeInfo(): string {
  const now = new Date();
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekday = weekdays[now.getDay()]!;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    "[Current Time Context]",
    `- Date: ${now.toISOString().slice(0, 10)} (${weekday})`,
    `- Time: ${now.toTimeString().slice(0, 8)}`,
    `- Timezone: ${tz}`,
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// Citation Extraction
// ═══════════════════════════════════════════════════════════════════

export function extractInlineCitations(content: string): Source[] {
  const re = /\[\[(\d+)\]\]\(((?:https?:\/\/)[^\s<>\[\]()]+)\)/g;
  const sources: Source[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(re)) {
    const url = m[2]!;
    if (seen.has(url)) continue;
    seen.add(url);
    sources.push({ url });
  }
  return sources;
}

function normalizeCitation(item: unknown): Source | null {
  if (typeof item === "string") {
    const trimmed = item.trim();
    if (!trimmed.startsWith("http")) return null;
    return { url: trimmed };
  }
  if (!item || typeof item !== "object") return null;
  const c = item as Record<string, unknown>;
  const url = typeof c.url === "string" ? c.url
    : typeof c.href === "string" ? c.href
    : typeof c.link === "string" ? c.link
    : undefined;
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  const source: Source = { url };
  const title = typeof c.title === "string" ? c.title
    : typeof c.name === "string" ? c.name
    : typeof c.label === "string" ? c.label
    : undefined;
  if (title?.trim()) source.title = title.trim();
  return source;
}

function collectCitations(data: Record<string, unknown>): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];
  const addSource = (item: unknown) => {
    const normalized = normalizeCitation(item);
    if (normalized && !seen.has(normalized.url)) {
      seen.add(normalized.url);
      sources.push(normalized);
    }
  };
  const topCitations = data.citations;
  if (Array.isArray(topCitations)) topCitations.forEach(addSource);
  const choices = Array.isArray(data.choices) ? data.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const ch = choice as Record<string, unknown>;
    const msg = ch.message;
    if (msg && typeof msg === "object") {
      const m = msg as Record<string, unknown>;
      if (Array.isArray(m.citations)) m.citations.forEach(addSource);
    }
  }
  return sources;
}

// ═══════════════════════════════════════════════════════════════════
// Response Parsing
// ═══════════════════════════════════════════════════════════════════

export function parseXaiResponse(data: unknown): { content: string; sources: Source[] } {
  if (!data || typeof data !== "object") {
    throw new WebAccessError("network_error", "Unexpected xAI response format");
  }

  const obj = data as Record<string, unknown>;
  const output = Array.isArray(obj.output) ? obj.output : [];
  const textParts: string[] = [];
  const sources: Source[] = [];
  const seen = new Set<string>();

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const contentArray = (item as Record<string, unknown>).content;
    if (!Array.isArray(contentArray)) continue;

    for (const block of contentArray) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;

      if (b.type === "output_text" && typeof b.text === "string") {
        textParts.push(b.text);
      }

      const annotations = Array.isArray(b.annotations) ? b.annotations : [];
      for (const ann of annotations) {
        if (!ann || typeof ann !== "object") continue;
        const a = ann as Record<string, unknown>;
        if (a.type !== "url_citation") continue;
        if (typeof a.url !== "string" || !a.url.startsWith("http")) continue;
        if (seen.has(a.url)) continue;
        seen.add(a.url);
        const source: Source = { url: a.url };
        if (typeof a.title === "string" && a.title.trim()) {
          source.title = a.title.trim();
        }
        sources.push(source);
      }
    }
  }

  let sourceList = sources;
  if (sourceList.length === 0 && textParts.length > 0) {
    sourceList = extractInlineCitations(textParts.join("\n\n"));
  }

  return { content: textParts.join("\n\n").trim(), sources: sourceList };
}

export function parseOpenAiResponse(data: unknown, rawBody?: string): { content: string; sources: Source[] } {
  if (rawBody && !data) {
    const sseContent = parseSseBody(rawBody);
    if (sseContent) {
      return { content: sseContent, sources: extractInlineCitations(sseContent) };
    }
  }

  if (!data || typeof data !== "object") {
    throw new WebAccessError("network_error", "Unexpected OpenAI-compatible response format");
  }

  const obj = data as Record<string, unknown>;
  const choices = Array.isArray(obj.choices) ? obj.choices : [];
  let content = "";

  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const message = (choice as Record<string, unknown>).message;
    if (!message || typeof message !== "object") continue;
    const msg = message as Record<string, unknown>;
    if (typeof msg.content === "string") content = msg.content;
  }

  let sources = collectCitations(obj);
  if (sources.length === 0 && content) {
    sources = extractInlineCitations(content);
  }

  return { content, sources };
}

function parseSseBody(body: string): string | null {
  if (!body.trimStart().startsWith("data:")) return null;
  const parts: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]" || trimmed === "data:[DONE]") continue;
    if (trimmed.startsWith("data:")) {
      try {
        const json = JSON.parse(trimmed.slice(5).trim());
        const delta = json?.choices?.[0]?.delta;
        if (delta?.content) parts.push(delta.content);
      } catch { /* skip */ }
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

// ═══════════════════════════════════════════════════════════════════
// Main search + discovery helpers
// ═══════════════════════════════════════════════════════════════════

async function searchMain(query: string, config: WebAccessConfig, signal?: AbortSignal, onChunk?: (text: string) => void): Promise<SearchResult> {
  const errors: string[] = [];

  if (config.grokApiKey) {
    try {
      return await tryXaiSearch(query, config, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof WebAccessError && err.code === "auth_error") throw err;
      if (err instanceof WebAccessError && err.code !== "network_error") throw err;
      errors.push(`xAI: ${(err as Error).message}`);
    }
  }

  if (config.openaiApiUrl && config.openaiApiKey) {
    try {
      return await tryOpenAiSearch(query, config, signal, onChunk);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof WebAccessError && err.code === "auth_error") throw err;
      if (err instanceof WebAccessError && err.code !== "network_error") throw err;
      errors.push(`OpenAI: ${(err as Error).message}`);
    }
  }

  const detail = errors.length > 0 ? `Errors: ${errors.join("; ")}` : "";
  throw new WebAccessError(
    "network_error",
    `grok_search: all providers failed. ${detail}`.trim(),
  );
}

async function discoverAdditional(query: string, count: number, config: WebAccessConfig, signal?: AbortSignal): Promise<Source[]> {
  const tavilyCount = Math.ceil(count * 0.6);
  const [tavily, firecrawl] = await Promise.allSettled([
    tavilySearch(query, tavilyCount, config, signal),
    firecrawlSearch(query, config, signal),
  ]);
  const sources: Source[] = [];
  const seen = new Set<string>();
  const addSource = (s: Source) => {
    if (!seen.has(s.url)) {
      seen.add(s.url);
      sources.push(s);
    }
  };
  if (tavily.status === "fulfilled") for (const s of tavily.value) addSource(s);
  if (firecrawl.status === "fulfilled") for (const s of firecrawl.value) addSource(s);
  return sources;
}

// ═══════════════════════════════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════════════════════════════

export async function grokSearch(
  query: string,
  config: WebAccessConfig,
  signal?: AbortSignal,
  additionalSources = 0,
  onChunk?: (text: string) => void,
): Promise<SearchResult> {
  const timeContext = getLocalTimeInfo();
  const timedQuery = `${timeContext}\n\n${query}`;

  // ── Parallel: main search + discovery ──────────────────────────
  const [mainResult, discovered] = await Promise.allSettled([
    searchMain(timedQuery, config, signal, onChunk),
    additionalSources > 0
      ? discoverAdditional(query, additionalSources, config, signal)
      : Promise.resolve([] as Source[]),
  ]);

  // Unwrap main result
  if (mainResult.status === "rejected") throw mainResult.reason;
  const result = mainResult.value;

  // Attach discovery — dedup against primarySources and within discovery
  if (discovered.status === "fulfilled" && discovered.value.length > 0) {
    const primaryUrls = new Set(result.primarySources.map(s => s.url));
    const deduped: Source[] = [];
    const seen = new Set<string>();
    for (const s of discovered.value) {
      if (primaryUrls.has(s.url) || seen.has(s.url)) continue;
      seen.add(s.url);
      deduped.push(s);
    }
    if (deduped.length > 0) result.additionalSources = deduped;
  }

  return result;
}

async function tryXaiSearch(
  query: string,
  config: WebAccessConfig,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const apiUrl = config.grokApiUrl!.replace(/\/$/, "");
  const payload = {
    model: config.grokModel!,
    instructions: SEARCH_INSTRUCTION,
    input: [{ role: "user" as const, content: query }],
    stream: false,
    tools: [{ type: "web_search" }, { type: "x_search" }],
  };

  try {
    const res = await retryWithBackoff(
      async () => {
        const r = await fetchWithTimeout(
          `${apiUrl}/responses`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.grokApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          config.grokTimeoutMs!,
          signal,
        );
        return r.json();
      },
      { maxRetries: config.retryMaxAttempts!, signal, baseDelayMs: 2_000 },
    );

    const parsed = parseXaiResponse(res);
    return { content: parsed.content, primarySources: parsed.sources };
  } catch (error) {
    throw providerError(error, "xAI", signal);
  }
}

async function tryOpenAiSearch(
  query: string,
  config: WebAccessConfig,
  signal?: AbortSignal,
  onChunk?: (text: string) => void,
): Promise<SearchResult> {
  const apiUrl = config.openaiApiUrl!.replace(/\/$/, "");
  const payload = {
    model: config.openaiModel!,
    messages: [
      { role: "system" as const, content: SEARCH_INSTRUCTION },
      { role: "user" as const, content: query },
    ],
    stream: true,
  };

  try {
    // Use fetch directly for streaming response body
    const controller = new AbortController();
    const combined = signal ? combineSignals(signal, controller.signal) : controller.signal;
    const timeoutMs = config.grokTimeoutMs!;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: combined,
      });

      if (!response.ok || !response.body) {
        const errBody = await response.text().catch(() => "");
        throw new WebAccessError(
          response.status === 401 || response.status === 403 ? "auth_error" : "network_error",
          `OpenAI API error ${response.status}: ${errBody.slice(0, 200)}`,
        );
      }

      // Stream SSE chunks
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]" || trimmed === "data:[DONE]") continue;
          if (!trimmed.startsWith("data:")) continue;
          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              onChunk?.(fullContent);
            }
          } catch { /* skip malformed lines */ }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data:") && trimmed !== "data:[DONE]" && trimmed !== "data: [DONE]") {
          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              onChunk?.(fullContent);
            }
          } catch { /* skip */ }
        }
      }

      if (fullContent) {
        return { content: fullContent, primarySources: extractInlineCitations(fullContent) };
      }
      throw new WebAccessError("network_error", "OpenAI returned empty response");
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    throw providerError(error, "OpenAI", signal);
  }
}
