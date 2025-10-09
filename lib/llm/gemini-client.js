import { ApiError, GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { transcriptsDir } from "../app-config.js";
import { getExternalSummariesPath, getGeminiApiKey } from "../env.js";
import { getEpisodeDescriptionMarkdown } from "../episode-markdown-builder.js";
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
    const externalSummariesRoot = getExternalSummariesPath();
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

    // Check local cache first
    try {
      if (fs.existsSync(cacheFile)) {
        const cached = fs.readFileSync(cacheFile, "utf8");
        if (cached && cached.trim()) return cached.trim();
      }
    } catch (e) {}

    // Check external summaries path (mirrored cache) if configured
    if (externalSummariesRoot) {
      try {
        const externalTargetDir =
          playState === "played"
            ? path.join(externalSummariesRoot, showSlug, "played")
            : path.join(externalSummariesRoot, showSlug);
        const externalCacheFile = path.join(
          externalTargetDir,
          `summary_${baseFileName}.md`
        );
        if (
          externalCacheFile !== cacheFile &&
          fs.existsSync(externalCacheFile)
        ) {
          const cached = fs.readFileSync(externalCacheFile, "utf8");
          if (cached && cached.trim()) return cached.trim();
        }
      } catch (e) {}
    }
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
      const externalSummariesRoot = getExternalSummariesPath();
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
        const show = meta.showTitle || (entry && entry.showTitle) || null;
        const episode =
          meta.episodeTitle || (entry && entry.episodeTitle) || null;
        const pubDate = meta.pubDate || (entry && entry.pubDate) || null;
        const description = getEpisodeDescriptionMarkdown(meta) || null;
        let header = `# ✨ Gemini summary\n`;
        if (show) header += ` **Show:** ${show}\n`;
        if (episode) header += ` **Episode:** ${episode}\n`;
        if (pubDate) header += ` **Published:** ${pubDate}\n`;
        header += `\n`;
        let fileContent = `${header}${summary.trim()}\n`;
        if (description) {
          fileContent += `\n---\n\nEpisode description:\n\n${description}\n`;
        }
        fs.writeFileSync(cacheFile, fileContent, "utf8");

        // Also mirror to external summaries path if configured
        if (externalSummariesRoot) {
          try {
            const externalTargetDir =
              playState === "played"
                ? path.join(externalSummariesRoot, showSlug, "played")
                : path.join(externalSummariesRoot, showSlug);
            if (!fs.existsSync(externalTargetDir)) {
              fs.mkdirSync(externalTargetDir, { recursive: true });
            }
            const externalCacheFile = path.join(
              externalTargetDir,
              `summary_${baseFileName}.md`
            );
            fs.writeFileSync(externalCacheFile, fileContent, "utf8");
          } catch (e) {
            console.warn(
              `[WARN] Unable to write external summary cache: ${
                e && e.message ? e.message : e
              }`
            );
          }
        }
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
