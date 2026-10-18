import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

const FILE_META = { name: "scan.pdf", createdAt: new Date("2026-04-12T00:00:00Z") };
const BASE_CONFIG = {
  timezone: "Asia/Tokyo",
  minConfidence: 0.75,
  maxIssuerLength: 50,
  maxDocumentTypeLength: 30,
  maxSubjectLength: 50,
  knownIssuers: ["三郷市立桜小学校", "桜小学校児童クラブ", "埼玉県民共済"],
};
const OCR_TEXT = "令和8年4月10日 保護者各位 三郷市立桜小学校 校長 4月の行事予定をお知らせします";

function normalize(payload, config = BASE_CONFIG, text = OCR_TEXT) {
  const context = createAppsScriptContext({ files: ["src/utils.js", "src/ai.js"] });
  return context.normalizeAiSuggestion_(
    {
      documentDate: "2026-04-10",
      issuer: "三郷市立桜小学校",
      documentType: "お知らせ",
      subject: "4月の行事予定",
      summary: "",
      confidence: 1,
      ...payload,
    },
    FILE_META,
    config,
    text,
  );
}

describe("normalizeAiSuggestion_ guardrails", () => {
  test("rejects an invented year and falls back to the Drive created date", () => {
    // Real regression: a newsletter that prints only "10月16日発行" was filed as
    // 2020 because a year was invented for it.
    const monthDayOnly = "三郷市立桜小学校 3年1組 学級通信 No.23 10月16日発行 ＜今週の予定＞";
    const s = normalize({ documentDate: "2020-10-16" }, BASE_CONFIG, monthDayOnly);

    expect(s.documentDate).toBe("2026-04-12");
    expect(s.confidence).toBeLessThan(BASE_CONFIG.minConfidence);
    expect(s.reviewReasons).toEqual([expect.stringContaining("2020")]);
  });

  test("keeps a document date whose year is printed", () => {
    const withYear = "令和8年4月10日 保護者各位 三郷市立桜小学校 4月の行事予定";
    const s = normalize({ documentDate: "2026-04-10" }, BASE_CONFIG, withYear);

    expect(s.documentDate).toBe("2026-04-10");
    expect(s.reviewReasons).toEqual([]);
  });

  test("keeps a document date printed as a Western year", () => {
    const western = "2026年4月10日 保護者各位 三郷市立桜小学校 4月の行事予定";
    const s = normalize({ documentDate: "2026-04-10" }, BASE_CONFIG, western);

    expect(s.documentDate).toBe("2026-04-10");
    expect(s.reviewReasons).toEqual([]);
  });

  test("keeps confidence when every field is grounded", () => {
    const s = normalize({});
    expect(s.confidence).toBe(1);
    expect(s.reviewReasons.length).toBe(0);
  });

  test("maps a short issuer to the unique known issuer ending with it", () => {
    expect(normalize({ issuer: "桜小学校" }).issuer).toBe("三郷市立桜小学校");
  });

  test("does not prefix-match into a different organization", () => {
    const s = normalize({ issuer: "埼玉県" }, BASE_CONFIG, "埼玉県 体力テスト");
    expect(s.issuer).toBe("埼玉県");
  });

  test("caps confidence when documentType is outside the allowed list", () => {
    const s = normalize({ documentType: "学校案内" });
    expect(s.documentType).toBe("");
    expect(s.confidence).toBeLessThan(BASE_CONFIG.minConfidence);
  });

  test("caps confidence when the date falls back to Drive created date", () => {
    const s = normalize({ documentDate: null });
    expect(s.documentDate).toBe("2026-04-12");
    expect(s.confidence).toBeLessThan(BASE_CONFIG.minConfidence);
  });

  test("caps confidence when the issuer is not in OCR text or known issuers", () => {
    const s = normalize({ issuer: "架空商事株式会社" });
    expect(s.confidence).toBeLessThan(BASE_CONFIG.minConfidence);
    expect(s.reviewReasons.join(" ")).toContain("架空商事株式会社");
  });
});
