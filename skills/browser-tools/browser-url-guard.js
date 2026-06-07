import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { localAccessFlagPath } from "./cdp-url.js";

function normalizeHost(host) {
  return host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isLocalhostName(host) {
  return host === "localhost" || host.endsWith(".localhost");
}

function isLocalhostIp(host) {
  const lower = host.toLowerCase();
  if (host === "0.0.0.0" || host.startsWith("127.")) return true;
  if (lower === "::1") return true;
  const mappedIpv4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isLocalhostIp(mappedIpv4) : false;
}

function blockedIp(host) {
  if (host === "0.0.0.0" || host === "255.255.255.255" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) return true;
  const [a, b] = host.split(".").map(Number);
  if (a === 172 && b >= 16 && b <= 31) return true;
  const lower = host.toLowerCase();
  return lower === "::1" || lower === "::" || lower.startsWith("::ffff:") || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("ff");
}

export function localhostAccessEnabled(options = {}) {
  return options.allowLocalhost ?? existsSync(localAccessFlagPath());
}

function assertHostAllowedBeforeDns(host, allowLocalhost) {
  if (host === "metadata.google.internal") throw new Error("metadata URLs are blocked");

  if (isLocalhostName(host)) {
    if (allowLocalhost) return { skipDns: true };
    throw new Error("local/private URLs are blocked");
  }

  if (isIP(host) && blockedIp(host)) {
    if (allowLocalhost && isLocalhostIp(host)) return { skipDns: true };
    throw new Error("local/private IP URLs are blocked");
  }

  if (host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("local/private URLs are blocked");
  }

  return { skipDns: false };
}

async function assertResolvedHost(host, allowLocalhost) {
  if (isIP(host)) return;

  let addresses;
  try { addresses = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new Error("could not validate URL hostname"); }

  const privateAddresses = addresses.filter((a) => blockedIp(a.address));
  if (privateAddresses.length === 0) return;

  if (allowLocalhost && addresses.every((a) => isLocalhostIp(a.address))) return;

  throw new Error("URL resolves to a local/private address");
}

async function assertAllowedHost(u, options = {}) {
  const allowLocalhost = localhostAccessEnabled(options);
  const host = normalizeHost(u.hostname);
  const { skipDns } = assertHostAllowedBeforeDns(host, allowLocalhost);
  if (!skipDns) await assertResolvedHost(host, allowLocalhost);
  return host;
}

export async function assertPublicHttpUrl(input, options = {}) {
  let u;
  try { u = new URL(input); } catch { throw new Error("invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s) URLs are allowed");
  await assertAllowedHost(u, options);
  return u.toString();
}

async function assertPublicBrowserRequestUrl(input, options = {}) {
  let u;
  try { u = new URL(input); } catch { throw new Error("invalid URL"); }
  if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) throw new Error("unsupported browser request URL scheme");
  await assertAllowedHost(u, options);
  return u.toString();
}

export async function installPublicRequestGuard(page, options = {}) {
  let blocked = null;
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    try {
      const url = request.url();
      if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("ws://") || url.startsWith("wss://")) {
        await assertPublicBrowserRequestUrl(url, options);
      } else if (request.isNavigationRequest() && url !== "about:blank") {
        throw new Error("only http(s) navigation URLs are allowed");
      }
      await request.continue();
    } catch (err) {
      blocked = { url: request.url(), reason: err?.message ?? "blocked unsafe request" };
      await request.abort("blockedbyclient").catch(() => undefined);
    }
  });
  return {
    get blocked() { return blocked; },
  };
}
