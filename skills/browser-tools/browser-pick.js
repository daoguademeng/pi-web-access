#!/usr/bin/env node

import puppeteer from "puppeteer-core";
import { browserURL } from "./cdp-url.js";

const message = process.argv.slice(2).join(" ");
if (!message) {
	process.stdout.write("Usage: browser-pick.js 'message'\n");
	process.exit(1);
}

const b = await puppeteer.connect({ browserURL: browserURL(), defaultViewport: null }).catch((e) => {
	process.stderr.write(`✗ ${e.message}\n  Run: browser-start.js\n`);
	process.exit(1);
});

const p = (await b.pages()).at(-1);
if (!p) { process.stderr.write("✗ No active tab\n"); process.exit(1); }

await p.evaluate(() => {
	if (window.__pickInjected) return;
	window.__pickInjected = true;

	window.pick = async (msg) => {
		return new Promise((resolve) => {
			const selections = [];
			const selectedElements = new Set();

			const overlay = document.createElement("div");
			overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none";

			const highlight = document.createElement("div");
			highlight.style.cssText = "position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);transition:all 0.1s";
			overlay.appendChild(highlight);

			const banner = document.createElement("div");
			banner.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2937;color:white;padding:12px 24px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:auto;z-index:2147483647";

			const updateBanner = () => {
				banner.textContent = `${msg} (${selections.length} selected, Ctrl+click to add, Enter to finish, ESC to cancel)`;
			};
			updateBanner();

			document.body.append(banner, overlay);

			const buildInfo = (el) => {
				const parents = [];
				let cur = el.parentElement;
				while (cur && cur !== document.body) {
					const id = cur.id ? `#${cur.id}` : "";
					const cls = cur.className ? `.${String(cur.className).trim().split(/\s+/).join(".")}` : "";
					parents.push(cur.tagName.toLowerCase() + id + cls);
					cur = cur.parentElement;
				}
				return {
					tag: el.tagName.toLowerCase(),
					id: el.id || null,
					class: el.className || null,
					text: el.textContent?.trim().slice(0, 200) || null,
					parents: parents.join(" > "),
				};
			};

			const cleanup = () => {
				document.removeEventListener("mousemove", onMove, true);
				document.removeEventListener("click", onClick, true);
				document.removeEventListener("keydown", onKey, true);
				overlay.remove();
				banner.remove();
				selectedElements.forEach(el => { el.style.outline = ""; });
			};

			const onMove = (e) => {
				const el = document.elementFromPoint(e.clientX, e.clientY);
				if (!el || overlay.contains(el) || banner.contains(el)) return;
				const r = el.getBoundingClientRect();
				highlight.style.cssText = `position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px`;
			};

			const onClick = (e) => {
				if (banner.contains(e.target)) return;
				e.preventDefault();
				e.stopPropagation();
				const el = document.elementFromPoint(e.clientX, e.clientY);
				if (!el || overlay.contains(el) || banner.contains(el)) return;

				if (e.metaKey || e.ctrlKey) {
					if (!selectedElements.has(el)) {
						selectedElements.add(el);
						el.style.outline = "3px solid #10b981";
						selections.push(buildInfo(el));
						updateBanner();
					}
				} else {
					cleanup();
					resolve(selections.length > 0 ? selections : buildInfo(el));
				}
			};

			const onKey = (e) => {
				if (e.key === "Escape") { e.preventDefault(); cleanup(); resolve(null); }
				else if (e.key === "Enter" && selections.length > 0) { e.preventDefault(); cleanup(); resolve(selections); }
			};

			document.addEventListener("mousemove", onMove, true);
			document.addEventListener("click", onClick, true);
			document.addEventListener("keydown", onKey, true);
		});
	};
});

const result = await p.evaluate((msg) => window.pick(msg), message);

if (Array.isArray(result)) {
	for (let i = 0; i < result.length; i++) {
		if (i > 0) process.stdout.write("\n");
		for (const [key, value] of Object.entries(result[i])) {
			process.stdout.write(`${key}: ${value}\n`);
		}
	}
} else if (result && typeof result === "object") {
	for (const [key, value] of Object.entries(result)) {
		process.stdout.write(`${key}: ${value}\n`);
	}
} else {
	process.stdout.write(`${result}\n`);
}

await b.disconnect();
