import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

function createContext() {
  return createAppsScriptContext({ files: ["src/utils.js"] });
}

describe("isYearGroundedInText_", () => {
  const context = createContext();

  test("accepts a Western year printed in the document", () => {
    expect(context.isYearGroundedInText_(2026, "2026年4月10日 保護者各位")).toBe(true);
    expect(context.isYearGroundedInText_(2025, "発行日 2025-10-16")).toBe(true);
  });

  test("accepts the year printed in full-width digits", () => {
    expect(context.isYearGroundedInText_(2026, "２０２６年４月１０日 お知らせ")).toBe(true);
  });

  test("accepts a Japanese era year", () => {
    expect(context.isYearGroundedInText_(2025, "令和7年10月16日 学級通信")).toBe(true);
    expect(context.isYearGroundedInText_(2026, "令和8年度 学校要覧")).toBe(true);
    expect(context.isYearGroundedInText_(2020, "令和2年4月 保育料決定通知書")).toBe(true);
  });

  test("accepts 元年 as the first year of an era", () => {
    expect(context.isYearGroundedInText_(2019, "令和元年5月1日")).toBe(true);
    expect(context.isYearGroundedInText_(1989, "平成元年4月")).toBe(true);
  });

  test("does not confuse an era year with a different Western year", () => {
    // 令和7年 is 2025, so 2020 must not be treated as grounded.
    expect(context.isYearGroundedInText_(2020, "令和7年10月16日 学級通信")).toBe(false);
  });

  test("rejects a year that is not printed anywhere", () => {
    // This is the real regression: a newsletter printing only "10月16日発行"
    // had a year invented for it and was filed as 2020 instead of 2025.
    const monthDayOnly = "三郷市立桜小学校 3年1組 学級通信 No.23 10月16日発行 ＜今週の予定＞";
    expect(context.isYearGroundedInText_(2020, monthDayOnly)).toBe(false);
    expect(context.isYearGroundedInText_(2025, monthDayOnly)).toBe(false);
  });

  test("rejects when there is no text at all", () => {
    expect(context.isYearGroundedInText_(2026, "")).toBe(false);
    expect(context.isYearGroundedInText_(2026, null)).toBe(false);
    expect(context.isYearGroundedInText_(2026, "   ")).toBe(false);
  });

  test("ignores an era year outside that era's range", () => {
    // 昭和64年 is 1989, not 2025:昭和 starts at 1926 so year 64 would be 1989.
    expect(context.isYearGroundedInText_(2025, "昭和64年1月7日")).toBe(false);
  });
});
