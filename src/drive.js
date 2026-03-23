function listPendingPdfFiles_(config, processedFileMap) {
  const candidates = [];
  const query = [
    `'${escapeDriveQueryValue_(config.scansnapFolderId)}' in parents`,
    "mimeType = 'application/pdf'",
    "trashed = false",
  ].join(" and ");

  let pageToken = "";

  while (candidates.length < config.maxFilesPerRun) {
    const response = Drive.Files.list({
      q: query,
      maxResults: Math.max(config.maxFilesPerRun * 3, 20),
      orderBy: "modifiedDate desc",
      pageToken: pageToken || undefined,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    (response.items || []).forEach(function(item) {
      if (candidates.length >= config.maxFilesPerRun || processedFileMap[item.id]) {
        return;
      }

      const fileMeta = {
        id: item.id,
        name: item.title,
        createdAt: new Date(item.createdDate),
        modifiedAt: new Date(item.modifiedDate),
      };

      if (!isFileStable_(fileMeta, config.fileStableMinutes)) {
        return;
      }

      candidates.push(fileMeta);
    });

    pageToken = response.nextPageToken || "";

    if (!pageToken) {
      break;
    }
  }

  return candidates;
}

function isFileStable_(fileMeta, stableMinutes) {
  return fileMeta.modifiedAt.getTime() <= Date.now() - stableMinutes * 60 * 1000;
}

function renameDriveFile_(fileId, newTitle) {
  Drive.Files.patch(
    { title: newTitle },
    fileId,
    {
      supportsAllDrives: true,
    },
  );
}

function ensureArchiveFolderByPath_(rootFolderId, relativePath) {
  const segments = String(relativePath || "")
    .split("/")
    .map(collapseWhitespace_)
    .filter(Boolean);

  if (!segments.length) {
    throw new Error("Archive path must include at least one folder segment.");
  }

  return segments.reduce(function(parentState, segment) {
    const folder = findOrCreateChildFolder_(parentState.id, segment);
    const nextPath = parentState.path ? `${parentState.path}/${segment}` : segment;

    return {
      id: folder.id,
      title: folder.title,
      path: nextPath,
    };
  }, {
    id: rootFolderId,
    path: "",
  });
}

function ensureUniqueFileName_(folderId, proposedName, currentFileId) {
  const extensionIndex = proposedName.lastIndexOf(".");
  const basename = extensionIndex === -1 ? proposedName : proposedName.slice(0, extensionIndex);
  const extension = extensionIndex === -1 ? "" : proposedName.slice(extensionIndex);

  let candidate = proposedName;
  let sequence = 2;

  while (driveFileNameExists_(folderId, candidate, currentFileId)) {
    candidate = `${basename}_${sequence}${extension}`;
    sequence += 1;
  }

  return candidate;
}

function ensureUniqueFileNameInFolder_(folderId, proposedName, currentFileId) {
  return ensureUniqueFileName_(folderId, proposedName, currentFileId);
}

function copyDriveFileToFolder_(fileId, folderId, newTitle) {
  return Drive.Files.copy(
    {
      title: newTitle,
      parents: [{ id: folderId }],
    },
    fileId,
    {
      supportsAllDrives: true,
    },
  );
}

function driveFileNameExists_(folderId, fileName, currentFileId) {
  const query = [
    `'${escapeDriveQueryValue_(folderId)}' in parents`,
    `title = '${escapeDriveQueryValue_(fileName)}'`,
    "trashed = false",
  ].join(" and ");

  const response = Drive.Files.list({
    q: query,
    maxResults: 10,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  return (response.items || []).some(function(item) {
    return item.id !== currentFileId;
  });
}

function findOrCreateChildFolder_(parentFolderId, folderName) {
  const existingFolder = findChildFolder_(parentFolderId, folderName);

  if (existingFolder) {
    return existingFolder;
  }

  return Drive.Files.insert(
    {
      title: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [{ id: parentFolderId }],
    },
    null,
    {
      supportsAllDrives: true,
    },
  );
}

function findChildFolder_(parentFolderId, folderName) {
  const query = [
    `'${escapeDriveQueryValue_(parentFolderId)}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    `title = '${escapeDriveQueryValue_(folderName)}'`,
    "trashed = false",
  ].join(" and ");

  const response = Drive.Files.list({
    q: query,
    maxResults: 10,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  return (response.items || [])[0] || null;
}
