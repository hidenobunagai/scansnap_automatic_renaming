import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");

if (!existsSync(envPath)) {
  writeFileSync(envPath, "\n", "utf8");
}

process.stdout.write(`Prepared ${envPath}\n`);
