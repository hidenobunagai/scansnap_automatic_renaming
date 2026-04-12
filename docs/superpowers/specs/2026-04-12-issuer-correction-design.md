# Issuer Correction Design

## Context

After moving the archive structure to `発行元/書類種別` and normalizing issuer names to
half-width alphanumerics, some top-level issuer folders are still wrong because the first-pass AI
issuer extraction is too literal.

Observed examples:

- personal names such as `ながいげんた` appearing as issuer because a stamped student name is
  prominent in the document
- generic labels such as `案内`
- document-type labels such as `学級だより`
- generic institution labels such as `幼稚園`
- cases where the true sender exists in the second level or OCR body, such as `桜小学校`

The user wants two things:

- improve new issuer classification so future documents land under a more accurate sender folder
- add a one-time maintenance function to reorganize existing misclassified archive folders

The preferred direction is aggressive issuer correction: when the original issuer is weak, infer a
 stronger organization/sender from OCR text and related fields.

## Design

### 1. Add issuer correction after AI output

Keep the AI response contract unchanged, but add an issuer-correction layer after
`normalizeAiSuggestion_()` receives the raw payload.

Inputs to the correction layer:

- AI `issuer`
- AI `documentType`
- AI `subject`
- AI `summary`
- OCR extracted text

Output:

- corrected `issuer`

This keeps the existing AI integration simple and concentrates issuer heuristics in one place.

### 2. Reject weak issuer values

Treat the current `issuer` as weak and eligible for replacement when it matches one of these
patterns:

- personal-name-like short strings written mostly in hiragana or katakana
- generic document labels such as:
  - `案内`
  - `おたより`
  - `学級だより`
  - `チェックリスト`
  - `申込書`
  - `連絡`
- overly generic institution nouns such as:
  - `学校`
  - `幼稚園`
  - `保護者`

This list is not intended as a fuzzy NLP classifier. It is a deterministic guardrail layer over the
AI output.

### 3. Prefer strong organization candidates from OCR text

When the original issuer is weak, scan OCR text plus `subject` and `summary` for stronger sender
candidates.

Promote strings containing organization markers such as:

- `小学校`
- `中学校`
- `高等学校`
- `幼稚園`
- `保育園`
- `こども園`
- `児童クラブ`
- `学童`
- `市役所`
- `区役所`
- `役場`
- `水道部`
- `教育委員会`
- `管理組合`
- `株式会社`
- `有限会社`
- `合同会社`
- `法人`
- `協会`
- `組合`
- `センター`
- `病院`
- `クリニック`

Correction preference:

1. strongest organization candidate in OCR text
2. organization-like candidate in `subject`
3. organization-like candidate in `summary`
4. original issuer if no stronger candidate exists

### 4. Keep correction scope limited to issuer

This feature changes only how `issuer` is determined.

It does not change:

- `documentType` generation rules
- `subject` generation rules
- OCR extraction itself
- archive path structure (`発行元/書類種別` remains unchanged)

Once corrected, the issuer flows through the existing pipeline into:

- suggested file names
- archive folder path generation
- log sheet issuer fields

### 5. One-time correction of existing archive folders

Add a one-time maintenance function to reorganize already archived files whose first-level issuer
folder is wrong.

Proposed function name:

```js
correctArchiveIssuerFolders()
```

Responsibilities:

1. Traverse archive root issuer folders
2. Detect weak issuer folder names
3. Infer a stronger issuer candidate from available signals:
   - folder contents
   - archive file names
   - related log rows
4. If a strong corrected issuer exists:
   - move or merge the archive subtree into that issuer folder
   - rewrite archive file names when they embed the old issuer
   - update log `issuer`, `archiveRelativePath`, and `archiveFinalName`
5. If no strong candidate exists:
   - skip that issuer folder and record it in the summary

### 6. Example correction outcomes

- `ながいげんた/おたより` -> `桜小学校/おたより`
- `案内/行事` -> `桜小学校/行事` when OCR text clearly identifies the school
- `学級だより/桜小学校` -> `桜小学校/学級だより`

The correction function should not invent senders where evidence is weak. In ambiguous cases it
should skip instead of guessing.

### 7. Safety and resume behavior

The one-time correction function should be resumable and conservative.

- process one issuer folder at a time
- store progress in Script Properties
- only update log rows after the corresponding file moves/renames for that issuer succeed
- continue past per-issuer failures and include them in the summary
- skip low-confidence issuer corrections rather than forcing a rewrite

Suggested checkpoint property:

```text
lastCorrectedIssuerFolder
```

### 8. Testing scope

Add tests for:

- weak issuer detection
- organization-candidate extraction from OCR text
- issuer correction when OCR contains a stronger organization than the AI issuer
- no correction when evidence is weak
- one-time archive correction cases:
  - weak issuer folder corrected to a school/organization folder
  - merge into an existing corrected issuer folder
  - archive file rename after issuer correction
  - log updates after correction
  - resume behavior and skip behavior for low-confidence folders

## Scope

- Modify: `src/ai.js`
- Modify: `src/utils.js`
- Modify: `src/archive.js`
- Modify or create tests under `tests/`

## Non-Goals

- No general-purpose named-entity recognition system
- No OCR engine changes
- No changes to archive path ordering
- No attempt to auto-correct ambiguous issuer folders without strong evidence
