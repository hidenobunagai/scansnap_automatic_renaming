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
