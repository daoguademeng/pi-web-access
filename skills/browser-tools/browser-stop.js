#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";

const PID_FILE = `${homedir()}/.cache/browser-tools/.pid`;

if (existsSync(PID_FILE)) {
	const pid = parseInt(readFileSync(PID_FILE, "utf8").trim());
	try { process.kill(pid, "SIGTERM"); } catch {}
	try { unlinkSync(PID_FILE); } catch {}
}

await new Promise(r => setTimeout(r, 500));

// Verify: any remaining chrome on 9222 that somehow survived?
const { execSync } = await import("node:child_process");
const count = parseInt(execSync('ps aux | grep "chrome.*9222" | grep -v grep | grep -v "type=" | wc -l', { encoding: "utf8" }).trim()) || 0;
process.stdout.write(count === 0 ? "✓ Chrome stopped\n" : `⚠ ${count} stray Chrome process(es) remain — check 'ps aux | grep chrome'\n`);
