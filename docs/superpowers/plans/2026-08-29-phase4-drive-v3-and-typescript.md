# Phase 4: Drive API v3 Migration & TypeScript Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete migration to Google Drive API v3 (`version: "v3"` in `appsscript.json`) and ensure robust v3 compatibility across all drive operations, plus finalize TypeScript typing standards.

**Architecture:**
- **Drive API v3 Migration**:
  - `src/appsscript.json`: update `dependencies.enabledAdvancedServices[Drive].version` from `"v2"` to `"v3"`.
  - In Drive v3:
    - `Files.list()` uses `pageSize` (not `maxResults`), and query uses `name` instead of `title`. Also `fields` parameter is standard in v3.
    - `Files.create()` / `Files.update()` instead of `Files.insert()` / `Files.patch()`.
    - Response structure uses `files` (not `items`), and file property is `name` (not `title`), `createdTime` (not `createdDate`).
    - `Drive.Files.trash()` does not exist in v3; trashing is `Drive.Files.update({ trashed: true }, fileId)`.
    - `src/drive-compat.js` bridges all these differences cleanly so all call sites work seamlessly on both v2 and v3.
- **Drive v3 Testing**:
  - Add comprehensive unit tests in `tests/drive-compat.test.mjs` asserting all compat helper functions work against strict v3 API mock schemas.
- **TypeScript & Type Checking**:
  - Refine `jsconfig.json` / `@types/google-apps-script` definitions, ensuring 100% strict typechecking with `tsc`.

**Tech Stack:** Bun, Google Apps Script (Drive API v3, DriveApp), `bun:test`, TypeScript `tsc`.

---

### Task 1: Complete Drive API v3 Compatibility & Tests

**Files:**
- Modify: `src/appsscript.json`
- Modify: `src/drive-compat.js`
- Modify: `src/drive.js`
- Modify: `src/archive.js`
- Modify: `src/archive-maintenance.js`
- Modify: `src/ocr.js`
- Create: `tests/drive-compat.test.mjs`

- [ ] **Step 1: Write Drive v3 unit tests**
Create `tests/drive-compat.test.mjs` verifying `driveFilesListCompat_`, `driveFilesInsertCompat_`, `driveFilesPatchTitleCompat_`, `driveFilesTrashCompat_`, `driveFilesRemoveCompat_`, `getDriveFileTitle_`, `getDriveCreatedDate_`, `getDriveFileItems_`, `getDriveNextPageToken_` with both pure v3 and v2 mock objects.

- [ ] **Step 2: Run test to verify failure / gaps**
Run: `bun test tests/drive-compat.test.mjs`

- [ ] **Step 3: Update `src/drive-compat.js` and `src/appsscript.json`**
Update `appsscript.json` to `"version": "v3"`. Ensure `driveFilesTrashCompat_` uses `Drive.Files.update({ trashed: true }, fileId)` for v3 and `Drive.Files.trash(fileId)` for v2. Ensure query translation (e.g. `title contains` → `name contains`) is transparently handled if needed.

- [ ] **Step 4: Run test to verify pass**
Run: `bun test tests/drive-compat.test.mjs`
Expected: PASS.

---

### Task 2: Type Definition & Build Verification

**Files:**
- Modify: `jsconfig.json`
- Modify: `docs/runbook.md`

- [ ] **Step 1: Verify and strengthen TypeScript checking with `jsconfig.json`**
Ensure `tsc --noEmit` checks all `src/`, `scripts/`, `tests/` cleanly.

- [ ] **Step 2: Update `docs/runbook.md`**
Update Drive API section in `docs/runbook.md` to reflect full v3 migration.

- [ ] **Step 3: Run full verification suite**
Run: `bun run format && bun run check && bun run typecheck && bun run lint && bun run format:check && bun run test:coverage`
Expected: All pass.
