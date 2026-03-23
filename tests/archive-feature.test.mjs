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
        return {
          documentDate: "2026-03-01",
          issuer: "市役所",
          documentType: "税通知",
          subject: "令和8年度",
          summary: "税通知のテスト",
          confidence: 0.96,
        };
      },
      buildSuggestedFileName_() {
        return "2026-03-01_市役所_税通知_令和8年度.pdf";
      },
      ensureUniqueFileName_(folderId, proposedName) {
        return proposedName;
      },
      buildArchiveRelativePath_() {
        return "税通知/市役所";
      },
      ensureArchiveFolderByPath_(rootFolderId, relativePath) {
        return {
          id: `folder:${rootFolderId}:${relativePath}`,
          path: relativePath,
        };
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
    ).toBe("税-通知/渋谷区役所");
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
    ).toBe("未分類/発行元不明");
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
    expect(result.archiveRelativePath).toBe("税通知/市役所");
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
    );

    expect(result.status).toBe("skipped");
    expect(result.archiveFinalName).toBe("already-good.pdf");
    expect(result.archiveFileId).toBe("copied:file-1");
    expect(copied).toEqual([
      {
        fileId: "file-1",
        folderId: "folder:archive-root:税通知/市役所",
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
