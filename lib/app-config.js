import fs from "fs";
import os from "os";
import path from "path";

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const transcriptsDir = path.join(projectRoot, "transcripts");
const ttmlCacheDir = path.join(
  os.homedir(),
  "Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML"
);

function ensureTranscriptsDirectory() {
  if (!fs.existsSync(transcriptsDir)) {
    fs.mkdirSync(transcriptsDir, { recursive: true });
  }
}

export { ensureTranscriptsDirectory, transcriptsDir, ttmlCacheDir };

export default {
  transcriptsDir,
  ttmlCacheDir,
  ensureTranscriptsDirectory,
};
