const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")

const {
	formatCocoaDate,
	formatCocoaDateTime,
	slugify,
	truncateSlug,
} = require("./format-transcript-fields")

function clamp01(value) {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return null
	}
	if (value < 0) {
		return 0
	}
	if (value > 1) {
		return 1
	}
	return value
}

function buildListeningStatus(row) {
	const rawState = typeof row.play_state === "number" ? row.play_state : null
	const playHeadSeconds =
		typeof row.play_head_seconds === "number" && Number.isFinite(row.play_head_seconds)
			? row.play_head_seconds
			: null
	const durationSeconds =
		typeof row.duration_seconds === "number" && Number.isFinite(row.duration_seconds)
			? row.duration_seconds
			: null
	const lastPlayedIso = formatCocoaDateTime(row.last_played_date)
	const playCount =
		typeof row.play_count === "number" && Number.isFinite(row.play_count)
			? row.play_count
			: null

	let playState = "unplayed"
	if (rawState === 0) {
		playState = "played"
	} else if (rawState === 1) {
		playState = "inProgress"
	} else if (rawState === 2) {
		playState = "unplayed"
	}

	const listenedSeconds =
		playState === "played"
			? durationSeconds
			: playHeadSeconds
	const completionRatio =
		listenedSeconds != null && durationSeconds
			? clamp01(listenedSeconds / durationSeconds)
			: playState === "played"
				? 1
				: null
	const remainingSeconds =
		listenedSeconds != null && durationSeconds
			? Math.max(durationSeconds - listenedSeconds, 0)
			: null

	if (rawState == null && playHeadSeconds == null && durationSeconds == null) {
		return null
	}

	return {
		playState,
		playStateRaw: rawState,
		playCount,
		progressSeconds: playHeadSeconds,
		listenedSeconds,
		durationSeconds,
		completionRatio,
		remainingSeconds,
		lastPlayedAt: lastPlayedIso,
		lastPlayedAtRawSeconds:
			typeof row.last_played_date === "number" ? row.last_played_date : null,
	}
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
		"  episode.Z_PK AS episode_pk,",
		"  episode.ZTRANSCRIPTIDENTIFIER AS transcript_identifier,",
		"  episode.ZFREETRANSCRIPTIDENTIFIER AS free_transcript_identifier,",
		"  episode.ZENTITLEDTRANSCRIPTIDENTIFIER AS entitled_transcript_identifier,",
	"  episode.ZTITLE AS episode_title,",
	"  episode.ZPUBDATE AS pub_date,",
	"  episode.ZITEMDESCRIPTION AS item_description,",
	"  episode.ZITEMDESCRIPTIONWITHOUTHTML AS item_description_without_html,",
	"  podcast.ZTITLE AS show_title,",
	"  episode.ZPLAYSTATE AS play_state,",
	"  episode.ZPLAYHEAD AS play_head_seconds,",
	"  episode.ZDURATION AS duration_seconds,",
	"  episode.ZLASTDATEPLAYED AS last_played_date,",
	"  episode.ZPLAYCOUNT AS play_count",
	"FROM ZMTEPISODE episode",
	"LEFT JOIN ZMTPODCAST podcast ON episode.ZPODCAST = podcast.Z_PK",
	"LEFT JOIN ZMTCHANNEL channel ON podcast.ZCHANNEL = channel.Z_PK",
].join(" ")

	const metadataMap = new Map()
	let missingListeningStatusLogged = false
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

		const episodePks = Array.from(
			new Set(
				rows
					.map((row) => (typeof row.episode_pk === "number" ? row.episode_pk : null))
					.filter((value) => Number.isInteger(value)),
			),
		)
		const stationMap = new Map()
		if (episodePks.length > 0) {
			const stationQuery = [
				"SELECT",
				"  playlist_map.Z_4EPISODES1 AS episode_pk,",
				"  playlist.ZTITLE AS station_title",
				"FROM Z_4PLAYLISTS playlist_map",
				"JOIN ZMTPLAYLIST playlist ON playlist.Z_PK = playlist_map.Z_7PLAYLISTS",
				`WHERE playlist_map.Z_4EPISODES1 IN (${episodePks.join(",")})`,
			].join(" ")
			const stationResult = spawnSync("sqlite3", ["-readonly", "-json", dbPath, stationQuery], {
				encoding: "utf8",
				maxBuffer: 50 * 1024 * 1024,
			})
			if (stationResult.error) {
				console.warn(
					`Unable to load station metadata: ${stationResult.error.message}. Station filters may be incomplete.`,
				)
			} else if (stationResult.status !== 0) {
				if (stationResult.stderr) {
					console.warn(stationResult.stderr.trim())
				}
				console.warn(
					`sqlite3 returned non-zero status (${stationResult.status}) while loading station metadata. Station filters may be incomplete.`,
				)
			} else {
				let stationRows = []
				try {
					stationRows = JSON.parse(stationResult.stdout || "[]")
				} catch (stationParseError) {
					console.warn(
						"Failed to parse station metadata. Station filters may be incomplete.",
					)
				}
				stationRows.forEach((stationRow) => {
					const pk = typeof stationRow.episode_pk === "number" ? stationRow.episode_pk : null
					const title =
						stationRow.station_title && typeof stationRow.station_title === "string"
							? stationRow.station_title.trim()
							: ""
					if (!pk || !title) {
						return
					}
					if (!stationMap.has(pk)) {
						stationMap.set(pk, new Set())
					}
					stationMap.get(pk).add(title)
				})
			}
		}

		rows.forEach((row) => {
			const showTitle = row.show_title || "unknown show"
			const episodeTitle = row.episode_title || "unknown episode"
			const pubDate = formatCocoaDate(row.pub_date)
			const showSlug = slugify(showTitle, "unknown-show")
			const episodeSlug = truncateSlug(slugify(episodeTitle, "episode"), 20)
			const stationSet =
				typeof row.episode_pk === "number" && stationMap.has(row.episode_pk)
					? stationMap.get(row.episode_pk)
					: null
			const stationTitles = stationSet ? Array.from(stationSet.values()) : []
			const stationSlugs = stationTitles.map((title) => slugify(title, "station"))
			const stationTitle = stationTitles.length > 0 ? stationTitles[0] : null
			const stationSlug = stationSlugs.length > 0 ? stationSlugs[0] : null
			const listeningStatus = buildListeningStatus(row)
			const baseFileName = `${showSlug}_${pubDate}_${episodeSlug}`
			if (!listeningStatus && !missingListeningStatusLogged) {
				console.warn(
					"Playback status columns were unavailable for at least one episode. Listening status will be omitted.",
				)
				missingListeningStatusLogged = true
			}
			const metadata = {
				showTitle,
				episodeTitle,
				pubDate,
				showSlug,
				episodeSlug,
				stationTitle,
				stationSlug,
				stationTitles,
				stationSlugs,
				baseFileName,
				episodeDescriptionHtml: row.item_description || "",
				episodeDescriptionText: row.item_description_without_html || "",
				listeningStatus,
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
	if (!fileBaseName || typeof fileBaseName !== "string") {
		return null
	}
	const suffixMatch = fileBaseName.match(/^(.*?)-(\d+)$/)
	const baseKey = suffixMatch ? suffixMatch[1] : fileBaseName
	const indexFromSuffix = suffixMatch ? parseInt(suffixMatch[2], 10) : null

	const resolveByKey = (key) => {
		if (!key || !metadataIndex.has(key)) {
			return null
		}
		const list = metadataIndex.get(key)
		if (!Array.isArray(list) || list.length === 0) {
			return null
		}
		if (indexFromSuffix == null) {
			return list[0]
		}
		if (indexFromSuffix >= 0 && indexFromSuffix < list.length) {
			return list[indexFromSuffix]
		}
		return null
	}

	const direct = resolveByKey(baseKey)
	if (direct) {
		return direct
	}
	const toggledKey = baseKey.startsWith("played_")
		? baseKey.slice("played_".length)
		: `played_${baseKey}`
	if (toggledKey !== baseKey) {
		const toggled = resolveByKey(toggledKey)
		if (toggled) {
			return toggled
		}
	}
	return null
}

module.exports = {
	loadTranscriptMetadata,
	buildMetadataFilenameIndex,
	resolveMetadataForFile,
}
