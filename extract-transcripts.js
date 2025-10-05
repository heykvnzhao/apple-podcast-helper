const fs = require("fs")
const path = require("path")
const os = require("os")

const { extractTranscript } = require("./lib/parse-ttml-transcript")
const { slugify, truncateSlug, formatSlugAsTitle } = require("./lib/format-transcript-fields")
const {
	loadTranscriptMetadata,
	buildMetadataFilenameIndex,
} = require("./lib/load-podcast-metadata")
const {
	findTTMLFiles,
	convertExistingTxtTranscripts,
	moveMarkdownTranscriptsIntoShowDirectories,
	ensureEpisodeOutputDirectory,
	resolveFallbackContext,
	updateExistingMarkdownFiles,
} = require("./lib/manage-transcript-files")
const {
	loadListeningStatusManifest,
	saveListeningStatusManifest,
	upsertManifestEntry,
	mergeManifestMetadataIntoMap,
	getManifestPath,
} = require("./lib/listening-status-manifest")

const transcriptsDir = path.resolve("./transcripts")
const ttmlCacheDir = path.join(
	os.homedir(),
	"Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML",
)

function ensureTranscriptsDirectory() {
	if (!fs.existsSync(transcriptsDir)) {
		fs.mkdirSync(transcriptsDir, { recursive: true })
	}
}

function parseCliArguments(argv) {
	const flags = {
		includeTimestamps: false,
	}
	const positional = []
	argv.forEach((arg) => {
		if (arg === "--timestamps") {
			flags.includeTimestamps = true
			return
		}
		positional.push(arg)
	})
	return { flags, positional }
}

async function handleSingleFile({ includeTimestamps, inputPath, outputPath }) {
	if (!inputPath || !outputPath) {
		console.error("Single file mode requires input and output paths.")
		printUsage()
		process.exit(1)
	}
	try {
		const data = await fs.promises.readFile(inputPath, "utf8")
		const baseName = path.basename(outputPath, path.extname(outputPath))
		const parentDirSlug = path.basename(path.dirname(outputPath))
		const fallbackContext = resolveFallbackContext(baseName, parentDirSlug)
		const markdown = await extractTranscript(data, {
			includeTimestamps,
			fallbackContext,
		})
		await fs.promises.writeFile(outputPath, markdown)
		console.log("✅ Transcript saved")
	} catch (error) {
		console.error(error)
	}
}

function ensureTtmlCachePresent() {
	if (!fs.existsSync(ttmlCacheDir)) {
		console.error(`TTML directory not found at ${ttmlCacheDir}`)
		process.exit(1)
	}
}


function prepareExistingMarkdown(metadataFilenameIndex, manifest) {
	convertExistingTxtTranscripts(transcriptsDir)
	moveMarkdownTranscriptsIntoShowDirectories(transcriptsDir)
	return updateExistingMarkdownFiles(
		transcriptsDir,
		metadataFilenameIndex,
		manifest,
		transcriptsDir,
	)
}

function resolveOutputPath({
	filenameCounts,
	showSlug,
	dateSegment,
	episodeSlug,
	listeningStatus,
}) {
	const baseName = `${showSlug}_${dateSegment}_${episodeSlug}`
	const playState = listeningStatus ? listeningStatus.playState : null
	const isPlayed = playState === "played"
	const countScope = isPlayed ? `${showSlug}/played` : showSlug
	const countKey = `${countScope}/${baseName}`
	const count = filenameCounts.get(countKey) || 0
	const suffix = count === 0 ? "" : `-${count}`
	filenameCounts.set(countKey, count + 1)

	const outputDir = ensureEpisodeOutputDirectory(
		transcriptsDir,
		showSlug,
		playState,
	)
	return path.join(outputDir, `${baseName}${suffix}.md`)
}

const EPISODE_LOG_COLUMNS = {
	state: 12,
	date: 12,
	show: 28,
	episode: 32,
}

function truncateToWidth(value, width) {
	const str = value || ""
	if (str.length <= width) {
		return str.padEnd(width, " ")
	}
	const sliceWidth = Math.max(width - 1, 0)
	return `${str.slice(0, sliceWidth)}…`
}

function printEpisodeLogHeader() {
	const headerCells = [
		truncateToWidth("STATE", EPISODE_LOG_COLUMNS.state),
		truncateToWidth("DATE", EPISODE_LOG_COLUMNS.date),
		truncateToWidth("SHOW", EPISODE_LOG_COLUMNS.show),
		truncateToWidth("EPISODE", EPISODE_LOG_COLUMNS.episode),
	]
	console.log("📋 │ " + headerCells.join(" │ ") + " │ [ACTION]")
}

function formatEpisodeLogLine({
	action,
	playState,
	showTitle,
	episodeTitle,
	pubDate,
	usedFallback,
}) {
	const statusMap = {
		played: { icon: "✅", text: "PLAYED" },
		inProgress: { icon: "🎧", text: "IN PROGRESS" },
		unplayed: { icon: "🆕", text: "NOT PLAYED" },
	}
	const status = statusMap[playState] || { icon: "❔", text: "UNKNOWN" }
	const safeDate = pubDate && pubDate !== "unknown-date" ? pubDate : "unknown date"
	const safeShow = showTitle || "Unknown show"
	const safeEpisode = episodeTitle || "Unknown episode"
	const cells = [
		truncateToWidth(status.text, EPISODE_LOG_COLUMNS.state),
		truncateToWidth(safeDate, EPISODE_LOG_COLUMNS.date),
		truncateToWidth(safeShow, EPISODE_LOG_COLUMNS.show),
		truncateToWidth(safeEpisode, EPISODE_LOG_COLUMNS.episode),
	]
	const actionLabel = action ? action.toUpperCase() : "LOG"
	const fallbackBadge = usedFallback ? " ⚠️" : ""
	return `${status.icon} │ ${cells.join(" │ ")} │ [${actionLabel}]${fallbackBadge}`
}

function buildFallbackMetadata({ showSlug, rawEpisodeTitle, dateSegment, episodeSlug }) {
	const safeShowSlug = showSlug || "unknown-show"
	const safeDateSegment = dateSegment || "unknown-date"
	const safeEpisodeSlug = episodeSlug || "episode"
	const safeEpisodeTitle = rawEpisodeTitle || "unknown episode"
	return {
		showTitle: formatSlugAsTitle(safeShowSlug) || "Unknown show",
		episodeTitle: safeEpisodeTitle,
		pubDate: safeDateSegment,
		showSlug: safeShowSlug,
		episodeSlug: safeEpisodeSlug,
		baseFileName: `${safeShowSlug}_${safeDateSegment}_${safeEpisodeSlug}`,
		episodeDescriptionHtml: "",
		episodeDescriptionText: "",
		listeningStatus: null,
	}
}

async function handleBatch({ includeTimestamps }) {
	ensureTtmlCachePresent()
	console.log("[INFO] Scanning TTML cache...")

	const ttmlFiles = findTTMLFiles(ttmlCacheDir, ttmlCacheDir)
	console.log(`[INFO] Found ${ttmlFiles.length} TTML file(s)`)

	const identifiers = ttmlFiles.map((file) => file.identifier)
	const metadataMap = loadTranscriptMetadata(identifiers)
	const manifest = loadListeningStatusManifest(transcriptsDir)
	mergeManifestMetadataIntoMap(manifest, metadataMap)
	const metadataFilenameIndex = buildMetadataFilenameIndex(metadataMap)
	const filenameCounts = new Map()

	const prepManifestChanged = prepareExistingMarkdown(metadataFilenameIndex, manifest)

	const summary = {
		processed: 0,
		played: 0,
		unplayed: 0,
		fallback: 0,
	}
	let manifestChanged = Boolean(prepManifestChanged)
	let episodeLogHeaderPrinted = false

	const identifiersSet = new Set(identifiers)

	for (const file of ttmlFiles) {
		const metadata = metadataMap.get(file.identifier) || null
		const showSlug = slugify(metadata ? metadata.showTitle : null, "unknown-show")
		const rawEpisodeTitle = metadata
			? metadata.episodeTitle
			: path.basename(file.identifier, ".ttml")
		const episodeSlug = truncateSlug(slugify(rawEpisodeTitle, "episode"), 20)
		const dateSegment = metadata ? metadata.pubDate : "unknown-date"
		const fallbackContext = {
			showSlug,
			dateSegment,
		}
		const listeningStatus = metadata && metadata.listeningStatus ? metadata.listeningStatus : null

		const outputPath = resolveOutputPath({
			filenameCounts,
			showSlug,
			dateSegment,
			episodeSlug,
			listeningStatus,
		})
		const data = await fs.promises.readFile(file.path, "utf8")
		const markdown = await extractTranscript(data, {
			includeTimestamps,
			metadata,
			fallbackContext,
		})
		await fs.promises.writeFile(outputPath, markdown)
		const relativePathRaw = path.relative(transcriptsDir, outputPath)
		const relativePath = relativePathRaw
			? relativePathRaw.split(path.sep).join("/")
			: path.basename(outputPath)
		const metadataForManifest =
			metadata ||
			buildFallbackMetadata({
				showSlug,
				rawEpisodeTitle,
				dateSegment,
				episodeSlug,
			})

		manifestChanged =
			upsertManifestEntry(manifest, {
				identifier: file.identifier,
				metadata: metadataForManifest,
				relativePath,
				processed: true,
			}) || manifestChanged

		summary.processed += 1
		const isPlayed = listeningStatus && listeningStatus.playState === "played"
		if (isPlayed) {
			summary.played += 1
		} else {
			summary.unplayed += 1
		}
		const usedFallback = metadata == null
		if (usedFallback) {
			summary.fallback += 1
		}
		const showTitleForLog =
			metadata && metadata.showTitle && metadata.showTitle !== "unknown show"
				? metadata.showTitle
				: formatSlugAsTitle(showSlug)
		const episodeTitleForLog = metadata && metadata.episodeTitle ? metadata.episodeTitle : rawEpisodeTitle
		if (!episodeLogHeaderPrinted) {
			printEpisodeLogHeader()
			episodeLogHeaderPrinted = true
		}
		console.log(
			formatEpisodeLogLine({
				action: "Saved",
				playState: isPlayed ? "played" : listeningStatus ? listeningStatus.playState : null,
				showTitle: showTitleForLog,
				episodeTitle: episodeTitleForLog,
				pubDate: dateSegment,
				usedFallback,
			}),
		)
	}

	const archivedIdentifiers = Object.keys(manifest.entries || {}).filter(
		(identifier) => !identifiersSet.has(identifier),
	)
	if (archivedIdentifiers.length > 0) {
		console.log(
			`[INFO] Retained ${archivedIdentifiers.length} manifest transcript(s) missing from cache.`,
		)
	}

	if (manifestChanged) {
		saveListeningStatusManifest(transcriptsDir, manifest)
		console.log(`[INFO] Updated listening status manifest at ${getManifestPath(transcriptsDir)}`)
	}

	const summaryParts = [
		`processed=${summary.processed}`,
		`played=${summary.played}`,
		`unplayed=${summary.unplayed}`,
	]
	if (summary.fallback > 0) {
		summaryParts.push(`fallback=${summary.fallback}`)
	}
	console.log(`📊 [SUMMARY] ${summaryParts.join(" | ")}`)
}

function printUsage() {
	console.error("Invalid arguments.")
	console.error("Usage:")
	console.error(
		"  For single file: node extract-transcripts.js <input.ttml> <output.md> [--timestamps]",
	)
	console.error(
		"  For all files: node extract-transcripts.js [--timestamps]",
	)
}

async function main() {
	ensureTranscriptsDirectory()
	const { flags, positional } = parseCliArguments(process.argv.slice(2))
	const { includeTimestamps } = flags

	if (positional.length === 2) {
		const [inputPath, outputPath] = positional
		await handleSingleFile({ includeTimestamps, inputPath, outputPath })
		return
	}

	if (positional.length === 0) {
		await handleBatch({ includeTimestamps })
		return
	}

	printUsage()
	process.exit(1)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
