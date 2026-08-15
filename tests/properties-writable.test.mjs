import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

function createPropertiesServiceMock(initialStore) {
  const store = { ...initialStore };

  return {
    getScriptProperties() {
      return {
        getProperties() {
          return { ...store };
        },
        getProperty(key) {
          return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
        },
        setProperty(key, value) {
          store[key] = String(value);
        },
        deleteProperty(key) {
          delete store[key];
        },
      };
    },
  };
}

const BASE_PROPERTIES = {
  SCANSNAP_FOLDER_ID: "folder-123",
  ARCHIVE_ROOT_FOLDER_ID: "archive-456",
  AI_PROVIDER: "gemini",
  GEMINI_API_KEY: "test-key",
};

describe("applyScanRenameScriptProperties_", () => {
  test("persists USER_WEAK_ISSUER_LABELS even though it is not a required property", () => {
    const propertiesService = createPropertiesServiceMock(BASE_PROPERTIES);
    const context = createAppsScriptContext({
      files: ["src/logger.js", "src/utils.js", "src/config.js", "src/main.js"],
      globals: {
        PropertiesService: propertiesService,
      },
    });

    const summary = context.applyScanRenameScriptProperties({
      properties: {
        USER_WEAK_ISSUER_LABELS: "お知らせ,アンケート",
      },
      installTrigger: false,
    });

    expect(summary.changedKeys).toContain("USER_WEAK_ISSUER_LABELS");
    expect(propertiesService.getScriptProperties().getProperty("USER_WEAK_ISSUER_LABELS")).toBe(
      "お知らせ,アンケート",
    );
  });

  test("persists optional tuning keys sent by remote setup", () => {
    const propertiesService = createPropertiesServiceMock(BASE_PROPERTIES);
    const context = createAppsScriptContext({
      files: ["src/logger.js", "src/utils.js", "src/config.js", "src/main.js"],
      globals: {
        PropertiesService: propertiesService,
      },
    });

    context.applyScanRenameScriptProperties({
      properties: {
        LOG_SHEET_NAME: "custom_log",
        MAX_PROMPT_CHARS: "20000",
        MAX_ISSUER_LENGTH: "40",
        OPENAI_BASE_URL: "https://example.com/v1/chat/completions",
      },
      installTrigger: false,
    });

    const props = propertiesService.getScriptProperties().getProperties();

    expect(props.LOG_SHEET_NAME).toBe("custom_log");
    expect(props.MAX_PROMPT_CHARS).toBe("20000");
    expect(props.MAX_ISSUER_LENGTH).toBe("40");
    expect(props.OPENAI_BASE_URL).toBe("https://example.com/v1/chat/completions");
  });

  test("clears a property when an empty value is sent", () => {
    const propertiesService = createPropertiesServiceMock({
      ...BASE_PROPERTIES,
      USER_WEAK_ISSUER_LABELS: "お知らせ",
    });
    const context = createAppsScriptContext({
      files: ["src/logger.js", "src/utils.js", "src/config.js", "src/main.js"],
      globals: {
        PropertiesService: propertiesService,
      },
    });

    const summary = context.applyScanRenameScriptProperties({
      properties: {
        USER_WEAK_ISSUER_LABELS: "",
      },
      installTrigger: false,
    });

    expect(summary.clearedKeys).toContain("USER_WEAK_ISSUER_LABELS");
    expect(
      propertiesService.getScriptProperties().getProperty("USER_WEAK_ISSUER_LABELS"),
    ).toBeNull();
  });
});

describe("getScriptPropertiesTemplate", () => {
  test("includes every writable and tuning key", () => {
    const context = createAppsScriptContext({
      files: ["src/config.js", "src/main.js"],
    });

    const template = context.getScriptPropertiesTemplate();

    expect(template).toContain("USER_WEAK_ISSUER_LABELS=");
    expect(template).toContain("OPENAI_BASE_URL=");
    expect(template).toContain("LOG_SHEET_NAME=");
    expect(template).toContain("MAX_PROMPT_CHARS=");
    expect(template).toContain("MAX_SUBJECT_LENGTH=");
    expect(template).toContain("MAX_ISSUER_LENGTH=");
    expect(template).toContain("MAX_DOCUMENT_TYPE_LENGTH=");
  });
});
