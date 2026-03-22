function collapseWhitespace_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripPdfExtension_(value) {
  return String(value || "").replace(/\.pdf$/i, "");
}

function sanitizeFileSegment_(value) {
  return collapseWhitespace_(value)
    .replace(/[\/\\:*?"<>|#%{}[\]^`~]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
}

function truncateText_(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 3) {
    return text.slice(0, maxLength);
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function truncateFileSegment_(value, maxLength) {
  const sanitized = sanitizeFileSegment_(value);

  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  return sanitized.slice(0, maxLength).replace(/[-_.]+$/g, "");
}

function dedupeOrderedParts_(parts) {
  const seen = {};
  const deduped = [];

  parts.forEach(function(part) {
    const normalized = String(part || "").toLowerCase();

    if (!part || seen[normalized]) {
      return;
    }

    seen[normalized] = true;
    deduped.push(part);
  });

  return deduped;
}

function formatDate_(dateValue, timezone) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return Utilities.formatDate(date, timezone || Session.getScriptTimeZone() || "Asia/Tokyo", "yyyy-MM-dd");
}

function normalizeIsoDate_(value) {
  const text = collapseWhitespace_(value).replace(/[./]/g, "-");
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (!match) {
    return "";
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    return "";
  }

  return Utilities.formatString("%04d-%02d-%02d", year, month, day);
}

function normalizeConfidence_(value) {
  const numeric = Number(value);

  if (Number.isNaN(numeric)) {
    return 0;
  }

  return clampNumber_(numeric, 0, 1);
}

function clampNumber_(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeDriveQueryValue_(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getErrorMessage_(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return JSON.stringify(error);
}
