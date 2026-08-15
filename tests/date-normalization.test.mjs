import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

function createNormalizeContext() {
  return createAppsScriptContext({
    files: ["src/utils.js"],
  });
}

describe("normalizeIsoDate_", () => {
  test("accepts valid calendar dates", () => {
    const context = createNormalizeContext();

    expect(context.normalizeIsoDate_("2026-04-10")).toBe("2026-04-10");
    expect(context.normalizeIsoDate_("2026-2-5")).toBe("2026-02-05");
  });

  test("accepts leap day in a leap year", () => {
    const context = createNormalizeContext();

    expect(context.normalizeIsoDate_("2024-02-29")).toBe("2024-02-29");
  });

  test("rejects February 29 in a non-leap year", () => {
    const context = createNormalizeContext();

    expect(context.normalizeIsoDate_("2023-02-29")).toBe("");
  });

  test("rejects dates that do not exist in the calendar", () => {
    const context = createNormalizeContext();

    expect(context.normalizeIsoDate_("2026-02-31")).toBe("");
    expect(context.normalizeIsoDate_("2026-04-31")).toBe("");
    expect(context.normalizeIsoDate_("2026-06-31")).toBe("");
    expect(context.normalizeIsoDate_("2026-13-01")).toBe("");
    expect(context.normalizeIsoDate_("2026-00-10")).toBe("");
  });

  test("rejects malformed values", () => {
    const context = createNormalizeContext();

    expect(context.normalizeIsoDate_("not-a-date")).toBe("");
    expect(context.normalizeIsoDate_("2026-04")).toBe("");
    expect(context.normalizeIsoDate_("")).toBe("");
  });
});
