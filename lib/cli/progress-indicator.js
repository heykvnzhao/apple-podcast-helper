const readline = require("readline")

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const FRAME_INTERVAL_MS = 120

function createProgressIndicator({ label, total = 0, stream = process.stderr }) {
	const supportsInteractive = Boolean(stream && stream.isTTY)
	let frameIndex = 0
	let processed = 0
	let detail = ""
	let intervalId = null
	let active = false
	let hasRenderedLine = false
	let lastLineCount = 0

	function formatLine(frame) {
		const tokens = [`${frame} ${label}`]
		if (total > 0) {
			const boundedProcessed = Math.min(Math.max(processed, 0), total)
			const percent = Math.min(Math.round((boundedProcessed / total) * 100), 100)
			tokens.push(`${boundedProcessed}/${total}`)
			tokens.push(`${percent}%`)
		} else if (processed > 0) {
			tokens.push(String(processed))
		}
		if (detail) {
			tokens.push(`- ${detail}`)
		}
		return tokens.join("  ")
	}

	function getDisplayWidth(text) {
		if (!text) {
			return 0
		}
		const withoutAnsi = String(text).replace(/\u001B\[[0-9;]*m/g, "")
		return withoutAnsi.length
	}

	function calculateLineCount(text) {
		const columns = stream && typeof stream.columns === "number" && stream.columns > 0 ? stream.columns : 80
		const width = Math.max(getDisplayWidth(text), 1)
		return Math.max(Math.ceil(width / columns), 1)
	}

	function clearOutput() {
		if (!supportsInteractive || !hasRenderedLine || lastLineCount <= 0) {
			return
		}
		readline.moveCursor(stream, 0, -1)
		for (let index = 0; index < lastLineCount; index += 1) {
			readline.clearLine(stream, 0)
			if (index < lastLineCount - 1) {
				readline.moveCursor(stream, 0, -1)
			}
		}
		readline.cursorTo(stream, 0)
		hasRenderedLine = false
		lastLineCount = 0
	}

	function render({ advanceFrame = true } = {}) {
		if (!supportsInteractive || !active) {
			return
		}
		if (advanceFrame) {
			frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
		}
		const frame = SPINNER_FRAMES[frameIndex]
		const line = formatLine(frame)
		clearOutput()
		stream.write(`${line}\n`)
		hasRenderedLine = true
		lastLineCount = calculateLineCount(line)
	}

	function stopInternal(message, prefix = "") {
		if (intervalId) {
			clearInterval(intervalId)
			intervalId = null
		}
		if (supportsInteractive) {
			clearOutput()
		}
		active = false
		if (message) {
			const finalLine = `${prefix}${message}`
			if (supportsInteractive) {
				clearOutput()
				stream.write(`${finalLine}\n`)
			} else {
				console.log(finalLine)
			}
		}
	}

	return {
		start() {
			if (!supportsInteractive || active) {
				return
			}
			active = true
			frameIndex = 0
			hasRenderedLine = false
			lastLineCount = 0
			render({ advanceFrame: false })
			intervalId = setInterval(render, FRAME_INTERVAL_MS)
		},
		update(update = {}) {
			if (!supportsInteractive || !active) {
				return
			}
			if (typeof update.processed === "number") {
				processed = update.processed
			} else {
				processed += 1
			}
			if (update.detail) {
				detail = truncateDetail(update.detail)
			}
			render({ advanceFrame: false })
		},
		done(message) {
			stopInternal(message, "✅ ")
		},
		fail(message) {
			stopInternal(message, "❌ ")
		},
		stop() {
			if (!supportsInteractive || !active) {
				return
			}
			stopInternal(null)
		},
	}
}

function truncateDetail(value, maxLength = 56) {
	if (!value) {
		return ""
	}
	const text = String(value)
	if (text.length <= maxLength) {
		return text
	}
	const suffix = "..."
	const sliceLength = Math.max(maxLength - suffix.length, 0)
	return `${text.slice(0, sliceLength)}${suffix}`
}

module.exports = {
	createProgressIndicator,
}
