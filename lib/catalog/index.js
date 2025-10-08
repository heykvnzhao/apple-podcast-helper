import fs from "fs";
import path from "path";

import appConfig from "../app-config.js";
import { DEFAULT_LIST_LIMIT } from "../app-constants.js";
import podcastMetadataLoader from "../podcast-metadata-loader.js";
import transcriptFieldFormatters from "../transcript-field-formatters.js";
import { parsePositiveInteger } from "../utils/numbers.js";
import { getStatusInfo, normalizePlayState } from "../utils/play-state.js";

const { transcriptsDir } = appConfig;
const { formatSlugAsTitle } = transcriptFieldFormatters;
const { loadTranscriptMetadata } = podcastMetadataLoader;
// parsePositiveInteger, getStatusInfo and normalizePlayState imported directly above

function buildCatalogEntries(manifest) {
  if (!manifest || !manifest.entries) {
    return [];
  }
  return Object.values(manifest.entries).map((entry) =>
    buildCatalogEntry(entry)
  );
}

function buildCatalogEntry(entry) {
  const metadata = (entry && entry.metadata) || {};
  const showSlug = metadata.showSlug || null;
  const episodeSlug = metadata.episodeSlug || null;
  const relativePath = entry && entry.relativePath ? entry.relativePath : null;
  const normalizedRelativePath = relativePath
    ? relativePath.split(path.sep).join("/")
    : null;
  const absolutePath = relativePath
    ? path.join(transcriptsDir, relativePath)
    : null;
  const listeningStatus =
    metadata && metadata.listeningStatus ? metadata.listeningStatus : null;
  const playState = normalizePlayState(
    (entry && entry.playState) ||
      (listeningStatus ? listeningStatus.playState : null)
  );
  const showTitle =
    (metadata && metadata.showTitle && metadata.showTitle !== "unknown show"
      ? metadata.showTitle
      : showSlug
      ? formatSlugAsTitle(showSlug)
      : "Unknown show") || "Unknown show";
  const baseEpisodeTitle =
    metadata && metadata.episodeTitle ? metadata.episodeTitle : null;
  const fallbackEpisodeTitle =
    metadata && metadata.baseFileName
      ? formatSlugAsTitle(
          metadata.baseFileName.split("_").slice(2).join("-") ||
            metadata.baseFileName
        )
      : null;
  const episodeTitle =
    baseEpisodeTitle ||
    fallbackEpisodeTitle ||
    normalizedRelativePath ||
    (entry && entry.identifier) ||
    "Unknown episode";
  const pubDate =
    metadata && metadata.pubDate ? metadata.pubDate : "unknown-date";
  const stationTitles = Array.isArray(metadata.stationTitles)
    ? metadata.stationTitles
        .map((value) => value || "")
        .filter((value) => value)
    : [];
  const stationSlugs = Array.isArray(metadata.stationSlugs)
    ? metadata.stationSlugs.map((value) => value || "").filter((value) => value)
    : [];
  const stationTitle =
    (metadata &&
    metadata.stationTitle &&
    metadata.stationTitle !== "unknown station"
      ? metadata.stationTitle
      : null) ||
    stationTitles[0] ||
    null;
  const stationSlug =
    (metadata && metadata.stationSlug ? metadata.stationSlug : null) ||
    stationSlugs[0] ||
    null;
  const sortTimestamp = computeSortTimestamp(
    pubDate,
    (entry && entry.lastProcessedAt) || (entry && entry.lastUpdatedAt) || null
  );
  const hasMarkdown = Boolean(absolutePath && fs.existsSync(absolutePath));
  return {
    identifier: (entry && entry.identifier) || null,
    relativePath,
    normalizedRelativePath,
    absolutePath,
    metadata,
    manifestEntry: entry,
    showTitle,
    showSlug,
    episodeTitle,
    episodeSlug,
    pubDate,
    stationTitle,
    stationSlug,
    stationTitles,
    stationSlugs,
    playState,
    statusInfo: getStatusInfo(playState),
    sortTimestamp,
    hasMarkdown,
    lastProcessedAt: (entry && entry.lastProcessedAt) || null,
    lastUpdatedAt: (entry && entry.lastUpdatedAt) || null,
  };
}

function computeSortTimestamp(pubDate, fallbackIso) {
  if (pubDate && /^\d{4}-\d{2}-\d{2}$/.test(pubDate)) {
    const date = new Date(`${pubDate}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }
  if (fallbackIso) {
    const fallbackDate = new Date(fallbackIso);
    if (!Number.isNaN(fallbackDate.getTime())) {
      return fallbackDate.getTime();
    }
  }
  return 0;
}

function compareCatalogEntriesDesc(a, b) {
  if (a.sortTimestamp !== b.sortTimestamp) {
    return b.sortTimestamp - a.sortTimestamp;
  }
  const showCompare = (a.showTitle || "").localeCompare(
    b.showTitle || "",
    undefined,
    {
      sensitivity: "base",
    }
  );
  if (showCompare !== 0) {
    return showCompare;
  }
  const episodeCompare = (a.episodeTitle || "").localeCompare(
    b.episodeTitle || "",
    undefined,
    { sensitivity: "base" }
  );
  if (episodeCompare !== 0) {
    return episodeCompare;
  }
  return (a.identifier || "").localeCompare(b.identifier || "");
}

function filterEntriesByStatus(entries, status) {
  const list = Array.isArray(entries) ? entries : [];
  if (!status || status === "all") {
    return list.slice();
  }
  return list.filter((entry) => {
    const state = normalizePlayState(entry.playState);
    if (status === "unplayed") {
      return state === "unplayed" || state === "inProgress";
    }
    if (status === "played") {
      return state === "played";
    }
    if (status === "inProgress") {
      return state === "inProgress";
    }
    return false;
  });
}

function buildEntryFilterConfig(rawFilters) {
  if (
    rawFilters &&
    typeof rawFilters === "object" &&
    Array.isArray(rawFilters.showMatchers) &&
    Array.isArray(rawFilters.stationMatchers) &&
    Array.isArray(rawFilters.showFilters) &&
    Array.isArray(rawFilters.stationFilters) &&
    Object.prototype.hasOwnProperty.call(rawFilters, "status")
  ) {
    return rawFilters;
  }
  if (
    typeof rawFilters === "string" ||
    rawFilters === undefined ||
    rawFilters === null
  ) {
    const normalizedStatus =
      typeof rawFilters === "string" ? rawFilters : "all";
    return {
      status: normalizedStatus,
      showFilters: [],
      stationFilters: [],
      showMatchers: [],
      stationMatchers: [],
    };
  }
  const status = rawFilters.status || "all";
  const showFilters = collectMatchFields(
    rawFilters.showFilters,
    rawFilters.show,
    rawFilters.showQuery
  );
  const stationFilters = collectMatchFields(
    rawFilters.stationFilters,
    rawFilters.station,
    rawFilters.stationQuery
  );
  return {
    status,
    showFilters,
    stationFilters,
    showMatchers: buildFuzzyMatchers(showFilters),
    stationMatchers: buildFuzzyMatchers(stationFilters),
  };
}

function matchesEntryShow(entry, matchers) {
  if (!Array.isArray(matchers) || matchers.length === 0) {
    return true;
  }
  if (!entry) {
    return false;
  }
  const metadata = entry.metadata || {};
  const fields = collectMatchFields(
    entry.showTitle,
    entry.showSlug,
    metadata.showTitle,
    metadata.showSlug
  );
  return matchesAnyField(matchers, fields);
}

function matchesEntryStation(entry, matchers) {
  if (!Array.isArray(matchers) || matchers.length === 0) {
    return true;
  }
  if (!entry) {
    return false;
  }
  const metadata = entry.metadata || {};
  const fields = collectMatchFields(
    entry.stationTitle,
    entry.stationSlug,
    entry.stationTitles,
    entry.stationSlugs,
    metadata.stationTitle,
    metadata.stationSlug,
    metadata.stationTitles,
    metadata.stationSlugs
  );
  return matchesAnyField(matchers, fields);
}

function metadataMatchesFilters(metadata, filterConfig) {
  if (!filterConfig) {
    return true;
  }
  const entryLike = {
    showTitle: metadata ? metadata.showTitle : null,
    showSlug: metadata ? metadata.showSlug : null,
    stationTitle: metadata ? metadata.stationTitle : null,
    stationSlug: metadata ? metadata.stationSlug : null,
    stationTitles:
      metadata && Array.isArray(metadata.stationTitles)
        ? metadata.stationTitles
        : [],
    stationSlugs:
      metadata && Array.isArray(metadata.stationSlugs)
        ? metadata.stationSlugs
        : [],
    metadata: metadata || null,
  };
  const showMatchers = Array.isArray(filterConfig.showMatchers)
    ? filterConfig.showMatchers
    : [];
  const stationMatchers = Array.isArray(filterConfig.stationMatchers)
    ? filterConfig.stationMatchers
    : [];
  if (showMatchers.length > 0 && !matchesEntryShow(entryLike, showMatchers)) {
    return false;
  }
  if (
    stationMatchers.length > 0 &&
    !matchesEntryStation(entryLike, stationMatchers)
  ) {
    return false;
  }
  return true;
}

function describeFilterSummary(filters) {
  if (!filters) {
    return "";
  }
  const parts = [];
  if (filters.status && filters.status !== "all") {
    parts.push(`status=${filters.status}`);
  }
  if (Array.isArray(filters.showFilters) && filters.showFilters.length > 0) {
    parts.push(`show~${filters.showFilters.join(" OR ")}`);
  }
  if (
    Array.isArray(filters.stationFilters) &&
    filters.stationFilters.length > 0
  ) {
    parts.push(`station~${filters.stationFilters.join(" OR ")}`);
  }
  return parts.join(" | ");
}

function filterCatalogEntries(entries, rawFilters) {
  const filterConfig = buildEntryFilterConfig(rawFilters);
  const showMatchers = Array.isArray(filterConfig.showMatchers)
    ? filterConfig.showMatchers
    : [];
  const stationMatchers = Array.isArray(filterConfig.stationMatchers)
    ? filterConfig.stationMatchers
    : [];
  let result = filterEntriesByStatus(entries, filterConfig.status);
  if (showMatchers.length > 0) {
    result = result.filter((entry) => matchesEntryShow(entry, showMatchers));
  }
  if (stationMatchers.length > 0) {
    result = result.filter((entry) =>
      matchesEntryStation(entry, stationMatchers)
    );
  }
  return result;
}

function paginateEntries(entries, page, limit) {
  const safeLimit = Math.max(
    parsePositiveInteger(limit) || DEFAULT_LIST_LIMIT,
    1
  );
  if (!entries || entries.length === 0) {
    return {
      items: [],
      total: 0,
      limit: safeLimit,
      page: 0,
      totalPages: 0,
    };
  }
  const total = entries.length;
  const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
  const desiredPage = parsePositiveInteger(page) || 1;
  const clampedPage = Math.min(Math.max(desiredPage, 1), totalPages);
  const startIndex = (clampedPage - 1) * safeLimit;
  const endIndex = Math.min(startIndex + safeLimit, total);
  return {
    items: entries.slice(startIndex, endIndex),
    total,
    limit: safeLimit,
    page: clampedPage,
    totalPages,
  };
}

function findCatalogEntry(entries, key) {
  if (!key || !entries || entries.length === 0) {
    return null;
  }
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return null;
  }
  const directMatch = entries.find((entry) => entry.identifier === trimmedKey);
  if (directMatch) {
    return directMatch;
  }
  const normalizedKey = trimmedKey
    .replace(/^\.\//, "")
    .replace(/^transcripts\//, "")
    .split(path.sep)
    .join("/");
  const relativeMatch = entries.find(
    (entry) => entry.normalizedRelativePath === normalizedKey
  );
  if (relativeMatch) {
    return relativeMatch;
  }
  const baseName = path.basename(normalizedKey);
  const baseNameNoExt = baseName.endsWith(".md")
    ? baseName.slice(0, -3)
    : baseName;
  const filenameMatch = entries.find((entry) => {
    if (!entry.relativePath) {
      return false;
    }
    return (
      path.basename(entry.relativePath) === baseName ||
      (entry.metadata && entry.metadata.baseFileName === baseNameNoExt)
    );
  });
  if (filenameMatch) {
    return filenameMatch;
  }
  const slugMatch = entries.find(
    (entry) => entry.metadata && entry.metadata.baseFileName === trimmedKey
  );
  if (slugMatch) {
    return slugMatch;
  }
  return null;
}

function serializeCatalogEntry(entry) {
  return {
    identifier: entry.identifier || null,
    showTitle: entry.showTitle || null,
    episodeTitle: entry.episodeTitle || null,
    showSlug: entry.showSlug || null,
    episodeSlug: entry.episodeSlug || null,
    pubDate: entry.pubDate || null,
    playState: entry.playState || null,
    stationTitle: entry.stationTitle || null,
    stationSlug: entry.stationSlug || null,
    stationTitles: Array.isArray(entry.stationTitles)
      ? entry.stationTitles
      : [],
    stationSlugs: Array.isArray(entry.stationSlugs) ? entry.stationSlugs : [],
    relativePath: entry.normalizedRelativePath || entry.relativePath || null,
    absolutePath: entry.absolutePath || null,
    hasMarkdown: Boolean(entry.hasMarkdown),
    lastProcessedAt: entry.lastProcessedAt || null,
    lastUpdatedAt: entry.lastUpdatedAt || null,
  };
}

function collectMatchFields(...values) {
  const results = [];
  const seen = new Set();
  const addValue = (value) => {
    if (value === undefined || value === null) {
      return;
    }
    const str = String(value).trim();
    if (!str || seen.has(str)) {
      return;
    }
    seen.add(str);
    results.push(str);
  };
  values.forEach((value) => {
    if (Array.isArray(value)) {
      value.forEach(addValue);
      return;
    }
    addValue(value);
  });
  return results;
}

function normalizeMatchValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildMatchCandidate(value) {
  const normalized = normalizeMatchValue(value);
  if (!normalized) {
    return null;
  }
  const collapsed = normalized.replace(/\s+/g, "");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const initials = tokens.map((token) => token[0]).join("");
  return {
    normalized,
    collapsed,
    tokens,
    initials,
  };
}

function createFuzzyMatcher(query) {
  const candidate = buildMatchCandidate(query);
  if (!candidate) {
    return null;
  }
  return (value) => {
    const target = buildMatchCandidate(value);
    if (!target) {
      return false;
    }
    if (
      candidate.normalized &&
      target.normalized.includes(candidate.normalized)
    ) {
      return true;
    }
    if (candidate.collapsed && target.collapsed.includes(candidate.collapsed)) {
      return true;
    }
    if (
      candidate.tokens.length > 0 &&
      candidate.tokens.every((token) => target.normalized.includes(token))
    ) {
      return true;
    }
    if (candidate.initials && target.initials.includes(candidate.initials)) {
      return true;
    }
    return false;
  };
}

function buildFuzzyMatchers(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  return values
    .map((value) => createFuzzyMatcher(value))
    .filter((fn) => typeof fn === "function");
}

function matchesAnyField(matchers, fields) {
  if (!Array.isArray(matchers) || matchers.length === 0) {
    return true;
  }
  const safeFields = collectMatchFields(fields);
  if (safeFields.length === 0) {
    return false;
  }
  return matchers.some((matcher) => safeFields.some((field) => matcher(field)));
}

function needsStationMetadata(options) {
  if (!options || typeof options !== "object") {
    return false;
  }
  if (
    Array.isArray(options.stationFilters) &&
    options.stationFilters.length > 0
  ) {
    return true;
  }
  if (typeof options.station === "string" && options.station.trim()) {
    return true;
  }
  if (typeof options.stationQuery === "string" && options.stationQuery.trim()) {
    return true;
  }
  return false;
}

function ensureStationMetadataForManifest(manifest, options) {
  if (!manifest || !manifest.entries) {
    return;
  }
  if (!needsStationMetadata(options)) {
    return;
  }
  const missing = [];
  Object.values(manifest.entries).forEach((entry) => {
    if (!entry || !entry.identifier) {
      return;
    }
    const metadata = entry.metadata || null;
    const hasStationList =
      metadata &&
      Array.isArray(metadata.stationTitles) &&
      metadata.stationTitles.some((title) => title && title.trim());
    if (!hasStationList) {
      missing.push(entry.identifier);
    }
  });
  if (missing.length === 0) {
    return;
  }
  const metadataMap = loadTranscriptMetadata(missing);
  metadataMap.forEach((metadata, identifier) => {
    if (!metadata || !manifest.entries[identifier]) {
      return;
    }
    const existing = manifest.entries[identifier].metadata || {};
    manifest.entries[identifier].metadata = {
      ...metadata,
      listeningStatus:
        metadata.listeningStatus != null
          ? metadata.listeningStatus
          : existing.listeningStatus || null,
    };
  });
}

export {
  buildCatalogEntries,
  buildEntryFilterConfig,
  compareCatalogEntriesDesc,
  describeFilterSummary,
  ensureStationMetadataForManifest,
  filterCatalogEntries,
  findCatalogEntry,
  metadataMatchesFilters,
  paginateEntries,
  serializeCatalogEntry,
};

export default {
  buildCatalogEntries,
  buildEntryFilterConfig,
  compareCatalogEntriesDesc,
  describeFilterSummary,
  ensureStationMetadataForManifest,
  filterCatalogEntries,
  findCatalogEntry,
  metadataMatchesFilters,
  paginateEntries,
  serializeCatalogEntry,
};
