#!/usr/bin/env node

import puppeteer from "puppeteer-core";
import { browserURL } from "./cdp-url.js";
import { assertPublicHttpUrl } from "./browser-url-guard.js";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const TIMEOUT = 30000;
const MAX_HTML = 5_000_000;
const MAX_MARKDOWN = 1_000_000;
setTimeout(() => { process.stderr.write("✗ Timeout after 30s\n"); process.exit(1); }, TIMEOUT).unref();

const url = process.argv[2];
if (!url) {
	process.stdout.write("Usage: browser-content.js <url>\n");
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

const p = (await b.pages()).at(-1);
if (!p) { process.stderr.write("✗ No active tab\n"); process.exit(1); }

try {
	await p.goto(safeUrl, { waitUntil: "networkidle2", timeout: 15000 });
} catch (err) {
	process.stderr.write(`✗ Navigation failed: ${err.message}\n`);
	await b.disconnect();
	process.exit(1);
}

const client = await p.createCDPSession();
const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
const { outerHTML } = await client.send("DOM.getOuterHTML", { nodeId: root.nodeId });
if (outerHTML.length > MAX_HTML) {
	process.stderr.write(`✗ Page DOM too large (${outerHTML.length} chars; limit ${MAX_HTML})\n`);
	await client.detach();
	await b.disconnect();
	process.exit(1);
}
await client.detach();

const finalUrl = p.url();
try { await assertPublicHttpUrl(finalUrl); } catch (err) {
	process.stderr.write(`✗ Redirected to blocked URL: ${err.message}\n`);
	await b.disconnect();
	process.exit(1);
}

const doc = new JSDOM(outerHTML, { url: finalUrl });
const reader = new Readability(doc.window.document);
const article = reader.parse();

function htmlToMarkdown(html) {
	const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
	turndown.use(gfm);
	turndown.addRule("removeEmptyLinks", {
		filter: (node) => node.nodeName === "A" && !node.textContent?.trim(),
		replacement: () => "",
	});
	return turndown.turndown(html)
		.replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
		.replace(/ +/g, " ")
		.replace(/\s+,/g, ",")
		.replace(/\s+\./g, ".")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

let content;
if (article?.content) {
	content = htmlToMarkdown(article.content);
} else {
	const fallbackDoc = new JSDOM(outerHTML, { url: finalUrl });
	const body = fallbackDoc.window.document;
	body.querySelectorAll("script, style, noscript, nav, header, footer, aside").forEach(el => el.remove());
	const main = body.querySelector("main, article, [role='main'], .content, #content") || body.body;
	const html = main?.innerHTML || "";
	content = html.trim().length > 100 ? htmlToMarkdown(html) : "(Could not extract content)";
}

if (content.length > MAX_MARKDOWN) content = content.slice(0, MAX_MARKDOWN) + "\n\n[truncated: content too large]";

process.stdout.write(`URL: ${finalUrl}\n`);
if (article?.title) process.stdout.write(`Title: ${article.title}\n`);
process.stdout.write(`\n${content}\n`);

await b.disconnect();
