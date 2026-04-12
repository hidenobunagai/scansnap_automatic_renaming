# Issuer Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize issuer names to half-width alphanumerics across new processing and existing archive data so issuer folders, archived file names, and log values stay consistent.

**Architecture:** Add an issuer-specific normalization helper in `src/utils.js`, apply it once in `normalizeAiSuggestion_()` so new data flows through the existing pipeline consistently, then add a one-time archive normalization function in `src/archive.js` to rename and merge issuer folders, rename archived files, and update log sheet rows. Keep the change scoped to `issuer` only.

**Tech Stack:** Google Apps Script (JavaScript), Bun test runner, clasp for deployment

---

### Task 1: Add issuer normalization helper and apply it to new suggestions

**Files:**
- Modify: `src/utils.js`
- Modify: `src/ai.js`
- Test: `tests/issuer-normalization.test.mjs`

- [ ] **Step 1: Write the failing tests for issuer normalization**

Create `tests/issuer-normalization.test.mjs` with these tests:

```js
import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("normalizeIssuerText_", () => {
  test("converts full-width ASCII letters and digits to half-width", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.normalizeIssuerText_("Ｗismettac１２３")).toBe("Wismettac123");
  });

  test("converts full-width spaces to half-width spaces before collapse", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.normalizeIssuerText_("パークホームズ　ＬａＬａ")).toBe("パークホームズ LaLa");
  });

  test("keeps kana and kanji unchanged", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.normalizeIssuerText_("東京電力株式会社")).toBe("東京電力株式会社");
  });
});

describe("normalizeAiSuggestion_", () => {
  test("normalizes issuer before truncating file segment", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/ai.js"],
      globals: {
        Utilities: {
          formatDate() {
            return "2026-04-10";
          },
        },
        Session: {
          getScriptTimeZone() {
            return "Asia/Tokyo";
          },
        },
      },
    });

    const result = context.normalizeAiSuggestion_(
      {
        documentDate: "2026-04-10",
        issuer: "パークホームズＬａＬａ新三郷管理組合",
        documentType: "請求書",
        subject: "4月分",
        summary: "4月分",
        confidence: 0.8,
      },
      {
        name: "scan.pdf",
        createdAt: new Date("2026-04-10T00:00:00Z"),
      },
      {
        timezone: "Asia/Tokyo",
        maxIssuerLength: 50,
        maxDocumentTypeLength: 30,
        maxSubjectLength: 50,
      },
    );

    expect(result.issuer).toBe("パークホームズLaLa新三郷管理組合");
  });
});
```

- [ ] **Step 2: Run the new test file and verify it fails**

Run: `bun test tests/issuer-normalization.test.mjs`
Expected: FAIL because `normalizeIssuerText_` is not defined and `normalizeAiSuggestion_()` still returns the unnormalized issuer.

- [ ] **Step 3: Add issuer normalization helper to `src/utils.js`**

Add this function near the other normalization helpers in `src/utils.js`:

```js
function normalizeIssuerText_(value) {
  return collapseWhitespace_(String(value || "").replace(/[\u3000\uFF01-\uFF5E]/g, function(char) {
    if (char === "\u3000") {
      return " ";
    }

    return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
  }));
}
```

- [ ] **Step 4: Apply issuer normalization inside `normalizeAiSuggestion_()`**

In `src/ai.js`, change the `issuer` line inside `normalizeAiSuggestion_()` from:

```js
issuer: truncateFileSegment_(payload.issuer, config.maxIssuerLength),
```

to:

```js
issuer: truncateFileSegment_(normalizeIssuerText_(payload.issuer), config.maxIssuerLength),
```

- [ ] **Step 5: Run tests to verify the helper and AI normalization pass**

Run: `bun test tests/issuer-normalization.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full suite and syntax check**

Run: `bun test && bun run check`
Expected: All tests pass and syntax check succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/utils.js src/ai.js tests/issuer-normalization.test.mjs
git commit -m "feat: normalize issuer names to half-width alphanumerics"
```

---

### Task 2: Reuse normalized issuer in filenames and archive paths

**Files:**
- Modify: `tests/archive-feature.test.mjs`
- Test: `tests/archive-feature.test.mjs`

- [ ] **Step 1: Add a regression test proving normalized issuer flows into filenames and archive paths**

In `tests/archive-feature.test.mjs`, add a test like this near the filename/archive tests:

```js
test("uses normalized issuer in suggested file name and archive path", () => {
  const context = createAppsScriptContext({
    files: ["src/utils.js", "src/filename.js", "src/archive.js"],
  });

  const suggestion = {
    issuer: context.normalizeIssuerText_("パークホームズＬａＬａ新三郷管理組合"),
    documentType: "請求書",
    subject: "4月分",
    documentDate: "2026-04-10",
  };

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
```

- [ ] **Step 2: Run the targeted regression test**

Run: `bun test tests/archive-feature.test.mjs`
Expected: PASS because the normalized issuer already flows through existing consumers once Task 1 is in place.

- [ ] **Step 3: Commit only if the test required file changes**

```bash
git add tests/archive-feature.test.mjs
git commit -m "test: cover normalized issuer usage in filenames and archive paths"
```

Only create this commit if the test file changed.

---

### Task 3: Add one-time existing archive issuer normalization

**Files:**
- Modify: `src/archive.js`
- Test: `tests/archive-issuer-normalization.test.mjs`

- [ ] **Step 1: Write failing tests for existing archive normalization**

Create `tests/archive-issuer-normalization.test.mjs` with a focused harness that mirrors `tests/archive-migration.test.mjs` and covers these cases:

1. Folder rename without collision
2. Merge into an already-normalized issuer folder
3. Archived file rename using normalized issuer in the file name
4. Log sheet updates for `issuer`, `archiveRelativePath`, and `archiveFinalName`
5. Resume behavior using `lastNormalizedIssuerFolder`

Use these test names and expectations:

```js
test("renames issuer folder when normalized name has no collision", () => {
  // source folder: パークホームズＬａＬａ新三郷管理組合
  // normalized target: パークホームズLaLa新三郷管理組合
  // expect folder rename or equivalent move result
});

test("merges into existing normalized issuer folder when names collide", () => {
  // source folder exists in full-width form and target already exists in half-width form
  // expect files to end up under the normalized issuer folder
});

test("renames archived file names with normalized issuer segment", () => {
  // file title: 2026-04-10_パークホームズＬａＬａ新三郷管理組合_請求書_4月分.pdf
  // expect renamed title to contain パークホームズLaLa新三郷管理組合
});

test("updates issuer-related log fields after successful normalization", () => {
  // expect issuer, archiveRelativePath, archiveFinalName to be rewritten with normalized issuer
});

test("resumes after lastNormalizedIssuerFolder checkpoint", () => {
  // folders A, B, C with lastNormalizedIssuerFolder = B
  // expect A and B skipped, C processed
});
```

- [ ] **Step 2: Run the new test file and verify it fails**

Run: `bun test tests/archive-issuer-normalization.test.mjs`
Expected: FAIL because `normalizeArchiveIssuerNames()` and helper functions do not exist yet.

- [ ] **Step 3: Add issuer-folder normalization helpers to `src/archive.js`**

Add small helpers before the main one-time function:

```js
function buildNormalizedArchiveFileName_(fileName, issuerFolderName, normalizedIssuerFolderName) {
  return String(fileName || "").replace(issuerFolderName, normalizedIssuerFolderName);
}

function updateIssuerFieldsInLogRow_(row, normalizedIssuer) {
  row[LOG_HEADER_INDEX_.issuer] = normalizedIssuer;

  var archivePath = String(row[LOG_HEADER_INDEX_.archiveRelativePath] || "");
  if (archivePath) {
    var segments = archivePath.split("/");
    segments[0] = normalizedIssuer;
    row[LOG_HEADER_INDEX_.archiveRelativePath] = segments.join("/");
  }

  var archiveFileName = String(row[LOG_HEADER_INDEX_.archiveFinalName] || "");
  if (archiveFileName) {
    row[LOG_HEADER_INDEX_.archiveFinalName] = archiveFileName;
  }
}
```

Then adjust the implementation in later steps so `archiveFinalName` is rewritten with the same issuer normalization rule.

- [ ] **Step 4: Implement `normalizeArchiveIssuerNames()` minimally**

Add `normalizeArchiveIssuerNames()` to `src/archive.js` with this behavior:

```js
function normalizeArchiveIssuerNames() {
  var config = getConfig_();
  var archiveRootFolderId = requireArchiveRootFolderId_(config);
  var propertiesService = getScriptProperties_();
  var lastNormalized = propertiesService.getProperty("lastNormalizedIssuerFolder") || "";
  var issuerFolders = listDirectChildFolders_(archiveRootFolderId);
  var counts = {
    renamedFolders: 0,
    mergedFolders: 0,
    renamedFiles: 0,
    updatedLogRows: 0,
    skippedFolders: 0,
    failedItems: 0,
  };
  var errors = [];

  issuerFolders.forEach(function(issuerFolder) {
    if (lastNormalized && issuerFolder.title <= lastNormalized) {
      counts.skippedFolders += 1;
      return;
    }

    var normalizedIssuer = normalizeIssuerText_(issuerFolder.title);
    var destinationFolder = issuerFolder;

    if (normalizedIssuer && normalizedIssuer !== issuerFolder.title) {
      var existingFolder = findChildFolder_(archiveRootFolderId, normalizedIssuer);

      if (existingFolder) {
        destinationFolder = existingFolder;
        counts.mergedFolders += 1;
      } else {
        Drive.Files.patch({ title: normalizedIssuer }, issuerFolder.id, {
          supportsAllDrives: true,
        });
        destinationFolder = { id: issuerFolder.id, title: normalizedIssuer };
        counts.renamedFolders += 1;
      }
    }

    listDirectChildFolders_(issuerFolder.id).forEach(function(documentTypeFolder) {
      var destinationDocumentTypeFolder = ensureArchiveFolderByPath_(
        archiveRootFolderId,
        destinationFolder.title + "/" + documentTypeFolder.title,
      );

      listFilesInFolder_(documentTypeFolder.id).forEach(function(file) {
        try {
          var nextFileName = buildNormalizedArchiveFileName_(
            file.title,
            issuerFolder.title,
            destinationFolder.title,
          );

          moveDriveFileToFolder_(file.id, destinationDocumentTypeFolder.id);

          if (nextFileName !== file.title) {
            Drive.Files.patch({ title: nextFileName }, file.id, {
              supportsAllDrives: true,
            });
            counts.renamedFiles += 1;
          }
        } catch (error) {
          counts.failedItems += 1;
          errors.push({
            source: "file:" + file.id,
            message: getErrorMessage_(error),
          });
        }
      });
    });

    counts.updatedLogRows += normalizeIssuerRowsInLog_(issuerFolder.title, destinationFolder.title, config);
    propertiesService.setProperty("lastNormalizedIssuerFolder", issuerFolder.title);
  });

  var summary = {
    renamedFolders: counts.renamedFolders,
    mergedFolders: counts.mergedFolders,
    renamedFiles: counts.renamedFiles,
    updatedLogRows: counts.updatedLogRows,
    skippedFolders: counts.skippedFolders,
    failedItems: counts.failedItems,
    errors: errors,
  };

  logInfo_("Archive issuer normalization completed.", summary);
  propertiesService.deleteProperty("lastNormalizedIssuerFolder");
  return summary;
}
```

Keep the implementation minimal and use existing helper functions already in `src/archive.js` wherever possible.

- [ ] **Step 5: Implement log normalization helper in `src/archive.js`**

Add a helper that rewrites existing log rows by old issuer string:

```js
function normalizeIssuerRowsInLog_(oldIssuer, newIssuer, config) {
  if (!oldIssuer || !newIssuer || oldIssuer === newIssuer) {
    return 0;
  }

  var logState = getLogState_(config);
  var sheet = logState.sheet;
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return 0;
  }

  var range = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length);
  var values = range.getValues();
  var updated = 0;

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][LOG_HEADER_INDEX_.issuer] || "") !== oldIssuer) {
      continue;
    }

    values[i][LOG_HEADER_INDEX_.issuer] = newIssuer;

    var archivePath = String(values[i][LOG_HEADER_INDEX_.archiveRelativePath] || "");
    if (archivePath) {
      var pathSegments = archivePath.split("/");
      pathSegments[0] = newIssuer;
      values[i][LOG_HEADER_INDEX_.archiveRelativePath] = pathSegments.join("/");
    }

    var archiveFileName = String(values[i][LOG_HEADER_INDEX_.archiveFinalName] || "");
    if (archiveFileName) {
      values[i][LOG_HEADER_INDEX_.archiveFinalName] = buildNormalizedArchiveFileName_(archiveFileName, oldIssuer, newIssuer);
    }

    updated += 1;
  }

  if (updated) {
    range.setValues(values);
  }

  return updated;
}
```

- [ ] **Step 6: Run the new archive normalization tests and make them pass**

Run: `bun test tests/archive-issuer-normalization.test.mjs`
Expected: PASS.

- [ ] **Step 7: Run the full suite and syntax check**

Run: `bun test && bun run check`
Expected: All tests pass and syntax check succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/archive.js tests/archive-issuer-normalization.test.mjs
git commit -m "feat: normalize existing archive issuer names"
```

---

### Task 4: Document the new one-time normalization function

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README function list and behavior description**

Add this line to the Apps Script functions section in `README.md`:

```md
- `normalizeArchiveIssuerNames()`: 既存の発行元フォルダ名、アーカイブ済みファイル名、ログの issuer 関連項目を半角英数字へ正規化
```

Also update any archive-structure explanation that mentions issuer naming consistency so it reflects that issuer values are normalized to half-width alphanumerics.

- [ ] **Step 2: Run syntax check**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document issuer normalization maintenance task"
```
