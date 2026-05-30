/**
 * web_access tool definition — All 6 actions + additional_sources.
 */
import { defineTool, truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadConfig, ensureConfig } from "./config.js";
import { WebAccessError } from "./types.js";
import type { WebAccessResult, Source, SearchResult } from "./types.js";
import { grokSearch } from "./providers/grok.js";
import { fetchPage } from "./providers/fetch.js";
import { zhipuSearch, type ZhipuOptions } from "./providers/zhipu.js";
import { exaSearch, type ExaOptions } from "./providers/exa.js";
import { context7Docs, type Context7Options } from "./providers/context7.js";
import { tavilyMap, type MapOptions } from "./providers/tavily.js";

// ═══════════════════════════════════════════════════════════════════
// Parallel-call status (thread-safe in Node single-thread)
// ═══════════════════════════════════════════════════════════════════

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerIdx = 0;
let activeCalls = 0;
let totalCallsThisRound = 0;
let failedCalls = 0;

export function resetRound() {
  activeCalls = 0;
  totalCallsThisRound = 0;
  failedCalls = 0;
}

function updateStatus(ctx: { ui: { setStatus: (key: string, value: string | undefined) => void } }, startedAt?: number) {
  if (activeCalls === 0) return;
  const done = totalCallsThisRound - activeCalls - failedCalls;
  const spin = SPINNER[spinnerIdx % SPINNER.length] ?? "·";
  const parts = [`web: ${done}/${totalCallsThisRound} ok`];
  if (failedCalls > 0) parts.push(`${failedCalls} failed`);
  parts.push(`${activeCalls} active`);
  if (startedAt) parts.push(formatElapsed(startedAt));
  ctx.ui.setStatus("web-access", `${spin} ${parts.join(" · ")}`);
}

// ═══════════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════════

const WebAccessSchema = Type.Object({
  action: StringEnum(["grok_search", "zhipu_search", "exa_search", "docs", "fetch", "map"] as const, {
    description: "Operation to perform: ⓵ `grok_search` for broad web search with Grok AI synthesis. Use when the answer URL is unknown and you need to discover it. Default choice for general queries when URL is unknown. Use additional_sources for parallel discovery. ⓶ `zhipu_search` for supplementary Chinese/domestic/realtime search. Use recency_filter and search_domain_filter. ⓷ `exa_search` for Low-noise search for official docs, papers, trusted domains. Give url for find-similar. ⓸ `docs` for SDK/API documentation lookup. Auto-resolves library id; re-call with library_id if ambiguous. ⓹ `fetch` for extracting full page text from a URL. Bridge from discovery to evidence. IMPORTANT: Search results are DISCOVERY hints, not ground truth. Fetching the most relevant URLs is mandatory.⓺ `map` for exploring a site's URL structure before bulk fetching.",
  }),
  query: Type.Optional(Type.String({ description: "Search query. Required for: grok_search, exa_search, zhipu_search, docs." })),
  url: Type.Optional(Type.String({ description: "Full URL. Required for: fetch, map. Optional for exa_search (switches to 'find similar' mode)." })),
  additionalSources: Type.Optional(Type.Number({ description: "Parallel discovery from Tavily/Firecrawl (0–5, default 0)." })),
  numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "Max results (1–20). Applies to: exa_search, zhipu_search." })),
  includeDomains: Type.Optional(Type.String({ description: "Comma-separated domains. Applies to: exa_search." })),
  startPublishedDate: Type.Optional(Type.String({ description: "Date filter (YYYY-MM-DD). Applies to: exa_search." })),
  recencyFilter: Type.Optional(StringEnum(["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"] as const, {
    description: "Time filter: oneDay | oneWeek | oneMonth | oneYear. Applies to: zhipu_search.",
  })),
  searchDomainFilter: Type.Optional(Type.String({ description: "Comma-separated domain whitelist for zhipu_search." })),
  libraryId: Type.Optional(Type.String({ description: "Context7 library id. Applies to: docs." })),
  instructions: Type.Optional(Type.String({ description: "Site exploration guidance. Applies to: map." })),
  maxDepth: Type.Optional(Type.Number({ description: "Crawl depth (default 1). Applies to: map." })),
});

type WebAccessParams = Static<typeof WebAccessSchema>;

// ═══════════════════════════════════════════════════════════════════

export interface WebAccessDetails {
  action: string;
  query?: string;
  url?: string;
  libraryId?: string;
  startedAt: number;
  displaySources?: Source[];
  sources?: Source[];   // aliased to displaySources for TUI
  sourceCount: number;
}

async function executeAction(params: WebAccessParams, cwd: string, signal?: AbortSignal, onChunk?: (text: string) => void): Promise<WebAccessResult> {
  const config = loadConfig(cwd);

  switch (params.action) {
    case "grok_search": {
      if (!params.query) throw new WebAccessError("invalid_params", "grok_search requires 'query' parameter.");
      ensureConfig(config);
      return grokSearch(params.query, config, signal, params.additionalSources, onChunk);
    }
    case "exa_search":
      if (!params.query && !params.url) throw new WebAccessError("invalid_params", "exa_search requires 'query' or 'url' parameter.");
      if (!config.exaApiKey) throw new WebAccessError("provider_not_configured", "exa_search: EXA_API_KEY not configured.");
      return exaSearch(params.query ?? params.url!, config, {
        numResults: params.numResults,
        includeDomains: params.includeDomains ? params.includeDomains.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
        url: params.url,
        startPublishedDate: params.startPublishedDate,
      }, signal);
    case "zhipu_search":
      if (!params.query) throw new WebAccessError("invalid_params", "zhipu_search requires 'query' parameter.");
      if (!config.zhipuApiKey) throw new WebAccessError("provider_not_configured", "zhipu_search: ZHIPU_API_KEY not configured.");
      return zhipuSearch(params.query, config, {
        count: params.numResults,
        recencyFilter: params.recencyFilter as ZhipuOptions["recencyFilter"],
        domainFilter: params.searchDomainFilter,
      }, signal);
    case "fetch": {
      if (!params.url) throw new WebAccessError("invalid_params", "fetch requires 'url' parameter.");
      return fetchPage(params.url, config, signal);
    }
    case "docs":
      if (!params.query) throw new WebAccessError("invalid_params", "docs requires 'query' parameter.");
      return context7Docs(params.query, config, { libraryId: params.libraryId }, signal);
    case "map":
      if (!params.url) throw new WebAccessError("invalid_params", "map requires 'url' parameter.");
      return tavilyMap(params.url, config, { maxDepth: params.maxDepth, instructions: params.instructions }, signal);
    default:
      throw new WebAccessError("invalid_params", `Unknown action: '${params.action}'.`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════

function formatElapsed(startedAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

function firstLine(text: string, maxLen = 80): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length <= maxLen ? line : `${line.slice(0, maxLen - 1)}…`;
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
}

function formatResultForAgent(result: WebAccessResult): string {
  if ("content" in result && "primarySources" in result) {
    const searchResult = result as SearchResult;
    const lines = [searchResult.content];
    if (searchResult.primarySources.length > 0) {
      lines.push("\n## Sources");
      for (const s of searchResult.primarySources) {
        lines.push(`- [${s.title ?? s.url}](${s.url})`);
      }
    }
    if (searchResult.additionalSources && searchResult.additionalSources.length > 0) {
      lines.push("\n## Additional Sources — discovered by Tavily/Firecrawl, not verified by Grok. Fetch before citing.");
      for (const s of searchResult.additionalSources) {
        lines.push(`- [${s.title ?? s.url}](${s.url})`);
      }
    }
    return lines.join("\n").trim();
  }
  if ("url" in (result as unknown as Record<string, unknown>) && "provider" in (result as unknown as Record<string, unknown>)) {
    return (result as unknown as Record<string, unknown>).content as string;
  }
  if (Array.isArray(result)) {
    const lines = ["## Matching libraries — re-call with library_id:\n"];
    for (const m of result) {
      lines.push(`- **${m.libraryId}**: ${m.name}${m.description ? ` — ${m.description}` : ""}`);
    }
    return lines.join("\n");
  }
  if ("baseUrl" in (result as unknown as Record<string, unknown>) && "results" in (result as unknown as Record<string, unknown>)) {
    const mapped = result as unknown as Record<string, unknown>;
    const url = mapped.baseUrl as string;
    const urls = mapped.results as string[];
    const lines = [`# Site Map: ${url}\n`];
    for (const u of urls) lines.push(`- ${u}`);
    if (urls.length === 0) lines.push("_(no pages found)_");
    return lines.join("\n").trim();
  }
  return JSON.stringify(result, null, 2);
}

function contentWithoutSources(text: string): string {
  const idx = text.indexOf("\n## Sources\n");
  if (idx === -1) return text;
  // Keep Additional Sources visible — only strip primary Sources
  const adIdx = text.indexOf("\n## Additional Sources");
  if (adIdx > idx) {
    return text.slice(0, idx) + "\n" + text.slice(adIdx + 1);
  }
  return text.slice(0, idx);
}

// ═══════════════════════════════════════════════════════════════════
// Tool
// ═══════════════════════════════════════════════════════════════════



export const webAccessTool = defineTool({
  name: "web_access",
  label: "Web Access",
  description: "Internet access, including web search via Grok/Exa/Zhipu, docs lookup via Context7, and page fetching and site mapping via Tavily/Firecrawl.",
  promptSnippet: "For web search, docs lookup, page fetching and site exploration.",
  promptGuidelines: [
    "Prefer parallel web_access calls for DISCOVERY tasks: run multiple simultaneously rather than sequentially. For known-URL tasks, a single fetch or browser-tools call is sufficient.",
    "Before search, check: do I already know the URL where the answer lives? YES -> fetch action for static pages or browser-tools skill for JS-rendered and login-gated ones; NO -> grok_search to discover URLs",
    "Use grok_search when you need to discover unknown URLs. When the target URL is already known (GitHub trending, Reddit, X profile, Wikipedia, etc.), skip search and go directly with fetch or browser-tools.",
    "When you decided to search, use grok_search as the default first hop; however, skip it for simple, well-scoped lookups (specific API docs, known domains, factual one-liners). Go directly to zhipu, exa, docs, or fetch as appropriate.",
    "Use zhipu_search for Chinese/domestic/realtime; exa_search for authoritative/low-noise sources.",
    "Use docs for SDK/API library lookup and documentation retrieval.",
    "Search is for discovery - use it when you don't know where the information might be (URLs). Fetch / browser-tools is for **truth** - go directly when you already know the answer URLs. Always verify claims against the original source.",
  ],
  parameters: WebAccessSchema,

  renderCall(args, theme, _context) {
    let text = theme.fg("toolTitle", theme.bold("web_access"));
    text += " " + theme.fg("accent", String(args.action ?? "?"));
    if (args.query) text += " " + theme.fg("dim", `"${firstLine(String(args.query), 50)}"`);
    if (args.url) text += " " + theme.fg("dim", truncate(String(args.url), 40));
    if (args.libraryId) text += " " + theme.fg("muted", `@${truncate(String(args.libraryId), 25)}`);
    if (args.maxDepth) text += " " + theme.fg("dim", `depth=${args.maxDepth}`);
    if (args.recencyFilter) text += " " + theme.fg("dim", String(args.recencyFilter));
    if (args.includeDomains) text += " " + theme.fg("dim", truncate(String(args.includeDomains), 20));
    if (args.searchDomainFilter) text += " " + theme.fg("dim", truncate(String(args.searchDomainFilter), 20));
    if (args.startPublishedDate) text += " " + theme.fg("dim", `since=${args.startPublishedDate}`);
    if (args.instructions) text += " " + theme.fg("dim", truncate(String(args.instructions), 30));
    if (typeof args.numResults === "number") text += " " + theme.fg("dim", `×${args.numResults}`);
    if (typeof args.additionalSources === "number" && args.additionalSources > 0) text += " " + theme.fg("dim", `as+${args.additionalSources}`);
    return new Text(text, 0, 0);
  },

  renderResult(result, { expanded, isPartial }, theme, context) {
    const details = result.details as Partial<WebAccessDetails> | undefined;
    const isError = (context as { isError?: boolean } | undefined)?.isError ?? false;

    if (isPartial) {
      const streamText = result.content?.[0]?.type === "text" ? result.content[0].text : "";
      if (streamText && (details as any)?.isStreaming) {
        // Show streaming text with elapsed time
        let text = theme.fg("success", "●");
        text += " " + theme.fg("accent", details?.action ?? "?");
        if (details?.startedAt) text += " " + theme.fg("dim", formatElapsed(details.startedAt));
        // Show last few lines of streaming content
        const lines = streamText.split(/\r?\n/);
        const preview = lines.slice(-6).map(l => l.slice(0, 120)).join("\n");
        if (preview) text += "\n" + theme.fg("dim", preview);
        return new Text(text, 0, 0);
      }
      let text = theme.fg("toolTitle", "searching");
      if (details?.startedAt) text += " " + theme.fg("dim", formatElapsed(details.startedAt));
      return new Text(text, 0, 0);
    }

    if (isError) {
      let text = theme.fg("error", "✗");
      text += " " + theme.fg("accent", details?.action ?? "?");
      if (details?.startedAt) text += " " + theme.fg("dim", formatElapsed(details.startedAt));
      if (result.content?.[0]?.type === "text") {
        text += "\n" + theme.fg("dim", firstLine(result.content[0].text, 120));
      }
      return new Text(text, 0, 0);
    }

    const elapsed = details?.startedAt ? formatElapsed(details.startedAt) : "";
    const contentText = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    const totalLines = contentText ? contentText.split(/\r?\n/).length : 0;

    let text = theme.fg("success", "✓");
    text += " " + theme.fg("accent", details?.action ?? "?");
    if (details?.libraryId) text += " " + theme.fg("muted", `@${truncate(details.libraryId, 25)}`);
    if (elapsed) text += " " + theme.fg("dim", elapsed);
    if (details?.sourceCount) text += " " + theme.fg("muted", `src ${details.sourceCount}`);
    // Show additional sources count as discovery chip
    const adCount = (result.details as Record<string, unknown> | undefined)?.adCount as number | undefined;
    if (adCount && adCount > 0) text += " " + theme.fg("muted", `+${adCount} disc`);
    if (totalLines > 0) text += " " + theme.fg("dim", expanded ? `(${totalLines} lines)` : `(${totalLines} lines, ctrl+o to expand)`);

    if (details?.displaySources?.length) {
      text += "\n" + theme.fg("muted", "── sources ──");
      for (const s of details.displaySources) {
        if (s.url === "___discovery_divider___") {
          text += "\n" + theme.fg("muted", "── discovery ──");
          continue;
        }
        const label = truncate(s.url, 70);
        text += "\n  " + theme.fg("dim", label);
      }
    }

    if (expanded && contentText) {
      text += "\n\n" + contentWithoutSources(contentText);
    }

    return new Text(text, 0, 0);
  },

  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    signal?.throwIfAborted?.();
    const startedAt = Date.now();

    activeCalls++;
    totalCallsThisRound++;
    updateStatus(ctx, startedAt);

    const heartbeat = setInterval(() => {
      spinnerIdx++;
      updateStatus(ctx, startedAt);
    }, 80);

    // Streaming callback for grok_search: push incremental text to TUI
    const onChunk = _onUpdate && params.action === "grok_search"
      ? (text: string) => {
          _onUpdate({
            content: [{ type: "text", text }],
            details: {
              action: params.action,
              query: params.query,
              startedAt,
              isStreaming: true,
            },
          });
        }
      : undefined;

    try {
      signal?.throwIfAborted?.();
      const result = await executeAction(params, ctx.cwd, signal, onChunk);
      signal?.throwIfAborted?.();

      const details: WebAccessDetails = {
        action: params.action,
        query: params.query,
        url: params.url,
        libraryId: params.libraryId,
        startedAt,
        sources: "primarySources" in result ? result.primarySources : undefined,
        sourceCount: "primarySources" in result ? result.primarySources.length : 0,
        displaySources: "primarySources" in result ? result.primarySources : undefined,
      };

      // Merge discovery sources with a divider
      const extra: Record<string, unknown> = {};
      if ("additionalSources" in result) {
        const ads = (result as unknown as Record<string, unknown>).additionalSources as Source[] | undefined;
        if (ads && ads.length > 0) {
          extra.adCount = ads.length;
          // Append with divider marker — renderResult will add separator
          if (details.displaySources) {
            details.displaySources = details.displaySources.concat(
              { url: "___discovery_divider___" } as Source,
              ...ads.map(s => ({ url: s.url })),
            );
          }
        }
      }

      const fullText = formatResultForAgent(result);
      const truncation = truncateHead(fullText, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
      let contentText = truncation.content;
      if (truncation.truncated) {
        const tmpPath = join(tmpdir(), `web-access-${_toolCallId}.txt`);
        await writeFile(tmpPath, fullText, "utf-8");
        contentText = `${truncation.content}\n\n[Truncated: ${truncation.outputLines} of ${truncation.totalLines} lines. Full content saved to ${tmpPath}.]`;
      }

      return { content: [{ type: "text", text: contentText }], details: { ...details, ...extra } };
    } catch (_err) {
      failedCalls++;
      throw _err;
    } finally {
      clearInterval(heartbeat);
      activeCalls--;
      if (activeCalls === 0) {
        const elapsed = formatElapsed(startedAt);
        const ok = totalCallsThisRound - failedCalls;
        const parts = [`✓ web: ${ok}/${totalCallsThisRound} ok`];
        if (failedCalls > 0) parts.push(`${failedCalls} failed`);
        if (elapsed) parts.push(elapsed);
        ctx.ui.setStatus("web-access", parts.join(" · "));
      } else {
        updateStatus(ctx, startedAt);
      }
    }
  },
});
