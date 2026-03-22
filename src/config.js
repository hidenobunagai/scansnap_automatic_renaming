const DEFAULTS_ = Object.freeze({
  aiProvider: "gemini",
  renameMode: "review",
  minConfidence: 0.75,
  maxFilesPerRun: 5,
  fileStableMinutes: 5,
  ocrLanguage: "ja",
  timezone: "Asia/Tokyo",
  logSheetName: "scan_rename_log",
  defaultGeminiModel: "gemini-2.0-flash-lite",
  defaultOpenAiModel: "gpt-5-mini",
  filenamePatternHint: "YYYY-MM-DD_発行元_書類種別_要点",
  maxPromptChars: 12000,
  maxSubjectLength: 40,
  maxIssuerLength: 30,
  maxDocumentTypeLength: 30,
  triggerMinutes: 15,
});

function getConfig_() {
  const properties = getScriptProperties_().getProperties();
  const aiProvider = normalizeAiProvider_(
    getStringProperty_(properties, "AI_PROVIDER", DEFAULTS_.aiProvider),
  );
  const aiModel = getStringProperty_(
    properties,
    "AI_MODEL",
    aiProvider === "gemini" ? DEFAULTS_.defaultGeminiModel : DEFAULTS_.defaultOpenAiModel,
  );

  return {
    scansnapFolderId: requireStringProperty_(properties, "SCANSNAP_FOLDER_ID"),
    aiProvider: aiProvider,
    aiModel: aiModel,
    renameMode: normalizeRenameMode_(
      getStringProperty_(properties, "RENAME_MODE", DEFAULTS_.renameMode),
    ),
    minConfidence: clampNumber_(
      parseNumberProperty_(properties, "MIN_CONFIDENCE", DEFAULTS_.minConfidence),
      0,
      1,
    ),
    maxFilesPerRun: Math.max(
      1,
      Math.floor(parseNumberProperty_(properties, "MAX_FILES_PER_RUN", DEFAULTS_.maxFilesPerRun)),
    ),
    fileStableMinutes: Math.max(
      1,
      Math.floor(
        parseNumberProperty_(properties, "FILE_STABLE_MINUTES", DEFAULTS_.fileStableMinutes),
      ),
    ),
    ocrLanguage: getStringProperty_(properties, "OCR_LANGUAGE", DEFAULTS_.ocrLanguage),
    timezone: getStringProperty_(properties, "TIMEZONE", DEFAULTS_.timezone),
    logSpreadsheetId: getStringProperty_(properties, "LOG_SPREADSHEET_ID", ""),
    logSheetName: getStringProperty_(properties, "LOG_SHEET_NAME", DEFAULTS_.logSheetName),
    filenamePatternHint: getStringProperty_(
      properties,
      "FILENAME_PATTERN_HINT",
      DEFAULTS_.filenamePatternHint,
    ),
    maxPromptChars: Math.max(
      1000,
      Math.floor(parseNumberProperty_(properties, "MAX_PROMPT_CHARS", DEFAULTS_.maxPromptChars)),
    ),
    maxSubjectLength: Math.max(
      10,
      Math.floor(
        parseNumberProperty_(properties, "MAX_SUBJECT_LENGTH", DEFAULTS_.maxSubjectLength),
      ),
    ),
    maxIssuerLength: Math.max(
      10,
      Math.floor(parseNumberProperty_(properties, "MAX_ISSUER_LENGTH", DEFAULTS_.maxIssuerLength)),
    ),
    maxDocumentTypeLength: Math.max(
      10,
      Math.floor(
        parseNumberProperty_(
          properties,
          "MAX_DOCUMENT_TYPE_LENGTH",
          DEFAULTS_.maxDocumentTypeLength,
        ),
      ),
    ),
    triggerMinutes: normalizeTriggerMinutes_(
      parseNumberProperty_(properties, "TRIGGER_MINUTES", DEFAULTS_.triggerMinutes),
    ),
    geminiApiKey: aiProvider === "gemini" ? requireStringProperty_(properties, "GEMINI_API_KEY") : "",
    openAiApiKey: aiProvider === "openai" ? requireStringProperty_(properties, "OPENAI_API_KEY") : "",
    openAiBaseUrl: getStringProperty_(
      properties,
      "OPENAI_BASE_URL",
      "https://api.openai.com/v1/chat/completions",
    ),
  };
}

function getScriptProperties_() {
  return PropertiesService.getScriptProperties();
}

function requireStringProperty_(properties, key) {
  const value = getStringProperty_(properties, key, "");

  if (!value) {
    throw new Error(`Missing script property: ${key}`);
  }

  return value;
}

function getStringProperty_(properties, key, fallbackValue) {
  const value = properties[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return fallbackValue;
}

function parseNumberProperty_(properties, key, fallbackValue) {
  const value = getStringProperty_(properties, key, "");

  if (!value) {
    return fallbackValue;
  }

  const numeric = Number(value);

  if (Number.isNaN(numeric)) {
    throw new Error(`Script property ${key} must be numeric.`);
  }

  return numeric;
}

function normalizeRenameMode_(value) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "review" || normalized === "rename") {
    return normalized;
  }

  throw new Error("RENAME_MODE must be either review or rename.");
}

function normalizeAiProvider_(value) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "gemini" || normalized === "openai") {
    return normalized;
  }

  throw new Error("AI_PROVIDER must be either gemini or openai.");
}

function normalizeTriggerMinutes_(value) {
  const minutes = Math.floor(Number(value));
  const supported = [1, 5, 10, 15, 30];

  if (supported.indexOf(minutes) === -1) {
    throw new Error("TRIGGER_MINUTES must be one of 1, 5, 10, 15, 30.");
  }

  return minutes;
}
