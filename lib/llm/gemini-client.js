import { ApiError, GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { transcriptsDir } from "../app-config.js";
import { getGeminiApiKey } from "../env.js";
import transcriptFieldFormatters from "../transcript-field-formatters.js";
import { buildEpisodeContext, getPromptTemplate } from "./gemini-prompt.js";

const DEFAULT_MODEL_ID = "gemini-2.5-flash-lite";

let cachedClient = null;
let cachedApiKey = null;

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
  try {
    const summariesDir = path.join(path.dirname(transcriptsDir), "summaries");
    const { slugify, truncateSlug } = transcriptFieldFormatters;
    const meta = entry && entry.metadata ? entry.metadata : {};
    const showSlug =
      meta.showSlug ||
      slugify(
        entry && entry.showTitle
          ? entry.showTitle
          : meta.showTitle || "unknown-show"
      );
    const baseFileName = meta.baseFileName
      ? meta.baseFileName
      : (() => {
          const rawTitle =
            (entry && (entry.episodeTitle || entry.showTitle)) ||
            meta.episodeTitle ||
            "unknown";
          const rawDate =
            (entry && entry.pubDate) || meta.pubDate || "unknown-date";
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

    if (fs.existsSync(cacheFile)) {
      try {
        const cached = fs.readFileSync(cacheFile, "utf8");
        if (cached && cached.trim()) {
          return cached.trim();
        }
      } catch (e) {}
    }
    // fallback: check non-played dir if we looked in played, or vice versa
    try {
      const altDir = path.join(summariesDir, showSlug);
      const altCacheFile = path.join(altDir, `summary_${baseFileName}.md`);
      if (altCacheFile !== cacheFile && fs.existsSync(altCacheFile)) {
        const cached = fs.readFileSync(altCacheFile, "utf8");
        if (cached && cached.trim()) return cached.trim();
      }
    } catch (e) {}
  } catch (e) {}
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
  try {
    if (summary && summary.trim()) {
      const summariesDir = path.join(path.dirname(transcriptsDir), "summaries");
      const { slugify, truncateSlug } = transcriptFieldFormatters;
      const meta = entry && entry.metadata ? entry.metadata : {};
      const showSlug =
        meta.showSlug ||
        slugify(
          entry && entry.showTitle
            ? entry.showTitle
            : meta.showTitle || "unknown-show"
        );
      const baseFileName = meta.baseFileName
        ? meta.baseFileName
        : (() => {
            const rawTitle =
              (entry && (entry.episodeTitle || entry.showTitle)) ||
              meta.episodeTitle ||
              "unknown";
            const rawDate =
              (entry && entry.pubDate) || meta.pubDate || "unknown-date";
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
      try {
        if (!fs.existsSync(targetDir))
          fs.mkdirSync(targetDir, { recursive: true });
      } catch (e) {}
      const cacheFile = path.join(targetDir, `summary_${baseFileName}.md`);
      try {
        const header = `# ✨ Gemini summary\n **Generated:** ${new Date().toISOString()}\n\n`;
        fs.writeFileSync(cacheFile, `${header}${summary}\n`, "utf8");
      } catch (e) {
        console.warn(
          `[WARN] Unable to write summary cache: ${
            e && e.message ? e.message : e
          }`
        );
      }
    }
  } catch (e) {}
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

export { logGeminiError, runGeminiRequest };
