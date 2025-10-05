# Listening Status Enhancements Plan

## Step 0 – Repo & Environment Preparation
- [ ] 0.1 Ensure local cache and transcripts directories are clean or backed up before testing; avoid modifying `transcripts/` commits.
- [x] 0.2 Verify `sqlite3` CLI availability; install via Homebrew if missing.
- [ ] 0.3 Optional: capture baseline run (`node extract-transcripts.js --timestamps`) for comparison once new logic lands.

## Step 1 – Investigate Playback Metadata in MTLibray.sqlite
- [x] 1.1 Use `sqlite3` to inspect `ZMT*` tables (`.schema`, `LIMIT 5` queries) focusing on `ZMTEPISODE` playback-related columns (`ZPLAYSTATE`, `ZUSERPLAYSTATE`, `ZPLAYBACKPOSITION`, `ZLASTPLAYEDDATE`, etc.).
- [x] 1.2 Cross-check a few known episodes (played, in-progress, unplayed) by matching transcript identifier to confirm how Apple flags “completed” vs “in progress”. Document value meanings (0/1/2 or enums) in the plan notes.
- [x] 1.3 Decide which minimal columns cover our three scenarios: fully listened, partially listened, not started. Confirm any duration field needed to compute completion ratio.
- [x] 1.4 Capture SQL snippets (without shipping secrets) to reuse in the metadata loader.
	- Notes: `ZPLAYSTATE` values observed — `0` = unplayed, `1` = in-progress (non-zero `ZPLAYHEAD` < `ZDURATION`), `2` = fully played (zero playhead, non-null `ZLASTDATEPLAYED`). `ZPLAYHEAD` appears to be seconds. `ZDURATION` indicates episode length in seconds. `ZLASTDATEPLAYED` is a Cocoa timestamp.

## Step 2 – Extend Metadata Loader to Expose Listening Status
- [x] 2.1 Update the SELECT list in `lib/load-podcast-metadata.js` to include the chosen playback columns (e.g. `episode.ZUSERPLAYSTATE`, `episode.ZPLAYBACKPOSITION`, `episode.ZDURATIONINSECONDS`).
- [x] 2.2 Ensure chunk query continues to deduplicate identifiers; escape handling stays intact.
- [x] 2.3 Build a helper that interprets raw DB values into a normalized object: `{ playState: 'played'|'inProgress'|'unplayed', playedSeconds, durationSeconds, lastPlayedAt }`.
- [x] 2.4 Store the normalized status in each metadata entry so downstream consumers can key off human-friendly fields.
- [x] 2.5 Add cautious logging or warnings if expected columns are NULL; keep fallbacks for unknown schema versions.

## Step 3 – Surface Status in Markdown Output
- [x] 3.1 Update `buildEpisodeMarkdown` to accept new status data and render a concise section (e.g. “## Listening status” with state label, completion %, last played timestamp).
- [x] 3.2 Preserve backward compatibility: if status unavailable, omit the section to avoid noisy “unknown” text.
- [x] 3.3 Consider highlighting partially played episodes (e.g. bold text or note to resume at timestamp) while staying within Markdown simplicity.
- [x] 3.4 Verify `resolveFallbackContext` still works when metadata absent (deleted caches) so existing markdown keeps previous status snapshot.

## Step 4 – Skip Fully Played Transcripts During Batch Runs
- [x] 4.1 Add CLI flag parsing (`--include-played`) to override skip behaviour; default run should exclude `playState === 'played'`.
- [x] 4.2 When iterating TTML files, evaluate metadata status; if played and no override, log a “Skipping <show> – already played” message and continue.
- [x] 4.3 Expose a dry-run/summary counter (processed vs skipped) to make output actionable.
- [x] 4.4 Ensure single-file mode still processes regardless of status (explicit user intent).

## Step 5 – Persist Status for Episodes Removed from Cache
- [x] 5.1 While updating existing markdown via `prepareExistingMarkdown`, inject the most recent status metadata so transcripts retain state even when TTML gone.
- [x] 5.2 Introduce a lightweight manifest (e.g. `transcripts/.listening-status.json`) mapping identifier → status+filename. Update it after each batch so future runs know which markdowns correspond to played episodes despite missing TTML.
- [x] 5.3 When manifest entry exists but cache file missing, skip reprocessing yet keep markdown untouched. Optionally surface a reminder in CLI output (“cache missing; retained archived transcript”).
- [x] 5.4 Provide pruning guidance (manual or CLI flag) if user wants to purge old played transcripts later.

## Step 6 – Validation & Regression Checks
- [ ] 6.1 Run batch export twice: first default (expect skips), then with `--include-played` to confirm override works and counts line up. _(Pending – not executed in this session.)_
- [ ] 6.2 Spot-check generated markdown for each play state category; confirm status section accurate and formatting consistent. _(Pending manual verification.)_
- [ ] 6.3 Simulate missing cache by moving a TTML aside, re-run, ensure transcript remains and manifest marks it as archived. _(Pending manual verification.)_
- [ ] 6.4 Monitor log output for noisy warnings; adjust messaging level if repeated per file. _(Pending manual verification.)_

## Step 7 – Documentation & Follow-ups
- [x] 7.1 Update `README.md` with new CLI flag, status section example, and note about manifest behaviour.
- [x] 7.2 Document any new environment variables or assumptions (none expected unless we add opt-in env toggles).
	- Notes: No new environment variables were introduced.
- [ ] 7.3 Consider future enhancements: expose status to potential web UI, add filters for in-progress episodes, or emit JSON summary for external tooling.
- [ ] 7.4 After validation, stage and commit changes using a conventional message (likely `feat: track listening status in transcripts`).
