import { ApiError, GoogleGenAI } from "@google/genai";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { transcriptsDir } from "../app-config.js";
import { getGeminiApiKey } from "../env.js";
import { getEpisodeDescriptionMarkdown } from "../episode-markdown-builder.js";
import transcriptFieldFormatters from "../transcript-field-formatters.js";
import { buildEpisodeContext, getPromptTemplate } from "./gemini-prompt.js";

const DEFAULT_MODEL_ID = "gemini-2.5-flash-lite";
const SUMMARY_CACHE_MODES = new Set(["use", "refresh", "bypass"]);
const DEFAULT_SUMMARY_CACHE_MODE = "use";

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

function buildSummaryFingerprint({ prompt, modelId, transcriptContent }) {
	const promptHash = hashContent(prompt);
	const transcriptHash = hashContent(transcriptContent);
	const model = modelId || DEFAULT_MODEL_ID;
	return `prompt=${promptHash};model=${model};transcript=${transcriptHash}`;
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
	const showSlug =
		meta.showSlug ||
		slugify(
			entry && entry.showTitle ? entry.showTitle : meta.showTitle || "unknown-show"
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

async function runGeminiRequest({ transcriptContent, entry, summaryCacheMode }) {
  if (!transcriptContent || typeof transcriptContent !== "string") {
    return null;
  }
  const prompt = getPromptTemplate();
  if (!prompt) {
    return null;
  }
	const summaryCache = normalizeSummaryCacheMode(summaryCacheMode);
	const summaryTarget = buildSummaryTarget(entry);
	const fingerprint = buildSummaryFingerprint({
		prompt,
		modelId: DEFAULT_MODEL_ID,
		transcriptContent,
	});

	// Check local cache first
	if (summaryCache === "use") {
		try {
			if (fs.existsSync(summaryTarget.cacheFile)) {
				const cached = fs.readFileSync(summaryTarget.cacheFile, "utf8");
				if (cached && cached.trim()) {
					const cachedFingerprint = extractSummaryFingerprint(cached);
					if (!cachedFingerprint) {
						return cached.trim();
					}
					if (cachedFingerprint === fingerprint) {
						return cached.trim();
					}
				}
			}
		} catch (e) {}
	}

  // No external cache lookup; rely on local summaries directory only.
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
		if (summary && summary.trim() && summaryCache !== "bypass") {
			try {
				if (!fs.existsSync(summaryTarget.targetDir))
					fs.mkdirSync(summaryTarget.targetDir, { recursive: true });
			} catch (e) {}
			try {
				const meta = summaryTarget.meta || {};
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
				const fingerprintLine = `[summary-fingerprint]: ${fingerprint}\n\n`;
				let fileContent = `${header}${fingerprintLine}${summary.trim()}\n`;
				if (description) {
					fileContent += `\n---\n\n### Episode description:\n\n${description}\n`;
				}
				fs.writeFileSync(summaryTarget.cacheFile, fileContent, "utf8");

				// External mirroring removed; summaries stay within the project tree.
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
