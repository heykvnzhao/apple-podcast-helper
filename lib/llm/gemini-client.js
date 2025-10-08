import { ApiError, GoogleGenAI } from "@google/genai";
import { getGeminiApiKey } from "../env.js";
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

export { logGeminiError, runGeminiRequest };
