# Apple Podcast Transcript Extractor

## Why this exists

This script grabs the Apple Podcasts transcripts already cached on your Mac and saves them as Markdown. Use the `.md` files to skim episodes fast, feed them to an LLM for summaries, or pull out key segments without scrubbing through hours of audio.

## Requirements

- **macOS only** – the script reads from the Apple Podcasts container under `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/`.
- **Apple Podcasts app** – install it and sign in so the Core Data store and transcript assets exist.
- **Episode transcripts or downloads present** – transcripts live in `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML`. You can confirm by running:
  - `ls "~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML"`
- **Node.js 18+** – needed to run the script. Verify with `node -v`.
- **npm (or pnpm/yarn)** – run `npm install` once to install the `xml2js` dependency.

If the TTML cache folder is empty, open Apple Podcasts and download the episodes (or enable transcripts) you want first; the script only exports content that already exists locally.

## Setup

Install dependencies:

```bash
pnpm install
```

## Usage

The tool now ships with a small CLI so you can sync, browse, and copy transcripts without remembering long `node` invocations.

### Quick start

```bash
pnpm install
```

Run the CLI from the project root with either `node` or the provided script shortcut:

```bash
node extract-transcripts.js             # auto-sync then interactive picker (default)
node extract-transcripts.js --no-sync   # skip sync and launch the picker with existing files
node extract-transcripts.js --sync      # batch export only (timestamps on)
node extract-transcripts.js --sync --no-timestamps
node extract-transcripts.js list --status unplayed --limit 20
node extract-transcripts.js pick --status unplayed --page-size 20
node extract-transcripts.js copy the-vergecast/the-vergecast_2025-10-05_version-history-hove.md

# or
pnpm run transcripts -- list --status unplayed --limit 20
```

If you want a short alias such as `apd`, add it to your shell configuration and point it at `node /path/to/repo/extract-transcripts.js` with your preferred defaults.

### `sync` – export transcripts

```bash
node extract-transcripts.js --sync [--no-timestamps]
```

- Recursively scans the TTML cache, converts each transcript to Markdown, and writes files to `./transcripts/`.
- Timestamps are included by default; pass `--no-timestamps` if you want raw transcript text.
- Use `--show "<query>"` to limit exports to shows whose titles fuzzy-match the query. Combine multiple `--show` flags to include several podcasts in one pass.
- Use `--station "<query>"` to restrict exports to shows from your custom Stations (e.g. `--station "Daily"`).
- Filenames follow `podcast-show-name_YYYY-MM-DD_episode-title-up-to-20-chars.md` and existing `.txt` exports are upgraded automatically.
- The CLI runs this sync automatically before other commands; use `--sync` for a dedicated export or `--no-sync` to skip the refresh.

### `list` – browse the manifest

```bash
node extract-transcripts.js list [--status <played|unplayed|in-progress|all>] [--limit <n>] [--page <n>] [--json]
```

- Lists manifest entries sorted newest-first. The default view prints a table with numbered rows so you can grab a path or identifier quickly.
- Automatically refreshes the manifest before listing; pass `--no-sync` to skip the update step.
- Filter by listening state (e.g. `--status unplayed`) and paginate through batches of 10–20 episodes while you work.
- Add `--show "<query>"` or `--station "<query>"` when you only care about specific podcasts or Stations; fuzzy matching handles partial titles.
- Add `--json` to emit the current page as structured data.

### `copy` – send Markdown to the clipboard

```bash
node extract-transcripts.js copy <identifier|relativePath> [--print]
```

- Accepts either a manifest identifier or the relative Markdown path under `transcripts/`.
- If the macOS clipboard command (`pbcopy`) is unavailable the CLI logs a warning and, when `--print` is supplied, streams the Markdown to stdout so you can copy it manually.
- Prepend `--no-sync` when you only want to copy existing files without refreshing the cache (e.g. `node extract-transcripts.js --no-sync copy <path>`).

### `pick` – interactive chooser

```bash
node extract-transcripts.js pick [--status <state>] [--page-size <n>]
```

- Opens a simple pager that shows the newest episodes in batches (default 20 per page).
- Combine `--show "<query>"` or `--station "<query>"` with the picker to narrow the interactive menu before browsing.
- Choose a number to copy that transcript to your clipboard. If clipboard access fails you can fall back to printing the full Markdown in place.
- Run `node extract-transcripts.js` with no arguments to launch the picker immediately; add `--no-sync` when you only want to browse existing exports.

### Listening status metadata & manifest

- Markdown exports now include a `## Listening status` section summarising whether you have completed the episode, your progress, time remaining, last played timestamp, and play count (when available from `MTLibrary.sqlite`).
- The script writes a manifest at `transcripts/.listening-status.json` to remember listening status and file mappings for episodes whose TTML cache entries are later purged. The manifest lives inside the `transcripts/` directory, which remains git ignored.
- When the manifest references an episode that no longer has a TTML file, the CLI logs how many transcripts were retained from the manifest and keeps their Markdown files untouched.
- To prune finished transcripts later, delete the Markdown file(s) under `transcripts/<show>/` and remove the matching entry from the manifest (look up the transcript identifier or relative path); the next batch run will rebuild the manifest without those entries.

## Troubleshooting and tips

- If you see `TTML directory not found`, double-check that transcripts exist locally and that you are running on macOS under the same user account as the Podcasts app.
- Metadata comes from `MTLibrary.sqlite` in the Podcasts container. If the script cannot read it, filenames fall back to `unknown-show_unknown-date_*` and listening status will be omitted. Ensure the Podcasts app is closed and that the database path exists.
- The default `transcripts/` directory is git-ignored; feel free to delete or relocate it between runs.
- Clipboard access uses the platform utilities (`pbcopy` on macOS). If those tools are missing or sandboxed the CLI will warn and point you at the Markdown file so you can copy it manually.

## Next steps

Once you have the Markdown transcripts, you can:

- Feed them into your favourite LLM to generate summaries or identify key segments.
- Build your own summarization pipeline or note-taking automation.
- Share snippets or highlights without needing to scrub through full episodes.
