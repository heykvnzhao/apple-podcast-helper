import { Parser } from "xml2js";

import { buildEpisodeMarkdown } from "./episode-markdown-builder.js";
import transcriptFieldFormatters from "./transcript-field-formatters.js";
const { formatTimestamp } = transcriptFieldFormatters;

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function collectText(node, parts) {
  if (node === undefined || node === null) {
    return;
  }
  if (typeof node === "string") {
    parts.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, parts));
    return;
  }
  if (typeof node !== "object") {
    return;
  }
  if (typeof node._ === "string") {
    parts.push(node._);
  }
  if (node.span) {
    collectText(node.span, parts);
  }
}

function extractTextFromNode(node) {
  const parts = [];
  collectText(node, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function findParagraphs(result) {
  const direct = result?.tt?.body?.[0]?.div?.[0]?.p;
  if (Array.isArray(direct)) {
    return direct;
  }
  if (direct) {
    return [direct];
  }

  const paragraphs = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child));
      return;
    }
    if (node.p) {
      normalizeArray(node.p).forEach((p) => {
        if (!seen.has(p)) {
          seen.add(p);
          paragraphs.push(p);
        }
      });
    }
    Object.values(node).forEach((value) => walk(value));
  };
  walk(result);
  return paragraphs;
}

async function parseTranscript(ttmlContent, includeTimestamps) {
  const parser = new Parser();
  const result = await parser.parseStringPromise(ttmlContent);

  let transcript = [];
  const paragraphs = findParagraphs(result);
  if (paragraphs.length === 0) {
    console.warn("[WARN] No transcript paragraphs found in TTML input.");
    return "";
  }

  paragraphs.forEach((paragraph) => {
    const paragraphText = extractTextFromNode(
      paragraph && paragraph.span ? paragraph.span : paragraph
    );
    if (!paragraphText) {
      return;
    }
    if (includeTimestamps && paragraph.$ && paragraph.$.begin) {
      const start = parseFloat(paragraph.$.begin);
      if (Number.isFinite(start)) {
        const timestamp = formatTimestamp(start);
        transcript.push(`[${timestamp}] ${paragraphText}`);
        return;
      }
    }
    transcript.push(paragraphText);
  });

  return transcript.join("\n\n");
}

async function extractTranscript(ttmlContent, options = {}) {
  const {
    includeTimestamps = false,
    metadata = null,
    fallbackContext = null,
  } = options;
  const transcriptText = await parseTranscript(ttmlContent, includeTimestamps);
  return buildEpisodeMarkdown(transcriptText, metadata, fallbackContext);
}

export { extractTranscript };

export default {
  extractTranscript,
};
