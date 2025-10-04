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

function extractTranscript(ttmlContent, outputPath, options = {}) {
	const { includeTimestamps = false, metadata = null, fallbackContext = null } = options
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

		const transcriptText = transcript.join("\n\n")
		const outputText = buildEpisodeMarkdown(transcriptText, metadata, fallbackContext)
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

function loadTranscriptMetadata(requestedIdentifiers = []) {
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

	const uniqueIdentifiers = Array.from(new Set(requestedIdentifiers.filter(Boolean)))
	if (uniqueIdentifiers.length === 0) {
		return new Map()
	}

	const baseQuery = [
		"SELECT",
		"  episode.ZTRANSCRIPTIDENTIFIER AS transcript_identifier,",
		"  episode.ZFREETRANSCRIPTIDENTIFIER AS free_transcript_identifier,",
		"  episode.ZENTITLEDTRANSCRIPTIDENTIFIER AS entitled_transcript_identifier,",
		"  episode.ZTITLE AS episode_title,",
		"  episode.ZPUBDATE AS pub_date,",
		"  episode.ZITEMDESCRIPTION AS item_description,",
		"  episode.ZITEMDESCRIPTIONWITHOUTHTML AS item_description_without_html,",
		"  podcast.ZTITLE AS show_title",
		"FROM ZMTEPISODE episode",
		"LEFT JOIN ZMTPODCAST podcast ON episode.ZPODCAST = podcast.Z_PK",
	].join(" ")

	const metadataMap = new Map()
	const chunkSize = 200

	for (let i = 0; i < uniqueIdentifiers.length; i += chunkSize) {
		const chunk = uniqueIdentifiers.slice(i, i + chunkSize)
		const quotedIdentifiers = chunk
			.map((identifier) => `'${identifier.replaceAll("'", "''")}'`)
			.join(",")
		const whereClause = [
			`episode.ZTRANSCRIPTIDENTIFIER IN (${quotedIdentifiers})`,
			`episode.ZFREETRANSCRIPTIDENTIFIER IN (${quotedIdentifiers})`,
			`episode.ZENTITLEDTRANSCRIPTIDENTIFIER IN (${quotedIdentifiers})`,
		].join(" OR ")
		const query = `${baseQuery} WHERE ${whereClause};`

		const result = spawnSync("sqlite3", ["-readonly", "-json", dbPath, query], {
			encoding: "utf8",
			maxBuffer: 50 * 1024 * 1024,
		})

		if (result.error) {
			console.warn(
				`Unable to load transcript metadata: ${result.error.message}. Filenames will use fallback identifiers.`,
			)
			return metadataMap
		}

		if (result.status !== 0) {
			console.warn(
				`sqlite3 returned non-zero status (${result.status}). Output filenames will use fallback identifiers.`,
			)
			if (result.stderr) {
				console.warn(result.stderr.trim())
			}
			return metadataMap
		}

		let rows
		try {
			rows = JSON.parse(result.stdout || "[]")
		} catch (parseError) {
			console.warn(
				"Failed to parse transcript metadata. Output filenames will use fallback identifiers.",
			)
			return metadataMap
		}

		rows.forEach((row) => {
			const showTitle = row.show_title || "unknown show"
			const episodeTitle = row.episode_title || "unknown episode"
			const pubDate = formatCocoaDate(row.pub_date)
			const showSlug = slugify(showTitle, "unknown-show")
			const episodeSlug = truncateSlug(slugify(episodeTitle, "episode"), 20)
			const baseFileName = `${showSlug}_${pubDate}_${episodeSlug}`
			const metadata = {
				showTitle,
				episodeTitle,
				pubDate,
				showSlug,
				episodeSlug,
				baseFileName,
				episodeDescriptionHtml: row.item_description || "",
				episodeDescriptionText: row.item_description_without_html || "",
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
	}

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

function decodeHtmlEntities(text) {
	if (!text || typeof text !== "string") {
		return ""
	}

	const namedEntities = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		ndash: "–",
		mdash: "—",
		lsquo: "‘",
		rsquo: "’",
		ldquo: "“",
		rdquo: "”",
		hellip: "…",
		copy: "©",
		reg: "®",
		tm: "™",
	}

	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
		if (entity[0] === "#") {
			const isHex = entity[1] === "x" || entity[1] === "X"
			const codePoint = isHex
				? parseInt(entity.slice(2), 16)
				: parseInt(entity.slice(1), 10)
			if (!Number.isNaN(codePoint)) {
				return String.fromCodePoint(codePoint)
			}
			return match
		}

		const key = entity.toLowerCase()
		if (Object.prototype.hasOwnProperty.call(namedEntities, key)) {
			return namedEntities[key]
		}
		return match
	})
}

function convertHtmlToMarkdown(html) {
	if (!html || typeof html !== "string") {
		return ""
	}

	let text = html.replace(/\r\n/g, "\n")

	text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, inner) => {
		const innerMarkdown = convertHtmlToMarkdown(inner).trim() || href.trim()
		return `[${innerMarkdown}](${href.trim()})`
	})

	text = text.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (match, _tag, inner) => `**${convertHtmlToMarkdown(inner).trim()}**`)
	text = text.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (match, _tag, inner) => `*${convertHtmlToMarkdown(inner).trim()}*`)
	text = text.replace(/<(u)>([\s\S]*?)<\/\1>/gi, (match, _tag, inner) => `_${convertHtmlToMarkdown(inner).trim()}_`)
	text = text.replace(/<(code)>([\s\S]*?)<\/\1>/gi, (match, _tag, inner) => `\`${convertHtmlToMarkdown(inner).trim()}\``)

	text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (match, inner) => {
		const listItem = convertHtmlToMarkdown(inner).trim()
		return listItem ? `- ${listItem}\n` : ""
	})
	text = text.replace(/<\/(ul|ol)>/gi, "\n")
	text = text.replace(/<(ul|ol)[^>]*>/gi, "\n")

	text = text.replace(/<\s*br\s*\/?>/gi, "\n")
	text = text.replace(/<\/p>/gi, "\n\n")
	text = text.replace(/<p[^>]*>/gi, "")

	text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (match, level, inner) => {
		const hashes = "#".repeat(Math.max(1, Math.min(6, parseInt(level, 10))))
		return `\n${hashes} ${convertHtmlToMarkdown(inner).trim()}\n`
	})

	text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, inner) => {
		const quote = convertHtmlToMarkdown(inner).trim()
		if (!quote) {
			return ""
		}
		return quote
			.split(/\r?\n/)
			.map((line) => `> ${line}`)
			.join("\n")
	})

	text = text.replace(/<table[\s\S]*?<\/table>/gi, (match) => convertHtmlToMarkdown(match.replace(/<\/?(table|tbody|thead|tfoot)>/gi, "")))
	text = text.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (match, inner) => convertHtmlToMarkdown(inner) + "\n")
	text = text.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, (match, inner) => `${convertHtmlToMarkdown(inner).trim()}\t`)

	text = text.replace(/<\/?.*?>/g, "")
	text = decodeHtmlEntities(text)
	text = text.replace(/\u00a0/g, " ")
	text = text.replace(/[ \t]+\n/g, "\n")
	text = text.replace(/\n{3,}/g, "\n\n")

	return text.trim()
}

function getEpisodeDescriptionMarkdown(metadata) {
	if (!metadata) {
		return ""
	}
	if (metadata.episodeDescriptionHtml) {
		const markdown = convertHtmlToMarkdown(metadata.episodeDescriptionHtml)
		if (markdown) {
			return markdown
		}
	}
	if (metadata.episodeDescriptionText) {
		const plain = metadata.episodeDescriptionText.trim()
		if (plain) {
			return plain
		}
	}
	return ""
}

function formatSlugAsTitle(slug) {
	if (!slug) {
		return ""
	}
	return slug
		.split("-")
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}

function resolveFallbackContext(baseName, directorySlug) {
	const parts = (baseName || "").split("_")
	const baseShowSlug = parts.length > 0 ? parts[0] : ""
	const dateSegment = parts.length > 1 ? parts[1] : ""
	const showSlug =
		directorySlug && directorySlug !== "transcripts"
			? directorySlug
			: baseShowSlug
	return {
		showSlug,
		dateSegment,
	}
}

function buildEpisodeMarkdown(transcriptText, metadata, fallbackContext = {}) {
	const safeMetadata = metadata || {}
	const effectiveFallbackContext = fallbackContext || {}
	const fallbackShowSlug =
		effectiveFallbackContext.showSlug || safeMetadata.showSlug || ""
	const fallbackShowName =
		safeMetadata.showTitle && safeMetadata.showTitle !== "unknown show"
			? safeMetadata.showTitle
			: effectiveFallbackContext.showName || formatSlugAsTitle(fallbackShowSlug) || "Unknown show"
	const fallbackDateSegment =
		safeMetadata.pubDate && safeMetadata.pubDate !== "unknown-date"
			? safeMetadata.pubDate
			: effectiveFallbackContext.dateSegment || "unknown-date"
	const description = getEpisodeDescriptionMarkdown(safeMetadata)
	const descriptionSection = [
		"## Episode description",
		`Show name: ${fallbackShowName}`,
		`Episode date: ${fallbackDateSegment}`,
		"Episode description:",
		description || "Not available.",
	].join("\n")
	const transcriptSectionHeader = "## Episode transcript"
	const transcriptSectionBody = transcriptText && transcriptText.trim() ? transcriptText.trim() : "Not available."

	const output = [descriptionSection, transcriptSectionHeader, transcriptSectionBody]
		.filter((section) => section && section.trim() !== "")
		.join("\n\n")

	return `${output.trimEnd()}\n`
}

function buildMetadataFilenameIndex(metadataMap) {
	const index = new Map()
	metadataMap.forEach((metadata) => {
		if (!metadata || !metadata.baseFileName) {
			return
		}
		if (!index.has(metadata.baseFileName)) {
			index.set(metadata.baseFileName, [])
		}
		index.get(metadata.baseFileName).push(metadata)
	})
	return index
}

function resolveMetadataForFile(metadataIndex, fileBaseName) {
	if (!metadataIndex) {
		return null
	}
	if (metadataIndex.has(fileBaseName)) {
		const list = metadataIndex.get(fileBaseName)
		if (list.length > 0) {
			return list[0]
		}
	}
	const suffixMatch = fileBaseName.match(/^(.*?)-(\d+)$/)
	if (suffixMatch) {
		const baseKey = suffixMatch[1]
		const index = parseInt(suffixMatch[2], 10)
		if (metadataIndex.has(baseKey)) {
			const list = metadataIndex.get(baseKey)
			if (index >= 0 && index < list.length) {
				return list[index]
			}
		}
	}
	return null
}

function updateExistingMarkdownFiles(directoryPath, metadataIndex) {
	if (!fs.existsSync(directoryPath)) {
		return
	}

	const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
	entries.forEach((entry) => {
		const fullPath = path.join(directoryPath, entry.name)
		if (entry.isDirectory()) {
			updateExistingMarkdownFiles(fullPath, metadataIndex)
			return
		}
		if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
			return
		}

		const currentContent = fs.readFileSync(fullPath, "utf8")
		const baseName = path.basename(entry.name, ".md")
		const metadata = resolveMetadataForFile(metadataIndex, baseName)
		const parentDirSlug = path.basename(directoryPath)
		const fallbackContext = resolveFallbackContext(baseName, parentDirSlug)
		let transcriptBody = currentContent.trim()
		const transcriptHeadingIndex = currentContent.indexOf("## Episode transcript")
		if (transcriptHeadingIndex !== -1) {
			const afterHeading = currentContent.slice(
				transcriptHeadingIndex + "## Episode transcript".length,
			)
			transcriptBody = afterHeading.replace(/^\s+/, "").trim()
		}
		const updatedContent = buildEpisodeMarkdown(transcriptBody, metadata, fallbackContext)
		fs.writeFileSync(fullPath, updatedContent)
	})
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
		const baseName = path.basename(outputPath, path.extname(outputPath))
		const parentDirSlug = path.basename(path.dirname(outputPath))
		const fallbackContext = resolveFallbackContext(baseName, parentDirSlug)
		extractTranscript(data, outputPath, { includeTimestamps, fallbackContext })
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

	const metadataMap = loadTranscriptMetadata(ttmlFiles.map((file) => file.identifier))
	const metadataFilenameIndex = buildMetadataFilenameIndex(metadataMap)
	const filenameCounts = new Map()

	convertExistingTxtTranscripts("./transcripts")
	moveMarkdownTranscriptsIntoShowDirectories("./transcripts")
	updateExistingMarkdownFiles("./transcripts", metadataFilenameIndex)

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
		const fallbackContext = {
			showSlug,
			dateSegment,
		}
		extractTranscript(data, outputPath, {
			includeTimestamps,
			metadata,
			fallbackContext,
		})
	})
} else {
	console.error("Invalid arguments.")
	console.error("Usage:")
	console.error("  For single file: node extractTranscript.js <input.ttml> <output.md> [--timestamps]")
	console.error("  For all files: node extractTranscript.js [--timestamps]")
	process.exit(1)
}
