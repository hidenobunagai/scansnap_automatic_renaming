import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

function createMigrationContext(overrides = {}) {
  const archivedFiles = [];
  const deletedFolders = [];
  const updatedProperties = {};
  const deletedProperties = [];

  const rootFolderId = "archive-root";

  const LOG_HEADERS = [
    "processedAt", "fileId", "status", "originalName", "suggestedName", "finalName",
    "confidence", "documentDate", "issuer", "documentType", "subject", "summary",
    "errorMessage", "archiveRelativePath", "archiveFinalName", "archiveFileId",
  ];

  const scriptProperties = {
    getProperties() {
      return {
        ARCHIVE_ROOT_FOLDER_ID: rootFolderId,
        SCANSNAP_FOLDER_ID: "scansnap-folders-id",
        GEMINI_API_KEY: "test-key",
        LOG_SPREADSHEET_ID: "log-spreadsheet-id",
        ...overrides.scriptProperties,
      };
    },
    getProperty(key) {
      if (key === "ARCHIVE_ROOT_FOLDER_ID") return rootFolderId;
      if (key === "lastMigratedDocumentType") return overrides.lastMigratedDocumentType || null;
      if (key === "LOG_SPREADSHEET_ID") return "log-spreadsheet-id";
      return overrides.scriptProperties?.[key] || null;
    },
    setProperty(key, value) {
      updatedProperties[key] = value;
    },
    deleteProperty(key) {
      deletedProperties.push(key);
    },
  };

  const context = createAppsScriptContext({
    files: ["src/utils.js", "src/archive.js", "src/config.js", "src/log-sheet.js", "src/main.js", "src/drive.js", "src/logger.js"],
    globals: {
      PropertiesService: {
        getScriptProperties() {
          return scriptProperties;
        },
      },
      getScriptProperties_() {
        return scriptProperties;
      },
        Drive: {
          Files: {
            list(params) {
              const query = params.q;
              if (query.indexOf("mimeType = 'application/vnd.google-apps.folder'") !== -1) {
                return overrides.listFolders ? overrides.listFolders(params, query) : { items: [] };
              }
              return overrides.listFiles ? overrides.listFiles(params, query) : { items: [] };
            },
          patch(patchData, fileId, params) {
            archivedFiles.push({ patchData, fileId, params });
            return { id: fileId, title: patchData.title || "" };
          },
          remove(fileId, params) {
            deletedFolders.push(fileId);
          },
        },
      },
      SpreadsheetApp: {
        openById(id) {
          return {
            getId() { return id; },
            getSheetByName() {
              return overrides.logSheet || {
                getLastRow() { return 1; },
                getRange() {
                  return {
                    getValues() {
                      return [LOG_HEADERS];
                    },
                    setValues() {},
                  };
                },
                setFrozenRows() {},
                autoResizeColumns() {},
              };
            },
          };
        },
        create(name) {
          return {
            getId() { return "new-spreadsheet-id"; },
            getSheets() {
              return [{ setName() { return this; } }];
            },
          };
        },
      },
      ...overrides.globals,
    },
  });

  return {
    context,
    archivedFiles,
    deletedFolders,
    updatedProperties,
    deletedProperties,
    rootFolderId,
  };
}

function createFolderItem(id, title, parentId) {
  return { id, title, parents: [{ id: parentId }], mimeType: "application/vnd.google-apps.folder" };
}

function createFileItem(id, title, parentId) {
  return { id, title, parents: [{ id: parentId }], mimeType: "application/pdf" };
}

describe("reverseArchivePathSegments_", () => {
  test("reverses a two-segment path", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/archive.js"],
    });

    expect(context.reverseArchivePathSegments_("領収書/東京電力")).toBe("東京電力/領収書");
  });

  test("returns the path unchanged when it has no slash", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/archive.js"],
    });

    expect(context.reverseArchivePathSegments_("領収書")).toBe("領収書");
  });

  test("returns empty string for empty input", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/archive.js"],
    });

    expect(context.reverseArchivePathSegments_("")).toBe("");
  });

  test("only reverses the first two segments for deeper paths", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/archive.js"],
    });

    expect(context.reverseArchivePathSegments_("A/B/C")).toBe("B/A/C");
  });
});

describe("listDirectChildFolders_", () => {
  test("returns folders sorted by title ascending", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/archive.js"],
      globals: {
        Drive: {
          Files: {
            list() {
              return {
                items: [
                  createFolderItem("folder-c", "C", "parent-folder"),
                  createFolderItem("folder-a", "A", "parent-folder"),
                  createFolderItem("folder-b", "B", "parent-folder"),
                ],
              };
            },
          },
        },
      },
    });

    const folders = context.listDirectChildFolders_("parent-folder");

    expect(folders.map(function(folder) {
      return folder.title;
    })).toEqual(["A", "B", "C"]);
  });
});

describe("listFilesInFolder_", () => {
  test("excludes folders from results", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/archive.js"],
      globals: {
        Drive: {
          Files: {
            list(params) {
              const allItems = [
                createFileItem("file-1", "document.pdf", "parent-folder"),
                createFolderItem("folder-1", "nested-folder", "parent-folder"),
              ];

              if (params.q.indexOf("mimeType != 'application/vnd.google-apps.folder'") !== -1) {
                return { items: [allItems[0]] };
              }

              return { items: allItems };
            },
          },
        },
      },
    });

    const files = context.listFilesInFolder_("parent-folder");

    expect(files).toEqual([{ id: "file-1", title: "document.pdf" }]);
  });
});

describe("migrateArchiveFolderStructure", () => {
  test("moves files from old structure to new structure and cleans up", () => {
    const invoiceFolderId = "folder-invoice";
    const receiptFolderId = "folder-receipt";
    const tokyoFolderId = "folder-tokyo-power";
    const cityFolderId = "folder-city-hall";

    const { context } = createMigrationContext({
      listFolders(params, query) {
        if (query.indexOf("application/vnd.google-apps.folder") !== -1) {
          if (query.indexOf("archive-root") !== -1) {
            if (query.indexOf(invoiceFolderId) === -1 && query.indexOf(receiptFolderId) === -1 && query.indexOf(tokyoFolderId) === -1 && query.indexOf(cityFolderId) === -1) {
              return {
                items: [
                  createFolderItem(invoiceFolderId, "明細書", "archive-root"),
                  createFolderItem(receiptFolderId, "領収書", "archive-root"),
                ],
              };
            }
          }
          if (query.indexOf(invoiceFolderId) !== -1) {
            return { items: [createFolderItem(cityFolderId, "市役所", invoiceFolderId)] };
          }
          if (query.indexOf(receiptFolderId) !== -1) {
            return { items: [createFolderItem(tokyoFolderId, "東京電力", receiptFolderId)] };
          }
        }
        return { items: [] };
      },
      listFiles(params, query) {
        if (query.indexOf(tokyoFolderId) !== -1) {
          return {
            items: [createFileItem("file-tokyo-receipt", "2026-03-01_東京電力_領収書_1月.pdf", tokyoFolderId)],
          };
        }
        if (query.indexOf(cityFolderId) !== -1) {
          return {
            items: [createFileItem("file-city-invoice", "2026-03-01_市役所_明細書_2月.pdf", cityFolderId)],
          };
        }
        return { items: [] };
      },
      globals: {
        findOrCreateChildFolder_(parentId, name) {
          return { id: `new-${parentId}-${name}`, title: name };
        },
        ensureArchiveFolderByPath_(rootId, path) {
          const segments = path.split("/");
          let currentId = rootId;
          for (const segment of segments) {
            currentId = `new-${currentId}-${segment}`;
          }
          return { id: currentId, title: segments[segments.length - 1], path };
        },
        findChildFolder_(parentId, name) {
          return null;
        },
        logInfo_() {},
        logError_() {},
      },
    });

    const result = context.migrateArchiveFolderStructure();

    expect(result.movedFiles).toBe(2);
    expect(result.failedFiles).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test("skips folders alphabetically before lastMigratedDocumentType for resume", () => {
    const { context } = createMigrationContext({
      lastMigratedDocumentType: "B",
      listFolders(params, query) {
        if (query.indexOf("archive-root") !== -1 && query.indexOf("application/vnd.google-apps.folder") !== -1) {
          if (query.indexOf("folder-") === -1) {
            return {
              items: [
                createFolderItem("folder-a", "A", "archive-root"),
                createFolderItem("folder-b", "B", "archive-root"),
                createFolderItem("folder-c", "C", "archive-root"),
              ],
            };
          }
        }
        return { items: [] };
      },
      globals: {
        findOrCreateChildFolder_() { return { id: "new-folder", title: "test" }; },
        ensureArchiveFolderByPath_() { return { id: "new-folder", title: "test", path: "test" }; },
        logInfo_() {},
        logError_() {},
      },
    });

    const result = context.migrateArchiveFolderStructure();

    expect(result.skippedFolders).toBe(2);
  });
});
