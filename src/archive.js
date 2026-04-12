const ARCHIVE_DEFAULTS_ = Object.freeze({
  documentType: "未分類",
  issuer: "発行元不明",
});

function buildArchiveRelativePath_(suggestion, config) {
  return [
    normalizeArchiveSegment_(
      suggestion.issuer,
      ARCHIVE_DEFAULTS_.issuer,
      config.maxIssuerLength,
    ),
    normalizeArchiveSegment_(
      suggestion.documentType,
      ARCHIVE_DEFAULTS_.documentType,
      config.maxDocumentTypeLength,
    ),
  ].join("/");
}

function normalizeArchiveSegment_(value, fallbackValue, maxLength) {
  const normalized = truncateFileSegment_(value, maxLength);

  if (normalized) {
    return normalized;
  }

  return truncateFileSegment_(fallbackValue, maxLength);
}

function reverseArchivePathSegments_(path) {
  var segments = String(path || "").split("/");

  if (segments.length < 2) {
    return String(path || "");
  }

  var first = segments[0];
  var second = segments[1];
  var rest = segments.slice(2);

  return [second, first].concat(rest).join("/");
}

function moveDriveFileToFolder_(fileId, folderId) {
  var file = Drive.Files.get(fileId, {
    fields: "parents",
    supportsAllDrives: true,
  });
  var previousParents = (file.parents || [])
    .map(function(parent) {
      if (typeof parent === "string") {
        return parent;
      }

      return parent && parent.id ? String(parent.id) : "";
    })
    .filter(Boolean)
    .join(",");

  Drive.Files.patch(
    {},
    fileId,
    {
      addParents: folderId,
      removeParents: previousParents,
      fields: "id,parents",
      supportsAllDrives: true,
    },
  );
}

function buildNormalizedArchiveFileName_(fileName, issuerFolderName, normalizedIssuerFolderName) {
  return String(fileName || "").replace(issuerFolderName, normalizedIssuerFolderName);
}

function updateIssuerFieldsInLogRow_(row, oldIssuer, normalizedIssuer) {
  row[LOG_HEADER_INDEX_.issuer] = normalizedIssuer;

  var archivePath = String(row[LOG_HEADER_INDEX_.archiveRelativePath] || "");
  if (archivePath) {
    var segments = archivePath.split("/");
    segments[0] = normalizedIssuer;
    row[LOG_HEADER_INDEX_.archiveRelativePath] = segments.join("/");
  }

  var archiveFileName = String(row[LOG_HEADER_INDEX_.archiveFinalName] || "");
  if (archiveFileName) {
    row[LOG_HEADER_INDEX_.archiveFinalName] = buildNormalizedArchiveFileName_(
      archiveFileName,
      oldIssuer,
      normalizedIssuer,
    );
  }
}

function inferCorrectedIssuerForArchiveFolder_(issuerFolderName, signals) {
  var currentIssuer = normalizeIssuerText_(issuerFolderName);

  if (!isWeakIssuerLabel_(currentIssuer)) {
    return currentIssuer;
  }

  var candidates = dedupeOrderedParts_(
    extractOrganizationCandidates_(signals.text || "")
      .concat(extractOrganizationCandidates_(signals.subject || ""))
      .concat(extractOrganizationCandidates_(signals.summary || ""))
      .concat(extractOrganizationCandidates_(signals.fileNames || "")),
  ).map(function(candidate) {
    return normalizeIssuerText_(stripPdfExtension_(candidate));
  });
  var strongCandidates = [];

  for (var i = 0; i < candidates.length; i++) {
    if (!isWeakIssuerLabel_(candidates[i])) {
      strongCandidates.push(candidates[i]);
    }
  }

  strongCandidates = dedupeOrderedParts_(strongCandidates);

  return strongCandidates.length === 1 ? strongCandidates[0] : "";
}

function buildArchiveCorrectionSignals_(logRows, fileNames) {
  return {
    text: logRows.map(function(row) {
      return [row[LOG_HEADER_INDEX_.issuer], row[LOG_HEADER_INDEX_.subject], row[LOG_HEADER_INDEX_.summary]].join(" ");
    }).join(" "),
    subject: logRows.map(function(row) {
      return row[LOG_HEADER_INDEX_.subject] || "";
    }).join(" "),
    summary: logRows.map(function(row) {
      return row[LOG_HEADER_INDEX_.summary] || "";
    }).join(" "),
    fileNames: fileNames.join(" "),
  };
}

function getIssuerLogRows_(issuerFolderName, config) {
  var logState = getLogState_(config);
  var sheet = logState.sheet;
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  return sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length).getValues().filter(function(row) {
    return String(row[LOG_HEADER_INDEX_.issuer] || "") === issuerFolderName;
  });
}

function correctIssuerRowsInLog_(oldIssuer, correctedIssuer, config) {
  if (!oldIssuer || !correctedIssuer || oldIssuer === correctedIssuer) {
    return 0;
  }

  var logState = getLogState_(config);
  var sheet = logState.sheet;
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return 0;
  }

  var range = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length);
  var values = range.getValues();
  var updated = 0;

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][LOG_HEADER_INDEX_.issuer] || "") !== oldIssuer) {
      continue;
    }

    updateIssuerFieldsInLogRow_(values[i], oldIssuer, correctedIssuer);
    updated += 1;
  }

  if (updated) {
    range.setValues(values);
  }

  return updated;
}

function migrateArchiveFolderStructure() {
  var config = getConfig_();
  var archiveRootFolderId = requireArchiveRootFolderId_(config);
  var propertiesService = getScriptProperties_();
  var lastMigrated = propertiesService.getProperty("lastMigratedDocumentType") || "";

  var documentTypeFolders = listDirectChildFolders_(archiveRootFolderId);
  var counts = {
    movedFiles: 0,
    failedFiles: 0,
    deletedFolders: 0,
    skippedFolders: 0,
  };
  var errors = [];

  documentTypeFolders.forEach(function(docTypeFolder) {
    if (lastMigrated && docTypeFolder.title <= lastMigrated) {
      counts.skippedFolders += 1;
      return;
    }

    var issuerFolders = listDirectChildFolders_(docTypeFolder.id);

    issuerFolders.forEach(function(issuerFolder) {
      var files = listFilesInFolder_(issuerFolder.id);

      files.forEach(function(file) {
        try {
          var newPath = issuerFolder.title + "/" + docTypeFolder.title;
          var targetFolder = ensureArchiveFolderByPath_(archiveRootFolderId, newPath);
          moveDriveFileToFolder_(file.id, targetFolder.id);
          counts.movedFiles += 1;
        } catch (error) {
          counts.failedFiles += 1;
          errors.push({
            source: "file:" + file.id,
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

  var logPathsMigrated = counts.failedFiles === 0;

  if (logPathsMigrated) {
    migrateArchivePathsInLog_(config);
  }

  var summary = {
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
  var config = getConfig_();
  var archiveRootFolderId = requireArchiveRootFolderId_(config);
  var propertiesService = getScriptProperties_();
  var lastNormalized = propertiesService.getProperty("lastNormalizedIssuerFolder") || "";
  var issuerFolders = listDirectChildFolders_(archiveRootFolderId);
  var counts = {
    renamedFolders: 0,
    mergedFolders: 0,
    renamedFiles: 0,
    updatedLogRows: 0,
    skippedFolders: 0,
    failedItems: 0,
  };
  var errors = [];

  issuerFolders.forEach(function(issuerFolder) {
    if (lastNormalized && issuerFolder.title <= lastNormalized) {
      counts.skippedFolders += 1;
      return;
    }

    try {
      var normalizedIssuer = normalizeIssuerText_(issuerFolder.title);
      var destinationFolder = issuerFolder;
      var issuerHadFailure = false;

      if (normalizedIssuer && normalizedIssuer !== issuerFolder.title) {
        var existingFolder = findChildFolder_(archiveRootFolderId, normalizedIssuer);

        if (existingFolder) {
          destinationFolder = existingFolder;
          counts.mergedFolders += 1;
        } else {
          Drive.Files.patch({ title: normalizedIssuer }, issuerFolder.id, {
            supportsAllDrives: true,
          });
          destinationFolder = { id: issuerFolder.id, title: normalizedIssuer };
          counts.renamedFolders += 1;
        }
      }

      listDirectChildFolders_(issuerFolder.id).forEach(function(documentTypeFolder) {
        var destinationDocumentTypeFolder = ensureArchiveFolderByPath_(
          archiveRootFolderId,
          destinationFolder.title + "/" + documentTypeFolder.title,
        );

        listFilesInFolder_(documentTypeFolder.id).forEach(function(file) {
          try {
            var nextFileName = buildNormalizedArchiveFileName_(
              file.title,
              issuerFolder.title,
              destinationFolder.title,
            );

            if (nextFileName !== file.title) {
              Drive.Files.patch({ title: nextFileName }, file.id, {
                supportsAllDrives: true,
              });
              counts.renamedFiles += 1;
            }

            moveDriveFileToFolder_(file.id, destinationDocumentTypeFolder.id);
          } catch (error) {
            issuerHadFailure = true;
            counts.failedItems += 1;
            errors.push({
              source: "file:" + file.id,
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
        counts.updatedLogRows += normalizeIssuerRowsInLog_(issuerFolder.title, destinationFolder.title, config);
        propertiesService.setProperty("lastNormalizedIssuerFolder", issuerFolder.title);
      }
    } catch (error) {
      counts.failedItems += 1;
      errors.push({
        source: "issuer:" + issuerFolder.id,
        message: getErrorMessage_(error),
      });
    }
  });

  var summary = {
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
  var config = getConfig_();
  var archiveRootFolderId = requireArchiveRootFolderId_(config);
  var propertiesService = getScriptProperties_();
  var lastCorrected = propertiesService.getProperty("lastCorrectedIssuerFolder") || "";
  var issuerFolders = listDirectChildFolders_(archiveRootFolderId);
  var counts = {
    correctedFolders: 0,
    mergedFolders: 0,
    renamedFiles: 0,
    updatedLogRows: 0,
    skippedFolders: 0,
    failedItems: 0,
  };
  var errors = [];

  issuerFolders.forEach(function(issuerFolder) {
    if (lastCorrected && issuerFolder.title <= lastCorrected) {
      counts.skippedFolders += 1;
      return;
    }

    try {
      var logRows = getIssuerLogRows_(issuerFolder.title, config);
      var documentTypeFolders = listDirectChildFolders_(issuerFolder.id);
      var fileNames = [];
      var issuerHadFailure = false;

      documentTypeFolders.forEach(function(documentTypeFolder) {
        listFilesInFolder_(documentTypeFolder.id).forEach(function(file) {
          fileNames.push(file.title);
        });
      });

      var correctedIssuer = inferCorrectedIssuerForArchiveFolder_(
        issuerFolder.title,
        buildArchiveCorrectionSignals_(logRows, fileNames),
      );

      if (!correctedIssuer || correctedIssuer === issuerFolder.title) {
        counts.skippedFolders += 1;
        return;
      }

      var existingDestination = findChildFolder_(archiveRootFolderId, correctedIssuer);
      var destinationFolder = existingDestination || ensureArchiveFolderByPath_(archiveRootFolderId, correctedIssuer);

      if (existingDestination && existingDestination.id !== issuerFolder.id) {
        counts.mergedFolders += 1;
      }

      documentTypeFolders.forEach(function(documentTypeFolder) {
        var destinationDocumentTypeFolder = ensureArchiveFolderByPath_(
          archiveRootFolderId,
          correctedIssuer + "/" + documentTypeFolder.title,
        );

        listFilesInFolder_(documentTypeFolder.id).forEach(function(file) {
          try {
            var nextFileName = buildNormalizedArchiveFileName_(file.title, issuerFolder.title, correctedIssuer);

            if (nextFileName !== file.title) {
              Drive.Files.patch({ title: nextFileName }, file.id, { supportsAllDrives: true });
              counts.renamedFiles += 1;
            }

            moveDriveFileToFolder_(file.id, destinationDocumentTypeFolder.id);
          } catch (error) {
            issuerHadFailure = true;
            counts.failedItems += 1;
            errors.push({
              source: "file:" + file.id,
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
        counts.updatedLogRows += correctIssuerRowsInLog_(issuerFolder.title, correctedIssuer, config);
        counts.correctedFolders += 1;
        propertiesService.setProperty("lastCorrectedIssuerFolder", issuerFolder.title);
      }
    } catch (error) {
      counts.failedItems += 1;
      errors.push({
        source: "issuer:" + issuerFolder.id,
        message: getErrorMessage_(error),
      });
    }
  });

  var summary = {
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

function listDirectChildFolders_(parentFolderId) {
  var query = [
    "'" + escapeDriveQueryValue_(parentFolderId) + "' in parents",
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");

  var folders = [];
  var pageToken = "";

  while (true) {
    var response = Drive.Files.list({
      q: query,
      maxResults: 100,
      pageToken: pageToken || undefined,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    (response.items || []).forEach(function(item) {
      folders.push({ id: item.id, title: item.title });
    });

    pageToken = response.nextPageToken || "";

    if (!pageToken) {
      break;
    }
  }

  folders.sort(function(a, b) {
    if (a.title < b.title) {
      return -1;
    }

    if (a.title > b.title) {
      return 1;
    }

    return 0;
  });

  return folders;
}

function listFilesInFolder_(folderId) {
  var query = [
    "'" + escapeDriveQueryValue_(folderId) + "' in parents",
    "mimeType != 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");

  var files = [];
  var pageToken = "";

  while (true) {
    var response = Drive.Files.list({
      q: query,
      maxResults: 100,
      pageToken: pageToken || undefined,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    (response.items || []).forEach(function(item) {
      files.push({ id: item.id, title: item.title });
    });

    pageToken = response.nextPageToken || "";

    if (!pageToken) {
      break;
    }
  }

  return files;
}

function deleteEmptyFolder_(folderId) {
  var query = [
    "'" + escapeDriveQueryValue_(folderId) + "' in parents",
    "trashed = false",
  ].join(" and ");

  var response = Drive.Files.list({
    q: query,
    maxResults: 1,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  if ((response.items || []).length > 0) {
    throw new Error("Folder is not empty");
  }

  Drive.Files.remove(folderId, { supportsAllDrives: true });
}

function normalizeIssuerRowsInLog_(oldIssuer, newIssuer, config) {
  if (!oldIssuer || !newIssuer || oldIssuer === newIssuer) {
    return 0;
  }

  var logState = getLogState_(config);
  var sheet = logState.sheet;
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return 0;
  }

  var range = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length);
  var values = range.getValues();
  var updated = 0;

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][LOG_HEADER_INDEX_.issuer] || "") !== oldIssuer) {
      continue;
    }

    updateIssuerFieldsInLogRow_(values[i], oldIssuer, newIssuer);

    updated += 1;
  }

  if (updated) {
    range.setValues(values);
  }

  return updated;
}

function migrateArchivePathsInLog_(config) {
  var logState = getLogState_(config);
  var sheet = logState.sheet;
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  var archivePathCol = LOG_HEADER_INDEX_.archiveRelativePath + 1;
  var statusCol = LOG_HEADER_INDEX_.status + 1;
  var range = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length);
  var values = range.getValues();
  var changed = false;

  for (var i = 0; i < values.length; i++) {
    var status = String(values[i][statusCol - 1] || "");
    if (status !== "renamed" && status !== "copy_failed") {
      continue;
    }

    var currentPath = String(values[i][archivePathCol - 1] || "");
    var newPath = reverseArchivePathSegments_(currentPath);

    if (newPath !== currentPath && currentPath.split("/").length === 2) {
      values[i][archivePathCol - 1] = newPath;
      changed = true;
    }
  }

  if (changed) {
    range.setValues(values);
  }
}
