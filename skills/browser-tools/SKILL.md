---
name: browser-tools
description: Browser automation via Chrome DevTools Protocol. Use for live data from JS-rendered pages (X, Instagram, Fansly), login-gated content, and real-time extraction from known URLs. Prefer over web_access when you have a specific target URL.
---

# Browser Tools

Chrome DevTools Protocol via `:9222`. Starts a Chrome instance inheriting the user's login cookies, then exposes navigation, JS evaluation, screenshots, and content extraction.

## Setup (run once)

```bash
cd ~/.pi/agent/skills/browser-tools && npm install
```

Requires Google Chrome or Chromium installed natively (not Flatpak/Snap).

## Start Chrome

```bash
./browser-start.js              # Headless with user profile (default)
./browser-start.js --no-profile # Fresh profile, no cookies
./browser-start.js --visible    # Show browser window (for pick.js)
```

Headless is the **default**. Use `--visible` only when using `browser-pick.js` or debugging visually. Profile copying is also default — only Cookies, Preferences, and Local State are copied. Uses `--password-store=basic` for cookie portability.

Auto-kills any stale Chrome on `:9222` before starting. Only one instance runs at a time.

## Stop Chrome

```bash
./browser-stop.js
```

Call when done to free ~430MB memory. Not strictly required—`browser-start.js` cleans up before next launch.

## Navigate

```bash
./browser-nav.js https://example.com
./browser-nav.js https://example.com --new
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

Shows all cookies for current tab (domain, path, httpOnly, secure).

## Pick Elements (GUI only)

```bash
./browser-pick.js "Click the login button"
```

Requires visible Chrome. Interactive picker—user clicks elements, returns CSS selectors.

## Auth Interaction Pattern

If a page shows a login wall (cookies expired, site requires re-auth):

1. Print what you see: `"This page requires login to X. I need you to:"` 
2. List the exact steps: `"1. Open Chrome  2. Go to https://x.com/login  3. Log in  4. Close Chrome"`
3. **Stop and wait** for the user to confirm they've completed the steps
4. Re-run `./browser-start.js` (profile is re-copied) and retry

Do NOT attempt to automate login—the user types their own password.

## web_access vs browser-tools

| Use web_access when | Use browser-tools when |
|---------------------|------------------------|
| Searching across many sources | You have a specific URL |
| Fetching article text / docs | Page is JS-rendered (SPA) |
| SDK/API lookup | Page requires login |
| Broad discovery | Need live/real-time data (follower counts, prices) |
| | web_access returned empty or blocked |
