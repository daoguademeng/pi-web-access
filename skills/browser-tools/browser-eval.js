#!/usr/bin/env node

import puppeteer from "puppeteer-core";
import { browserURL } from "./cdp-url.js";
import { installPublicRequestGuard } from "./browser-url-guard.js";

const code = process.argv.slice(2).join(" ");
if (!code) {
	console.log("Usage: browser-eval.js 'code'");
	process.exit(1);
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

const guard = await installPublicRequestGuard(p);
const result = await p.evaluate((c) => {
	const AsyncFunction = (async () => {}).constructor;
	return new AsyncFunction(`return (${c})`)();
}, code).catch(async (err) => {
	const detail = guard.blocked ? `blocked unsafe request to ${guard.blocked.url}: ${guard.blocked.reason}` : err.message;
	process.stderr.write(`✗ Evaluation failed: ${detail}\n`);
	await b.disconnect();
	process.exit(1);
});

if (guard.blocked) {
	process.stderr.write(`✗ Evaluation blocked unsafe request to ${guard.blocked.url}: ${guard.blocked.reason}\n`);
	await b.disconnect();
	process.exit(1);
}

if (Array.isArray(result)) {
	for (let i = 0; i < result.length; i++) {
		if (i > 0) process.stdout.write("\n");
		for (const [key, value] of Object.entries(result[i])) {
			process.stdout.write(`${key}: ${value}\n`);
		}
	}
} else if (typeof result === "object" && result !== null) {
	for (const [key, value] of Object.entries(result)) {
		process.stdout.write(`${key}: ${value}\n`);
	}
} else {
	process.stdout.write(`${result}\n`);
}

await b.disconnect();
