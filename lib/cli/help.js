function printUsage() {
	console.log("Usage:")
	console.log("  transcripts [--status <state>] [--show <query>] [--station <query>] [--page-size <n>]")
	console.log("  transcripts select [--status <state>] [--show <query>] [--station <query>] [--page-size <n>]")
	console.log("  transcripts --sync [--no-timestamps] [--show <query>] [--station <query>]")
	console.log("  transcripts sync <input.ttml> <output.md> [--no-timestamps]")
	console.log("  transcripts list [--status <state>] [--show <query>] [--station <query>] [--limit <n>] [--page <n>] [--json]")
	console.log("  transcripts copy <identifier|relativePath> [--print]")
	console.log("")
	console.log("Run transcripts help <command> for command-specific options.")
}

function runHelpCommand(options = {}) {
	const topic = options.topic ? options.topic.toLowerCase() : "global"
	switch (topic) {
		case "sync":
			console.log("Usage: transcripts --sync [--no-timestamps]")
			console.log("       transcripts sync [--no-timestamps]")
			console.log("       transcripts sync <input.ttml> <output.md> [--no-timestamps]")
			console.log("")
			console.log("Options:")
			console.log("  --no-timestamps    Omit timestamp markers in generated Markdown.")
			console.log("  --timestamps       Include timestamp markers (default).")
			console.log("  --show <query>     Only export shows whose title matches the query (fuzzy match).")
			console.log("  --station <query>  Only export shows whose station name matches the query.")
			console.log("")
			console.log("Use --sync without additional arguments to scan the TTML cache and export every transcript as Markdown.")
			return
		case "list":
			console.log("Usage: transcripts list [--status <state>] [--show <query>] [--station <query>] [--limit <n>] [--page <n>] [--json]")
			console.log("")
			console.log("Options:")
			console.log("  --status <state>   Filter by play state (played, unplayed, in-progress, all). Default: all.")
			console.log("  --limit <n>        Number of rows per page (default: 20).")
			console.log("  --page <n>         Page number to display (default: 1).")
			console.log("  --show <query>     Restrict to shows whose titles fuzzy-match the query.")
			console.log("  --station <query>  Restrict to shows whose station names fuzzy-match the query.")
			console.log("  --json             Emit JSON output instead of the table view.")
			return
		case "copy":
			console.log("Usage: transcripts copy <identifier|relativePath> [--print]")
			console.log("")
			console.log("Arguments:")
			console.log("  identifier         TTML identifier as stored in the manifest.")
			console.log("  relativePath       Path under transcripts/ (e.g. show/file.md).")
			console.log("")
			console.log("Options:")
			console.log("  --print            Also print the Markdown to stdout after copying.")
			return
		case "select":
		case "interactive":
			console.log("Usage: transcripts select [--status <state>] [--show <query>] [--station <query>] [--page-size <n>]")
			console.log("")
			console.log("Options:")
			console.log("  --status <state>   Filter by play state before prompting (default: unplayed).")
			console.log("  --show <query>     Limit selector entries to shows matching the query (fuzzy).")
			console.log("  --station <query>  Limit selector entries to stations matching the query (fuzzy).")
			console.log("  --page-size <n>    Number of rows per page in the selector (default: 20).")
			console.log("")
			console.log("Interactive mode lets you browse transcripts and copy one to the clipboard.")
			return
		default:
			printUsage()
	}
}

module.exports = {
	printUsage,
	runHelpCommand,
}

