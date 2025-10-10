import { convertHtmlToMarkdown } from "./html-to-markdown-converter.js";
import transcriptFieldFormatters from "./transcript-field-formatters.js";
const { formatSlugAsTitle, formatTimestamp } = transcriptFieldFormatters;

function formatPlayStateLabel(playState) {
  switch (playState) {
    case "played":
      return "Completed";
    case "inProgress":
      return "In progress";
    case "unplayed":
      return "Not started";
    default:
      return "Unknown";
  }
}

function formatSecondsOrNull(value) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return null;
  }
  return formatTimestamp(Math.round(value));
}

function getEpisodeDescriptionMarkdown(metadata) {
  if (!metadata) {
    return "";
  }
  if (metadata.episodeDescriptionHtml) {
    const markdown = convertHtmlToMarkdown(metadata.episodeDescriptionHtml);
    if (markdown) {
      return markdown;
    }
  }
  if (metadata.episodeDescriptionText) {
    const plain = metadata.episodeDescriptionText.trim();
    if (plain) {
      return plain;
    }
  }
  return "";
}

function buildEpisodeMarkdown(transcriptText, metadata, fallbackContext = {}) {
  const safeMetadata = metadata || {};
  const effectiveFallbackContext = fallbackContext || {};
  const fallbackShowSlug =
    effectiveFallbackContext.showSlug || safeMetadata.showSlug || "";
  const fallbackShowName =
    safeMetadata.showTitle && safeMetadata.showTitle !== "unknown show"
      ? safeMetadata.showTitle
      : effectiveFallbackContext.showName ||
        formatSlugAsTitle(fallbackShowSlug) ||
        "Unknown show";
  const fallbackDateSegment =
    safeMetadata.pubDate && safeMetadata.pubDate !== "unknown-date"
      ? safeMetadata.pubDate
      : effectiveFallbackContext.dateSegment || "unknown-date";
  const description = getEpisodeDescriptionMarkdown(safeMetadata);
  const descriptionSection = [
    "### Episode description",
    `Show name: ${fallbackShowName}`,
    `Episode date: ${fallbackDateSegment}`,
    "Episode description:",
    description || "Not available.",
  ].join("\n");
  const listeningStatus = safeMetadata.listeningStatus || null;
  let statusSection = "";
  if (listeningStatus) {
    const statusLines = [];
    statusLines.push(
      `State: ${formatPlayStateLabel(listeningStatus.playState)}`
    );
    const completionRatio =
      typeof listeningStatus.completionRatio === "number"
        ? Math.round(listeningStatus.completionRatio * 100)
        : null;
    const listenedFormatted = formatSecondsOrNull(
      listeningStatus.listenedSeconds
    );
    const durationFormatted = formatSecondsOrNull(
      listeningStatus.durationSeconds
    );
    const progressParts = [];
    if (completionRatio != null && Number.isFinite(completionRatio)) {
      progressParts.push(`${completionRatio}%`);
    }
    if (listenedFormatted && durationFormatted) {
      progressParts.push(`${listenedFormatted} of ${durationFormatted}`);
    } else if (listenedFormatted) {
      progressParts.push(`${listenedFormatted} listened`);
    } else if (durationFormatted) {
      progressParts.push(`${durationFormatted} total`);
    }
    if (progressParts.length > 0) {
      statusLines.push(`Progress: ${progressParts.join(" ")}`);
    }
    const remainingFormatted = formatSecondsOrNull(
      listeningStatus.remainingSeconds
    );
    const shouldShowRemaining =
      typeof listeningStatus.remainingSeconds === "number" &&
      listeningStatus.remainingSeconds > 1 &&
      listeningStatus.playState !== "played";
    if (shouldShowRemaining && remainingFormatted) {
      statusLines.push(`Remaining: ${remainingFormatted}`);
    }
    if (listeningStatus.lastPlayedAt) {
      const lastPlayedDate = new Date(listeningStatus.lastPlayedAt);
      const lastPlayedText = Number.isNaN(lastPlayedDate.getTime())
        ? listeningStatus.lastPlayedAt
        : lastPlayedDate.toISOString();
      statusLines.push(`Last played: ${lastPlayedText}`);
    }
    if (typeof listeningStatus.playCount === "number") {
      statusLines.push(`Play count: ${listeningStatus.playCount}`);
    }
    statusSection =
      statusLines.length > 0
        ? [
            "## Listening status",
            ...statusLines.map((line) => `- ${line}`),
          ].join("\n")
        : "";
  }
  const transcriptSectionHeader = "## Episode transcript";
  const transcriptSectionBody =
    transcriptText && transcriptText.trim()
      ? transcriptText.trim()
      : "Not available.";

  const output = [
    statusSection,
    descriptionSection,
    transcriptSectionHeader,
    transcriptSectionBody,
  ]
    .filter((section) => section && section.trim() !== "")
    .join("\n\n");

  return `${output.trimEnd()}\n`;
}

export { buildEpisodeMarkdown, getEpisodeDescriptionMarkdown };

export default {
  getEpisodeDescriptionMarkdown,
  buildEpisodeMarkdown,
};
