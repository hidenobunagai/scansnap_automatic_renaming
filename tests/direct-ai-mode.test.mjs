import { describe, expect, it } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("direct_ai PDF input mode", () => {
  it("calls Gemini with inlineData base64 PDF in direct_ai mode", () => {
    let capturedUrl = "";
    let capturedPayload = null;

    const urlFetchMock = {
      fetch(url, options) {
        capturedUrl = url;
        capturedPayload = JSON.parse(options.payload);
        return {
          getResponseCode() {
            return 200;
          },
          getContentText() {
            return JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          documentDate: "2026-08-20",
                          issuer: "テスト小学校",
                          documentType: "おたより",
                          subject: "運動会案内",
                          summary: "運動会のお知らせです",
                          confidence: 0.95,
                        }),
                      },
                    ],
                  },
                },
              ],
            });
          },
        };
      },
    };

    const dummyBlob = {
      getBytes() {
        return [1, 2, 3];
      },
      getContentType() {
        return "application/pdf";
      },
    };

    const driveAppMock = {
      getFileById(id) {
        return {
          getId() {
            return id;
          },
          getName() {
            return "20260820_scan.pdf";
          },
          getBlob() {
            return dummyBlob;
          },
        };
      },
    };

    const context = createAppsScriptContext({
      files: [
        "src/logger.js",
        "src/utils.js",
        "src/config.js",
        "src/drive-compat.js",
        "src/filename.js",
        "src/ai.js",
        "src/main.js",
      ],
      globals: {
        UrlFetchApp: urlFetchMock,
        DriveApp: driveAppMock,
        Utilities: {
          base64Encode(bytes) {
            return "AQID";
          },
          formatDate(d, tz, fmt) {
            return "2026-08-20";
          },
          formatString(fmt, ...args) {
            return "2026-08-20";
          },
          getUuid() {
            return "test-uuid";
          },
        },
      },
    });

    const config = {
      aiProvider: "gemini",
      aiModel: "gemini-2.5-flash-lite",
      geminiApiKey: "test-gemini-key",
      pdfInputMode: "direct_ai",
      maxPromptChars: 12000,
      maxSubjectLength: 40,
      maxIssuerLength: 30,
      maxDocumentTypeLength: 30,
      minConfidence: 0.75,
      timezone: "Asia/Tokyo",
      filenamePatternHint: "YYYY-MM-DD_発行元_書類種別_要点",
    };

    const fileMeta = {
      id: "file-123",
      name: "scan.pdf",
      createdAt: new Date("2026-08-20T00:00:00Z"),
    };

    const suggestion = context.requestRenameSuggestionDirect_(dummyBlob, fileMeta, config);

    expect(suggestion.documentDate).toBe("2026-08-20");
    expect(suggestion.issuer).toBe("テスト小学校");
    expect(suggestion.documentType).toBe("おたより");
    expect(suggestion.confidence).toBe(0.95);

    expect(capturedUrl).toContain("gemini-2.5-flash-lite:generateContent");
    const contents = capturedPayload.contents[0].parts;
    expect(contents).toHaveLength(2);
    expect(contents[0].inlineData).toBeDefined();
    expect(contents[0].inlineData.mimeType).toBe("application/pdf");
    expect(contents[0].inlineData.data).toBe("AQID");
  });
});
