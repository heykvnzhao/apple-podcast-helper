import { createProgressIndicator } from "../cli/progress-indicator.js";
import { getEpisodeDescriptionMarkdown } from "../episode-markdown-builder.js";
import { logGeminiError, runGeminiRequest } from "./gemini-client.js";
import {
  installResizeHandler,
  renderAndTrack,
  setLastRawSummary,
} from "./gemini-formatting.js";
import { runInteractiveGeminiViewer } from "./gemini-summary-viewer.js";

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

  const meta = entry && entry.metadata ? entry.metadata : {};
  const show = meta.showTitle || (entry && entry.showTitle) || null;
  const episode = meta.episodeTitle || (entry && entry.episodeTitle) || null;
  const pubDate = meta.pubDate || (entry && entry.pubDate) || null;
  const description = getEpisodeDescriptionMarkdown(meta) || null;
  const trimmed = summary.trim();
  let full = trimmed;
  const hasHeader = /^\s*#\s*✨\s*Gemini summary/i.test(trimmed);
  if (!hasHeader) {
    let header = `# ✨ Gemini summary\n\n`;
    if (show) header += `**Show:** ${show}\n`;
    if (episode) header += `**Episode:** ${episode}\n`;
    if (pubDate) header += `**Published:** ${pubDate}\n`;
    header += `\n`;
    full = `${header}${trimmed}\n`;
  }
  if (description && !/Episode description:\n/i.test(full)) {
    full += `\n---\n\nEpisode description:\n\n${description}\n`;
  }
  setLastRawSummary(full);
  if (
    process.stdin &&
    process.stdin.isTTY &&
    process.stdout &&
    process.stdout.isTTY
  ) {
    try {
      await runInteractiveGeminiViewer();
    } catch (e) {
      renderAndTrack();
      installResizeHandler();
    }
  } else {
    renderAndTrack();
    installResizeHandler();
  }

  return summary.trim();
}

export { maybePrintGeminiSummary, maybeSummarizeTranscript };
