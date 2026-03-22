function setupScanRenameProject() {
  const config = getConfig_();
  const logState = getLogState_(config);
  const summary = {
    logSpreadsheetId: logState.spreadsheetId,
    logSheetName: config.logSheetName,
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
  const logState = getLogState_(config);
  const candidates = listPendingPdfFiles_(config, logState.processedFileMap);
  const counts = {
    renamed: 0,
    review_needed: 0,
    skipped: 0,
    error: 0,
  };
  const results = [];

  candidates.forEach(function(fileMeta) {
    const result = processSinglePdfFile_(fileMeta, config, logState.sheet);

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

function getScriptPropertiesTemplate() {
  const provider = DEFAULTS_.aiProvider;
  const model =
    provider === "gemini" ? DEFAULTS_.defaultGeminiModel : DEFAULTS_.defaultOpenAiModel;

  return [
    "SCANSNAP_FOLDER_ID=",
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

function processSinglePdfFile_(fileMeta, config, logSheet) {
  try {
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
          errorMessage: "OCR returned too little text to build a reliable filename.",
        },
      );
    }

    const suggestion = requestRenameSuggestion_(extractedText, fileMeta, config);
    const suggestedName = ensureUniqueFileName_(
      config.scansnapFolderId,
      buildSuggestedFileName_(suggestion, fileMeta, config),
      fileMeta.id,
    );
    const shouldRename =
      config.renameMode === "rename" &&
      suggestedName !== fileMeta.name &&
      suggestion.confidence >= config.minConfidence;

    if (shouldRename) {
      renameDriveFile_(fileMeta.id, suggestedName);
    }

    return logProcessingResult_(
      logSheet,
      fileMeta,
      {
        status: shouldRename
          ? "renamed"
          : suggestedName === fileMeta.name
            ? "skipped"
            : "review_needed",
        suggestedName: suggestedName,
        finalName: shouldRename ? suggestedName : "",
        confidence: suggestion.confidence,
        documentDate: suggestion.documentDate,
        issuer: suggestion.issuer,
        documentType: suggestion.documentType,
        subject: suggestion.subject,
        summary: suggestion.summary,
        errorMessage: shouldRename
          ? ""
          : suggestedName === fileMeta.name
            ? "Suggested filename matched the current filename."
            : config.renameMode === "review"
              ? "Review mode is enabled."
              : `Confidence ${suggestion.confidence} is below MIN_CONFIDENCE ${config.minConfidence}.`,
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
    errorMessage: result.errorMessage,
  });

  return {
    fileId: fileMeta.id,
    status: result.status,
    originalName: fileMeta.name,
    suggestedName: result.suggestedName,
    finalName: result.finalName,
    confidence: result.confidence,
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
