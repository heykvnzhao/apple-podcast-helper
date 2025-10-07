const { getStatusInfo, normalizePlayState } = require("../utils/play-state")

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
	console.log(`📋 │ ${headerCells.join(" │ ")} │ [ACTION]`)
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

module.exports = {
	formatEpisodeLogLine,
	formatListeningStatusSummary,
	formatListLogLine,
	printEpisodeLogHeader,
	printListLogHeader,
	truncateForDisplay,
}

