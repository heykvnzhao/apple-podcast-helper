import fs from "fs";
import path from "path";

import { buildEpisodeMarkdown } from "./episode-markdown-builder.js";
import { resolveMetadataForFile } from "./podcast-metadata-loader.js";

function transcriptIdentifierFromRelativePath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const index = normalized.indexOf(".ttml");
  return index === -1
    ? normalized
    : normalized.slice(0, index + ".ttml".length);
}

function parseBaseNameSegments(baseName = "") {
  const parts = baseName.split("_");
  const hasPlayedPrefix = parts[0] === "played" && parts.length >= 4;
  const offset = hasPlayedPrefix ? 1 : 0;
  const showSlug = parts[offset] || "unknown-show";
  const dateSegment = parts[offset + 1] || "";
  return { hasPlayedPrefix, showSlug, dateSegment };
}

function stripPlayedPrefix(baseName = "") {
  return baseName.startsWith("played_")
    ? baseName.slice("played_".length)
    : baseName;
}

function findTTMLFiles(dir, baseDir = dir) {
  const files = fs.readdirSync(dir);
  let ttmlFiles = [];

  files.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      ttmlFiles = ttmlFiles.concat(findTTMLFiles(fullPath, baseDir));
    } else if (path.extname(fullPath) === ".ttml") {
      const relative = path.relative(baseDir, fullPath);
      ttmlFiles.push({
        path: fullPath,
        identifier: transcriptIdentifierFromRelativePath(relative),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  });

  return ttmlFiles;
}

function convertExistingTxtTranscripts(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

  entries.forEach((entry) => {
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".txt") {
      const sourcePath = path.join(directoryPath, entry.name);
      const destinationPath = path.join(
        directoryPath,
        `${path.basename(entry.name, ".txt")}.md`
      );
      const content = fs.readFileSync(sourcePath, "utf8");
      fs.writeFileSync(destinationPath, content);
      fs.unlinkSync(sourcePath);
    }
  });
}

function moveMarkdownTranscriptsIntoShowDirectories(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

  entries.forEach((entry) => {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
      return;
    }

    const baseName = path.basename(entry.name, ".md");
    const { showSlug: parsedShowSlug } = parseBaseNameSegments(baseName);
    const showSlug = parsedShowSlug || "unknown-show";
    const showDir = path.join(directoryPath, showSlug);
    if (!fs.existsSync(showDir)) {
      fs.mkdirSync(showDir, { recursive: true });
    }

    const currentPath = path.join(directoryPath, entry.name);
    const targetPath = path.join(showDir, entry.name);
    if (currentPath !== targetPath) {
      fs.renameSync(currentPath, targetPath);
    }
  });
}

function ensureShowOutputDirectory(baseDirectory, showSlug) {
  const directoryPath = path.join(baseDirectory, showSlug);
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
  return directoryPath;
}

function ensureEpisodeOutputDirectory(baseDirectory, showSlug, playState) {
  const showDirectory = ensureShowOutputDirectory(baseDirectory, showSlug);
  if (playState === "played") {
    const playedDirectory = path.join(showDirectory, "played");
    if (!fs.existsSync(playedDirectory)) {
      fs.mkdirSync(playedDirectory, { recursive: true });
    }
    return playedDirectory;
  }
  return showDirectory;
}

function resolveFallbackContext(baseName, directorySlug) {
  const { showSlug: parsedShowSlug, dateSegment } =
    parseBaseNameSegments(baseName);
  const isGenericDirectory =
    !directorySlug ||
    directorySlug === "transcripts" ||
    directorySlug === "played" ||
    directorySlug === "summaries";
  const showSlug = isGenericDirectory ? parsedShowSlug : directorySlug;
  return {
    showSlug,
    dateSegment,
  };
}

function updateManifestRelativePath(
  manifest,
  oldRelativePath,
  newRelativePath,
  targetBaseName
) {
  if (!manifest || !manifest.entries || !oldRelativePath || !newRelativePath) {
    return false;
  }
  let changed = false;
  Object.values(manifest.entries).forEach((entry) => {
    if (!entry || entry.relativePath !== oldRelativePath) {
      return;
    }
    entry.relativePath = newRelativePath;
    if (
      entry.metadata &&
      typeof entry.metadata === "object" &&
      targetBaseName
    ) {
      entry.metadata.baseFileName = targetBaseName;
    }
    entry.lastUpdatedAt = new Date().toISOString();
    changed = true;
  });
  return changed;
}

function updateExistingMarkdownFiles(
  directoryPath,
  metadataIndex,
  manifest,
  transcriptsRoot
) {
  if (!fs.existsSync(directoryPath)) {
    return false;
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  let manifestChanged = false;
  entries.forEach((entry) => {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      manifestChanged =
        updateExistingMarkdownFiles(
          fullPath,
          metadataIndex,
          manifest,
          transcriptsRoot
        ) || manifestChanged;
      return;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
      return;
    }

    const currentContent = fs.readFileSync(fullPath, "utf8");
    const rawBaseName = path.basename(entry.name, ".md");
    const metadata = resolveMetadataForFile(metadataIndex, rawBaseName);
    const parentDirSlug = path.basename(directoryPath);
    const fallbackContext = resolveFallbackContext(rawBaseName, parentDirSlug);
    const baseNameWithoutPrefix = stripPlayedPrefix(rawBaseName);
    const playState =
      metadata && metadata.listeningStatus
        ? metadata.listeningStatus.playState
        : null;
    const fallbackShowSlug =
      (fallbackContext.showSlug && fallbackContext.showSlug.trim()) ||
      parseBaseNameSegments(baseNameWithoutPrefix).showSlug ||
      "unknown-show";
    const desiredDirectory = transcriptsRoot
      ? ensureEpisodeOutputDirectory(
          transcriptsRoot,
          fallbackShowSlug,
          playState
        )
      : directoryPath;
    const targetFileName = `${baseNameWithoutPrefix}.md`;
    const targetPath = path.join(desiredDirectory, targetFileName);
    const oldRelativePath = transcriptsRoot
      ? path.relative(transcriptsRoot, fullPath)
      : entry.name;
    let effectivePath = fullPath;
    if (targetPath !== fullPath) {
      if (fs.existsSync(targetPath)) {
        const oldDisplay = oldRelativePath.split(path.sep).join("/");
        const newDisplay = transcriptsRoot
          ? path.relative(transcriptsRoot, targetPath).split(path.sep).join("/")
          : targetFileName;
        console.warn(
          `[WARN] Skipped moving ${oldDisplay} to ${newDisplay} because the destination already exists.`
        );
      } else {
        fs.renameSync(fullPath, targetPath);
        effectivePath = targetPath;
        const newRelativePath = transcriptsRoot
          ? path.relative(transcriptsRoot, targetPath)
          : targetFileName;
        manifestChanged =
          updateManifestRelativePath(
            manifest,
            oldRelativePath.split(path.sep).join("/"),
            newRelativePath.split(path.sep).join("/"),
            baseNameWithoutPrefix
          ) || manifestChanged;
      }
    }
    if (metadata) {
      metadata.baseFileName = baseNameWithoutPrefix;
    }

    let transcriptBody = currentContent.trim();
    const transcriptHeadingIndex = currentContent.indexOf(
      "## Episode transcript"
    );
    if (transcriptHeadingIndex !== -1) {
      const afterHeading = currentContent.slice(
        transcriptHeadingIndex + "## Episode transcript".length
      );
      transcriptBody = afterHeading.replace(/^\s+/, "").trim();
    }
    const updatedContent = buildEpisodeMarkdown(
      transcriptBody,
      metadata,
      fallbackContext
    );
    fs.writeFileSync(effectivePath, updatedContent);
  });
  return manifestChanged;
}

function updateExistingSummaryFiles(
  directoryPath,
  metadataIndex,
  summariesRoot,
  externalSummariesRoot
) {
  if (!fs.existsSync(directoryPath)) {
    return false;
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  let changed = false;
  entries.forEach((entry) => {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      changed =
        updateExistingSummaryFiles(
          fullPath,
          metadataIndex,
          summariesRoot,
          externalSummariesRoot
        ) || changed;
      return;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
      return;
    }

    const rawBaseName = path.basename(entry.name, ".md");
    // summaries are written as `summary_<baseFileName>.md` by the Gemini client
    const baseNameWithoutSummaryPrefix = rawBaseName.startsWith("summary_")
      ? rawBaseName.slice("summary_".length)
      : rawBaseName;
    const metadata = resolveMetadataForFile(
      metadataIndex,
      baseNameWithoutSummaryPrefix
    );
    const parentDirSlug = path.basename(directoryPath);
    const fallbackContext = resolveFallbackContext(
      baseNameWithoutSummaryPrefix,
      parentDirSlug
    );
    const playState =
      metadata && metadata.listeningStatus
        ? metadata.listeningStatus.playState
        : null;
    const fallbackShowSlug =
      (fallbackContext.showSlug && fallbackContext.showSlug.trim()) ||
      parseBaseNameSegments(baseNameWithoutSummaryPrefix).showSlug ||
      "unknown-show";

    const desiredDirectory = summariesRoot
      ? ensureEpisodeOutputDirectory(summariesRoot, fallbackShowSlug, playState)
      : directoryPath;
    const targetFileName = `summary_${baseNameWithoutSummaryPrefix}.md`;
    const targetPath = path.join(desiredDirectory, targetFileName);
    let effectivePath = fullPath;
    if (targetPath !== fullPath) {
      if (fs.existsSync(targetPath)) {
        const oldDisplay = path
          .relative(summariesRoot || directoryPath, fullPath)
          .split(path.sep)
          .join("/");
        const newDisplay = path
          .relative(summariesRoot || directoryPath, targetPath)
          .split(path.sep)
          .join("/");
        console.warn(
          `[WARN] Skipped moving ${oldDisplay} to ${newDisplay} because the destination already exists.`
        );
      } else {
        try {
          fs.renameSync(fullPath, targetPath);
          effectivePath = targetPath;
          changed = true;
        } catch (e) {
          console.warn(
            `[WARN] Unable to move summary ${fullPath} -> ${targetPath}: ${
              e && e.message ? e.message : e
            }`
          );
        }
      }
    }

    if (externalSummariesRoot) {
      try {
        const externalTargetDir =
          playState === "played"
            ? path.join(externalSummariesRoot, fallbackShowSlug, "played")
            : path.join(externalSummariesRoot, fallbackShowSlug);
        if (!fs.existsSync(externalTargetDir)) {
          fs.mkdirSync(externalTargetDir, { recursive: true });
        }
        const externalCacheFile = path.join(externalTargetDir, targetFileName);
        // Mirror the (moved) file to the external summaries location
        try {
          // If there's a legacy file sitting at the external root (or other "flat" location),
          // prefer moving it into the correct show/played folder instead of leaving a copy behind.
          const legacyAtRoot = path.join(externalSummariesRoot, entry.name);
          if (
            fs.existsSync(legacyAtRoot) &&
            path.resolve(legacyAtRoot) !== path.resolve(externalCacheFile)
          ) {
            try {
              if (!fs.existsSync(externalCacheFile)) {
                // move legacy file into target location
                fs.renameSync(legacyAtRoot, externalCacheFile);
              } else {
                // target already exists; remove legacy duplicate
                fs.unlinkSync(legacyAtRoot);
              }
            } catch (e) {
              // fallback to copying if rename/unlink fails
              try {
                fs.copyFileSync(effectivePath, externalCacheFile);
                // attempt to remove legacy file
                try {
                  fs.unlinkSync(legacyAtRoot);
                } catch (e) {}
              } catch (e) {}
            }
          } else {
            // normal copy for cases where there is no legacy root file
            try {
              fs.copyFileSync(effectivePath, externalCacheFile);
            } catch (e) {
              // best-effort
            }
          }
        } catch (e) {
          // best-effort
        }
      } catch (e) {
        // ignore external mirror errors
      }
    }
  });
  return changed;
}

export {
  convertExistingTxtTranscripts,
  ensureEpisodeOutputDirectory,
  ensureShowOutputDirectory,
  findTTMLFiles,
  moveMarkdownTranscriptsIntoShowDirectories,
  resolveFallbackContext,
  transcriptIdentifierFromRelativePath,
  updateExistingMarkdownFiles,
  updateExistingSummaryFiles,
};

export default {
  transcriptIdentifierFromRelativePath,
  findTTMLFiles,
  convertExistingTxtTranscripts,
  moveMarkdownTranscriptsIntoShowDirectories,
  ensureShowOutputDirectory,
  ensureEpisodeOutputDirectory,
  resolveFallbackContext,
  updateExistingMarkdownFiles,
  updateExistingSummaryFiles,
};
