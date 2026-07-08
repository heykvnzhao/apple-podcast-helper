import { getEpisodeDescriptionMarkdown } from "../episode-markdown-builder.js";
import { getSummaryProviderDisplayName } from "./summary-provider-config.js";

function getSummaryMetadata(entry) {
  const meta = entry && entry.metadata ? entry.metadata : {};
  return {
    description: getEpisodeDescriptionMarkdown(meta) || null,
    episode: meta.episodeTitle || (entry && entry.episodeTitle) || null,
    pubDate: meta.pubDate || (entry && entry.pubDate) || null,
    show: meta.showTitle || (entry && entry.showTitle) || null,
  };
}

function hasProviderSummaryHeader(markdown) {
  if (!markdown || typeof markdown !== "string") {
    return false;
  }
  return /^\s*#\s*✨\s*(Gemini|DeepSeek)\s+summary/i.test(markdown);
}

function buildSummaryHeader({ entry, providerDisplayName }) {
  const meta = getSummaryMetadata(entry);
  let header = `# ✨ ${providerDisplayName} summary\n\n`;
  if (meta.show) header += `**Show:** ${meta.show}\n`;
  if (meta.episode) header += `**Episode:** ${meta.episode}\n`;
  if (meta.pubDate) header += `**Published:** ${meta.pubDate}\n`;
  header += `\n`;
  return header;
}

function buildDisplaySummary({ entry, providerDisplayName, summary }) {
  const trimmed = summary && typeof summary === "string" ? summary.trim() : "";
  if (!trimmed) {
    return "";
  }
  const label = providerDisplayName || getSummaryProviderDisplayName();
  let full = trimmed;
  if (!hasProviderSummaryHeader(trimmed)) {
    full = `${buildSummaryHeader({ entry, providerDisplayName: label })}${trimmed}\n`;
  }
  const { description } = getSummaryMetadata(entry);
  if (description && !/Episode description:\n/i.test(full)) {
    full += `\n---\n\n### Episode description:\n\n${description}\n`;
  }
  return full;
}

export {
  buildDisplaySummary,
  buildSummaryHeader,
  getSummaryMetadata,
  hasProviderSummaryHeader,
};
