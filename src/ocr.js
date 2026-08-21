function extractTextFromPdf_(fileId, config) {
  const pdfFile = DriveApp.getFileById(fileId);
  let tempDocument = null;

  try {
    tempDocument = Drive.Files.insert(
      {
        title: `ocr_${Utilities.getUuid()}`,
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
        Drive.Files.trash(tempDocument.id);
      } catch (error) {
        try {
          Drive.Files.remove(tempDocument.id, { supportsAllDrives: true });
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
