import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        Drive: "readonly",
        DriveApp: "readonly",
        DocumentApp: "readonly",
        Utilities: "readonly",
        Session: "readonly",
        Logger: "readonly",
        ScriptApp: "readonly",
        SpreadsheetApp: "readonly",
        UrlFetchApp: "readonly",
        PropertiesService: "readonly",
        MailApp: "readonly",
        console: "readonly",
      },
    },
    rules: {
      // GAS entry points are invoked by the Apps Script runtime, not by imports.
      "no-unused-vars": "off",
      // GAS files share a global scope via clasp; cross-file refs are intentional.
      "no-undef": "off",
      eqeqeq: ["warn", "smart"],
      "no-constant-condition": "warn",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
  {
    ignores: ["node_modules/", ".worktrees/", "docs/"],
  },
]);
