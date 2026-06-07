---
name: browser-tools
description: Browser automation via CDP. FIRST CHOICE for live data from JS-rendered pages, login-gated content, and real-time extraction from known URLs. Prefer over web_access when you have a specific target URL. Read this skill BEFORE any "now/current/latest/realtime" query. 
---

# Browser Tools

Chrome DevTools Protocol on a random loopback-only port. By default it copies the user's Chrome profile cookies; this is powerful and risky because any same-user local process that can discover the port can control that browser and use its login state. Prefer `--no-profile` unless login state is explicitly required.

## Setup (run once)

```bash
cd skills/browser-tools && npm ci --ignore-scripts
```

Requires Google Chrome or Chromium installed natively.

## Start Chrome

```bash
./browser-start.js                   # Headless with user profile (default)
./browser-start.js --no-profile      # Fresh profile, no cookies
./browser-start.js --visible         # Show browser window (for pick.js)
./browser-start.js --allow-localhost # Dev-only: allow loopback/local dev URLs
```

Headless is the default. Use `--visible` only when using `browser-pick.js` or debugging visually. Profile copying is also default — only Cookies, Preferences, and Local State are copied. Uses `--password-store=basic` for cookie portability.

⚠️ Security: profile mode contains login cookies. Use `./browser-start.js --no-profile` for untrusted pages, untrusted repositories, CI, shared machines, or whenever login state is unnecessary. Never expose the generated CDP port or cookie values in chat/logs.

⚠️ Local dev: browser navigation blocks localhost/private/local-network URLs by default. Start with `./browser-start.js --allow-localhost` only when inspecting a local development server; prefer `./browser-start.js --no-profile --allow-localhost` unless copied cookies are required. This allows loopback URLs (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`) and hostnames that resolve exclusively to loopback for helper navigation and page requests; private LAN ranges, cloud metadata hosts, `.local`, and `.internal` remain blocked. The flag is stored in the browser-tools cache and is cleared by `browser-stop.js` or by starting again without `--allow-localhost`.

The CDP port is random and bound to `127.0.0.1`; helper scripts read it from a `0600` cache file. Only one instance runs at a time.

## Stop Chrome

```bash
./browser-stop.js
```

Call when done to free ~430MB memory. Not strictly required—`browser-start.js` cleans up before next launch.

## Navigate

```bash
./browser-nav.js https://example.com
./browser-nav.js https://example.com --new
# after ./browser-start.js --allow-localhost:
./browser-nav.js http://localhost:5173
```

## Evaluate JavaScript

```bash
./browser-eval.js 'document.title'
./browser-eval.js '(function(){ return JSON.stringify({title:document.title, links:document.querySelectorAll("a").length}); })()'
```

## Screenshot

```bash
./browser-screenshot.js
```

## Extract Content (Readability)

```bash
./browser-content.js https://example.com
```

Navigates, waits for JS render, extracts readable Markdown via Mozilla Readability + Turndown. For article/docs pages. Not for SPAs with dynamic data—use `browser-eval.js` for those.

## Cookies

```bash
./browser-cookies.js
```

Shows cookie names and metadata for current tab; values are redacted by default. Revealing values requires `--show-values --i-understand-this-leaks-secrets` and should not be pasted into chat, logs, issues, or transcripts.

## Pick Elements (GUI only)

```bash
./browser-pick.js "Click the login button"
```

Requires visible Chrome. Interactive picker—user clicks elements, returns CSS selectors.

## Auth Interaction Pattern

If a page shows a login wall (cookies expired, site requires re-auth):

1. Print what you see to the user: `"This page requires login to X. I need you to:"` 
2. List the exact steps: `"1. Open Chrome  2. Go to https://x.com/login  3. Log in  4. Close Chrome"`
3. **Stop and wait** for the user to confirm they've completed the steps
4. Re-run `./browser-start.js` (profile is re-copied) and retry

## web_access vs browser-tools

| Use web_access when | Use browser-tools when |
|---------------------|------------------------|
| Searching across many sources | You have a specific URL |
| Fetching article text / docs | Page is JS-rendered (SPA) |
| SDK/API lookup | Page requires login |
| Broad discovery | Need live/real-time data (follower counts, prices) |
| | web_access returned empty or blocked |
