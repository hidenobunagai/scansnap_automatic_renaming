import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
const examplePath = resolve(process.cwd(), ".env.example");

if (!existsSync(envPath)) {
  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    process.stdout.write(`Created ${envPath} from .env.example\n`);
  } else {
    writeFileSync(envPath, "\n", "utf8");
    process.stdout.write(`Prepared ${envPath}\n`);
  }
} else {
  process.stdout.write(`${envPath} already exists (kept as-is)\n`);
}
