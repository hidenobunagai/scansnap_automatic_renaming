import { spawnSync } from "node:child_process";

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value || "";
}

function getFolderId(idKey, urlKey) {
  const rawValue = getOptionalEnv(idKey) || getOptionalEnv(urlKey);

  if (!rawValue) {
    throw new Error(`Set ${idKey} or ${urlKey} before running remote setup.`);
  }

  const urlMatch = rawValue.match(/\/folders\/([a-zA-Z0-9_-]+)/);

  if (urlMatch) {
    return urlMatch[1];
  }

  return rawValue;
}

function buildSetupRequest() {
  const aiProvider = (getOptionalEnv("AI_PROVIDER") || "gemini").toLowerCase();
  const request = {
    properties: {
      SCANSNAP_FOLDER_ID: getFolderId("SCANSNAP_FOLDER_ID", "SCANSNAP_FOLDER_URL"),
      ARCHIVE_ROOT_FOLDER_ID: getFolderId("ARCHIVE_ROOT_FOLDER_ID", "ARCHIVE_ROOT_FOLDER_URL"),
      AI_PROVIDER: aiProvider,
      AI_MODEL: getOptionalEnv("AI_MODEL"),
      RENAME_MODE: getOptionalEnv("RENAME_MODE") || "review",
      MIN_CONFIDENCE: getOptionalEnv("MIN_CONFIDENCE") || "0.75",
      MAX_FILES_PER_RUN: getOptionalEnv("MAX_FILES_PER_RUN") || "5",
      FILE_STABLE_MINUTES: getOptionalEnv("FILE_STABLE_MINUTES") || "5",
      OCR_LANGUAGE: getOptionalEnv("OCR_LANGUAGE") || "ja",
      TRIGGER_MINUTES: getOptionalEnv("TRIGGER_MINUTES") || "15",
      TIMEZONE: getOptionalEnv("TIMEZONE") || "Asia/Tokyo",
      FILENAME_PATTERN_HINT:
        getOptionalEnv("FILENAME_PATTERN_HINT") || "YYYY-MM-DD_発行元_書類種別_要点",
      LOG_SPREADSHEET_ID: getOptionalEnv("LOG_SPREADSHEET_ID"),
      LOG_SHEET_NAME: getOptionalEnv("LOG_SHEET_NAME") || "scan_rename_log",
      MAX_PROMPT_CHARS: getOptionalEnv("MAX_PROMPT_CHARS") || "12000",
      MAX_SUBJECT_LENGTH: getOptionalEnv("MAX_SUBJECT_LENGTH") || "40",
      MAX_ISSUER_LENGTH: getOptionalEnv("MAX_ISSUER_LENGTH") || "30",
      MAX_DOCUMENT_TYPE_LENGTH: getOptionalEnv("MAX_DOCUMENT_TYPE_LENGTH") || "30",
    },
    installTrigger: (getOptionalEnv("INSTALL_TRIGGER") || "true").toLowerCase() !== "false",
  };

  if (aiProvider === "gemini") {
    request.properties.GEMINI_API_KEY = getRequiredEnv("GEMINI_API_KEY");
  } else if (aiProvider === "openai") {
    request.properties.OPENAI_API_KEY = getRequiredEnv("OPENAI_API_KEY");
    request.properties.OPENAI_BASE_URL =
      getOptionalEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1/chat/completions";
  } else {
    throw new Error("AI_PROVIDER must be gemini or openai.");
  }

  return request;
}

function main() {
  const setupRequest = buildSetupRequest();

  runCommand("bun", ["run", "clasp:push"]);
  runCommand("clasp", ["version", `remote setup ${new Date().toISOString()}`]);
  runCommand("clasp", ["deploy", "-d", "API executable"]);
  runCommand("clasp", [
    "run",
    "bootstrapScanRenameProjectFromSettings",
    "--params",
    JSON.stringify([setupRequest]),
  ]);
}

main();
