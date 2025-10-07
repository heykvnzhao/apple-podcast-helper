const fs = require("fs")
const path = require("path")

const MANIFEST_FILENAME = ".listening-status.json"
const MANIFEST_VERSION = 2

function getManifestPath(baseDirectory) {
	return path.join(baseDirectory, MANIFEST_FILENAME)
}

function createEmptyManifest() {
	return {
		version: MANIFEST_VERSION,
		entries: {},
		updatedAt: null,
	}
}

function cloneMetadata(metadata) {
	if (!metadata || typeof metadata !== "object") {
		return null
	}
	return JSON.parse(JSON.stringify(metadata))
}

function normalizeSourceInfo(input) {
	if (!input || typeof input !== "object") {
		return null
	}
	const { mtimeMs = null, size = null } = input
	const hasMtime = typeof mtimeMs === "number" && Number.isFinite(mtimeMs)
	const hasSize = typeof size === "number" && Number.isFinite(size)
	if (!hasMtime && !hasSize) {
		return null
	}
	const normalized = {}
	if (hasMtime) {
		normalized.mtimeMs = mtimeMs
	}
	if (hasSize) {
		normalized.size = size
	}
	return normalized
}

function normalizeRenderOptions(input) {
	if (!input || typeof input !== "object") {
		return null
	}
	const result = {}
	if ("includeTimestamps" in input) {
		result.includeTimestamps = Boolean(input.includeTimestamps)
	}
	return Object.keys(result).length > 0 ? result : null
}

function loadListeningStatusManifest(baseDirectory) {
	const manifestPath = getManifestPath(baseDirectory)
	if (!fs.existsSync(manifestPath)) {
		return createEmptyManifest()
	}
	try {
		const raw = fs.readFileSync(manifestPath, "utf8")
		if (!raw.trim()) {
			return createEmptyManifest()
		}
		const parsed = JSON.parse(raw)
		if (!parsed || typeof parsed !== "object") {
			return createEmptyManifest()
		}
		if (!parsed.entries || typeof parsed.entries !== "object") {
			parsed.entries = {}
		}
		parsed.version = MANIFEST_VERSION
		parsed.updatedAt = parsed.updatedAt || null
		return parsed
	} catch (error) {
		console.warn(
			`Unable to read listening status manifest. Continuing without cached statuses. (${error.message})`,
		)
		return createEmptyManifest()
	}
}

function saveListeningStatusManifest(baseDirectory, manifest) {
	const manifestPath = getManifestPath(baseDirectory)
	const directory = path.dirname(manifestPath)
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory, { recursive: true })
	}
	const output = {
		version: MANIFEST_VERSION,
		entries: manifest.entries || {},
		updatedAt: new Date().toISOString(),
	}
	fs.writeFileSync(manifestPath, `${JSON.stringify(output, null, 2)}\n`)
}

function upsertManifestEntry(manifest, payload) {
	if (!payload || !payload.identifier) {
		return false
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
	} = payload
	const nowIso = new Date().toISOString()
	const existing = manifest.entries[identifier] || {}
	const serializedMetadata = metadata ? cloneMetadata(metadata) : existing.metadata || null
	const nextSource = normalizeSourceInfo(
		source || {
			mtimeMs: typeof sourceMtimeMs === "number" ? sourceMtimeMs : null,
			size: typeof sourceSize === "number" ? sourceSize : null,
		},
	)
	const nextRenderOptions = normalizeRenderOptions(renderOptions)
	const existingSource = normalizeSourceInfo(existing.source)
	const existingRenderOptions = normalizeRenderOptions(existing.renderOptions)
	const nextComparable = {
		metadata: serializedMetadata,
		relativePath:
			typeof relativePath === "string" ? relativePath : existing.relativePath || null,
		playState:
			serializedMetadata && serializedMetadata.listeningStatus
				? serializedMetadata.listeningStatus.playState
				: existing.playState || null,
		skipReason: skipReason || null,
		lastProcessedAt: processed ? nowIso : existing.lastProcessedAt || null,
		source: nextSource,
		renderOptions: nextRenderOptions,
	}
	const prevComparable = {
		metadata: existing.metadata || null,
		relativePath: existing.relativePath || null,
		playState: existing.playState || null,
		skipReason: existing.skipReason || null,
		lastProcessedAt: existing.lastProcessedAt || null,
		source: existingSource,
		renderOptions: existingRenderOptions,
	}
	const hasChanged = JSON.stringify(prevComparable) !== JSON.stringify(nextComparable)
	if (!hasChanged) {
		return false
	}
	manifest.entries[identifier] = {
		identifier,
		...nextComparable,
		lastUpdatedAt: nowIso,
	}
	return true
}

function mergeManifestMetadataIntoMap(manifest, metadataMap) {
	if (!manifest || !manifest.entries) {
		return
	}
	Object.entries(manifest.entries).forEach(([identifier, entry]) => {
		if (!entry || !entry.metadata) {
			return
		}
		if (!metadataMap.has(identifier)) {
			metadataMap.set(identifier, cloneMetadata(entry.metadata))
		}
	})
}

module.exports = {
	loadListeningStatusManifest,
	saveListeningStatusManifest,
	upsertManifestEntry,
	mergeManifestMetadataIntoMap,
	getManifestPath,
}
