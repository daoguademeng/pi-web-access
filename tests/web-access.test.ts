import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, readStoredConfig, writeStoredConfig } from "../config.js";
import { assertSafeEndpoint, validatePublicUrl } from "../providers/security.js";
import { retryWithBackoff } from "../providers/shared.js";
import { WebAccessError } from "../types.js";
import { parseXaiResponse } from "../providers/grok.js";
import { parseExaResponse } from "../providers/exa.js";

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
  await assert.rejects(() => validatePublicUrl("http://metadata.google.internal", "fetch.url"), WebAccessError);
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
