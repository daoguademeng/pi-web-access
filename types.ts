// ── Source ────────────────────────────────────────────────────────
/** A single source/citation from a search result. */
export interface Source {
  url: string;
  title?: string;
}

// ── Search Result (Grok / Exa / Zhipu / Docs) ────────────────────
export interface SearchResult {
  content: string;
  primarySources: Source[];
  additionalSources?: Source[];
  warnings?: string[];
}

// ── Fetch Result ──────────────────────────────────────────────────
export interface FetchResult {
  url: string;
  provider: string;
  content: string; // markdown
}

// ── Map Result ────────────────────────────────────────────────────
export interface MapResult {
  baseUrl: string;
  results: string[]; // list of URLs
}

// ── Docs Library Match ────────────────────────────────────────────
export interface LibraryMatch {
  libraryId: string;
  name: string;
  description?: string;
}

// ── Tool Parameters ───────────────────────────────────────────────
export type WebAccessAction =
  | "grok_search"
  | "exa_search"
  | "zhipu_search"
  | "fetch"
  | "docs"
  | "map";

export interface WebAccessParams {
  action: WebAccessAction;

  // ── Common ──
  query?: string;
  url?: string;

  // ── grok_search ──
  additionalSources?: number; // 0-5, default 0

  // ── exa_search ──
  numResults?: number;
  includeDomains?: string;

  // ── zhipu_search ──
  recencyFilter?: "oneDay" | "oneWeek" | "oneMonth" | "oneYear" | "noLimit";

  // ── docs ──
  libraryId?: string;

  // ── map ──
  instructions?: string;
  maxDepth?: number;
}

// ── Tool Return Type ──────────────────────────────────────────────
export type WebAccessResult = SearchResult | FetchResult | MapResult | LibraryMatch[];

// ── Errors ────────────────────────────────────────────────────────
export type WebAccessErrorCode =
  | "provider_not_configured"
  | "network_error"
  | "rate_limited"
  | "timeout"
  | "no_results"
  | "invalid_params"
  | "docs_ambiguous"
  | "auth_error";

export class WebAccessError extends Error {
  constructor(
    public readonly code: WebAccessErrorCode,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "WebAccessError";
  }
}
