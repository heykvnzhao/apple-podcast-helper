const SPINNER_FRAMES = ["-", "\\", "|", "/"]
const FRAME_INTERVAL_MS = 120

function createProgressIndicator({ label, total = 0, stream = process.stdout }) {
	const supportsInteractive = Boolean(stream && stream.isTTY)
	let frameIndex = 0
	let processed = 0
	let detail = ""
	let lastLength = 0
	let intervalId = null
	let active = false

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

	function render({ advanceFrame = true } = {}) {
		if (!supportsInteractive || !active) {
			return
		}
		if (advanceFrame) {
			frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
		}
		const frame = SPINNER_FRAMES[frameIndex]
		const line = formatLine(frame)
		const paddedLine = line.padEnd(lastLength, " ")
		stream.write(`\r${paddedLine}`)
		lastLength = Math.max(lastLength, paddedLine.length)
	}

	function clearLine() {
		if (!supportsInteractive) {
			return
		}
		if (lastLength > 0) {
			stream.write(`\r${" ".repeat(lastLength)}\r`)
			lastLength = 0
		}
	}

	function stopInternal(message, prefix = "") {
		if (intervalId) {
			clearInterval(intervalId)
			intervalId = null
		}
		if (supportsInteractive) {
			clearLine()
		}
		active = false
		if (message) {
			const finalLine = `${prefix}${message}`
			if (supportsInteractive) {
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
