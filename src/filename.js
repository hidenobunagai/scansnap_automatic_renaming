function buildSuggestedFileName_(suggestion, fileMeta, config) {
  const fallbackDate = formatDate_(fileMeta.createdAt, config.timezone);
  const parts = dedupeOrderedParts_(
    [
      normalizeIsoDate_(suggestion.documentDate) || fallbackDate,
      truncateFileSegment_(suggestion.issuer, config.maxIssuerLength),
      truncateFileSegment_(suggestion.documentType, config.maxDocumentTypeLength),
      truncateFileSegment_(suggestion.subject, config.maxSubjectLength),
    ].filter(function(part) {
      return Boolean(part);
    }),
  );

  if (parts.length === 1) {
    const fallbackSubject = truncateFileSegment_(
      stripPdfExtension_(fileMeta.name),
      config.maxSubjectLength,
    );

    if (fallbackSubject) {
      parts.push(fallbackSubject);
    }
  }

  const basename = truncateFileSegment_(parts.join("_"), 180);

  if (basename) {
    return `${basename}.pdf`;
  }

  return `${fallbackDate}_${Utilities.getUuid().slice(0, 8)}.pdf`;
}
