function extractTextFromPdf_(fileId, config) {
  const pdfFile = DriveApp.getFileById(fileId);
  let tempDocument = null;

  try {
    var ocrTempTitle = `ocr_${Utilities.getUuid()}`;
    tempDocument = driveFilesInsertCompat_(
      {
        title: ocrTempTitle,
        name: ocrTempTitle,
      },
      pdfFile.getBlob(),
      {
        convert: true,
        ocr: true,
        ocrLanguage: config.ocrLanguage,
        supportsAllDrives: true,
      },
    );

    return collapseWhitespace_(DocumentApp.openById(tempDocument.id).getBody().getText());
  } finally {
    if (tempDocument && tempDocument.id) {
      try {
        driveFilesTrashCompat_(tempDocument.id);
      } catch (error) {
        try {
          driveFilesRemoveCompat_(tempDocument.id);
        } catch (ignore) {
          if (typeof logError_ === "function") {
            logError_("Failed to clean up OCR temp document.", {
              tempDocumentId: tempDocument.id,
              error: getErrorMessage_(error),
            });
          }
        }
      }
    }
  }
}
