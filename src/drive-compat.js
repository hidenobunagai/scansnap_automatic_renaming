// Drive API v2/v3 compatibility helpers.
// v2 uses: title, createdDate/modifiedDate, items, maxResults, Drive.Files.insert/patch/trash
// v3 uses: name, createdTime/modifiedTime, files, pageSize, Drive.Files.create/update
// Helpers normalize both so a future manifest switch (v2 -> v3) requires minimal code changes.

function getDriveFileTitle_(item) {
  if (!item) return "";
  return String(item.title || item.name || "");
}

function getDriveFileItems_(response) {
  if (!response) return [];
  return response.items || response.files || [];
}

function getDriveNextPageToken_(response) {
  if (!response) return "";
  return response.nextPageToken || "";
}

function getDriveCreatedDate_(item) {
  if (!item) return "";
  return item.createdDate || item.createdTime || "";
}

function getDriveModifiedDate_(item) {
  if (!item) return "";
  return item.modifiedDate || item.modifiedTime || "";
}

function buildDriveFolderResource_(folderName, parentId) {
  // Send both title/name for v2/v3 compatibility.
  var resource = {
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
  return {
    title: newTitle,
    name: newTitle,
    parents: [{ id: folderId }],
  };
}

function driveFilesListCompat_(params) {
  var compatParams = Object.assign({}, params);
  // v2: maxResults, v3: pageSize — send both.
  if (compatParams.maxResults && !compatParams.pageSize) {
    compatParams.pageSize = compatParams.maxResults;
  }
  if (compatParams.pageSize && !compatParams.maxResults) {
    compatParams.maxResults = compatParams.pageSize;
  }
  var response = Drive.Files.list(compatParams);
  // Normalize so callers can use either .items or .files
  if (!response.items && response.files) response.items = response.files;
  if (!response.files && response.items) response.files = response.items;
  return response;
}

function driveFilesPatchTitleCompat_(fileId, newTitle, options) {
  var opts = Object.assign({ supportsAllDrives: true }, options || {});
  // Prefer patch (v2) with title, fall back to update (v3) with name
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
  if (Drive.Files.update) {
    return Drive.Files.update({ name: newTitle }, fileId, null, opts);
  }
  throw new Error("No Drive patch/update method available");
}

function driveFilesInsertCompat_(resource, blob, options) {
  var compatResource = Object.assign({}, resource);
  // Ensure both title/name are present
  if (compatResource.title && !compatResource.name) compatResource.name = compatResource.title;
  if (compatResource.name && !compatResource.title) compatResource.title = compatResource.name;
  var opts = Object.assign({ supportsAllDrives: true }, options || {});
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
  if (Drive.Files.create) {
    return Drive.Files.create(compatResource, blob, opts);
  }
  throw new Error("No Drive insert/create method available");
}

function driveFilesTrashCompat_(fileId) {
  // v2: Drive.Files.trash, v3: Drive.Files.update with trashed
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
  // Last resort: update trashed flag
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
