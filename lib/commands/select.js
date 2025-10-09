import fs from "fs";
import readline from "readline";

import appConfig from "../app-config.js";
import { DEFAULT_SELECT_PAGE_SIZE } from "../app-constants.js";
import catalog from "../catalog/index.js";
import { runHelpCommand } from "../cli/help.js";
import { runInteractiveSelector } from "../cli/interactive-selector.js";
import { reportOptionMessages } from "../cli/options.js";
import { createProgressIndicator } from "../cli/progress-indicator.js";
import clipboardService from "../clipboard-service.js";
import { getEpisodeDescriptionMarkdown } from "../episode-markdown-builder.js";
import listeningStatusStore from "../listening-status-manifest-store.js";
import { setLastRawSummaries } from "../llm/gemini-formatting.js";
import {
  maybePrintGeminiSummary,
  maybeSummarizeTranscript,
} from "../llm/gemini-summarizer.js";
import { runInteractiveGeminiViewer } from "../llm/gemini-summary-viewer.js";
import { parsePositiveInteger } from "../utils/numbers.js";
import { printToStdout } from "../utils/stdout.js";

const { loadListeningStatusManifest } = listeningStatusStore;
const {
  buildCatalogEntries,
  buildEntryFilterConfig,
  compareCatalogEntriesDesc,
  describeFilterSummary,
  ensureStationMetadataForManifest,
  filterCatalogEntries,
} = catalog;
const { copyFileToClipboard } = clipboardService;
const { transcriptsDir } = appConfig;

export async function runSelectCommand(options) {
  const safeOptions = options || {};
  if (safeOptions.help) {
    runHelpCommand({ topic: "select" });
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive mode requires an interactive terminal (TTY).");
  }
  if (!reportOptionMessages(safeOptions)) {
    throw new Error(
      "Unable to start interactive selection. Resolve the errors above and retry."
    );
  }
  const manifest = loadListeningStatusManifest(transcriptsDir);
  ensureStationMetadataForManifest(manifest, safeOptions);
  const catalogEntries = buildCatalogEntries(manifest);
  if (!catalogEntries || catalogEntries.length === 0) {
    console.log(
      "[INFO] No transcripts found after syncing. Verify the Apple Podcasts cache is available."
    );
    return;
  }
  const sortedEntries = catalogEntries.slice().sort(compareCatalogEntriesDesc);
  const filterConfig = buildEntryFilterConfig(safeOptions);
  const filteredEntries = filterCatalogEntries(sortedEntries, filterConfig);
  if (filteredEntries.length === 0) {
    const summary = describeFilterSummary(filterConfig);
    const suffix = summary ? ` matching filters (${summary})` : "";
    console.log(`[INFO] No transcripts available${suffix}.`);
    return;
  }

  const pageSize = Math.max(
    parsePositiveInteger(safeOptions.pageSize) || DEFAULT_SELECT_PAGE_SIZE,
    1
  );
  let selectedEntry = await runInteractiveSelector({
    entries: filteredEntries,
    pageSize,
    status: filterConfig.status,
    filters: {
      status: filterConfig.status,
      showFilters: filterConfig.showFilters,
      stationFilters: filterConfig.stationFilters,
    },
  });
  if (!selectedEntry) {
    return;
  }
  if (Array.isArray(selectedEntry) && selectedEntry.length === 1) {
    selectedEntry = selectedEntry[0];
  }

  if (Array.isArray(selectedEntry) && selectedEntry.length > 1) {
    const entries = selectedEntry;
    const valid = entries.filter((e) => e && e.absolutePath && e.hasMarkdown);
    if (valid.length === 0) {
      throw new Error("No valid selected transcripts with Markdown files.");
    }

    try {
      const first = valid[0];
      const content = await copyFileToClipboard(first.absolutePath);
      const location =
        first.normalizedRelativePath || first.relativePath || first.identifier;
      console.log(`📋 Copied transcript to clipboard: ${location}`);
    } catch (err) {
      console.warn(`[WARN] Clipboard copy failed: ${err.message}`);
      // Print paths for user to access
      valid.forEach((e) => {
        console.log(`📄 Transcript path: ${e.absolutePath}`);
      });
    }

    const progress = createProgressIndicator({
      label: "Summarizing transcripts",
      total: valid.length,
      stream: process.stderr,
    });
    progress.start();
    let processed = 0;
    const summaries = [];
    for (const entry of valid) {
      processed += 1;
      const location =
        entry.normalizedRelativePath || entry.relativePath || entry.identifier;
      progress.update({ processed, detail: `Summarizing for ${location}` });
      try {
        const content = await fs.promises.readFile(entry.absolutePath, "utf8");
        const summary = await maybeSummarizeTranscript({
          transcriptContent: content,
          entry,
        });
        if (summary) {
          const meta = entry && entry.metadata ? entry.metadata : {};
          const show = meta.showTitle || (entry && entry.showTitle) || null;
          const episode =
            meta.episodeTitle || (entry && entry.episodeTitle) || null;
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
          summaries.push({ text: full, entry });
        }
        if (summary) {
          // leave final messages to progress.done to avoid spamming output
        } else {
          // no-op; progress update already indicates activity
        }
      } catch (e) {
        console.warn(
          `[WARN] Failed to generate summary for ${
            entry && entry.identifier ? entry.identifier : "unknown"
          }: ${e && e.message ? e.message : e}`
        );
      }
    }
    if (
      valid.length > 0 &&
      process.stdin &&
      process.stdin.isTTY &&
      process.stdout &&
      process.stdout.isTTY
    ) {
      try {
        if (summaries.length > 0) {
          setLastRawSummaries(summaries);
          await runInteractiveGeminiViewer();
        } else {
          const first = valid[0];
          const content = await fs.promises.readFile(
            first.absolutePath,
            "utf8"
          );
          await maybePrintGeminiSummary({
            transcriptContent: content,
            entry: first,
          });
        }
      } catch (e) {
        // ignore viewer errors but warn
        console.warn(
          `[WARN] Unable to open interactive summary viewer: ${
            e && e.message ? e.message : e
          }`
        );
      }
    }
    return;
  }

  if (!selectedEntry.absolutePath || !selectedEntry.hasMarkdown) {
    throw new Error("Selected transcript is missing its Markdown file.");
  }
  let transcriptContent = null;
  let shouldPrintFallback = false;
  try {
    transcriptContent = await copyFileToClipboard(selectedEntry.absolutePath);
    const location =
      selectedEntry.normalizedRelativePath ||
      selectedEntry.relativePath ||
      selectedEntry.identifier;
    console.log(`📋 Copied transcript to clipboard: ${location}`);
  } catch (error) {
    console.warn(`[WARN] Clipboard copy failed: ${error.message}`);
    console.log(`📄 Transcript path: ${selectedEntry.absolutePath}`);
    const promptRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const fallbackAnswer = await questionAsync(
        promptRl,
        "Print transcript content to stdout instead? (y/N): "
      );
      if (fallbackAnswer.trim().toLowerCase().startsWith("y")) {
        const fallbackContent = await fs.promises.readFile(
          selectedEntry.absolutePath,
          "utf8"
        );
        transcriptContent = fallbackContent;
        shouldPrintFallback = true;
      }
    } finally {
      promptRl.close();
    }
  }

  if (transcriptContent) {
    await maybePrintGeminiSummary({ transcriptContent, entry: selectedEntry });
  }

  if (shouldPrintFallback && transcriptContent) {
    await printToStdout(transcriptContent);
  }
}

function questionAsync(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

export default {
  runSelectCommand,
};
