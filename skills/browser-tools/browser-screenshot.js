#!/usr/bin/env node

import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { browserURL } from "./cdp-url.js";

const b = await puppeteer.connect({ browserURL: browserURL(), defaultViewport: null }).catch((e) => {
	process.stderr.write(`✗ ${e.message}\n  Run: browser-start.js\n`);
	process.exit(1);
});

const p = (await b.pages()).at(-1);
if (!p) {
	process.stderr.write("✗ No active tab\n");
	process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = `screenshot-${timestamp}.png`;
const filepath = join(tmpdir(), filename);

await p.screenshot({ path: filepath });
process.stdout.write(`${filepath}\n`);

await b.disconnect();
