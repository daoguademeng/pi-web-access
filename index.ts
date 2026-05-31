/**
 * pi-web-access — Web access extension for pi
 *
 * Provides `web_access` tool + `/web-config` TUI command.
 * Also bundles the `browser-tools` skill for JS-rendered page access.
 * Install: pi install git:github.com/daoguademeng/pi-web-access
 */
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SelectList, Text, truncateToWidth, type Component, type SelectItem, type SelectListTheme, type TUI } from "@earendil-works/pi-tui";
import { webAccessTool, resetRound } from "./tool.js";
import {
  deleteStoredConfig,
  getConfigPath,
  maskSecret,
  readStoredConfig,
  writeStoredConfig,
  type ConfigScope,
  type WebAccessStoredConfig,
} from "./config.js";

// ── TUI helpers ───────────────────────────────────────────────────

type ConfigTheme = {
  fg: (color: "accent" | "muted" | "dim" | "warning" | "success" | "error", text: string) => string;
  bold: (text: string) => string;
};

type ConfigUiContext = {
  cwd: string;
  hasUI: boolean;
  ui: {
    select: (title: string, items: string[]) => Promise<string | undefined>;
    input: (title: string, placeholder?: string) => Promise<string | undefined>;
    confirm: (title: string, message: string) => Promise<boolean>;
    notify: (message: string, level?: "info" | "warning" | "error") => void;
    setStatus: (key: string, value: string | undefined) => void;
    custom?: <T>(
      factory: (tui: TUI, theme: ConfigTheme, _keybindings: unknown, done: (result: T) => void) => Component | Promise<Component>,
      options?: { overlay?: boolean },
    ) => Promise<T>;
  };
};

type ConfigField = {
  key: keyof WebAccessStoredConfig;
  env: string;
  label: string;
  kind: "string" | "secret" | "number";
  description: string;
  defaultValue?: string | number;
  required?: boolean;
};

const API_KEY_FIELDS: ConfigField[] = [
  { key: "grokApiKey", env: "XAI_API_KEY", label: "xAI API Key", kind: "secret", description: "xAI (Grok) API key for grok_search." },
  { key: "openaiApiKey", env: "OPENAI_COMPATIBLE_API_KEY", label: "OpenAI Compatible Key", kind: "secret", description: "API key for OpenAI-compatible relay (grok fallback)." },
  { key: "openaiApiUrl", env: "OPENAI_COMPATIBLE_API_URL", label: "OpenAI Compatible URL", kind: "string", description: "Base URL for OpenAI-compatible relay, e.g. http://localhost:8000/v1." },
  { key: "openaiModel", env: "OPENAI_COMPATIBLE_MODEL", label: "OpenAI Compatible Model", kind: "string", defaultValue: "grok-4-fast", description: "Model name for OpenAI-compatible relay." },
  { key: "exaApiKey", env: "EXA_API_KEY", label: "Exa API Key", kind: "secret", description: "Exa search API key for authoritative/low-noise search." },
  { key: "zhipuApiKey", env: "ZHIPU_API_KEY", label: "Zhipu API Key", kind: "secret", description: "Zhipu (智谱) API key for Chinese/domestic search." },
  { key: "tavilyApiKey", env: "TAVILY_API_KEY", label: "Tavily API Key", kind: "secret", description: "Tavily API key for page fetching and site mapping." },
  { key: "firecrawlApiKey", env: "FIRECRAWL_API_KEY", label: "Firecrawl API Key", kind: "secret", description: "Firecrawl API key (fetch fallback). Optional if Tavily is configured." },
  { key: "context7ApiKey", env: "CONTEXT7_API_KEY", label: "Context7 API Key", kind: "secret", description: "Context7 API key for SDK/docs lookup." },
];

const ADVANCED_FIELDS: ConfigField[] = [
  { key: "grokApiUrl", env: "XAI_API_URL", label: "Grok API URL", kind: "string", defaultValue: "https://api.x.ai/v1", description: "xAI API base URL." },
  { key: "grokModel", env: "XAI_MODEL", label: "Grok Model", kind: "string", defaultValue: "grok-4-fast", description: "Model ID for grok_search." },
  { key: "grokTimeoutMs", env: "GROK_TIMEOUT_MS", label: "Grok Timeout (ms)", kind: "number", defaultValue: 120000, description: "HTTP timeout for grok_search." },
  { key: "exaBaseUrl", env: "EXA_BASE_URL", label: "Exa Base URL", kind: "string", defaultValue: "https://api.exa.ai", description: "Exa API base URL." },
  { key: "exaTimeoutMs", env: "EXA_TIMEOUT_MS", label: "Exa Timeout (ms)", kind: "number", defaultValue: 30000, description: "HTTP timeout for exa_search." },
  { key: "zhipuApiUrl", env: "ZHIPU_API_URL", label: "Zhipu API URL", kind: "string", defaultValue: "https://open.bigmodel.cn/api", description: "Zhipu API base URL." },
  { key: "zhipuSearchEngine", env: "ZHIPU_SEARCH_ENGINE", label: "Zhipu Search Engine", kind: "string", defaultValue: "search_std", description: "Search engine: search_std or search_pro_sogou." },
  { key: "zhipuTimeoutMs", env: "ZHIPU_TIMEOUT_MS", label: "Zhipu Timeout (ms)", kind: "number", defaultValue: 30000, description: "HTTP timeout for zhipu_search." },
  { key: "tavilyApiUrl", env: "TAVILY_API_URL", label: "Tavily API URL", kind: "string", defaultValue: "https://api.tavily.com", description: "Tavily API base URL." },
  { key: "tavilyTimeoutMs", env: "TAVILY_TIMEOUT_MS", label: "Tavily Timeout (ms)", kind: "number", defaultValue: 90000, description: "HTTP timeout for fetch/map via Tavily." },
  { key: "firecrawlApiUrl", env: "FIRECRAWL_API_URL", label: "Firecrawl API URL", kind: "string", defaultValue: "https://api.firecrawl.dev/v2", description: "Firecrawl API base URL." },
  { key: "firecrawlTimeoutMs", env: "FIRECRAWL_TIMEOUT_MS", label: "Firecrawl Timeout (ms)", kind: "number", defaultValue: 90000, description: "HTTP timeout for fetch via Firecrawl." },
  { key: "context7BaseUrl", env: "CONTEXT7_BASE_URL", label: "Context7 Base URL", kind: "string", defaultValue: "https://context7.com", description: "Context7 API base URL." },
  { key: "context7TimeoutMs", env: "CONTEXT7_TIMEOUT_MS", label: "Context7 Timeout (ms)", kind: "number", defaultValue: 30000, description: "HTTP timeout for docs lookup." },
  { key: "mapMaxBreadth", env: "MAP_MAX_BREADTH", label: "Map Max Breadth", kind: "number", defaultValue: 20, description: "Max breadth for site map exploration." },
  { key: "mapLimit", env: "MAP_LIMIT", label: "Map Limit", kind: "number", defaultValue: 50, description: "Max URLs returned by map." },
  { key: "mapTimeoutMs", env: "MAP_TIMEOUT_MS", label: "Map Timeout (ms)", kind: "number", defaultValue: 150000, description: "HTTP timeout for site mapping." },
  { key: "retryMaxAttempts", env: "RETRY_MAX_ATTEMPTS", label: "Retry Max Attempts", kind: "number", defaultValue: 3, description: "Max retry attempts for failed requests." },
];

// ── TUI helpers ───────────────────────────────────────────────────

function scopeName(s: ConfigScope): string { return s === "global" ? "Global" : "Project"; }

function selectTheme(theme: ConfigTheme): SelectListTheme {
  return {
    selectedPrefix: (t) => theme.fg("accent", t),
    selectedText: (t) => theme.fg("accent", t),
    description: (t) => theme.fg("muted", t),
    scrollInfo: (t) => theme.fg("dim", t),
    noMatch: (t) => theme.fg("warning", t),
  };
}

function fieldValue(field: ConfigField, config: WebAccessStoredConfig): string {
  const v = config[field.key];
  if (v === undefined || v === "") {
    return field.defaultValue !== undefined ? `default: ${field.defaultValue}` : "not set";
  }
  if (field.kind === "secret") return maskSecret(String(v));
  return String(v);
}

function fieldChoice(field: ConfigField, config: WebAccessStoredConfig): string {
  const mark = field.required ? "* " : "  ";
  return `${mark}${field.label} = ${fieldValue(field, config)}`;
}

const DETAIL_LINES = 4;
function detailLines(value: string, width: number): string[] {
  const maxWidth = Math.max(20, width - 4);
  const lines = value.split(/\r?\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const result = lines.slice(0, DETAIL_LINES).map(l => truncateToWidth(l, maxWidth, "…"));
  while (result.length < DETAIL_LINES) result.push("");
  return result;
}

type SelectItemFull = { value: string; label: string; description?: string; details?: string };

async function pickFromList(ctx: ConfigUiContext, title: string, items: SelectItemFull[], maxVisible = 8): Promise<string | undefined> {
  if (!ctx.ui.custom) {
    const choice = await ctx.ui.select(title, items.map(i => i.label));
    return items.find(i => i.label === choice)?.value;
  }
  return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
    const selItems: SelectItem[] = items.map(i => ({ value: i.value, label: i.label, description: i.description }));
    const sl = new SelectList(selItems, Math.min(maxVisible, Math.max(1, selItems.length)), selectTheme(theme), {
      minPrimaryColumnWidth: 28,
      maxPrimaryColumnWidth: 72,
    });
    const detailMap = new Map(items.map(i => [i.value, i.details ?? i.description ?? ""]));
    sl.onSelect = (item) => done(item.value);
    sl.onCancel = () => done(undefined);
    return {
      render(width: number): string[] {
        const sel = sl.getSelectedItem();
        const d = sel ? detailMap.get(sel.value) ?? "" : "";
        return [
          theme.fg("accent", theme.bold(title)),
          "",
          ...detailLines(d, width).map(l => `  ${l ? theme.fg("muted", l) : ""}`),
          "",
          ...sl.render(width),
          "",
          theme.fg("dim", "↑↓ navigate · Enter select · Esc back"),
        ];
      },
      invalidate() { sl.invalidate(); },
      handleInput(data: string) { sl.handleInput(data); tui.requestRender(); },
    };
  });
}

// ── Config editing ────────────────────────────────────────────────

async function editStringField(ctx: ConfigUiContext, scope: ConfigScope, field: ConfigField, config: WebAccessStoredConfig): Promise<boolean> {
  const cur = fieldValue(field, config);
  const title = `Set ${field.env} (${field.label})`;
  const placeholder = field.kind === "secret"
    ? `Current: ${cur}. Input will be shown in plain text. Leave empty = keep, '-' = clear.`
    : `Current: ${cur}. Leave empty = keep, '-' = clear.`;
  const value = await ctx.ui.input(title, placeholder);
  if (value === undefined) return false;
  const t = value.trim();
  if (!t) return false;
  if (t === "-") { delete config[field.key]; }
  else { (config as any)[field.key] = t; }
  writeStoredConfig(scope, ctx.cwd, config);
  return true;
}

async function editNumberField(ctx: ConfigUiContext, scope: ConfigScope, field: ConfigField, config: WebAccessStoredConfig): Promise<boolean> {
  const cur = fieldValue(field, config);
  const value = await ctx.ui.input(
    `Set ${field.env} (${field.label})`,
    `Current: ${cur}. Enter positive integer; leave empty = keep, '-' = clear.`,
  );
  if (value === undefined) return false;
  const t = value.trim();
  if (!t) return false;
  if (t === "-") { delete config[field.key]; }
  else {
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n) || n <= 0) { ctx.ui.notify(`${field.env} must be a positive integer.`, "warning"); return false; }
    (config as any)[field.key] = n;
  }
  writeStoredConfig(scope, ctx.cwd, config);
  return true;
}

async function editField(ctx: ConfigUiContext, scope: ConfigScope, field: ConfigField, config: WebAccessStoredConfig): Promise<void> {
  const changed = field.kind === "number"
    ? await editNumberField(ctx, scope, field, config)
    : await editStringField(ctx, scope, field, config);
  if (changed) ctx.ui.notify(`Saved ${field.env} to ${scopeName(scope).toLowerCase()} config.`, "info");
}

// ── Menu flows ────────────────────────────────────────────────────

async function apiKeysMenu(ctx: ConfigUiContext, scope: ConfigScope): Promise<void> {
  while (true) {
    const stored = readStoredConfig(scope, ctx.cwd);
    const items: SelectItemFull[] = API_KEY_FIELDS.map(f => ({
      value: String(f.key),
      label: fieldChoice(f, stored),
      description: f.description,
      details: `${f.description}\n\nEnv: ${f.env}\nField: ${String(f.key)}\nCurrent: ${fieldValue(f, stored)}`,
    }));
    items.push({ value: "back", label: "← Back", description: "Return to main menu." });
    const choice = await pickFromList(ctx, `${scopeName(scope)} API Keys`, items);
    if (!choice || choice === "back") return;
    const field = API_KEY_FIELDS.find(f => f.key === choice);
    if (field) await editField(ctx, scope, field, { ...stored });
  }
}

const PROJECT_BLOCKED_ADVANCED_KEYS = new Set<keyof WebAccessStoredConfig>([
  "grokApiUrl", "openaiApiUrl", "exaBaseUrl", "zhipuApiUrl", "tavilyApiUrl", "firecrawlApiUrl", "context7BaseUrl",
]);

async function advancedMenu(ctx: ConfigUiContext, scope: ConfigScope): Promise<void> {
  while (true) {
    const stored = readStoredConfig(scope, ctx.cwd);
    const editableFields = scope === "project" ? ADVANCED_FIELDS.filter(f => !PROJECT_BLOCKED_ADVANCED_KEYS.has(f.key)) : ADVANCED_FIELDS;
    const items: SelectItemFull[] = editableFields.map(f => ({
      value: String(f.key),
      label: fieldChoice(f, stored),
      description: f.description,
      details: `${f.description}\n\nEnv: ${f.env}\nField: ${String(f.key)}\nCurrent: ${fieldValue(f, stored)}\nDefault: ${f.defaultValue ?? "none"}`,
    }));
    if (scope === "project") {
      items.unshift({
        value: "endpoint-note",
        label: "Endpoint URLs are global-only",
        description: "Project configs cannot override provider endpoints, to prevent API key exfiltration.",
        details: "Security policy: project .pi/web-access.json may configure keys, models, limits and timeouts, but provider endpoint URLs are ignored at load time and hidden here.",
      });
    }
    items.push({ value: "back", label: "← Back", description: "Return to main menu." });
    const choice = await pickFromList(ctx, `${scopeName(scope)} Advanced`, items);
    if (!choice || choice === "back") return;
    if (choice === "endpoint-note") continue;
    const field = editableFields.find(f => f.key === choice);
    if (field) await editField(ctx, scope, field, { ...stored });
  }
}

async function scopeMenu(ctx: ConfigUiContext, scope: ConfigScope): Promise<void> {
  while (true) {
    const stored = readStoredConfig(scope, ctx.cwd);
    const path = getConfigPath(scope, ctx.cwd);
    const choice = await pickFromList(ctx, `${scopeName(scope)} Config (${path})`, [
      { value: "keys", label: "API Keys", description: "Configure provider API keys.", details: API_KEY_FIELDS.map(f => `${f.label}: ${fieldValue(f, stored)}`).join("\n") },
      { value: "advanced", label: "Advanced Settings", description: "URLs, models, timeouts, retry.", details: ADVANCED_FIELDS.map(f => `${f.label}: ${fieldValue(f, stored)}`).join("\n") },
      { value: "back", label: "← Back", description: "Return to scope selection." },
    ]);
    if (!choice || choice === "back") return;
    if (choice === "keys") await apiKeysMenu(ctx, scope);
    if (choice === "advanced") await advancedMenu(ctx, scope);
  }
}

async function clearConfig(ctx: ConfigUiContext, scope: ConfigScope): Promise<void> {
  const fp = getConfigPath(scope, ctx.cwd);
  const ok = await ctx.ui.confirm("Clear config?", `Delete ${fp}?`);
  if (!ok) return;
  deleteStoredConfig(scope, ctx.cwd);
  ctx.ui.notify(`Deleted ${fp}`, "info");
}

async function runConfigWizard(ctx: ConfigUiContext): Promise<void> {
  if (!ctx.hasUI) {
    throw new Error("/web-config requires interactive UI. Use env vars or edit config files directly.");
  }
  while (true) {
    const choice = await pickFromList(ctx, "web-access Config", [
      { value: "global", label: "Global Config (~/.pi/agent/web-access.json)", description: "Applies to all projects; overridable by project config.", details: "Edit global web-access config at ~/.pi/agent/web-access.json. Best for storing shared API keys across projects." },
      { value: "project", label: "Project Config (.pi/web-access.json)", description: "Only affects current project; overrides global.", details: "Edit project-specific config at .pi/web-access.json. Useful for per-project API keys or custom endpoints." },
      { value: "clear-global", label: "Clear Global Config", description: "Delete ~/.pi/agent/web-access.json." },
      { value: "clear-project", label: "Clear Project Config", description: "Delete .pi/web-access.json." },
      { value: "exit", label: "Exit", description: "Close config wizard." },
    ]);
    if (!choice || choice === "exit") return;
    if (choice === "clear-global") { await clearConfig(ctx, "global"); continue; }
    if (choice === "clear-project") { await clearConfig(ctx, "project"); continue; }
    await scopeMenu(ctx, choice as ConfigScope);
  }
}

// ── Extension entry ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool(webAccessTool);

  pi.on("turn_start", (_event, ctx) => {
    resetRound();
    ctx.ui.setStatus("web-access", undefined);
  });

  pi.registerCommand("web-config", {
    description: "Configure web_access API keys and settings via TUI",
    handler: async (_args, ctx) => {
      await runConfigWizard(ctx as unknown as ConfigUiContext);
    },
  });

  // Bundle the browser-tools and web-access-manual skills.
  // Browser-tools dependencies are installed by package postinstall via `npm ci --ignore-scripts`.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  pi.on("resources_discover", async (_event, _ctx) => {
    return {
      skillPaths: [
        join(__dirname, "skills", "browser-tools"),
        join(__dirname, "skills", "web-access-manual"),
      ],
    };
  });
}
