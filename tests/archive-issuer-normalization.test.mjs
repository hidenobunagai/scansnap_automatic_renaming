import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

const LOG_HEADERS = [
  "processedAt", "fileId", "status", "originalName", "suggestedName", "finalName",
  "confidence", "documentDate", "issuer", "documentType", "subject", "summary",
  "errorMessage", "archiveRelativePath", "archiveFinalName", "archiveFileId",
];

function createFolderItem(id, title, parentId) {
  return { id, title, parents: [{ id: parentId }], mimeType: "application/vnd.google-apps.folder" };
}

function createFileItem(id, title, parentId) {
  return { id, title, parents: [{ id: parentId }], mimeType: "application/pdf" };
}

function createNormalizationContext(overrides = {}) {
  const patchedFiles = [];
  const movedFiles = [];
  const removedFolders = [];
  const updatedProperties = {};
  const deletedProperties = [];
  const logInfoCalls = [];
  const rootFolderId = "archive-root";

  const scriptProperties = {
    getProperties() {
      return {
        ARCHIVE_ROOT_FOLDER_ID: rootFolderId,
        SCANSNAP_FOLDER_ID: "scansnap-folder-id",
        GEMINI_API_KEY: "test-key",
        LOG_SPREADSHEET_ID: "log-spreadsheet-id",
        ...overrides.scriptProperties,
      };
    },
    getProperty(key) {
      if (key === "ARCHIVE_ROOT_FOLDER_ID") return rootFolderId;
      if (key === "LOG_SPREADSHEET_ID") return "log-spreadsheet-id";
      if (key === "lastNormalizedIssuerFolder") return overrides.lastNormalizedIssuerFolder || null;
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
          get(fileId, params) {
            if (overrides.getFile) {
              return overrides.getFile(fileId, params);
            }
            return { parents: [] };
          },
          patch(patchData, fileId, params) {
            if (params && Object.prototype.hasOwnProperty.call(params, "addParents")) {
              movedFiles.push({ patchData, fileId, params });
            } else {
              patchedFiles.push({ patchData, fileId, params });
            }

            if (overrides.patchFile) {
              return overrides.patchFile(patchData, fileId, params);
            }

            return { id: fileId, title: patchData.title || "" };
          },
          insert(resource, unused, params) {
            if (overrides.insertFolder) {
              return overrides.insertFolder(resource, params);
            }

            return { id: resource.title || "new-folder", title: resource.title || "" };
          },
          remove(fileId, params) {
            removedFolders.push({ fileId, params });

            if (overrides.removeFile) {
              return overrides.removeFile(fileId, params);
            }

            return null;
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
      },
      logInfo_(message, summary) {
        logInfoCalls.push({ message, summary });
        if (overrides.logInfo) {
          return overrides.logInfo(message, summary);
        }
      },
      logError_() {},
      ...overrides.globals,
    },
  });

  return {
    context,
    patchedFiles,
    movedFiles,
    removedFolders,
    updatedProperties,
    deletedProperties,
    logInfoCalls,
    rootFolderId,
  };
}

function createLogSheet(logValues, setValuesCalls) {
  return {
    getLastRow() {
      return logValues.length;
    },
    getRange() {
      return {
        getValues() {
          return logValues.map(function(row) {
            return row.slice();
          });
        },
        setValues(values) {
          setValuesCalls.push(values.map(function(row) {
            return row.slice();
          }));
          logValues.splice(0, logValues.length, ...values.map(function(row) {
            return row.slice();
          }));
        },
      };
    },
    setFrozenRows() {},
    autoResizeColumns() {},
  };
}

describe("normalizeArchiveIssuerNames", () => {
  test("updates archiveFinalName inside updateIssuerFieldsInLogRow_", () => {
    const { context } = createNormalizationContext();
    const row = new Array(LOG_HEADERS.length).fill("");
    row[8] = "パークホームズＬａＬａ新三郷管理組合";
    row[13] = "パークホームズＬａＬａ新三郷管理組合/請求書";
    row[14] = "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf";

    context.updateIssuerFieldsInLogRow_(
      row,
      "パークホームズＬａＬａ新三郷管理組合",
      "パークホームズLaLa新三郷管理組合",
    );

    expect(row[8]).toBe("パークホームズLaLa新三郷管理組合");
    expect(row[13]).toBe("パークホームズLaLa新三郷管理組合/請求書");
    expect(row[14]).toBe("2026-04-10_パークホームズLaLa新三郷管理組合_請求書_4月分.pdf");
  });

  test("renames issuer folder when normalized name has no collision", () => {
    const sourceFolder = createFolderItem("issuer-source", "パークホームズＬａＬａ新三郷管理組合", "archive-root");
    const docTypeFolder = createFolderItem("doc-invoice", "請求書", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf", docTypeFolder.id);

    const { context, patchedFiles } = createNormalizationContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);

        const items = [sourceFolder, docTypeFolder].filter(function(item) {
          return item.parents[0].id === parentId && item.mimeType === "application/vnd.google-apps.folder";
        });

        return {
          items: titleMatch ? items.filter(function(item) { return item.title === titleMatch[1]; }) : items,
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        return {
          items: parentId === docTypeFolder.id ? [file] : [],
        };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      insertFolder(resource) {
        return {
          id: resource.parents[0].id === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder",
          title: resource.title,
        };
      },
      globals: {
        findOrCreateChildFolder_(parentId, name) {
          return { id: parentId === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder", title: name };
        },
      },
    });

    context.normalizeArchiveIssuerNames();

    expect(patchedFiles).toContainEqual({
      patchData: { title: "パークホームズLaLa新三郷管理組合" },
      fileId: "issuer-source",
      params: { supportsAllDrives: true },
    });
  });

  test("merges into existing normalized issuer folder when names collide", () => {
    const sourceFolder = createFolderItem("issuer-source", "パークホームズＬａＬａ新三郷管理組合", "archive-root");
    const normalizedFolder = createFolderItem("issuer-normalized", "パークホームズLaLa新三郷管理組合", "archive-root");
    const docTypeFolder = createFolderItem("doc-invoice", "請求書", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf", docTypeFolder.id);

    const { context, movedFiles, patchedFiles, removedFolders } = createNormalizationContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);

        const items = [sourceFolder, normalizedFolder, docTypeFolder].filter(function(item) {
          return item.parents[0].id === parentId && item.mimeType === "application/vnd.google-apps.folder";
        });

        return {
          items: titleMatch ? items.filter(function(item) { return item.title === titleMatch[1]; }) : items,
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        if (params.maxResults === 1) {
          return { items: [] };
        }

        return {
          items: parentId === docTypeFolder.id ? [file] : [],
        };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      insertFolder(resource) {
        return {
          id: resource.parents[0].id === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder",
          title: resource.title,
        };
      },
      globals: {
        findOrCreateChildFolder_(parentId, name) {
          return { id: parentId === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder", title: name };
        },
      },
    });

    const result = context.normalizeArchiveIssuerNames();

    expect(result.mergedFolders).toBe(1);
    expect(movedFiles).toContainEqual({
      patchData: {},
      fileId: "file-1",
      params: {
        addParents: "normalized-doc-folder",
        removeParents: docTypeFolder.id,
        fields: "id,parents",
        supportsAllDrives: true,
      },
    });
    expect(patchedFiles.some(function(call) {
      return call.fileId === sourceFolder.id && call.patchData.title === normalizedFolder.title;
    })).toBe(false);
    expect(removedFolders).toContainEqual({
      fileId: docTypeFolder.id,
      params: { supportsAllDrives: true },
    });
    expect(removedFolders).toContainEqual({
      fileId: sourceFolder.id,
      params: { supportsAllDrives: true },
    });
  });

  test("renames archived file names with normalized issuer segment", () => {
    const sourceFolder = createFolderItem("issuer-source", "パークホームズＬａＬａ新三郷管理組合", "archive-root");
    const docTypeFolder = createFolderItem("doc-invoice", "請求書", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf", docTypeFolder.id);

    const { context, patchedFiles } = createNormalizationContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            if (item.parents[0].id !== parentId || item.mimeType !== "application/vnd.google-apps.folder") {
              return false;
            }

            if (titleMatch) {
              return item.title === titleMatch[1];
            }

            return true;
          }),
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        return {
          items: parentId === docTypeFolder.id ? [file] : [],
        };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      insertFolder(resource) {
        return {
          id: resource.parents[0].id === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder",
          title: resource.title,
        };
      },
      globals: {
        findOrCreateChildFolder_(parentId, name) {
          return { id: parentId === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder", title: name };
        },
      },
    });

    context.normalizeArchiveIssuerNames();

    expect(patchedFiles).toContainEqual({
      patchData: { title: "2026-04-10_パークホームズLaLa新三郷管理組合_請求書_4月分.pdf" },
      fileId: "file-1",
      params: { supportsAllDrives: true },
    });
  });

  test("updates issuer-related log fields after successful normalization", () => {
    const sourceFolder = createFolderItem("issuer-source", "パークホームズＬａＬａ新三郷管理組合", "archive-root");
    const docTypeFolder = createFolderItem("doc-invoice", "請求書", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf", docTypeFolder.id);
    const logValues = [[
      ...LOG_HEADERS,
    ], [
      "2026-04-10T00:00:00Z",
      "file-1",
      "renamed",
      "scan.pdf",
      "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf",
      "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf",
      0.99,
      "2026-04-10",
      "パークホームズＬａＬａ新三郷管理組合",
      "請求書",
      "4月分",
      "summary",
      "",
      "パークホームズＬａＬａ新三郷管理組合/請求書",
      "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf",
      "archived-file-id",
    ]];
    const setValuesCalls = [];

    const { context } = createNormalizationContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            if (item.parents[0].id !== parentId || item.mimeType !== "application/vnd.google-apps.folder") {
              return false;
            }

            if (titleMatch) {
              return item.title === titleMatch[1];
            }

            return true;
          }),
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        return {
          items: parentId === docTypeFolder.id ? [file] : [],
        };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet(logValues, setValuesCalls),
      insertFolder(resource) {
        return {
          id: resource.parents[0].id === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder",
          title: resource.title,
        };
      },
      globals: {
        findOrCreateChildFolder_(parentId, name) {
          return { id: parentId === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder", title: name };
        },
      },
    });

    const result = context.normalizeArchiveIssuerNames();

    expect(result.updatedLogRows).toBe(1);
    expect(setValuesCalls).toHaveLength(1);
    expect(logValues[1][8]).toBe("パークホームズLaLa新三郷管理組合");
    expect(logValues[1][13]).toBe("パークホームズLaLa新三郷管理組合/請求書");
    expect(logValues[1][14]).toBe("2026-04-10_パークホームズLaLa新三郷管理組合_請求書_4月分.pdf");
  });

  test("does not update log rows or checkpoint when an issuer has a file operation failure", () => {
    const sourceFolder = createFolderItem("issuer-source", "パークホームズＬａＬａ新三郷管理組合", "archive-root");
    const docTypeFolder = createFolderItem("doc-invoice", "請求書", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf", docTypeFolder.id);
    const logValues = [[
      ...LOG_HEADERS,
    ], [
      "2026-04-10T00:00:00Z",
      "file-1",
      "renamed",
      "scan.pdf",
      "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf",
      "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf",
      0.99,
      "2026-04-10",
      "パークホームズＬａＬａ新三郷管理組合",
      "請求書",
      "4月分",
      "summary",
      "",
      "パークホームズＬａＬａ新三郷管理組合/請求書",
      "2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf",
      "archived-file-id",
    ]];
    const originalLogValues = logValues.map(function(row) {
      return row.slice();
    });
    const setValuesCalls = [];

    const { context, updatedProperties } = createNormalizationContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            if (item.parents[0].id !== parentId || item.mimeType !== "application/vnd.google-apps.folder") {
              return false;
            }

            if (titleMatch) {
              return item.title === titleMatch[1];
            }

            return true;
          }),
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        return {
          items: parentId === docTypeFolder.id ? [file] : [],
        };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      patchFile(patchData, fileId, params) {
        if (fileId === "file-1" && params && Object.prototype.hasOwnProperty.call(params, "addParents")) {
          throw new Error("move failed");
        }

        return { id: fileId, title: patchData.title || "" };
      },
      logSheet: createLogSheet(logValues, setValuesCalls),
      insertFolder(resource) {
        return {
          id: resource.parents[0].id === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder",
          title: resource.title,
        };
      },
      globals: {
        findOrCreateChildFolder_(parentId, name) {
          return { id: parentId === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder", title: name };
        },
      },
    });

    const result = context.normalizeArchiveIssuerNames();

    expect(result.failedItems).toBe(1);
    expect(result.updatedLogRows).toBe(0);
    expect(setValuesCalls).toHaveLength(0);
    expect(logValues).toEqual(originalLogValues);
    expect(updatedProperties.lastNormalizedIssuerFolder).toBeUndefined();
  });

  test("resumes after lastNormalizedIssuerFolder checkpoint", () => {
    const folderA = createFolderItem("issuer-a", "A", "archive-root");
    const folderB = createFolderItem("issuer-b", "B", "archive-root");
    const folderC = createFolderItem("issuer-c", "Ｃ", "archive-root");
    const docTypeFolder = createFolderItem("doc-c", "請求書", folderC.id);
    const file = createFileItem("file-c", "2026-04-10_Ｃ_請求書_4月分.pdf", docTypeFolder.id);

    const { context, patchedFiles, updatedProperties } = createNormalizationContext({
      lastNormalizedIssuerFolder: "B",
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);

        const items = [folderA, folderB, folderC, docTypeFolder].filter(function(item) {
          return item.parents[0].id === parentId && item.mimeType === "application/vnd.google-apps.folder";
        });

        return {
          items: titleMatch ? items.filter(function(item) { return item.title === titleMatch[1]; }) : items,
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        return {
          items: parentId === docTypeFolder.id ? [file] : [],
        };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      insertFolder(resource) {
        return {
          id: resource.parents[0].id === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder",
          title: resource.title,
        };
      },
      globals: {
        findOrCreateChildFolder_(parentId, name) {
          return { id: parentId === "archive-root" ? "normalized-issuer-folder" : "normalized-doc-folder", title: name };
        },
      },
    });

    const result = context.normalizeArchiveIssuerNames();

    expect(result.skippedFolders).toBe(2);
    expect(updatedProperties.lastNormalizedIssuerFolder).toBe("Ｃ");
    expect(patchedFiles).toContainEqual({
      patchData: { title: "C" },
      fileId: "issuer-c",
      params: { supportsAllDrives: true },
    });
    expect(patchedFiles.some(function(call) {
      return call.fileId === "issuer-a" || call.fileId === "issuer-b";
    })).toBe(false);
  });
});
