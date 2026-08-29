// Drive API v2/v3 compatibility helpers.
// v2 uses: title, createdDate/modifiedDate, items, maxResults, Drive.Files.insert/patch/trash
// v3 uses: name, createdTime/modifiedTime, files, pageSize, Drive.Files.create/update
// Helpers normalize both so switching the manifest version (v2 <-> v3) requires zero code changes.

function isDriveV3_() {
  if (typeof Drive === "undefined" || !Drive.Files) return false;
  return typeof Drive.Files.create === "function" && typeof Drive.Files.insert === "undefined";
}

function normalizeDriveQuery_(query, isV3) {
  if (!query || typeof query !== "string") return query;
  if (isV3) {
    return query.replace(/\btitle\b/g, "name");
  }
  return query.replace(/\bname\b/g, "title");
}

function getDriveFileTitle_(item) {
  if (!item) return "";
  return String(item.name || item.title || "");
}

function getDriveFileItems_(response) {
  if (!response) return [];
  return response.files || response.items || [];
}

function getDriveNextPageToken_(response) {
  if (!response) return "";
  return response.nextPageToken || "";
}

function getDriveCreatedDate_(item) {
  if (!item) return "";
  return item.createdTime || item.createdDate || "";
}

function getDriveModifiedDate_(item) {
  if (!item) return "";
  return item.modifiedTime || item.modifiedDate || "";
}

function buildDriveFolderResource_(folderName, parentId) {
  const isV3 = isDriveV3_();
  if (isV3) {
    const resource = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId) {
      resource.parents = [parentId];
    }
    return resource;
  }

  // v2 resource
  const resource = {
    title: folderName,
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) {
    resource.parents = [{ id: parentId }];
  }
  return resource;
}

function buildDriveCopyResource_(newTitle, folderId) {
  const isV3 = isDriveV3_();
  if (isV3) {
    return {
      name: newTitle,
      parents: folderId ? [folderId] : undefined,
    };
  }
  return {
    title: newTitle,
    name: newTitle,
    parents: [{ id: folderId }],
  };
}

function driveFilesListCompat_(params) {
  const isV3 = isDriveV3_();
  const compatParams = Object.assign({}, params);

  if (compatParams.q) {
    compatParams.q = normalizeDriveQuery_(compatParams.q, isV3);
  }

  if (isV3) {
    if (compatParams.maxResults && !compatParams.pageSize) {
      compatParams.pageSize = compatParams.maxResults;
    }
    delete compatParams.maxResults;
  } else {
    if (compatParams.pageSize && !compatParams.maxResults) {
      compatParams.maxResults = compatParams.pageSize;
    }
    delete compatParams.pageSize;
  }

  const response = Drive.Files.list(compatParams);
  if (!response.items && response.files) response.items = response.files;
  if (!response.files && response.items) response.files = response.items;
  return response;
}

function driveFilesPatchTitleCompat_(fileId, newTitle, options) {
  const isV3 = isDriveV3_();
  const opts = Object.assign({ supportsAllDrives: true }, options || {});

  if (isV3 || !Drive.Files.patch) {
    if (Drive.Files.update) {
      return Drive.Files.update({ name: newTitle }, fileId, null, opts);
    }
  }

  if (Drive.Files.patch) {
    try {
      return Drive.Files.patch({ title: newTitle }, fileId, opts);
    } catch (e) {
      if (Drive.Files.update) {
        return Drive.Files.update({ name: newTitle }, fileId, null, opts);
      }
      throw e;
    }
  }

  throw new Error("No Drive patch/update method available");
}

function driveFilesInsertCompat_(resource, blob, options) {
  const isV3 = isDriveV3_();
  const compatResource = Object.assign({}, resource);

  if (compatResource.title && !compatResource.name) compatResource.name = compatResource.title;
  if (compatResource.name && !compatResource.title) compatResource.title = compatResource.name;

  const opts = Object.assign({ supportsAllDrives: true }, options || {});

  if (isV3 || !Drive.Files.insert) {
    if (Drive.Files.create) {
      return Drive.Files.create(compatResource, blob, opts);
    }
  }

  if (Drive.Files.insert) {
    try {
      return Drive.Files.insert(compatResource, blob, opts);
    } catch (e) {
      if (Drive.Files.create) {
        return Drive.Files.create(compatResource, blob, opts);
      }
      throw e;
    }
  }

  throw new Error("No Drive insert/create method available");
}

function driveFilesTrashCompat_(fileId) {
  const isV3 = isDriveV3_();

  if (isV3) {
    if (Drive.Files.update) {
      return Drive.Files.update({ trashed: true }, fileId, null, { supportsAllDrives: true });
    }
  }

  if (Drive.Files.trash) {
    try {
      return Drive.Files.trash(fileId);
    } catch (e) {
      // fall through to update
    }
  }

  if (Drive.Files.remove) {
    try {
      return Drive.Files.remove(fileId, { supportsAllDrives: true });
    } catch (e) {
      // fall through
    }
  }

  if (Drive.Files.update) {
    return Drive.Files.update({ trashed: true }, fileId, null, { supportsAllDrives: true });
  }

  throw new Error("No Drive trash/remove method available");
}

function driveFilesRemoveCompat_(fileId) {
  if (Drive.Files.remove) {
    return Drive.Files.remove(fileId, { supportsAllDrives: true });
  }
  if (Drive.Files.trash) {
    try {
      Drive.Files.trash(fileId);
      return;
    } catch (e) {}
  }
  if (Drive.Files.update) {
    return Drive.Files.update({ trashed: true }, fileId, null, { supportsAllDrives: true });
  }
  throw new Error("No Drive remove method available");
}
