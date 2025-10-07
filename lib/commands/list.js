const { loadListeningStatusManifest } = require("../listening-status-manifest-store")
const {
	buildCatalogEntries,
	buildEntryFilterConfig,
	compareCatalogEntriesDesc,
	describeFilterSummary,
	ensureStationMetadataForManifest,
	filterCatalogEntries,
	paginateEntries,
	serializeCatalogEntry,
} = require("../catalog")
const { printListLogHeader, formatListLogLine } = require("../cli/output-format")
const { reportOptionMessages } = require("../cli/options")
const { runHelpCommand } = require("../cli/help")
const { transcriptsDir } = require("../app-config")

async function runListCommand(options) {
	const safeOptions = options || {}
	if (safeOptions.help) {
		runHelpCommand({ topic: "list" })
		return
	}
	if (!reportOptionMessages(safeOptions)) {
		throw new Error("Unable to list transcripts. Fix the errors above and retry.")
	}
	const manifest = loadListeningStatusManifest(transcriptsDir)
	ensureStationMetadataForManifest(manifest, safeOptions)
	const catalogEntries = buildCatalogEntries(manifest)
	if (!catalogEntries || catalogEntries.length === 0) {
		console.log("[INFO] No transcripts found after syncing. Verify the Apple Podcasts cache is available.")
		return
	}
	const sortedEntries = catalogEntries.slice().sort(compareCatalogEntriesDesc)
	const filterConfig = buildEntryFilterConfig(safeOptions)
	const filteredEntries = filterCatalogEntries(sortedEntries, filterConfig)
	if (filteredEntries.length === 0) {
		const summary = describeFilterSummary(filterConfig)
		const suffix = summary ? ` matching filters (${summary})` : ""
		console.log(`[INFO] No transcripts found${suffix}.`)
		return
	}

	const pagination = paginateEntries(filteredEntries, safeOptions.page, safeOptions.limit)
	const { items, page, totalPages, total, limit } = pagination
	const format = safeOptions.format || "table"
	if (format === "json") {
		const payload = items.map((entry) => serializeCatalogEntry(entry))
		const response = {
			status: filterConfig.status || "all",
			page,
			limit,
			total,
			totalPages,
			count: payload.length,
			filters: {
				status: filterConfig.status || "all",
				show: filterConfig.showFilters,
				station: filterConfig.stationFilters,
			},
			entries: payload,
		}
		console.log(JSON.stringify(response, null, 2))
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
	if (filterConfig.status && filterConfig.status !== "all") {
		summaryParts.push(`status=${filterConfig.status}`)
	}
	if (filterConfig.showFilters.length > 0) {
		summaryParts.push(`show~${filterConfig.showFilters.join(" OR ")}`)
	}
	if (filterConfig.stationFilters.length > 0) {
		summaryParts.push(`station~${filterConfig.stationFilters.join(" OR ")}`)
	}
	console.log(`📄 [LIST] ${summaryParts.join(" | ")}`)
}

module.exports = {
	runListCommand,
}
