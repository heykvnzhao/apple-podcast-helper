import { ApiError, GoogleGenAI } from "@google/genai";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { transcriptsDir } from "../app-config.js";
import { getEpisodeDescriptionMarkdown } from "../episode-markdown-builder.js";
import transcriptFieldFormatters from "../transcript-field-formatters.js";
import { logDevWarning } from "../utils/dev-logger.js";
import { buildEpisodeContext, getPromptTemplate } from "./gemini-prompt.js";
import { buildSummaryHeader } from "./summary-presentation.js";
import { getSummaryProviderConfig } from "./summary-provider-config.js";

const SUMMARY_CACHE_MODES = new Set(["use", "refresh", "bypass"]);
const DEFAULT_SUMMARY_CACHE_MODE = "use";

let cachedGeminiClient = null;
let cachedGeminiApiKey = null;

class SummaryProviderError extends Error {
  constructor(message, { providerDisplayName, status } = {}) {
    super(message);
    this.name = "SummaryProviderError";
    this.providerDisplayName = providerDisplayName || "LLM";
    this.status = status || null;
  }
}

function getGeminiClient(apiKey) {
  if (!apiKey) {
    return null;
  }
  if (cachedGeminiClient && cachedGeminiApiKey === apiKey) {
    return cachedGeminiClient;
  }
  try {
    cachedGeminiClient = new GoogleGenAI({ apiKey });
    cachedGeminiApiKey = apiKey;
    return cachedGeminiClient;
  } catch (error) {
    console.warn(`[WARN] Unable to initialize Gemini client: ${error.message}`);
    return null;
  }
}

function getGeminiResponseText(response) {
  if (!response) {
    return "";
  }
  const directText = response.text;
  if (typeof directText === "function") {
    try {
      const value = directText();
      if (typeof value === "string") {
        return value;
      }
    } catch (error) {
      return "";
    }
  } else if (typeof directText === "string") {
    return directText;
  }
  const candidates = Array.isArray(response.candidates)
    ? response.candidates
    : [];
  if (candidates.length > 0) {
    const parts =
      candidates[0] && candidates[0].content
        ? candidates[0].content.parts
        : null;
    if (Array.isArray(parts) && parts.length > 0) {
      return parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("");
    }
  }
  if (typeof response.outputText === "string") {
    return response.outputText;
  }
  return "";
}

function hashContent(content) {
  if (!content || typeof content !== "string") {
    return "";
  }
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeSummaryCacheMode(value) {
  if (!value) {
    return DEFAULT_SUMMARY_CACHE_MODE;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_SUMMARY_CACHE_MODE;
  }
  if (SUMMARY_CACHE_MODES.has(normalized)) {
    return normalized;
  }
  return DEFAULT_SUMMARY_CACHE_MODE;
}

function buildSummaryFingerprint({
  modelId,
  prompt,
  providerId,
  transcriptContent,
}) {
  const promptHash = hashContent(prompt);
  const transcriptHash = hashContent(transcriptContent);
  return [
    `provider=${providerId}`,
    `model=${modelId}`,
    `prompt=${promptHash}`,
    `transcript=${transcriptHash}`,
  ].join(";");
}

function extractSummaryFingerprint(content) {
  if (!content || typeof content !== "string") {
    return null;
  }
  const match = content.match(/^\[summary-fingerprint\]:\s*(.+)\s*$/m);
  if (!match) {
    return null;
  }
  return match[1].trim();
}

function buildSummaryTarget(entry) {
  const summariesDir = path.join(path.dirname(transcriptsDir), "summaries");
  const { slugify, truncateSlug } = transcriptFieldFormatters;
  const meta = entry && entry.metadata ? entry.metadata : {};
  const baseFileNameFromPath = (() => {
    if (entry && entry.relativePath) {
      return path.basename(entry.relativePath, path.extname(entry.relativePath));
    }
    if (entry && entry.absolutePath) {
      return path.basename(entry.absolutePath, path.extname(entry.absolutePath));
    }
    return null;
  })();
  const showSlug =
    meta.showSlug ||
    slugify(
      entry && entry.showTitle ? entry.showTitle : meta.showTitle || "unknown-show"
    );
  const baseFileName =
    (baseFileNameFromPath && baseFileNameFromPath.trim()) ||
    (meta.baseFileName && meta.baseFileName.trim()) ||
    (() => {
      const rawTitle =
        (entry && (entry.episodeTitle || entry.showTitle)) ||
        meta.episodeTitle ||
        "unknown";
      const rawDate = (entry && entry.pubDate) || meta.pubDate || "unknown-date";
      const episodeSlug = truncateSlug(slugify(rawTitle, "episode"), 20);
      return `${showSlug}_${rawDate}_${episodeSlug}`;
    })();
  const playState =
    (entry && entry.listeningStatus && entry.listeningStatus.playState) ||
    (meta.listeningStatus && meta.listeningStatus.playState) ||
    null;
  const targetDir =
    playState === "played"
      ? path.join(summariesDir, showSlug, "played")
      : path.join(summariesDir, showSlug);
  const cacheFile = path.join(targetDir, `summary_${baseFileName}.md`);

  return {
    baseFileName,
    cacheFile,
    meta,
    playState,
    showSlug,
    summariesDir,
    targetDir,
  };
}

function buildTranscriptPrompt({ entry, prompt, transcriptContent }) {
  const metadataBlock = buildEpisodeContext(entry);
  const requestParts = [];
  if (metadataBlock) {
    requestParts.push(metadataBlock);
  }
  requestParts.push("Transcript:");
  requestParts.push(transcriptContent);
  return {
    metadataBlock,
    userContent: requestParts.join("\n\n"),
    geminiContent: [prompt, ...requestParts].join("\n\n"),
  };
}

async function runGeminiSummaryRequest({ config, geminiContent }) {
  const client = getGeminiClient(config.apiKey);
  if (!client) {
    return null;
  }
  const response = await client.models.generateContent({
    model: config.modelId,
    contents: geminiContent,
  });
  return getGeminiResponseText(response);
}

function buildDeepSeekUrl(baseUrl) {
  const normalized = String(baseUrl || "https://api.deepseek.com").replace(
    /\/+$/,
    ""
  );
  return `${normalized}/chat/completions`;
}

async function readDeepSeekErrorMessage(response) {
  try {
    const payload = await response.json();
    if (payload && payload.error && payload.error.message) {
      return payload.error.message;
    }
    if (payload && payload.message) {
      return payload.message;
    }
    return JSON.stringify(payload);
  } catch (error) {
    try {
      return await response.text();
    } catch (textError) {
      return response.statusText || "request failed";
    }
  }
}

async function runDeepSeekSummaryRequest({ config, prompt, userContent }) {
  if (!config.apiKey) {
    return null;
  }
  if (typeof fetch !== "function") {
    throw new SummaryProviderError("fetch is not available in this Node runtime", {
      providerDisplayName: config.displayName,
    });
  }
  const response = await fetch(buildDeepSeekUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
      ],
      thinking: { type: "disabled" },
      stream: false,
    }),
  });
  if (!response.ok) {
    const message = await readDeepSeekErrorMessage(response);
    throw new SummaryProviderError(message, {
      providerDisplayName: config.displayName,
      status: response.status,
    });
  }
  const payload = await response.json();
  const content =
    payload &&
    payload.choices &&
    payload.choices[0] &&
    payload.choices[0].message &&
    payload.choices[0].message.content;
  return typeof content === "string" ? content : "";
}

async function runProviderSummaryRequest({ config, geminiContent, prompt, userContent }) {
  if (config.providerId === "deepseek") {
    return runDeepSeekSummaryRequest({ config, prompt, userContent });
  }
  return runGeminiSummaryRequest({ config, geminiContent });
}

async function runSummaryRequest({ transcriptContent, entry, summaryCacheMode }) {
  if (!transcriptContent || typeof transcriptContent !== "string") {
    return null;
  }
  const prompt = getPromptTemplate();
  if (!prompt) {
    return null;
  }
  const config = getSummaryProviderConfig();
  const summaryCache = normalizeSummaryCacheMode(summaryCacheMode);
  const summaryTarget = buildSummaryTarget(entry);
  const fingerprint = buildSummaryFingerprint({
    prompt,
    modelId: config.modelId,
    providerId: config.providerId,
    transcriptContent,
  });

  if (summaryCache === "use") {
    try {
      if (fs.existsSync(summaryTarget.cacheFile)) {
        const cached = fs.readFileSync(summaryTarget.cacheFile, "utf8");
        if (
          cached &&
          cached.trim() &&
          extractSummaryFingerprint(cached) === fingerprint
        ) {
          return cached.trim();
        }
      }
    } catch (e) {
      logDevWarning("Summary cache read failed", e);
    }
  }

  if (!config.apiKey) {
    return null;
  }

  const { geminiContent, userContent } = buildTranscriptPrompt({
    entry,
    prompt,
    transcriptContent,
  });
  const summary = await runProviderSummaryRequest({
    config,
    geminiContent,
    prompt,
    userContent,
  });

  try {
    if (summary && summary.trim() && summaryCache !== "bypass") {
      try {
        if (!fs.existsSync(summaryTarget.targetDir))
          fs.mkdirSync(summaryTarget.targetDir, { recursive: true });
      } catch (e) {
        logDevWarning("Summary cache directory creation failed", e);
      }
      try {
        const description =
          getEpisodeDescriptionMarkdown(summaryTarget.meta) || null;
        const header = buildSummaryHeader({
          entry,
          providerDisplayName: config.displayName,
        });
        const fingerprintLine = `[summary-fingerprint]: ${fingerprint}\n\n`;
        let fileContent = `${header}${fingerprintLine}${summary.trim()}\n`;
        if (description) {
          fileContent += `\n---\n\n### Episode description:\n\n${description}\n`;
        }
        fs.writeFileSync(summaryTarget.cacheFile, fileContent, "utf8");
      } catch (e) {
        console.warn(
          `[WARN] Unable to write summary cache: ${
            e && e.message ? e.message : e
          }`
        );
      }
    }
  } catch (e) {
    logDevWarning("Summary cache update failed", e);
  }
  return summary && summary.trim() ? summary.trim() : null;
}

function logSummaryError(error) {
  if (error instanceof ApiError) {
    console.warn(
      `[WARN] Gemini summarization failed (${
        error.status || "unknown status"
      }): ${error.message}`
    );
    return;
  }
  if (error instanceof SummaryProviderError) {
    const status = error.status || "unknown status";
    console.warn(
      `[WARN] ${error.providerDisplayName} summarization failed (${status}): ${error.message}`
    );
    return;
  }
  const message = error && error.message ? error.message : error;
  console.warn(`[WARN] LLM summarization error: ${message}`);
}

export {
  buildSummaryFingerprint,
  extractSummaryFingerprint,
  logSummaryError,
  runSummaryRequest,
};
