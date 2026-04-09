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
          Drive.Files.patch(
            { parents: [{ id: targetFolder.id }] },
            file.id,
            { supportsAllDrives: true },
          );
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

  propertiesService.deleteProperty("lastMigratedDocumentType");

  var summary = {
    movedFiles: counts.movedFiles,
    failedFiles: counts.failedFiles,
    deletedFolders: counts.deletedFolders,
    skippedFolders: counts.skippedFolders,
    logPathsMigrated: logPathsMigrated,
    errors: errors,
  };

  logInfo_("Archive folder migration completed.", summary);

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
