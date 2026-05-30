#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const newTab = args.includes("--new");
const url = args.find(a => !a.startsWith("--"));

if (!url) {
	console.log("Usage: browser-nav.js <url> [--new]");
	process.exit(1);
}

const b = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null }).catch((e) => {
	process.stderr.write(`✗ ${e.message}\n  Run: browser-start.js\n`);
	process.exit(1);
});

if (newTab) {
	const p = await b.newPage();
	await p.goto(url, { waitUntil: "domcontentloaded" });
	process.stdout.write(`✓ Opened: ${url}\n`);
} else {
	const p = (await b.pages()).at(-1);
	await p.goto(url, { waitUntil: "domcontentloaded" });
	process.stdout.write(`✓ Navigated to: ${url}\n`);
}

await b.disconnect();
