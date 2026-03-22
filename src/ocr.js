function extractTextFromPdf_(fileId, config) {
  const pdfFile = DriveApp.getFileById(fileId);
  let tempDocument = null;

  try {
    tempDocument = Drive.Files.insert(
      {
        title: `ocr_${Utilities.getUuid()}`,
        mimeType: MimeType.GOOGLE_DOCS,
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
      Drive.Files.trash(tempDocument.id);
    }
  }
}
