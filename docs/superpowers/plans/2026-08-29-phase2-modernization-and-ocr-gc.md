# Phase 2: Modernization, OCR Auto-Cleanup, and Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize all JavaScript files to ES6+ (`const`/`let`, template literals), implement automated OCR temporary file cleanup (GC), and add test coverage reporting.

**Architecture:**
- Refactor `src/*.js` replacing legacy `var` declarations and string concatenations with ES6+ `const`/`let` and template literals while preserving existing functionality and gas compatibility.
- Implement `cleanupOcrTempDocuments_(config)` in `src/ocr.js` that scans Drive for stale temporary OCR documents (`title starts with ocr_` created > 1 hour ago) and trashes them safely. Hook this into `runScanRenameJob()`.
- Add test in `tests/ocr-gc.test.mjs` verifying that `cleanupOcrTempDocuments_` deletes stale OCR documents and ignores active/recent or non-OCR documents.
- Add `"test:coverage": "bun test --coverage"` to `package.json`.

**Tech Stack:** Bun, JavaScript (V8 ES6+), `bun:test`.

**Spec:** [project_improvement_proposals.md](file:///home/pi/.gemini/antigravity-cli/brain/d546b52b-21a0-4e19-b565-4366c11325ca/project_improvement_proposals.md)

## Global Constraints

- Must pass `bun run check && bun run typecheck && bun run lint && bun run format:check && bun test`.
- Must maintain 100% backward compatibility for all Google Apps Script functions.

---

### Task 1: Refactor `src/*.js` to ES6+ standards

**Files:**
- Modify: `src/utils.js`
- Modify: `src/archive.js`
- Modify: `src/archive-maintenance.js`
- Modify: `src/ai.js`
- Modify: `src/ocr.js`
- Modify: `src/main.js`
- Modify: `src/config.js`
- Modify: `src/drive-compat.js`

- [ ] **Step 1: Refactor `src/utils.js`**
Replace `var` with `const`/`let`, use template literals.

- [ ] **Step 2: Refactor `src/archive.js` and `src/archive-maintenance.js`**
Replace `var` with `const`/`let`, modernize string concatenations.

- [ ] **Step 3: Refactor `src/ai.js`, `src/ocr.js`, `src/main.js`, `src/config.js`, `src/drive-compat.js`**
Replace remaining `var` declarations with `const`/`let`.

- [ ] **Step 4: Verify tests and lint pass**
Run: `bun run check && bun run typecheck && bun run lint && bun test`
Expected: All pass.

---

### Task 2: Implement OCR temporary document GC (garbage collection)

**Files:**
- Create: `tests/ocr-gc.test.mjs`
- Modify: `src/ocr.js`
- Modify: `src/main.js:45-83`

- [ ] **Step 1: Write the failing test**
Create `tests/ocr-gc.test.mjs` to test `cleanupOcrTempDocuments_`.

- [ ] **Step 2: Run test to verify failure**
Run: `bun test tests/ocr-gc.test.mjs`
Expected: FAIL (`cleanupOcrTempDocuments_` is not defined).

- [ ] **Step 3: Implement `cleanupOcrTempDocuments_` in `src/ocr.js` and call it in `runScanRenameJob`**
Implement the function and integrate into `runScanRenameJob`.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test tests/ocr-gc.test.mjs`
Expected: PASS.

---

### Task 3: Add test coverage script and verify full suite

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `test:coverage` to `package.json`**
Add `"test:coverage": "bun test --coverage"` to scripts in `package.json`.

- [ ] **Step 2: Run all checks, formatting, and coverage**
Run: `bun run format && bun run check && bun run typecheck && bun run lint && bun run format:check && bun run test:coverage`
Expected: PASS with full coverage report.
