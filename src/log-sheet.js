const LOG_HEADERS_ = Object.freeze([
  "processedAt",
  "fileId",
  "status",
  "originalName",
  "suggestedName",
  "finalName",
  "confidence",
  "documentDate",
  "issuer",
  "documentType",
  "subject",
  "summary",
  "errorMessage",
  "archiveRelativePath",
  "archiveFinalName",
  "archiveFileId",
]);

const LOG_HEADER_INDEX_ = Object.freeze({
  processedAt: LOG_HEADERS_.indexOf("processedAt"),
  fileId: LOG_HEADERS_.indexOf("fileId"),
  status: LOG_HEADERS_.indexOf("status"),
  originalName: LOG_HEADERS_.indexOf("originalName"),
  suggestedName: LOG_HEADERS_.indexOf("suggestedName"),
  finalName: LOG_HEADERS_.indexOf("finalName"),
  confidence: LOG_HEADERS_.indexOf("confidence"),
  documentDate: LOG_HEADERS_.indexOf("documentDate"),
  issuer: LOG_HEADERS_.indexOf("issuer"),
  documentType: LOG_HEADERS_.indexOf("documentType"),
  subject: LOG_HEADERS_.indexOf("subject"),
  summary: LOG_HEADERS_.indexOf("summary"),
  errorMessage: LOG_HEADERS_.indexOf("errorMessage"),
  archiveRelativePath: LOG_HEADERS_.indexOf("archiveRelativePath"),
  archiveFinalName: LOG_HEADERS_.indexOf("archiveFinalName"),
  archiveFileId: LOG_HEADERS_.indexOf("archiveFileId"),
});

function getLogState_(config) {
  const spreadsheetId = ensureLogSpreadsheetId_(config);
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(config.logSheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(config.logSheetName);
  }

  ensureLogHeaders_(sheet);

  return {
    spreadsheetId: spreadsheet.getId(),
    sheet: sheet,
    fileStateMap: getFileStateMap_(sheet, config.renameMode),
  };
}

function ensureLogSpreadsheetId_(config) {
  if (config.logSpreadsheetId) {
    return config.logSpreadsheetId;
  }

  const spreadsheet = SpreadsheetApp.create("ScanSnap Rename Log");
  const sheet = spreadsheet.getSheets()[0];

  sheet.setName(config.logSheetName);
  ensureLogHeaders_(sheet);
  getScriptProperties_().setProperty("LOG_SPREADSHEET_ID", spreadsheet.getId());

  return spreadsheet.getId();
}

function ensureLogHeaders_(sheet) {
  const range = sheet.getRange(1, 1, 1, LOG_HEADERS_.length);
  const currentHeaders = range.getValues()[0];
  const needsReset = LOG_HEADERS_.some(function(header, index) {
    return currentHeaders[index] !== header;
  });

  if (!needsReset) {
    return;
  }

  range.setValues([LOG_HEADERS_]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, LOG_HEADERS_.length);
}

function getFileStateMap_(sheet, renameMode) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return {};
  }

  const values = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length).getValues();
  const fileStateMap = {};

  values.forEach(function(row) {
    const entry = parseLogRow_(row);

    if (!entry.fileId) {
      return;
    }

    fileStateMap[entry.fileId] = {
      processed: shouldTreatLogRowAsProcessed_(
        entry.status,
        entry.errorMessage,
        renameMode,
        entry.archiveFileId,
      ),
      lastEntry: entry,
    };
  });

  return fileStateMap;
}

function parseLogRow_(row) {
  const currentLayoutEntry = {
    processedAt: getLogRowValue_(row, "processedAt"),
    fileId: getLogRowValue_(row, "fileId"),
    status: getLogRowValue_(row, "status"),
    originalName: getLogRowValue_(row, "originalName"),
    suggestedName: getLogRowValue_(row, "suggestedName"),
    finalName: getLogRowValue_(row, "finalName"),
    confidence: getLogRowNumber_(row, "confidence"),
    documentDate: getLogRowValue_(row, "documentDate"),
    issuer: getLogRowValue_(row, "issuer"),
    documentType: getLogRowValue_(row, "documentType"),
    subject: getLogRowValue_(row, "subject"),
    summary: getLogRowValue_(row, "summary"),
    errorMessage: getLogRowValue_(row, "errorMessage"),
    archiveRelativePath: getLogRowValue_(row, "archiveRelativePath"),
    archiveFinalName: getLogRowValue_(row, "archiveFinalName"),
    archiveFileId: getLogRowValue_(row, "archiveFileId"),
  };

  const temporaryArchiveLayoutEntry = parseTemporaryArchiveLayoutRow_(row);

  if (shouldUseTemporaryArchiveLayout_(currentLayoutEntry, temporaryArchiveLayoutEntry)) {
    return temporaryArchiveLayoutEntry;
  }

  return currentLayoutEntry;
}

function parseTemporaryArchiveLayoutRow_(row) {
  return {
    processedAt: getLogRowValue_(row, "processedAt"),
    fileId: getLogRowValue_(row, "fileId"),
    status: getLogRowValue_(row, "status"),
    originalName: getLogRowValue_(row, "originalName"),
    suggestedName: getLogRowValue_(row, "suggestedName"),
    finalName: getLogRowValue_(row, "finalName"),
    confidence: getLogRowNumber_(row, "confidence"),
    documentDate: getLogRowValue_(row, "documentDate"),
    issuer: getLogRowValue_(row, "issuer"),
    documentType: getLogRowValue_(row, "documentType"),
    subject: getLogRowValue_(row, "subject"),
    summary: getLogRowValue_(row, "summary"),
    archiveRelativePath: collapseWhitespace_(row[12]),
    archiveFinalName: collapseWhitespace_(row[13]),
    archiveFileId: collapseWhitespace_(row[14]),
    errorMessage: collapseWhitespace_(row[15]),
  };
}

function shouldUseTemporaryArchiveLayout_(currentLayoutEntry, temporaryArchiveLayoutEntry) {
  return (
    scoreParsedArchiveLayout_(temporaryArchiveLayoutEntry) >
    scoreParsedArchiveLayout_(currentLayoutEntry)
  );
}

function scoreParsedArchiveLayout_(entry) {
  let score = 0;

  if (looksLikeArchivePath_(entry.archiveRelativePath)) {
    score += 3;
  } else if (!entry.archiveRelativePath) {
    score += 1;
  }

  if (looksLikeArchiveFileName_(entry.archiveFinalName)) {
    score += 2;
  } else if (!entry.archiveFinalName) {
    score += 1;
  }

  if (looksLikeArchiveFileId_(entry.archiveFileId)) {
    score += 2;
  } else if (!entry.archiveFileId) {
    score += 1;
  }

  if (looksLikeErrorMessage_(entry.errorMessage)) {
    score += 2;
  } else if (!entry.errorMessage) {
    score += 1;
  }

  return score;
}

function looksLikeArchivePath_(value) {
  return collapseWhitespace_(value).indexOf("/") !== -1;
}

function looksLikeArchiveFileName_(value) {
  const text = collapseWhitespace_(value);

  if (!text) {
    return false;
  }

  return /\.pdf$/i.test(text);
}

function looksLikeArchiveFileId_(value) {
  const text = collapseWhitespace_(value);

  if (!text) {
    return false;
  }

  return !/\s/.test(text) && text.indexOf("/") === -1 && !/\.pdf$/i.test(text);
}

function looksLikeErrorMessage_(value) {
  const text = collapseWhitespace_(value);

  if (!text) {
    return false;
  }

  return !looksLikeArchivePath_(text) && !looksLikeArchiveFileName_(text);
}

function getLogRowValue_(row, key) {
  const index = LOG_HEADER_INDEX_[key];

  if (typeof index !== "number" || index < 0 || index >= row.length) {
    return "";
  }

  return collapseWhitespace_(row[index]);
}

function getLogRowNumber_(row, key) {
  const index = LOG_HEADER_INDEX_[key];

  if (typeof index !== "number" || index < 0 || index >= row.length) {
    return 0;
  }

  const numeric = Number(row[index]);

  if (Number.isNaN(numeric)) {
    return 0;
  }

  return numeric;
}

function shouldTreatLogRowAsProcessed_(status, errorMessage, renameMode, archiveFileId) {
  if (!status || status === "error" || status === "copy_failed") {
    return false;
  }

  if (
    renameMode === "rename" &&
    status === "review_needed" &&
    errorMessage === "Review mode is enabled."
  ) {
    return false;
  }

  if (
    renameMode === "rename" &&
    (status === "renamed" || status === "skipped") &&
    !collapseWhitespace_(archiveFileId)
  ) {
    return false;
  }

  return true;
}

function appendLogRow_(sheet, entry) {
  sheet.appendRow([
    entry.processedAt || new Date(),
    entry.fileId || "",
    entry.status || "",
    entry.originalName || "",
    entry.suggestedName || "",
    entry.finalName || "",
    typeof entry.confidence === "number" ? entry.confidence : "",
    entry.documentDate || "",
    entry.issuer || "",
    entry.documentType || "",
    entry.subject || "",
    entry.summary || "",
    entry.errorMessage || "",
    entry.archiveRelativePath || "",
    entry.archiveFinalName || "",
    entry.archiveFileId || "",
  ]);
}
