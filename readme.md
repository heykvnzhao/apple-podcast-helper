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

The script supports batch export of everything in the Podcasts cache or processing a single `.ttml` file.

### Batch mode

```bash
node extractTranscript.js [--timestamps]
```

- Recursively scans the TTML cache, converts each transcript to Markdown, and writes files to `./transcripts/`.
- Filenames follow `podcast-show-name_YYYY-MM-DD_episode-title-up-to-20-chars.md`.
- Re-running keeps the folder tidy: any legacy `.txt` exports get upgraded to `.md` automatically.

### Single-file mode

```bash
node extractTranscript.js path/to/input.ttml path/to/output.md [--timestamps]
```

- Useful if you want to experiment with one transcript outside the cache.
- You provide the exact output filename in this mode; the script does not rename it.

### Optional flags

- `--timestamps` – prepend `[HH:MM:SS]` markers before each paragraph in the Markdown output.

## Troubleshooting and tips

- If you see `TTML directory not found`, double-check that transcripts exist locally and that you are running on macOS under the same user account as the Podcasts app.
- Metadata comes from `MTLibrary.sqlite` in the Podcasts container. If the script cannot read it, filenames fall back to `unknown-show_unknown-date_*`. Ensure the Podcasts app is closed and that the database path exists.
- The default `transcripts/` directory is git-ignored; feel free to delete or relocate it between runs.

## Next steps

Once you have the Markdown transcripts, you can:

- Feed them into your favourite LLM to generate summaries or identify key segments.
- Build your own summarization pipeline or note-taking automation.
- Share snippets or highlights without needing to scrub through full episodes.
