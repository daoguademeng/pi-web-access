---
name: web-access-manual
description: Internet research via the web_access tool. Use when you need realtime search, source-backed fact checking, URL fetching, docs lookup, site mapping, or Chinese/domestic sources.
---

# Web Access

Single `web_access` tool with `action` enumeration. **Search is discovery. Fetch is evidence.** Never conclude from search summaries alone.

## Actions

| Action | Purpose | Default? |
|--------|---------|:---:|
| `grok_search` | Broad web search with Grok AI synthesis. **Strongest engine.** | ✅ |
| `exa_search` | Low-noise authoritative search. Give `url` for find-similar. | |
| `zhipu_search` | Chinese/domestic/realtime results. | |
| `fetch` | Extract full page text as Markdown. **Bridge from discovery to evidence.** | |
| `docs` | SDK/API documentation lookup. Auto-resolves library; re-call with `libraryId` if ambiguous. | |
| `map` | Explore a site's URL structure before bulk fetching. | |

---

## `grok_search` — Main Engine

```
web_access action: "grok_search" query: "latest Rust async patterns"
web_access action: "grok_search" query: "nba最新战报" additionalSources: 3
```

**Params:**
- `query` — required
- `additionalSources` (0–5, default 0) — parallel Tavily/Firecrawl discovery. Grok does NOT see these. Screen before citing. Use 2–3 for broad, 4–5 for exhaustive.

**Returns:** `content` (synthesized) + `primarySources` (consulted by Grok) + optionally `additionalSources` (unverified supplementary).

---

## Source Discovery by Intent

### Official / authoritative → `exa_search`
```
web_access action: "exa_search" query: "quantum error correction" includeDomains: "nature.com,arxiv.org" numResults: 5
web_access action: "exa_search" query: "transformer survey" startPublishedDate: "2025-01-01"
web_access action: "exa_search" url: "https://arxiv.org/abs/2403.11696" numResults: 3
```
Give `url` to find similar pages. Give `query` + `includeDomains` for domain-scoped search. Add `startPublishedDate` to filter by date.

### Chinese / domestic / realtime → `zhipu_search`
```
web_access action: "zhipu_search" query: "今日科技新闻" recencyFilter: "oneDay" numResults: 5
web_access action: "zhipu_search" query: "中国新能源汽车政策" recencyFilter: "oneMonth"
web_access action: "zhipu_search" query: "A股行情" searchDomainFilter: "gov.cn,news.cn"
```
`recencyFilter`: `oneDay` | `oneWeek` | `oneMonth` | `oneYear`. Default: `noLimit`. `searchDomainFilter` for domain whitelist.

### SDK / API docs → `docs`
```
# Step 1: find library
web_access action: "docs" query: "React"

# Step 2: query within library (use libraryId from step 1)
web_access action: "docs" query: "useCallback" libraryId: "/reactjs/react.dev"
```
Single match → fetches docs directly. Multiple matches → returns options. Then re-call with `libraryId`.

### Site structure → `map`
```
web_access action: "map" url: "https://docs.godotengine.org/en/stable/" maxDepth: 2
web_access action: "map" url: "https://docs.godotengine.org/en/stable/" instructions: "find API reference pages" maxDepth: 1
```
Use `maxDepth: 2` for deeper crawl. Default 1 (surface scan).

---

## Fetch — The Bridge to Evidence

```
web_access action: "fetch" url: "https://raw.githubusercontent.com/rust-lang/rust/master/README.md"
web_access action: "fetch" url: "https://github.com/user/repo/blob/main/file.py"
```

- GitHub `blob` URLs auto-convert to `raw` (zero API cost)
- Text files → direct HTTP GET
- HTML pages → Tavily extract (needs `TAVILY_API_KEY`)
- PDF/images → error; use `bash curl` instead

---

## browser-tools Integration

When the answer lives at a known URL (especially JS-rendered pages like X, Instagram, Fansly), skip search and use browser-tools directly. For live data like follower counts or prices, this is faster than searching for third-party articles. Also use when `fetch` returns empty or the page requires login:
```bash
cd skills/browser-tools
./browser-start.js
./browser-content.js <URL>
```
It launches Chrome with the user's cookies and extracts rendered content. See browser-tools SKILL.md for full usage.

## Deep Research Workflow

### Phase 1 — Broad Discovery
```
web_access action: "grok_search" query: "angle 1" additionalSources: 2
web_access action: "grok_search" query: "angle 2" additionalSources: 2
```
Parallel is faster. `additionalSources` gives unverified candidates to screen.

### Phase 2 — Targeted Discovery
| Need | Action |
|------|--------|
| Chinese/domestic perspective | `zhipu_search` + `recencyFilter` |
| Authority/trusted sources | `exa_search` + `includeDomains` |
| SDK/API docs | `docs` (two-step) |
| Similar pages from a known URL | `exa_search url: "..."` |
| Many pages from one domain | `map` first, then targeted `fetch` |

### Phase 3 — Fetch Evidence
```
web_access action: "fetch" url: "https://target-url.com/article"
```
**Mandatory.** Never conclude from search summaries. Fetch original text before making claims.

### Phase 4 — Gap Check
- Claims backed only by search summaries? → Return to Phase 3
- Sub-topic undersampled? → Return to Phase 2
- Contradictory facts? → Independent searches, fetch both originals

---

## Rules

1. **Search first, fetch before concluding.** `grok_search` → screen sources → `fetch` evidence → conclude.
2. **Parallel when possible.** Multiple `grok_search` calls from different angles finish faster.
3. **`zhipu_search` for Chinese/realtime, not general.** Don't use it for English queries or historical topics.
4. **`exa_search` for authority, not breadth.** Don't use it for broad exploration.
5. **`docs` is two-step.** Always resolve library first unless you already know the `libraryId`.
6. **`additionalSources` is unverified.** Screen aggressively. Fetch before citing. URLs appear under `── discovery ──` divider and in `## Additional Sources` section (labeled "not verified by Grok").
7. **Binary files need `bash curl`.** `fetch` rejects PDF/images with guidance.
