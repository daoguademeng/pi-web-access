import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, readStoredConfig, writeStoredConfig } from "../config.js";
import { assertSafeEndpoint, validatePublicUrl } from "../providers/security.js";
import { retryWithBackoff, fetchWithTimeout, readResponseTextLimited, providerError } from "../providers/shared.js";
import { WebAccessError } from "../types.js";
import { grokSearch, parseXaiResponse } from "../providers/grok.js";
import { context7Docs } from "../providers/context7.js";
import { parseExaResponse } from "../providers/exa.js";
import { tavilyMap } from "../providers/tavily.js";
import { assertPublicHttpUrl as assertBrowserPublicHttpUrl } from "../skills/browser-tools/browser-url-guard.js";

test("project endpoint overrides are ignored by loadConfig", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "web-access-test-"));
  try {
    await writeFile(join(cwd, ".pi-web-access-placeholder"), "");
    writeStoredConfig("project", cwd, {
      exaBaseUrl: "https://attacker.example",
      exaApiKey: "project-key",
      retryMaxAttempts: 999,
    });
    const config = loadConfig(cwd);
    assert.equal(config.exaBaseUrl, "https://api.exa.ai");
    assert.equal(config.exaApiKey, "project-key");
    assert.equal(config.retryMaxAttempts, 8);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("stored config cleaning drops invalid values and clamps numbers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "web-access-test-"));
  try {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "web-access.json"), JSON.stringify({ mapLimit: -1, retryMaxAttempts: "999", exaApiKey: "  key  ", unknown: "x" }));
    const stored = readStoredConfig("project", cwd) as Record<string, unknown>;
    assert.equal(stored.exaApiKey, "key");
    assert.equal(stored.retryMaxAttempts, 8);
    assert.equal(stored.mapLimit, undefined);
    assert.equal(stored.unknown, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("endpoint guard requires official https provider hosts", () => {
  assert.equal(assertSafeEndpoint("https://api.exa.ai/", "exaBaseUrl"), "https://api.exa.ai");
  assert.throws(() => assertSafeEndpoint("http://api.exa.ai", "exaBaseUrl"), WebAccessError);
  assert.throws(() => assertSafeEndpoint("https://evil.example", "exaBaseUrl"), WebAccessError);
});

test("public URL guard blocks local/private URLs", async () => {
  await assert.rejects(() => validatePublicUrl("file:///etc/passwd", "fetch.url"), WebAccessError);
  await assert.rejects(() => validatePublicUrl("http://127.0.0.1:3000", "fetch.url"), WebAccessError);
  await assert.rejects(() => validatePublicUrl("http://192.168.1.1", "fetch.url"), WebAccessError);
  await assert.rejects(() => validatePublicUrl("http://[::1]/", "fetch.url"), WebAccessError);
  await assert.rejects(() => validatePublicUrl("http://[::ffff:127.0.0.1]/", "fetch.url"), WebAccessError);
  await assert.rejects(() => validatePublicUrl("http://metadata.google.internal", "fetch.url"), WebAccessError);
});

test("browser-tools URL guard allows only loopback when localhost gate is enabled", async () => {
  await assert.rejects(() => assertBrowserPublicHttpUrl("http://localhost:5173/", { allowLocalhost: false }), /local\/private URLs are blocked/);
  assert.equal(await assertBrowserPublicHttpUrl("http://localhost:5173/", { allowLocalhost: true }), "http://localhost:5173/");
  assert.equal(await assertBrowserPublicHttpUrl("http://app.localhost:5173/path", { allowLocalhost: true }), "http://app.localhost:5173/path");
  assert.equal(await assertBrowserPublicHttpUrl("http://127.0.0.1:5173/path", { allowLocalhost: true }), "http://127.0.0.1:5173/path");
  assert.equal(await assertBrowserPublicHttpUrl("http://[::1]:5173/", { allowLocalhost: true }), "http://[::1]:5173/");
  await assert.rejects(() => assertBrowserPublicHttpUrl("http://192.168.1.1/", { allowLocalhost: true }), /local\/private IP URLs are blocked/);
  await assert.rejects(() => assertBrowserPublicHttpUrl("http://metadata.google.internal/", { allowLocalhost: true }), /metadata URLs are blocked/);
});

test("retryWithBackoff uses maxAttempts semantics", async () => {
  let attempts = 0;
  await assert.rejects(() => retryWithBackoff(async () => {
    attempts++;
    const err = new TypeError("fetch failed");
    throw err;
  }, { maxRetries: 3, baseDelayMs: 1 }), TypeError);
  assert.equal(attempts, 3);
});

test("tavilyMap clamps maxDepth to Tavily minimum", async () => {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  try {
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ base_url: "https://example.com", results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await tavilyMap("https://example.com", {
      tavilyApiKey: "key",
      tavilyApiUrl: "https://api.tavily.com",
      tavilyTimeoutMs: 1_000,
      retryMaxAttempts: 1,
      mapMaxBreadth: 20,
      mapLimit: 50,
      mapTimeoutMs: 150_000,
    } as any, { maxDepth: 0 });
    assert.equal(payload?.max_depth, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("providerError includes HTTP status for fatal provider errors", () => {
  const err = new Error("HTTP 400") as Error & { status: number };
  err.status = 400;
  assert.throws(
    () => providerError(err, "Tavily Map"),
    (error: unknown) => error instanceof WebAccessError && error.message === "Tavily Map API error (HTTP 400).",
  );
});

test("xAI parser extracts text and citations", () => {
  const parsed = parseXaiResponse({ output: [{ content: [{ type: "output_text", text: "hello" }, { annotations: [{ type: "url_citation", url: "https://example.com", title: "Example" }] }] }] });
  assert.equal(parsed.content, "hello");
  assert.deepEqual(parsed.sources, [{ url: "https://example.com", title: "Example" }]);
});

test("Exa parser returns empty result for empty provider payload", () => {
  const parsed = parseExaResponse({ results: [] }, "q");
  assert.equal(parsed.content, "");
  assert.deepEqual(parsed.primarySources, []);
});

test("Context7 auth failures do not fall back to Exa", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("context7.com")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fallback call: ${url}`);
    };
    await assert.rejects(
      () => context7Docs("react", {
        context7BaseUrl: "https://context7.com",
        context7TimeoutMs: 1_000,
        retryMaxAttempts: 1,
        exaApiKey: "exa-key",
        exaBaseUrl: "https://api.exa.ai",
        exaTimeoutMs: 1_000,
      } as any),
      (err: unknown) => err instanceof WebAccessError && err.code === "auth_error",
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.includes("context7.com"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Context7 explicit libraryId failures do not return unrelated Exa fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("context7.com")) {
        return new Response(JSON.stringify({ codeSnippets: [], infoSnippets: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fallback call: ${url}`);
    };
    await assert.rejects(
      () => context7Docs("install", {
        context7BaseUrl: "https://context7.com",
        context7TimeoutMs: 1_000,
        retryMaxAttempts: 1,
        exaApiKey: "exa-key",
        exaBaseUrl: "https://api.exa.ai",
        exaTimeoutMs: 1_000,
      } as any, { libraryId: "/definitely/not-a-library" }),
      (err: unknown) => err instanceof WebAccessError && err.code === "no_results",
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.includes("context7.com"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Context7 requests propagate caller abort signal to fetch", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let sawAbort = false;
  try {
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const fetchSignal = init?.signal;
      assert.ok(fetchSignal instanceof AbortSignal);
      setTimeout(() => controller.abort(), 0);
      await new Promise<void>((_resolve, reject) => {
        fetchSignal.addEventListener("abort", () => {
          sawAbort = true;
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
        setTimeout(() => reject(new Error("caller abort signal did not reach fetch")), 50);
      });
      throw new Error("unreachable");
    };
    await assert.rejects(
      () => context7Docs("install", {
        context7BaseUrl: "https://context7.com",
        context7TimeoutMs: 1_000,
        retryMaxAttempts: 1,
      } as any, { libraryId: "/reactjs/react.dev" }, controller.signal),
      (err: unknown) => err instanceof DOMException && err.name === "AbortError",
    );
    assert.equal(sawAbort, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout preserves response body for streaming size limits", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1234"));
        controller.enqueue(new TextEncoder().encode("5678"));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/plain" } });
    const res = await fetchWithTimeout("https://example.com/large.txt", {}, 1_000);
    assert.ok(res.body);
    await assert.rejects(() => readResponseTextLimited(res, 5), WebAccessError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI streaming responses enforce maximum buffer size", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const huge = "x".repeat(501_000);
    globalThis.fetch = async () => new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: huge } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
    await assert.rejects(
      () => grokSearch("q", {
        grokApiKey: "",
        openaiApiUrl: "https://relay.example/v1",
        openaiApiKey: "key",
        openaiModel: "model",
        grokTimeoutMs: 5_000,
        retryMaxAttempts: 1,
      } as any),
      (err: unknown) => err instanceof WebAccessError && err.code === "no_results",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
