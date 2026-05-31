#!/usr/bin/env node

import puppeteer from "puppeteer-core";
import { browserURL } from "./cdp-url.js";

const showValues = process.argv.includes("--show-values");
if (showValues && !process.argv.includes("--i-understand-this-leaks-secrets")) {
	process.stderr.write("✗ Refusing to print cookie values without --i-understand-this-leaks-secrets\n");
	process.exit(2);
}

function redact(value) {
	if (!value) return "";
	if (value.length <= 8) return "********";
	return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

const b = await puppeteer.connect({ browserURL: browserURL(), defaultViewport: null }).catch((e) => {
	process.stderr.write(`✗ ${e.message}\n  Run: browser-start.js\n`);
	process.exit(1);
});

const p = (await b.pages()).at(-1);
if (!p) {
	process.stderr.write("✗ No active tab\n");
	process.exit(1);
}

const cookies = await p.cookies();
for (const cookie of cookies) {
	process.stdout.write(`${cookie.name}: ${showValues ? cookie.value : redact(cookie.value)}${showValues ? "" : " (redacted; use --show-values --i-understand-this-leaks-secrets to reveal)"}\n`);
	process.stdout.write(`  domain: ${cookie.domain}\n  path: ${cookie.path}\n  httpOnly: ${cookie.httpOnly}\n  secure: ${cookie.secure}\n\n`);
}

await b.disconnect();
