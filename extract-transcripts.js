#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const os = require("os")
const readline = require("readline")
const { spawn } = require("child_process")

process.stdout.on("error", (error) => {
	if (error && error.code === "EPIPE") {
		process.exit(0)
	}
	throw error
})

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

const CLI_COMMANDS = new Set(["sync", "list", "copy", "pick", "help"])
const COMMAND_ALIASES = {
	interactive: "pick",
}

const LISTING_STATUS_METADATA = {
	played: { icon: "✅", label: "PLAYED" },
	inProgress: { icon: "🎧", label: "IN PROGRESS" },
	unplayed: { icon: "🆕", label: "NOT PLAYED" },
}

const DEFAULT_LIST_LIMIT = 20
const DEFAULT_PICK_PAGE_SIZE = 20

function ensureTranscriptsDirectory() {
	if (!fs.existsSync(transcriptsDir)) {
		fs.mkdirSync(transcriptsDir, { recursive: true })
	}
}

function normalizePlayState(playState) {
	if (!playState || typeof playState !== "string") {
		return null
	}
	const normalized = playState.toLowerCase()
	if (normalized === "played") {
		return "played"
	}
	if (normalized === "inprogress" || normalized === "in-progress" || normalized === "in_progress") {
		return "inProgress"
	}
	if (normalized === "unplayed" || normalized === "notplayed" || normalized === "not-played") {
		return "unplayed"
	}
	return playState
}

function getStatusInfo(playState) {
	const normalized = normalizePlayState(playState)
	return LISTING_STATUS_METADATA[normalized] || { icon: "❔", label: "UNKNOWN" }
}

function parseCliArguments(argv) {
	const rawArgs = Array.isArray(argv) ? argv.slice() : []
	const args = []
	let flaggedCommand = null
	let syncFlagEncountered = false
	rawArgs.forEach((arg) => {
		if (arg === "--sync") {
			flaggedCommand = "sync"
			syncFlagEncountered = true
			return
		}
		if (arg === "--pick") {
			flaggedCommand = flaggedCommand || "pick"
			return
		}
		args.push(arg)
	})
	if (flaggedCommand) {
		const options = parseCommandOptions(flaggedCommand, args)
		if (syncFlagEncountered && options && typeof options === "object") {
			options.launchPickerAfterSync = true
		}
		return {
			command: flaggedCommand,
			options,
		}
	}
	if (args.length === 0) {
		return { command: "pick", options: parsePickOptions([]) }
	}
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		return { command: "help", options: parseHelpOptions([]) }
	}
	const first = args[0]
	if (first && !first.startsWith("-")) {
		const normalized = COMMAND_ALIASES[first] || first
		if (CLI_COMMANDS.has(normalized)) {
			if (normalized === "help") {
				return {
					command: "help",
					options: parseHelpOptions(args.slice(1)),
				}
			}
			return {
				command: normalized,
				options: parseCommandOptions(normalized, args.slice(1)),
			}
		}
	}
	return { command: "pick", options: parsePickOptions(args) }
}

function parseCommandOptions(command, args) {
	switch (command) {
		case "sync":
			return parseSyncOptions(args)
		case "list":
			return parseListOptions(args)
		case "copy":
			return parseCopyOptions(args)
		case "pick":
			return parsePickOptions(args)
		default:
			return { help: true, errors: [`Unknown command: ${command}`] }
	}
}

function parseHelpOptions(args) {
	const options = { topic: null }
	if (Array.isArray(args)) {
		for (let index = 0; index < args.length; index += 1) {
			const value = args[index]
			if (!value) {
				continue
			}
			options.topic = value
			break
		}
	}
	options.topic = options.topic || "global"
	return options
}

function parseSyncOptions(args) {
	const options = {
		includeTimestamps: true,
		mode: "batch",
		inputPath: null,
		outputPath: null,
		help: false,
		errors: [],
		warnings: [],
	}
	const positional = []
	const list = Array.isArray(args) ? args : []
	list.forEach((arg) => {
		if (arg === "--timestamps") {
			options.includeTimestamps = true
			return
		}
		if (arg === "--no-timestamps") {
			options.includeTimestamps = false
			return
		}
		if (arg === "--help" || arg === "-h") {
			options.help = true
			return
		}
		positional.push(arg)
	})
	if (positional.length === 0) {
		options.mode = "batch"
		return options
	}
	if (positional.length === 2) {
		options.mode = "single"
		options.inputPath = positional[0]
		options.outputPath = positional[1]
		return options
	}
	options.mode = "invalid"
	options.errors.push(
		"Single file mode requires input and output paths (e.g. node extract-transcripts.js input.ttml output.md)",
	)
	return options
}

function parseListOptions(args) {
	const options = {
		status: "all",
		limit: DEFAULT_LIST_LIMIT,
		page: 1,
		format: "table",
		help: false,
		errors: [],
		warnings: [],
	}
	const list = Array.isArray(args) ? args : []
	for (let index = 0; index < list.length; index += 1) {
		const rawArg = list[index]
		if (rawArg === "--help" || rawArg === "-h") {
			options.help = true
			continue
		}
		const [flag, inlineValue] = splitFlagValue(rawArg)
		if (flag === "--status") {
			const value = inlineValue !== null ? inlineValue : list[index + 1]
			if (inlineValue === null && value !== undefined) {
				index += 1
			}
			if (value === undefined) {
				options.errors.push("--status requires a value (played, unplayed, in-progress, all)")
				continue
			}
			const normalized = normalizeStatusFilter(value)
			if (!normalized) {
				options.errors.push(`Unknown status filter: ${value}`)
				continue
			}
			options.status = normalized
			continue
		}
		if (flag === "--limit" || flag === "--page-size") {
			const value = inlineValue !== null ? inlineValue : list[index + 1]
			if (inlineValue === null && value !== undefined) {
				index += 1
			}
			if (value === undefined) {
				options.errors.push(`${flag} requires a positive integer`)
				continue
			}
			const parsed = parsePositiveInteger(value)
			if (parsed === null) {
				options.errors.push(`${flag} requires a positive integer (received "${value}")`)
				continue
			}
			options.limit = parsed
			continue
		}
		if (flag === "--page") {
			const value = inlineValue !== null ? inlineValue : list[index + 1]
			if (inlineValue === null && value !== undefined) {
				index += 1
			}
			if (value === undefined) {
				options.errors.push("--page requires a positive integer")
				continue
			}
			const parsed = parsePositiveInteger(value)
			if (parsed === null) {
				options.errors.push(`--page requires a positive integer (received "${value}")`)
				continue
			}
			options.page = parsed
			continue
		}
		if (flag === "--json") {
			options.format = "json"
			continue
		}
		if (flag === "--table") {
			options.format = "table"
			continue
		}
		options.warnings.push(`Unrecognized argument: ${rawArg}`)
	}
	return options
}

function parseCopyOptions(args) {
	const options = {
		key: null,
		print: false,
		help: false,
		errors: [],
		warnings: [],
	}
	const list = Array.isArray(args) ? args : []
	list.forEach((arg) => {
		if (arg === "--help" || arg === "-h") {
			options.help = true
			return
		}
		if (arg === "--print") {
			options.print = true
			return
		}
		if (!options.key) {
			options.key = arg
			return
		}
		options.errors.push(`Unexpected argument: ${arg}`)
	})
	if (!options.key && !options.help) {
		options.errors.push("copy command requires an identifier or relative path")
	}
	return options
}

function parsePickOptions(args) {
	const options = {
		status: "unplayed",
		pageSize: DEFAULT_PICK_PAGE_SIZE,
		help: false,
		errors: [],
		warnings: [],
	}
	const list = Array.isArray(args) ? args : []
	for (let index = 0; index < list.length; index += 1) {
		const rawArg = list[index]
		if (rawArg === "--help" || rawArg === "-h") {
			options.help = true
			continue
		}
		const [flag, inlineValue] = splitFlagValue(rawArg)
		if (flag === "--status") {
			const value = inlineValue !== null ? inlineValue : list[index + 1]
			if (inlineValue === null && value !== undefined) {
				index += 1
			}
			if (value === undefined) {
				options.errors.push("--status requires a value (played, unplayed, in-progress, all)")
				continue
			}
			const normalized = normalizeStatusFilter(value)
			if (!normalized) {
				options.errors.push(`Unknown status filter: ${value}`)
				continue
			}
			options.status = normalized
			continue
		}
		if (flag === "--page-size" || flag === "--limit") {
			const value = inlineValue !== null ? inlineValue : list[index + 1]
			if (inlineValue === null && value !== undefined) {
				index += 1
			}
			if (value === undefined) {
				options.errors.push(`${flag} requires a positive integer`)
				continue
			}
			const parsed = parsePositiveInteger(value)
			if (parsed === null) {
				options.errors.push(`${flag} requires a positive integer (received "${value}")`)
				continue
			}
			options.pageSize = parsed
			continue
		}
		const numericValue = parsePositiveInteger(rawArg)
		if (numericValue !== null && !inlineValue && !rawArg.startsWith("-")) {
			options.pageSize = numericValue
			continue
		}
		options.warnings.push(`Unrecognized argument: ${rawArg}`)
	}
	return options
}

function splitFlagValue(argument) {
	if (!argument || typeof argument !== "string") {
		return [argument, null]
	}
	if (!argument.startsWith("--")) {
		return [argument, null]
	}
	const equalsIndex = argument.indexOf("=")
	if (equalsIndex === -1) {
		return [argument, null]
	}
	return [argument.slice(0, equalsIndex), argument.slice(equalsIndex + 1)]
}

function parsePositiveInteger(value) {
	if (value === undefined || value === null) {
		return null
	}
	const parsed = Number.parseInt(String(value), 10)
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null
	}
	return parsed
}

function normalizeStatusFilter(value) {
	if (!value) {
		return null
	}
	const normalized = String(value).trim().toLowerCase()
	if (!normalized) {
		return null
	}
	if (normalized === "all" || normalized === "any" || normalized === "*" || normalized === "everything") {
		return "all"
	}
	if (normalized === "played" || normalized === "done" || normalized === "complete") {
		return "played"
	}
	if (normalized === "unplayed" || normalized === "not-played" || normalized === "new" || normalized === "fresh") {
		return "unplayed"
	}
	if (
		normalized === "inprogress" ||
		normalized === "in-progress" ||
		normalized === "in_progress" ||
		normalized === "partial" ||
		normalized === "progress"
	) {
		return "inProgress"
	}
	return null
}

function reportOptionMessages(options) {
	if (!options || typeof options !== "object") {
		return true
	}
	if (Array.isArray(options.warnings)) {
		options.warnings.forEach((warning) => {
			console.warn(`[WARN] ${warning}`)
		})
	}
	if (Array.isArray(options.errors) && options.errors.length > 0) {
		options.errors.forEach((error) => {
			console.error(`[ERROR] ${error}`)
		})
		return false
	}
	return true
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

const LIST_COMMAND_COLUMNS = {
	index: 4,
	state: EPISODE_LOG_COLUMNS.state,
	date: EPISODE_LOG_COLUMNS.date,
	show: EPISODE_LOG_COLUMNS.show,
	episode: EPISODE_LOG_COLUMNS.episode,
	location: 44,
}

function truncateToWidth(value, width) {
	const str = value || ""
	if (str.length <= width) {
		return str.padEnd(width, " ")
	}
	const sliceWidth = Math.max(width - 1, 0)
	return `${str.slice(0, sliceWidth)}…`
}

function truncateForDisplay(value, width) {
	if (!Number.isFinite(width) || width <= 0) {
		return ""
	}
	const str = value || ""
	if (str.length <= width) {
		return str
	}
	const sliceWidth = Math.max(width - 1, 0)
	return `${str.slice(0, sliceWidth)}…`
}

function formatDurationShort(seconds) {
	if (!Number.isFinite(seconds)) {
		return null
	}
	const totalSeconds = Math.max(Math.round(seconds), 0)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const remainingSeconds = totalSeconds % 60
	const parts = []
	if (hours > 0) {
		parts.push(`${hours}h`)
	}
	if (minutes > 0) {
		parts.push(`${minutes}m`)
	}
	if (parts.length === 0) {
		parts.push(`${remainingSeconds}s`)
	}
	return parts.join(" ")
}

function formatListeningStatusSummary(entry) {
	if (!entry || !entry.metadata || !entry.metadata.listeningStatus) {
		return null
	}
	const status = entry.metadata.listeningStatus
	const playState = normalizePlayState(status.playState)
	if (playState === "played") {
		return "Finished"
	}
	if (playState === "unplayed") {
		return "Not started"
	}
	if (playState === "inProgress") {
		const percent =
			typeof status.completionRatio === "number"
				? Math.round(status.completionRatio * 100)
				: null
		const remainingLabel = formatDurationShort(status.remainingSeconds)
		const pieces = ["In progress"]
		if (percent != null && Number.isFinite(percent)) {
			pieces.push(`${percent}%`)
		}
		if (remainingLabel) {
			pieces.push(`${remainingLabel} left`)
		}
		return pieces.join(" • ")
	}
	return null
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

function buildListLogHeaderLine() {
	const headerCells = [
		truncateToWidth("#", LIST_COMMAND_COLUMNS.index),
		truncateToWidth("STATE", LIST_COMMAND_COLUMNS.state),
		truncateToWidth("DATE", LIST_COMMAND_COLUMNS.date),
		truncateToWidth("SHOW", LIST_COMMAND_COLUMNS.show),
		truncateToWidth("EPISODE", LIST_COMMAND_COLUMNS.episode),
		truncateToWidth("LOCATION", LIST_COMMAND_COLUMNS.location),
	]
	return `📚 │ ${headerCells.join(" │ ")}`
}

function printListLogHeader() {
	console.log(buildListLogHeaderLine())
}

function formatEpisodeLogLine({
	action,
	playState,
	showTitle,
	episodeTitle,
	pubDate,
	usedFallback,
}) {
	const status = getStatusInfo(playState)
	const safeDate = pubDate && pubDate !== "unknown-date" ? pubDate : "unknown date"
	const safeShow = showTitle || "Unknown show"
	const safeEpisode = episodeTitle || "Unknown episode"
	const cells = [
		truncateToWidth(status.label, EPISODE_LOG_COLUMNS.state),
		truncateToWidth(safeDate, EPISODE_LOG_COLUMNS.date),
		truncateToWidth(safeShow, EPISODE_LOG_COLUMNS.show),
		truncateToWidth(safeEpisode, EPISODE_LOG_COLUMNS.episode),
	]
	const actionLabel = action ? action.toUpperCase() : "LOG"
	const fallbackBadge = usedFallback ? " ⚠️" : ""
	return `${status.icon} │ ${cells.join(" │ ")} │ [${actionLabel}]${fallbackBadge}`
}

function formatListLogLine({ index, entry }) {
	const status = entry.statusInfo || getStatusInfo(entry.playState)
	const displayIndex = typeof index === "number" ? String(index).padStart(2, " ") : "-"
	const safeDate = entry.pubDate && entry.pubDate !== "unknown-date" ? entry.pubDate : "unknown date"
	const safeShow = entry.showTitle || "Unknown show"
	const safeEpisode = entry.episodeTitle || "Unknown episode"
	const locationSource = entry.normalizedRelativePath || entry.relativePath || entry.identifier || "<not saved>"
	const locationLabel = entry.hasMarkdown ? locationSource : `${locationSource} ⚠️`
	const cells = [
		truncateToWidth(displayIndex, LIST_COMMAND_COLUMNS.index),
		truncateToWidth(status.label, LIST_COMMAND_COLUMNS.state),
		truncateToWidth(safeDate, LIST_COMMAND_COLUMNS.date),
		truncateToWidth(safeShow, LIST_COMMAND_COLUMNS.show),
		truncateToWidth(safeEpisode, LIST_COMMAND_COLUMNS.episode),
		truncateToWidth(locationLabel, LIST_COMMAND_COLUMNS.location),
	]
	return `${status.icon} │ ${cells.join(" │ ")}`
}

function buildPickerEntryLines({ entry, displayIndex, isActive, indexWidth, maxWidth }) {
	const pointer = isActive ? ">" : " "
	const safeIndexWidth = Math.max(indexWidth || 0, 2)
	const label = String(displayIndex || "").padStart(safeIndexWidth, " ")
	const showTitle = entry && entry.showTitle ? entry.showTitle : "Unknown show"
	const episodeTitle = entry && entry.episodeTitle ? entry.episodeTitle : "Unknown episode"
	const title = `${showTitle} - ${episodeTitle}`
	const titleWidth = Math.max((maxWidth || 0) - (safeIndexWidth + 4), 16)
	const titleLine = `${pointer} ${label}. ${truncateForDisplay(title, titleWidth)}`
	const metaParts = []
	if (entry && entry.pubDate && entry.pubDate !== "unknown-date") {
		metaParts.push(`Published ${entry.pubDate}`)
	}
	const statusSummary = formatListeningStatusSummary(entry)
	if (statusSummary) {
		metaParts.push(statusSummary)
	}
	if (metaParts.length === 0) {
		return [titleLine]
	}
	const metaWidth = Math.max((maxWidth || 0) - 4, 16)
	const metaLine = `    ${truncateForDisplay(metaParts.join(" • "), metaWidth)}`
	return [titleLine, metaLine]
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

async function handleSyncCommand(options) {
	const safeOptions = options || {}
	if (safeOptions.help) {
		handleHelpCommand({ topic: "sync" })
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
		await handleBatch({ includeTimestamps })
		return
	}
	throw new Error("Invalid sync arguments. Run `transcripts help sync` for details.")
}

async function handleListCommand(options) {
	const safeOptions = options || {}
	if (safeOptions.help) {
		handleHelpCommand({ topic: "list" })
		return
	}
	if (!reportOptionMessages(safeOptions)) {
		throw new Error("Unable to list transcripts. Fix the errors above and retry.")
	}
	const manifest = loadListeningStatusManifest(transcriptsDir)
	const catalogEntries = buildCatalogEntries(manifest)
	if (!catalogEntries || catalogEntries.length === 0) {
		console.log("[INFO] No transcripts found. Try running `transcripts --sync` first.")
		return
	}
	const sortedEntries = catalogEntries.slice().sort(compareCatalogEntriesDesc)
	const filteredEntries = filterCatalogEntries(sortedEntries, safeOptions.status)
	const pagination = paginateEntries(filteredEntries, safeOptions.page, safeOptions.limit)
	const { items, page, totalPages, total, limit } = pagination
	const format = safeOptions.format || "table"
	if (format === "json") {
		const payload = items.map((entry) => serializeCatalogEntry(entry))
		const response = {
			status: safeOptions.status || "all",
			page,
			limit,
			total,
			totalPages,
			count: payload.length,
			entries: payload,
		}
		console.log(JSON.stringify(response, null, 2))
		return
	}
	if (filteredEntries.length === 0) {
		const statusLabel = safeOptions.status && safeOptions.status !== "all" ? ` with status "${safeOptions.status}"` : ""
		console.log(`[INFO] No transcripts found${statusLabel}.`)
		return
	}
	printListLogHeader()
	const startIndex = page > 0 ? (page - 1) * limit : 0
	items.forEach((entry, index) => {
		console.log(formatListLogLine({ index: startIndex + index + 1, entry }))
	})
	const summaryParts = []
	if (total > 0) {
		summaryParts.push(`showing ${items.length} of ${total}`)
	}
	if (totalPages > 0) {
		summaryParts.push(`page ${page}/${totalPages}`)
	}
	if (safeOptions.status && safeOptions.status !== "all") {
		summaryParts.push(`status=${safeOptions.status}`)
	}
	console.log(`📄 [LIST] ${summaryParts.join(" | ")}`)
}

async function handleCopyCommand(options) {
	const safeOptions = options || {}
	if (safeOptions.help) {
		handleHelpCommand({ topic: "copy" })
		return
	}
	if (!reportOptionMessages(safeOptions)) {
		throw new Error("Unable to copy transcript. Resolve the errors above and retry.")
	}
	const manifest = loadListeningStatusManifest(transcriptsDir)
	const catalogEntries = buildCatalogEntries(manifest)
	if (!catalogEntries || catalogEntries.length === 0) {
		throw new Error("No transcripts indexed. Run `transcripts --sync` first.")
	}
	const target = findCatalogEntry(catalogEntries, safeOptions.key)
	if (!target) {
		throw new Error(`Unable to find a transcript matching "${safeOptions.key}".`)
	}
	if (!target.absolutePath || !target.hasMarkdown) {
		const identifier = target.normalizedRelativePath || target.relativePath || target.identifier || safeOptions.key
		throw new Error(`Transcript Markdown file not found for ${identifier}.`)
	}
	const location = target.normalizedRelativePath || target.relativePath || target.identifier
	let content = null
	try {
		content = await copyFileToClipboard(target.absolutePath)
		console.log(`📋 Copied transcript to clipboard: ${location}`)
	} catch (error) {
		console.warn(`[WARN] Clipboard copy failed: ${error.message}`)
		console.log(`📄 Transcript path: ${target.absolutePath}`)
		console.log("Hint: re-run with --print to dump the Markdown for manual copy.")
		if (!safeOptions.print) {
			return
		}
	}
	if (safeOptions.print) {
		if (!content) {
			content = await fs.promises.readFile(target.absolutePath, "utf8")
		}
		await printToStdout(content)
	}
}

async function handlePickCommand(options) {
	const safeOptions = options || {}
	if (safeOptions.help) {
		handleHelpCommand({ topic: "pick" })
		return
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("Interactive mode requires an interactive terminal (TTY).")
	}
	if (!reportOptionMessages(safeOptions)) {
		throw new Error("Unable to start interactive picker. Resolve the errors above and retry.")
	}
	const manifest = loadListeningStatusManifest(transcriptsDir)
	const catalogEntries = buildCatalogEntries(manifest)
	if (!catalogEntries || catalogEntries.length === 0) {
		console.log("[INFO] No transcripts found. Run `transcripts --sync` first.")
		return
	}
	const sortedEntries = catalogEntries.slice().sort(compareCatalogEntriesDesc)
	const filteredEntries = filterCatalogEntries(sortedEntries, safeOptions.status)
	if (filteredEntries.length === 0) {
		const statusLabel = safeOptions.status && safeOptions.status !== "all" ? ` with status "${safeOptions.status}"` : ""
		console.log(`[INFO] No transcripts available${statusLabel}.`)
		return
	}
	const pageSize = Math.max(parsePositiveInteger(safeOptions.pageSize) || DEFAULT_PICK_PAGE_SIZE, 1)
	const selectedEntry = await runInteractivePicker({
		entries: filteredEntries,
		pageSize,
		status: safeOptions.status,
	})
	if (!selectedEntry) {
		return
	}
	if (!selectedEntry.absolutePath || !selectedEntry.hasMarkdown) {
		throw new Error("Selected transcript is missing its Markdown file.")
	}
	try {
		await copyFileToClipboard(selectedEntry.absolutePath)
		const location = selectedEntry.normalizedRelativePath || selectedEntry.relativePath || selectedEntry.identifier
		console.log(`📋 Copied transcript to clipboard: ${location}`)
	} catch (error) {
		console.warn(`[WARN] Clipboard copy failed: ${error.message}`)
		console.log(`📄 Transcript path: ${selectedEntry.absolutePath}`)
		const promptRl = readline.createInterface({ input: process.stdin, output: process.stdout })
		try {
			const fallbackAnswer = await questionAsync(
				promptRl,
				"Print transcript content to stdout instead? (y/N): ",
			)
			if (fallbackAnswer.trim().toLowerCase().startsWith("y")) {
				const fallbackContent = await fs.promises.readFile(selectedEntry.absolutePath, "utf8")
				await printToStdout(fallbackContent)
			}
		} finally {
			promptRl.close()
		}
	}
}

async function runInteractivePicker({ entries, pageSize, status }) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
		readline.emitKeypressEvents(process.stdin, rl)
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true)
			process.stdin.resume()
		}
		let resolved = false
		const basePageSize = Math.max(parsePositiveInteger(pageSize) || DEFAULT_PICK_PAGE_SIZE, 1)
		let resolvedPageSize = basePageSize
		let cursorHidden = false
		const state = {
			cursor: 0,
			currentPage: 1,
			commandBuffer: "",
			statusMessage: null,
		}
		const getTerminalRows = () => {
			if (typeof process.stdout.rows === "number" && process.stdout.rows > 0) {
				return process.stdout.rows
			}
			return null
		}
		const computeResolvedPageSize = () => {
			const rows = getTerminalRows()
			if (!rows) {
				return basePageSize
			}
			const reservedLines = 7
			const linesPerEntry = 2
			const available = rows - reservedLines
			if (available <= 0) {
				return 1
			}
			const capacity = Math.floor(available / linesPerEntry)
			if (!Number.isFinite(capacity) || capacity < 1) {
				return 1
			}
			return Math.max(1, Math.min(basePageSize, capacity))
		}
		const hideCursor = () => {
			if (!cursorHidden) {
				rl.output.write("\u001B[?25l")
				cursorHidden = true
			}
		}
		const showCursor = () => {
			if (cursorHidden) {
				rl.output.write("\u001B[?25h")
				cursorHidden = false
			}
		}
		const cleanup = (result) => {
			if (resolved) {
				return
			}
			resolved = true
			process.stdin.removeListener("keypress", handleKeypress)
			process.stdout.removeListener("resize", handleResize)
			if (process.stdin.isTTY) {
				process.stdin.setRawMode(false)
				process.stdin.pause()
			}
			showCursor()
			rl.output.write("\n")
			rl.close()
			resolve(result)
		}
		const clampCursor = () => {
			if (entries.length === 0) {
				state.cursor = 0
				return
			}
			if (state.cursor < 0) {
				state.cursor = 0
			}
			if (state.cursor >= entries.length) {
				state.cursor = entries.length - 1
			}
		}
		const render = () => {
			clampCursor()
			const nextPageSize = computeResolvedPageSize()
			if (nextPageSize !== resolvedPageSize) {
				resolvedPageSize = nextPageSize
				state.currentPage = Math.floor(state.cursor / resolvedPageSize) + 1
			}
			const totalCount = entries.length
			const totalPages = Math.max(Math.ceil(totalCount / resolvedPageSize), 1)
			if (state.currentPage < 1) {
				state.currentPage = 1
			}
			if (state.currentPage > totalPages) {
				state.currentPage = totalPages
			}
			const expectedPage = Math.floor(state.cursor / resolvedPageSize) + 1
			if (expectedPage !== state.currentPage) {
				state.currentPage = expectedPage
			}
			const pagination = paginateEntries(entries, state.currentPage, resolvedPageSize)
			const { items, page, total, limit } = pagination
			let pageCount = pagination.totalPages || 1
			if (pageCount <= 0) {
				pageCount = 1
			}
			const startIndex = page > 0 ? (page - 1) * limit : 0
			const terminalWidth =
				typeof process.stdout.columns === "number" && process.stdout.columns > 0
					? process.stdout.columns
					: 80
			const indent = "  "
			const usableWidth = Math.max(terminalWidth - indent.length, 40)
			const indexWidth = Math.max(
				String(Math.max(total, entries.length, resolvedPageSize) || 0).length,
				2,
			)
			const lines = []
			lines.push(`${indent}Pick a transcript to copy`)
			const dividerWidth = Math.min(usableWidth, 48)
			lines.push(`${indent}${"-".repeat(dividerWidth)}`)
			if (items.length === 0) {
				lines.push("")
				lines.push(`${indent}[INFO] No entries on this page.`)
			} else {
				lines.push("")
				items.forEach((entry, index) => {
					const globalIndex = startIndex + index
					const entryLines = buildPickerEntryLines({
						entry,
						displayIndex: globalIndex + 1,
						isActive: state.cursor === globalIndex,
						indexWidth,
						maxWidth: usableWidth,
					})
					entryLines.forEach((line) => {
						lines.push(`${indent}${line}`)
					})
				})
			}
			lines.push("")
			const summaryParts = [`Page ${page}/${pageCount}`, `Total ${total}`]
			if (status && status !== "all") {
				summaryParts.push(`Filter ${status}`)
			}
			const typingLabel = state.commandBuffer ? ` | typing ${state.commandBuffer}` : ""
			lines.push(`${indent}${summaryParts.join(" | ")}${typingLabel}`)
			lines.push(
				`${indent}↑/↓ move  ←/→ page  n/p page  digits jump  Enter copy  q quit`,
			)
			if (state.statusMessage) {
				lines.push("")
				lines.push(`${indent}${state.statusMessage}`)
			}
			lines.push("")
			readline.cursorTo(rl.output, 0, 0)
			readline.clearScreenDown(rl.output)
			rl.output.write(lines.join("\n"))
		}
		const moveCursor = (delta) => {
			state.cursor += delta
			clampCursor()
			const nextPage = Math.floor(state.cursor / resolvedPageSize) + 1
			if (nextPage !== state.currentPage) {
				state.currentPage = nextPage
			}
		}
		const movePage = (delta) => {
			const totalPages = Math.max(Math.ceil(entries.length / resolvedPageSize), 1)
			const nextPage = Math.min(Math.max(state.currentPage + delta, 1), totalPages)
			if (nextPage === state.currentPage) {
				state.statusMessage = delta > 0 ? "[INFO] Already at the last page." : "[INFO] Already at the first page."
				return
			}
			state.currentPage = nextPage
			state.cursor = Math.min((state.currentPage - 1) * resolvedPageSize, entries.length - 1)
		}
		const selectIndex = (index) => {
			if (index < 0 || index >= entries.length) {
				state.statusMessage = `[WARN] Selection ${index + 1} is out of range (1-${entries.length}).`
				return
			}
			const target = entries[index]
			if (!target.absolutePath || !target.hasMarkdown) {
				const identifier =
					target.normalizedRelativePath ||
					target.relativePath ||
					target.identifier ||
					String(index + 1)
				state.statusMessage = `[ERROR] Markdown file not found for ${identifier}.`
				return
			}
			cleanup(target)
		}
		const handleKeypress = (str, key) => {
			if (resolved) {
				return
			}
			state.statusMessage = null
			if (key && key.ctrl && key.name === "c") {
				cleanup(null)
				return
			}
			if (key && key.name === "up") {
				state.commandBuffer = ""
				if (entries.length > 0 && state.cursor === 0) {
					state.statusMessage = "[INFO] Already at the first item."
				}
				moveCursor(-1)
				render()
				return
			}
			if (key && key.name === "down") {
				state.commandBuffer = ""
				if (entries.length > 0 && state.cursor === entries.length - 1) {
					state.statusMessage = "[INFO] Already at the last item."
				}
				moveCursor(1)
				render()
				return
			}
			if (key && (key.name === "left" || key.name === "pageup")) {
				state.commandBuffer = ""
				movePage(-1)
				render()
				return
			}
			if (key && (key.name === "right" || key.name === "pagedown")) {
				state.commandBuffer = ""
				movePage(1)
				render()
				return
			}
			if (key && key.name === "return") {
				if (state.commandBuffer) {
					const numeric = Number.parseInt(state.commandBuffer, 10)
					state.commandBuffer = ""
					if (Number.isNaN(numeric)) {
						state.statusMessage = "[WARN] Invalid numeric selection."
						render()
						return
					}
					selectIndex(numeric - 1)
					if (!resolved) {
						render()
					}
					return
				}
				selectIndex(state.cursor)
				if (!resolved) {
					render()
				}
				return
			}
			if (key && key.name === "escape") {
				cleanup(null)
				return
			}
			if (str) {
				const lower = str.toLowerCase()
				if (lower === "q") {
					cleanup(null)
					return
				}
				if (lower === "n") {
					state.commandBuffer = ""
					movePage(1)
					render()
					return
				}
				if (lower === "p") {
					state.commandBuffer = ""
					movePage(-1)
					render()
					return
				}
				if (str === "\u0008" || str === "\u007f" || (key && key.name === "backspace")) {
					if (state.commandBuffer.length > 0) {
						state.commandBuffer = state.commandBuffer.slice(0, -1)
						render()
					}
					return
				}
				if (/^[0-9]$/.test(str)) {
					state.commandBuffer += str
					render()
					return
				}
		}
		}
		process.stdin.on("keypress", handleKeypress)
		const handleResize = () => {
			if (!resolved) {
				render()
			}
		}
		process.stdout.on("resize", handleResize)
		hideCursor()
		render()
	})
}

function handleHelpCommand(options) {
	const topic = options && options.topic ? options.topic.toLowerCase() : "global"
	switch (topic) {
		case "sync":
			console.log("Usage: transcripts --sync [--no-timestamps]")
			console.log("       transcripts sync [--no-timestamps]")
			console.log("       transcripts sync <input.ttml> <output.md> [--no-timestamps]")
			console.log("")
			console.log("Options:")
			console.log("  --no-timestamps    Omit timestamp markers in generated Markdown.")
			console.log("  --timestamps       Include timestamp markers (default).")
			console.log("")
			console.log("Use --sync without additional arguments to scan the TTML cache and export every transcript as Markdown.")
			return
		case "list":
			console.log("Usage: transcripts list [--status <state>] [--limit <n>] [--page <n>] [--json]")
			console.log("")
			console.log("Options:")
			console.log("  --status <state>   Filter by play state (played, unplayed, in-progress, all). Default: all.")
			console.log("  --limit <n>        Number of rows per page (default: 20).")
			console.log("  --page <n>         Page number to display (default: 1).")
			console.log("  --json             Emit JSON output instead of the table view.")
			return
		case "copy":
			console.log("Usage: transcripts copy <identifier|relativePath> [--print]")
			console.log("")
			console.log("Arguments:")
			console.log("  identifier         TTML identifier as stored in the manifest.")
			console.log("  relativePath       Path under transcripts/ (e.g. show/file.md).")
			console.log("")
			console.log("Options:")
			console.log("  --print            Also print the Markdown to stdout after copying.")
			return
		case "pick":
		case "interactive":
			console.log("Usage: transcripts pick [--status <state>] [--page-size <n>]")
			console.log("")
			console.log("Options:")
			console.log("  --status <state>   Filter by play state before prompting (default: unplayed).")
			console.log("  --page-size <n>    Number of rows per page in the picker (default: 20).")
			console.log("")
			console.log("Interactive mode lets you browse transcripts and copy one to the clipboard.")
			return
		default:
			printUsage()
	}
}

function questionAsync(rl, prompt) {
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => {
			resolve(answer)
		})
	})
}

function buildCatalogEntries(manifest) {
	if (!manifest || !manifest.entries) {
		return []
	}
	return Object.values(manifest.entries).map((entry) => buildCatalogEntry(entry))
}

function buildCatalogEntry(entry) {
	const metadata = (entry && entry.metadata) || {}
	const showSlug = metadata.showSlug || null
	const episodeSlug = metadata.episodeSlug || null
	const relativePath = entry && entry.relativePath ? entry.relativePath : null
	const normalizedRelativePath = relativePath
		? relativePath.split(path.sep).join("/")
		: null
	const absolutePath = relativePath ? path.join(transcriptsDir, relativePath) : null
	const listeningStatus = metadata && metadata.listeningStatus ? metadata.listeningStatus : null
	const playState = normalizePlayState(
		(entry && entry.playState) || (listeningStatus ? listeningStatus.playState : null),
	)
	const showTitle = metadata && metadata.showTitle && metadata.showTitle !== "unknown show"
		? metadata.showTitle
		: showSlug
		? formatSlugAsTitle(showSlug)
		: "Unknown show"
	const baseEpisodeTitle = metadata && metadata.episodeTitle ? metadata.episodeTitle : null
	const fallbackEpisodeTitle = metadata && metadata.baseFileName
		? formatSlugAsTitle(metadata.baseFileName.split("_").slice(2).join("-") || metadata.baseFileName)
		: null
	const episodeTitle =
		baseEpisodeTitle ||
		fallbackEpisodeTitle ||
		normalizedRelativePath ||
		(entry && entry.identifier) ||
		"Unknown episode"
	const pubDate = metadata && metadata.pubDate ? metadata.pubDate : "unknown-date"
	const sortTimestamp = computeSortTimestamp(
		pubDate,
		(entry && entry.lastProcessedAt) || (entry && entry.lastUpdatedAt) || null,
	)
	const hasMarkdown = Boolean(absolutePath && fs.existsSync(absolutePath))
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
		playState,
		statusInfo: getStatusInfo(playState),
		sortTimestamp,
		hasMarkdown,
		lastProcessedAt: (entry && entry.lastProcessedAt) || null,
		lastUpdatedAt: (entry && entry.lastUpdatedAt) || null,
	}
}

function computeSortTimestamp(pubDate, fallbackIso) {
	if (pubDate && /^\d{4}-\d{2}-\d{2}$/.test(pubDate)) {
		const date = new Date(`${pubDate}T00:00:00.000Z`)
		if (!Number.isNaN(date.getTime())) {
			return date.getTime()
		}
	}
	if (fallbackIso) {
		const fallbackDate = new Date(fallbackIso)
		if (!Number.isNaN(fallbackDate.getTime())) {
			return fallbackDate.getTime()
		}
	}
	return 0
}

function compareCatalogEntriesDesc(a, b) {
	if (a.sortTimestamp !== b.sortTimestamp) {
		return b.sortTimestamp - a.sortTimestamp
	}
	const showCompare = (a.showTitle || "").localeCompare(b.showTitle || "", undefined, {
		sensitivity: "base",
	})
	if (showCompare !== 0) {
		return showCompare
	}
	const episodeCompare = (a.episodeTitle || "").localeCompare(
		b.episodeTitle || "",
		undefined,
		{ sensitivity: "base" },
	)
	if (episodeCompare !== 0) {
		return episodeCompare
	}
	return (a.identifier || "").localeCompare(b.identifier || "")
}

function filterCatalogEntries(entries, status) {
	if (!status || status === "all") {
		return entries.slice()
	}
	return entries.filter((entry) => {
		const state = normalizePlayState(entry.playState)
		if (status === "unplayed") {
			return state === "unplayed" || state === "inProgress"
		}
		if (status === "played") {
			return state === "played"
		}
		if (status === "inProgress") {
			return state === "inProgress"
		}
		return false
	})
}

function paginateEntries(entries, page, limit) {
	const safeLimit = Math.max(parsePositiveInteger(limit) || DEFAULT_LIST_LIMIT, 1)
	if (!entries || entries.length === 0) {
		return {
			items: [],
			total: 0,
			limit: safeLimit,
			page: 0,
			totalPages: 0,
		}
	}
	const total = entries.length
	const totalPages = Math.max(Math.ceil(total / safeLimit), 1)
	const desiredPage = parsePositiveInteger(page) || 1
	const clampedPage = Math.min(Math.max(desiredPage, 1), totalPages)
	const startIndex = (clampedPage - 1) * safeLimit
	const endIndex = Math.min(startIndex + safeLimit, total)
	return {
		items: entries.slice(startIndex, endIndex),
		total,
		limit: safeLimit,
		page: clampedPage,
		totalPages,
	}
}

function findCatalogEntry(entries, key) {
	if (!key || !entries || entries.length === 0) {
		return null
	}
	const trimmedKey = key.trim()
	if (!trimmedKey) {
		return null
	}
	const directMatch = entries.find((entry) => entry.identifier === trimmedKey)
	if (directMatch) {
		return directMatch
	}
	const normalizedKey = trimmedKey
		.replace(/^\.\//, "")
		.replace(/^transcripts\//, "")
		.split(path.sep)
		.join("/")
	const relativeMatch = entries.find((entry) => entry.normalizedRelativePath === normalizedKey)
	if (relativeMatch) {
		return relativeMatch
	}
	const baseName = path.basename(normalizedKey)
	const baseNameNoExt = baseName.endsWith(".md") ? baseName.slice(0, -3) : baseName
	const filenameMatch = entries.find((entry) => {
		if (!entry.relativePath) {
			return false
		}
		return path.basename(entry.relativePath) === baseName ||
			(entry.metadata && entry.metadata.baseFileName === baseNameNoExt)
	})
	if (filenameMatch) {
		return filenameMatch
	}
	const slugMatch = entries.find((entry) => entry.metadata && entry.metadata.baseFileName === trimmedKey)
	if (slugMatch) {
		return slugMatch
	}
	return null
}

async function copyFileToClipboard(filePath) {
	if (!filePath) {
		throw new Error("Cannot copy transcript: file path is missing.")
	}
	const content = await fs.promises.readFile(filePath, "utf8")
	await writeToClipboard(content)
	return content
}

function writeToClipboard(content) {
	return new Promise((resolve, reject) => {
		let command = null
		let args = []
		if (process.platform === "darwin") {
			command = "pbcopy"
		} else if (process.platform === "win32") {
			command = "clip"
		} else {
			command = "xclip"
			args = ["-selection", "clipboard"]
		}
		let child
		try {
			child = spawn(command, args)
		} catch (error) {
			reject(new Error(`Unable to access clipboard utility (${command}): ${error.message}`))
			return
		}
		child.on("error", (error) => {
			reject(new Error(`Clipboard command failed (${command}): ${error.message}`))
		})
		if (!child.stdin) {
			reject(new Error("Clipboard command does not expose stdin."))
			return
		}
		child.stdin.on("error", (error) => {
			reject(new Error(`Unable to write to clipboard: ${error.message}`))
		})
		child.on("close", (code) => {
			if (code === 0) {
				resolve()
				return
			}
			reject(new Error(`Clipboard command exited with code ${code}`))
		})
		child.stdin.end(content)
	})
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
		relativePath: entry.normalizedRelativePath || entry.relativePath || null,
		absolutePath: entry.absolutePath || null,
		hasMarkdown: Boolean(entry.hasMarkdown),
		lastProcessedAt: entry.lastProcessedAt || null,
		lastUpdatedAt: entry.lastUpdatedAt || null,
	}
}

function printToStdout(content) {
	return new Promise((resolve, reject) => {
		const handleError = (error) => {
			process.stdout.off("error", handleError)
			if (error && error.code === "EPIPE") {
				resolve()
				return
			}
			reject(error)
		}
		process.stdout.on("error", handleError)
		const finalize = () => {
			process.stdout.off("error", handleError)
			resolve()
		}
		const canContinue = process.stdout.write(content, finalize)
		if (!canContinue) {
			process.stdout.once("drain", finalize)
		}
	})
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

	for (const file of sortedTtmlFiles) {
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
	console.log("Usage:")
	console.log("  transcripts [--status <state>] [--page-size <n>]")
	console.log("  transcripts pick [--status <state>] [--page-size <n>]")
	console.log("  transcripts --sync [--no-timestamps]")
	console.log("  transcripts sync <input.ttml> <output.md> [--no-timestamps]")
	console.log("  transcripts list [--status <state>] [--limit <n>] [--page <n>] [--json]")
	console.log("  transcripts copy <identifier|relativePath> [--print]")
	console.log("")
	console.log("Run transcripts help <command> for command-specific options.")
}

async function main() {
	ensureTranscriptsDirectory()
	const parsed = parseCliArguments(process.argv.slice(2))
	const command = parsed.command || "pick"
	const options = parsed.options || {}
	switch (command) {
		case "sync":
			await handleSyncCommand(options)
			if (options && options.launchPickerAfterSync) {
				if (!process.stdin.isTTY || !process.stdout.isTTY) {
					console.log("[INFO] Sync complete. Run `transcripts` from an interactive terminal to browse.")
				} else {
					console.log("")
					console.log("[INFO] Sync complete. Opening picker...")
					const pickDefaults = parsePickOptions([])
					await handlePickCommand(pickDefaults)
				}
			}
			return
		case "list":
			await handleListCommand(options)
			return
		case "copy":
			await handleCopyCommand(options)
			return
		case "pick":
			await handlePickCommand(options)
			return
		case "help":
			handleHelpCommand(options)
			return
		default:
			console.error(`Unknown command: ${command}`)
			printUsage()
			process.exit(1)
	}
}

main().catch((error) => {
	const message = error && error.message ? error.message : String(error)
	console.error(message)
	process.exit(1)
})
