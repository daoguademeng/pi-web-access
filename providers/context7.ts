/**
 * Context7 docs provider — SDK/API documentation lookup.
 */
import type { WebAccessConfig } from "../config.js";
import type { SearchResult, Source, LibraryMatch, WebAccessResult } from "../types.js";
import { WebAccessError } from "../types.js";
import { retryWithBackoff, providerError, fetchWithTimeout } from "./shared.js";
import { exaSearch } from "./exa.js";

// ═══════════════════════════════════════════════════════════════════
// Library Resolution
// ═══════════════════════════════════════════════════════════════════

export function parseContext7Library(data: unknown): LibraryMatch[] {
  let items: unknown[];
  if (Array.isArray(data)) items = data;
  else if (data && typeof data === "object" && "results" in data) items = (data as Record<string, unknown>).results as unknown[];
  else return [];
  return items
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map(item => ({
      libraryId: String(item.id ?? item.library_id ?? item.libraryId ?? ""),
      name: String(item.title ?? item.name ?? ""),
      description: typeof item.description === "string" ? item.description : undefined,
    }))
    .filter(m => m.libraryId);
}

async function resolveLibrary(name: string, config: WebAccessConfig, signal?: AbortSignal): Promise<LibraryMatch[]> {
  const baseUrl = (config.context7BaseUrl ?? "https://context7.com").replace(/\/$/, "");
  const endpoint = `${baseUrl}/api/v2/search?query=${encodeURIComponent(name)}`;
  const raw = await retryWithBackoff(
    async () => {
      const headers: Record<string, string> = { Accept: "application/json, text/plain" };
      if (config.context7ApiKey) headers.Authorization = `Bearer ${config.context7ApiKey}`;
      const res = await fetchWithTimeout(endpoint, { headers, signal }, config.context7TimeoutMs!);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) return res.json();
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { results: [] }; }
    },
    { maxRetries: config.retryMaxAttempts!, signal },
  );
  return parseContext7Library(raw);
}

// ═══════════════════════════════════════════════════════════════════
// Docs Search
// ═══════════════════════════════════════════════════════════════════

export function parseContext7Docs(data: unknown, libraryId: string, query: string): SearchResult {
  if (!data || typeof data !== "object") return { content: "", primarySources: [] };
  const obj = data as Record<string, unknown>;
  const all = [...(Array.isArray(obj.codeSnippets) ? obj.codeSnippets : []), ...(Array.isArray(obj.infoSnippets) ? obj.infoSnippets : [])];
  const contentParts: string[] = [`## Context7 Docs: ${libraryId} — ${query}\n`];
  const sources: Source[] = [];
  const seenUrls = new Set<string>();
  for (const snippet of all) {
    if (!snippet || typeof snippet !== "object") continue;
    const s = snippet as Record<string, unknown>;
    const text = typeof s.text === "string" ? s.text.trim() : "";
    const lang = typeof s.language === "string" ? s.language : undefined;
    const url = typeof s.url === "string" ? s.url : (typeof s.link === "string" ? s.link : undefined);
    if (url && !seenUrls.has(url)) { seenUrls.add(url); sources.push({ url }); }
    if (text) {
      if (lang) contentParts.push(`\n\`\`\`${lang}`);
      contentParts.push(text);
      if (lang) contentParts.push("```");
    }
  }
  if (contentParts.length === 1) return { content: "", primarySources: [] };
  return { content: contentParts.join("\n").trim(), primarySources: sources };
}

async function fetchDocs(libraryId: string, query: string, config: WebAccessConfig, signal?: AbortSignal): Promise<SearchResult> {
  const baseUrl = (config.context7BaseUrl ?? "https://context7.com").replace(/\/$/, "");
  const endpoint = `${baseUrl}/api/v2/context?libraryId=${encodeURIComponent(libraryId)}&query=${encodeURIComponent(query)}`;
  const raw = await retryWithBackoff(
    async () => {
      const headers: Record<string, string> = { Accept: "application/json, text/plain" };
      if (config.context7ApiKey) headers.Authorization = `Bearer ${config.context7ApiKey}`;
      const res = await fetchWithTimeout(endpoint, { headers, signal }, config.context7TimeoutMs!);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) return res.json();
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { codeSnippets: [], infoSnippets: [{ text, type: "markdown" }] }; }
    },
    { maxRetries: config.retryMaxAttempts!, signal },
  );
  return parseContext7Docs(raw, libraryId, query);
}

// ═══════════════════════════════════════════════════════════════════
// Main Entry
// ═══════════════════════════════════════════════════════════════════

export interface Context7Options { libraryId?: string; }

export async function context7Docs(query: string, config: WebAccessConfig, options: Context7Options = {}, signal?: AbortSignal): Promise<WebAccessResult> {
  try {
    if (options.libraryId) return await fetchDocs(options.libraryId, query, config, signal);
    const matches = await resolveLibrary(query, config, signal);
    if (matches.length === 0) return { content: "", primarySources: [] } as SearchResult;
    if (matches.length > 1) return matches.slice(0, 10);
    return await fetchDocs(matches[0]!.libraryId, query, config, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    // Context7 failed — fallback to Exa if configured
    if (config.exaApiKey) {
      try {
        const result = await exaSearch(query, config, {}, signal);
        return result;
      } catch {
        // Exa also failed — throw original Context7 error
      }
    }
    throw providerError(err, "Context7", signal);
  }
}
