function requestRenameSuggestion_(extractedText, fileMeta, config) {
  const prompt = buildAiPrompt_(extractedText, fileMeta, config);
  const payload =
    config.aiProvider === "gemini"
      ? callGeminiForRename_(prompt, config)
      : callOpenAiForRename_(prompt, config);

  return normalizeAiSuggestion_(payload, fileMeta, config, extractedText);
}

function requestRenameSuggestionDirect_(pdfBlob, fileMeta, config) {
  const prompt = buildAiDirectPrompt_(fileMeta, config);
  const pdfBase64 = Utilities.base64Encode(pdfBlob.getBytes());
  const payload = callGeminiForRenameDirect_(pdfBase64, prompt, config);

  return normalizeAiSuggestion_(
    payload,
    fileMeta,
    config,
    [payload.summary || "", payload.subject || ""].join(" "),
  );
}

function buildAiPrompt_(extractedText, fileMeta, config) {
  const promptText = truncateText_(collapseWhitespace_(extractedText), config.maxPromptChars);

  return [
    "You rename scanned PDF files for a personal Japanese document archive.",
    "Return JSON only.",
    'Schema: {"documentDate":"YYYY-MM-DD or null","issuer":"string","documentType":"string","subject":"string","summary":"string","confidence":0}',
    "Rules:",
    "- Use concise Japanese labels.",
    "- Do not include the .pdf extension.",
    "- issuer should be the organization, company, or sender if identifiable.",
    "- For school communications (学級通信, おたより, etc.), use the school name (学校名) as issuer, never a class name (クラス名 like いけいけ1組).",
    "- documentType should be a short category like invoice, statement, receipt, or tax notice in Japanese.",
    "- subject should be a short detail that helps distinguish this file from similar files.",
    "- confidence must be a number from 0 to 1.",
    "- If a field is unknown, return an empty string or null.",
    `- Filename style hint: ${config.filenamePatternHint}`,
    `- Original filename: ${fileMeta.name}`,
    `- Drive created date fallback: ${formatDate_(fileMeta.createdAt, config.timezone)}`,
    "Extracted text:",
    promptText,
  ].join("\n");
}

function buildAiDirectPrompt_(fileMeta, config) {
  return [
    "You rename scanned PDF files for a personal Japanese document archive.",
    "The attached inline file is the scanned document.",
    "Return JSON only.",
    'Schema: {"documentDate":"YYYY-MM-DD or null","issuer":"string","documentType":"string","subject":"string","summary":"string","confidence":0}',
    "Rules:",
    "- Use concise Japanese labels.",
    "- Do not include the .pdf extension.",
    "- issuer should be the organization, company, or sender if identifiable.",
    "- For school communications (学級通信, おたより, etc.), use the school name (学校名) as issuer, never a class name (クラス名 like いけいけ1組).",
    "- documentType should be a short category like invoice, statement, receipt, or tax notice in Japanese.",
    "- subject should be a short detail that helps distinguish this file from similar files.",
    "- confidence must be a number from 0 to 1.",
    "- If a field is unknown, return an empty string or null.",
    `- Filename style hint: ${config.filenamePatternHint}`,
    `- Original filename: ${fileMeta.name}`,
    `- Drive created date fallback: ${formatDate_(fileMeta.createdAt, config.timezone)}`,
  ].join("\n");
}

function callGeminiForRename_(prompt, config) {
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
            parts: [
              {
                text: prompt,
              },
            ],
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
              documentType: { type: "string" },
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

function callGeminiForRenameDirect_(pdfBase64, prompt, config) {
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
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: pdfBase64,
                },
              },
              {
                text: prompt,
              },
            ],
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
              documentType: { type: "string" },
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
  const currentAttempt = typeof attempt === "number" ? attempt : 0;
  let response;
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
  const status = response.getResponseCode();
  const bodyText = response.getContentText();

  if (status >= 300) {
    const isRetryable = status === 429 || status === 408 || status >= 500;
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
  const issuer = normalizeIssuerText_(payload.issuer);

  if (!issuer) {
    return issuer;
  }

  if (isWeakIssuerLabel_(issuer, config)) {
    const candidates = dedupeOrderedParts_(
      extractOrganizationCandidates_(extractedText || "")
        .concat(extractOrganizationCandidates_(payload.subject || ""))
        .concat(extractOrganizationCandidates_(payload.summary || ""))
        .map(function (candidate) {
          return normalizeIssuerText_(candidate);
        }),
    );
    return candidates[0] || issuer;
  }

  const stripped = stripTrailingWeakLabelSuffix_(issuer);
  if (stripped !== issuer) {
    return stripped;
  }

  const expanded = expandTruncatedOrganization_(issuer, extractedText, payload);
  if (expanded !== issuer) {
    return expanded;
  }

  return issuer;
}

function stripTrailingWeakLabelSuffix_(value) {
  const text = collapseWhitespace_(String(value || ""));
  if (!text) return value;

  for (let i = 0; i < WEAK_ISSUER_LABELS_.length; i++) {
    const label = WEAK_ISSUER_LABELS_[i];
    const separators = ["-", "_", " "];

    for (let j = 0; j < separators.length; j++) {
      const suffix = separators[j] + label;

      if (text.length > suffix.length && text.lastIndexOf(suffix) === text.length - suffix.length) {
        const prefix = text.slice(0, text.length - suffix.length);

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

  const text = [extractedText || "", payload.subject || "", payload.summary || ""].join(" ");
  const candidates = extractOrganizationCandidates_(text);
  const issuerNorm = normalizeIssuerText_(issuer);

  for (let i = 0; i < candidates.length; i++) {
    if (normalizeIssuerText_(candidates[i]) === issuerNorm) {
      return issuer;
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidate = normalizeIssuerText_(candidates[i]);

    if (candidate.length > issuerNorm.length && candidate.indexOf(issuerNorm) === 0) {
      return candidate;
    }
  }

  return issuer;
}

function endsAtMarkerBoundary_(value) {
  for (let i = 0; i < ORGANIZATION_MARKERS_.length; i++) {
    const marker = ORGANIZATION_MARKERS_[i];
    const idx = value.lastIndexOf(marker);

    if (idx !== -1 && idx + marker.length === value.length) {
      return true;
    }
  }

  return false;
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

  return {
    documentDate: normalizeIsoDate_(payload.documentDate) || fallbackDate,
    issuer: truncateFileSegment_(
      correctIssuerSuggestion_(payload, extractedText, config),
      config.maxIssuerLength,
    ),
    documentType: truncateFileSegment_(payload.documentType, config.maxDocumentTypeLength),
    subject: subject || fallbackSubject || "scan",
    summary: truncateText_(collapseWhitespace_(payload.summary || payload.subject || ""), 120),
    confidence: normalizeConfidence_(payload.confidence),
  };
}
