# pi-web-access

Web access extension for [pi](https://github.com/earendil-works/pi-coding-agent) — integrates live web search, page fetching, site mapping, documentation lookup, and headless browser automation into a single `pi install`.

## Features

### `web_access` Tool

A single tool with 6 actions:

| Action | Description | Provider |
|--------|-------------|----------|
| `grok_search` | Broad web search with AI synthesis | xAI Grok / OpenAI-compatible relay |
| `exa_search` | Low-noise authoritative search | Exa |
| `zhipu_search` | Chinese / domestic / realtime search | Zhipu (智谱) |
| `fetch` | Extract full page text / Markdown | Direct HTTP / Tavily / Firecrawl |
| `docs` | SDK / API documentation lookup | Context7 |
| `map` | Explore site URL structure | Tavily |

### `browser-tools` Skill

Headless Chrome automation via Chrome DevTools Protocol — for JS-rendered pages, login-gated content, and live data extraction. The CDP port is random and bound to `127.0.0.1`; default profile mode copies cookies, so prefer `--no-profile` for untrusted pages.

| Script | Purpose |
|--------|---------|
| `browser-start.js` | Launch headless Chrome with user profile (cookies) |
| `browser-nav.js` | Navigate to a URL |
| `browser-eval.js` | Evaluate JavaScript in the page |
| `browser-content.js` | Extract readable Markdown via Mozilla Readability |
| `browser-screenshot.js` | Take a page screenshot |
| `browser-cookies.js` | List cookies for current tab |
| `browser-pick.js` | Interactive element picker (requires `--visible`) |
| `browser-stop.js` | Stop Chrome to free ~430MB memory |

### `/web-config` Command

Interactive TUI for managing API keys and settings — no manual JSON editing required.

- **Scope**: Global (`~/.pi/agent/web-access.json`) or Project (`.pi/web-access.json`)
- **API Keys**: 9 providers with masked display
- **Advanced**: URLs, models, timeouts, retry, map limits

Precedence: environment variables > project config > global config > defaults.

Security policy: project config cannot override provider endpoint URLs (`exaBaseUrl`, `tavilyApiUrl`, etc.). Endpoints are global/env-only and validated against HTTPS + official host allowlists to avoid API-key exfiltration from untrusted repositories. `fetch`, `map`, Exa find-similar, and browser navigation block localhost/private/link-local/metadata/`.local` URLs by default.

## Install

```bash
pi install git:github.com/daoguademeng/pi-web-access
```

This is a single-step install. The `postinstall` script automatically runs `npm ci --ignore-scripts` in `skills/browser-tools/` to set up Puppeteer using the lockfile without dependency lifecycle scripts. Then `/reload` in pi, and configure your keys:

```bash
/web-config
```

Browser-tools requires Google Chrome or Chromium installed natively (not Flatpak/Snap).

## Configuration

All API keys are stored in JSON config files with `0600` permissions and excluded from git:

- **Global**: `~/.pi/agent/web-access.json`
- **Project**: `.pi/web-access.json`

Alternatively, use environment variables:

| Provider | Env Var |
|----------|---------|
| xAI Grok | `XAI_API_KEY`, `XAI_API_URL`, `XAI_MODEL` |
| OpenAI-compatible | `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_API_URL`, `OPENAI_COMPATIBLE_MODEL` |
| Exa | `EXA_API_KEY` |
| Zhipu | `ZHIPU_API_KEY`, `ZHIPU_API_URL`, `ZHIPU_SEARCH_ENGINE` |
| Tavily | `TAVILY_API_KEY` |
| Firecrawl | `FIRECRAWL_API_KEY` |
| Context7 | `CONTEXT7_API_KEY` |

## Quick Test

```bash
# web_access — all 6 actions
/web-config                              # configure API keys first

# browser-tools
cd skills/browser-tools
./browser-start.js --no-profile # safer: fresh profile, no cookies
./browser-nav.js https://example.com
./browser-content.js https://example.com
./browser-stop.js
```

## Repository Structure

```
pi-web-access/
├── index.ts                  # Extension entry point + /web-config command
├── tool.ts                   # web_access tool definition (6 actions)
├── config.ts                 # Layered config storage (global + project)
├── types.ts                  # TypeScript type definitions
├── providers/                # Provider implementations
│   ├── grok.ts               #   xAI / OpenAI-compatible
│   ├── exa.ts                #   Exa search
│   ├── zhipu.ts              #   Zhipu search
│   ├── fetch.ts              #   Direct HTTP / Tavily / Firecrawl fetch
│   ├── tavily.ts             #   Tavily site map
│   ├── context7.ts           #   Context7 docs lookup
│   ├── security.ts           #   URL/endpoint safety checks and SSRF guard
│   └── shared.ts             #   Shared HTTP utilities
├── skills/
│   ├── browser-tools/        # Chrome CDP automation scripts
│   │   ├── SKILL.md          #   Agent skill instructions
│   │   ├── browser-*.js      #   Automation scripts
│   │   └── package.json      #   Puppeteer dependencies
│   └── web-access-manual/    # Comprehensive web_access usage guide
│       └── SKILL.md
├── web-access.example.json   # Example config template (no real keys)
├── .gitignore                # Excludes web-access.json + node_modules
└── package.json              # pi package manifest + postinstall
```

## Acknowledgments

- **[konbakuyomu/smartsearch](https://github.com/konbakuyomu/smartsearch)** — The `web_access` tool is adapted from smart-search's multi-provider web research architecture, including Grok, Exa, Zhipu, Context7, Tavily, and Firecrawl integrations. smart-search is an excellent CLI-first research tool — check it out for standalone terminal use.

- **[badlogic/pi-skills](https://github.com/badlogic/pi-skills/tree/main/browser-tools)** — The `browser-tools` skill originates from pi's creator Mario Zechner (badlogic). The Chrome DevTools Protocol scripts, SKILL.md, and the headless browser automation approach are from the official pi-skills repository.

Thank you to both projects for making this pi extension possible.

## License

MIT
