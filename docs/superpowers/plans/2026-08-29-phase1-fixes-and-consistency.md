# Phase 1: Fixes, Consistency Tests, and Cross-Platform Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix missing `USER_WEAK_ISSUER_LABELS` in `bootstrap-remote-setup.mjs`, add automated config property consistency tests, and make `npm run check` cross-platform.

**Architecture:** 
- Update `scripts/bootstrap-remote-setup.mjs` to extract `USER_WEAK_ISSUER_LABELS` from env and populate it into the setup request properties.
- Add `tests/config-consistency.test.mjs` using `bun:test` to verify that `.env.example`, `scripts/bootstrap-remote-setup.mjs`, `WRITABLE_SCRIPT_PROPERTIES_`, `DEFAULTS_`, and `getScriptPropertiesTemplate()` stay in sync.
- Create `scripts/check-syntax.mjs` to replace shell `find` in `package.json`'s `check` script.

**Tech Stack:** Bun, Node.js, JavaScript, `bun:test`.

**Spec:** [project_improvement_proposals.md](file:///home/pi/.gemini/antigravity-cli/brain/d546b52b-21a0-4e19-b565-4366c11325ca/project_improvement_proposals.md)

## Global Constraints

- Must pass `bun run check && bun run typecheck && bun run lint && bun run format:check && bun test`.
- Preserve backward compatibility with existing properties and setup flow.

---

### Task 1: Add automated config property consistency tests

**Files:**
- Create: `tests/config-consistency.test.mjs`
- Modify: `scripts/bootstrap-remote-setup.mjs:80-88`

- [ ] **Step 1: Write the failing test**
Create `tests/config-consistency.test.mjs` to test synchronization between `.env.example`, `bootstrap-remote-setup.mjs`, `WRITABLE_SCRIPT_PROPERTIES_`, and `getScriptPropertiesTemplate()`.

- [ ] **Step 2: Run test to verify failure**
Run: `bun test tests/config-consistency.test.mjs`
Expected: FAIL because `USER_WEAK_ISSUER_LABELS` is missing from `bootstrap-remote-setup.mjs`.

- [ ] **Step 3: Update `bootstrap-remote-setup.mjs` to fix the failure**
Add `USER_WEAK_ISSUER_LABELS: getOptionalEnv("USER_WEAK_ISSUER_LABELS")` to `buildSetupRequest()`.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test tests/config-consistency.test.mjs`
Expected: PASS

---

### Task 2: Make `check` script cross-platform

**Files:**
- Create: `scripts/check-syntax.mjs`
- Modify: `package.json:6`

- [ ] **Step 1: Create `scripts/check-syntax.mjs`**
Write a Node.js/Bun script using standard `node:fs` and `node:child_process` (or `node --check`) to recursively scan `src` and `scripts` for `.js` and `.mjs` files and run syntax check.

- [ ] **Step 2: Update `package.json` `check` script**
Change `"check"` to `"node scripts/check-syntax.mjs"`.

- [ ] **Step 3: Run `bun run check` and `bun test` to verify**
Run: `bun run check && bun test`
Expected: PASS

---

### Task 3: Verify all quality checks and format

- [ ] **Step 1: Run format and all CI checks**
Run: `bun run format && bun run check && bun run typecheck && bun run lint && bun run format:check && bun test`
Expected: All pass with 0 errors.
