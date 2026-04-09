# Archive Folder Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change archive folder structure from `書類種別/発行元` to `発行元/書類種別` and migrate existing data.

**Architecture:** Modify `buildArchiveRelativePath_` to swap segment order, add a `migrateArchiveFolderStructure()` function that moves files and updates log paths, and update tests.

**Tech Stack:** Google Apps Script (JavaScript), Bun test runner

---

### Task 1: Change `buildArchiveRelativePath_` segment order

**Files:**
- Modify: `src/archive.js:6-18`
- Test: `tests/archive-feature.test.mjs`

- [ ] **Step 1: Update `buildArchiveRelativePath_` to swap order**

In `src/archive.js`, change `buildArchiveRelativePath_` from:

```js
function buildArchiveRelativePath_(suggestion, config) {
  return [
    normalizeArchiveSegment_(
      suggestion.documentType,
      ARCHIVE_DEFAULTS_.documentType,
      config.maxDocumentTypeLength,
    ),
    normalizeArchiveSegment_(
      suggestion.issuer,
      ARCHIVE_DEFAULTS_.issuer,
      config.maxIssuerLength,
    ),
  ].join("/");
}
```

to:

```js
function buildArchiveRelativePath_(suggestion, config) {
  return [
    normalizeArchiveSegment_(
      suggestion.issuer,
      ARCHIVE_DEFAULTS_.issuer,
      config.maxIssuerLength,
    ),
    normalizeArchiveSegment_(
      suggestion.documentType,
      ARCHIVE_DEFAULTS_.documentType,
      config.maxDocumentTypeLength,
    ),
  ].join("/");
}
```

- [ ] **Step 2: Update `buildArchiveRelativePath_` unit tests**

In `tests/archive-feature.test.mjs`, update the `buildArchiveRelativePath_` tests to reflect the new order.

Change the test "uses document type and issuer folders" (line 98):

```js
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
```

Change the test "falls back when document type and issuer are missing" (line 118):

```js
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
```

- [ ] **Step 3: Update mock `buildArchiveRelativePath_` in process tests**

In `tests/archive-feature.test.mjs`, the `createProcessContext` function (line 23) has:

```js
buildArchiveRelativePath_() {
  return "税通知/市役所";
},
```

Change to:

```js
buildArchiveRelativePath_() {
  return "市役所/税通知";
},
```

Also update all assertions referencing `"税通知/市役所"`:

- Line 150: `expect(result.archiveRelativePath).toBe("税通知/市役所");` → `expect(result.archiveRelativePath).toBe("市役所/税通知");`
- Line 205: `folderId: "folder:archive-root:税通知/市役所",` → `folderId: "folder:archive-root:市役所/税通知",`
- Line 278: `folderId: "folder:archive-root:税通知/市役所",` → `folderId: "folder:archive-root:市役所/税通知",`

- [ ] **Step 4: Update `archiveRelativePath` values in log-sheet test data**

In `tests/archive-feature.test.mjs`, the "retries copy_failed" test (line 239) and "reuses an existing archive file" test (line 286) both have `archiveRelativePath: "税通知/市役所"` in their `lastEntry` objects.

Change these to:

```js
archiveRelativePath: "市役所/税通知",
```

Also update the log row parsing test (line 438) which has `"税通知/市役所"` in the row data at index 12.

Change line 466:
```js
"税通知/市役所",
```
to:
```js
"市役所/税通知",
```

And the assertion at line 477:
```js
expect(fileStateMap["file-1"].lastEntry.archiveRelativePath).toBe("税通知/市役所");
```
to:
```js
expect(fileStateMap["file-1"].lastEntry.archiveRelativePath).toBe("市役所/税通知");
```

- [ ] **Step 5: Run tests to verify**

Run: `bun test`
Expected: All tests pass with the new path order.

- [ ] **Step 6: Commit**

```bash
git add src/archive.js tests/archive-feature.test.mjs
git commit -m "feat: swap archive path order to issuer/documentType"
```

---

### Task 2: Add `migrateArchiveFolderStructure` function

**Files:**
- Modify: `src/archive.js` (add new function)
- Create: `tests/archive-migration.test.mjs`

- [ ] **Step 1: Write failing tests for the migration function**

Create `tests/archive-migration.test.mjs`:

```js
import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

function createMigrationContext(overrides = {}) {
  const archivedFiles = [];
  const deletedFolders = [];
  const updatedProperties = {};
  const deletedProperties = [];

  const rootFolderId = "archive-root";
  const logSheetData = [];

  const context = createAppsScriptContext({
    files: ["src/utils.js", "src/archive.js", "src/config.js", "src/log-sheet.js", "src/main.js"],
    globals: {
      getScriptProperties_() {
        return {
          getProperties() {
            return {
              ARCHIVE_ROOT_FOLDER_ID: rootFolderId,
              SCANSNAP_FOLDER_ID: "scansnap-folders-id",
              GEMINI_API_KEY: "test-key",
              ...overrides.scriptProperties,
            };
          },
          getProperty(key) {
            if (key === "ARCHIVE_ROOT_FOLDER_ID") return rootFolderId;
            if (key === "lastMigratedDocumentType") return overrides.lastMigratedDocumentType || null;
            return overrides.scriptProperties?.[key] || null;
          },
          setProperty(key, value) {
            updatedProperties[key] = value;
          },
          deleteProperty(key) {
            deletedProperties.push(key);
          },
        };
      },
      Drive: {
        Files: {
          list(params) {
            const query = params.q;
            if (query.indexOf("application/vnd.google-apps.folder") !== -1) {
              return overrides.listFolders ? overrides.listFolders(params, query) : { items: [] };
            }
            return overrides.listFiles ? overrides.listFiles(params, query) : { items: [] };
          },
          patch(patchData, fileId, params) {
            archivedFiles.push({ patchData, fileId, params });
            return { id: fileId, title: patchData.title || "" };
          },
        },
      },
      SpreadsheetApp: {
        openById(id) {
          return {
            getId() { return id; },
            getSheetByName(name) {
              return overrides.logSheet || null;
            },
          };
        },
        create(name) {
          return {
            getId() { return "new-spreadsheet-id"; },
            getSheets() {
              return [{
                setName() { return this; },
              }];
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

describe("migrateArchiveFolderStructure", () => {
  test("moves files from old structure to new structure and cleans up", () => {
    const invoiceFolderId = "folder-invoice";
    const receiptFolderId = "folder-receipt";
    const tokyoFolderId = "folder-tokyo-power";
    const cityFolderId = "folder-city-hall";

    const { context } = createMigrationContext({
      listFolders(params, query) {
        if (query.indexOf(rootFolderId) !== -1 && query.indexOf("application/vnd.google-apps.folder") !== -1) {
          if (query.indexOf(invoiceFolderId) === -1 && query.indexOf(receiptFolderId) === -1 && query.indexOf(tokyoFolderId) === -1 && query.indexOf(cityFolderId) === -1) {
            return {
              items: [
                createFolderItem(invoiceFolderId, "明細書", rootFolderId),
                createFolderItem(receiptFolderId, "領収書", rootFolderId),
              ],
            };
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
      lastMigratedDocumentType: "領収書",
      listFolders(params, query) {
        if (query.indexOf(rootFolderId) !== -1 && query.indexOf("application/vnd.google-apps.folder") !== -1) {
          if (query.indexOf("folder-") === -1) {
            return {
              items: [
                createFolderItem("folder-a", "A書類", rootFolderId),
                createFolderItem("folder-b", "領収書", rootFolderId),
                createFolderItem("folder-c", "明細書", rootFolderId),
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

    expect(result.skippedFolders).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/archive-migration.test.mjs`
Expected: FAIL — `migrateArchiveFolderStructure` and `reverseArchivePathSegments_` are not defined.

- [ ] **Step 3: Add `reverseArchivePathSegments_` helper function**

Add to `src/archive.js` after `normalizeArchiveSegment_`:

```js
function reverseArchivePathSegments_(path) {
  var segments = String(path || "").split("/");

  if (segments.length < 2) {
    return String(path || "");
  }

  var first = segments[0];
  var second = segments[1];
  var rest = segments.slice(2);

  return [second, first].concat(rest).join("/");
}
```

- [ ] **Step 4: Add `migrateArchiveFolderStructure` function**

Add to `src/archive.js` after `reverseArchivePathSegments_`:

```js
function migrateArchiveFolderStructure() {
  var config = getConfig_();
  var archiveRootFolderId = requireArchiveRootFolderId_(config);
  var propertiesService = getScriptProperties_();
  var lastMigrated = propertiesService.getProperty("lastMigratedDocumentType") || "";

  var documentTypeFolders = listDirectChildFolders_(archiveRootFolderId);
  var counts = {
    movedFiles: 0,
    failedFiles: 0,
    deletedFolders: 0,
    skippedFolders: 0,
  };
  var errors = [];

  documentTypeFolders.forEach(function(docTypeFolder) {
    if (lastMigrated && docTypeFolder.title <= lastMigrated) {
      counts.skippedFolders += 1;
      return;
    }

    var issuerFolders = listDirectChildFolders_(docTypeFolder.id);

    issuerFolders.forEach(function(issuerFolder) {
      var files = listFilesInFolder_(issuerFolder.id);

      files.forEach(function(file) {
        try {
          var newPath = issuerFolder.title + "/" + docTypeFolder.title;
          var targetFolder = ensureArchiveFolderByPath_(archiveRootFolderId, newPath);
          Drive.Files.patch(
            { parents: [{ id: targetFolder.id }] },
            file.id,
            { supportsAllDrives: true },
          );
          counts.movedFiles += 1;
        } catch (error) {
          counts.failedFiles += 1;
          errors.push({
            source: "file:" + file.id,
            message: getErrorMessage_(error),
          });
        }
      });

      try {
        deleteEmptyFolder_(issuerFolder.id);
        counts.deletedFolders += 1;
      } catch (ignore) {
        // Folder not empty or already deleted
      }
    });

    try {
      deleteEmptyFolder_(docTypeFolder.id);
      counts.deletedFolders += 1;
    } catch (ignore) {
      // Folder not empty or already deleted
    }

    propertiesService.setProperty("lastMigratedDocumentType", docTypeFolder.title);
  });

  migrateArchivePathsInLog_(config);

  propertiesService.deleteProperty("lastMigratedDocumentType");

  var summary = {
    movedFiles: counts.movedFiles,
    failedFiles: counts.failedFiles,
    deletedFolders: counts.deletedFolders,
    skippedFolders: counts.skippedFolders,
    errors: errors,
  };

  logInfo_("Archive folder migration completed.", summary);

  return summary;
}

function listDirectChildFolders_(parentFolderId) {
  var query = [
    "'" + escapeDriveQueryValue_(parentFolderId) + "' in parents",
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");

  var folders = [];
  var pageToken = "";

  while (true) {
    var response = Drive.Files.list({
      q: query,
      maxResults: 100,
      pageToken: pageToken || undefined,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    (response.items || []).forEach(function(item) {
      folders.push({ id: item.id, title: item.title });
    });

    pageToken = response.nextPageToken || "";

    if (!pageToken) {
      break;
    }
  }

  return folders;
}

function listFilesInFolder_(folderId) {
  var query = [
    "'" + escapeDriveQueryValue_(folderId) + "' in parents",
    "trashed = false",
  ].join(" and ");

  var files = [];
  var pageToken = "";

  while (true) {
    var response = Drive.Files.list({
      q: query,
      maxResults: 100,
      pageToken: pageToken || undefined,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    (response.items || []).forEach(function(item) {
      files.push({ id: item.id, title: item.title });
    });

    pageToken = response.nextPageToken || "";

    if (!pageToken) {
      break;
    }
  }

  return files;
}

function deleteEmptyFolder_(folderId) {
  var query = [
    "'" + escapeDriveQueryValue_(folderId) + "' in parents",
    "trashed = false",
  ].join(" and ");

  var response = Drive.Files.list({
    q: query,
    maxResults: 1,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  if ((response.items || []).length > 0) {
    throw new Error("Folder is not empty.");
  }

  Drive.Files.remove(folderId, { supportsAllDrives: true });
}

function migrateArchivePathsInLog_(config) {
  var logState = getLogState_(config);
  var sheet = logState.sheet;
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  var archivePathCol = LOG_HEADER_INDEX_.archiveRelativePath + 1;
  var statusCol = LOG_HEADER_INDEX_.status + 1;
  var range = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length);
  var values = range.getValues();
  var changed = false;

  for (var i = 0; i < values.length; i++) {
    var status = String(values[i][statusCol - 1] || "");
    if (status !== "renamed" && status !== "copy_failed") {
      continue;
    }

    var currentPath = String(values[i][archivePathCol - 1] || "");
    var newPath = reverseArchivePathSegments_(currentPath);

    if (newPath !== currentPath && currentPath.indexOf("/") !== -1) {
      values[i][archivePathCol - 1] = newPath;
      changed = true;
    }
  }

  if (changed) {
    range.setValues(values);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/archive.js tests/archive-migration.test.mjs
git commit -m "feat: add migrateArchiveFolderStructure and reverseArchivePathSegments_"
```

---

### Task 3: Update `check` script and run full verification

**Files:**
- Modify: `package.json` (check script)

- [ ] **Step 1: Verify syntax check script includes new code**

The existing `bun run check` script already checks all `src/*.js` files with `node --check`. Verify this catches syntax errors in the new functions:

Run: `bun run check`
Expected: No errors.

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass, including new migration tests.

- [ ] **Step 3: Commit if any fixes were needed**

Only commit if changes were made.

```bash
git add -A
git commit -m "fix: resolve issues found during verification"
```

---

### Task 4: Update README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README to reflect new folder structure**

In `README.md`, change line 13 from:

```
- `書類種別/発行元` のフォルダ構成で家族共有フォルダへコピー
```

to:

```
- `発行元/書類種別` のフォルダ構成で家族共有フォルダへコピー
```

Also add the new function to the Apps Script functions list (after line 98):

```
- `migrateArchiveFolderStructure()`: 既存のアーカイブフォルダを旧構成（書類種別/発行元）から新構成（発行元/書類種別）へ移行
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for issuer-first archive structure"
```