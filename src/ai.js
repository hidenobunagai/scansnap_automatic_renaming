// Closed set so archive folders don't fragment (the log had 78 distinct free-form types).
const DOCUMENT_TYPES_ = Object.freeze([
  "学級通信",
  "学校だより",
  "お知らせ",
  "案内",
  "通知書",
  "決定通知書",
  "証明書",
  "契約書",
  "請求書",
  "領収書",
  "明細書",
  "申込書",
  "提出書類",
  "アンケート",
  "議事録",
  "会議資料",
  "献立表",
  "予定表",
  "検査結果",
  "保証書",
  "その他",
]);

// Base64 inflates ~4/3 and Gemini caps inline requests at 20MB.
const MAX_INLINE_PDF_BYTES_ = 10 * 1024 * 1024;

function requestRenameSuggestion_(extractedText, fileMeta, config) {
  const prompt = buildAiPrompt_(extractedText, fileMeta, config);
  const payload =
    config.aiProvider === "gemini"
      ? callGeminiForRename_(prompt, config, getPdfInlinePart_(fileMeta))
      : callOpenAiForRename_(prompt, config);

  return normalizeAiSuggestion_(payload, fileMeta, config, extractedText);
}

function buildAiPrompt_(extractedText, fileMeta, config) {
  const promptText = truncateText_(collapseWhitespace_(extractedText), config.maxPromptChars);

  const knownIssuers = config.knownIssuers || [];

  return [
    "You rename scanned PDF files for a personal Japanese document archive.",
    "Return JSON only.",
    'Schema: {"documentDate":"YYYY-MM-DD or null","issuer":"string","documentType":"string","subject":"string","summary":"string","confidence":0}',
    "Rules:",
    "- Use concise Japanese labels.",
    "- Do not include the .pdf extension.",
    "- issuer: the official full name of the sending organization as printed (letterhead, seal, 差出人, footer).",
    "  Never a class name (いけいけ1組, 2年1組), a teacher or person name, or a generic word alone (学校, 幼稚園, 小学校, PTA, 自転車店).",
    "  For school communications use the full school name (e.g. 三郷市立桜小学校, not 桜小学校).",
    knownIssuers.length
      ? `- Known issuers (if the sender is one of these organizations, return the string exactly as listed): ${knownIssuers.join(", ")}`
      : "",
    `- documentType: pick exactly one of: ${DOCUMENT_TYPES_.join(", ")}.`,
    "  学級通信 = class/grade newsletters; 学校だより = school-wide, library or health newsletters; 検査結果 = health check or fitness test results.",
    "- documentDate: the issue date printed on the document (発行日/作成日/日付 near the top). Convert Japanese eras (令和7年 = 2025).",
    "  If no issue date is printed, use the start of the period the document covers (a weekly schedule 7/7-7/11 -> 7/7, a 10月号 -> the 1st),",
    "  but only when the year is printed too (令和7年度 counts: April-December is 2025, January-March is 2026). Never guess the year; return null instead.",
    "- subject: 5-25 characters that distinguish this file from similar ones (event, period, target person, item).",
    "  Do not repeat the issuer or documentType in subject. For numbered newsletters include the issue number (e.g. 第14号).",
    "- confidence: 0 to 1. Lower it when the issuer, date or type had to be guessed or the text is garbled.",
    "- If a field is unknown, return an empty string or null.",
    `- Filename style hint: ${config.filenamePatternHint}`,
    `- Original filename: ${fileMeta.name}`,
    "OCR text (may contain recognition errors; prefer the attached PDF when they disagree):",
    promptText,
  ]
    .filter(Boolean)
    .join("\n");
}

function getPdfInlinePart_(fileMeta) {
  try {
    const blob = DriveApp.getFileById(fileMeta.id).getBlob();
    const bytes = blob.getBytes();

    if (bytes.length > MAX_INLINE_PDF_BYTES_) {
      return null;
    }

    return {
      inlineData: {
        mimeType: "application/pdf",
        data: Utilities.base64Encode(bytes),
      },
    };
  } catch (error) {
    logError_("Failed to attach PDF to AI request; falling back to OCR text only.", {
      fileId: fileMeta.id,
      error: getErrorMessage_(error),
    });
    return null;
  }
}

function callGeminiForRename_(prompt, config, pdfPart) {
  const response = fetchJson_(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.aiModel)}:generateContent`,
    {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-goog-api-key": config.geminiApiKey,
      },
      payload: JSON.stringify({
        contents: [
          {
            parts: (pdfPart ? [pdfPart] : []).concat([{ text: prompt }]),
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              documentDate: { type: "string" },
              issuer: { type: "string" },
              documentType: { type: "string", enum: DOCUMENT_TYPES_.slice() },
              subject: { type: "string" },
              summary: { type: "string" },
              confidence: { type: "number" },
            },
            required: [
              "documentDate",
              "issuer",
              "documentType",
              "subject",
              "summary",
              "confidence",
            ],
          },
        },
      }),
    },
  );
  const text = (((response.candidates || [])[0] || {}).content || {}).parts || [];
  const rawText = text
    .map(function (part) {
      return part.text || "";
    })
    .join("");

  return parseJsonObjectResponse_(rawText);
}

function callOpenAiForRename_(prompt, config) {
  const response = fetchJson_(config.openAiBaseUrl, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
    },
    payload: JSON.stringify({
      model: config.aiModel,
      temperature: 0.1,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: "You rename scanned PDF files and always return valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });
  const rawText = (((response.choices || [])[0] || {}).message || {}).content || "";

  return parseJsonObjectResponse_(rawText);
}

function fetchJson_(url, requestOptions, attempt) {
  var currentAttempt = typeof attempt === "number" ? attempt : 0;
  var response;
  try {
    response = UrlFetchApp.fetch(
      url,
      Object.assign(
        {
          muteHttpExceptions: true,
        },
        requestOptions,
      ),
    );
  } catch (error) {
    if (currentAttempt < 2) {
      Utilities.sleep(Math.pow(2, currentAttempt) * 1000 + Math.random() * 500);
      return fetchJson_(url, requestOptions, currentAttempt + 1);
    }
    throw error;
  }
  var status = response.getResponseCode();
  var bodyText = response.getContentText();

  if (status >= 300) {
    var isRetryable = status === 429 || status === 408 || status >= 500;
    if (isRetryable && currentAttempt < 2) {
      Utilities.sleep(Math.pow(2, currentAttempt) * 1000 + Math.random() * 500);
      return fetchJson_(url, requestOptions, currentAttempt + 1);
    }
    throw new Error(`External API request failed (${status}): ${truncateText_(bodyText, 400)}`);
  }

  return JSON.parse(bodyText);
}

function parseJsonObjectResponse_(content) {
  const rawText = String(content || "").trim();
  const codeFenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = codeFenceMatch ? codeFenceMatch[1].trim() : rawText;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("AI response did not contain a JSON object.");
  }

  return JSON.parse(text.slice(start, end + 1));
}

function correctIssuerSuggestion_(payload, extractedText, config) {
  var issuer = normalizeIssuerText_(payload.issuer);

  if (!issuer) {
    return issuer;
  }

  if (isWeakIssuerLabel_(issuer, config)) {
    var candidates = dedupeOrderedParts_(
      extractOrganizationCandidates_(extractedText || "")
        .concat(extractOrganizationCandidates_(payload.subject || ""))
        .concat(extractOrganizationCandidates_(payload.summary || ""))
        .map(function (candidate) {
          return normalizeIssuerText_(candidate);
        }),
    );
    return candidates[0] || issuer;
  }

  var stripped = stripTrailingWeakLabelSuffix_(issuer);
  if (stripped !== issuer) {
    return stripped;
  }

  var expanded = expandTruncatedOrganization_(issuer, extractedText, payload);
  if (expanded !== issuer) {
    return expanded;
  }

  return issuer;
}

function stripTrailingWeakLabelSuffix_(value) {
  var text = collapseWhitespace_(String(value || ""));
  if (!text) return value;

  for (var i = 0; i < WEAK_ISSUER_LABELS_.length; i++) {
    var label = WEAK_ISSUER_LABELS_[i];
    var separators = ["-", "_", " "];

    for (var j = 0; j < separators.length; j++) {
      var suffix = separators[j] + label;

      if (text.length > suffix.length && text.lastIndexOf(suffix) === text.length - suffix.length) {
        var prefix = text.slice(0, text.length - suffix.length);

        if (prefix && !isWeakIssuerLabel_(prefix)) {
          return prefix;
        }
      }
    }
  }

  return value;
}

function expandTruncatedOrganization_(issuer, extractedText, payload) {
  if (!issuer || endsAtMarkerBoundary_(issuer)) return issuer;

  var text = [extractedText || "", payload.subject || "", payload.summary || ""].join(" ");
  var candidates = extractOrganizationCandidates_(text);
  var issuerNorm = normalizeIssuerText_(issuer);

  for (var i = 0; i < candidates.length; i++) {
    if (normalizeIssuerText_(candidates[i]) === issuerNorm) {
      return issuer;
    }
  }

  for (var i = 0; i < candidates.length; i++) {
    var candidate = normalizeIssuerText_(candidates[i]);

    if (candidate.length > issuerNorm.length && candidate.indexOf(issuerNorm) === 0) {
      return candidate;
    }
  }

  return issuer;
}

function endsAtMarkerBoundary_(value) {
  for (var i = 0; i < ORGANIZATION_MARKERS_.length; i++) {
    var marker = ORGANIZATION_MARKERS_[i];
    var idx = value.lastIndexOf(marker);

    if (idx !== -1 && idx + marker.length === value.length) {
      return true;
    }
  }

  return false;
}

function normalizeDocumentType_(value) {
  const text = collapseWhitespace_(value);

  return DOCUMENT_TYPES_.indexOf(text) !== -1 ? text : "";
}

function matchKnownIssuer_(issuer, knownIssuers) {
  const norm = normalizeIssuerText_(issuer);

  if (!norm) {
    return issuer;
  }

  const known = (knownIssuers || []).map(normalizeIssuerText_);

  if (known.indexOf(norm) !== -1) {
    return norm;
  }

  // 桜小学校 -> 三郷市立桜小学校. Suffix only: a prefix match would also turn
  // 桜小学校 into 桜小学校児童クラブ, which is a different organization.
  const matches = known.filter(function (name) {
    return name.length > norm.length && name.slice(-norm.length) === norm;
  });

  return matches.length === 1 ? matches[0] : issuer;
}

function isIssuerGrounded_(issuer, extractedText, knownIssuers) {
  const key = function (value) {
    return normalizeIssuerText_(value).replace(/\s+/g, "");
  };
  const issuerKey = key(issuer);

  if (!issuerKey) {
    return false;
  }

  return (
    key(extractedText).indexOf(issuerKey) !== -1 ||
    (knownIssuers || []).some(function (name) {
      return key(name) === issuerKey;
    })
  );
}

function normalizeAiSuggestion_(payload, fileMeta, config, extractedText) {
  const fallbackDate = formatDate_(fileMeta.createdAt, config.timezone);
  const fallbackSubject = truncateFileSegment_(
    stripPdfExtension_(fileMeta.name),
    config.maxSubjectLength,
  );
  const subject = truncateFileSegment_(
    payload.subject || payload.summary || fallbackSubject,
    config.maxSubjectLength,
  );
  const documentDate = normalizeIsoDate_(payload.documentDate);
  const documentType = normalizeDocumentType_(payload.documentType);
  const issuer = matchKnownIssuer_(
    correctIssuerSuggestion_(payload, extractedText, config),
    config.knownIssuers,
  );
  const reviewReasons = [];

  if (!documentDate) {
    reviewReasons.push("No issue date found; used Drive created date.");
  }

  if (!documentType) {
    reviewReasons.push(
      `documentType "${collapseWhitespace_(payload.documentType)}" is not in the allowed list.`,
    );
  }

  if (isWeakIssuerLabel_(issuer, config)) {
    reviewReasons.push(`Issuer "${issuer}" is a generic label.`);
  } else if (!isIssuerGrounded_(issuer, extractedText, config.knownIssuers)) {
    reviewReasons.push(`Issuer "${issuer}" was not found in the OCR text or known issuers.`);
  }

  // Self-reported confidence is ~1 for almost everything, so it can't gate renames on its own.
  const confidence = reviewReasons.length
    ? Math.min(normalizeConfidence_(payload.confidence), Math.max(0, config.minConfidence - 0.01))
    : normalizeConfidence_(payload.confidence);

  return {
    documentDate: documentDate || fallbackDate,
    issuer: truncateFileSegment_(issuer, config.maxIssuerLength),
    documentType: truncateFileSegment_(documentType, config.maxDocumentTypeLength),
    subject: subject || fallbackSubject || "scan",
    summary: truncateText_(collapseWhitespace_(payload.summary || payload.subject || ""), 120),
    confidence: confidence,
    reviewReasons: reviewReasons,
  };
}
