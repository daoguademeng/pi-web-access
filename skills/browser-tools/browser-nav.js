#!/usr/bin/env node

import puppeteer from "puppeteer-core";
import { browserURL } from "./cdp-url.js";
import { assertPublicHttpUrl, installPublicRequestGuard } from "./browser-url-guard.js";

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

async function guardedGoto(page, targetUrl, waitUntil) {
	const guard = await installPublicRequestGuard(page);
	try {
		await page.goto(targetUrl, { waitUntil });
	} catch (err) {
		if (guard.blocked) throw new Error(`blocked unsafe request to ${guard.blocked.url}: ${guard.blocked.reason}`);
		throw err;
	}
	if (guard.blocked) throw new Error(`blocked unsafe request to ${guard.blocked.url}: ${guard.blocked.reason}`);
	return await assertPublicHttpUrl(page.url());
}

if (newTab) {
	const p = await b.newPage();
	try {
		const finalUrl = await guardedGoto(p, safeUrl, "domcontentloaded");
		process.stdout.write(`✓ Opened: ${finalUrl}\n`);
	} catch (err) {
		process.stderr.write(`✗ Navigation failed: ${err.message}\n`);
		await b.disconnect();
		process.exit(1);
	}
} else {
	const p = (await b.pages()).at(-1);
	try {
		const finalUrl = await guardedGoto(p, safeUrl, "domcontentloaded");
		process.stdout.write(`✓ Navigated to: ${finalUrl}\n`);
	} catch (err) {
		process.stderr.write(`✗ Navigation failed: ${err.message}\n`);
		await b.disconnect();
		process.exit(1);
	}
}

await b.disconnect();
