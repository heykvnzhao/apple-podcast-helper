const fs = require("fs");
const path = require("path");

const { ApiError, GoogleGenAI } = require("@google/genai");
const { marked } = require("marked");
const { markedTerminal } = require("marked-terminal");

const { createProgressIndicator } = require("../cli/progress-indicator");
const { getGeminiApiKey } = require("../env");

const DEFAULT_MODEL_ID = "gemini-2.5-flash";
const PROMPT_PATH = path.resolve(
  __dirname,
  "../../prompts/podcasts-summarizer.md"
);
const DEFAULT_TERMINAL_WIDTH = 100;

let cachedPrompt = null;
let promptMissing = false;
let cachedClient = null;
let cachedApiKey = null;
let markedConfigured = false;

function getPromptTemplate() {
  if (cachedPrompt) {
    return cachedPrompt;
  }
  if (promptMissing) {
    return null;
  }
  try {
    const raw = fs.readFileSync(PROMPT_PATH, "utf8");
    cachedPrompt = raw ? raw.trim() : "";
    return cachedPrompt;
  } catch (error) {
    if (!promptMissing) {
      console.warn(
        `[WARN] Gemini prompt file missing or unreadable at ${PROMPT_PATH}: ${error.message}`
      );
      promptMissing = true;
    }
    return null;
  }
}

function getClient() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return null;
  }
  if (cachedClient && cachedApiKey === apiKey) {
    return cachedClient;
  }
  try {
    cachedClient = new GoogleGenAI({ apiKey });
    cachedApiKey = apiKey;
    return cachedClient;
  } catch (error) {
    console.warn(`[WARN] Unable to initialize Gemini client: ${error.message}`);
    return null;
  }
}

function buildEpisodeContext(entry) {
  if (!entry) {
    return null;
  }
  const lines = [];
  const showTitle =
    entry.showTitle || (entry.metadata && entry.metadata.showTitle) || null;
  const episodeTitle =
    entry.episodeTitle ||
    (entry.metadata && entry.metadata.episodeTitle) ||
    null;
  const stationTitle = entry.stationTitle || null;
  const pubDate =
    entry.pubDate && entry.pubDate !== "unknown-date"
      ? entry.pubDate
      : entry.metadata && entry.metadata.pubDate;

  if (showTitle) {
    lines.push(`Show: ${showTitle}`);
  }
  if (episodeTitle) {
    lines.push(`Episode: ${episodeTitle}`);
  }
  if (pubDate) {
    lines.push(`Published: ${pubDate}`);
  }
  if (stationTitle) {
    lines.push(`Publisher: ${stationTitle}`);
  }
  if (!lines.length) {
    return null;
  }
  return `Episode details:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

function ensureMarkedConfigured() {
  if (markedConfigured) {
    return;
  }
  const width =
    process.stdout &&
    typeof process.stdout.columns === "number" &&
    process.stdout.columns > 40
      ? Math.min(process.stdout.columns, 120)
      : DEFAULT_TERMINAL_WIDTH;
  marked.use(
    markedTerminal({
      reflowText: false,
      showSectionPrefix: false,
      tab: 2,
      width,
    })
  );
  markedConfigured = true;
}

function formatMarkdown(markdown) {
  ensureMarkedConfigured();
  const normalized = normalizeGeminiMarkdown(markdown);
  const parsed = marked.parse(normalized || "");
  return parsed.endsWith("\n") ? parsed : `${parsed}\n`;
}

function normalizeGeminiMarkdown(markdown) {
	if (!markdown) {
		return "";
	}
	const fixed = markdown
		.replace(/\n{2,}(\s*[\*\-])/g, "\n$1")
		.replace(/^\s+([\*\-])/gm, "$1");
	return fixed;
}

function getResponseText(response) {
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

async function runGeminiRequest({ transcriptContent, entry }) {
  if (!transcriptContent || typeof transcriptContent !== "string") {
    return null;
  }
  const prompt = getPromptTemplate();
  if (!prompt) {
    return null;
  }
  const client = getClient();
  if (!client) {
    return null;
  }
  const metadataBlock = buildEpisodeContext(entry);
  const requestParts = [prompt];
  if (metadataBlock) {
    requestParts.push(metadataBlock);
  }
  requestParts.push("Transcript:");
  requestParts.push(transcriptContent);
  const request = {
    model: DEFAULT_MODEL_ID,
    contents: requestParts.join("\n\n"),
  };
  const response = await client.models.generateContent(request);
  const summary = getResponseText(response);
  return summary && summary.trim() ? summary.trim() : null;
}

function logGeminiError(error) {
  if (error instanceof ApiError) {
    console.warn(
      `[WARN] Gemini summarization failed (${
        error.status || "unknown status"
      }): ${error.message}`
    );
    return;
  }
  const message = error && error.message ? error.message : error;
  console.warn(`[WARN] Gemini summarization error: ${message}`);
}

async function maybeSummarizeTranscript({ transcriptContent, entry }) {
  try {
    const summary = await runGeminiRequest({ transcriptContent, entry });
    return summary && summary.trim() ? summary.trim() : null;
  } catch (error) {
    logGeminiError(error);
    return null;
  }
}

async function maybePrintGeminiSummary({ transcriptContent, entry }) {
  const progress = createProgressIndicator({ label: "Summarizing transcript" });
  progress.start();
  let spinnerActive = true;
  let summary = null;

  try {
    summary = await runGeminiRequest({ transcriptContent, entry });
  } catch (error) {
    if (spinnerActive) {
      progress.fail("Gemini summary failed");
      spinnerActive = false;
    }
    logGeminiError(error);
    return null;
  }

  if (!summary) {
    if (spinnerActive) {
      progress.stop();
      spinnerActive = false;
    }
    return null;
  }

  if (spinnerActive) {
    progress.done("Gemini summary ready");
    spinnerActive = false;
  }

  console.log("");
  console.log("🤖 Gemini summary");
  console.log("");
  const formatted = formatMarkdown(summary);
  process.stdout.write(formatted);
  console.log("");

  return summary.trim();
}

module.exports = {
  maybeSummarizeTranscript,
  maybePrintGeminiSummary,
};
