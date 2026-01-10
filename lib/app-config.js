import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { loadEnv } from "./env.js";

loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const transcriptsDir = path.join(projectRoot, "transcripts");
const defaultTtmlCacheDir = path.join(
  os.homedir(),
  "Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML"
);
const defaultDbPath = path.join(
  os.homedir(),
  "Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite"
);
const ttmlCacheDir =
  process.env.APPLE_PODCASTS_TTML_CACHE_DIR &&
  process.env.APPLE_PODCASTS_TTML_CACHE_DIR.trim()
    ? process.env.APPLE_PODCASTS_TTML_CACHE_DIR.trim()
    : defaultTtmlCacheDir;
const podcastsDbPath =
  process.env.APPLE_PODCASTS_DB_PATH && process.env.APPLE_PODCASTS_DB_PATH.trim()
    ? process.env.APPLE_PODCASTS_DB_PATH.trim()
    : defaultDbPath;

function ensureTranscriptsDirectory() {
  if (!fs.existsSync(transcriptsDir)) {
    fs.mkdirSync(transcriptsDir, { recursive: true });
  }
}

export {
  ensureTranscriptsDirectory,
  transcriptsDir,
  ttmlCacheDir,
  podcastsDbPath,
};

export default {
  transcriptsDir,
  ttmlCacheDir,
  podcastsDbPath,
  ensureTranscriptsDirectory,
};
