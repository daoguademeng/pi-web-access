import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebAccessError } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────
export interface WebAccessConfig {
  // grok_search
  grokApiKey?: string;
  grokApiUrl?: string;        // default: https://api.x.ai/v1
  grokModel?: string;         // default: grok-4-fast
  grokTimeoutMs?: number;     // default: 120_000

  // grok_search fallback (OpenAI-compatible relay)
  openaiApiKey?: string;
  openaiApiUrl?: string;
  openaiModel?: string;

  // exa_search
  exaApiKey?: string;
  exaBaseUrl?: string;        // default: https://api.exa.ai
  exaTimeoutMs?: number;      // default: 30_000

  // zhipu_search
  zhipuApiKey?: string;
  zhipuApiUrl?: string;       // default: https://open.bigmodel.cn/api
  zhipuSearchEngine?: string; // default: search_std
  zhipuTimeoutMs?: number;    // default: 30_000

  // fetch / map (Tavily)
  tavilyApiKey?: string;
  tavilyApiUrl?: string;      // default: https://api.tavily.com
  tavilyTimeoutMs?: number;   // default: 90_000

  // fetch fallback (Firecrawl)
  firecrawlApiKey?: string;
  firecrawlApiUrl?: string;   // default: https://api.firecrawl.dev/v2
  firecrawlTimeoutMs?: number;

  // docs (Context7)
  context7ApiKey?: string;
  context7BaseUrl?: string;   // default: https://context7.com
  context7TimeoutMs?: number; // default: 30_000

  // map tuning (not exposed to agent)
  mapMaxBreadth?: number;     // default: 20
  mapLimit?: number;          // default: 50
  mapTimeoutMs?: number;      // default: 150_000

  // retry
  retryMaxAttempts?: number;  // default: 3
}

const DEFAULTS: Required<Omit<WebAccessConfig, "grokApiKey" | "openaiApiKey" | "exaApiKey" | "zhipuApiKey" | "tavilyApiKey" | "firecrawlApiKey" | "context7ApiKey">> = {
  grokApiUrl: "https://api.x.ai/v1",
  grokModel: "grok-4-fast",
  grokTimeoutMs: 120_000,

  openaiApiUrl: "",
  openaiModel: "grok-4-fast",

  exaBaseUrl: "https://api.exa.ai",
  exaTimeoutMs: 30_000,

  zhipuApiUrl: "https://open.bigmodel.cn/api",
  zhipuSearchEngine: "search_std",
  zhipuTimeoutMs: 30_000,

  tavilyApiUrl: "https://api.tavily.com",
  tavilyTimeoutMs: 90_000,

  firecrawlApiUrl: "https://api.firecrawl.dev/v2",
  firecrawlTimeoutMs: 90_000,

  context7BaseUrl: "https://context7.com",
  context7TimeoutMs: 30_000,

  mapMaxBreadth: 20,
  mapLimit: 50,
  mapTimeoutMs: 150_000,

  retryMaxAttempts: 3,
};

// ── Config file paths ─────────────────────────────────────────────
function configFilePath(projectRoot: string): { global: string; project: string } {
  const agentDir = join(homedir(), ".pi", "agent");
  return {
    global: join(agentDir, "web-access.json"),
    project: join(projectRoot, ".pi", "web-access.json"),
  };
}

// ── Read ──────────────────────────────────────────────────────────
function readJsonFile(path: string): Record<string, unknown> | null | "malformed" {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null; // file missing
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : "malformed";
  } catch {
    return "malformed";
  }
}

function envOverride<T>(envKey: string, transform: (v: string) => T): T | undefined {
  const value = process.env[envKey];
  if (value === undefined || value.trim() === "") return undefined;
  return transform(value);
}

// ── Resolve ───────────────────────────────────────────────────────
export function loadConfig(projectRoot: string): WebAccessConfig {
  const paths = configFilePath(projectRoot);

  // Layer: defaults → global → project → env
  const merged: Record<string, unknown> = {};

  // global file
  const globalData = readJsonFile(paths.global);
  if (globalData === "malformed") {
    console.warn(`web-access: ${paths.global} is malformed JSON, ignoring`);
  } else if (globalData) {
    Object.assign(merged, globalData);
  }

  // project file
  const projectData = readJsonFile(paths.project);
  if (projectData === "malformed") {
    console.warn(`web-access: ${paths.project} is malformed JSON, ignoring`);
  } else if (projectData) {
    Object.assign(merged, projectData);
  }

  // Apply defaults for missing keys
  const result: WebAccessConfig = {};
  for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
    (result as Record<string, unknown>)[key] = key in merged ? merged[key] : defaultVal;
  }
  // Manually copy optional keys (API keys)
  for (const key of ["grokApiKey", "openaiApiKey", "exaApiKey", "zhipuApiKey", "tavilyApiKey", "firecrawlApiKey", "context7ApiKey"]) {
    if (key in merged) (result as Record<string, unknown>)[key] = merged[key];
  }

  // ── Env overrides ───────────────────────────────────────────
  const envApiKey = envOverride("XAI_API_KEY", String);
  if (envApiKey) result.grokApiKey = envApiKey;

  const envApiUrl = envOverride("XAI_API_URL", String);
  if (envApiUrl) result.grokApiUrl = envApiUrl;

  const envModel = envOverride("XAI_MODEL", String);
  if (envModel) result.grokModel = envModel;

  const envOpenAiKey = envOverride("OPENAI_COMPATIBLE_API_KEY", String);
  if (envOpenAiKey) result.openaiApiKey = envOpenAiKey;

  const envOpenAiUrl = envOverride("OPENAI_COMPATIBLE_API_URL", String);
  if (envOpenAiUrl) result.openaiApiUrl = envOpenAiUrl;

  const envOpenAiModel = envOverride("OPENAI_COMPATIBLE_MODEL", String);
  if (envOpenAiModel) result.openaiModel = envOpenAiModel;

  const envExaKey = envOverride("EXA_API_KEY", String);
  if (envExaKey) result.exaApiKey = envExaKey;

  const envExaUrl = envOverride("EXA_BASE_URL", String);
  if (envExaUrl) result.exaBaseUrl = envExaUrl;

  const envZhipuKey = envOverride("ZHIPU_API_KEY", String);
  if (envZhipuKey) result.zhipuApiKey = envZhipuKey;

  const envZhipuUrl = envOverride("ZHIPU_API_URL", String);
  if (envZhipuUrl) result.zhipuApiUrl = envZhipuUrl;

  const envZhipuEngine = envOverride("ZHIPU_SEARCH_ENGINE", String);
  if (envZhipuEngine) result.zhipuSearchEngine = envZhipuEngine;

  const envTavilyKey = envOverride("TAVILY_API_KEY", String);
  if (envTavilyKey) result.tavilyApiKey = envTavilyKey;

  const envTavilyUrl = envOverride("TAVILY_API_URL", String);
  if (envTavilyUrl) result.tavilyApiUrl = envTavilyUrl;

  const envFirecrawlKey = envOverride("FIRECRAWL_API_KEY", String);
  if (envFirecrawlKey) result.firecrawlApiKey = envFirecrawlKey;

  const envFirecrawlUrl = envOverride("FIRECRAWL_API_URL", String);
  if (envFirecrawlUrl) result.firecrawlApiUrl = envFirecrawlUrl;

  const envContext7Key = envOverride("CONTEXT7_API_KEY", String);
  if (envContext7Key) result.context7ApiKey = envContext7Key;

  const envContext7Url = envOverride("CONTEXT7_BASE_URL", String);
  if (envContext7Url) result.context7BaseUrl = envContext7Url;

  // Timeout overrides
  const envGrokTimeout = envOverride("GROK_TIMEOUT_MS", Number);
  if (envGrokTimeout) result.grokTimeoutMs = envGrokTimeout;
  const envExaTimeout = envOverride("EXA_TIMEOUT_MS", Number);
  if (envExaTimeout) result.exaTimeoutMs = envExaTimeout;
  const envZhipuTimeout = envOverride("ZHIPU_TIMEOUT_MS", Number);
  if (envZhipuTimeout) result.zhipuTimeoutMs = envZhipuTimeout;
  const envTavilyTimeout = envOverride("TAVILY_TIMEOUT_MS", Number);
  if (envTavilyTimeout) result.tavilyTimeoutMs = envTavilyTimeout;
  const envContext7Timeout = envOverride("CONTEXT7_TIMEOUT_MS", Number);
  if (envContext7Timeout) result.context7TimeoutMs = envContext7Timeout;
  const envRetry = envOverride("RETRY_MAX_ATTEMPTS", Number);
  if (envRetry) result.retryMaxAttempts = envRetry;

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────
export function resolveConfig(config: WebAccessConfig): {
  key: string;
  value: string;
  required: boolean;
} {
  // Return the primary grok provider config, preferring xAI over OpenAI
  if (config.grokApiKey) {
    return {
      key: config.grokApiKey,
      value: config.grokApiUrl ?? DEFAULTS.grokApiUrl,
      required: true,
    };
  }
  return {
    key: config.grokApiKey ?? "",
    value: config.grokApiUrl ?? DEFAULTS.grokApiUrl,
    required: true,
  };
}

export function ensureConfig(config: WebAccessConfig): asserts config is WebAccessConfig {
  if (!config.grokApiKey && !(config.openaiApiUrl && config.openaiApiKey)) {
    throw new WebAccessError(
      "provider_not_configured",
      "web_access: grok_search requires at least one of XAI_API_KEY or OPENAI_COMPATIBLE_API_URL+OPENAI_COMPATIBLE_API_KEY to be configured.",
    );
  }
}

export function ensureFetchConfig(config: WebAccessConfig): asserts config is WebAccessConfig {
  if (!config.tavilyApiKey && !config.firecrawlApiKey) {
    throw new WebAccessError(
      "provider_not_configured",
      "web_access: fetch requires at least one of TAVILY_API_KEY or FIRECRAWL_API_KEY to be configured.",
    );
  }
}

/** Resolve effective value with precedence: explicit param → config → default. */
export function resolveValue<T>(
  explicit: T | undefined,
  configValue: T | undefined,
  defaultValue: T,
): T {
  if (explicit !== undefined) return explicit;
  if (configValue !== undefined) return configValue;
  return defaultValue;
}
