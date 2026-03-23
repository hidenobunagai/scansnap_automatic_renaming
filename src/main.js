const WRITABLE_SCRIPT_PROPERTIES_ = Object.freeze([
  "SCANSNAP_FOLDER_ID",
  "ARCHIVE_ROOT_FOLDER_ID",
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AI_MODEL",
  "RENAME_MODE",
  "MIN_CONFIDENCE",
  "MAX_FILES_PER_RUN",
  "FILE_STABLE_MINUTES",
  "OCR_LANGUAGE",
  "TRIGGER_MINUTES",
  "TIMEZONE",
  "FILENAME_PATTERN_HINT",
  "LOG_SPREADSHEET_ID",
  "LOG_SHEET_NAME",
  "MAX_PROMPT_CHARS",
  "MAX_SUBJECT_LENGTH",
  "MAX_ISSUER_LENGTH",
  "MAX_DOCUMENT_TYPE_LENGTH",
]);

function setupScanRenameProject() {
  const config = getConfig_();
  const logState = getLogState_(config);
  const summary = {
    logSpreadsheetId: logState.spreadsheetId,
    logSheetName: config.logSheetName,
    archiveRootFolderId: config.archiveRootFolderId,
    renameMode: config.renameMode,
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    triggerMinutes: config.triggerMinutes,
  };

  logInfo_("Scan rename setup completed.", summary);

  return summary;
}

function runScanRenameJob() {
  const config = getConfig_();
  validateRunConfig_(config);
  const logState = getLogState_(config);
  const candidates = listPendingPdfFiles_(config, logState.fileStateMap);
  const counts = {
    renamed: 0,
    review_needed: 0,
    skipped: 0,
    copy_failed: 0,
    error: 0,
  };
  const results = [];

  candidates.forEach(function(fileMeta) {
    const result = processSinglePdfFile_(
      fileMeta,
      config,
      logState.sheet,
      logState.fileStateMap[fileMeta.id] || null,
    );

    results.push(result);
    counts[result.status] = (counts[result.status] || 0) + 1;
  });

  const summary = {
    processed: candidates.length,
    renameMode: config.renameMode,
    counts: counts,
    logSpreadsheetId: logState.spreadsheetId,
    results: results,
  };

  logInfo_("Scan rename run completed.", summary);

  return summary;
}

function installScanRenameTrigger() {
  const config = getConfig_();
  validateRunConfig_(config);
  const removed = removeScanRenameTriggers_();

  ScriptApp.newTrigger("runScanRenameJob").timeBased().everyMinutes(config.triggerMinutes).create();

  const summary = {
    triggerMinutes: config.triggerMinutes,
    removedTriggers: removed,
  };

  logInfo_("Scan rename trigger installed.", summary);

  return summary;
}

function removeScanRenameTriggers() {
  const removed = removeScanRenameTriggers_();

  logInfo_("Scan rename triggers removed.", { removedTriggers: removed });

  return {
    removedTriggers: removed,
  };
}

function applyScanRenameScriptProperties(setupRequest) {
  const request = normalizeSetupRequest_(setupRequest);
  const propertiesService = getScriptProperties_();
  const changedKeys = [];
  const clearedKeys = [];

  WRITABLE_SCRIPT_PROPERTIES_.forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(request.properties, key)) {
      return;
    }

    const rawValue = request.properties[key];

    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") {
      propertiesService.deleteProperty(key);
      clearedKeys.push(key);
      return;
    }

    propertiesService.setProperty(key, String(rawValue).trim());
    changedKeys.push(key);
  });

  const config = getConfig_();
  const summary = {
    changedKeys: changedKeys,
    clearedKeys: clearedKeys,
    config: getSafeConfigSummary_(config),
  };

  logInfo_("Scan rename script properties updated.", summary);

  return summary;
}

function bootstrapScanRenameProjectFromSettings(setupRequest) {
  const request = normalizeSetupRequest_(setupRequest);
  const propertySummary = applyScanRenameScriptProperties(request);
  const setupSummary = setupScanRenameProject();
  const triggerSummary = request.installTrigger ? installScanRenameTrigger() : null;

  return {
    properties: propertySummary,
    setup: setupSummary,
    trigger: triggerSummary,
  };
}

function getScriptPropertiesTemplate() {
  const provider = DEFAULTS_.aiProvider;
  const model =
    provider === "gemini" ? DEFAULTS_.defaultGeminiModel : DEFAULTS_.defaultOpenAiModel;

  return [
    "SCANSNAP_FOLDER_ID=",
    "ARCHIVE_ROOT_FOLDER_ID=",
    `AI_PROVIDER=${provider}`,
    "GEMINI_API_KEY=",
    "OPENAI_API_KEY=",
    `AI_MODEL=${model}`,
    `RENAME_MODE=${DEFAULTS_.renameMode}`,
    `MIN_CONFIDENCE=${DEFAULTS_.minConfidence}`,
    `MAX_FILES_PER_RUN=${DEFAULTS_.maxFilesPerRun}`,
    `FILE_STABLE_MINUTES=${DEFAULTS_.fileStableMinutes}`,
    `OCR_LANGUAGE=${DEFAULTS_.ocrLanguage}`,
    `TRIGGER_MINUTES=${DEFAULTS_.triggerMinutes}`,
    `TIMEZONE=${DEFAULTS_.timezone}`,
    `FILENAME_PATTERN_HINT=${DEFAULTS_.filenamePatternHint}`,
    "LOG_SPREADSHEET_ID=",
  ].join("\n");
}

function validateRunConfig_(config) {
  if (config.renameMode === "rename" && !config.archiveRootFolderId) {
    throw new Error("ARCHIVE_ROOT_FOLDER_ID is required when RENAME_MODE=rename.");
  }
}

function processSinglePdfFile_(fileMeta, config, logSheet, fileState) {
  try {
    const archiveRetryState =
      config.renameMode === "rename" ? buildArchiveRetryState_(fileMeta, fileState) : null;

    if (archiveRetryState) {
      return retryArchiveCopyForFile_(fileMeta, archiveRetryState, config, logSheet);
    }

    const extractedText = extractTextFromPdf_(fileMeta.id, config);

    if (extractedText.length < 20) {
      return logProcessingResult_(
        logSheet,
        fileMeta,
        {
          status: "review_needed",
          suggestedName: "",
          finalName: "",
          confidence: 0,
          documentDate: "",
          issuer: "",
          documentType: "",
          subject: "",
          summary: "",
          archiveRelativePath: "",
          archiveFinalName: "",
          archiveFileId: "",
          errorMessage: "OCR returned too little text to build a reliable filename.",
        },
      );
    }

    const suggestion = requestRenameSuggestion_(extractedText, fileMeta, config);
    const archiveRelativePath = buildArchiveRelativePath_(suggestion, config);
    const isConfident = suggestion.confidence >= config.minConfidence;
    const suggestedName = ensureUniqueFileName_(
      config.scansnapFolderId,
      buildSuggestedFileName_(suggestion, fileMeta, config),
      fileMeta.id,
    );
    const shouldRename =
      config.renameMode === "rename" && suggestedName !== fileMeta.name && isConfident;
    const shouldCopyToArchive = config.renameMode === "rename" && isConfident;
    const sourceFileName = shouldRename ? suggestedName : fileMeta.name;
    const status = determineProcessingStatus_(
      config.renameMode,
      suggestedName,
      fileMeta.name,
      isConfident,
    );
    let archiveFinalName = "";
    let archiveFileId = "";

    if (shouldRename) {
      renameDriveFile_(fileMeta.id, suggestedName);
    }

    if (shouldCopyToArchive) {
      try {
        const archiveCopyResult = copyFileToArchive_(
          fileMeta,
          requireArchiveRootFolderId_(config),
          archiveRelativePath,
          sourceFileName,
        );
        archiveFinalName = archiveCopyResult.archiveFinalName;
        archiveFileId = archiveCopyResult.archiveFileId;
      } catch (error) {
        const message = getErrorMessage_(error);
        const result = logProcessingResult_(
          logSheet,
          fileMeta,
          {
            status: "copy_failed",
            suggestedName: suggestedName,
            finalName: shouldRename ? suggestedName : "",
            confidence: suggestion.confidence,
            documentDate: suggestion.documentDate,
            issuer: suggestion.issuer,
            documentType: suggestion.documentType,
            subject: suggestion.subject,
            summary: suggestion.summary,
            archiveRelativePath: archiveRelativePath,
            archiveFinalName: archiveFinalName,
            archiveFileId: "",
            errorMessage: message,
          },
        );

        logError_("Scan archive copy failed.", {
          fileId: fileMeta.id,
          originalName: fileMeta.name,
          finalName: shouldRename ? suggestedName : fileMeta.name,
          archiveRelativePath: archiveRelativePath,
          error: message,
        });

        return result;
      }
    }

    return logProcessingResult_(
      logSheet,
      fileMeta,
      {
        status: status,
        suggestedName: suggestedName,
        finalName: shouldRename ? suggestedName : "",
        confidence: suggestion.confidence,
        documentDate: suggestion.documentDate,
        issuer: suggestion.issuer,
        documentType: suggestion.documentType,
        subject: suggestion.subject,
        summary: suggestion.summary,
        archiveRelativePath: archiveRelativePath,
        archiveFinalName: archiveFinalName,
        archiveFileId: archiveFileId,
        errorMessage: buildProcessingErrorMessage_(
          status,
          config,
          suggestedName,
          fileMeta.name,
          suggestion.confidence,
          shouldCopyToArchive,
        ),
      },
    );
  } catch (error) {
    const message = getErrorMessage_(error);
    const result = logProcessingResult_(
      logSheet,
      fileMeta,
      {
        status: "error",
        suggestedName: "",
        finalName: "",
        confidence: 0,
        documentDate: "",
        issuer: "",
        documentType: "",
        subject: "",
        summary: "",
        archiveRelativePath: "",
        archiveFinalName: "",
        archiveFileId: "",
        errorMessage: message,
      },
    );

    logError_("Scan rename failed.", {
      fileId: fileMeta.id,
      originalName: fileMeta.name,
      error: message,
    });

    return result;
  }
}

function buildArchiveRetryState_(fileMeta, fileState) {
  const lastEntry = fileState && fileState.lastEntry ? fileState.lastEntry : null;

  if (!lastEntry || lastEntry.status !== "copy_failed") {
    return null;
  }

  const archiveRelativePath = collapseWhitespace_(lastEntry.archiveRelativePath);
  const archiveFinalName = collapseWhitespace_(
    lastEntry.archiveFinalName || lastEntry.finalName || lastEntry.suggestedName || fileMeta.name,
  );

  if (!archiveRelativePath || !archiveFinalName) {
    return null;
  }

  return {
    status: collapseWhitespace_(lastEntry.finalName) ? "renamed" : "skipped",
    suggestedName: collapseWhitespace_(lastEntry.suggestedName) || archiveFinalName,
    finalName: collapseWhitespace_(lastEntry.finalName),
    confidence: typeof lastEntry.confidence === "number" ? lastEntry.confidence : 0,
    documentDate: collapseWhitespace_(lastEntry.documentDate),
    issuer: collapseWhitespace_(lastEntry.issuer),
    documentType: collapseWhitespace_(lastEntry.documentType),
    subject: collapseWhitespace_(lastEntry.subject),
    summary: collapseWhitespace_(lastEntry.summary),
    archiveRelativePath: archiveRelativePath,
    archiveFinalName: archiveFinalName,
  };
}

function retryArchiveCopyForFile_(fileMeta, retryState, config, logSheet) {
  try {
    const archiveCopyResult = copyFileToArchive_(
      fileMeta,
      requireArchiveRootFolderId_(config),
      retryState.archiveRelativePath,
      retryState.archiveFinalName,
      { reuseExisting: true },
    );

    return logProcessingResult_(
      logSheet,
      fileMeta,
      {
        status: retryState.status,
        suggestedName: retryState.suggestedName,
        finalName: retryState.finalName,
        confidence: retryState.confidence,
        documentDate: retryState.documentDate,
        issuer: retryState.issuer,
        documentType: retryState.documentType,
        subject: retryState.subject,
        summary: retryState.summary,
        archiveRelativePath: retryState.archiveRelativePath,
        archiveFinalName: archiveCopyResult.archiveFinalName,
        archiveFileId: archiveCopyResult.archiveFileId,
        errorMessage: "",
      },
    );
  } catch (error) {
    const message = getErrorMessage_(error);
    const result = logProcessingResult_(
      logSheet,
      fileMeta,
      {
        status: "copy_failed",
        suggestedName: retryState.suggestedName,
        finalName: retryState.finalName,
        confidence: retryState.confidence,
        documentDate: retryState.documentDate,
        issuer: retryState.issuer,
        documentType: retryState.documentType,
        subject: retryState.subject,
        summary: retryState.summary,
        archiveRelativePath: retryState.archiveRelativePath,
        archiveFinalName: retryState.archiveFinalName,
        archiveFileId: "",
        errorMessage: message,
      },
    );

    logError_("Scan archive copy failed.", {
      fileId: fileMeta.id,
      originalName: fileMeta.name,
      finalName: retryState.finalName || fileMeta.name,
      archiveRelativePath: retryState.archiveRelativePath,
      error: message,
    });

    return result;
  }
}

function determineProcessingStatus_(renameMode, suggestedName, currentName, isConfident) {
  if (renameMode === "rename" && !isConfident) {
    return "review_needed";
  }

  if (suggestedName === currentName) {
    return "skipped";
  }

  if (renameMode === "rename") {
    return "renamed";
  }

  return "review_needed";
}

function buildProcessingErrorMessage_(
  status,
  config,
  suggestedName,
  currentName,
  confidence,
  shouldCopyToArchive,
) {
  if (status === "renamed" || shouldCopyToArchive) {
    return "";
  }

  if (status === "review_needed") {
    if (config.renameMode === "review") {
      return "Review mode is enabled.";
    }

    return `Confidence ${confidence} is below MIN_CONFIDENCE ${config.minConfidence}.`;
  }

  if (status === "skipped" && suggestedName === currentName) {
    return "Suggested filename matched the current filename.";
  }

  return "";
}

function requireArchiveRootFolderId_(config) {
  const folderId = collapseWhitespace_(config.archiveRootFolderId);

  if (!folderId) {
    throw new Error("Missing script property: ARCHIVE_ROOT_FOLDER_ID");
  }

  return folderId;
}

function copyFileToArchive_(
  fileMeta,
  archiveRootFolderId,
  archiveRelativePath,
  sourceFileName,
  options,
) {
  const archiveFolder = ensureArchiveFolderByPath_(archiveRootFolderId, archiveRelativePath);
  const copyOptions = options || {};

  if (copyOptions.reuseExisting) {
    const existingFile = findDriveFileByNameInFolder_(archiveFolder.id, sourceFileName);

    if (existingFile) {
      return {
        archiveFinalName: collapseWhitespace_(existingFile.title) || sourceFileName,
        archiveFileId: String(existingFile.id || ""),
      };
    }
  }

  const archiveFinalName = ensureUniqueFileNameInFolder_(
    archiveFolder.id,
    sourceFileName,
  );
  const archiveFileId = String(
    (copyDriveFileToFolder_(fileMeta.id, archiveFolder.id, archiveFinalName) || {}).id || "",
  );

  return {
    archiveFinalName: archiveFinalName,
    archiveFileId: archiveFileId,
  };
}

function logProcessingResult_(logSheet, fileMeta, result) {
  appendLogRow_(logSheet, {
    processedAt: new Date(),
    fileId: fileMeta.id,
    status: result.status,
    originalName: fileMeta.name,
    suggestedName: result.suggestedName,
    finalName: result.finalName,
    confidence: result.confidence,
    documentDate: result.documentDate,
    issuer: result.issuer,
    documentType: result.documentType,
    subject: result.subject,
    summary: result.summary,
    archiveRelativePath: result.archiveRelativePath,
    archiveFinalName: result.archiveFinalName,
    archiveFileId: result.archiveFileId,
    errorMessage: result.errorMessage,
  });

  return {
    fileId: fileMeta.id,
    status: result.status,
    originalName: fileMeta.name,
    suggestedName: result.suggestedName,
    finalName: result.finalName,
    confidence: result.confidence,
    archiveRelativePath: result.archiveRelativePath,
    archiveFinalName: result.archiveFinalName,
    archiveFileId: result.archiveFileId,
    errorMessage: result.errorMessage,
  };
}

function removeScanRenameTriggers_() {
  let removed = 0;

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() !== "runScanRenameJob") {
      return;
    }

    ScriptApp.deleteTrigger(trigger);
    removed += 1;
  });

  return removed;
}

function normalizeSetupRequest_(setupRequest) {
  if (!setupRequest || typeof setupRequest !== "object" || Array.isArray(setupRequest)) {
    throw new Error("Setup request must be an object.");
  }

  const properties = setupRequest.properties;

  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error("Setup request must include a properties object.");
  }

  return {
    properties: properties,
    installTrigger: setupRequest.installTrigger !== false,
  };
}

function getSafeConfigSummary_(config) {
  return {
    scansnapFolderId: config.scansnapFolderId,
    archiveRootFolderId: config.archiveRootFolderId,
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    renameMode: config.renameMode,
    minConfidence: config.minConfidence,
    maxFilesPerRun: config.maxFilesPerRun,
    fileStableMinutes: config.fileStableMinutes,
    ocrLanguage: config.ocrLanguage,
    timezone: config.timezone,
    logSpreadsheetId: config.logSpreadsheetId,
    logSheetName: config.logSheetName,
    filenamePatternHint: config.filenamePatternHint,
    triggerMinutes: config.triggerMinutes,
  };
}
