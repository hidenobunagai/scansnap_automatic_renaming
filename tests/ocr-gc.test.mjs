import { describe, expect, it } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

function createDriveMock(store) {
  return {
    Files: {
      list(params) {
        const query = params.q || "";
        const trashed = query.includes("trashed = false");
        let matched = store.filter((f) => (trashed ? !f.trashed : true));

        if (query.includes("mimeType = 'application/vnd.google-apps.document'")) {
          matched = matched.filter((f) => f.mimeType === "application/vnd.google-apps.document");
        }

        if (query.includes("title contains 'ocr_'")) {
          matched = matched.filter((f) => (f.title || "").includes("ocr_"));
        }

        return {
          items: matched,
          files: matched,
        };
      },
      trash(fileId) {
        const file = store.find((f) => f.id === fileId);
        if (file) {
          file.trashed = true;
          return file;
        }
        throw new Error(`File not found: ${fileId}`);
      },
      remove(fileId) {
        const index = store.findIndex((f) => f.id === fileId);
        if (index !== -1) {
          store.splice(index, 1);
          return;
        }
        throw new Error(`File not found: ${fileId}`);
      },
    },
  };
}

describe("cleanupOcrTempDocuments_", () => {
  it("trashes stale OCR temp documents older than threshold", () => {
    const now = Date.now();
    const staleDate = new Date(now - 70 * 60 * 1000).toISOString(); // 70 min ago
    const freshDate = new Date(now - 10 * 60 * 1000).toISOString(); // 10 min ago

    const mockFiles = [
      {
        id: "doc-1",
        title: "ocr_00000000-1111",
        mimeType: "application/vnd.google-apps.document",
        createdDate: staleDate,
        trashed: false,
      },
      {
        id: "doc-2",
        title: "ocr_00000000-2222",
        mimeType: "application/vnd.google-apps.document",
        createdDate: freshDate,
        trashed: false,
      },
      {
        id: "doc-3",
        title: "normal_document",
        mimeType: "application/vnd.google-apps.document",
        createdDate: staleDate,
        trashed: false,
      },
    ];

    const driveMock = createDriveMock(mockFiles);
    const context = createAppsScriptContext({
      files: [
        "src/logger.js",
        "src/utils.js",
        "src/config.js",
        "src/drive-compat.js",
        "src/ocr.js",
      ],
      globals: {
        Drive: driveMock,
      },
    });

    const result = context.cleanupOcrTempDocuments_({ olderThanMinutes: 60 });

    expect(result.cleanedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(mockFiles[0].trashed).toBe(true);
    expect(mockFiles[1].trashed).toBe(false);
  });

  it("handles errors gracefully when trashing fails", () => {
    const now = Date.now();
    const staleDate = new Date(now - 120 * 60 * 1000).toISOString();

    const mockFiles = [
      {
        id: "doc-fail",
        title: "ocr_fail_id",
        mimeType: "application/vnd.google-apps.document",
        createdDate: staleDate,
        trashed: false,
      },
    ];

    const driveMock = {
      Files: {
        list() {
          return { items: mockFiles, files: mockFiles };
        },
        trash() {
          throw new Error("Permission denied");
        },
        remove() {
          throw new Error("Permission denied");
        },
      },
    };

    const context = createAppsScriptContext({
      files: [
        "src/logger.js",
        "src/utils.js",
        "src/config.js",
        "src/drive-compat.js",
        "src/ocr.js",
      ],
      globals: {
        Drive: driveMock,
      },
    });

    const result = context.cleanupOcrTempDocuments_({ olderThanMinutes: 60 });

    expect(result.cleanedCount).toBe(0);
    expect(result.failedCount).toBe(1);
  });
});
