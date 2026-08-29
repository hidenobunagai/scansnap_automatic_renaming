import { describe, expect, it } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("Drive API v2 & v3 compatibility layer", () => {
  describe("Pure Drive API v3 environment", () => {
    it("handles list, create, update, trash, and remove under v3 schema", () => {
      let capturedListParams = null;
      let capturedUpdatePayload = null;
      let capturedCreatePayload = null;
      let removedFileId = null;

      const v3DriveMock = {
        Files: {
          list(params) {
            capturedListParams = params;
            return {
              files: [
                {
                  id: "file-v3-1",
                  name: "document_1.pdf",
                  createdTime: "2026-08-20T10:00:00Z",
                  modifiedTime: "2026-08-20T10:05:00Z",
                },
              ],
              nextPageToken: "next-token-123",
            };
          },
          create(resource, blob, options) {
            capturedCreatePayload = { resource, blob, options };
            return {
              id: "new-file-v3",
              name: resource.name,
            };
          },
          update(resource, fileId, blob, options) {
            capturedUpdatePayload = { resource, fileId, blob, options };
            return {
              id: fileId,
              name: resource.name || "updated_file",
              trashed: resource.trashed || false,
            };
          },
          remove(fileId, options) {
            removedFileId = fileId;
          },
        },
      };

      const context = createAppsScriptContext({
        files: ["src/drive-compat.js"],
        globals: {
          Drive: v3DriveMock,
        },
      });

      // 1. driveFilesListCompat_
      const listResp = context.driveFilesListCompat_({
        q: "title = 'test.pdf' and trashed = false",
        maxResults: 20,
      });

      expect(context.getDriveFileItems_(listResp)).toHaveLength(1);
      const firstItem = context.getDriveFileItems_(listResp)[0];
      expect(context.getDriveFileTitle_(firstItem)).toBe("document_1.pdf");
      expect(context.getDriveCreatedDate_(firstItem)).toBe("2026-08-20T10:00:00Z");
      expect(context.getDriveModifiedDate_(firstItem)).toBe("2026-08-20T10:05:00Z");
      expect(context.getDriveNextPageToken_(listResp)).toBe("next-token-123");

      // Check query translation in v3
      expect(capturedListParams.pageSize).toBe(20);
      expect(capturedListParams.q).toContain("name = 'test.pdf'");

      // 2. driveFilesInsertCompat_
      const insertResp = context.driveFilesInsertCompat_({ title: "new_doc" }, null, {
        supportsAllDrives: true,
      });
      expect(insertResp.id).toBe("new-file-v3");
      expect(capturedCreatePayload.resource.name).toBe("new_doc");

      // 3. driveFilesPatchTitleCompat_
      const patchResp = context.driveFilesPatchTitleCompat_("file-1", "renamed_doc.pdf");
      expect(patchResp.id).toBe("file-1");
      expect(capturedUpdatePayload.resource.name).toBe("renamed_doc.pdf");

      // 4. driveFilesTrashCompat_
      context.driveFilesTrashCompat_("file-to-trash");
      expect(capturedUpdatePayload.fileId).toBe("file-to-trash");
      expect(capturedUpdatePayload.resource.trashed).toBe(true);

      // 5. driveFilesRemoveCompat_
      context.driveFilesRemoveCompat_("file-to-remove");
      expect(removedFileId).toBe("file-to-remove");
    });
  });

  describe("Pure Drive API v2 environment", () => {
    it("handles list, insert, patch, trash, and remove under v2 schema", () => {
      let capturedListParams = null;
      let capturedPatchPayload = null;
      let capturedInsertPayload = null;
      let trashedFileId = null;
      let removedFileId = null;

      const v2DriveMock = {
        Files: {
          list(params) {
            capturedListParams = params;
            return {
              items: [
                {
                  id: "file-v2-1",
                  title: "document_v2.pdf",
                  createdDate: "2026-08-19T10:00:00Z",
                  modifiedDate: "2026-08-19T10:05:00Z",
                },
              ],
              nextPageToken: "next-token-v2",
            };
          },
          insert(resource, blob, options) {
            capturedInsertPayload = { resource, blob, options };
            return {
              id: "new-file-v2",
              title: resource.title,
            };
          },
          patch(resource, fileId, options) {
            capturedPatchPayload = { resource, fileId, options };
            return {
              id: fileId,
              title: resource.title,
            };
          },
          trash(fileId) {
            trashedFileId = fileId;
            return { id: fileId, labels: { trashed: true } };
          },
          remove(fileId, options) {
            removedFileId = fileId;
          },
        },
      };

      const context = createAppsScriptContext({
        files: ["src/drive-compat.js"],
        globals: {
          Drive: v2DriveMock,
        },
      });

      // 1. driveFilesListCompat_
      const listResp = context.driveFilesListCompat_({
        q: "name = 'test.pdf' and trashed = false",
        pageSize: 15,
      });

      expect(context.getDriveFileItems_(listResp)).toHaveLength(1);
      const firstItem = context.getDriveFileItems_(listResp)[0];
      expect(context.getDriveFileTitle_(firstItem)).toBe("document_v2.pdf");
      expect(context.getDriveCreatedDate_(firstItem)).toBe("2026-08-19T10:00:00Z");
      expect(context.getDriveModifiedDate_(firstItem)).toBe("2026-08-19T10:05:00Z");
      expect(context.getDriveNextPageToken_(listResp)).toBe("next-token-v2");

      // Check query translation in v2
      expect(capturedListParams.maxResults).toBe(15);
      expect(capturedListParams.q).toContain("title = 'test.pdf'");

      // 2. driveFilesInsertCompat_
      const insertResp = context.driveFilesInsertCompat_({ name: "new_v2_doc" }, null, {
        supportsAllDrives: true,
      });
      expect(insertResp.id).toBe("new-file-v2");
      expect(capturedInsertPayload.resource.title).toBe("new_v2_doc");

      // 3. driveFilesPatchTitleCompat_
      const patchResp = context.driveFilesPatchTitleCompat_("file-v2", "renamed_v2.pdf");
      expect(patchResp.id).toBe("file-v2");
      expect(capturedPatchPayload.resource.title).toBe("renamed_v2.pdf");

      // 4. driveFilesTrashCompat_
      context.driveFilesTrashCompat_("file-v2-trash");
      expect(trashedFileId).toBe("file-v2-trash");

      // 5. driveFilesRemoveCompat_
      context.driveFilesRemoveCompat_("file-v2-remove");
      expect(removedFileId).toBe("file-v2-remove");
    });
  });
});
