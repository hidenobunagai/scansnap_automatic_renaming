import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("normalizeIssuerText_", () => {
  test("converts full-width ASCII letters and digits to half-width", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.normalizeIssuerText_("Ｗismettac１２３")).toBe("Wismettac123");
  });

  test("converts full-width spaces to half-width spaces before collapse", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.normalizeIssuerText_("パークホームズ　ＬａＬａ")).toBe("パークホームズ LaLa");
  });

  test("keeps kana and kanji unchanged", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.normalizeIssuerText_("東京電力株式会社")).toBe("東京電力株式会社");
  });
});

describe("normalizeAiSuggestion_", () => {
  test("normalizes issuer before truncating file segment", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/ai.js"],
    });
    const issuer = "かなＡＡＡＡＡ／／／管理組合";
    const maxIssuerLength = 12;

    const result = context.normalizeAiSuggestion_(
      {
        documentDate: "2026-04-10",
        issuer: issuer,
        documentType: "請求書",
        subject: "4月分",
        summary: "4月分",
        confidence: 0.8,
      },
      {
        name: "scan.pdf",
        createdAt: new Date("2026-04-10T00:00:00Z"),
      },
      {
        timezone: "Asia/Tokyo",
        maxIssuerLength: maxIssuerLength,
        maxDocumentTypeLength: 30,
        maxSubjectLength: 50,
      },
    );

    const truncateBeforeNormalize = context.normalizeIssuerText_(
      context.truncateFileSegment_(issuer, maxIssuerLength),
    );

    expect(result.issuer).toBe("かなAAAAA-管理組合");
    expect(truncateBeforeNormalize).toBe("かなAAAAA///管理");
  });
});
