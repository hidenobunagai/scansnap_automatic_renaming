import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TEST_DIR, "../..");

function padNumber(value, width) {
  return String(value).padStart(width, "0");
}

function formatString(template, ...args) {
  let index = 0;

  return template.replace(/%0?(\d*)d/g, function(match, width) {
    const value = Number(args[index]);
    index += 1;

    if (!width) {
      return String(value);
    }

    return padNumber(value, Number(width));
  });
}

function formatDate(dateValue, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(dateValue instanceof Date ? dateValue : new Date(dateValue));

  return [
    parts.find(function(part) {
      return part.type === "year";
    }).value,
    parts.find(function(part) {
      return part.type === "month";
    }).value,
    parts.find(function(part) {
      return part.type === "day";
    }).value,
  ].join("-");
}

export function createAppsScriptContext({ files = [], globals = {} } = {}) {
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Math,
    Number,
    Object,
    String,
    Array,
    RegExp,
    Error,
    Utilities: {
      formatDate,
      formatString,
      getUuid() {
        return "00000000-0000-4000-8000-000000000000";
      },
    },
    Session: {
      getScriptTimeZone() {
        return "Asia/Tokyo";
      },
    },
    Logger: {
      log() {},
    },
    ...globals,
  });

  files.forEach(function(relativePath) {
    const absolutePath = resolve(PROJECT_ROOT, relativePath);

    if (!existsSync(absolutePath)) {
      return;
    }

    vm.runInContext(readFileSync(absolutePath, "utf8"), context, {
      filename: absolutePath,
    });
  });

  return context;
}
