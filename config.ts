/**
 * pi-web-access config — layered JSON storage + env overrides.
 *
 * Config files (600 permissions, never committed):
 *   global: ~/.pi/agent/web-access.json
 *   project: .pi/web-access.json
 *
 * Precedence: env var > project > global > default
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────

export interface WebAccessStoredConfig {
  grokApiKey?: string;
  grokApiUrl?: string;
  grokModel?: string;
  grokTimeoutMs?: number;
  openaiApiKey?: string;
  openaiApiUrl?: string;
  openaiModel?: string;
  exaApiKey?: string;
  exaBaseUrl?: string;
  exaTimeoutMs?: number;
  zhipuApiKey?: string;
  zhipuApiUrl?: string;
  zhipuSearchEngine?: string;
  zhipuTimeoutMs?: number;
  tavilyApiKey?: string;
  tavilyApiUrl?: string;
  tavilyTimeoutMs?: number;
  firecrawlApiKey?: string;
  firecrawlApiUrl?: string;
  firecrawlTimeoutMs?: number;
  context7ApiKey?: string;
  context7BaseUrl?: string;
  context7TimeoutMs?: number;
  mapMaxBreadth?: number;
  mapLimit?: number;
  mapTimeoutMs?: number;
  retryMaxAttempts?: number;
  flaresolverrUrl?: string;
}

export interface WebAccessConfig {
  grokApiKey: string;
  grokApiUrl: string;
  grokModel: string;
  grokTimeoutMs: number;
  openaiApiKey: string;
  openaiApiUrl: string;
  openaiModel: string;
  exaApiKey: string;
  exaBaseUrl: string;
  exaTimeoutMs: number;
  zhipuApiKey: string;
  zhipuApiUrl: string;
  zhipuSearchEngine: string;
  zhipuTimeoutMs: number;
  tavilyApiKey: string;
  tavilyApiUrl: string;
  tavilyTimeoutMs: number;
  firecrawlApiKey: string;
  firecrawlApiUrl: string;
  firecrawlTimeoutMs: number;
  context7ApiKey: string;
  context7BaseUrl: string;
  context7TimeoutMs: number;
  mapMaxBreadth: number;
  mapLimit: number;
  mapTimeoutMs: number;
  retryMaxAttempts: number;
  flaresolverrUrl: string;
}

export type ConfigScope = "project" | "global";

// ── Defaults ──────────────────────────────────────────────────────

const DEFAULTS: WebAccessConfig = {
  grokApiKey: "",
  grokApiUrl: "https://api.x.ai/v1",
  grokModel: "grok-4-fast",
  grokTimeoutMs: 120_000,
  openaiApiKey: "",
  openaiApiUrl: "",
  openaiModel: "grok-4-fast",
  exaApiKey: "",
  exaBaseUrl: "https://api.exa.ai",
  exaTimeoutMs: 30_000,
  zhipuApiKey: "",
  zhipuApiUrl: "https://open.bigmodel.cn/api",
  zhipuSearchEngine: "search_std",
  zhipuTimeoutMs: 30_000,
  tavilyApiKey: "",
  tavilyApiUrl: "https://api.tavily.com",
  tavilyTimeoutMs: 90_000,
  firecrawlApiKey: "",
  firecrawlApiUrl: "https://api.firecrawl.dev/v2",
  firecrawlTimeoutMs: 90_000,
  context7ApiKey: "",
  context7BaseUrl: "https://context7.com",
  context7TimeoutMs: 30_000,
  mapMaxBreadth: 20,
  mapLimit: 50,
  mapTimeoutMs: 150_000,
  retryMaxAttempts: 3,
  flaresolverrUrl: "http://localhost:8191",
};

// ── Helpers ───────────────────────────────────────────────────────

function maybeStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function maybePosInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function readEnvStr(name: string, stored: string | undefined, fallback: string): string {
  return maybeStr(process.env[name]) ?? stored ?? fallback;
}

function readEnvPosInt(name: string, stored: number | undefined, fallback: number): number {
  return maybePosInt(process.env[name]) ?? stored ?? fallback;
}

function cleanConfig(c: WebAccessStoredConfig): WebAccessStoredConfig {
  const out: WebAccessStoredConfig = {};
  for (const [k, v] of Object.entries(c)) {
    if (v !== undefined && v !== "" && v !== null) (out as any)[k] = v;
  }
  return out;
}

// ── Paths ─────────────────────────────────────────────────────────

export function getConfigPath(scope: ConfigScope, cwd: string): string {
  return scope === "global"
    ? join(homedir(), ".pi", "agent", "web-access.json")
    : join(resolve(cwd), ".pi", "web-access.json");
}

// ── Read / Write / Delete ─────────────────────────────────────────

export function readStoredConfig(scope: ConfigScope, cwd: string): WebAccessStoredConfig {
  try {
    const raw = JSON.parse(readFileSync(getConfigPath(scope, cwd), "utf-8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return cleanConfig(raw as WebAccessStoredConfig);
  } catch {
    return {};
  }
}

export function writeStoredConfig(scope: ConfigScope, cwd: string, config: WebAccessStoredConfig): string {
  const fp = getConfigPath(scope, cwd);
  mkdirSync(join(fp, ".."), { recursive: true });
  writeFileSync(fp, JSON.stringify(cleanConfig(config), null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  return fp;
}

export function deleteStoredConfig(scope: ConfigScope, cwd: string): string {
  const fp = getConfigPath(scope, cwd);
  rmSync(fp, { force: true });
  return fp;
}

// ── Load (merged) ─────────────────────────────────────────────────

export function loadConfig(cwd?: string): WebAccessConfig {
  const dir = cwd ?? process.cwd();
  const global = readStoredConfig("global", dir);
  const project = readStoredConfig("project", dir);
  const defaults = DEFAULTS;

  return {
    grokApiKey: readEnvStr("XAI_API_KEY", project.grokApiKey ?? global.grokApiKey, defaults.grokApiKey),
    grokApiUrl: readEnvStr("XAI_API_URL", project.grokApiUrl ?? global.grokApiUrl, defaults.grokApiUrl),
    grokModel: readEnvStr("XAI_MODEL", project.grokModel ?? global.grokModel, defaults.grokModel),
    grokTimeoutMs: readEnvPosInt("GROK_TIMEOUT_MS", project.grokTimeoutMs ?? global.grokTimeoutMs, defaults.grokTimeoutMs),
    openaiApiKey: readEnvStr("OPENAI_COMPATIBLE_API_KEY", project.openaiApiKey ?? global.openaiApiKey, defaults.openaiApiKey),
    openaiApiUrl: readEnvStr("OPENAI_COMPATIBLE_API_URL", project.openaiApiUrl ?? global.openaiApiUrl, defaults.openaiApiUrl),
    openaiModel: readEnvStr("OPENAI_COMPATIBLE_MODEL", project.openaiModel ?? global.openaiModel, defaults.openaiModel),
    exaApiKey: readEnvStr("EXA_API_KEY", project.exaApiKey ?? global.exaApiKey, defaults.exaApiKey),
    exaBaseUrl: readEnvStr("EXA_BASE_URL", project.exaBaseUrl ?? global.exaBaseUrl, defaults.exaBaseUrl),
    exaTimeoutMs: readEnvPosInt("EXA_TIMEOUT_MS", project.exaTimeoutMs ?? global.exaTimeoutMs, defaults.exaTimeoutMs),
    zhipuApiKey: readEnvStr("ZHIPU_API_KEY", project.zhipuApiKey ?? global.zhipuApiKey, defaults.zhipuApiKey),
    zhipuApiUrl: readEnvStr("ZHIPU_API_URL", project.zhipuApiUrl ?? global.zhipuApiUrl, defaults.zhipuApiUrl),
    zhipuSearchEngine: readEnvStr("ZHIPU_SEARCH_ENGINE", project.zhipuSearchEngine ?? global.zhipuSearchEngine, defaults.zhipuSearchEngine),
    zhipuTimeoutMs: readEnvPosInt("ZHIPU_TIMEOUT_MS", project.zhipuTimeoutMs ?? global.zhipuTimeoutMs, defaults.zhipuTimeoutMs),
    tavilyApiKey: readEnvStr("TAVILY_API_KEY", project.tavilyApiKey ?? global.tavilyApiKey, defaults.tavilyApiKey),
    tavilyApiUrl: readEnvStr("TAVILY_API_URL", project.tavilyApiUrl ?? global.tavilyApiUrl, defaults.tavilyApiUrl),
    tavilyTimeoutMs: readEnvPosInt("TAVILY_TIMEOUT_MS", project.tavilyTimeoutMs ?? global.tavilyTimeoutMs, defaults.tavilyTimeoutMs),
    firecrawlApiKey: readEnvStr("FIRECRAWL_API_KEY", project.firecrawlApiKey ?? global.firecrawlApiKey, defaults.firecrawlApiKey),
    firecrawlApiUrl: readEnvStr("FIRECRAWL_API_URL", project.firecrawlApiUrl ?? global.firecrawlApiUrl, defaults.firecrawlApiUrl),
    firecrawlTimeoutMs: readEnvPosInt("FIRECRAWL_TIMEOUT_MS", project.firecrawlTimeoutMs ?? global.firecrawlTimeoutMs, defaults.firecrawlTimeoutMs),
    context7ApiKey: readEnvStr("CONTEXT7_API_KEY", project.context7ApiKey ?? global.context7ApiKey, defaults.context7ApiKey),
    context7BaseUrl: readEnvStr("CONTEXT7_BASE_URL", project.context7BaseUrl ?? global.context7BaseUrl, defaults.context7BaseUrl),
    context7TimeoutMs: readEnvPosInt("CONTEXT7_TIMEOUT_MS", project.context7TimeoutMs ?? global.context7TimeoutMs, defaults.context7TimeoutMs),
    mapMaxBreadth: readEnvPosInt("MAP_MAX_BREADTH", project.mapMaxBreadth ?? global.mapMaxBreadth, defaults.mapMaxBreadth),
    mapLimit: readEnvPosInt("MAP_LIMIT", project.mapLimit ?? global.mapLimit, defaults.mapLimit),
    mapTimeoutMs: readEnvPosInt("MAP_TIMEOUT_MS", project.mapTimeoutMs ?? global.mapTimeoutMs, defaults.mapTimeoutMs),
    retryMaxAttempts: readEnvPosInt("RETRY_MAX_ATTEMPTS", project.retryMaxAttempts ?? global.retryMaxAttempts, defaults.retryMaxAttempts),
    flaresolverrUrl: readEnvStr("FLARESOLVERR_URL", project.flaresolverrUrl ?? global.flaresolverrUrl, defaults.flaresolverrUrl),
  };
}

// ── Validation ────────────────────────────────────────────────────

export function validateConfig(c: WebAccessConfig): string[] {
  const issues: string[] = [];
  const hasGrok = !!c.grokApiKey;
  const hasOpenAI = !!(c.openaiApiUrl && c.openaiApiKey);
  if (!hasGrok && !hasOpenAI) {
    issues.push("grok_search requires grokApiKey (XAI_API_KEY) or openaiApiKey+openaiApiUrl");
  }
  if (!c.tavilyApiKey && !c.firecrawlApiKey) {
    issues.push("fetch requires tavilyApiKey (TAVILY_API_KEY) or firecrawlApiKey (FIRECRAWL_API_KEY)");
  }
  return issues;
}

// ── Runtime guards (used by tool.ts) ──────────────────────────────

import { WebAccessError } from "./types.js";

export function ensureConfig(config: WebAccessConfig): asserts config is WebAccessConfig {
  if (!config.grokApiKey && !(config.openaiApiUrl && config.openaiApiKey)) {
    throw new WebAccessError(
      "provider_not_configured",
      "web_access: grok_search requires grokApiKey or openaiApiKey+openaiApiUrl to be configured. Run /web-config."
    );
  }
}

// ── UI helpers ────────────────────────────────────────────────────

export function maskSecret(v: string | undefined): string {
  if (!v) return "not set";
  if (v.length <= 8) return "********";
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}
