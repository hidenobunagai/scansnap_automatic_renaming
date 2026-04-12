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

function createLogSheet(logValues, setValuesCalls) {
  return {
    getLastRow() {
      return logValues.length;
    },
    getRange(row, column, numRows, numColumns) {
      return {
        getValues() {
          if (row === 1 && numRows === 1) {
            return [logValues[0].slice(0, numColumns || logValues[0].length)];
          }

          return logValues.slice(1).map(function(row) {
            return row.slice();
          });
        },
        setValues(values) {
          if (row === 1 && values.length === 1) {
            logValues[0] = values[0].slice();
            return;
          }

          setValuesCalls.push(values.map(function(row) {
            return row.slice();
          }));
          logValues.splice(1, logValues.length - 1, ...values.map(function(row) {
            return row.slice();
          }));
        },
      };
    },
    setFrozenRows() {},
    autoResizeColumns() {},
  };
}

function createCorrectionContext(overrides = {}) {
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
      if (key === "lastCorrectedIssuerFolder") return overrides.lastCorrectedIssuerFolder || null;
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
                getRange(row, column, numRows, numColumns) {
                  return {
                    getValues() {
                      if (row === 1 && numRows === 1) {
                        return [LOG_HEADERS.slice(0, numColumns || LOG_HEADERS.length)];
                      }

                      return [];
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

describe("correctArchiveIssuerFolders", () => {
  test("corrects weak issuer folder to a stronger school folder", () => {
    const sourceFolder = createFolderItem("issuer-weak", "学級だより", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "おたより", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_学級だより_おたより_4月号.pdf", docTypeFolder.id);
    const logValues = [[...LOG_HEADERS], [
      "2026-04-10T00:00:00Z",
      "file-1",
      "renamed",
      "scan.pdf",
      "2026-04-10_学級だより_おたより_4月号.pdf",
      "2026-04-10_学級だより_おたより_4月号.pdf",
      0.99,
      "2026-04-10",
      "学級だより",
      "おたより",
      "",
      "桜小学校からのおたより",
      "",
      "学級だより/おたより",
      "2026-04-10_学級だより_おたより_4月号.pdf",
      "archived-file-id",
    ]];

    const { context, movedFiles, updatedProperties } = createCorrectionContext({
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
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [file] : [] };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet(logValues, []),
      insertFolder(resource) {
        return {
          id: `ensured-${resource.parents[0].id}-${resource.title}`,
          title: resource.title,
        };
      },
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.correctedFolders).toBe(1);
    expect(result.skippedFolders).toBe(0);
    expect(movedFiles).toContainEqual({
      patchData: {},
      fileId: "file-1",
      params: {
        addParents: "ensured-ensured-archive-root-桜小学校-おたより",
        removeParents: docTypeFolder.id,
        fields: "id,parents",
        supportsAllDrives: true,
      },
    });
    expect(updatedProperties.lastCorrectedIssuerFolder).toBe("学級だより");
  });

  test("merges into an existing corrected issuer folder", () => {
    const sourceFolder = createFolderItem("issuer-weak", "案内", "archive-root");
    const destinationFolder = createFolderItem("issuer-school", "桜小学校", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "通知", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_案内_通知_桜小学校.pdf", docTypeFolder.id);
    const items = [sourceFolder, destinationFolder, docTypeFolder, file];
    const logValues = [[...LOG_HEADERS], [
      "2026-04-10T00:00:00Z",
      "file-1",
      "renamed",
      "scan.pdf",
      "2026-04-10_案内_通知_桜小学校.pdf",
      "2026-04-10_案内_通知_桜小学校.pdf",
      0.99,
      "2026-04-10",
      "案内",
      "通知",
      "学校からのお知らせ",
      "桜小学校の通知です",
      "",
      "案内/通知",
      "2026-04-10_案内_通知_桜小学校.pdf",
      "archived-file-id",
    ]];

    const { context, movedFiles, removedFolders } = createCorrectionContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        const folders = items.filter(function(item) {
          return item.mimeType === "application/vnd.google-apps.folder" && item.parents[0].id === parentId;
        });
        return {
          items: titleMatch ? folders.filter(function(item) { return item.title === titleMatch[1]; }) : folders,
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return {
          items: items.filter(function(item) {
            return item.mimeType !== "application/vnd.google-apps.folder" && item.parents[0].id === parentId;
          }),
        };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet(logValues, []),
      insertFolder(resource) {
        return {
          id: `ensured-${resource.parents[0].id}-${resource.title}`,
          title: resource.title,
        };
      },
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.correctedFolders).toBe(1);
    expect(result.mergedFolders).toBe(1);
    expect(movedFiles).toContainEqual({
      patchData: {},
      fileId: "file-1",
      params: {
        addParents: "ensured-issuer-school-通知",
        removeParents: docTypeFolder.id,
        fields: "id,parents",
        supportsAllDrives: true,
      },
    });
    expect(removedFolders).toContainEqual({
      fileId: docTypeFolder.id,
      params: { supportsAllDrives: true },
    });
    expect(removedFolders).toContainEqual({
      fileId: sourceFolder.id,
      params: { supportsAllDrives: true },
    });
  });

  test("renames archived file names after issuer correction", () => {
    const sourceFolder = createFolderItem("issuer-weak", "案内", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "通知", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_案内_通知_桜小学校.pdf", docTypeFolder.id);
    const logValues = [[...LOG_HEADERS], [
      "2026-04-10T00:00:00Z",
      "file-1",
      "renamed",
      "scan.pdf",
      "2026-04-10_案内_通知_桜小学校.pdf",
      "2026-04-10_案内_通知_桜小学校.pdf",
      0.99,
      "2026-04-10",
      "案内",
      "通知",
      "学校からのお知らせ",
      "桜小学校の通知です",
      "",
      "案内/通知",
      "2026-04-10_案内_通知_桜小学校.pdf",
      "archived-file-id",
    ]];

    const { context, patchedFiles } = createCorrectionContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            if (item.mimeType !== "application/vnd.google-apps.folder" || item.parents[0].id !== parentId) {
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
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [file] : [] };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet(logValues, []),
      insertFolder(resource) {
        return {
          id: `ensured-${resource.parents[0].id}-${resource.title}`,
          title: resource.title,
        };
      },
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.renamedFiles).toBe(1);
    expect(patchedFiles).toContainEqual({
      patchData: { title: "2026-04-10_桜小学校_通知_桜小学校.pdf" },
      fileId: "file-1",
      params: { supportsAllDrives: true },
    });
  });

  test("updates log issuer fields after issuer correction", () => {
    const sourceFolder = createFolderItem("issuer-weak", "案内", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "通知", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_案内_通知_桜小学校.pdf", docTypeFolder.id);
    const logValues = [[...LOG_HEADERS], [
      "2026-04-10T00:00:00Z",
      "file-1",
      "renamed",
      "scan.pdf",
      "2026-04-10_案内_通知_桜小学校.pdf",
      "2026-04-10_案内_通知_桜小学校.pdf",
      0.99,
      "2026-04-10",
      "案内",
      "通知",
      "学校からのお知らせ",
      "桜小学校の通知です",
      "",
      "案内/通知",
      "2026-04-10_案内_通知_桜小学校.pdf",
      "archived-file-id",
    ]];
    const setValuesCalls = [];

    const { context } = createCorrectionContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            if (item.mimeType !== "application/vnd.google-apps.folder" || item.parents[0].id !== parentId) {
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
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [file] : [] };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet(logValues, setValuesCalls),
      insertFolder(resource) {
        return {
          id: `ensured-${resource.parents[0].id}-${resource.title}`,
          title: resource.title,
        };
      },
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.updatedLogRows).toBe(1);
    expect(setValuesCalls).toHaveLength(1);
    expect(logValues[1][8]).toBe("桜小学校");
    expect(logValues[1][13]).toBe("桜小学校/通知");
    expect(logValues[1][14]).toBe("2026-04-10_桜小学校_通知_桜小学校.pdf");
  });

  test("ignores unrelated same-issuer log rows when inferring corrected issuer", () => {
    const sourceFolder = createFolderItem("issuer-weak", "案内", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "通知", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_案内_通知_桜小学校.pdf", docTypeFolder.id);
    const logValues = [[...LOG_HEADERS], [
      "2026-04-10T00:00:00Z",
      "file-1",
      "renamed",
      "scan.pdf",
      "2026-04-10_案内_通知_桜小学校.pdf",
      "2026-04-10_案内_通知_桜小学校.pdf",
      0.99,
      "2026-04-10",
      "案内",
      "通知",
      "学校からのお知らせ",
      "桜小学校の通知です",
      "",
      "案内/通知",
      "2026-04-10_案内_通知_桜小学校.pdf",
      "archived-file-id",
    ], [
      "2026-04-11T00:00:00Z",
      "unrelated-file",
      "review_needed",
      "other.pdf",
      "",
      "",
      0.4,
      "2026-04-11",
      "案内",
      "通知",
      "市役所からのお知らせ",
      "三郷市役所の通知です",
      "",
      "",
      "",
      "",
    ]];

    const { context, movedFiles } = createCorrectionContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            if (item.mimeType !== "application/vnd.google-apps.folder" || item.parents[0].id !== parentId) {
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
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [file] : [] };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet(logValues, []),
      insertFolder(resource) {
        return {
          id: `ensured-${resource.parents[0].id}-${resource.title}`,
          title: resource.title,
        };
      },
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.correctedFolders).toBe(1);
    expect(result.skippedFolders).toBe(0);
    expect(movedFiles).toContainEqual({
      patchData: {},
      fileId: "file-1",
      params: {
        addParents: "ensured-ensured-archive-root-桜小学校-通知",
        removeParents: docTypeFolder.id,
        fields: "id,parents",
        supportsAllDrives: true,
      },
    });
  });

  test("updates only matching archived log rows for corrected issuer", () => {
    const sourceFolder = createFolderItem("issuer-weak", "案内", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "通知", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_案内_通知_桜小学校.pdf", docTypeFolder.id);
    const logValues = [[...LOG_HEADERS], [
      "2026-04-10T00:00:00Z",
      "file-1",
      "renamed",
      "scan.pdf",
      "2026-04-10_案内_通知.pdf",
      "2026-04-10_案内_通知.pdf",
      0.99,
      "2026-04-10",
      "案内",
      "通知",
      "学校からのお知らせ",
      "桜小学校の通知です",
      "",
      "案内/通知",
      "2026-04-10_案内_通知_桜小学校.pdf",
      "archived-file-id",
    ], [
      "2026-04-11T00:00:00Z",
      "other-file",
      "copy_failed",
      "other.pdf",
      "",
      "",
      0.4,
      "2026-04-11",
      "案内",
      "通知",
      "市役所からのお知らせ",
      "三郷市役所の通知です",
      "",
      "案内/通知",
      "2026-04-11_案内_通知_三郷市役所.pdf",
      "",
    ]];
    const setValuesCalls = [];

    const { context } = createCorrectionContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            if (item.mimeType !== "application/vnd.google-apps.folder" || item.parents[0].id !== parentId) {
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
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [file] : [] };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet(logValues, setValuesCalls),
      insertFolder(resource) {
        return {
          id: `ensured-${resource.parents[0].id}-${resource.title}`,
          title: resource.title,
        };
      },
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.updatedLogRows).toBe(1);
    expect(setValuesCalls).toHaveLength(1);
    expect(logValues[1][8]).toBe("桜小学校");
    expect(logValues[1][13]).toBe("桜小学校/通知");
    expect(logValues[1][14]).toBe("2026-04-10_桜小学校_通知_桜小学校.pdf");
    expect(logValues[2][8]).toBe("案内");
    expect(logValues[2][13]).toBe("案内/通知");
    expect(logValues[2][14]).toBe("2026-04-11_案内_通知_三郷市役所.pdf");
  });

  test("resumes after lastCorrectedIssuerFolder checkpoint", () => {
    const folderA = createFolderItem("issuer-a", "A", "archive-root");
    const folderB = createFolderItem("issuer-b", "B", "archive-root");
    const folderC = createFolderItem("issuer-c", "学級だより", "archive-root");
    const docTypeFolder = createFolderItem("doc-c", "通知", folderC.id);
    const file = createFileItem("file-c", "2026-04-10_学級だより_通知_桜小学校.pdf", docTypeFolder.id);
    const logValues = [[...LOG_HEADERS], [
      "2026-04-10T00:00:00Z",
      "file-c",
      "renamed",
      "scan.pdf",
      "2026-04-10_学級だより_通知_桜小学校.pdf",
      "2026-04-10_学級だより_通知_桜小学校.pdf",
      0.99,
      "2026-04-10",
      "学級だより",
      "通知",
      "学校からのお知らせ",
      "桜小学校の通知です",
      "",
      "学級だより/通知",
      "2026-04-10_学級だより_通知_桜小学校.pdf",
      "archived-file-id",
    ]];

    const { context, patchedFiles, updatedProperties } = createCorrectionContext({
      lastCorrectedIssuerFolder: "B",
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        return {
          items: [folderA, folderB, folderC, docTypeFolder].filter(function(item) {
            if (item.mimeType !== "application/vnd.google-apps.folder" || item.parents[0].id !== parentId) {
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
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [file] : [] };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet(logValues, []),
      insertFolder(resource) {
        return {
          id: `ensured-${resource.parents[0].id}-${resource.title}`,
          title: resource.title,
        };
      },
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.skippedFolders).toBe(2);
    expect(result.correctedFolders).toBe(1);
    expect(updatedProperties.lastCorrectedIssuerFolder).toBe("学級だより");
    expect(patchedFiles).toContainEqual({
      patchData: { title: "2026-04-10_桜小学校_通知_桜小学校.pdf" },
      fileId: "file-c",
      params: { supportsAllDrives: true },
    });
    expect(patchedFiles.some(function(call) {
      return call.fileId === "issuer-a" || call.fileId === "issuer-b";
    })).toBe(false);
  });

  test("skips issuer folder when no strong candidate exists", () => {
    const sourceFolder = createFolderItem("issuer-weak", "案内", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "通知", sourceFolder.id);
    const file = createFileItem("file-1", "2026-04-10_案内_通知.pdf", docTypeFolder.id);

    const { context, movedFiles, patchedFiles, updatedProperties } = createCorrectionContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            return item.mimeType === "application/vnd.google-apps.folder" && item.parents[0].id === parentId;
          }),
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [file] : [] };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.correctedFolders).toBe(0);
    expect(result.skippedFolders).toBe(1);
    expect(result.renamedFiles).toBe(0);
    expect(result.updatedLogRows).toBe(0);
    expect(movedFiles).toHaveLength(0);
    expect(patchedFiles).toHaveLength(0);
    expect(updatedProperties.lastCorrectedIssuerFolder).toBeUndefined();
  });

  test("skips issuer folder when extracted candidates are only weak labels", () => {
    const sourceFolder = createFolderItem("issuer-weak", "案内", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "通知", sourceFolder.id);
    const weakSchoolFile = createFileItem("file-1", "幼稚園", docTypeFolder.id);
    const weakLetterFile = createFileItem("file-2", "おたより", docTypeFolder.id);
    const setValuesCalls = [];

    const { context, movedFiles, patchedFiles, updatedProperties } = createCorrectionContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            return item.mimeType === "application/vnd.google-apps.folder" && item.parents[0].id === parentId;
          }),
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [weakSchoolFile, weakLetterFile] : [] };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet([[...LOG_HEADERS]], setValuesCalls),
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.correctedFolders).toBe(0);
    expect(result.skippedFolders).toBe(1);
    expect(result.renamedFiles).toBe(0);
    expect(result.updatedLogRows).toBe(0);
    expect(movedFiles).toHaveLength(0);
    expect(patchedFiles).toHaveLength(0);
    expect(setValuesCalls).toHaveLength(0);
    expect(updatedProperties.lastCorrectedIssuerFolder).toBeUndefined();
  });

  test("skips issuer folder when strong candidates conflict", () => {
    const sourceFolder = createFolderItem("issuer-weak", "案内", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "通知", sourceFolder.id);
    const schoolFile = createFileItem("file-1", "2026-04-10_案内_通知_桜小学校.pdf", docTypeFolder.id);
    const cityFile = createFileItem("file-2", "2026-04-10_案内_通知_三郷市役所.pdf", docTypeFolder.id);
    const setValuesCalls = [];

    const { context, movedFiles, patchedFiles, updatedProperties } = createCorrectionContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            return item.mimeType === "application/vnd.google-apps.folder" && item.parents[0].id === parentId;
          }),
        };
      },
      listFiles(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [schoolFile, cityFile] : [] };
      },
      getFile() {
        return { parents: [docTypeFolder.id] };
      },
      logSheet: createLogSheet([[...LOG_HEADERS]], setValuesCalls),
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.correctedFolders).toBe(0);
    expect(result.skippedFolders).toBe(1);
    expect(result.failedItems).toBe(0);
    expect(movedFiles).toHaveLength(0);
    expect(patchedFiles).toHaveLength(0);
    expect(setValuesCalls).toHaveLength(0);
    expect(updatedProperties.lastCorrectedIssuerFolder).toBeUndefined();
  });

  test("continues after file-level correction failure without updating checkpoint", () => {
    const sourceFolder = createFolderItem("issuer-weak", "学級だより", "archive-root");
    const docTypeFolder = createFolderItem("doc-notice", "通知", sourceFolder.id);
    const failedFile = createFileItem("file-failed", "2026-04-10_学級だより_通知_4月号.pdf", docTypeFolder.id);
    const successfulFile = createFileItem("file-success", "2026-04-11_学級だより_通知_5月号.pdf", docTypeFolder.id);
    const logValues = [[...LOG_HEADERS], [
      "2026-04-10T00:00:00Z",
      "file-failed",
      "renamed",
      "scan1.pdf",
      "2026-04-10_学級だより_通知_4月号.pdf",
      "2026-04-10_学級だより_通知_4月号.pdf",
      0.99,
      "2026-04-10",
      "学級だより",
      "通知",
      "学校からのお知らせ",
      "桜小学校の通知です",
      "",
      "学級だより/通知",
      "2026-04-10_学級だより_通知_4月号.pdf",
      "archived-file-id-1",
    ], [
      "2026-04-11T00:00:00Z",
      "file-success",
      "renamed",
      "scan2.pdf",
      "2026-04-11_学級だより_通知_5月号.pdf",
      "2026-04-11_学級だより_通知_5月号.pdf",
      0.99,
      "2026-04-11",
      "学級だより",
      "通知",
      "学校からのお知らせ",
      "桜小学校の通知です",
      "",
      "学級だより/通知",
      "2026-04-11_学級だより_通知_5月号.pdf",
      "archived-file-id-2",
    ]];
    const setValuesCalls = [];

    const { context, movedFiles, patchedFiles, updatedProperties } = createCorrectionContext({
      listFolders(params, query) {
        const parentId = query.match(/'([^']+)' in parents/)[1];
        const titleMatch = query.match(/title = '([^']+)'/);
        return {
          items: [sourceFolder, docTypeFolder].filter(function(item) {
            if (item.mimeType !== "application/vnd.google-apps.folder" || item.parents[0].id !== parentId) {
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
        if (params.maxResults === 1) {
          return { items: [] };
        }
        return { items: parentId === docTypeFolder.id ? [failedFile, successfulFile] : [] };
      },
      getFile(fileId) {
        if (fileId === failedFile.id || fileId === successfulFile.id) {
          return { parents: [docTypeFolder.id] };
        }

        return { parents: [] };
      },
      patchFile(patchData, fileId, params) {
        if (fileId === failedFile.id && (!params || !Object.prototype.hasOwnProperty.call(params, "addParents"))) {
          throw new Error("rename failed");
        }

        return { id: fileId, title: patchData.title || "" };
      },
      logSheet: createLogSheet(logValues, setValuesCalls),
      insertFolder(resource) {
        return {
          id: `ensured-${resource.parents[0].id}-${resource.title}`,
          title: resource.title,
        };
      },
    });

    const result = context.correctArchiveIssuerFolders();

    expect(result.correctedFolders).toBe(0);
    expect(result.failedItems).toBe(1);
    expect(result.updatedLogRows).toBe(0);
    expect(result.errors).toContainEqual({
      source: "file:file-failed",
      message: "rename failed",
    });
    expect(patchedFiles).toContainEqual({
      patchData: { title: "2026-04-11_桜小学校_通知_5月号.pdf" },
      fileId: "file-success",
      params: { supportsAllDrives: true },
    });
    expect(movedFiles).toContainEqual({
      patchData: {},
      fileId: "file-success",
      params: {
        addParents: "ensured-ensured-archive-root-桜小学校-通知",
        removeParents: docTypeFolder.id,
        fields: "id,parents",
        supportsAllDrives: true,
      },
    });
    expect(setValuesCalls).toHaveLength(0);
    expect(updatedProperties.lastCorrectedIssuerFolder).toBeUndefined();
  });
});
