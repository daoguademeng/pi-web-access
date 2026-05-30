#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const OS = platform();

const cacheBase = OS === "darwin"
	? join(HOME, "Library", "Caches", "browser-tools")
	: OS === "win32"
		? join(process.env.LOCALAPPDATA || join(HOME, "AppData", "Local"), "browser-tools")
		: join(HOME, ".cache", "browser-tools");
const PID_FILE = join(cacheBase, ".pid");

if (existsSync(PID_FILE)) {
	const pid = parseInt(readFileSync(PID_FILE, "utf8").trim());
	try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
	try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

await new Promise(r => setTimeout(r, 500));
process.stdout.write("✓ Chrome stopped\n");
