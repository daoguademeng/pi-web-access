#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const code = process.argv.slice(2).join(" ");
if (!code) {
	console.log("Usage: browser-eval.js 'code'");
	process.exit(1);
}

const b = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null }).catch((e) => {
	process.stderr.write(`✗ ${e.message}\n  Run: browser-start.js\n`);
	process.exit(1);
});

const p = (await b.pages()).at(-1);
if (!p) {
	process.stderr.write("✗ No active tab\n");
	process.exit(1);
}

const result = await p.evaluate((c) => {
	const AsyncFunction = (async () => {}).constructor;
	return new AsyncFunction(`return (${c})`)();
}, code);

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
