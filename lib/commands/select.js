const fs = require("fs")
const readline = require("readline")

const { loadListeningStatusManifest } = require("../listening-status-manifest")
const {
	buildCatalogEntries,
	buildEntryFilterConfig,
	compareCatalogEntriesDesc,
	describeFilterSummary,
	ensureStationMetadataForManifest,
	filterCatalogEntries,
} = require("../catalog")
const { runInteractiveSelector } = require("../cli/interactive-selector")
const { copyFileToClipboard } = require("../clipboard")
const { printToStdout } = require("../utils/stdout")
const { reportOptionMessages } = require("../cli/options")
const { runHelpCommand } = require("../cli/help")
const { DEFAULT_SELECT_PAGE_SIZE } = require("../constants")
const { parsePositiveInteger } = require("../utils/numbers")
const { transcriptsDir } = require("../config")

async function runSelectCommand(options) {
	const safeOptions = options || {}
	if (safeOptions.help) {
		runHelpCommand({ topic: "select" })
		return
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("Interactive mode requires an interactive terminal (TTY).")
	}
	if (!reportOptionMessages(safeOptions)) {
		throw new Error("Unable to start interactive selection. Resolve the errors above and retry.")
	}
	const manifest = loadListeningStatusManifest(transcriptsDir)
	ensureStationMetadataForManifest(manifest, safeOptions)
	const catalogEntries = buildCatalogEntries(manifest)
	if (!catalogEntries || catalogEntries.length === 0) {
		console.log("[INFO] No transcripts found. Run `transcripts --sync` first.")
		return
	}
	const sortedEntries = catalogEntries.slice().sort(compareCatalogEntriesDesc)
	const filterConfig = buildEntryFilterConfig(safeOptions)
	const filteredEntries = filterCatalogEntries(sortedEntries, filterConfig)
	if (filteredEntries.length === 0) {
		const summary = describeFilterSummary(filterConfig)
		const suffix = summary ? ` matching filters (${summary})` : ""
		console.log(`[INFO] No transcripts available${suffix}.`)
		return
	}

	const pageSize = Math.max(parsePositiveInteger(safeOptions.pageSize) || DEFAULT_SELECT_PAGE_SIZE, 1)
	const selectedEntry = await runInteractiveSelector({
		entries: filteredEntries,
		pageSize,
		status: filterConfig.status,
		filters: {
			status: filterConfig.status,
			showFilters: filterConfig.showFilters,
			stationFilters: filterConfig.stationFilters,
		},
	})
	if (!selectedEntry) {
		return
	}
	if (!selectedEntry.absolutePath || !selectedEntry.hasMarkdown) {
		throw new Error("Selected transcript is missing its Markdown file.")
	}
	try {
		await copyFileToClipboard(selectedEntry.absolutePath)
		const location =
			selectedEntry.normalizedRelativePath ||
			selectedEntry.relativePath ||
			selectedEntry.identifier
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

function questionAsync(rl, prompt) {
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => {
			resolve(answer)
		})
	})
}

module.exports = {
	runSelectCommand,
}

