import { describe, expect, it } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("Webhook notification", () => {
  it("sends webhook notification on failures when notificationWebhookUrl is configured", () => {
    let capturedUrl = "";
    let capturedOptions = null;

    const urlFetchMock = {
      fetch(url, options) {
        capturedUrl = url;
        capturedOptions = options;
        return {
          getResponseCode() {
            return 200;
          },
          getContentText() {
            return "ok";
          },
        };
      },
    };

    const context = createAppsScriptContext({
      files: ["src/logger.js", "src/utils.js", "src/config.js", "src/main.js"],
      globals: {
        UrlFetchApp: urlFetchMock,
      },
    });

    const summary = {
      processed: 2,
      counts: {
        error: 1,
        copy_failed: 0,
        renamed: 1,
      },
      logSpreadsheetId: "sheet-123",
    };

    const config = {
      notificationEmail: "",
      notificationWebhookUrl: "https://hooks.slack.com/services/test/webhook",
    };

    context.maybeSendFailureNotification_(summary, config);

    expect(capturedUrl).toBe("https://hooks.slack.com/services/test/webhook");
    expect(capturedOptions.method).toBe("post");
    expect(capturedOptions.contentType).toBe("application/json");

    const payload = JSON.parse(capturedOptions.payload);
    expect(payload.text).toContain("[ScanSnap] 1件の処理失敗");
  });

  it("does not send webhook when there are 0 failures", () => {
    let called = false;
    const urlFetchMock = {
      fetch() {
        called = true;
      },
    };

    const context = createAppsScriptContext({
      files: ["src/logger.js", "src/utils.js", "src/config.js", "src/main.js"],
      globals: {
        UrlFetchApp: urlFetchMock,
      },
    });

    const summary = {
      processed: 2,
      counts: {
        error: 0,
        copy_failed: 0,
        renamed: 2,
      },
    };

    const config = {
      notificationWebhookUrl: "https://example.com/webhook",
    };

    context.maybeSendFailureNotification_(summary, config);

    expect(called).toBe(false);
  });
});
