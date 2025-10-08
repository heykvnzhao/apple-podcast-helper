# Apple Podcast Helper

Apple Podcast Helper turns the transcripts already cached by the Apple Podcasts app on macOS into clean Markdown files. The Markdown is perfect for skimming episodes, feeding summaries to an LLM, or indexing your listening history.

## Requirements

- macOS with the Apple Podcasts app (transcripts must already exist in the cache)
- Node.js 18 or newer
- `pnpm` (recommended) or `npm`

> The tool reads from the Apple Podcasts cache under `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML` and never modifies those files. Exported Markdown lands in the local `transcripts/` directory, which is safe to delete between runs.

## Setup

1. Clone the repository and move into it:
   ```bash
   git clone https://github.com/heykvnzhao/apple-podcast-helper.git
   cd apple-podcast-helper
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```

### Optional: Enable Gemini summaries

Create a `.env` file at the project root with your Gemini API key to enable automatic episode summaries:

```bash
echo "GEMINI_API_KEY=your-api-key" >> .env
```

When a valid key is present the CLI streams a structured summary (prompt located at `prompts/podcasts-summarizer.md`). If the request fails or no key is configured, the CLI falls back to just producing the transcript and not generating a summary.

## Quick start

Run the CLI directly with Node. Examples assume you're inside the project directory.

Quick command reference:

- Export all cached transcripts:

```bash
node extract-transcripts.js
```

- Export transcripts for a show (fuzzy match):

```bash
node extract-transcripts.js --show "Hard Fork"
```

- Export transcripts by station (also with fuzzy match):

```bash
node extract-transcripts.js --station "Daily"
```

- Hide timestamps (remove minute:second markers from markdown):

```bash
node extract-transcripts.js --no-timestamps --show "Hard Fork"
```

- Create an alias to run from anywhere. All transcripts and summaries will be created in the project folder.

```bash
alias aph='node ~/path/to/apple-podcast-helper/extract-transcripts.js'
```

## Where to find transcripts and summaries

Markdown files are written to the repository's `transcripts/` and `summaries/` folder. This folder is safe to delete between runs; the tool will recreate or replace files as needed.

## Help & reference

Every command supports `--help` for full flag details. If you need to learn about flags or edge options, run:

```bash
node extract-transcripts.js --help
node extract-transcripts.js help sync
```

## Troubleshooting

- **No transcripts exported** — Play an episode with transcripts in the Apple Podcasts app first; the app only caches TTML for episodes you've played.
- **Cache path not found** — This tool reads the Podcasts cache under `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML` and only runs on macOS with the Apple Podcasts app installed.
- **Stale Markdown files** — Remove `transcripts/` and re-run `node extract-transcripts.js sync` (or `pnpm sync`) to regenerate files.
