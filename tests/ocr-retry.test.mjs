import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

const CONFIG = { ocrLanguage: "ja" };

/**
 * Build a context that records how often Drive was asked to insert a document
 * and how long the code waited between attempts.
 */
function createOcrContext({
  failures = 0,
  errorMessage = "User rate limit exceeded for OCR",
} = {}) {
  const sleeps = [];
  let insertCalls = 0;
  let documentsOpened = 0;

  const context = createAppsScriptContext({
    files: ["src/utils.js", "src/logger.js", "src/ocr.js"],
    globals: {
      DriveApp: {
        getFileById() {
          return { getBlob: () => ({ name: "scan.pdf" }) };
        },
      },
      DocumentApp: {
        openById() {
          documentsOpened += 1;
          return { getBody: () => ({ getText: () => "OCR が返した本文テキストです。" }) };
        },
      },
      Utilities: {
        getUuid: () => "11111111-2222-4333-8444-555555555555",
        sleep(ms) {
          sleeps.push(ms);
        },
      },
      // src/drive-compat.js is auto-loaded by the helper and calls Drive.Files.*,
      // so the stub has to live at that level rather than on the compat wrapper.
      Drive: {
        Files: {
          insert() {
            insertCalls += 1;
            if (insertCalls <= failures) {
              throw new Error(errorMessage);
            }
            return { id: "temp-doc-1" };
          },
          trash() {},
          remove() {},
          update() {},
          // No create(): drive-compat falls back to it only when present, and
          // stubbing it would mask the insert error this suite is exercising.
        },
      },
    },
  });

  return {
    context,
    sleeps,
    getInsertCalls: () => insertCalls,
    getDocumentsOpened: () => documentsOpened,
  };
}

describe("OCR extraction", () => {
  test("returns the extracted text on the first try", () => {
    const { context, sleeps, getInsertCalls } = createOcrContext();

    const text = context.extractTextFromPdf_("file-1", CONFIG);

    expect(text).toBe("OCR が返した本文テキストです。");
    expect(getInsertCalls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("retries a rate-limited conversion and then succeeds", () => {
    const { context, sleeps, getInsertCalls } = createOcrContext({ failures: 2 });

    const text = context.extractTextFromPdf_("file-1", CONFIG);

    expect(text).toBe("OCR が返した本文テキストです。");
    expect(getInsertCalls()).toBe(3);
    expect(sleeps.length).toBe(2);
  });

  test("backoff grows between attempts", () => {
    const { context, sleeps } = createOcrContext({ failures: 2 });

    context.extractTextFromPdf_("file-1", CONFIG);

    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });

  test("gives up after the attempt limit and reports the failure", () => {
    const { context, getInsertCalls } = createOcrContext({ failures: 99 });

    expect(() => context.extractTextFromPdf_("file-1", CONFIG)).toThrow(/rate limit/i);
    expect(getInsertCalls()).toBe(4);
  });

  test("does not retry an error that is not a throttle", () => {
    const { context, sleeps, getInsertCalls } = createOcrContext({
      failures: 99,
      errorMessage: "File not found: abc123",
    });

    expect(() => context.extractTextFromPdf_("file-1", CONFIG)).toThrow(/File not found/);
    expect(getInsertCalls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("recognises the throttling wordings Drive actually returns", () => {
    for (const message of [
      "User rate limit exceeded for OCR",
      "Rate Limit Exceeded",
      "429 Too Many Requests",
    ]) {
      const { context, sleeps } = createOcrContext({ failures: 1, errorMessage: message });

      context.extractTextFromPdf_("file-1", CONFIG);

      expect(sleeps.length).toBe(1);
    }
  });
});
