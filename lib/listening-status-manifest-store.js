const fs = require("fs")
const path = require("path")

const MANIFEST_FILENAME = ".listening-status.json"
const MANIFEST_VERSION = 1

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
	} = payload
	const nowIso = new Date().toISOString()
	const existing = manifest.entries[identifier] || {}
	const serializedMetadata = metadata ? cloneMetadata(metadata) : existing.metadata || null
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
	}
	const prevComparable = {
		metadata: existing.metadata || null,
		relativePath: existing.relativePath || null,
		playState: existing.playState || null,
		skipReason: existing.skipReason || null,
		lastProcessedAt: existing.lastProcessedAt || null,
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
