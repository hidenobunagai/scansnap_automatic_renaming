# Issuer Normalization Design

## Context

After migrating the archive structure to `発行元/書類種別`, issuer folders are now the
top-level grouping. Existing archive data shows issuer name drift caused by full-width and
half-width alphanumeric variants, for example:

- `パークホームズＬａＬａ新三郷管理組合`
- `パークホームズLaLa新三郷管理組合`

The user wants issuer naming normalized to half-width alphanumerics so that:

- new archive folders are created consistently
- new file names use the same issuer representation
- log sheet issuer-related values stay aligned
- existing archive folders, archived file names, and log rows are also normalized once

## Design

### 1. Normalize issuer text only

Add an issuer-specific normalization helper in `src/utils.js`.

Rules:

- convert full-width ASCII letters to half-width letters
- convert full-width digits to half-width digits
- convert full-width spaces to half-width spaces
- leave kana and kanji unchanged
- keep existing sanitization and truncation behavior after issuer normalization

Example conversions:

- `ＬａＬａ` -> `LaLa`
- `Ｗismettac` -> `Wismettac`
- `パークホームズＬａＬａ新三郷管理組合` -> `パークホームズLaLa新三郷管理組合`

This normalization is intentionally scoped to `issuer`. `documentType`, `subject`, and other
fields are left unchanged.

### 2. Apply normalization at issuer source of truth

Apply issuer normalization in `src/ai.js` inside `normalizeAiSuggestion_()` before the issuer is
passed to `truncateFileSegment_()`.

That makes the normalized issuer the single source of truth for downstream usage:

- archive folder path generation in `src/archive.js`
- suggested file name generation in `src/filename.js`
- log sheet writes in `src/main.js` and `src/log-sheet.js`

No additional normalization is added at each consumer. The normalized issuer value simply flows
through the existing pipeline.

### 3. One-time existing archive normalization

Add a one-time Apps Script function in `src/archive.js` to normalize existing issuer folders and
issuer-derived file names.

Proposed function name:

```js
normalizeArchiveIssuerNames()
```

Responsibilities:

1. Traverse archive root direct child folders (issuer folders)
2. Compute normalized issuer folder name with the new issuer normalization helper
3. If normalized folder name differs:
   - rename the folder if there is no collision
   - otherwise merge contents into the normalized target folder
4. For all files inside each issuer folder's document-type subfolders:
   - rewrite the issuer portion of the archive file name to the normalized issuer
5. Update log sheet rows so issuer-related fields match the normalized archive state

### 4. Existing folder merge behavior

When multiple issuer folders collapse to the same normalized name:

- pick the normalized-name folder as the canonical destination
- move document-type subfolders or their files into the canonical destination
- if the destination already contains the same document-type subfolder, merge file contents there
- delete only folders that are empty after migration

The operation should be idempotent enough to resume without duplicating successful moves.

### 5. Existing file and log updates

For existing archive data, normalization applies to:

- top-level issuer folder names
- archived PDF file names where the issuer segment appears in the generated filename format
- log sheet `issuer`
- log sheet `archiveRelativePath`
- log sheet `archiveFinalName`

`archiveFileId` remains unchanged because the underlying Drive file is the same file even when the
name changes.

### 6. Safety and resume strategy

The one-time normalization function should follow the same safety posture as the archive folder
migration:

- persist progress in Script Properties so timeout recovery is possible
- process one issuer folder at a time
- record counts for renamed folders, merged folders, renamed files, updated log rows, and failures
- continue past per-file failures and report them in the final summary
- only update log rows for entities that were successfully normalized

Suggested checkpoint property:

```text
lastNormalizedIssuerFolder
```

### 7. Testing scope

Add tests for:

- issuer normalization helper behavior for full-width and half-width alphanumeric inputs
- `normalizeAiSuggestion_()` applying issuer normalization before truncation
- existing archive normalization logic covering:
  - folder rename without collision
  - merge into an already-normalized issuer folder
  - archived file rename with normalized issuer segment
  - log row updates for `issuer`, `archiveRelativePath`, and `archiveFinalName`
  - resume behavior after partial completion

## Scope

- Modify: `src/utils.js`
- Modify: `src/ai.js`
- Modify: `src/archive.js`
- Modify or create tests under `tests/`

## Non-Goals

- No normalization for `documentType` or `subject`
- No changes to OCR extraction rules or AI prompt wording
- No fuzzy issuer matching beyond deterministic full-width/half-width normalization
