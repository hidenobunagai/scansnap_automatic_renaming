# Archive Folder Restructure Design

## Context

The current archive folder structure is `書類種別/発行元` (e.g. `領収書/東京電力`).
Users find `発行元/書類種別` (e.g. `東京電力/領収書`) more intuitive for narrowing down by sender.

The project is in production with existing files in the old structure that must be migrated.

## Design

### 1. Path generation change

**File**: `src/archive.js` — `buildArchiveRelativePath_`

Change segment order from `[documentType, issuer]` to `[issuer, documentType]`.

```js
// Before
[documentType, issuer]

// After
[issuer, documentType]
```

`ARCHIVE_DEFAULTS_`, `normalizeArchiveSegment_`, and all related logic remain unchanged.

### 2. One-time migration function

**File**: `src/archive.js` — new function `migrateArchiveFolderStructure()`

#### Flow

1. Read `ARCHIVE_ROOT_FOLDER_ID` from script properties.
2. List all direct subfolders of the archive root (= old "document type" folders).
3. Read `lastMigratedDocumentType` from script properties for resume support. If present, skip folders alphabetically before that value.
4. For each "document type" folder:
   a. List its subfolders (= "issuer" folders).
   b. For each "issuer" folder:
      - List all files inside.
      - For each file, move it to the new path `issuer/documentType/` by calling `ensureArchiveFolderByPath_` and `Drive.Files.patch` to reparent.
      - If move fails, log the error and continue.
   c. After all files are moved, attempt to delete the (now empty) "issuer" folder.
   d. Skip deletion if the folder still has children.
5. After all "issuer" subfolders are processed, attempt to delete the (now empty) "document type" folder.
6. Save progress to `lastMigratedDocumentType` after each "document type" folder.
7. On completion, clear `lastMigratedDocumentType`.

#### Return value

```js
{
  movedFiles: number,
  failedFiles: number,
  deletedFolders: number,
  skippedFolders: number,
  errors: Array<{ source, message }>
}
```

#### Error handling

- File move failures: log and skip, continue with remaining files.
- Folder deletion failures (folder not empty): skip without error.
- Resume: re-running picks up from the last completed "document type" folder via `lastMigratedDocumentType` script property.

### 3. Log sheet migration

Within `migrateArchiveFolderStructure()`, after file migration, update the `archiveRelativePath` column in the log sheet:

- Target rows: where `status` is `renamed` or `copy_failed` and `archiveRelativePath` contains exactly one `/`.
- Transform: split `archiveRelativePath` by `/`, reverse the two segments, rejoin.
  - `領収書/東京電力` → `東京電力/領収書`
- Rows with empty `archiveRelativePath` or wrong segment count are skipped.

## Scope

- Single file change: `src/archive.js`
- No config changes needed (no new script properties beyond `lastMigratedDocumentType` used internally)
- No changes to `src/main.js`, `src/config.js`, `src/drive.js`, or other files