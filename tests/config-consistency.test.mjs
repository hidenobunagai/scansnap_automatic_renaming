import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("config consistency across files", () => {
  const context = createAppsScriptContext({
    files: ["src/logger.js", "src/utils.js", "src/config.js", "src/main.js"],
  });
  const writableProperties = vm.runInContext("WRITABLE_SCRIPT_PROPERTIES_", context);

  it("includes all writable script properties in getScriptPropertiesTemplate", () => {
    const template = context.getScriptPropertiesTemplate();
    const templateKeys = template
      .split("\n")
      .map((line) => line.split("=")[0].trim())
      .filter(Boolean);

    for (const key of writableProperties) {
      expect(templateKeys).toContain(key);
    }
  });

  it("populates all writable script properties in bootstrap-remote-setup.mjs", () => {
    const scriptPath = resolve(process.cwd(), "scripts/bootstrap-remote-setup.mjs");
    const content = readFileSync(scriptPath, "utf8");

    // All WRITABLE_SCRIPT_PROPERTIES_ must be referenced in bootstrap-remote-setup.mjs
    for (const key of writableProperties) {
      expect(content).toContain(key);
    }
  });

  it("documents all writable script properties in .env.example", () => {
    const envExamplePath = resolve(process.cwd(), ".env.example");
    const content = readFileSync(envExamplePath, "utf8");

    for (const key of writableProperties) {
      expect(content).toContain(key);
    }
  });
});
