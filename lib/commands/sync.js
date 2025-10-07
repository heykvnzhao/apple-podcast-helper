const fs = require("fs")
const path = require("path")

const { extractTranscript } = require("../ttml-transcript-parser")
const { slugify, truncateSlug, formatSlugAsTitle } = require("../transcript-field-formatters")
const {
	findTTMLFiles,
	convertExistingTxtTranscripts,
	moveMarkdownTranscriptsIntoShowDirectories,
	ensureEpisodeOutputDirectory,
	resolveFallbackContext,
	updateExistingMarkdownFiles,
} = require("../transcript-file-manager")
const {
	loadTranscriptMetadata,
	buildMetadataFilenameIndex,
} = require("../podcast-metadata-loader")
const {
	loadListeningStatusManifest,
	saveListeningStatusManifest,
	upsertManifestEntry,
	mergeManifestMetadataIntoMap,
	getManifestPath,
} = require("../listening-status-manifest-store")
const {
	buildEntryFilterConfig,
	describeFilterSummary,
	metadataMatchesFilters,
} = require("../catalog")
const { printEpisodeLogHeader, formatEpisodeLogLine } = require("../cli/output-format")
const { createProgressIndicator } = require("../cli/progress-indicator")
const { runHelpCommand } = require("../cli/help")
const { reportOptionMessages } = require("../cli/options")
const { transcriptsDir, ttmlCacheDir } = require("../app-config")

async function runSyncCommand(options) {
	const safeOptions = options || {}
	if (safeOptions.help) {
		runHelpCommand({ topic: "sync" })
		return
	}
	if (!reportOptionMessages(safeOptions)) {
		throw new Error("Unable to continue. Fix the errors above and try again.")
	}
	const includeTimestamps = safeOptions.includeTimestamps !== false
	if (safeOptions.mode === "single") {
		await handleSingleFile({
			includeTimestamps,
			inputPath: safeOptions.inputPath,
			outputPath: safeOptions.outputPath,
		})
		return
	}
	if (safeOptions.mode === "batch") {
		await handleBatch({
			includeTimestamps,
			showFilters: safeOptions.showFilters || [],
			stationFilters: safeOptions.stationFilters || [],
			interactiveOutput: Boolean(safeOptions.interactiveOutput),
		})
		return
	}
	throw new Error("Invalid sync arguments. Run `transcripts help sync` for details.")
}

async function handleSingleFile({ includeTimestamps, inputPath, outputPath }) {
	if (!inputPath || !outputPath) {
		throw new Error("Single file mode requires input and output paths.")
	}
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
	return updateExistingMarkdownFiles(transcriptsDir, metadataFilenameIndex, manifest, transcriptsDir)
}

function resolveOutputPath({ filenameCounts, showSlug, dateSegment, episodeSlug, listeningStatus }) {
	const baseName = `${showSlug}_${dateSegment}_${episodeSlug}`
	const playState = listeningStatus ? listeningStatus.playState : null
	const isPlayed = playState === "played"
	const countScope = isPlayed ? `${showSlug}/played` : showSlug
	const countKey = `${countScope}/${baseName}`
	const count = filenameCounts.get(countKey) || 0
	const suffix = count === 0 ? "" : `-${count}`
	filenameCounts.set(countKey, count + 1)

	const outputDir = ensureEpisodeOutputDirectory(transcriptsDir, showSlug, playState)
	return path.join(outputDir, `${baseName}${suffix}.md`)
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
		stationTitle: null,
		stationSlug: null,
		stationTitles: [],
		stationSlugs: [],
		baseFileName: `${safeShowSlug}_${safeDateSegment}_${safeEpisodeSlug}`,
		episodeDescriptionHtml: "",
		episodeDescriptionText: "",
		listeningStatus: null,
	}
}

async function handleBatch({
	includeTimestamps,
	showFilters = [],
	stationFilters = [],
	interactiveOutput = false,
}) {
	ensureTtmlCachePresent()
	const useInteractiveOutput =
		Boolean(interactiveOutput) && Boolean(process.stdout && process.stdout.isTTY)
	if (!useInteractiveOutput) {
		console.log("[INFO] Scanning TTML cache...")
	}

	const ttmlFiles = findTTMLFiles(ttmlCacheDir, ttmlCacheDir)
	if (!useInteractiveOutput) {
		console.log(`[INFO] Found ${ttmlFiles.length} TTML file(s)`)
	}

	const identifiers = ttmlFiles.map((file) => file.identifier)
	const metadataMap = loadTranscriptMetadata(identifiers)
	const manifest = loadListeningStatusManifest(transcriptsDir)
	mergeManifestMetadataIntoMap(manifest, metadataMap)
	const metadataFilenameIndex = buildMetadataFilenameIndex(metadataMap)
	const filenameCounts = new Map()
	const filterConfig = buildEntryFilterConfig({
		status: "all",
		showFilters,
		stationFilters,
	})

	const sortedTtmlFiles = [...ttmlFiles].sort((a, b) => {
		const metaA = metadataMap.get(a.identifier) || null
		const metaB = metadataMap.get(b.identifier) || null
		const dateA =
			metaA && metaA.pubDate && metaA.pubDate !== "unknown-date"
				? metaA.pubDate
				: "9999-12-31"
		const dateB =
			metaB && metaB.pubDate && metaB.pubDate !== "unknown-date"
				? metaB.pubDate
				: "9999-12-31"
		if (dateA !== dateB) {
			return dateA.localeCompare(dateB)
		}
		const showTitleA =
			metaA && metaA.showTitle && metaA.showTitle !== "unknown show"
				? metaA.showTitle.toLowerCase()
				: metaA && metaA.showSlug
					? formatSlugAsTitle(metaA.showSlug).toLowerCase()
					: ""
		const showTitleB =
			metaB && metaB.showTitle && metaB.showTitle !== "unknown show"
				? metaB.showTitle.toLowerCase()
				: metaB && metaB.showSlug
					? formatSlugAsTitle(metaB.showSlug).toLowerCase()
					: ""
		if (showTitleA !== showTitleB) {
			return showTitleA.localeCompare(showTitleB)
		}
		return a.identifier.localeCompare(b.identifier)
	})

	let filteredTtmlFiles = sortedTtmlFiles
	const filtersApplied =
		filterConfig.showMatchers.length > 0 || filterConfig.stationMatchers.length > 0
	if (filtersApplied) {
		const allowed = []
		let skippedCount = 0
		let skippedMissingMetadata = 0
		filteredTtmlFiles.forEach((file) => {
			const metadata = metadataMap.get(file.identifier) || null
			if (metadataMatchesFilters(metadata, filterConfig)) {
				allowed.push(file)
				return
			}
			skippedCount += 1
			if (!metadata) {
				skippedMissingMetadata += 1
			}
		})
		if (allowed.length === 0) {
			const summary = describeFilterSummary(filterConfig) || "provided filters"
			console.log(`[INFO] No TTML files matched filters (${summary}).`)
			return
		}
		const parts = [`matched ${allowed.length}`]
		if (skippedCount > 0) {
			const missingLabel =
				skippedMissingMetadata > 0 ? ` (${skippedMissingMetadata} without metadata)` : ""
			parts.push(`skipped ${skippedCount}${missingLabel}`)
		}
		const summary = describeFilterSummary(filterConfig) || "provided filters"
		if (!useInteractiveOutput) {
			console.log(`[INFO] Filters (${summary}) → ${parts.join(" | ")}`)
		}
		filteredTtmlFiles = allowed
		if (!useInteractiveOutput) {
			console.log(`[INFO] Processing ${filteredTtmlFiles.length} TTML file(s) after filters.`)
		}
	}

	const prepManifestChanged = prepareExistingMarkdown(metadataFilenameIndex, manifest)
	const totalToProcess = filteredTtmlFiles.length
	let progress = null
	let progressCompleted = false
	if (useInteractiveOutput && totalToProcess > 0) {
		progress = createProgressIndicator({
			label: "Syncing transcripts",
			total: totalToProcess,
		})
		progress.start()
	}

	const summary = {
		processed: 0,
		played: 0,
		unplayed: 0,
		fallback: 0,
	}
	let manifestChanged = Boolean(prepManifestChanged)
	let episodeLogHeaderPrinted = false
	const postSyncMessages = []

	const identifiersSet = new Set(identifiers)

	try {
		for (const file of filteredTtmlFiles) {
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
			const listeningStatus =
				metadata && metadata.listeningStatus ? metadata.listeningStatus : null

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
			const episodeTitleForLog =
				metadata && metadata.episodeTitle ? metadata.episodeTitle : rawEpisodeTitle
			if (useInteractiveOutput && progress) {
				const detailPieces = [showTitleForLog]
				if (episodeTitleForLog && episodeTitleForLog !== showTitleForLog) {
					detailPieces.push(episodeTitleForLog)
				}
				progress.update({
					processed: summary.processed,
					detail: detailPieces.join(" - "),
				})
			} else {
				if (!episodeLogHeaderPrinted) {
					printEpisodeLogHeader()
					episodeLogHeaderPrinted = true
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
					}),
				)
			}
		}

		const archivedIdentifiers = Object.keys(manifest.entries || {}).filter(
			(identifier) => !identifiersSet.has(identifier),
		)
		if (archivedIdentifiers.length > 0) {
			postSyncMessages.push(
				`[INFO] Retained ${archivedIdentifiers.length} manifest transcript(s) missing from cache.`,
			)
		}

		if (manifestChanged) {
			saveListeningStatusManifest(transcriptsDir, manifest)
			postSyncMessages.push(
				`[INFO] Updated listening status manifest at ${getManifestPath(transcriptsDir)}`,
			)
		}

		const summaryParts = [
			`processed=${summary.processed}`,
			`played=${summary.played}`,
			`unplayed=${summary.unplayed}`,
		]
		if (summary.fallback > 0) {
			summaryParts.push(`fallback=${summary.fallback}`)
		}
		if (useInteractiveOutput && progress && !progressCompleted) {
			const summaryLabel = summaryParts.join(", ")
			progress.done(`Sync complete (${summaryLabel})`)
			progressCompleted = true
		} else {
			console.log(`📊 [SUMMARY] ${summaryParts.join(" | ")}`)
		}

		postSyncMessages.forEach((message) => {
			console.log(message)
		})
	} finally {
		if (progress && !progressCompleted) {
			progress.stop()
		}
	}
}

module.exports = {
	runSyncCommand,
}
