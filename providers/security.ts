import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { WebAccessError } from "../types.js";

const METADATA_HOSTS = new Set(["metadata.google.internal"]);
const BLOCKED_TLDS = [".local", ".localhost", ".internal", ".lan"];
const DEFAULT_ALLOWED_ENDPOINTS: Record<string, Set<string>> = {
  grokApiUrl: new Set(["api.x.ai"]),
  exaBaseUrl: new Set(["api.exa.ai"]),
  zhipuApiUrl: new Set(["open.bigmodel.cn"]),
  tavilyApiUrl: new Set(["api.tavily.com"]),
  firecrawlApiUrl: new Set(["api.firecrawl.dev"]),
  context7BaseUrl: new Set(["context7.com"]),
};

function isBlockedIp(ip: string): boolean {
  if (ip === "0.0.0.0" || ip === "255.255.255.255") return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  const firstTwo = ip.split(".").slice(0, 2).map(Number);
  if (firstTwo[0] === 172 && firstTwo[1] >= 16 && firstTwo[1] <= 31) return true;

  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::" || lower.startsWith("::ffff:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("fe80")) return true; // link local
  if (lower.startsWith("ff")) return true; // multicast
  return false;
}

function normalizeHost(hostname: string): string {
  const host = hostname.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  return host;
}

export function assertSafeEndpoint(url: string, field: string): string {
  if (!url) return url;
  let parsed: URL;
  try { parsed = new URL(url); } catch {
    throw new WebAccessError("invalid_params", `${field}: invalid provider endpoint URL.`);
  }
  const host = normalizeHost(parsed.hostname);
  if (parsed.protocol !== "https:") {
    const isLocalOpenAi = field === "openaiApiUrl" && (host === "localhost" || host === "127.0.0.1" || host === "::1");
    if (!isLocalOpenAi) throw new WebAccessError("invalid_params", `${field}: provider endpoints must use https.`);
  }
  const official = DEFAULT_ALLOWED_ENDPOINTS[field];
  if (official && !official.has(host)) {
    throw new WebAccessError("invalid_params", `${field}: provider endpoint host is not in the official allowlist.`);
  }
  return url.replace(/\/$/, "");
}

export async function validatePublicUrl(input: string, action = "url"): Promise<string> {
  let parsed: URL;
  try { parsed = new URL(input); } catch {
    throw new WebAccessError("invalid_params", `${action}: invalid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebAccessError("invalid_params", `${action}: only http(s) URLs are allowed.`);
  }
  const host = normalizeHost(parsed.hostname);
  if (!host || host === "localhost" || METADATA_HOSTS.has(host) || BLOCKED_TLDS.some(tld => host.endsWith(tld))) {
    throw new WebAccessError("invalid_params", `${action}: localhost, private, metadata, and local-network URLs are blocked.`);
  }
  if (isIP(host) && isBlockedIp(host)) {
    throw new WebAccessError("invalid_params", `${action}: private or local IP URLs are blocked.`);
  }
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.some(a => isBlockedIp(a.address))) {
      throw new WebAccessError("invalid_params", `${action}: DNS resolves to a private or local IP address.`);
    }
  } catch (err) {
    if (err instanceof WebAccessError) throw err;
    throw new WebAccessError("invalid_params", `${action}: could not validate URL hostname.`);
  }
  return parsed.toString();
}
