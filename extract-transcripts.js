const fs = require("fs")
const path = require("path")
const os = require("os")

const { extractTranscript } = require("./lib/parse-ttml-transcript")
const { slugify, truncateSlug } = require("./lib/format-transcript-fields")
const {
	loadTranscriptMetadata,
	buildMetadataFilenameIndex,
} = require("./lib/load-podcast-metadata")
const {
	findTTMLFiles,
	convertExistingTxtTranscripts,
	moveMarkdownTranscriptsIntoShowDirectories,
	ensureShowOutputDirectory,
	resolveFallbackContext,
	updateExistingMarkdownFiles,
} = require("./lib/manage-transcript-files")

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

async function handleSingleFile(includeTimestamps) {
	const inputPath = process.argv[2]
	const outputPath = process.argv[3]
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
		console.log(`Transcript saved to ${outputPath}`)
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

function prepareExistingMarkdown(metadataFilenameIndex) {
	convertExistingTxtTranscripts(transcriptsDir)
	moveMarkdownTranscriptsIntoShowDirectories(transcriptsDir)
	updateExistingMarkdownFiles(transcriptsDir, metadataFilenameIndex)
}

function resolveOutputPath({ filenameCounts, showSlug, dateSegment, episodeSlug }) {
	const baseName = `${showSlug}_${dateSegment}_${episodeSlug}`
	const count = filenameCounts.get(baseName) || 0
	const suffix = count === 0 ? "" : `-${count}`
	filenameCounts.set(baseName, count + 1)

	const outputDir = ensureShowOutputDirectory(transcriptsDir, showSlug)
	return path.join(outputDir, `${baseName}${suffix}.md`)
}

async function handleBatch(includeTimestamps) {
	ensureTtmlCachePresent()
	console.log("Searching for TTML files...")

	const ttmlFiles = findTTMLFiles(ttmlCacheDir, ttmlCacheDir)
	console.log(`Found ${ttmlFiles.length} TTML files`)

	const metadataMap = loadTranscriptMetadata(ttmlFiles.map((file) => file.identifier))
	const metadataFilenameIndex = buildMetadataFilenameIndex(metadataMap)
	const filenameCounts = new Map()

	prepareExistingMarkdown(metadataFilenameIndex)

	for (const file of ttmlFiles) {
		const metadata = metadataMap.get(file.identifier) || null
		const showSlug = slugify(metadata ? metadata.showTitle : null, "unknown-show")
		const rawEpisodeTitle = metadata ? metadata.episodeTitle : path.basename(file.identifier, ".ttml")
		const episodeSlug = truncateSlug(slugify(rawEpisodeTitle, "episode"), 20)
		const dateSegment = metadata ? metadata.pubDate : "unknown-date"
		const outputPath = resolveOutputPath({
			filenameCounts,
			showSlug,
			dateSegment,
			episodeSlug,
		})
		const fallbackContext = {
			showSlug,
			dateSegment,
		}

		const data = await fs.promises.readFile(file.path, "utf8")
		const markdown = await extractTranscript(data, {
			includeTimestamps,
			metadata,
			fallbackContext,
		})
		await fs.promises.writeFile(outputPath, markdown)
		console.log(`Transcript saved to ${outputPath}`)
	}
}

function printUsage() {
	console.error("Invalid arguments.")
	console.error("Usage:")
	console.error("  For single file: node extractTranscript.js <input.ttml> <output.md> [--timestamps]")
	console.error("  For all files: node extractTranscript.js [--timestamps]")
}

async function main() {
	ensureTranscriptsDirectory()
	const includeTimestamps = process.argv.includes("--timestamps")

	if (process.argv.length >= 4 && !includeTimestamps) {
		await handleSingleFile(includeTimestamps)
		return
	}

	if (process.argv.length === 2 || (process.argv.length === 3 && includeTimestamps)) {
		await handleBatch(includeTimestamps)
		return
	}

	printUsage()
	process.exit(1)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
