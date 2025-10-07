const fs = require("fs")
const { spawn } = require("child_process")

async function copyFileToClipboard(filePath) {
	if (!filePath) {
		throw new Error("Cannot copy transcript: file path is missing.")
	}
	const content = await fs.promises.readFile(filePath, "utf8")
	await writeToClipboard(content)
	return content
}

function writeToClipboard(content) {
	return new Promise((resolve, reject) => {
		let command = null
		let args = []
		if (process.platform === "darwin") {
			command = "pbcopy"
		} else if (process.platform === "win32") {
			command = "clip"
		} else {
			command = "xclip"
			args = ["-selection", "clipboard"]
		}
		let child
		try {
			child = spawn(command, args)
		} catch (error) {
			reject(new Error(`Unable to access clipboard utility (${command}): ${error.message}`))
			return
		}
		child.on("error", (error) => {
			reject(new Error(`Clipboard command failed (${command}): ${error.message}`))
		})
		if (!child.stdin) {
			reject(new Error("Clipboard command does not expose stdin."))
			return
		}
		child.stdin.on("error", (error) => {
			reject(new Error(`Unable to write to clipboard: ${error.message}`))
		})
		child.on("close", (code) => {
			if (code === 0) {
				resolve()
				return
			}
			reject(new Error(`Clipboard command exited with code ${code}`))
		})
		child.stdin.end(content)
	})
}

module.exports = {
	copyFileToClipboard,
	writeToClipboard,
}

