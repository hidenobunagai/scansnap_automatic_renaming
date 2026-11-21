import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

/**
 * Build a context whose UrlFetchApp returns the queued responses in order
 * (repeating the last one) and whose Utilities.sleep only records delays.
 * Each queued entry is { status, body, headers } or an Error to throw.
 */
function createFetchContext(responses) {
  const sleeps = [];
  let fetchCalls = 0;

  const context = createAppsScriptContext({
    files: ["src/utils.js", "src/logger.js", "src/ai.js"],
    globals: {
      Utilities: {
        formatDate: () => "2026-04-12",
        formatString: (template, ...args) => template,
        getUuid: () => "00000000-0000-4000-8000-000000000000",
        sleep(ms) {
          sleeps.push(ms);
        },
      },
      UrlFetchApp: {
        fetch() {
          const entry = responses[Math.min(fetchCalls, responses.length - 1)];
          fetchCalls += 1;
          if (entry instanceof Error) {
            throw entry;
          }
          return {
            getResponseCode: () => entry.status,
            getContentText: () => entry.body || "{}",
            getHeaders: () => entry.headers || {},
            getHeader: (name) => (entry.headers || {})[name] ?? null,
          };
        },
      },
    },
  });

  return { context, sleeps, getFetchCalls: () => fetchCalls };
}

describe("fetchJson_ Retry-After handling", () => {
  test("returns parsed JSON on success without sleeping", () => {
    const { context, sleeps, getFetchCalls } = createFetchContext([
      { status: 200, body: '{"ok":true}' },
    ]);

    expect(context.fetchJson_("https://example.com", {})).toEqual({ ok: true });
    expect(getFetchCalls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("honours a delta-seconds Retry-After instead of exponential backoff", () => {
    const { context, sleeps, getFetchCalls } = createFetchContext([
      { status: 429, body: "slow down", headers: { "Retry-After": "2" } },
      { status: 200, body: '{"ok":true}' },
    ]);

    expect(context.fetchJson_("https://example.com", {})).toEqual({ ok: true });
    expect(getFetchCalls()).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  test("honours an HTTP-date Retry-After (header name is case-insensitive)", () => {
    const retryAt = new Date(Date.now() + 3000).toUTCString();
    const { context, sleeps } = createFetchContext([
      { status: 503, body: "unavailable", headers: { "retry-after": retryAt } },
      { status: 200, body: '{"ok":true}' },
    ]);

    context.fetchJson_("https://example.com", {});

    expect(sleeps.length).toBe(1);
    // HTTP-date has 1-second resolution, so allow a small tolerance.
    expect(sleeps[0]).toBeGreaterThan(1000);
    expect(sleeps[0]).toBeLessThanOrEqual(3000);
  });

  test("fails immediately without sleeping when Retry-After is too long", () => {
    const { context, sleeps, getFetchCalls } = createFetchContext([
      { status: 429, body: "quota", headers: { "Retry-After": "120" } },
    ]);

    expect(() => context.fetchJson_("https://example.com", {})).toThrow(/Retry-After too long/);
    expect(getFetchCalls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("falls back to exponential backoff when no Retry-After is present", () => {
    const { context, sleeps, getFetchCalls } = createFetchContext([
      { status: 429, body: "slow down" },
      { status: 200, body: '{"ok":true}' },
    ]);

    context.fetchJson_("https://example.com", {});

    expect(getFetchCalls()).toBe(2);
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1000);
    expect(sleeps[0]).toBeLessThan(1500);
  });

  test("does not retry a non-retryable status", () => {
    const { context, sleeps, getFetchCalls } = createFetchContext([
      { status: 400, body: "bad request" },
    ]);

    expect(() => context.fetchJson_("https://example.com", {})).toThrow(/400/);
    expect(getFetchCalls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("gives up after the retry limit", () => {
    const { context, getFetchCalls } = createFetchContext([{ status: 500, body: "boom" }]);

    expect(() => context.fetchJson_("https://example.com", {})).toThrow(/500/);
    expect(getFetchCalls()).toBe(3);
  });
});

describe("parseRetryAfterMs_", () => {
  test("parses delta-seconds", () => {
    const { context } = createFetchContext([{ status: 200, body: "{}" }]);

    expect(context.parseRetryAfterMs_("5", 0)).toBe(5000);
    expect(context.parseRetryAfterMs_("0", 0)).toBe(0);
  });

  test("parses an HTTP-date relative to now", () => {
    const { context } = createFetchContext([{ status: 200, body: "{}" }]);
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");

    expect(context.parseRetryAfterMs_("Wed, 21 Oct 2015 07:28:10 GMT", now)).toBe(10000);
    expect(context.parseRetryAfterMs_("Wed, 21 Oct 2015 07:27:00 GMT", now)).toBe(0);
  });

  test("returns null for missing or unparseable values", () => {
    const { context } = createFetchContext([{ status: 200, body: "{}" }]);

    expect(context.parseRetryAfterMs_(null, 0)).toBeNull();
    expect(context.parseRetryAfterMs_("", 0)).toBeNull();
    expect(context.parseRetryAfterMs_("soon", 0)).toBeNull();
  });
});
