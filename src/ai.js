function requestRenameSuggestion_(extractedText, fileMeta, config) {
  const prompt = buildAiPrompt_(extractedText, fileMeta, config);
  const payload =
    config.aiProvider === "gemini"
      ? callGeminiForRename_(prompt, config)
      : callOpenAiForRename_(prompt, config);

  return normalizeAiSuggestion_(payload, fileMeta, config, extractedText);
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

function callGeminiForRename_(prompt, config) {
  const response = fetchJson_(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.aiModel)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`,
    {
      method: "post",
      contentType: "application/json",
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
        },
      }),
    },
  );
  const text = (((response.candidates || [])[0] || {}).content || {}).parts || [];
  const rawText = text
    .map(function(part) {
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

function fetchJson_(url, requestOptions) {
  const response = UrlFetchApp.fetch(
    url,
    Object.assign(
      {
        muteHttpExceptions: true,
      },
      requestOptions,
    ),
  );
  const status = response.getResponseCode();
  const bodyText = response.getContentText();

  if (status >= 300) {
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

function correctIssuerSuggestion_(payload, extractedText) {
  var issuer = normalizeIssuerText_(payload.issuer);

  if (!isWeakIssuerLabel_(issuer)) {
    return issuer;
  }

  var candidates = dedupeOrderedParts_(
    extractOrganizationCandidates_(extractedText || "")
      .concat(extractOrganizationCandidates_(payload.subject || ""))
      .concat(extractOrganizationCandidates_(payload.summary || ""))
      .map(function(candidate) {
        return normalizeIssuerText_(candidate);
      }),
  );

  return candidates[0] || issuer;
}

function normalizeAiSuggestion_(payload, fileMeta, config, extractedText) {
  const fallbackDate = formatDate_(fileMeta.createdAt, config.timezone);
  const fallbackSubject = truncateFileSegment_(stripPdfExtension_(fileMeta.name), config.maxSubjectLength);
  const subject = truncateFileSegment_(
    payload.subject || payload.summary || fallbackSubject,
    config.maxSubjectLength,
  );

  return {
    documentDate: normalizeIsoDate_(payload.documentDate) || fallbackDate,
    issuer: truncateFileSegment_(correctIssuerSuggestion_(payload, extractedText), config.maxIssuerLength),
    documentType: truncateFileSegment_(payload.documentType, config.maxDocumentTypeLength),
    subject: subject || fallbackSubject || "scan",
    summary: truncateText_(collapseWhitespace_(payload.summary || payload.subject || ""), 120),
    confidence: normalizeConfidence_(payload.confidence),
  };
}
