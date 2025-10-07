const readline = require("readline")

const { DEFAULT_SELECT_PAGE_SIZE } = require("../constants")
const { paginateEntries } = require("../catalog")
const { truncateForDisplay, formatListeningStatusSummary } = require("./output-format")
const { parsePositiveInteger } = require("../utils/numbers")

function buildSelectorEntryLines({ entry, displayIndex, isActive, indexWidth, maxWidth }) {
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

async function runInteractiveSelector({ entries, pageSize, status, filters = null }) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
		readline.emitKeypressEvents(process.stdin, rl)
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true)
			process.stdin.resume()
		}

		let resolved = false
		const basePageSize = Math.max(parsePositiveInteger(pageSize) || DEFAULT_SELECT_PAGE_SIZE, 1)
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
			lines.push(`${indent}Select a transcript to copy`)
			const statusParts = []
			if (status && status !== "all") {
				statusParts.push(`status=${status}`)
			}
			if (filters && Array.isArray(filters.showFilters) && filters.showFilters.length > 0) {
				statusParts.push(`show~${filters.showFilters.join(" OR ")}`)
			}
			if (
				filters &&
				Array.isArray(filters.stationFilters) &&
				filters.stationFilters.length > 0
			) {
				statusParts.push(`station~${filters.stationFilters.join(" OR ")}`)
			}
			if (statusParts.length > 0) {
				lines.push(`${indent}${statusParts.join(" | ")}`)
			}
			lines.push(`${indent}Page ${page}/${pageCount} — ${total} transcript(s)`)

			lines.push("")
			if (items.length === 0) {
				lines.push(`${indent}[No transcripts available]`)
			} else {
				items.forEach((entry, itemIndex) => {
					const absoluteIndex = startIndex + itemIndex
					const displayIndex = absoluteIndex + 1
					const isActive = absoluteIndex === state.cursor
					const entryLines = buildSelectorEntryLines({
						entry,
						displayIndex,
						isActive,
						indexWidth,
						maxWidth: usableWidth,
					})
					entryLines.forEach((line) => {
						lines.push(`${indent}${line}`)
					})
				})
			}

			lines.push("")
			lines.push(`${indent}↑/↓ move • ←/→ page • digits jump • enter confirm • q exit`)
			if (state.commandBuffer) {
				lines.push(`${indent}Input: ${state.commandBuffer}`)
			}
				if (state.statusMessage) {
					lines.push(`${indent}${state.statusMessage}`)
				}

				const output = lines.join("\n")
				rl.output.write(`\u001B[2J\u001B[0;0H${output}\n`)
			}

		const moveCursor = (delta) => {
			if (entries.length === 0) {
				state.cursor = 0
				return
			}
			const next = state.cursor + delta
			const maxIndex = entries.length - 1
			if (next < 0) {
				state.cursor = 0
				return
			}
			if (next > maxIndex) {
				state.cursor = maxIndex
				return
			}
			state.cursor = next
		}

		const movePage = (delta) => {
			if (entries.length === 0) {
				state.cursor = 0
				state.currentPage = 1
				return
			}
			const totalPages = Math.max(Math.ceil(entries.length / resolvedPageSize), 1)
			let nextPage = state.currentPage + delta
			if (nextPage < 1) {
				nextPage = 1
			}
			if (nextPage > totalPages) {
				nextPage = totalPages
			}
			state.currentPage = nextPage
			const start = (nextPage - 1) * resolvedPageSize
			state.cursor = Math.min(entries.length - 1, start)
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

		const handleResize = () => {
			if (!resolved) {
				render()
			}
		}

		process.stdin.on("keypress", handleKeypress)
		process.stdout.on("resize", handleResize)
		hideCursor()
		render()
	})
}

module.exports = {
	runInteractiveSelector,
}
