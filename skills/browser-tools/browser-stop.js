#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { localAccessFlagPath } from "./cdp-url.js";

const HOME = homedir();
const OS = platform();

const cacheBase = OS === "darwin"
	? join(HOME, "Library", "Caches", "browser-tools")
	: OS === "win32"
		? join(process.env.LOCALAPPDATA || join(HOME, "AppData", "Local"), "browser-tools")
		: join(HOME, ".cache", "browser-tools");
const PID_FILE = join(cacheBase, ".pid");
const PORT_FILE = join(cacheBase, ".port");
const LOCALHOST_FLAG_FILE = localAccessFlagPath();

function commandLooksLikeBrowserTools(pid) {
	if (OS !== "linux") return true;
	try {
		const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
		return cmd.includes("--user-data-dir=" + cacheBase) && cmd.includes("--remote-debugging-port=");
	} catch {
		return false;
	}
}

if (existsSync(PID_FILE)) {
	const pid = parseInt(readFileSync(PID_FILE, "utf8").trim());
	if (Number.isFinite(pid) && commandLooksLikeBrowserTools(pid)) {
		try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
	} else {
		process.stderr.write("⚠ Refusing to kill PID that does not look like browser-tools Chrome\n");
	}
	try { unlinkSync(PID_FILE); } catch { /* ignore */ }
	try { unlinkSync(PORT_FILE); } catch { /* ignore */ }
}
try { unlinkSync(LOCALHOST_FLAG_FILE); } catch { /* ignore */ }

await new Promise(r => setTimeout(r, 500));
process.stdout.write("✓ Chrome stopped\n");
