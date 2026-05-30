#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { platform, homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const HOME = homedir();
const noProfile = process.argv.includes("--no-profile");
const visible = process.argv.includes("--visible");

if (process.argv[2] && !["--no-profile", "--visible"].includes(process.argv[2])) {
	process.stdout.write("Usage: browser-start.js [--no-profile] [--visible]\n");
	process.stdout.write("  --no-profile  Fresh profile, no cookies\n");
	process.stdout.write("  --visible     Show browser window (default: headless)\n");
	process.exit(1);
}

const out = (s) => process.stdout.write(s + "\n");
const CACHE = `${HOME}/.cache/browser-tools`;
const PID_FILE = `${CACHE}/.pid`;

// Check if another agent's Chrome is already running
if (existsSync(PID_FILE)) {
	const oldPid = parseInt(readFileSync(PID_FILE, "utf8").trim());
	let alive = false;
	try { process.kill(oldPid, 0); alive = true; } catch {}
	if (alive) {
		try {
			const b = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });
			const v = await b.version();
			await b.disconnect();
			out(`✓ Chrome ${v} already on :9222 (pid ${oldPid})`);
			process.exit(0);
		} catch {
			out(`⚠ PID ${oldPid} alive but CDP unresponsive — cleaning up`);
			try { process.kill(oldPid, "SIGKILL"); } catch {}
		}
	}
	try { unlinkSync(PID_FILE); } catch {}
	await new Promise(r => setTimeout(r, 500));
}

execSync(`mkdir -p "${CACHE}/Default"`, { stdio: "ignore" });
try { execSync(`rm -f "${CACHE}/SingletonLock" "${CACHE}/SingletonSocket"`, { stdio: "ignore" }); } catch {}

const os = platform();
const chromePaths = {
	linux: ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"],
	darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
	win32: [join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")],
};
const candidates = chromePaths[os] || [];
const chromePath = candidates.find(p => existsSync(p));

if (!chromePath) {
	out("✗ Chrome not found. Install: sudo pacman -S google-chrome");
	process.exit(1);
}

if (!noProfile) {
	const profileRoots = {
		linux: [`${HOME}/.config/google-chrome`],
		darwin: [`${HOME}/Library/Application Support/Google/Chrome`],
		win32: [join(process.env.LOCALAPPDATA || "", "Google/Chrome/User Data")],
	};
	const roots = profileRoots[os] || [];
	const profileRoot = roots.find(r => existsSync(r));

	if (profileRoot) {
		const files = ["Default/Cookies", "Default/Preferences", "Local State"];
		let copied = 0;
		for (const f of files) {
			const src = join(profileRoot, f);
			const dst = join(CACHE, f);
			if (existsSync(src)) {
				try { execSync(`cp "${src}" "${dst}"`, { stdio: "ignore" }); copied++; } catch {}
			}
		}
		out(`  profile: ${copied}/${files.length} files`);
	} else {
		out("  profile: not found, using fresh");
	}
} else {
	out("  profile: skipped (--no-profile)");
}

const mode = visible ? "" : " (headless)";
out("  starting Chrome" + mode + "...");
const chromeArgs = [
	"--remote-debugging-port=9222",
	`--user-data-dir=${CACHE}`,
	"--no-first-run", "--no-default-browser-check",
	"--password-store=basic",
	"--disable-features=DialMediaRouteProvider",
];
if (!visible) { chromeArgs.push("--headless=new", "--disable-gpu"); }

const proc = spawn(chromePath, [...chromeArgs, "about:blank"], { detached: true, stdio: "ignore" });
proc.unref();

let connected = false, version = "unknown";
for (let i = 0; i < 20; i++) {
	try {
		const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });
		version = await browser.version();
		await browser.disconnect();
		connected = true;
		break;
	} catch { await new Promise(r => setTimeout(r, 500)); }
}

if (!connected) {
	out("✗ Chrome did not start");
	out("  If a stale instance exists: rm ~/.cache/browser-tools/.pid");
	process.exit(1);
}

// Record PID for safe multi-agent cleanup
if (proc.pid) {
	writeFileSync(PID_FILE, String(proc.pid));
}
out(`✓ Chrome ${version} on :9222${mode}${noProfile ? "" : " + profile"} (pid ${proc.pid})`);
