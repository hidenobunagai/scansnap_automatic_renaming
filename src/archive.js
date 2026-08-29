const ARCHIVE_DEFAULTS_ = Object.freeze({
  documentType: "未分類",
  issuer: "発行元不明",
});

function buildArchiveRelativePath_(suggestion, config) {
  return [
    normalizeArchiveSegment_(suggestion.issuer, ARCHIVE_DEFAULTS_.issuer, config.maxIssuerLength),
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
  const segments = String(path || "").split("/");

  if (segments.length < 2) {
    return String(path || "");
  }

  const first = segments[0];
  const second = segments[1];
  const rest = segments.slice(2);

  return [second, first].concat(rest).join("/");
}

function moveDriveFileToFolder_(fileId, folderId) {
  const file = Drive.Files.get(fileId, {
    fields: "parents",
    supportsAllDrives: true,
  });
  const previousParents = (file.parents || [])
    .map(function (parent) {
      if (typeof parent === "string") {
        return parent;
      }

      return parent && parent.id ? String(parent.id) : "";
    })
    .filter(Boolean)
    .join(",");

  // v2: patch with addParents/removeParents, v3: update with same params (compat via patch helper)
  if (Drive.Files.patch) {
    Drive.Files.patch({}, fileId, {
      addParents: folderId,
      removeParents: previousParents,
      fields: "id,parents",
      supportsAllDrives: true,
    });
  } else if (Drive.Files.update) {
    Drive.Files.update({}, fileId, null, {
      addParents: folderId,
      removeParents: previousParents,
      fields: "id,parents",
      supportsAllDrives: true,
    });
  }
}

function buildNormalizedArchiveFileName_(fileName, issuerFolderName, normalizedIssuerFolderName) {
  return String(fileName || "").replace(issuerFolderName, normalizedIssuerFolderName);
}

function updateIssuerFieldsInLogRow_(row, oldIssuer, normalizedIssuer) {
  row[LOG_HEADER_INDEX_.issuer] = normalizedIssuer;

  const archivePath = String(row[LOG_HEADER_INDEX_.archiveRelativePath] || "");
  if (archivePath) {
    const segments = archivePath.split("/");
    segments[0] = normalizedIssuer;
    row[LOG_HEADER_INDEX_.archiveRelativePath] = segments.join("/");
  }

  const archiveFileName = String(row[LOG_HEADER_INDEX_.archiveFinalName] || "");
  if (archiveFileName) {
    row[LOG_HEADER_INDEX_.archiveFinalName] = buildNormalizedArchiveFileName_(
      archiveFileName,
      oldIssuer,
      normalizedIssuer,
    );
  }
}

function buildArchiveLogFileNameLookup_(archiveFileNames) {
  const lookup = {};

  (archiveFileNames || []).forEach(function (fileName) {
    const normalized = String(fileName || "");

    if (!normalized) {
      return;
    }

    lookup[normalized] = true;
  });

  return lookup;
}

function getIssuerLogRows_(issuerFolderName, archiveFileNames, config) {
  const logState = getLogState_(config);
  const sheet = logState.sheet;
  const lastRow = sheet.getLastRow();
  const archiveFileNameLookup = buildArchiveLogFileNameLookup_(archiveFileNames);

  if (lastRow < 2) {
    return [];
  }

  return sheet
    .getRange(2, 1, lastRow - 1, LOG_HEADERS_.length)
    .getValues()
    .filter(function (row) {
      if (String(row[LOG_HEADER_INDEX_.issuer] || "") !== issuerFolderName) {
        return false;
      }

      if (!archiveFileNames || !archiveFileNames.length) {
        return true;
      }

      return Boolean(archiveFileNameLookup[String(row[LOG_HEADER_INDEX_.archiveFinalName] || "")]);
    });
}

function updateLogRowsForIssuer_(oldIssuer, archiveFileNames, config, rowUpdater) {
  if (!oldIssuer || typeof rowUpdater !== "function") {
    return 0;
  }
  const logState = getLogState_(config);
  const sheet = logState.sheet;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  const archiveFileNameLookup = buildArchiveLogFileNameLookup_(archiveFileNames);
  const range = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length);
  const values = range.getValues();
  let updated = 0;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][LOG_HEADER_INDEX_.issuer] || "") !== oldIssuer) {
      continue;
    }
    if (
      archiveFileNames &&
      archiveFileNames.length &&
      !archiveFileNameLookup[String(values[i][LOG_HEADER_INDEX_.archiveFinalName] || "")]
    ) {
      continue;
    }
    rowUpdater(values[i]);
    updated += 1;
  }
  if (updated) {
    range.setValues(values);
  }
  return updated;
}

function correctIssuerRowsInLog_(oldIssuer, correctedIssuer, archiveFileNames, config) {
  if (!oldIssuer || !correctedIssuer || oldIssuer === correctedIssuer) {
    return 0;
  }
  return updateLogRowsForIssuer_(oldIssuer, archiveFileNames, config, function (row) {
    updateIssuerFieldsInLogRow_(row, oldIssuer, correctedIssuer);
  });
}

function correctInvertedIssuerRowsInLog_(oldIssuer, correctedIssuer, archiveFileNames, config) {
  if (!oldIssuer || !correctedIssuer || oldIssuer === correctedIssuer) {
    return 0;
  }
  return updateLogRowsForIssuer_(oldIssuer, archiveFileNames, config, function (row) {
    row[LOG_HEADER_INDEX_.issuer] = correctedIssuer;
    const archivePath = String(row[LOG_HEADER_INDEX_.archiveRelativePath] || "");
    if (archivePath) {
      const segments = archivePath.split("/");
      if (segments.length >= 2) {
        segments[0] = correctedIssuer;
        segments[1] = oldIssuer;
        row[LOG_HEADER_INDEX_.archiveRelativePath] = segments.join("/");
      }
    }
    const archiveFileName = String(row[LOG_HEADER_INDEX_.archiveFinalName] || "");
    if (archiveFileName) {
      row[LOG_HEADER_INDEX_.archiveFinalName] = buildInvertedArchiveFileName_(
        archiveFileName,
        correctedIssuer,
        oldIssuer,
      );
    }
  });
}

function listDirectChildFolders_(parentFolderId) {
  const query = [
    `'${escapeDriveQueryValue_(parentFolderId)}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");

  const folders = [];
  let pageToken = "";

  while (true) {
    const response = driveFilesListCompat_({
      q: query,
      maxResults: 100,
      pageToken: pageToken || undefined,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    getDriveFileItems_(response).forEach(function (item) {
      folders.push({ id: item.id, title: getDriveFileTitle_(item) });
    });

    pageToken = getDriveNextPageToken_(response) || "";

    if (!pageToken) {
      break;
    }
  }

  folders.sort(function (a, b) {
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
  const query = [
    `'${escapeDriveQueryValue_(folderId)}' in parents`,
    "mimeType != 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");

  const files = [];
  let pageToken = "";

  while (true) {
    const response = driveFilesListCompat_({
      q: query,
      maxResults: 100,
      pageToken: pageToken || undefined,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    getDriveFileItems_(response).forEach(function (item) {
      files.push({ id: item.id, title: getDriveFileTitle_(item) });
    });

    pageToken = getDriveNextPageToken_(response) || "";

    if (!pageToken) {
      break;
    }
  }

  return files;
}

function deleteEmptyFolder_(folderId) {
  const query = [`'${escapeDriveQueryValue_(folderId)}' in parents`, "trashed = false"].join(
    " and ",
  );

  const response = driveFilesListCompat_({
    q: query,
    maxResults: 1,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  if (getDriveFileItems_(response).length > 0) {
    throw new Error("Folder is not empty");
  }

  driveFilesRemoveCompat_(folderId);
}

function normalizeIssuerRowsInLog_(oldIssuer, newIssuer, config) {
  if (!oldIssuer || !newIssuer || oldIssuer === newIssuer) {
    return 0;
  }
  return updateLogRowsForIssuer_(oldIssuer, null, config, function (row) {
    updateIssuerFieldsInLogRow_(row, oldIssuer, newIssuer);
  });
}

function migrateArchivePathsInLog_(config) {
  const logState = getLogState_(config);
  const sheet = logState.sheet;
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const archivePathCol = LOG_HEADER_INDEX_.archiveRelativePath + 1;
  const statusCol = LOG_HEADER_INDEX_.status + 1;
  const range = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS_.length);
  const values = range.getValues();
  let changed = false;

  for (let i = 0; i < values.length; i++) {
    const status = String(values[i][statusCol - 1] || "");
    if (status !== "renamed" && status !== "copy_failed") {
      continue;
    }

    const currentPath = String(values[i][archivePathCol - 1] || "");
    const newPath = reverseArchivePathSegments_(currentPath);

    if (newPath !== currentPath && currentPath.split("/").length === 2) {
      values[i][archivePathCol - 1] = newPath;
      changed = true;
    }
  }

  if (changed) {
    range.setValues(values);
  }
}
