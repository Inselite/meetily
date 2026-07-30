# Fork: speaker-display

This fork of [Zackriya-Solutions/meeting-minutes](https://github.com/Zackriya-Solutions/meeting-minutes)
carries one patch: **display diarized speaker labels** from the
`transcripts.speaker` column, which upstream's own migration
(`20251110000001_add_speaker_field.sql`) creates but which stock CE never
reads. The column is populated externally by
[meetily-diarize](https://github.com/Inselite/meetily-diarize) — this fork
adds no diarization of its own.

## What the patch does (21 lines, 9 files)

- Rust: `Transcript` / `MeetingTranscript` structs gain an
  `Option<String> speaker` field (upstream's `SELECT *` already fetches the
  column; it was dropped at struct-mapping time).
- Frontend: the field is carried through the TypeScript types and both
  segment projections, and rendered as a bold blue `Name:` prefix per
  segment in the stored-transcript view.
- Clipboard copies and the app's own summary payload include the speaker
  labels too. Segments with NULL speaker render exactly as stock.

## Build (Apple Silicon)

```sh
brew install cmake node pnpm && rustup toolchain install stable
cd frontend
bash build-gpu.sh
```

`build-gpu.sh` first builds the `llama-helper` sidecar and copies it to
`src-tauri/binaries/` — a bare `pnpm tauri:build` fails without that step.
The final DMG packaging step needs Finder scripting and fails in headless
shells; ignore it. The app bundle is at
`target/release/bundle/macos/meetily.app` (workspace root) — copy it to
`/Applications`.

## Caveats

- The build is ad-hoc signed: macOS re-prompts microphone and
  screen-recording permissions once.
- Don't `brew upgrade` the meetily cask over this build.
- Upstream's Retranscribe deletes and re-inserts transcript rows without
  speaker labels (and with fresh ids) — re-run diarization afterwards.

## Updating against upstream

```sh
git fetch upstream && git rebase upstream/main speaker-display
cd frontend && bash build-gpu.sh
```

The patch touches no upstream logic (fields and rendering only), so rebases
should stay trivial.
