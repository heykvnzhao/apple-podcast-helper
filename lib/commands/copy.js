const fs = require("fs")

const { loadListeningStatusManifest } = require("../listening-status-manifest-store")
const { buildCatalogEntries, findCatalogEntry } = require("../catalog")
const { copyFileToClipboard } = require("../clipboard-service")
const { printToStdout } = require("../utils/stdout")
const { reportOptionMessages } = require("../cli/options")
const { runHelpCommand } = require("../cli/help")
const { transcriptsDir } = require("../app-config")

async function runCopyCommand(options) {
	const safeOptions = options || {}
	if (safeOptions.help) {
		runHelpCommand({ topic: "copy" })
		return
	}
	if (!reportOptionMessages(safeOptions)) {
		throw new Error("Unable to copy transcript. Resolve the errors above and retry.")
	}
	const manifest = loadListeningStatusManifest(transcriptsDir)
	const catalogEntries = buildCatalogEntries(manifest)
	if (!catalogEntries || catalogEntries.length === 0) {
		throw new Error("No transcripts indexed. Verify the Apple Podcasts cache is available and retry.")
	}
	const target = findCatalogEntry(catalogEntries, safeOptions.key)
	if (!target) {
		throw new Error(`Unable to find a transcript matching "${safeOptions.key}".`)
	}
	if (!target.absolutePath || !target.hasMarkdown) {
		const identifier =
			target.normalizedRelativePath || target.relativePath || target.identifier || safeOptions.key
		throw new Error(`Transcript Markdown file not found for ${identifier}.`)
	}

	const location = target.normalizedRelativePath || target.relativePath || target.identifier
	let content = null
	try {
		content = await copyFileToClipboard(target.absolutePath)
		console.log(`📋 Copied transcript to clipboard: ${location}`)
	} catch (error) {
		console.warn(`[WARN] Clipboard copy failed: ${error.message}`)
		console.log(`📄 Transcript path: ${target.absolutePath}`)
		console.log("Hint: re-run with --print to dump the Markdown for manual copy.")
		if (!safeOptions.print) {
			return
		}
	}

	if (safeOptions.print) {
		if (!content) {
			content = await fs.promises.readFile(target.absolutePath, "utf8")
		}
		await printToStdout(content)
	}
}

module.exports = {
	runCopyCommand,
}
