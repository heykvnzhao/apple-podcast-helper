#!/usr/bin/env node

import fs from "fs";
import os from "os";
import path from "path";

import appConfig from "../lib/app-config.js";
import listeningStatusStore from "../lib/listening-status-manifest-store.js";
import { loadEnv } from "../lib/env.js";

const { transcriptsDir } = appConfig;
const { loadListeningStatusManifest } = listeningStatusStore;
const projectRoot = path.dirname(transcriptsDir);
const summariesRoot = path.join(projectRoot, "summaries");

loadEnv();

function printUsage() {
  console.log("Usage: pnpm export -- [options] <destination>");
  console.log("");
  console.log("Options:");
  console.log(
    "  --target, --destination, --output <path>  Directory that receives unplayed summaries"
  );
  console.log(
    "  --dry-run                                 List files without copying"
  );
  console.log(
    "  -h, --help                                Show this help text"
  );
  console.log("");
  console.log(
    "If no destination flag is provided, the script falls back to SUMMARY_EXPORT_TARGET."
  );
}

function parseArguments(argv) {
  const result = {
    target: process.env.SUMMARY_EXPORT_TARGET || null,
    dryRun: false,
    help: false,
  };
  let positionalTarget = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg === "--target" || arg === "--destination" || arg === "--output") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`Missing value for ${arg}`);
      }
      result.target = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      result.target = arg.slice("--target=".length);
      continue;
    }
    if (arg.startsWith("--destination=")) {
      result.target = arg.slice("--destination=".length);
      continue;
    }
    if (arg.startsWith("--output=")) {
      result.target = arg.slice("--output=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!positionalTarget) {
      positionalTarget = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!result.target && positionalTarget) {
    result.target = positionalTarget;
  }
  return result;
}

function expandHomeDirectory(input) {
  if (!input) {
    return null;
  }
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function resolveDestination(input) {
  const expanded = expandHomeDirectory(input);
  if (!expanded) {
    return null;
  }
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }
  return path.resolve(process.cwd(), expanded);
}

function ensureParentDirectory(filePath) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function collectSummaryFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  entries.forEach((entry) => {
    if (entry.name.startsWith(".")) {
      return;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "played") {
        return;
      }
      files.push(...collectSummaryFiles(fullPath));
      return;
    }
    if (!entry.isFile()) {
      return;
    }
    if (path.extname(entry.name).toLowerCase() !== ".md") {
      return;
    }
    if (!entry.name.startsWith("summary_")) {
      return;
    }
    const relativePath = path.relative(summariesRoot, fullPath);
    files.push({
      sourcePath: fullPath,
      relativePath,
      baseFileName: entry.name.slice(
        "summary_".length,
        entry.name.length - ".md".length
      ),
    });
  });
  return files;
}

function buildPlayStateIndex(manifest) {
  const index = new Map();
  if (!manifest || !manifest.entries) {
    return index;
  }
  Object.values(manifest.entries).forEach((entry) => {
    if (!entry) {
      return;
    }
    const metadata = entry.metadata || {};
    const relativePath = entry.relativePath || null;
    const baseFileName =
      (metadata.baseFileName && metadata.baseFileName.trim()) ||
      (relativePath
        ? path.basename(relativePath, path.extname(relativePath))
        : null);
    if (!baseFileName) {
      return;
    }
    const state =
      (metadata.listeningStatus && metadata.listeningStatus.playState) ||
      entry.playState ||
      null;
    if (!state) {
      return;
    }
    index.set(baseFileName, state);
  });
  return index;
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  if (!args.target) {
    console.error("[ERROR] Destination directory not provided.");
    printUsage();
    process.exit(1);
  }
  const destination = resolveDestination(args.target);
  if (!destination) {
    console.error("[ERROR] Unable to resolve destination path.");
    process.exit(1);
  }
  if (!fs.existsSync(summariesRoot)) {
    console.log(
      `[INFO] No summaries directory found at ${summariesRoot}. Nothing to export.`
    );
    return;
  }
  const manifest = loadListeningStatusManifest(transcriptsDir);
  const playStateIndex = buildPlayStateIndex(manifest);
  const summaries = collectSummaryFiles(summariesRoot).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );
  if (summaries.length === 0) {
    console.log("[INFO] No unplayed summaries found to export.");
    return;
  }
  if (args.dryRun) {
    console.log("[INFO] Dry run enabled. No files will be written.");
  }
  console.log(`[INFO] Destination: ${destination}`);
  let exportedCount = 0;
  let cachedCount = 0;
  let skippedPlayedCount = 0;
  let plannedCount = 0;
  summaries.forEach((summary) => {
    const normalized = normalizeRelativePath(summary.relativePath);
    const state = playStateIndex.get(summary.baseFileName);
    if (state && String(state).toLowerCase() === "played") {
      skippedPlayedCount += 1;
      return;
    }
    const destinationPath = path.join(destination, summary.relativePath);
    if (fs.existsSync(destinationPath)) {
      const stat = fs.statSync(destinationPath);
      if (!stat.isFile()) {
        throw new Error(
          `Destination exists and is not a file: ${destinationPath}`
        );
      }
      cachedCount += 1;
      return;
    }
    plannedCount += 1;
    if (args.dryRun) {
      console.log(`[DRY] ${normalized}`);
      return;
    }
    ensureParentDirectory(destinationPath);
    fs.copyFileSync(summary.sourcePath, destinationPath);
    console.log(`[COPY] ${normalized}`);
    exportedCount += 1;
  });
  const plannedLabel = args.dryRun
    ? `planned ${plannedCount}`
    : `exported ${exportedCount}`;
  console.log(
    `[INFO] ${plannedLabel} file(s) | cached ${cachedCount} | skipped (played) ${skippedPlayedCount}`
  );
}

try {
  main();
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  console.error(`[ERROR] ${message}`);
  process.exit(1);
}
