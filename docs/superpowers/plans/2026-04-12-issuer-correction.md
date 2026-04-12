# Issuer Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve issuer classification so weak first-pass issuer labels are replaced with stronger organization names, and add a one-time correction task for already misclassified archive folders.

**Architecture:** Keep AI output unchanged, then add a deterministic issuer-correction layer that rejects weak issuer values and promotes stronger organization candidates from OCR text, subject, and summary. Reuse the same correction logic for a one-time archive maintenance function that rewrites existing top-level issuer folders, archive file names, and related log rows when strong evidence exists.

**Tech Stack:** Google Apps Script (JavaScript), Bun test runner, clasp for Apps Script deployment

---

### Task 1: Add issuer-correction heuristics for new documents

**Files:**
- Modify: `src/utils.js`
- Modify: `src/ai.js`
- Test: `tests/issuer-correction.test.mjs`

- [ ] **Step 1: Write the failing tests for weak issuer detection and candidate extraction**

Create `tests/issuer-correction.test.mjs` with these tests:

```js
import { describe, expect, test } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("isWeakIssuerLabel_", () => {
  test("treats personal-name-like hiragana as weak", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.isWeakIssuerLabel_("ながいげんた")).toBe(true);
  });

  test("treats generic document labels as weak", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.isWeakIssuerLabel_("学級だより")).toBe(true);
    expect(context.isWeakIssuerLabel_("案内")).toBe(true);
  });

  test("keeps concrete organization names as strong", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(context.isWeakIssuerLabel_("桜小学校")).toBe(false);
    expect(context.isWeakIssuerLabel_("三郷市水道部業務課")).toBe(false);
  });
});

describe("extractOrganizationCandidates_", () => {
  test("finds school and company names from OCR text", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js"],
    });

    expect(
      context.extractOrganizationCandidates_(
        "桜小学校 学級だより 2026年4月号 保護者各位",
      ),
    ).toContain("桜小学校");

    expect(
      context.extractOrganizationCandidates_(
        "株式会社サンプル 請求書 ご請求金額 10,000円",
      ),
    ).toContain("株式会社サンプル");
  });
});

describe("correctIssuerSuggestion_", () => {
  test("replaces weak issuer with stronger organization found in OCR text", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/ai.js"],
    });

    const corrected = context.correctIssuerSuggestion_(
      {
        issuer: "ながいげんた",
        documentType: "おたより",
        subject: "4月のおたより",
        summary: "桜小学校からのおたより",
      },
      "桜小学校 学級だより 4月号 ながいげんた",
    );

    expect(corrected).toBe("桜小学校");
  });

  test("keeps current issuer when no stronger evidence exists", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/ai.js"],
    });

    const corrected = context.correctIssuerSuggestion_(
      {
        issuer: "東京電力株式会社",
        documentType: "請求書",
        subject: "4月分",
        summary: "電気料金のお知らせ",
      },
      "東京電力株式会社 電気料金請求書 4月分",
    );

    expect(corrected).toBe("東京電力株式会社");
  });
});

describe("normalizeAiSuggestion_", () => {
  test("corrects weak issuer after normalization", () => {
    const context = createAppsScriptContext({
      files: ["src/utils.js", "src/ai.js"],
    });

    const result = context.normalizeAiSuggestion_(
      {
        documentDate: "2026-04-12",
        issuer: "学級だより",
        documentType: "おたより",
        subject: "4月号",
        summary: "桜小学校 4月号",
        confidence: 0.7,
      },
      {
        name: "scan.pdf",
        createdAt: new Date("2026-04-12T00:00:00Z"),
      },
      {
        timezone: "Asia/Tokyo",
        maxIssuerLength: 50,
        maxDocumentTypeLength: 30,
        maxSubjectLength: 50,
      },
      "桜小学校 学級だより 4月号",
    );

    expect(result.issuer).toBe("桜小学校");
  });
});
```

- [ ] **Step 2: Run the new test file and verify it fails**

Run: `bun test tests/issuer-correction.test.mjs`
Expected: FAIL because the new helper functions do not exist and `normalizeAiSuggestion_()` does not accept OCR text for correction yet.

- [ ] **Step 3: Add weak-issuer and organization-candidate helpers to `src/utils.js`**

Add these helpers in `src/utils.js` near the existing normalization helpers:

```js
const WEAK_ISSUER_LABELS_ = [
  "案内",
  "おたより",
  "学級だより",
  "チェックリスト",
  "申込書",
  "連絡",
  "学校",
  "幼稚園",
  "保護者",
];

const ORGANIZATION_MARKERS_ = [
  "小学校",
  "中学校",
  "高等学校",
  "幼稚園",
  "保育園",
  "こども園",
  "児童クラブ",
  "学童",
  "市役所",
  "区役所",
  "役場",
  "水道部",
  "教育委員会",
  "管理組合",
  "株式会社",
  "有限会社",
  "合同会社",
  "法人",
  "協会",
  "組合",
  "センター",
  "病院",
  "クリニック",
];

function isWeakIssuerLabel_(value) {
  var text = collapseWhitespace_(value);

  if (!text) {
    return true;
  }

  if (WEAK_ISSUER_LABELS_.indexOf(text) !== -1) {
    return true;
  }

  return /^[ぁ-んァ-ヶー]{2,10}$/.test(text);
}

function extractOrganizationCandidates_(value) {
  var text = collapseWhitespace_(value);
  var candidates = [];

  ORGANIZATION_MARKERS_.forEach(function(marker) {
    var pattern = new RegExp("[^\\s　、。()（）]{0,20}" + marker, "g");
    var matches = text.match(pattern) || [];

    matches.forEach(function(match) {
      candidates.push(collapseWhitespace_(match));
    });
  });

  return dedupeOrderedParts_(candidates);
}
```

- [ ] **Step 4: Add issuer-correction helper to `src/ai.js`**

Add this helper before `normalizeAiSuggestion_()` in `src/ai.js`:

```js
function correctIssuerSuggestion_(payload, extractedText) {
  var issuer = normalizeIssuerText_(payload.issuer);

  if (!isWeakIssuerLabel_(issuer)) {
    return issuer;
  }

  var candidates = dedupeOrderedParts_(
    extractOrganizationCandidates_(extractedText || "")
      .concat(extractOrganizationCandidates_(payload.subject || ""))
      .concat(extractOrganizationCandidates_(payload.summary || "")),
  );

  return candidates[0] || issuer;
}
```

- [ ] **Step 5: Update `normalizeAiSuggestion_()` to apply issuer correction**

Change the signature from:

```js
function normalizeAiSuggestion_(payload, fileMeta, config) {
```

to:

```js
function normalizeAiSuggestion_(payload, fileMeta, config, extractedText) {
```

Then change the issuer line from:

```js
issuer: truncateFileSegment_(normalizeIssuerText_(payload.issuer), config.maxIssuerLength),
```

to:

```js
issuer: truncateFileSegment_(correctIssuerSuggestion_(payload, extractedText), config.maxIssuerLength),
```

And in `requestRenameSuggestion_()` change the return statement from:

```js
return normalizeAiSuggestion_(payload, fileMeta, config);
```

to:

```js
return normalizeAiSuggestion_(payload, fileMeta, config, extractedText);
```

- [ ] **Step 6: Run the issuer-correction tests and make them pass**

Run: `bun test tests/issuer-correction.test.mjs`
Expected: PASS.

- [ ] **Step 7: Run the full suite and syntax check**

Run: `bun test && bun run check`
Expected: All tests pass and syntax check succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/utils.js src/ai.js tests/issuer-correction.test.mjs
git commit -m "feat: correct weak issuer labels using OCR context"
```

---

### Task 2: Add regression tests for corrected issuer flow

**Files:**
- Modify: `tests/archive-feature.test.mjs`

- [ ] **Step 1: Add a regression test proving corrected issuer flows into archive outputs**

Add a test like this to `tests/archive-feature.test.mjs`:

```js
test("uses corrected issuer in suggested file name and archive path", () => {
  const context = createAppsScriptContext({
    files: ["src/utils.js", "src/ai.js", "src/filename.js", "src/archive.js"],
  });

  const suggestion = context.normalizeAiSuggestion_(
    {
      documentDate: "2026-04-12",
      issuer: "学級だより",
      documentType: "おたより",
      subject: "4月号",
      summary: "桜小学校 4月号",
      confidence: 0.7,
    },
    {
      name: "scan.pdf",
      createdAt: new Date("2026-04-12T00:00:00Z"),
    },
    {
      timezone: "Asia/Tokyo",
      maxIssuerLength: 50,
      maxDocumentTypeLength: 30,
      maxSubjectLength: 50,
    },
    "桜小学校 学級だより 4月号",
  );

  expect(suggestion.issuer).toBe("桜小学校");
  expect(
    context.buildSuggestedFileName_(
      suggestion,
      { name: "scan.pdf", createdAt: new Date("2026-04-12T00:00:00Z") },
      {
        timezone: "Asia/Tokyo",
        maxIssuerLength: 50,
        maxDocumentTypeLength: 30,
        maxSubjectLength: 50,
      },
    ),
  ).toContain("桜小学校");
  expect(
    context.buildArchiveRelativePath_(
      suggestion,
      {
        maxIssuerLength: 50,
        maxDocumentTypeLength: 30,
      },
    ),
  ).toBe("桜小学校/おたより");
});
```

- [ ] **Step 2: Run the targeted archive feature tests**

Run: `bun test tests/archive-feature.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit only if the test file changed**

```bash
git add tests/archive-feature.test.mjs
git commit -m "test: verify corrected issuer flows through archive pipeline"
```

Only create this commit if the test file changed.

---

### Task 3: Add one-time correction for existing misclassified issuer folders

**Files:**
- Modify: `src/archive.js`
- Test: `tests/archive-issuer-correction.test.mjs`

- [ ] **Step 1: Write failing tests for existing archive issuer correction**

Create `tests/archive-issuer-correction.test.mjs` with a harness based on `tests/archive-issuer-normalization.test.mjs` and cover these cases:

1. weak issuer folder corrected to a stronger school/organization folder
2. merge into an existing corrected issuer folder
3. archive file rename after issuer correction
4. log updates after issuer correction
5. resume behavior with `lastCorrectedIssuerFolder`
6. skip behavior when no strong candidate exists

Use these test names:

```js
test("corrects weak issuer folder to a stronger school folder", () => {})
test("merges into an existing corrected issuer folder", () => {})
test("renames archived file names after issuer correction", () => {})
test("updates log issuer fields after issuer correction", () => {})
test("resumes after lastCorrectedIssuerFolder checkpoint", () => {})
test("skips issuer folder when no strong candidate exists", () => {})
```

- [ ] **Step 2: Run the new test file and verify it fails**

Run: `bun test tests/archive-issuer-correction.test.mjs`
Expected: FAIL because `correctArchiveIssuerFolders()` and its helpers do not exist yet.

- [ ] **Step 3: Add correction helpers to `src/archive.js`**

Add these helpers before the main correction function:

```js
function inferCorrectedIssuerForArchiveFolder_(issuerFolderName, signals) {
  var currentIssuer = normalizeIssuerText_(issuerFolderName);

  if (!isWeakIssuerLabel_(currentIssuer)) {
    return currentIssuer;
  }

  var candidates = dedupeOrderedParts_(
    extractOrganizationCandidates_(signals.text || "")
      .concat(extractOrganizationCandidates_(signals.subject || ""))
      .concat(extractOrganizationCandidates_(signals.summary || ""))
      .concat(extractOrganizationCandidates_(signals.fileNames || "")),
  );

  return candidates[0] || "";
}

function buildArchiveCorrectionSignals_(issuerFolder, logRows, fileNames) {
  return {
    text: logRows.map(function(row) {
      return [row[LOG_HEADER_INDEX_.issuer], row[LOG_HEADER_INDEX_.subject], row[LOG_HEADER_INDEX_.summary]].join(" ");
    }).join(" "),
    subject: logRows.map(function(row) {
      return row[LOG_HEADER_INDEX_.subject] || "";
    }).join(" "),
    summary: logRows.map(function(row) {
      return row[LOG_HEADER_INDEX_.summary] || "";
    }).join(" "),
    fileNames: fileNames.join(" "),
  };
}
```

- [ ] **Step 4: Implement `correctArchiveIssuerFolders()` minimally**

Add `correctArchiveIssuerFolders()` to `src/archive.js` with this behavior:

```js
function correctArchiveIssuerFolders() {
  var config = getConfig_();
  var archiveRootFolderId = requireArchiveRootFolderId_(config);
  var propertiesService = getScriptProperties_();
  var lastCorrected = propertiesService.getProperty("lastCorrectedIssuerFolder") || "";
  var issuerFolders = listDirectChildFolders_(archiveRootFolderId);
  var counts = {
    correctedFolders: 0,
    mergedFolders: 0,
    renamedFiles: 0,
    updatedLogRows: 0,
    skippedFolders: 0,
    failedItems: 0,
  };
  var errors = [];

  issuerFolders.forEach(function(issuerFolder) {
    if (lastCorrected && issuerFolder.title <= lastCorrected) {
      counts.skippedFolders += 1;
      return;
    }

    try {
      var logRows = getIssuerLogRows_(issuerFolder.title, config);
      var documentTypeFolders = listDirectChildFolders_(issuerFolder.id);
      var fileNames = [];

      documentTypeFolders.forEach(function(documentTypeFolder) {
        listFilesInFolder_(documentTypeFolder.id).forEach(function(file) {
          fileNames.push(file.title);
        });
      });

      var correctedIssuer = inferCorrectedIssuerForArchiveFolder_(
        issuerFolder.title,
        buildArchiveCorrectionSignals_(issuerFolder, logRows, fileNames),
      );

      if (!correctedIssuer || correctedIssuer === issuerFolder.title) {
        counts.skippedFolders += 1;
        return;
      }

      var destinationFolder = findChildFolder_(archiveRootFolderId, correctedIssuer) ||
        ensureArchiveFolderByPath_(archiveRootFolderId, correctedIssuer);

      if (destinationFolder.id !== issuerFolder.id) {
        counts.mergedFolders += findChildFolder_(archiveRootFolderId, correctedIssuer) ? 1 : 0;
      }

      documentTypeFolders.forEach(function(documentTypeFolder) {
        var destinationDocumentTypeFolder = ensureArchiveFolderByPath_(
          archiveRootFolderId,
          correctedIssuer + "/" + documentTypeFolder.title,
        );

        listFilesInFolder_(documentTypeFolder.id).forEach(function(file) {
          var nextFileName = buildNormalizedArchiveFileName_(file.title, issuerFolder.title, correctedIssuer);

          if (nextFileName !== file.title) {
            Drive.Files.patch({ title: nextFileName }, file.id, { supportsAllDrives: true });
            counts.renamedFiles += 1;
          }

          moveDriveFileToFolder_(file.id, destinationDocumentTypeFolder.id);
        });

        try {
          deleteEmptyFolder_(documentTypeFolder.id);
        } catch (ignore) {}
      });

      try {
        deleteEmptyFolder_(issuerFolder.id);
      } catch (ignore) {}

      counts.updatedLogRows += correctIssuerRowsInLog_(issuerFolder.title, correctedIssuer, config);
      counts.correctedFolders += 1;
      propertiesService.setProperty("lastCorrectedIssuerFolder", issuerFolder.title);
    } catch (error) {
      counts.failedItems += 1;
      errors.push({
        source: "issuer:" + issuerFolder.id,
        message: getErrorMessage_(error),
      });
    }
  });

  var summary = {
    correctedFolders: counts.correctedFolders,
    mergedFolders: counts.mergedFolders,
    renamedFiles: counts.renamedFiles,
    updatedLogRows: counts.updatedLogRows,
    skippedFolders: counts.skippedFolders,
    failedItems: counts.failedItems,
    errors: errors,
  };

  logInfo_("Archive issuer correction completed.", summary);
  propertiesService.deleteProperty("lastCorrectedIssuerFolder");
  return summary;
}
```

Implement any small supporting helpers needed, such as `getIssuerLogRows_()` and `correctIssuerRowsInLog_()`, using the existing archive normalization helpers as the reference shape. Keep the logic conservative: skip if no strong corrected issuer exists.

- [ ] **Step 5: Run the new archive-correction tests and make them pass**

Run: `bun test tests/archive-issuer-correction.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full suite and syntax check**

Run: `bun test && bun run check`
Expected: All tests pass and syntax check succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/archive.js tests/archive-issuer-correction.test.mjs
git commit -m "feat: correct existing archive issuer folders"
```

---

### Task 4: Document the new one-time issuer-correction function

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README function list and behavior description**

Add this line to the Apps Script functions section in `README.md`:

```md
- `correctArchiveIssuerFolders()`: 誤った発行元フォルダを本文や既存ログの強い候補に基づいて補正し、既存のアーカイブパスとファイル名も更新
```

Also update archive behavior documentation so it mentions:

- weak issuer labels such as personal names or generic document labels are corrected when stronger organization evidence is found

- [ ] **Step 2: Run syntax check**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document issuer correction maintenance task"
```
