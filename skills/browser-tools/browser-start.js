#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, copyFileSync, rmSync, chmodSync } from "node:fs";
import { platform, homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { browserURL, localAccessFlagPath } from "./cdp-url.js";

const HOME = homedir();
const OS = platform();
const allowedArgs = new Set(["--no-profile", "--visible", "--allow-localhost"]);
const invalidArgs = process.argv.slice(2).filter(arg => !allowedArgs.has(arg));
const noProfile = process.argv.includes("--no-profile");
const visible = process.argv.includes("--visible");
const allowLocalhost = process.argv.includes("--allow-localhost");

if (invalidArgs.length > 0) {
	process.stdout.write("Usage: browser-start.js [--no-profile] [--visible] [--allow-localhost]\n");
	process.stdout.write("  --no-profile       Fresh profile, no cookies\n");
	process.stdout.write("  --visible          Show browser window (default: headless)\n");
	process.stdout.write("  --allow-localhost  Allow browser helpers to navigate to loopback/local dev URLs\n");
	process.exit(1);
}

const out = (s) => process.stdout.write(s + "\n");

// Platform-appropriate cache directory
const cacheBase = OS === "darwin"
	? join(HOME, "Library", "Caches", "browser-tools")
	: OS === "win32"
		? join(process.env.LOCALAPPDATA || join(HOME, "AppData", "Local"), "browser-tools")
		: join(HOME, ".cache", "browser-tools");
const PID_FILE = join(cacheBase, ".pid");
const PORT_FILE = join(cacheBase, ".port");
const LOCALHOST_FLAG_FILE = localAccessFlagPath();
const port = 20_000 + Math.floor(Math.random() * 30_000);

function setLocalhostAccessFlag(enabled) {
	try { mkdirSync(cacheBase, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
	if (enabled) {
		writeFileSync(LOCALHOST_FLAG_FILE, "enabled\n", { mode: 0o600 });
		try { chmodSync(LOCALHOST_FLAG_FILE, 0o600); } catch { /* ignore */ }
		out("  localhost access: enabled (--allow-localhost)");
	} else {
		try { unlinkSync(LOCALHOST_FLAG_FILE); } catch { /* ignore */ }
		out("  localhost access: blocked (default)");
	}
}

function commandLooksLikeBrowserTools(pid) {
	if (OS !== "linux") return true;
	try {
		const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
		return cmd.includes("--user-data-dir=" + cacheBase) && cmd.includes("--remote-debugging-port=");
	} catch {
		return false;
	}
}

// Check if another agent's Chrome is already running
if (existsSync(PID_FILE)) {
	const oldPid = parseInt(readFileSync(PID_FILE, "utf8").trim());
	let alive = false;
	try { process.kill(oldPid, 0); alive = true; } catch { /* dead */ }
	if (alive) {
		try {
			const b = await puppeteer.connect({ browserURL: browserURL(), defaultViewport: null });
			const v = await b.version();
			await b.disconnect();
			setLocalhostAccessFlag(allowLocalhost);
			out(`✓ Chrome ${v} already at ${browserURL()} (pid ${oldPid})`);
			process.exit(0);
		} catch {
			out(`⚠ PID ${oldPid} alive but CDP unresponsive — cleaning up if it matches browser-tools`);
			if (commandLooksLikeBrowserTools(oldPid)) {
				try { process.kill(oldPid, "SIGKILL"); } catch { /* ignore */ }
			} else {
				out("⚠ Refusing to kill PID that does not look like browser-tools Chrome");
			}
		}
	}
	try { unlinkSync(PID_FILE); } catch { /* ignore */ }
	try { unlinkSync(PORT_FILE); } catch { /* ignore */ }
	await new Promise(r => setTimeout(r, 500));
}

// Create cache directory (cross-platform, no shell)
mkdirSync(join(cacheBase, "Default"), { recursive: true, mode: 0o700 });
try { chmodSync(cacheBase, 0o700); } catch { /* ignore */ }
try { chmodSync(join(cacheBase, "Default"), 0o700); } catch { /* ignore */ }
try { rmSync(join(cacheBase, "SingletonLock"), { force: true }); } catch { /* ignore */ }
try { rmSync(join(cacheBase, "SingletonSocket"), { force: true }); } catch { /* ignore */ }
if (!allowLocalhost) { try { unlinkSync(LOCALHOST_FLAG_FILE); } catch { /* ignore */ } }

const installHints = {
	linux: "Install: sudo apt install google-chrome-stable  or  sudo pacman -S google-chrome",
	darwin: "Install: download from https://www.google.com/chrome/",
	win32: "Install: download from https://www.google.com/chrome/",
};

const chromePaths = {
	linux: ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"],
	darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
	win32: [
		join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
		join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
		join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
	],
};
const candidates = chromePaths[OS] || [];
const chromePath = candidates.find(p => existsSync(p));

if (!chromePath) {
	out(`✗ Chrome not found. ${installHints[OS] || "Please install Google Chrome."}`);
	process.exit(1);
}

if (!noProfile) {
	const profileRoots = {
		linux: [join(HOME, ".config", "google-chrome")],
		darwin: [join(HOME, "Library", "Application Support", "Google", "Chrome")],
		win32: [join(process.env.LOCALAPPDATA || join(HOME, "AppData", "Local"), "Google", "Chrome", "User Data")],
	};
	const roots = profileRoots[OS] || [];
	const profileRoot = roots.find(r => existsSync(r));

	if (profileRoot) {
		const files = ["Default/Cookies", "Default/Preferences", "Local State"];
		let copied = 0;
		for (const f of files) {
			const src = join(profileRoot, f);
			const dst = join(cacheBase, f);
			if (existsSync(src)) {
				try {
					mkdirSync(join(dst, ".."), { recursive: true });
					copyFileSync(src, dst);
					copied++;
				} catch { /* ignore */ }
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
	"--remote-debugging-address=127.0.0.1",
	`--remote-debugging-port=${port}`,
	`--user-data-dir=${cacheBase}`,
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
		const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
		version = await browser.version();
		await browser.disconnect();
		connected = true;
		break;
	} catch { await new Promise(r => setTimeout(r, 500)); }
}

if (!connected) {
	if (allowLocalhost) { try { unlinkSync(LOCALHOST_FLAG_FILE); } catch { /* ignore */ } }
	out("✗ Chrome did not start");
	out(`  If a stale instance exists: rm ${join(cacheBase, ".pid")}`);
	process.exit(1);
}

setLocalhostAccessFlag(allowLocalhost);

// Record PID for safe multi-agent cleanup
if (proc.pid) {
	writeFileSync(PID_FILE, String(proc.pid), { mode: 0o600 });
	writeFileSync(PORT_FILE, String(port), { mode: 0o600 });
	try { chmodSync(PID_FILE, 0o600); chmodSync(PORT_FILE, 0o600); } catch { /* ignore */ }
}
out(`✓ Chrome ${version} on 127.0.0.1:${port}${mode}${noProfile ? "" : " + profile"} (pid ${proc.pid})`);
