#!/usr/bin/env node

const { ensureTranscriptsDirectory } = require("./lib/config")
const { parseCliArguments, parseSelectOptions } = require("./lib/cli/parse-cli-arguments")
const { printUsage, runHelpCommand } = require("./lib/cli/help")
const { runSyncCommand } = require("./lib/commands/sync")
const { runListCommand } = require("./lib/commands/list")
const { runCopyCommand } = require("./lib/commands/copy")
const { runSelectCommand } = require("./lib/commands/select")

process.stdout.on("error", (error) => {
	if (error && error.code === "EPIPE") {
		process.exit(0)
	}
	throw error
})

async function main() {
	ensureTranscriptsDirectory()
	const parsed = parseCliArguments(process.argv.slice(2))
	const command = parsed.command || "select"
	const options = parsed.options || {}

	switch (command) {
		case "sync":
			await runSyncCommand(options)
			if (options && options.launchSelectorAfterSync) {
				if (!process.stdin.isTTY || !process.stdout.isTTY) {
					console.log("[INFO] Sync complete. Run `transcripts` from an interactive terminal to browse.")
				} else {
					console.log("")
					console.log("[INFO] Sync complete. Opening selector...")
					const selectDefaults = parseSelectOptions([])
					await runSelectCommand(selectDefaults)
				}
			}
			return
		case "list":
			await runListCommand(options)
			return
		case "copy":
			await runCopyCommand(options)
			return
		case "select":
			await runSelectCommand(options)
			return
		case "help":
			runHelpCommand(options)
			return
		default:
			console.error(`Unknown command: ${command}`)
			printUsage()
			process.exit(1)
	}
}

main().catch((error) => {
	const message = error && error.message ? error.message : String(error)
	console.error(message)
	process.exit(1)
})

