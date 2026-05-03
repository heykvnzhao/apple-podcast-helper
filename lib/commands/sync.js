import fs from "fs";
import path from "path";

import appConfig from "../app-config.js";
import catalog from "../catalog/index.js";
import { runHelpCommand } from "../cli/help.js";
import { reportOptionMessages } from "../cli/options.js";
import outputFormat from "../cli/output-format.js";
import { createProgressIndicator } from "../cli/progress-indicator.js";
import listeningStatusStore from "../listening-status-manifest-store.js";
import podcastMetadataLoader from "../podcast-metadata-loader.js";
import transcriptFieldFormatters from "../transcript-field-formatters.js";
import transcriptFileManager from "../transcript-file-manager.js";
import ttmlParser from "../ttml-transcript-parser.js";
import { logDevWarning } from "../utils/dev-logger.js";
import { buildIdentifierHash } from "../utils/identifier-hash.js";

const { extractTranscript } = ttmlParser;
const { slugify, truncateSlug, formatSlugAsTitle } = transcriptFieldFormatters;
const {
  findTTMLFiles,
  convertExistingTxtTranscripts,
  moveMarkdownTranscriptsIntoShowDirectories,
  ensureEpisodeOutputDirectory,
  resolveFallbackContext,
  updateExistingMarkdownFiles,
  updateExistingSummaryFiles,
} = transcriptFileManager;
const {
  loadTranscriptCanonicalAliases,
  loadTranscriptMetadata,
  buildMetadataFilenameIndex,
} = podcastMetadataLoader;
const {
  loadListeningStatusManifest,
  saveListeningStatusManifest,
  upsertManifestEntry,
  mergeManifestMetadataIntoMap,
  reconcileManifestEntries,
  getManifestPath,
} = listeningStatusStore;
const {
  buildEntryFilterConfig,
  describeFilterSummary,
  metadataMatchesFilters,
} = catalog;
const { printEpisodeLogHeader, formatEpisodeLogLine } = outputFormat;
// createProgressIndicator imported directly
// runHelpCommand imported directly
const { transcriptsDir, ttmlCacheDir } = appConfig;

export async function runSyncCommand(options) {
  const safeOptions = options || {};
  if (safeOptions.help) {
    runHelpCommand({ topic: "sync" });
    return;
  }
  if (!reportOptionMessages(safeOptions)) {
    throw new Error("Unable to continue. Fix the errors above and try again.");
  }
  const includeTimestamps = safeOptions.includeTimestamps !== false;
  if (safeOptions.mode === "single") {
    await handleSingleFile({
      includeTimestamps,
      inputPath: safeOptions.inputPath,
      outputPath: safeOptions.outputPath,
    });
    return;
  }
  if (safeOptions.mode === "batch") {
    await handleBatch({
      includeTimestamps,
      showFilters: safeOptions.showFilters || [],
      stationFilters: safeOptions.stationFilters || [],
      interactiveOutput: Boolean(safeOptions.interactiveOutput),
      prune: Boolean(safeOptions.prune),
      dryRun: Boolean(safeOptions.dryRun),
      refreshStatus: Boolean(safeOptions.refreshStatus),
      force: Boolean(safeOptions.force),
    });
    return;
  }
  throw new Error(
    "Invalid sync arguments. Run `transcripts help sync` for details."
  );
}

async function handleSingleFile({ includeTimestamps, inputPath, outputPath }) {
  if (!inputPath || !outputPath) {
    throw new Error("Single file mode requires input and output paths.");
  }
  const data = await fs.promises.readFile(inputPath, "utf8");
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const parentDirSlug = path.basename(path.dirname(outputPath));
  const fallbackContext = resolveFallbackContext(baseName, parentDirSlug);
  const markdown = await extractTranscript(data, {
    includeTimestamps,
    fallbackContext,
  });
  await fs.promises.writeFile(outputPath, markdown);
  console.log("✅ Transcript saved");
}

function ensureTtmlCachePresent() {
  if (!fs.existsSync(ttmlCacheDir)) {
    console.error(`TTML directory not found at ${ttmlCacheDir}`);
    process.exit(1);
  }
}

function prepareExistingMarkdown(metadataFilenameIndex, manifest) {
  convertExistingTxtTranscripts(transcriptsDir);
  moveMarkdownTranscriptsIntoShowDirectories(transcriptsDir);
  // also ensure summaries are organized like transcripts
  try {
    const summariesRoot = path.join(path.dirname(transcriptsDir), "summaries");
    updateExistingSummaryFiles(
      summariesRoot,
      metadataFilenameIndex,
      summariesRoot
    );
  } catch (e) {
    logDevWarning("Summary reorg failed", e);
  }
  return updateExistingMarkdownFiles(
    transcriptsDir,
    metadataFilenameIndex,
    manifest,
    transcriptsDir
  );
}

function resolveOutputPath({
  filenameCounts,
  showSlug,
  dateSegment,
  episodeSlug,
  listeningStatus,
  identifier,
}) {
  const identifierHash = buildIdentifierHash(identifier);
  const hashSuffix = identifierHash ? `--${identifierHash}` : "";
  const baseName = `${showSlug}_${dateSegment}_${episodeSlug}${hashSuffix}`;
  const playState = listeningStatus ? listeningStatus.playState : null;
  const isPlayed = playState === "played";
  const countScope = isPlayed ? `${showSlug}/played` : showSlug;
  const countKey = `${countScope}/${baseName}`;
  const count = filenameCounts.get(countKey) || 0;
  const suffix = count === 0 ? "" : `-${count}`;
  filenameCounts.set(countKey, count + 1);

  const outputDir = ensureEpisodeOutputDirectory(
    transcriptsDir,
    showSlug,
    playState
  );
  return path.join(outputDir, `${baseName}${suffix}.md`);
}

function buildFallbackMetadata({
  showSlug,
  rawEpisodeTitle,
  dateSegment,
  episodeSlug,
}) {
  const safeShowSlug = showSlug || "unknown-show";
  const safeDateSegment = dateSegment || "unknown-date";
  const safeEpisodeSlug = episodeSlug || "episode";
  const safeEpisodeTitle = rawEpisodeTitle || "unknown episode";
  return {
    showTitle: formatSlugAsTitle(safeShowSlug) || "Unknown show",
    episodeTitle: safeEpisodeTitle,
    pubDate: safeDateSegment,
    showSlug: safeShowSlug,
    episodeSlug: safeEpisodeSlug,
    stationTitle: null,
    stationSlug: null,
    stationTitles: [],
    stationSlugs: [],
    baseFileName: `${safeShowSlug}_${safeDateSegment}_${safeEpisodeSlug}`,
    episodeDescriptionHtml: "",
    episodeDescriptionText: "",
    listeningStatus: null,
  };
}

function normalizeSourceStats(raw) {
  if (!raw || typeof raw !== "object") {
    return { mtimeMs: null, size: null };
  }
  const mtimeMs =
    typeof raw.mtimeMs === "number" && Number.isFinite(raw.mtimeMs)
      ? Math.round(raw.mtimeMs)
      : null;
  const size =
    typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : null;
  return { mtimeMs, size };
}

function isManifestEntryUpToDate({
  entry,
  includeTimestamps,
  relativePath,
  outputPath,
  sourceStats,
}) {
  if (!entry || !relativePath || !outputPath) {
    return false;
  }
  if (!entry.lastProcessedAt) {
    return false;
  }
  if (entry.relativePath !== relativePath) {
    return false;
  }
  if (!fs.existsSync(outputPath)) {
    return false;
  }
  const storedSource = normalizeSourceStats(entry.source);
  if (sourceStats.mtimeMs != null) {
    if (
      storedSource.mtimeMs == null ||
      storedSource.mtimeMs !== sourceStats.mtimeMs
    ) {
      return false;
    }
  }
  if (sourceStats.size != null) {
    if (storedSource.size == null || storedSource.size !== sourceStats.size) {
      return false;
    }
  }
  const renderOptions = entry.renderOptions || {};
  if (typeof renderOptions.includeTimestamps === "boolean") {
    if (renderOptions.includeTimestamps !== includeTimestamps) {
      return false;
    }
  } else if (includeTimestamps === false) {
    return false;
  }
  return true;
}

function normalizeRelativePath(relativePath) {
  if (!relativePath || typeof relativePath !== "string") {
    return null;
  }
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.replace(/^\.\//, "");
}

function resolveExistingOutputPath({
  existingEntry,
  outputPath,
  relativePath,
  transcriptsRoot,
}) {
  const normalizedExistingRelativePath = normalizeRelativePath(
    existingEntry && existingEntry.relativePath ? existingEntry.relativePath : null
  );
  const existingPath = normalizedExistingRelativePath
    ? path.join(
        transcriptsRoot,
        normalizedExistingRelativePath.split("/").join(path.sep)
      )
    : null;
  const outputExists = fs.existsSync(outputPath);
  let finalOutputPath = outputPath;
  let finalRelativePath = relativePath;
  let moved = false;
  let skippedMove = false;
  let moveError = null;

  if (existingPath && fs.existsSync(existingPath) && existingPath !== outputPath) {
    if (outputExists) {
      skippedMove = true;
    } else {
      try {
        fs.renameSync(existingPath, outputPath);
        moved = true;
      } catch (error) {
        moveError = error;
      }
    }
  }

  if (moved || outputExists) {
    finalOutputPath = outputPath;
    finalRelativePath = relativePath;
  } else if (existingPath && fs.existsSync(existingPath)) {
    finalOutputPath = existingPath;
    finalRelativePath = normalizedExistingRelativePath || relativePath;
  } else if (normalizedExistingRelativePath) {
    finalRelativePath = normalizedExistingRelativePath;
  }

  return {
    finalOutputPath,
    finalRelativePath,
    moved,
    skippedMove,
    moveError,
    existingPath,
    normalizedExistingRelativePath,
  };
}

function collectMarkdownFiles(directoryPath, baseDir = directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  let results = [];
  entries.forEach((entry) => {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectMarkdownFiles(fullPath, baseDir));
      return;
    }
    if (!entry.isFile()) {
      return;
    }
    if (path.extname(entry.name).toLowerCase() !== ".md") {
      return;
    }
    const relative = path.relative(baseDir, fullPath);
    const normalized = normalizeRelativePath(relative);
    if (normalized) {
      results.push(normalized);
    }
  });
  return results;
}

function buildExpectedTranscriptPaths(manifest) {
  const expected = new Set();
  if (!manifest || !manifest.entries) {
    return expected;
  }
  Object.values(manifest.entries).forEach((entry) => {
    const normalized = normalizeRelativePath(
      entry && entry.relativePath ? entry.relativePath : null
    );
    if (normalized) {
      expected.add(normalized);
    }
  });
  return expected;
}

function resolveSummaryRelativePaths(entry) {
  if (!entry) {
    return [];
  }
  const metadata = entry.metadata || {};
  const baseFileName = metadata.baseFileName || null;
  if (!baseFileName) {
    return [];
  }
  let showSlug = metadata.showSlug || null;
  const relativePath = normalizeRelativePath(
    entry.relativePath ? entry.relativePath : null
  );
  if (!showSlug && relativePath) {
    showSlug = relativePath.split("/")[0] || null;
  }
  if (!showSlug && baseFileName) {
    showSlug = baseFileName.split("_")[0] || null;
  }
  if (!showSlug) {
    return [];
  }
  const listeningStatus =
    metadata && metadata.listeningStatus ? metadata.listeningStatus : null;
  let playState =
    entry.playState || (listeningStatus ? listeningStatus.playState : null);
  if (!playState && relativePath) {
    const pathSegments = relativePath.split("/");
    if (pathSegments.includes("played")) {
      playState = "played";
    }
  }
  const fileName = `summary_${baseFileName}.md`;
  const unplayedPath = `${showSlug}/${fileName}`;
  const playedPath = `${showSlug}/played/${fileName}`;
  if (playState === "played") {
    return [playedPath, unplayedPath];
  }
  if (playState) {
    return [unplayedPath, playedPath];
  }
  return [unplayedPath, playedPath];
}

function buildExpectedSummaryPaths(manifest) {
  const expected = new Set();
  if (!manifest || !manifest.entries) {
    return expected;
  }
  Object.values(manifest.entries).forEach((entry) => {
    const candidates = resolveSummaryRelativePaths(entry);
    candidates.forEach((relative) => {
      if (relative) {
        expected.add(relative);
      }
    });
  });
  return expected;
}

function pruneUnreferencedFiles({ rootDir, expectedPaths, dryRun, label }) {
  if (!fs.existsSync(rootDir)) {
    return { scanned: 0, orphaned: 0 };
  }
  const actual = collectMarkdownFiles(rootDir, rootDir);
  const orphans = actual.filter((relativePath) => {
    return !expectedPaths.has(relativePath);
  });
  orphans.forEach((relativePath) => {
    const displayPath = `${label}/${relativePath}`;
    if (dryRun) {
      console.log(`[INFO] Dry run: would remove ${displayPath}`);
      return;
    }
    const absolutePath = path.join(
      rootDir,
      relativePath.split("/").join(path.sep)
    );
    try {
      fs.unlinkSync(absolutePath);
      console.log(`[INFO] Removed ${displayPath}`);
    } catch (error) {
      console.warn(
        `[WARN] Unable to remove ${displayPath}: ${error.message}`
      );
    }
  });
  return { scanned: actual.length, orphaned: orphans.length };
}

async function handleBatch({
  includeTimestamps,
  showFilters = [],
  stationFilters = [],
  interactiveOutput = false,
  prune = false,
  dryRun = false,
  refreshStatus = false,
  force = false,
}) {
  ensureTtmlCachePresent();
  const shouldRefreshStatus = Boolean(refreshStatus);
  const shouldForce = Boolean(force);
  const useInteractiveOutput =
    Boolean(interactiveOutput) &&
    Boolean(process.stdout && process.stdout.isTTY);
  if (!useInteractiveOutput) {
    console.log("[INFO] Scanning TTML cache...");
  }

  const ttmlFiles = findTTMLFiles(ttmlCacheDir, ttmlCacheDir);
  if (!useInteractiveOutput) {
    console.log(`[INFO] Found ${ttmlFiles.length} TTML file(s)`);
  }

  const identifiers = ttmlFiles.map((file) => file.identifier);
  const metadataMap = loadTranscriptMetadata(identifiers);
  const canonicalAliases = loadTranscriptCanonicalAliases(identifiers);
  const manifest = loadListeningStatusManifest(transcriptsDir);
  mergeManifestMetadataIntoMap(manifest, metadataMap);
  const metadataFilenameIndex = buildMetadataFilenameIndex(metadataMap);
  const filenameCounts = new Map();
  const filterConfig = buildEntryFilterConfig({
    status: "all",
    showFilters,
    stationFilters,
  });

  const activeTtmlFiles = ttmlFiles.filter((file) => {
    return (
      metadataMap.has(file.identifier) || !canonicalAliases.has(file.identifier)
    );
  });
  const skippedAliasCount = ttmlFiles.length - activeTtmlFiles.length;
  if (skippedAliasCount > 0 && !useInteractiveOutput) {
    console.log(
      `[INFO] Skipped ${skippedAliasCount} stale duplicate TTML cache file(s).`
    );
  }

  const sortedTtmlFiles = [...activeTtmlFiles].sort((a, b) => {
    const metaA = metadataMap.get(a.identifier) || null;
    const metaB = metadataMap.get(b.identifier) || null;
    const dateA =
      metaA && metaA.pubDate && metaA.pubDate !== "unknown-date"
        ? metaA.pubDate
        : "9999-12-31";
    const dateB =
      metaB && metaB.pubDate && metaB.pubDate !== "unknown-date"
        ? metaB.pubDate
        : "9999-12-31";
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }
    const showTitleA =
      metaA && metaA.showTitle && metaA.showTitle !== "unknown show"
        ? metaA.showTitle.toLowerCase()
        : metaA && metaA.showSlug
        ? formatSlugAsTitle(metaA.showSlug).toLowerCase()
        : "";
    const showTitleB =
      metaB && metaB.showTitle && metaB.showTitle !== "unknown show"
        ? metaB.showTitle.toLowerCase()
        : metaB && metaB.showSlug
        ? formatSlugAsTitle(metaB.showSlug).toLowerCase()
        : "";
    if (showTitleA !== showTitleB) {
      return showTitleA.localeCompare(showTitleB);
    }
    return a.identifier.localeCompare(b.identifier);
  });

  let filteredTtmlFiles = sortedTtmlFiles;
  const filtersApplied =
    filterConfig.showMatchers.length > 0 ||
    filterConfig.stationMatchers.length > 0;
  if (filtersApplied) {
    const allowed = [];
    let skippedCount = 0;
    let skippedMissingMetadata = 0;
    filteredTtmlFiles.forEach((file) => {
      const metadata = metadataMap.get(file.identifier) || null;
      if (metadataMatchesFilters(metadata, filterConfig)) {
        allowed.push(file);
        return;
      }
      skippedCount += 1;
      if (!metadata) {
        skippedMissingMetadata += 1;
      }
    });
    if (allowed.length === 0) {
      const summary = describeFilterSummary(filterConfig) || "provided filters";
      console.log(`[INFO] No TTML files matched filters (${summary}).`);
      return;
    }
    const parts = [`matched ${allowed.length}`];
    if (skippedCount > 0) {
      const missingLabel =
        skippedMissingMetadata > 0
          ? ` (${skippedMissingMetadata} without metadata)`
          : "";
      parts.push(`skipped ${skippedCount}${missingLabel}`);
    }
    const summary = describeFilterSummary(filterConfig) || "provided filters";
    if (!useInteractiveOutput) {
      console.log(`[INFO] Filters (${summary}) → ${parts.join(" | ")}`);
    }
    filteredTtmlFiles = allowed;
    if (!useInteractiveOutput) {
      console.log(
        `[INFO] Processing ${filteredTtmlFiles.length} TTML file(s) after filters.`
      );
    }
  }

  const prepManifestChanged = prepareExistingMarkdown(
    metadataFilenameIndex,
    manifest
  );
  const totalToProcess = filteredTtmlFiles.length;
  let progress = null;
  let progressCompleted = false;
  if (useInteractiveOutput && totalToProcess > 0) {
    progress = createProgressIndicator({
      label: "Syncing transcripts",
      total: totalToProcess,
    });
    progress.start();
  }

  const summary = {
    processed: 0,
    played: 0,
    unplayed: 0,
    fallback: 0,
    skipped: 0,
  };
  let manifestChanged = Boolean(prepManifestChanged);
  let episodeLogHeaderPrinted = false;
  const postSyncMessages = [];
  const migrationSummary = {
    moved: 0,
    skipped: 0,
    failed: 0,
  };

  const identifiersSet = new Set(activeTtmlFiles.map((file) => file.identifier));
  const visits = {
    total: 0,
  };

  try {
    for (const file of filteredTtmlFiles) {
      const metadata = metadataMap.get(file.identifier) || null;
      const showSlug = slugify(
        metadata ? metadata.showTitle : null,
        "unknown-show"
      );
      const rawEpisodeTitle = metadata
        ? metadata.episodeTitle
        : path.basename(file.identifier, ".ttml");
      const episodeSlug = truncateSlug(slugify(rawEpisodeTitle, "episode"), 20);
      const dateSegment = metadata ? metadata.pubDate : "unknown-date";
      const fallbackContext = {
        showSlug,
        dateSegment,
      };
      const listeningStatus =
        metadata && metadata.listeningStatus ? metadata.listeningStatus : null;
      const outputPath = resolveOutputPath({
        filenameCounts,
        showSlug,
        dateSegment,
        episodeSlug,
        listeningStatus,
        identifier: file.identifier,
      });
      const relativePathRaw = path.relative(transcriptsDir, outputPath);
      const relativePath = relativePathRaw
        ? relativePathRaw.split(path.sep).join("/")
        : path.basename(outputPath);
      const existingEntry =
        manifest && manifest.entries
          ? manifest.entries[file.identifier] || null
          : null;
      const sourceStats = normalizeSourceStats(file);
      const resolvedPaths = resolveExistingOutputPath({
        existingEntry,
        outputPath,
        relativePath,
        transcriptsRoot: transcriptsDir,
      });
      if (resolvedPaths.moved) {
        migrationSummary.moved += 1;
      }
      if (resolvedPaths.skippedMove) {
        migrationSummary.skipped += 1;
      }
      if (resolvedPaths.moveError) {
        migrationSummary.failed += 1;
        const oldDisplay =
          resolvedPaths.normalizedExistingRelativePath ||
          (existingEntry ? existingEntry.relativePath : null);
        const newDisplay = relativePath;
        console.warn(
          `[WARN] Unable to move ${oldDisplay} to ${newDisplay}: ${
            resolvedPaths.moveError.message
          }`
        );
      }
      const showTitleForLog =
        metadata && metadata.showTitle && metadata.showTitle !== "unknown show"
          ? metadata.showTitle
          : formatSlugAsTitle(showSlug);
      const episodeTitleForLog =
        metadata && metadata.episodeTitle
          ? metadata.episodeTitle
          : rawEpisodeTitle;
      const effectiveOutputPath = resolvedPaths.finalOutputPath;
      const effectiveRelativePath = resolvedPaths.finalRelativePath;
      const entryForCheck =
        existingEntry &&
        effectiveRelativePath &&
        existingEntry.relativePath !== effectiveRelativePath
          ? { ...existingEntry, relativePath: effectiveRelativePath }
          : existingEntry;
      const isUpToDate = isManifestEntryUpToDate({
        entry: entryForCheck,
        includeTimestamps,
        relativePath: effectiveRelativePath,
        outputPath: effectiveOutputPath,
        sourceStats,
      });
      const metadataForManifest =
        metadata ||
        buildFallbackMetadata({
          showSlug,
          rawEpisodeTitle,
          dateSegment,
          episodeSlug,
        });

      if (shouldRefreshStatus) {
        manifestChanged =
          upsertManifestEntry(manifest, {
            identifier: file.identifier,
            metadata: metadataForManifest,
            relativePath: effectiveRelativePath,
            skipReason: "refresh-status",
            processed: false,
            sourceMtimeMs: sourceStats.mtimeMs,
            sourceSize: sourceStats.size,
            renderOptions: {
              includeTimestamps,
            },
          }) || manifestChanged;

        summary.skipped += 1;
        visits.total += 1;
        if (useInteractiveOutput && progress) {
          const detailPieces = [showTitleForLog];
          if (episodeTitleForLog && episodeTitleForLog !== showTitleForLog) {
            detailPieces.push(episodeTitleForLog);
          }
          progress.update({
            processed: visits.total,
            detail: `${detailPieces.join(" - ")} (refreshed)`,
          });
        } else {
          if (!episodeLogHeaderPrinted) {
            printEpisodeLogHeader();
            episodeLogHeaderPrinted = true;
          }
          console.log(
            formatEpisodeLogLine({
              action: "Refreshed",
              playState: listeningStatus ? listeningStatus.playState : null,
              showTitle: showTitleForLog,
              episodeTitle: episodeTitleForLog,
              pubDate: dateSegment,
              usedFallback: metadata == null,
            })
          );
        }
        continue;
      }

      if (!shouldForce && isUpToDate) {
        manifestChanged =
          upsertManifestEntry(manifest, {
            identifier: file.identifier,
            metadata: metadataForManifest,
            relativePath: effectiveRelativePath,
            skipReason: "up-to-date",
            processed: false,
            sourceMtimeMs: sourceStats.mtimeMs,
            sourceSize: sourceStats.size,
            renderOptions: {
              includeTimestamps,
            },
          }) || manifestChanged;
        summary.skipped += 1;
        visits.total += 1;
        if (useInteractiveOutput && progress) {
          const detailPieces = [showTitleForLog];
          if (episodeTitleForLog && episodeTitleForLog !== showTitleForLog) {
            detailPieces.push(episodeTitleForLog);
          }
          progress.update({
            processed: visits.total,
            detail: `${detailPieces.join(" - ")} (skipped)`,
          });
        } else {
          if (!episodeLogHeaderPrinted) {
            printEpisodeLogHeader();
            episodeLogHeaderPrinted = true;
          }
          console.log(
            formatEpisodeLogLine({
              action: "Skipped",
              playState: listeningStatus ? listeningStatus.playState : null,
              showTitle: showTitleForLog,
              episodeTitle: episodeTitleForLog,
              pubDate: dateSegment,
              usedFallback: metadata == null,
            })
          );
        }
        continue;
      }

      const data = await fs.promises.readFile(file.path, "utf8");
      const markdown = await extractTranscript(data, {
        includeTimestamps,
        metadata,
        fallbackContext,
      });
      await fs.promises.writeFile(effectiveOutputPath, markdown);

      manifestChanged =
        upsertManifestEntry(manifest, {
          identifier: file.identifier,
          metadata: metadataForManifest,
          relativePath: effectiveRelativePath,
          processed: true,
          skipReason: null,
          sourceMtimeMs: sourceStats.mtimeMs,
          sourceSize: sourceStats.size,
          renderOptions: {
            includeTimestamps,
          },
        }) || manifestChanged;

      summary.processed += 1;
      const isPlayed =
        listeningStatus && listeningStatus.playState === "played";
      if (isPlayed) {
        summary.played += 1;
      } else {
        summary.unplayed += 1;
      }
      const usedFallback = metadata == null;
      if (usedFallback) {
        summary.fallback += 1;
      }
      visits.total += 1;
      if (useInteractiveOutput && progress) {
        const detailPieces = [showTitleForLog];
        if (episodeTitleForLog && episodeTitleForLog !== showTitleForLog) {
          detailPieces.push(episodeTitleForLog);
        }
        progress.update({
          processed: visits.total,
          detail: detailPieces.join(" - "),
        });
      } else {
        if (!episodeLogHeaderPrinted) {
          printEpisodeLogHeader();
          episodeLogHeaderPrinted = true;
        }
        console.log(
          formatEpisodeLogLine({
            action: "Saved",
            playState: isPlayed
              ? "played"
              : listeningStatus
              ? listeningStatus.playState
              : null,
            showTitle: showTitleForLog,
            episodeTitle: episodeTitleForLog,
            pubDate: dateSegment,
            usedFallback,
          })
        );
      }
    }

    const reconciliation = reconcileManifestEntries({
      manifest,
      identifiers: identifiersSet,
      transcriptsRoot: transcriptsDir,
    });
    if (reconciliation.archived.length > 0) {
      postSyncMessages.push(
        `[INFO] Archived ${reconciliation.archived.length} transcript(s) missing from cache.`
      );
    }
    if (reconciliation.unarchived.length > 0) {
      postSyncMessages.push(
        `[INFO] Restored ${reconciliation.unarchived.length} transcript(s) found in cache.`
      );
    }
    if (reconciliation.removed.length > 0) {
      postSyncMessages.push(
        `[INFO] Removed ${reconciliation.removed.length} manifest entry(ies) missing from cache and Markdown.`
      );
    }
    if (reconciliation.changed) {
      manifestChanged = true;
    }
    if (migrationSummary.moved > 0) {
      postSyncMessages.push(
        `[INFO] Migrated ${migrationSummary.moved} transcript(s) to hashed filenames.`
      );
    }
    if (migrationSummary.skipped > 0) {
      postSyncMessages.push(
        `[INFO] Skipped ${migrationSummary.skipped} legacy transcript(s) because hashed outputs already exist.`
      );
    }
    if (migrationSummary.failed > 0) {
      postSyncMessages.push(
        `[WARN] Failed to migrate ${migrationSummary.failed} transcript(s).`
      );
    }

    if (manifestChanged) {
      saveListeningStatusManifest(transcriptsDir, manifest);
      postSyncMessages.push(
        `[INFO] Updated listening status manifest at ${getManifestPath(
          transcriptsDir
        )}`
      );
    }

    const summaryParts = [
      `processed=${summary.processed}`,
      `played=${summary.played}`,
      `unplayed=${summary.unplayed}`,
    ];
    if (summary.fallback > 0) {
      summaryParts.push(`fallback=${summary.fallback}`);
    }
    if (summary.skipped > 0) {
      summaryParts.push(`skipped=${summary.skipped}`);
    }
    if (useInteractiveOutput && progress && !progressCompleted) {
      const summaryLabel = summaryParts.join(", ");
      progress.done(`Sync complete (${summaryLabel})`);
      progressCompleted = true;
    } else {
      console.log(`📊 [SUMMARY] ${summaryParts.join(" | ")}`);
    }

    if (prune) {
      const expectedTranscriptPaths = buildExpectedTranscriptPaths(manifest);
      const transcriptPrune = pruneUnreferencedFiles({
        rootDir: transcriptsDir,
        expectedPaths: expectedTranscriptPaths,
        dryRun,
        label: "transcripts",
      });
      const summariesDir = path.join(path.dirname(transcriptsDir), "summaries");
      const expectedSummaryPaths = buildExpectedSummaryPaths(manifest);
      const summaryPrune = pruneUnreferencedFiles({
        rootDir: summariesDir,
        expectedPaths: expectedSummaryPaths,
        dryRun,
        label: "summaries",
      });
      const pruneLabel = dryRun ? "Dry run prune" : "Prune";
      postSyncMessages.push(
        `[INFO] ${pruneLabel} complete: transcripts=${transcriptPrune.orphaned}, summaries=${summaryPrune.orphaned}.`
      );
    }

    postSyncMessages.forEach((message) => {
      console.log(message);
    });
  } finally {
    if (progress && !progressCompleted) {
      progress.stop();
    }
  }
}

export default {
  runSyncCommand,
};
