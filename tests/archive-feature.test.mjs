import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

function createProcessContext(overrides = {}) {
  const copied = [];
  const renamed = [];

  const context = createAppsScriptContext({
    files: ["src/utils.js", "src/log-sheet.js", "src/main.js"],
    globals: {
      extractTextFromPdf_() {
        return "これは十分なOCRテキストです。テスト用の文字列を足して二十文字以上にします。";
      },
      requestRenameSuggestion_() {
        return createSuggestion();
      },
      buildSuggestedFileName_() {
        return "2026-03-01_市役所_税通知_令和8年度.pdf";
      },
      ensureUniqueFileName_(folderId, proposedName) {
        return proposedName;
      },
      buildArchiveRelativePath_() {
        return "市役所/税通知";
      },
      ensureArchiveFolderByPath_(rootFolderId, relativePath) {
        return {
          id: `folder:${rootFolderId}:${relativePath}`,
          path: relativePath,
        };
      },
      findDriveFileByNameInFolder_() {
        return null;
      },
      ensureUniqueFileNameInFolder_(folderId, fileName) {
        return fileName;
      },
      copyDriveFileToFolder_(fileId, folderId, fileName) {
        copied.push({ fileId, folderId, fileName });
        return {
          id: `copied:${fileId}`,
          title: fileName,
        };
      },
      renameDriveFile_(fileId, newTitle) {
        renamed.push({ fileId, newTitle });
      },
      logError_() {},
      ...overrides,
    },
  });

  return {
    context,
    copied,
    renamed,
  };
}

function createConfig(renameMode) {
  return {
    renameMode,
    minConfidence: 0.75,
    archiveRootFolderId: "archive-root",
  };
}

function createSuggestion(overrides = {}) {
  return {
    documentDate: "2026-03-01",
    issuer: "市役所",
    documentType: "税通知",
    subject: "令和8年度",
    summary: "税通知のテスト",
    confidence: 0.96,
    ...overrides,
  };
}

function createFileMeta(name = "scan.pdf") {
  return {
    id: "file-1",
    name,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    modifiedAt: new Date("2026-03-01T00:00:00Z"),
  };
}

function createLogSheet(entries) {
  return {
    appendRow(row) {
      entries.push(row);
    },
  };
}

describe("buildArchiveRelativePath_", () => {
  test("uses document type and issuer folders", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/archive.js"],
    });

    expect(typeof context.buildArchiveRelativePath_).toBe("function");
    expect(
      context.buildArchiveRelativePath_(
        {
          documentType: "税 通知",
          issuer: "渋谷区役所",
        },
        {
          maxDocumentTypeLength: 30,
          maxIssuerLength: 30,
        },
      ),
    ).toBe("渋谷区役所/税-通知");
  });

  test("falls back when document type and issuer are missing", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/archive.js"],
    });

    expect(
      context.buildArchiveRelativePath_(
        {
          documentType: "",
          issuer: "",
        },
        {
          maxDocumentTypeLength: 30,
          maxIssuerLength: 30,
        },
      ),
    ).toBe("発行元不明/未分類");
  });

  test("uses normalized issuer in suggested file name and archive path", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/ai.js", "src/filename.js", "src/archive.js"],
    });

    const suggestion = context.normalizeAiSuggestion_(
      {
        issuer: "パークホームズＬａＬａ新三郷管理組合",
        documentType: "請求書",
        subject: "4月分",
        documentDate: "2026-04-10",
        summary: "4月分の請求書",
        confidence: 0.96,
      },
      { name: "scan.pdf", createdAt: new Date("2026-04-10T00:00:00Z") },
      {
        timezone: "Asia/Tokyo",
        maxIssuerLength: 50,
        maxDocumentTypeLength: 30,
        maxSubjectLength: 50,
      },
    );

    expect(suggestion.issuer).toBe("パークホームズLaLa新三郷管理組合");

    expect(
      context.buildSuggestedFileName_(
        suggestion,
        { name: "scan.pdf", createdAt: new Date("2026-04-10T00:00:00Z") },
        {
          timezone: "Asia/Tokyo",
          maxIssuerLength: 50,
          maxDocumentTypeLength: 30,
          maxSubjectLength: 50,
        },
      ),
    ).toContain("パークホームズLaLa新三郷管理組合");

    expect(
      context.buildArchiveRelativePath_(
        suggestion,
        {
          maxIssuerLength: 50,
          maxDocumentTypeLength: 30,
        },
      ),
    ).toBe("パークホームズLaLa新三郷管理組合/請求書");
  });
});

describe("processSinglePdfFile_", () => {
  test("records archive path in review mode without copying", () => {
    const entries = [];
    const { context, copied, renamed } = createProcessContext();

    const result = context.processSinglePdfFile_(
      createFileMeta(),
      createConfig("review"),
      createLogSheet(entries),
    );

    expect(result.status).toBe("review_needed");
    expect(result.archiveRelativePath).toBe("市役所/税通知");
    expect(result.archiveFileId).toBe("");
    expect(copied).toHaveLength(0);
    expect(renamed).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });

  test("keeps low-confidence same-name files in review_needed instead of looping skipped", () => {
    const entries = [];
    const { context, copied, renamed } = createProcessContext({
      requestRenameSuggestion_() {
        return createSuggestion({ confidence: 0.2 });
      },
      buildSuggestedFileName_() {
        return "already-good.pdf";
      },
    });

    const result = context.processSinglePdfFile_(
      createFileMeta("already-good.pdf"),
      createConfig("rename"),
      createLogSheet(entries),
      null,
    );

    expect(result.status).toBe("review_needed");
    expect(result.errorMessage).toBe("Confidence 0.2 is below MIN_CONFIDENCE 0.75.");
    expect(result.archiveFileId).toBe("");
    expect(copied).toHaveLength(0);
    expect(renamed).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });

  test("copies to archive in rename mode even when the filename already matches", () => {
    const entries = [];
    const { context, copied, renamed } = createProcessContext({
      buildSuggestedFileName_() {
        return "already-good.pdf";
      },
    });

    const result = context.processSinglePdfFile_(
      createFileMeta("already-good.pdf"),
      createConfig("rename"),
      createLogSheet(entries),
      null,
    );

    expect(result.status).toBe("skipped");
    expect(result.archiveFinalName).toBe("already-good.pdf");
    expect(result.archiveFileId).toBe("copied:file-1");
    expect(copied).toEqual([
      {
        fileId: "file-1",
        folderId: "folder:archive-root:市役所/税通知",
        fileName: "already-good.pdf",
      },
    ]);
    expect(renamed).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });

  test("returns copy_failed when archive copy raises after rename", () => {
    const entries = [];
    const { context, renamed } = createProcessContext({
      copyDriveFileToFolder_() {
        throw new Error("Archive folder is unavailable.");
      },
    });

    const result = context.processSinglePdfFile_(
      createFileMeta("scan.pdf"),
      createConfig("rename"),
      createLogSheet(entries),
      null,
    );

    expect(result.status).toBe("copy_failed");
    expect(result.finalName).toBe("2026-03-01_市役所_税通知_令和8年度.pdf");
    expect(result.errorMessage).toBe("Archive folder is unavailable.");
    expect(renamed).toEqual([
      {
        fileId: "file-1",
        newTitle: "2026-03-01_市役所_税通知_令和8年度.pdf",
      },
    ]);
    expect(entries).toHaveLength(1);
  });

  test("retries copy_failed using saved archive state without rerunning OCR or AI", () => {
    const entries = [];
    const { context, copied, renamed } = createProcessContext({
      extractTextFromPdf_() {
        throw new Error("OCR should not run for archive retry.");
      },
      requestRenameSuggestion_() {
        throw new Error("AI should not run for archive retry.");
      },
    });

    const result = context.processSinglePdfFile_(
      createFileMeta("already-good.pdf"),
      createConfig("rename"),
      createLogSheet(entries),
      {
        processed: false,
        lastEntry: {
          status: "copy_failed",
          suggestedName: "already-good.pdf",
          finalName: "",
          confidence: 0.96,
          documentDate: "2026-03-01",
          issuer: "市役所",
          documentType: "税通知",
          subject: "令和8年度",
          summary: "税通知のテスト",
          archiveRelativePath: "市役所/税通知",
          archiveFinalName: "already-good.pdf",
          archiveFileId: "",
        },
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.archiveFileId).toBe("copied:file-1");
    expect(copied).toEqual([
      {
        fileId: "file-1",
        folderId: "folder:archive-root:市役所/税通知",
        fileName: "already-good.pdf",
      },
    ]);
    expect(renamed).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });

  test("reuses an existing archive file during copy_failed retry before creating a duplicate", () => {
    const entries = [];
    const { context, copied } = createProcessContext({
      findDriveFileByNameInFolder_() {
        return {
          id: "existing-archive-file",
          title: "already-good.pdf",
        };
      },
      copyDriveFileToFolder_() {
        throw new Error("copyDriveFileToFolder_ should not run when retry finds an existing file.");
      },
    });

    const result = context.processSinglePdfFile_(
      createFileMeta("already-good.pdf"),
      createConfig("rename"),
      createLogSheet(entries),
      {
        processed: false,
        lastEntry: {
          status: "copy_failed",
          suggestedName: "already-good.pdf",
          finalName: "",
          confidence: 0.96,
          documentDate: "2026-03-01",
          issuer: "市役所",
          documentType: "税通知",
          subject: "令和8年度",
          summary: "税通知のテスト",
          archiveRelativePath: "市役所/税通知",
          archiveFinalName: "already-good.pdf",
          archiveFileId: "",
        },
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.archiveFileId).toBe("existing-archive-file");
    expect(result.archiveFinalName).toBe("already-good.pdf");
    expect(copied).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });

  test("does not retry archive copy in review mode even if the last entry was copy_failed", () => {
    const entries = [];
    const { context, copied, renamed } = createProcessContext({
      buildSuggestedFileName_() {
        return "already-good.pdf";
      },
      requestRenameSuggestion_() {
        return createSuggestion({ confidence: 0.2 });
      },
    });

    const result = context.processSinglePdfFile_(
      createFileMeta("already-good.pdf"),
      {
        renameMode: "review",
        minConfidence: 0.75,
        archiveRootFolderId: "",
      },
      createLogSheet(entries),
      {
        processed: false,
        lastEntry: {
          status: "copy_failed",
          suggestedName: "already-good.pdf",
          finalName: "",
          confidence: 0.96,
          documentDate: "2026-03-01",
          issuer: "市役所",
          documentType: "税通知",
          subject: "令和8年度",
          summary: "税通知のテスト",
          archiveRelativePath: "市役所/税通知",
          archiveFinalName: "already-good.pdf",
          archiveFileId: "",
        },
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.archiveFileId).toBe("");
    expect(result.errorMessage).toBe("Suggested filename matched the current filename.");
    expect(copied).toHaveLength(0);
    expect(renamed).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });
});

describe("shouldTreatLogRowAsProcessed_", () => {
  test("keeps copy_failed rows retryable", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/log-sheet.js"],
    });

    expect(context.shouldTreatLogRowAsProcessed_("copy_failed", "Archive folder is unavailable.", "rename")).toBe(
      false,
    );
  });

  test("reprocesses legacy renamed rows that do not have an archive file id yet", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/log-sheet.js"],
    });

    expect(context.shouldTreatLogRowAsProcessed_("renamed", "", "rename", "")).toBe(false);
    expect(context.shouldTreatLogRowAsProcessed_("skipped", "", "rename", "")).toBe(false);
  });
});

describe("getFileStateMap_", () => {
  test("keeps legacy review rows retryable after archive columns are added", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/log-sheet.js"],
    });

    const fileStateMap = context.getFileStateMap_(
      {
        getLastRow() {
          return 2;
        },
        getRange() {
          return {
            getValues() {
              return [[
                "2026-03-01T00:00:00.000Z",
                "file-1",
                "review_needed",
                "scan.pdf",
                "2026-03-01_市役所_税通知_令和8年度.pdf",
                "",
                0.96,
                "2026-03-01",
                "市役所",
                "税通知",
                "令和8年度",
                "税通知のテスト",
                "Review mode is enabled.",
              ]];
            },
          };
        },
      },
      "rename",
    );

    expect(fileStateMap["file-1"].processed).toBe(false);
    expect(fileStateMap["file-1"].lastEntry.errorMessage).toBe("Review mode is enabled.");
  });

  test("parses rows written with the temporary broken archive column order", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/log-sheet.js"],
    });

    const fileStateMap = context.getFileStateMap_(
      {
        getLastRow() {
          return 2;
        },
        getRange() {
          return {
            getValues() {
              return [[
                "2026-03-01T00:00:00.000Z",
                "file-1",
                "copy_failed",
                "scan.pdf",
                "2026-03-01_市役所_税通知_令和8年度.pdf",
                "2026-03-01_市役所_税通知_令和8年度.pdf",
                0.96,
                "2026-03-01",
                "市役所",
                "税通知",
                "令和8年度",
                "税通知のテスト",
                "市役所/税通知",
                "2026-03-01_市役所_税通知_令和8年度.pdf",
                "",
                "Archive folder is unavailable.",
              ]];
            },
          };
        },
      },
      "rename",
    );

    expect(fileStateMap["file-1"].processed).toBe(false);
    expect(fileStateMap["file-1"].lastEntry.archiveRelativePath).toBe("市役所/税通知");
    expect(fileStateMap["file-1"].lastEntry.archiveFinalName).toBe(
      "2026-03-01_市役所_税通知_令和8年度.pdf",
    );
    expect(fileStateMap["file-1"].lastEntry.errorMessage).toBe("Archive folder is unavailable.");
  });
});

describe("validateRunConfig_", () => {
  test("allows review mode without archive root folder", () => {
    const context = createAppsScriptContext({
      files: ["src/main.js"],
    });

    expect(function() {
      context.validateRunConfig_({ renameMode: "review", archiveRootFolderId: "" });
    }).not.toThrow();
  });

  test("requires archive root folder in rename mode", () => {
    const context = createAppsScriptContext({
      files: ["src/main.js"],
    });

    expect(function() {
      context.validateRunConfig_({ renameMode: "rename", archiveRootFolderId: "" });
    }).toThrow("ARCHIVE_ROOT_FOLDER_ID is required when RENAME_MODE=rename.");
  });
});
