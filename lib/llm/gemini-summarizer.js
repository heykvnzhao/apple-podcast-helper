import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { ApiError, GoogleGenAI } from "@google/genai";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import wrapAnsi from "wrap-ansi";

import { createProgressIndicator } from "../cli/progress-indicator.js";
import { getGeminiApiKey } from "../env.js";

const DEFAULT_MODEL_ID = "gemini-2.5-flash-lite";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
let lastPrintedLines = 0;
let lastRawSummary = null;
let resizeHandlerInstalled = false;

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
  // Configure marked-terminal with a very large width so it doesn't
  // perform aggressive wrapping itself. We'll do wrapping with
  // `wrap-ansi` so we can reflow dynamically on terminal resize.
  const configuredWidth = 10000;
  marked.use(
    markedTerminal({
      reflowText: false,
      showSectionPrefix: false,
      tab: 2,
      width: configuredWidth,
    })
  );
  markedConfigured = true;
}

function formatMarkdown(markdown) {
  ensureMarkedConfigured();
  const normalized = normalizeGeminiMarkdown(markdown);
  const parsed = marked.parse(normalized || "");
  // If we're running in a TTY, wrap to the current terminal width.
  // Otherwise return the parsed output untouched.
  if (
    process.stdout &&
    process.stdout.isTTY &&
    typeof process.stdout.columns === "number"
  ) {
    const width = Math.max(
      20,
      process.stdout.columns || DEFAULT_TERMINAL_WIDTH
    );
    const wrapped = wrapAnsi(parsed, width, { hard: false });
    return wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`;
  }

  return parsed.endsWith("\n") ? parsed : `${parsed}\n`;
}

function normalizeGeminiMarkdown(markdown) {
  if (!markdown || typeof markdown !== "string") {
    return "";
  }
  let md = markdown.replace(/\r\n/g, "\n");
  // Collapse 3+ newlines to two
  md = md.replace(/\n{3,}/g, "\n\n");
  // Ensure there's a blank line before any Markdown heading (e.g., ### Heading)
  md = md.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
  // Ensure there's a blank line after any Markdown heading line
  md = md.replace(/(#{1,6}[^\n]*\n)(?!\n)/g, "$1\n");
  return md;
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
  const progress = createProgressIndicator({
    label: "Summarizing transcript",
  });
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
  // Keep the original summary so we can reflow on terminal resize.
  lastRawSummary = summary;

  function renderAndTrack() {
    const formatted = formatMarkdown(lastRawSummary);
    // Clear previously printed lines (if any) by moving the cursor up and clearing lines.
    if (process.stdout && process.stdout.isTTY && lastPrintedLines > 0) {
      for (let i = 0; i < lastPrintedLines; i++) {
        // Move cursor up one line and clear the entire line
        process.stdout.write("\u001b[1A");
        process.stdout.write("\u001b[2K");
      }
    }

    // Print a leading blank line, the formatted content, and a trailing blank line
    process.stdout.write("\n");
    process.stdout.write(formatted);
    process.stdout.write("\n");

    lastPrintedLines = formatted.split("\n").length + 2; // include the blank lines we printed
  }

  // Initial render
  renderAndTrack();

  // Install resize handler once per process so content is reflowed when the terminal size changes.
  if (process.stdout && process.stdout.isTTY && !resizeHandlerInstalled) {
    resizeHandlerInstalled = true;
    process.stdout.on("resize", () => {
      try {
        renderAndTrack();
      } catch (e) {
        // swallow any errors from reflowing
      }
    });
    // Clean up on exit
    process.on("exit", () => {
      try {
        process.stdout.removeAllListeners &&
          process.stdout.removeAllListeners("resize");
      } catch (e) {}
    });
  }

  return summary.trim();
}

export { maybePrintGeminiSummary, maybeSummarizeTranscript };
