const fs = require("fs");
const path = require("path");

const { ApiError, GoogleGenAI } = require("@google/genai");

const { getGeminiApiKey } = require("../env");

const DEFAULT_MODEL_ID = "gemini-2.5-flash";
const PROMPT_PATH = path.resolve(
  __dirname,
  "../../prompts/podcasts-summarizer.md"
);

let cachedPrompt = null;
let promptMissing = false;
let cachedClient = null;
let cachedApiKey = null;

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

async function maybeSummarizeTranscript({ transcriptContent, entry }) {
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

  let response = null;
  try {
    response = await client.models.generateContent({
      model: DEFAULT_MODEL_ID,
      contents: requestParts.join("\n\n"),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      console.warn(
        `[WARN] Gemini summarization failed (${
          error.status || "unknown status"
        }): ${error.message}`
      );
    } else {
      console.warn(
        `[WARN] Gemini summarization error: ${error.message || error}`
      );
    }
    return null;
  }
  if (!response) {
    return null;
  }
  const responseText = response.text;
  const summary =
    typeof responseText === "function"
      ? responseText()
      : typeof responseText === "string"
      ? responseText
      : responseText
      ? String(responseText)
      : null;
  if (!summary || !summary.trim()) {
    console.warn("[WARN] Gemini summarization returned an empty response.");
    return null;
  }
  return summary.trim();
}

async function maybePrintGeminiSummary({ transcriptContent, entry }) {
  const summary = await maybeSummarizeTranscript({ transcriptContent, entry });
  if (!summary) {
    return null;
  }
  console.log("");
  console.log("🤖 Gemini summary");
  console.log("");
  console.log(summary);
  console.log("");
  return summary;
}

module.exports = {
  maybeSummarizeTranscript,
  maybePrintGeminiSummary,
};
