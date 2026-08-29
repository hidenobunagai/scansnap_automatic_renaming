# Phase 3: Gemini Direct Multimodal, Spreadsheet Custom Menu & Retry Status, and Webhook Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement direct Gemini multimodal PDF processing mode (`PDF_INPUT_MODE`), spreadsheet custom menu and `retry` status handling, and webhook notifications (`NOTIFICATION_WEBHOOK_URL`).

**Architecture:**
- **Direct Gemini Multimodal (`PDF_INPUT_MODE`)**:
  - Add `PDF_INPUT_MODE` config option (`drive_ocr` [default] | `direct_ai`).
  - When `direct_ai` and `aiProvider === "gemini"`, fetch the PDF blob as base64 and send it directly in the Gemini `contents[].parts` payload with `inlineData: { mimeType: "application/pdf", data: base64 }`.
  - Fall back gracefully to `drive_ocr` when provider is OpenAI or if explicitly configured.
- **Spreadsheet Menu & Retry Status**:
  - Update `shouldTreatLogRowAsProcessed_` in `src/log-sheet.js` so that rows with `status === "retry"` are treated as pending and processed again.
  - Implement `onOpen()` in `src/main.js` creating a custom menu "ScanSnap操作" in Google Sheets with actions `runScanRenameJob` and `retrySelectedScanRenameRows`.
- **Webhook Notifications (`NOTIFICATION_WEBHOOK_URL`)**:
  - Add `NOTIFICATION_WEBHOOK_URL` to `WRITABLE_SCRIPT_PROPERTIES_`, `DEFAULTS_`, `.env.example`, and `bootstrap-remote-setup.mjs`.
  - In `maybeSendFailureNotification_`, if `notificationWebhookUrl` is configured, send a JSON POST request containing the summary.

**Tech Stack:** Bun, Google Apps Script (DriveApp, UrlFetchApp, SpreadsheetApp), `bun:test`.

**Spec:** [project_improvement_proposals.md](file:///home/pi/.gemini/antigravity-cli/brain/d546b52b-21a0-4e19-b565-4366c11325ca/project_improvement_proposals.md)

## Global Constraints

- Must pass `bun run check && bun run typecheck && bun run lint && bun run format:check && bun test`.
- Must maintain 100% backward compatibility with existing properties and default behavior.

---

### Task 1: Direct Gemini Multimodal PDF Processing Mode

**Files:**
- Modify: `src/config.js`
- Modify: `src/main.js`
- Modify: `src/ai.js`
- Modify: `scripts/bootstrap-remote-setup.mjs`
- Modify: `.env.example`
- Create: `tests/direct-ai-mode.test.mjs`

- [ ] **Step 1: Write the failing test**
Create `tests/direct-ai-mode.test.mjs` testing that `requestRenameSuggestion_` supports `direct_ai` mode sending `inlineData` with base64 PDF when `pdfInputMode: "direct_ai"`.

- [ ] **Step 2: Run test to verify failure**
Run: `bun test tests/direct-ai-mode.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `direct_ai` mode in `src/ai.js`, `src/config.js`, `src/main.js`, `scripts/bootstrap-remote-setup.mjs`, `.env.example`**
Implement the direct PDF multimodal call for Gemini and integrate it with `processSinglePdfFile_`.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test tests/direct-ai-mode.test.mjs`
Expected: PASS.

---

### Task 2: Spreadsheet Retry Status & Custom Menu

**Files:**
- Modify: `src/log-sheet.js`
- Modify: `src/main.js`
- Create: `tests/spreadsheet-retry-and-menu.test.mjs`

- [ ] **Step 1: Write the failing test**
Create `tests/spreadsheet-retry-and-menu.test.mjs` testing `shouldTreatLogRowAsProcessed_` with `status === "retry"` and menu action helper `retrySelectedScanRenameRows`.

- [ ] **Step 2: Run test to verify failure**
Run: `bun test tests/spreadsheet-retry-and-menu.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement retry status in `src/log-sheet.js` and `onOpen` / menu handlers in `src/main.js`**
Update `shouldTreatLogRowAsProcessed_` and add `onOpen()` and `retrySelectedScanRenameRows()`.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test tests/spreadsheet-retry-and-menu.test.mjs`
Expected: PASS.

---

### Task 3: Webhook Notification Support

**Files:**
- Modify: `src/config.js`
- Modify: `src/main.js`
- Modify: `scripts/bootstrap-remote-setup.mjs`
- Modify: `.env.example`
- Create: `tests/webhook-notification.test.mjs`

- [ ] **Step 1: Write the failing test**
Create `tests/webhook-notification.test.mjs` testing `maybeSendFailureNotification_` sending POST requests to `notificationWebhookUrl`.

- [ ] **Step 2: Run test to verify failure**
Run: `bun test tests/webhook-notification.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement webhook sending in `src/main.js` and register properties**
Update `maybeSendFailureNotification_`, `src/config.js`, `scripts/bootstrap-remote-setup.mjs`, `.env.example`.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test tests/webhook-notification.test.mjs`
Expected: PASS.

---

### Task 4: Full CI Validation & Doc Updates

**Files:**
- Modify: `docs/runbook.md`
- Modify: `README.md`

- [ ] **Step 1: Update documentation**
Add `PDF_INPUT_MODE`, `NOTIFICATION_WEBHOOK_URL`, and spreadsheet menu usage to `README.md` and `docs/runbook.md`.

- [ ] **Step 2: Run all checks, lint, format, and test suite**
Run: `bun run format && bun run check && bun run typecheck && bun run lint && bun run format:check && bun test`
Expected: All pass with 0 errors.
