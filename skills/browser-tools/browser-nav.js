#!/usr/bin/env node

import puppeteer from "puppeteer-core";
import { browserURL } from "./cdp-url.js";
import { assertPublicHttpUrl } from "./browser-url-guard.js";

const args = process.argv.slice(2);
const newTab = args.includes("--new");
const url = args.find(a => !a.startsWith("--"));

if (!url) {
	console.log("Usage: browser-nav.js <url> [--new]");
	process.exit(1);
}

let safeUrl;
try { safeUrl = await assertPublicHttpUrl(url); } catch (e) {
	process.stderr.write(`✗ ${e.message}\n`);
	process.exit(1);
}

const b = await puppeteer.connect({ browserURL: browserURL(), defaultViewport: null }).catch((e) => {
	process.stderr.write(`✗ ${e.message}\n  Run: browser-start.js\n`);
	process.exit(1);
});

if (newTab) {
	const p = await b.newPage();
	await p.goto(safeUrl, { waitUntil: "domcontentloaded" });
	await assertPublicHttpUrl(p.url());
	process.stdout.write(`✓ Opened: ${p.url()}\n`);
} else {
	const p = (await b.pages()).at(-1);
	await p.goto(safeUrl, { waitUntil: "domcontentloaded" });
	await assertPublicHttpUrl(p.url());
	process.stdout.write(`✓ Navigated to: ${p.url()}\n`);
}

await b.disconnect();
