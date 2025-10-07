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
   # or: npm install
   ```

### Optional: Enable Gemini summaries

Create a `.env` file at the project root with your Gemini API key to enable automatic episode summaries:

```bash
echo "GEMINI_API_KEY=your-api-key" >> .env
```

When the key is present, the `copy` command and interactive selector keep copying transcripts to your clipboard as before and additionally stream a structured summary generated with the prompt in `prompts/podcasts-summarizer.md`. You'll see a spinner while the LLM works, followed by a live, nicely formatted Markdown summary in the terminal. If the request fails or no key is configured, the CLI falls back to its original clipboard-only behavior.

## Quick Start

Run the CLI with Node directly or through the provided `pnpm` scripts. All examples below assume you are inside the project directory.

### Export transcripts for specific shows

Export every cached transcript whose show title fuzzy-matches your query:

```bash
node extract-transcripts.js sync --show "Hard Fork"
# or with pnpm:
pnpm sync -- --show "Hard Fork"
```

### Export transcripts by station

Restrict exports to stations (publishers) instead of show titles:

```bash
node extract-transcripts.js sync --station "Daily"
```

### Export everything at once

```bash
node extract-transcripts.js --sync
```

The command above scans the Podcasts cache and writes Markdown into `transcripts/` using the `show-date-title.md` slug pattern (for example `hard-fork-2023-11-17-openai-plot-twist.md`). Re-run the command any time you want to refresh new episodes; existing Markdown files are replaced automatically.

### Control timestamps

Include or remove timestamp markers while exporting:

```bash
node extract-transcripts.js sync --no-timestamps --show "Hard Fork"
```

Omit `--no-timestamps` to keep the default minute:second markers.

## Where to find transcripts

Markdown files are written to the repository’s `transcripts/` folder. Keep that directory untracked, and feel free to clear it (`rm -rf transcripts/*`) before a new export if you want a clean slate.

## Help & reference

Every command supports `--help` for full flag details:

```bash
node extract-transcripts.js --help
node extract-transcripts.js help sync
```

## Troubleshooting

- **No transcripts exported**: confirm you have played an episode with transcripts available; otherwise Apple Podcasts will not cache a TTML file.
- **Cache path not found**: make sure you are running on macOS with the Apple Podcasts app. The cache directory does not exist on other platforms.
- **Stale Markdown files**: delete `transcripts/` and re-run the sync command.
