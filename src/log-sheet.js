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
]);

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
    processedFileMap: getProcessedFileMap_(sheet),
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

function getProcessedFileMap_(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return {};
  }

  const values = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length).getValues();
  const processedFileMap = {};

  values.forEach(function(row) {
    const fileId = collapseWhitespace_(row[1]);
    const status = collapseWhitespace_(row[2]);

    if (fileId && status !== "error") {
      processedFileMap[fileId] = true;
    }
  });

  return processedFileMap;
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
  ]);
}
