import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

function blockedIp(host) {
  if (host === "0.0.0.0" || host === "255.255.255.255" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) return true;
  const [a, b] = host.split(".").map(Number);
  if (a === 172 && b >= 16 && b <= 31) return true;
  const lower = host.toLowerCase();
  return lower === "::1" || lower === "::" || lower.startsWith("::ffff:") || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("ff");
}

function assertPublicHost(u) {
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal") || host === "metadata.google.internal") {
    throw new Error("local/private URLs are blocked");
  }
  if (isIP(host) && blockedIp(host)) throw new Error("local/private IP URLs are blocked");
  return host;
}

async function assertPublicResolvedHost(host) {
  if (!isIP(host)) {
    let addresses;
    try { addresses = await lookup(host, { all: true, verbatim: true }); }
    catch { throw new Error("could not validate URL hostname"); }
    if (addresses.some((a) => blockedIp(a.address))) throw new Error("URL resolves to a local/private address");
  }
}

export async function assertPublicHttpUrl(input) {
  let u;
  try { u = new URL(input); } catch { throw new Error("invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s) URLs are allowed");
  const host = assertPublicHost(u);
  await assertPublicResolvedHost(host);
  return u.toString();
}

async function assertPublicBrowserRequestUrl(input) {
  let u;
  try { u = new URL(input); } catch { throw new Error("invalid URL"); }
  if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) throw new Error("unsupported browser request URL scheme");
  const host = assertPublicHost(u);
  await assertPublicResolvedHost(host);
  return u.toString();
}

export async function installPublicRequestGuard(page) {
  let blocked = null;
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    try {
      const url = request.url();
      if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("ws://") || url.startsWith("wss://")) {
        await assertPublicBrowserRequestUrl(url);
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
