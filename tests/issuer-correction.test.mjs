import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("isWeakIssuerLabel_", () => {
  test("treats personal-name-like hiragana as weak", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.isWeakIssuerLabel_("ながいげんた")).toBe(true);
  });

  test("treats generic document labels as weak", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.isWeakIssuerLabel_("学級だより")).toBe(true);
    expect(context.isWeakIssuerLabel_("案内")).toBe(true);
  });

  test("keeps concrete organization names as strong", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.isWeakIssuerLabel_("桜小学校")).toBe(false);
    expect(context.isWeakIssuerLabel_("三郷市水道部業務課")).toBe(false);
  });
});

describe("extractOrganizationCandidates_", () => {
  test("finds school and company names from OCR text", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(
      context.extractOrganizationCandidates_(
        "桜小学校 学級だより 2026年4月号 保護者各位",
      ),
    ).toContain("桜小学校");

    expect(
      context.extractOrganizationCandidates_(
        "株式会社サンプル 請求書 ご請求金額 10,000円",
      ),
    ).toContain("株式会社サンプル");
  });
});

describe("correctIssuerSuggestion_", () => {
  test("replaces weak issuer with stronger organization found in OCR text", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/ai.js"],
    });

    const corrected = context.correctIssuerSuggestion_(
      {
        issuer: "ながいげんた",
        documentType: "おたより",
        subject: "4月のおたより",
        summary: "桜小学校からのおたより",
      },
      "桜小学校 学級だより 4月号 ながいげんた",
    );

    expect(corrected).toBe("桜小学校");
  });

  test("keeps current issuer when no stronger evidence exists", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/ai.js"],
    });

    const corrected = context.correctIssuerSuggestion_(
      {
        issuer: "東京電力株式会社",
        documentType: "請求書",
        subject: "4月分",
        summary: "電気料金のお知らせ",
      },
      "東京電力株式会社 電気料金請求書 4月分",
    );

    expect(corrected).toBe("東京電力株式会社");
  });
});

describe("normalizeAiSuggestion_", () => {
  test("corrects weak issuer after normalization", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/ai.js"],
    });

    const result = context.normalizeAiSuggestion_(
      {
        documentDate: "2026-04-12",
        issuer: "学級だより",
        documentType: "おたより",
        subject: "4月号",
        summary: "桜小学校 4月号",
        confidence: 0.7,
      },
      {
        name: "scan.pdf",
        createdAt: new Date("2026-04-12T00:00:00Z"),
      },
      {
        timezone: "Asia/Tokyo",
        maxIssuerLength: 50,
        maxDocumentTypeLength: 30,
        maxSubjectLength: 50,
      },
      "桜小学校 学級だより 4月号",
    );

    expect(result.issuer).toBe("桜小学校");
  });
});
