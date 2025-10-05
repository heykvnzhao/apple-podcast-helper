const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")

const { formatCocoaDate, slugify, truncateSlug } = require("./format-transcript-fields")

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

module.exports = {
	loadTranscriptMetadata,
	buildMetadataFilenameIndex,
	resolveMetadataForFile,
}
