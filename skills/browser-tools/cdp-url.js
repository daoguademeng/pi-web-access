import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export function browserToolsCacheBase() {
  const HOME = homedir();
  const OS = platform();
  return OS === "darwin"
    ? join(HOME, "Library", "Caches", "browser-tools")
    : OS === "win32"
      ? join(process.env.LOCALAPPDATA || join(HOME, "AppData", "Local"), "browser-tools")
      : join(HOME, ".cache", "browser-tools");
}

export function localAccessFlagPath() {
  return join(browserToolsCacheBase(), ".allow-localhost");
}

export function browserURL() {
  const portFile = join(browserToolsCacheBase(), ".port");
  if (!existsSync(portFile)) throw new Error("CDP port file not found. Run: browser-start.js");
  const port = readFileSync(portFile, "utf8").trim();
  if (!/^\d{2,5}$/.test(port)) throw new Error("Invalid CDP port file. Re-run: browser-start.js");
  return `http://127.0.0.1:${port}`;
}
