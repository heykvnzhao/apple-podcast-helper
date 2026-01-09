import fs from "fs";
import path from "path";

const MANIFEST_FILENAME = ".listening-status.json";
const MANIFEST_VERSION = 2;

function getManifestPath(baseDirectory) {
  return path.join(baseDirectory, MANIFEST_FILENAME);
}

function createEmptyManifest() {
  return {
    version: MANIFEST_VERSION,
    entries: {},
    updatedAt: null,
  };
}

function cloneMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  return JSON.parse(JSON.stringify(metadata));
}

function normalizeSourceInfo(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const { mtimeMs = null, size = null } = input;
  const hasMtime = typeof mtimeMs === "number" && Number.isFinite(mtimeMs);
  const hasSize = typeof size === "number" && Number.isFinite(size);
  if (!hasMtime && !hasSize) {
    return null;
  }
  const normalized = {};
  if (hasMtime) {
    normalized.mtimeMs = mtimeMs;
  }
  if (hasSize) {
    normalized.size = size;
  }
  return normalized;
}

function normalizeRenderOptions(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const result = {};
  if ("includeTimestamps" in input) {
    result.includeTimestamps = Boolean(input.includeTimestamps);
  }
  return Object.keys(result).length > 0 ? result : null;
}

function loadListeningStatusManifest(baseDirectory) {
  const manifestPath = getManifestPath(baseDirectory);
  if (!fs.existsSync(manifestPath)) {
    return createEmptyManifest();
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    if (!raw.trim()) {
      return createEmptyManifest();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return createEmptyManifest();
    }
    if (!parsed.entries || typeof parsed.entries !== "object") {
      parsed.entries = {};
    }
    parsed.version = MANIFEST_VERSION;
    parsed.updatedAt = parsed.updatedAt || null;
    return parsed;
  } catch (error) {
    console.warn(
      `Unable to read listening status manifest. Continuing without cached statuses. (${error.message})`
    );
    return createEmptyManifest();
  }
}

function saveListeningStatusManifest(baseDirectory, manifest) {
  const manifestPath = getManifestPath(baseDirectory);
  const directory = path.dirname(manifestPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const output = {
    version: MANIFEST_VERSION,
    entries: manifest.entries || {},
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(output, null, 2)}\n`);
}

function upsertManifestEntry(manifest, payload) {
  if (!payload || !payload.identifier) {
    return false;
  }
  const {
    identifier,
    metadata,
    relativePath = null,
    skipReason = null,
    processed = false,
    source = null,
    sourceMtimeMs = null,
    sourceSize = null,
    renderOptions = null,
  } = payload;
  const nowIso = new Date().toISOString();
  const existing = manifest.entries[identifier] || {};
  const serializedMetadata = metadata
    ? cloneMetadata(metadata)
    : existing.metadata || null;
  const nextSource = normalizeSourceInfo(
    source || {
      mtimeMs: typeof sourceMtimeMs === "number" ? sourceMtimeMs : null,
      size: typeof sourceSize === "number" ? sourceSize : null,
    }
  );
  const nextRenderOptions = normalizeRenderOptions(renderOptions);
  const existingSource = normalizeSourceInfo(existing.source);
  const existingRenderOptions = normalizeRenderOptions(existing.renderOptions);
  const nextComparable = {
    metadata: serializedMetadata,
    relativePath:
      typeof relativePath === "string"
        ? relativePath
        : existing.relativePath || null,
    playState:
      serializedMetadata && serializedMetadata.listeningStatus
        ? serializedMetadata.listeningStatus.playState
        : existing.playState || null,
    skipReason: skipReason || null,
    lastProcessedAt: processed ? nowIso : existing.lastProcessedAt || null,
    source: nextSource,
    renderOptions: nextRenderOptions,
  };
  const prevComparable = {
    metadata: existing.metadata || null,
    relativePath: existing.relativePath || null,
    playState: existing.playState || null,
    skipReason: existing.skipReason || null,
    lastProcessedAt: existing.lastProcessedAt || null,
    source: existingSource,
    renderOptions: existingRenderOptions,
  };
  const hasChanged =
    JSON.stringify(prevComparable) !== JSON.stringify(nextComparable);
  if (!hasChanged) {
    return false;
  }
  manifest.entries[identifier] = {
    identifier,
    ...nextComparable,
    lastUpdatedAt: nowIso,
  };
  return true;
}

function normalizeRelativePath(relativePath) {
  if (!relativePath || typeof relativePath !== "string") {
    return null;
  }
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.replace(/^\.\//, "");
}

function resolveTranscriptPath(transcriptsRoot, relativePath) {
  if (!transcriptsRoot || !relativePath) {
    return null;
  }
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) {
    return null;
  }
  return path.join(transcriptsRoot, normalized.split("/").join(path.sep));
}

function reconcileManifestEntries({ manifest, identifiers, transcriptsRoot }) {
  if (!manifest || !manifest.entries) {
    return { changed: false, archived: [], unarchived: [], removed: [] };
  }
  const idSet =
    identifiers instanceof Set ? identifiers : new Set(identifiers || []);
  const archived = [];
  const unarchived = [];
  const removed = [];
  let changed = false;
  const nowIso = new Date().toISOString();

  Object.entries(manifest.entries).forEach(([identifier, entry]) => {
    if (!entry || !identifier) {
      return;
    }
    const inCache = idSet.has(identifier);
    if (!inCache) {
      const absolutePath = resolveTranscriptPath(
        transcriptsRoot,
        entry.relativePath
      );
      const hasMarkdown = absolutePath ? fs.existsSync(absolutePath) : false;
      if (hasMarkdown) {
        if (!entry.archived) {
          entry.archived = true;
          entry.lastUpdatedAt = nowIso;
          archived.push(identifier);
          changed = true;
        }
      } else {
        delete manifest.entries[identifier];
        removed.push(identifier);
        changed = true;
      }
      return;
    }
    if (entry.archived) {
      delete entry.archived;
      entry.lastUpdatedAt = nowIso;
      unarchived.push(identifier);
      changed = true;
    }
  });

  return { changed, archived, unarchived, removed };
}

function mergeManifestMetadataIntoMap(manifest, metadataMap) {
  if (!manifest || !manifest.entries) {
    return;
  }
  Object.entries(manifest.entries).forEach(([identifier, entry]) => {
    if (!entry || !entry.metadata) {
      return;
    }
    if (!metadataMap.has(identifier)) {
      metadataMap.set(identifier, cloneMetadata(entry.metadata));
    }
  });
}

export {
  getManifestPath,
  loadListeningStatusManifest,
  mergeManifestMetadataIntoMap,
  reconcileManifestEntries,
  saveListeningStatusManifest,
  upsertManifestEntry,
};

export default {
  loadListeningStatusManifest,
  saveListeningStatusManifest,
  upsertManifestEntry,
  mergeManifestMetadataIntoMap,
  reconcileManifestEntries,
  getManifestPath,
};
