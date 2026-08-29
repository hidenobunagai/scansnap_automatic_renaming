function extractTextFromPdf_(fileId, config) {
  const pdfFile = DriveApp.getFileById(fileId);
  let tempDocument = null;

  try {
    const ocrTempTitle = `ocr_${Utilities.getUuid()}`;
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

function cleanupOcrTempDocuments_(options) {
  const opts = options || {};
  const olderThanMinutes = typeof opts.olderThanMinutes === "number" ? opts.olderThanMinutes : 60;
  const cutoffTime = Date.now() - olderThanMinutes * 60 * 1000;

  const query = [
    "mimeType = 'application/vnd.google-apps.document'",
    "title contains 'ocr_'",
    "trashed = false",
  ].join(" and ");

  let cleanedCount = 0;
  let failedCount = 0;
  let pageToken = "";

  while (true) {
    let response;
    try {
      response = driveFilesListCompat_({
        q: query,
        maxResults: 50,
        pageToken: pageToken || undefined,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });
    } catch (error) {
      if (typeof logError_ === "function") {
        logError_("Failed to list OCR temp documents for cleanup.", {
          error: getErrorMessage_(error),
        });
      }
      break;
    }

    const items = getDriveFileItems_(response);

    for (const item of items) {
      const title = getDriveFileTitle_(item);
      if (!title.startsWith("ocr_")) {
        continue;
      }

      const createdDateStr = getDriveCreatedDate_(item);
      const createdAt = createdDateStr ? new Date(createdDateStr).getTime() : 0;

      if (createdAt > 0 && createdAt > cutoffTime) {
        continue;
      }

      try {
        driveFilesTrashCompat_(item.id);
        cleanedCount += 1;
      } catch (trashError) {
        try {
          driveFilesRemoveCompat_(item.id);
          cleanedCount += 1;
        } catch (removeError) {
          failedCount += 1;
          if (typeof logError_ === "function") {
            logError_("Failed to trash stale OCR temp document.", {
              fileId: item.id,
              title: title,
              error: getErrorMessage_(removeError),
            });
          }
        }
      }
    }

    pageToken = getDriveNextPageToken_(response) || "";
    if (!pageToken) {
      break;
    }
  }

  if (cleanedCount > 0 && typeof logInfo_ === "function") {
    logInfo_("Cleaned up stale OCR temp documents.", {
      cleanedCount: cleanedCount,
      failedCount: failedCount,
      olderThanMinutes: olderThanMinutes,
    });
  }

  return {
    cleanedCount: cleanedCount,
    failedCount: failedCount,
  };
}
