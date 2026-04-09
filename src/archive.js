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
