/**
 * OCR extraction through a temporary Google Doc.
 *
 * Drive's OCR conversion is subject to a per-user rate limit ("User rate limit
 * exceeded for OCR"), which is easy to hit when several PDFs are converted back
 * to back. Each conversion is retried with exponential backoff so a transient
 * throttle does not leave the file unprocessed until the next trigger run.
 */
const OCR_MAX_ATTEMPTS_ = 4;
const OCR_RETRY_BASE_MS_ = 2000;

/** True for Drive throttling, which is worth retrying; false for bad requests. */
function isTransientOcrError_(error) {
  const message = String(getErrorMessage_(error)).toLowerCase();

  return (
    message.indexOf("rate limit") !== -1 ||
    message.indexOf("ratelimitexceeded") !== -1 ||
    message.indexOf("user rate") !== -1 ||
    message.indexOf("429") !== -1
  );
}

function insertOcrTempDocument_(pdfBlob, config) {
  let attempt = 0;

  for (;;) {
    try {
      const ocrTempTitle = `ocr_${Utilities.getUuid()}`;

      return driveFilesInsertCompat_(
        {
          title: ocrTempTitle,
          name: ocrTempTitle,
        },
        pdfBlob,
        {
          convert: true,
          ocr: true,
          ocrLanguage: config.ocrLanguage,
          supportsAllDrives: true,
        },
      );
    } catch (error) {
      attempt += 1;

      if (!isTransientOcrError_(error) || attempt >= OCR_MAX_ATTEMPTS_) {
        throw error;
      }

      const waitMs = OCR_RETRY_BASE_MS_ * Math.pow(2, attempt - 1) + Math.random() * 500;
      logInfo_("OCR is rate limited; waiting before retrying.", {
        attempt: attempt,
        waitMs: Math.round(waitMs),
        error: getErrorMessage_(error),
      });
      Utilities.sleep(waitMs);
    }
  }
}

function extractTextFromPdf_(fileId, config) {
  const pdfFile = DriveApp.getFileById(fileId);
  let tempDocument = null;

  try {
    tempDocument = insertOcrTempDocument_(pdfFile.getBlob(), config);

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
