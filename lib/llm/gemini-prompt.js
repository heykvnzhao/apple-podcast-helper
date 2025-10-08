import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPT_PATH = path.resolve(
  __dirname,
  "../../prompts/podcasts-summarizer.md"
);

let cachedPrompt = null;
let promptMissing = false;

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

export { buildEpisodeContext, getPromptTemplate };
