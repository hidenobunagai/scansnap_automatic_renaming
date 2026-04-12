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

function normalizeIssuerText_(value) {
  return collapseWhitespace_(String(value || "").replace(/[\u3000\uFF01-\uFF5E]/g, function(char) {
    if (char === "\u3000") {
      return " ";
    }

    return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
  }));
}

const WEAK_ISSUER_LABELS_ = [
  "案内",
  "おたより",
  "学級だより",
  "チェックリスト",
  "申込書",
  "連絡",
  "学校",
  "幼稚園",
  "保護者",
];

const ORGANIZATION_MARKERS_ = [
  "小学校",
  "中学校",
  "高等学校",
  "幼稚園",
  "保育園",
  "こども園",
  "児童クラブ",
  "学童",
  "市役所",
  "区役所",
  "役場",
  "水道部",
  "教育委員会",
  "管理組合",
  "株式会社",
  "有限会社",
  "合同会社",
  "法人",
  "協会",
  "組合",
  "センター",
  "病院",
  "クリニック",
];

const ORGANIZATION_TRAILING_SUFFIX_PATTERNS_ = [
  /定例会資料$/,
  /請求書$/,
  /納品書$/,
  /おたより$/,
  /案内$/,
  /[0-9０-９]{1,2}月号$/,
];

const ORGANIZATION_LEADING_LABELS_ = [
  "差出人",
  "発行者",
  "送付元",
  "発信元",
  "宛先",
];

function isWeakIssuerLabel_(value) {
  var text = collapseWhitespace_(value);

  if (!text) {
    return true;
  }

  if (WEAK_ISSUER_LABELS_.indexOf(text) !== -1) {
    return true;
  }

  return false;
}

function trimOrganizationCandidateSuffix_(value) {
  var candidate = collapseWhitespace_(value);
  var markerEnd = -1;

  ORGANIZATION_MARKERS_.forEach(function(marker) {
    var markerIndex = candidate.lastIndexOf(marker);

    if (markerIndex === -1) {
      return;
    }

    markerEnd = Math.max(markerEnd, markerIndex + marker.length);
  });

  if (markerEnd === -1 || markerEnd >= candidate.length) {
    return candidate;
  }

  var trimmed = candidate;
  var changed = true;

  while (changed) {
    changed = false;

    ORGANIZATION_TRAILING_SUFFIX_PATTERNS_.some(function(pattern) {
      var next = trimmed.replace(pattern, "");

      if (next === trimmed || next.length < markerEnd) {
        return false;
      }

      trimmed = next;
      changed = true;
      return true;
    });
  }

  return collapseWhitespace_(trimmed);
}

function trimOrganizationCandidatePrefix_(value) {
  var candidate = collapseWhitespace_(value);
  var trimmed = candidate;
  var changed = true;

  while (changed) {
    changed = false;

    ORGANIZATION_LEADING_LABELS_.some(function(label) {
      var pattern = new RegExp("^" + label + "\\s+");
      var next = trimmed.replace(pattern, "");

      if (next === trimmed) {
        return false;
      }

      trimmed = next;
      changed = true;
      return true;
    });
  }

  return trimmed;
}

function trimOrganizationCandidateStart_(value) {
  var candidate = collapseWhitespace_(value);
  var markerIndex = -1;
  var marker = "";
  var allowedLeadingCharacterPattern = /[A-Z0-9\u30A0-\u30FF\u3400-\u9FFF々ー・()（）.&'\-\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\s]/i;
  var start = -1;
  var cursor;

  ORGANIZATION_MARKERS_.forEach(function(currentMarker) {
    var index = candidate.indexOf(currentMarker);

    if (index === -1) {
      return;
    }

    if (markerIndex === -1 || index < markerIndex) {
      markerIndex = index;
      marker = currentMarker;
    }
  });

  if (markerIndex === -1) {
    return candidate;
  }

  if (marker === "株式会社" || marker === "有限会社" || marker === "合同会社") {
    return candidate.slice(markerIndex);
  }

  start = markerIndex;
  cursor = markerIndex - 1;

  while (cursor >= 0 && allowedLeadingCharacterPattern.test(candidate.charAt(cursor))) {
    start = cursor;
    cursor -= 1;
  }

  while (start < markerIndex && /\s/.test(candidate.charAt(start))) {
    start += 1;
  }

  return collapseWhitespace_(candidate.slice(start));
}

function extractOrganizationCandidates_(value) {
  var text = collapseWhitespace_(value);
  var candidates = [];
  var markerPattern = ORGANIZATION_MARKERS_
    .slice()
    .sort(function(a, b) {
      return b.length - a.length;
    })
    .join("|");
  var boundaryPattern = "(?:$|[\\s　、。()（）]|から|より|の|は|が|を|に|へ|と|で)";
  var candidatePattern = "[^、。()（）]{0,20}?(?:" + markerPattern + ")[^、。()（）]{0,20}?";
  var pattern = new RegExp(
    "(?:^|[\\s　、。()（）]|から|より|の|は|が|を|に|へ|と|で)(" +
      candidatePattern +
      ")" +
      "(?=" +
      boundaryPattern +
      ")",
    "g",
  );
  var match;

  while ((match = pattern.exec(text)) !== null) {
    candidates.push(
      trimOrganizationCandidatePrefix_(
        trimOrganizationCandidateStart_(trimOrganizationCandidateSuffix_(match[1])),
      ),
    );
  }

  return dedupeOrderedParts_(candidates);
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
