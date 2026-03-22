import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const scriptId = process.env.CLASP_SCRIPT_ID?.trim();

if (!scriptId) {
  throw new Error("CLASP_SCRIPT_ID is missing. Set it with `dotenvx set CLASP_SCRIPT_ID your-script-id`.");
}

const projectId = process.env.CLASP_PROJECT_ID?.trim();
const rootDir = process.env.CLASP_ROOT_DIR?.trim() || "src";
const claspConfigPath = resolve(process.cwd(), ".clasp.json");

writeFileSync(
  claspConfigPath,
  `${JSON.stringify({ scriptId, rootDir, ...(projectId ? { projectId } : {}) }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(`Wrote ${claspConfigPath}\n`);
