import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("USER_WEAK_ISSUER_LABELS option", () => {
  test("normalizes and respects user defined weak issuer labels", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });
    const config = {
      userWeakIssuerLabels: "桜通信 , 新聞社, ながいげんた",
    };

    // Default weak label
    expect(context.isWeakIssuerLabel_("案内", config)).toBe(true);

    // Default strong label (should remain strong when not listed)
    expect(context.isWeakIssuerLabel_("桜小学校", config)).toBe(false);

    // Custom weak labels (with leading/trailing whitespace removed during parsing)
    expect(context.isWeakIssuerLabel_("桜通信", config)).toBe(true);
    expect(context.isWeakIssuerLabel_("新聞社", config)).toBe(true);
    expect(context.isWeakIssuerLabel_("ながいげんた", config)).toBe(true);

    // Not in custom weak labels
    expect(context.isWeakIssuerLabel_("朝日新聞", config)).toBe(false);
  });
});
