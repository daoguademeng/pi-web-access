#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const b = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null }).catch((e) => {
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
	process.stdout.write(`${cookie.name}: ${cookie.value}\n`);
	process.stdout.write(`  domain: ${cookie.domain}\n  path: ${cookie.path}\n  httpOnly: ${cookie.httpOnly}\n  secure: ${cookie.secure}\n\n`);
}

await b.disconnect();
