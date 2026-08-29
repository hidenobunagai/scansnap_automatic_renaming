// Archive maintenance tasks: migration, normalization, correction.
// Depends on src/archive.js (core helpers) and src/utils.js / src/config.js / src/drive.js etc.
// Kept separate from archive.js for maintainability.

function inferCorrectedIssuerForArchiveFolder_(issuerFolderName, signals, config) {
  const currentIssuer = normalizeIssuerText_(issuerFolderName);

  if (!isWeakIssuerLabel_(currentIssuer, config)) {
    return currentIssuer;
  }

  const candidates = dedupeOrderedParts_(
    extractOrganizationCandidates_(signals.text || "")
      .concat(extractOrganizationCandidates_(signals.subject || ""))
      .concat(extractOrganizationCandidates_(signals.summary || ""))
      .concat(extractOrganizationCandidates_(signals.fileNames || "")),
  ).map(function (candidate) {
    return normalizeIssuerText_(stripPdfExtension_(candidate));
  });
  let strongCandidates = [];

  for (let i = 0; i < candidates.length; i++) {
    if (!isWeakIssuerLabel_(candidates[i], config)) {
      strongCandidates.push(candidates[i]);
    }
  }

  strongCandidates = dedupeOrderedParts_(strongCandidates);

  if (strongCandidates.length > 1) {
    const minimal = [];

    for (let i = 0; i < strongCandidates.length; i++) {
      let isSuperset = false;

      for (let j = 0; j < strongCandidates.length; j++) {
        if (
          i !== j &&
          strongCandidates[i].indexOf(strongCandidates[j]) !== -1 &&
          strongCandidates[i] !== strongCandidates[j]
        ) {
          isSuperset = true;
          break;
        }
      }

      if (!isSuperset) {
        minimal.push(strongCandidates[i]);
      }
    }

    strongCandidates = minimal.length > 0 ? minimal : strongCandidates;
  }

  return strongCandidates.length === 1 ? strongCandidates[0] : "";
}

function buildArchiveCorrectionSignals_(logRows, fileNames) {
  return {
    text: logRows
      .map(function (row) {
        return [
          row[LOG_HEADER_INDEX_.issuer],
          row[LOG_HEADER_INDEX_.subject],
          row[LOG_HEADER_INDEX_.summary],
        ].join(" ");
      })
      .join(" "),
    subject: logRows
      .map(function (row) {
        return row[LOG_HEADER_INDEX_.subject] || "";
      })
      .join(" "),
    summary: logRows
      .map(function (row) {
        return row[LOG_HEADER_INDEX_.summary] || "";
      })
      .join(" "),
    fileNames: fileNames.join(" "),
  };
}

function isInvertedArchiveHierarchy_(issuerFolderName, documentTypeFolders, config) {
  if (!isWeakIssuerLabel_(issuerFolderName, config)) {
    return false;
  }

  for (let i = 0; i < documentTypeFolders.length; i++) {
    const name = documentTypeFolders[i].title;

    for (let j = 0; j < ORGANIZATION_MARKERS_.length; j++) {
      if (name.indexOf(ORGANIZATION_MARKERS_[j]) !== -1) {
        return true;
      }
    }
  }

  return false;
}

function buildInvertedArchiveFileName_(fileName, correctedIssuer, oldIssuer) {
  const name = String(fileName || "");
  const extMatch = name.match(/^(.*)\.(\w+)$/);

  if (!extMatch) return name;

  const baseName = extMatch[1];
  const ext = extMatch[2];
  const segments = baseName.split("_");

  if (segments.length < 3) return name;

  segments[1] = correctedIssuer;
  segments[2] = oldIssuer;

  const result = `${segments.join("_")}.${ext}`;
  return result !== name ? result : name;
}

function migrateArchiveFolderStructure() {
  const config = getConfig_();
  const archiveRootFolderId = requireArchiveRootFolderId_(config);
  const propertiesService = getScriptProperties_();
  const lastMigrated = propertiesService.getProperty("lastMigratedDocumentType") || "";

  const documentTypeFolders = listDirectChildFolders_(archiveRootFolderId);
  const counts = {
    movedFiles: 0,
    failedFiles: 0,
    deletedFolders: 0,
    skippedFolders: 0,
  };
  const errors = [];

  documentTypeFolders.forEach(function (docTypeFolder) {
    if (lastMigrated && docTypeFolder.title <= lastMigrated) {
      counts.skippedFolders += 1;
      return;
    }

    const issuerFolders = listDirectChildFolders_(docTypeFolder.id);

    issuerFolders.forEach(function (issuerFolder) {
      const files = listFilesInFolder_(issuerFolder.id);

      files.forEach(function (file) {
        try {
          const newPath = `${issuerFolder.title}/${docTypeFolder.title}`;
          const targetFolder = ensureArchiveFolderByPath_(archiveRootFolderId, newPath);
          moveDriveFileToFolder_(file.id, targetFolder.id);
          counts.movedFiles += 1;
        } catch (error) {
          counts.failedFiles += 1;
          errors.push({
            source: `file:${file.id}`,
            message: getErrorMessage_(error),
          });
        }
      });

      try {
        deleteEmptyFolder_(issuerFolder.id);
        counts.deletedFolders += 1;
      } catch (ignore) {
        // Folder not empty or already deleted
      }
    });

    try {
      deleteEmptyFolder_(docTypeFolder.id);
      counts.deletedFolders += 1;
    } catch (ignore) {
      // Folder not empty or already deleted
    }

    propertiesService.setProperty("lastMigratedDocumentType", docTypeFolder.title);
  });

  const logPathsMigrated = counts.failedFiles === 0;

  if (logPathsMigrated) {
    migrateArchivePathsInLog_(config);
  }

  const summary = {
    movedFiles: counts.movedFiles,
    failedFiles: counts.failedFiles,
    deletedFolders: counts.deletedFolders,
    skippedFolders: counts.skippedFolders,
    logPathsMigrated: logPathsMigrated,
    errors: errors,
  };

  logInfo_("Archive folder migration completed.", summary);

  propertiesService.deleteProperty("lastMigratedDocumentType");

  return summary;
}

function normalizeArchiveIssuerNames() {
  const config = getConfig_();
  const archiveRootFolderId = requireArchiveRootFolderId_(config);
  const propertiesService = getScriptProperties_();
  const lastNormalized = propertiesService.getProperty("lastNormalizedIssuerFolder") || "";
  const issuerFolders = listDirectChildFolders_(archiveRootFolderId);
  const counts = {
    renamedFolders: 0,
    mergedFolders: 0,
    renamedFiles: 0,
    updatedLogRows: 0,
    skippedFolders: 0,
    failedItems: 0,
  };
  const errors = [];

  issuerFolders.forEach(function (issuerFolder) {
    if (lastNormalized && issuerFolder.title <= lastNormalized) {
      counts.skippedFolders += 1;
      return;
    }

    try {
      const normalizedIssuer = normalizeIssuerText_(issuerFolder.title);
      let destinationFolder = issuerFolder;
      let issuerHadFailure = false;

      if (normalizedIssuer && normalizedIssuer !== issuerFolder.title) {
        const existingFolder = findChildFolder_(archiveRootFolderId, normalizedIssuer);

        if (existingFolder) {
          destinationFolder = existingFolder;
          counts.mergedFolders += 1;
        } else {
          driveFilesPatchTitleCompat_(issuerFolder.id, normalizedIssuer, {
            supportsAllDrives: true,
          });
          destinationFolder = { id: issuerFolder.id, title: normalizedIssuer };
          counts.renamedFolders += 1;
        }
      }

      listDirectChildFolders_(issuerFolder.id).forEach(function (documentTypeFolder) {
        const destinationDocumentTypeFolder = ensureArchiveFolderByPath_(
          archiveRootFolderId,
          `${destinationFolder.title}/${documentTypeFolder.title}`,
        );

        listFilesInFolder_(documentTypeFolder.id).forEach(function (file) {
          try {
            const nextFileName = buildNormalizedArchiveFileName_(
              file.title,
              issuerFolder.title,
              destinationFolder.title,
            );

            if (nextFileName !== file.title) {
              driveFilesPatchTitleCompat_(file.id, nextFileName, {
                supportsAllDrives: true,
              });
              counts.renamedFiles += 1;
            }

            moveDriveFileToFolder_(file.id, destinationDocumentTypeFolder.id);
          } catch (error) {
            issuerHadFailure = true;
            counts.failedItems += 1;
            errors.push({
              source: `file:${file.id}`,
              message: getErrorMessage_(error),
            });
          }
        });

        try {
          deleteEmptyFolder_(documentTypeFolder.id);
        } catch (ignore) {
          // Folder not empty or already deleted
        }
      });

      if (destinationFolder.id !== issuerFolder.id) {
        try {
          deleteEmptyFolder_(issuerFolder.id);
        } catch (ignore) {
          // Folder not empty or already deleted
        }
      }

      if (!issuerHadFailure) {
        counts.updatedLogRows += normalizeIssuerRowsInLog_(
          issuerFolder.title,
          destinationFolder.title,
          config,
        );
        propertiesService.setProperty("lastNormalizedIssuerFolder", issuerFolder.title);
      }
    } catch (error) {
      counts.failedItems += 1;
      errors.push({
        source: `issuer:${issuerFolder.id}`,
        message: getErrorMessage_(error),
      });
    }
  });

  const summary = {
    renamedFolders: counts.renamedFolders,
    mergedFolders: counts.mergedFolders,
    renamedFiles: counts.renamedFiles,
    updatedLogRows: counts.updatedLogRows,
    skippedFolders: counts.skippedFolders,
    failedItems: counts.failedItems,
    errors: errors,
  };

  logInfo_("Archive issuer normalization completed.", summary);
  propertiesService.deleteProperty("lastNormalizedIssuerFolder");
  return summary;
}

function correctArchiveIssuerFolders() {
  const config = getConfig_();
  const archiveRootFolderId = requireArchiveRootFolderId_(config);
  const propertiesService = getScriptProperties_();
  const lastCorrected = propertiesService.getProperty("lastCorrectedIssuerFolder") || "";
  const issuerFolders = listDirectChildFolders_(archiveRootFolderId);
  const counts = {
    correctedFolders: 0,
    mergedFolders: 0,
    renamedFiles: 0,
    updatedLogRows: 0,
    skippedFolders: 0,
    failedItems: 0,
  };
  const errors = [];

  issuerFolders.forEach(function (issuerFolder) {
    if (lastCorrected && issuerFolder.title <= lastCorrected) {
      counts.skippedFolders += 1;
      return;
    }

    try {
      const documentTypeFolders = listDirectChildFolders_(issuerFolder.id);
      const fileNames = [];
      let issuerHadFailure = false;

      documentTypeFolders.forEach(function (documentTypeFolder) {
        listFilesInFolder_(documentTypeFolder.id).forEach(function (file) {
          fileNames.push(file.title);
        });
      });

      const logRows = getIssuerLogRows_(issuerFolder.title, fileNames, config);

      const correctedIssuer = inferCorrectedIssuerForArchiveFolder_(
        issuerFolder.title,
        buildArchiveCorrectionSignals_(logRows, fileNames),
        config,
      );

      if (!correctedIssuer || correctedIssuer === issuerFolder.title) {
        counts.skippedFolders += 1;
        return;
      }

      const isInverted = isInvertedArchiveHierarchy_(
        issuerFolder.title,
        documentTypeFolders,
        config,
      );
      const existingDestination = findChildFolder_(archiveRootFolderId, correctedIssuer);
      const destinationFolder =
        existingDestination || ensureArchiveFolderByPath_(archiveRootFolderId, correctedIssuer);

      if (existingDestination && existingDestination.id !== issuerFolder.id) {
        counts.mergedFolders += 1;
      }

      documentTypeFolders.forEach(function (documentTypeFolder) {
        const effectiveDocType = isInverted ? issuerFolder.title : documentTypeFolder.title;
        const destinationDocumentTypeFolder = ensureArchiveFolderByPath_(
          archiveRootFolderId,
          `${correctedIssuer}/${effectiveDocType}`,
        );

        listFilesInFolder_(documentTypeFolder.id).forEach(function (file) {
          try {
            const nextFileName = isInverted
              ? buildInvertedArchiveFileName_(file.title, correctedIssuer, issuerFolder.title)
              : buildNormalizedArchiveFileName_(file.title, issuerFolder.title, correctedIssuer);

            if (nextFileName !== file.title) {
              driveFilesPatchTitleCompat_(file.id, nextFileName, { supportsAllDrives: true });
              counts.renamedFiles += 1;
            }

            moveDriveFileToFolder_(file.id, destinationDocumentTypeFolder.id);
          } catch (error) {
            issuerHadFailure = true;
            counts.failedItems += 1;
            errors.push({
              source: `file:${file.id}`,
              message: getErrorMessage_(error),
            });
          }
        });

        try {
          deleteEmptyFolder_(documentTypeFolder.id);
        } catch (ignore) {}
      });

      if (destinationFolder.id !== issuerFolder.id) {
        try {
          deleteEmptyFolder_(issuerFolder.id);
        } catch (ignore) {}
      }

      if (!issuerHadFailure) {
        counts.updatedLogRows += isInverted
          ? correctInvertedIssuerRowsInLog_(issuerFolder.title, correctedIssuer, fileNames, config)
          : correctIssuerRowsInLog_(issuerFolder.title, correctedIssuer, fileNames, config);
        counts.correctedFolders += 1;
        propertiesService.setProperty("lastCorrectedIssuerFolder", issuerFolder.title);
      }
    } catch (error) {
      counts.failedItems += 1;
      errors.push({
        source: `issuer:${issuerFolder.id}`,
        message: getErrorMessage_(error),
      });
    }
  });

  const summary = {
    correctedFolders: counts.correctedFolders,
    mergedFolders: counts.mergedFolders,
    renamedFiles: counts.renamedFiles,
    updatedLogRows: counts.updatedLogRows,
    skippedFolders: counts.skippedFolders,
    failedItems: counts.failedItems,
    errors: errors,
  };

  logInfo_("Archive issuer correction completed.", summary);
  propertiesService.deleteProperty("lastCorrectedIssuerFolder");
  return summary;
}
