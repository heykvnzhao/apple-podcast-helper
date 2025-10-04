const fs = require("fs")
const xml2js = require("xml2js")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")

const COCOA_EPOCH_MS = Date.UTC(2001, 0, 1)

function formatTimestamp(seconds) {
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = Math.floor(seconds % 60)

	return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

function extractTranscript(ttmlContent, outputPath, includeTimestamps = false) {
	const parser = new xml2js.Parser()

	parser.parseString(ttmlContent, (err, result) => {
		if (err) {
			throw err
		}

		let transcript = []

		function extractTextFromSpans(spans) {
			let text = ""
			spans.forEach((span) => {
				if (span.span) {
					text += extractTextFromSpans(span.span)
				} else if (span._) {
					text += span._ + " "
				}
			})
			return text
		}

		const paragraphs = result.tt.body[0].div[0].p

		paragraphs.forEach((paragraph) => {
			if (paragraph.span) {
				const paragraphText = extractTextFromSpans(paragraph.span).trim()
				if (paragraphText) {
					if (includeTimestamps && paragraph.$ && paragraph.$.begin) {
						const timestamp = formatTimestamp(parseFloat(paragraph.$.begin))
						transcript.push(`[${timestamp}] ${paragraphText}`)
					} else {
						transcript.push(paragraphText)
					}
				}
			}
		})

		const outputText = transcript.join("\n\n")
		fs.writeFileSync(outputPath, outputText)
		console.log(`Transcript saved to ${outputPath}`)
	})
}

function transcriptIdentifierFromRelativePath(relativePath) {
	const normalized = relativePath.split(path.sep).join("/")
	const index = normalized.indexOf(".ttml")
	return index === -1 ? normalized : normalized.slice(0, index + ".ttml".length)
}

function findTTMLFiles(dir, baseDir = dir) {
	const files = fs.readdirSync(dir)
	let ttmlFiles = []

	files.forEach((file) => {
		const fullPath = path.join(dir, file)
		const stat = fs.statSync(fullPath)

		if (stat.isDirectory()) {
			ttmlFiles = ttmlFiles.concat(findTTMLFiles(fullPath, baseDir))
		} else if (path.extname(fullPath) === ".ttml") {
			const relative = path.relative(baseDir, fullPath)
			ttmlFiles.push({
				path: fullPath,
				identifier: transcriptIdentifierFromRelativePath(relative),
			})
		}
	})

	return ttmlFiles
}

function slugify(value, fallback = "unknown") {
	if (!value || typeof value !== "string") {
		return fallback
	}
	const cleaned = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-zA-Z0-9\s-]/g, "")
		.trim()
		.replace(/[\s_-]+/g, "-")
		.replace(/-+/g, "-")
		.toLowerCase()
	return cleaned || fallback
}

function truncateSlug(slug, maxLength) {
	if (slug.length <= maxLength) {
		return slug
	}
	const truncated = slug.slice(0, maxLength).replace(/-+$/g, "")
	return truncated || slug.slice(0, maxLength)
}

function formatCocoaDate(seconds, fallback = "unknown-date") {
	if (typeof seconds !== "number" || Number.isNaN(seconds)) {
		return fallback
	}
	const unixMs = COCOA_EPOCH_MS + seconds * 1000
	if (!Number.isFinite(unixMs)) {
		return fallback
	}
	const date = new Date(unixMs)
	if (Number.isNaN(date.getTime())) {
		return fallback
	}
	const year = date.getUTCFullYear()
	const month = `${date.getUTCMonth() + 1}`.padStart(2, "0")
	const day = `${date.getUTCDate()}`.padStart(2, "0")
	return `${year}-${month}-${day}`
}

function loadTranscriptMetadata() {
	const dbPath = path.join(
		os.homedir(),
		"Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite",
	)

	if (!fs.existsSync(dbPath)) {
		console.warn(
			`Metadata database not found at ${dbPath}. Output filenames will use fallback identifiers.`,
		)
		return new Map()
	}

	const query = [
		"SELECT",
		"  episode.ZTRANSCRIPTIDENTIFIER AS transcript_identifier,",
		"  episode.ZFREETRANSCRIPTIDENTIFIER AS free_transcript_identifier,",
		"  episode.ZENTITLEDTRANSCRIPTIDENTIFIER AS entitled_transcript_identifier,",
		"  episode.ZTITLE AS episode_title,",
		"  episode.ZPUBDATE AS pub_date,",
		"  podcast.ZTITLE AS show_title",
		"FROM ZMTEPISODE episode",
		"LEFT JOIN ZMTPODCAST podcast ON episode.ZPODCAST = podcast.Z_PK",
		"WHERE episode.ZTRANSCRIPTIDENTIFIER IS NOT NULL",
		"   OR episode.ZFREETRANSCRIPTIDENTIFIER IS NOT NULL",
		"   OR episode.ZENTITLEDTRANSCRIPTIDENTIFIER IS NOT NULL;",
	].join(" ")

	const result = spawnSync("sqlite3", ["-readonly", "-json", dbPath, query], {
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	})

	if (result.error) {
		console.warn(
			`Unable to load transcript metadata: ${result.error.message}. Filenames will use fallback identifiers.`,
		)
		return new Map()
	}

	if (result.status !== 0) {
		console.warn(
			`sqlite3 returned non-zero status (${result.status}). Output filenames will use fallback identifiers.`,
		)
		if (result.stderr) {
			console.warn(result.stderr.trim())
		}
		return new Map()
	}

	let rows
	try {
		rows = JSON.parse(result.stdout || "[]")
	} catch (parseError) {
		console.warn(
			"Failed to parse transcript metadata. Output filenames will use fallback identifiers.",
		)
		return new Map()
	}

	const metadataMap = new Map()

	rows.forEach((row) => {
		const metadata = {
			showTitle: row.show_title || "unknown show",
			episodeTitle: row.episode_title || "unknown episode",
			pubDate: formatCocoaDate(row.pub_date),
		}
		;[
			row.transcript_identifier,
			row.free_transcript_identifier,
			row.entitled_transcript_identifier,
		].forEach((identifier) => {
			if (identifier) {
				metadataMap.set(identifier, metadata)
			}
		})
	})

	return metadataMap
}

function convertExistingTxtTranscripts(directoryPath) {
	if (!fs.existsSync(directoryPath)) {
		return
	}

	const entries = fs.readdirSync(directoryPath, { withFileTypes: true })

	entries.forEach((entry) => {
		if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".txt") {
			const sourcePath = path.join(directoryPath, entry.name)
			const destinationPath = path.join(
				directoryPath,
				`${path.basename(entry.name, ".txt")}.md`,
			)
			const content = fs.readFileSync(sourcePath, "utf8")
			fs.writeFileSync(destinationPath, content)
			fs.unlinkSync(sourcePath)
		}
	})
}

function moveMarkdownTranscriptsIntoShowDirectories(directoryPath) {
	if (!fs.existsSync(directoryPath)) {
		return
	}

	const entries = fs.readdirSync(directoryPath, { withFileTypes: true })

	entries.forEach((entry) => {
		if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
			return
		}

		const showSlug = entry.name.split("_")[0] || "unknown-show"
		const showDir = path.join(directoryPath, showSlug)
		if (!fs.existsSync(showDir)) {
			fs.mkdirSync(showDir, { recursive: true })
		}

		const currentPath = path.join(directoryPath, entry.name)
		const targetPath = path.join(showDir, entry.name)
		if (currentPath !== targetPath) {
			fs.renameSync(currentPath, targetPath)
		}
	})
}

function ensureShowOutputDirectory(baseDirectory, showSlug) {
	const directoryPath = path.join(baseDirectory, showSlug)
	if (!fs.existsSync(directoryPath)) {
		fs.mkdirSync(directoryPath, { recursive: true })
	}
	return directoryPath
}

// Create output directory if it doesn't exist
if (!fs.existsSync("./transcripts")) {
	fs.mkdirSync("./transcripts")
}

const includeTimestamps = process.argv.includes("--timestamps")

if (process.argv.length >= 4 && !includeTimestamps) {
	// Individual file mode
	const inputPath = process.argv[2]
	const outputPath = process.argv[3]
	fs.readFile(inputPath, "utf8", (err, data) => {
		if (err) {
			console.error(err)
			return
		}
		extractTranscript(data, outputPath, includeTimestamps)
	})
} else if (process.argv.length === 2 || (process.argv.length === 3 && includeTimestamps)) {
	// Batch mode - process all TTML files
	const ttmlBaseDir = path.join(os.homedir(), "Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML")

	if (!fs.existsSync(ttmlBaseDir)) {
		console.error(`TTML directory not found at ${ttmlBaseDir}`)
		process.exit(1)
	}

	console.log("Searching for TTML files...")
	const ttmlFiles = findTTMLFiles(ttmlBaseDir, ttmlBaseDir)

	console.log(`Found ${ttmlFiles.length} TTML files`)

	const metadataMap = loadTranscriptMetadata()
	const filenameCounts = new Map()

	convertExistingTxtTranscripts("./transcripts")
	moveMarkdownTranscriptsIntoShowDirectories("./transcripts")

	ttmlFiles.forEach((file) => {
		const metadata = metadataMap.get(file.identifier) || null
		const showSlug = slugify(metadata ? metadata.showTitle : null, "unknown-show")
		const episodeSlug = truncateSlug(
			slugify(metadata ? metadata.episodeTitle : path.basename(file.identifier, ".ttml"), "episode"),
			20,
		)
		const dateSegment = metadata ? metadata.pubDate : "unknown-date"
		const baseName = `${showSlug}_${dateSegment}_${episodeSlug}`
		const count = filenameCounts.get(baseName) || 0
		const suffix = count === 0 ? "" : `-${count}`
		filenameCounts.set(baseName, count + 1)

		const outputDir = ensureShowOutputDirectory("./transcripts", showSlug)
		const outputPath = path.join(outputDir, `${baseName}${suffix}.md`)
		const data = fs.readFileSync(file.path, "utf8")
		extractTranscript(data, outputPath, includeTimestamps)
	})
} else {
	console.error("Invalid arguments.")
	console.error("Usage:")
	console.error("  For single file: node extractTranscript.js <input.ttml> <output.md> [--timestamps]")
	console.error("  For all files: node extractTranscript.js [--timestamps]")
	process.exit(1)
}
