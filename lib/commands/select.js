import fs from "fs";
import readline from "readline";

import appConfig from "../app-config.js";
import { DEFAULT_SELECT_PAGE_SIZE } from "../app-constants.js";
import catalog from "../catalog/index.js";
import { runHelpCommand } from "../cli/help.js";
import { runInteractiveSelector } from "../cli/interactive-selector.js";
import { reportOptionMessages } from "../cli/options.js";
import clipboardService from "../clipboard-service.js";
import listeningStatusStore from "../listening-status-manifest-store.js";
import { maybePrintGeminiSummary } from "../llm/gemini-summarizer.js";
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
// runHelpCommand imported directly
// DEFAULT_SELECT_PAGE_SIZE imported directly above
// parsePositiveInteger imported directly above
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
  const selectedEntry = await runInteractiveSelector({
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
