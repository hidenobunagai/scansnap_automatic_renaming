import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const targetDirs = ["src", "scripts"];
const validExtensions = new Set([".js", ".mjs"]);

function collectFiles(dir) {
  const files = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (stat.isFile() && validExtensions.has(extname(fullPath))) {
      files.push(fullPath);
    }
  }

  return files;
}

function main() {
  const rootDir = process.cwd();
  const allFiles = [];

  for (const dir of targetDirs) {
    const dirPath = resolve(rootDir, dir);
    allFiles.push(...collectFiles(dirPath));
  }

  let errorCount = 0;

  for (const file of allFiles) {
    const result = spawnSync(process.execPath, ["--check", file], {
      stdio: "inherit",
    });

    if (result.status !== 0) {
      errorCount += 1;
    }
  }

  if (errorCount > 0) {
    process.stderr.write(`Syntax check failed with ${errorCount} error(s).\n`);
    process.exit(1);
  }

  process.stdout.write(`Syntax check passed for ${allFiles.length} file(s).\n`);
}

main();
