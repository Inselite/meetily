# Fix plan: speaker rename and transcription-language recents

## Constraints and implementation order

Only the fork-added surfaces should change. Keep the existing 37-entry dialog language list and the 101-entry Settings list as their respective full catalogs. There is one deliberate scope change: a recent selected from the 101-entry Settings catalog becomes selectable in the 37-entry Import and Retranscribe dialogs' recent group. This intentionally broadens those dialogs through recents only; every catalog entry is a valid Whisper language code accepted by the transcription backends. Implement the shared utilities first, then their consumers, so each step has a compilable dependency path.

Estimated total production diff: about 180–260 changed lines across 7–9 files, plus about 40–80 lines of Rust `#[cfg(test)]` coverage for the pure `speakers.txt` resolver. There is no frontend unit-test harness in `frontend/package.json`, so the plan does not add Vitest/Jest/Testing Library tests or related configuration. Most churn is small and local; moving the 101-entry array is explicitly avoided.

## 1. Make transcription MRU updates coherent within one window

**Files/functions:** update `frontend/src/hooks/useRecentTranscriptionLanguages.ts`, specifically `writeToStorage`, the subscription effect, and `addRecent`.

**Chosen approach:** retain `localStorage` as the source of persistence and the native `storage` listener for other documents, and add a module-private, namespaced custom `window` event for same-document updates. Make `addRecent` read the latest persisted list at mutation time, prepend/deduplicate/trim that value, write it, update its own state, and dispatch the custom event carrying (or causing listeners to re-read) the committed list. Every mounted instance subscribes to both events.

The bug is cross-instance divergence, not a stale React closure: `addRecent` already uses a functional updater, but each mounted hook instance seeds its state from storage only at mount and does not learn about same-document writes. Its `writeToStorage` call therefore overwrites storage from that instance's independently stale view. Reading storage at mutation time prevents the clobber, and the custom event makes all same-document instances converge without introducing application-wide state.

The write helper should report/return the normalized committed values even when persistence is unavailable, so all mounted hooks still converge for the current page. Preserve the existing rules: maximum five, no duplicates, ignore non-strings, empty codes, `auto`, and `auto-translate`; malformed or inaccessible storage yields an empty list rather than breaking a picker.

**Rejected alternatives:**

- `BroadcastChannel` is unnecessary and has more lifecycle/platform surface; the native `storage` event already covers other documents and a custom event covers this document.
- A React context or external store would require provider/layout changes well outside these fork features.
- Parameterizing and replacing upstream `useRecentLanguages.ts` is deferred: that hook also owns pinned-summary behavior and normalization. Entangling it with this small transcription-only fix would increase conflicts when rebasing upstream for little immediate reuse.

**Edge cases:** two mounted pickers adding different codes sequentially must preserve both in MRU order; repeated selection moves a code to the front once; corrupt JSON, quota/security errors, SSR/no `window`, and same-document events emitted by the writing hook must not throw or loop (event handlers update state only and do not write again).

**Verification:** run `npx tsc --noEmit` and the frontend build. Manually mount/open two consumers that were both seeded before either mutation, add A from the first, then add B from the second, and verify both expose `[B, A]` and storage matches (the old implementation would let the second instance clobber A). Also manually check dedupe, cap-at-five, excluded automatic modes, malformed storage recovery, and native `storage`-event handling. No frontend unit tests or test-harness additions are planned.

## 2. Share recent-language grouping and deliberately expose catalog recents

**Files/functions:** add a small pure helper in `frontend/src/lib/transcription-language-recents.ts` (for example `groupTranscriptionLanguages(recents, allOptions, nameOptions)`); update the derived `recentLanguages`/`recentCodes` logic and grouped JSX inputs in `frontend/src/components/ImportAudio/ImportAudioDialog.tsx` and `frontend/src/components/MeetingDetails/RetranscribeDialog.tsx`; update the derivation and “All languages” filter in `frontend/src/components/LanguageSelection.tsx`.

**Chosen approach:** extract the duplicated derivation, not an entire shared Select component. The helper returns ordered resolved recents and the non-recent options. It accepts separate `allOptions` (what that picker offers in its full list) and `nameOptions` (the catalog used to resolve MRU codes). Export the existing 101-entry Settings `LANGUAGES` array from `LanguageSelection.tsx` under a specific name (for example `SETTINGS_TRANSCRIPTION_LANGUAGES`) and use it as the dialogs' `nameOptions`; keep `@/constants/languages` as each dialog's 37-entry `allOptions`. Thus a language selected in Settings remains visible and selectable in a dialog's recent group even when it is outside that dialog's 37-entry full list. This is a deliberate broadening of the dialogs' selectable languages, limited to recents, and is safe because all 101 entries are Whisper codes accepted by the backends. The helper removes every displayed recent code from “All languages,” fixing duplicate option values in Settings and retaining the no-duplicate behavior in both dialogs.

For Parakeet, derive recents only after applying its available-options restriction, or skip recent grouping entirely as today. Automatic modes remain outside recents. Memoize the helper result where useful so Sets/arrays are not rebuilt on unrelated renders.

**Rejected alternatives:**

- Do not replace both full catalogs with one union. The deliberate dialog broadening is confined to the recent group; replacing the 37-entry full lists or relocating/rewriting the 101-entry Settings array would create a larger, conflict-prone patch.
- Do not resolve unknown codes with raw-code labels or `Intl.DisplayNames`; the existing Settings catalog provides stable English labels and avoids browser/runtime variation.
- Do not extract the dialogs' full Radix Select JSX into a shared component. Their surrounding conditions and likely upstream evolution differ; a pure grouping helper removes the error-prone logic duplication with much less rebase friction.

**Edge cases:** MRU order is preserved; unknown/stale codes not present in the 101-entry name catalog are ignored; `auto`/`auto-translate` are never repeated in a recent group; recents among the dialogs' 64 otherwise-hidden languages appear only in “Recently used”; no code occurs twice in one Select; Parakeet shows no empty recent group.

**Verification:** run `npx tsc --noEmit` and the frontend build. Manually exercise a recent in the 37-entry list, a recent only in the 101-entry catalog, duplicate recents, unknown codes, and automatic modes. Select one of the extra Settings languages, open Import and Retranscribe in the same Tauri window, and verify it appears immediately and is selectable in both recent groups; verify Settings has one DOM option per value and Parakeet renders no empty recent group. No frontend unit tests or test-harness additions are planned.

**Dependency:** this consumes the synchronized hook from step 1 so simultaneously mounted pickers update immediately.

## 3. Make repository rename collision-safe and atomic

**Files/functions:** change `TranscriptsRepository::rename_speaker` in `frontend/src-tauri/src/database/repositories/transcript.rs`; add a small result enum/struct near the repository if needed by the API.

**Chosen approach:** add an `allow_merge: bool` argument and perform the collision lookup and update in one SQL transaction. Because identical trimmed old/new names are rejected at the command boundary, the collision check is simply `SELECT EXISTS(SELECT 1 FROM transcripts WHERE meeting_id = ? AND speaker = ?)` using `new_speaker`; no exclusion for rows named `old_speaker` is needed. If the target exists and `allow_merge` is false, return a distinct `Collision` outcome without changing rows. If allowed, update all exact `old_speaker` rows and return the affected count and folder. Return a distinct no-match outcome/count when no source rows exist. Fetch the meeting folder in the same transaction/result path so the API has a consistent outcome.

Exact stored speaker equality should remain the rule; do not introduce case folding or whitespace normalization in SQL. Trimming remains at the command boundary. An intentional merge is irreversible in the database, but is possible only after explicit UI confirmation.

**Rejected alternatives:**

- A database uniqueness constraint cannot represent many transcript segments belonging to one speaker and would require migration churn.
- A frontend-only collision check is race-prone and cannot protect other command callers.
- Always blocking collisions would eliminate the valid “merge split diarizer clusters” workflow; always confirming before every rename adds needless friction.

**Edge cases:** source absent, target present/absent, source and target equal after trimming, multiple target/source segments, meeting absent, and two concurrent rename attempts. Treat identical old/new names as a validation/no-op error before the transaction rather than reporting a successful rename or enrollment.

**Verification:** manually verify against a disposable meeting/database that an ordinary rename updates only the requested meeting, a default collision leaves both clusters untouched, `allow_merge` updates the source cluster, no-match reports zero, and the same speaker name in another meeting does not collide. Inspect/log the generated query parameters as needed to confirm the plain target-name `SELECT EXISTS` is meeting-scoped. Run `cargo check` and `cargo fmt --check`; do not add repository/SQL tests, because Rust `#[cfg(test)]` additions in this patch are reserved for the pure resolver in step 4.

## 4. Harden `api_rename_speaker` and write meaningful enrollment mappings

**Files/functions:** update `api_rename_speaker` in `frontend/src-tauri/src/api/api.rs`; add private helpers beside it for speaker-name validation and `speakers.txt` original-label resolution (and helper unit tests in the same module or a narrowly scoped module).

**Chosen approach:** accept `allow_merge` from the UI and map the repository outcome to a typed JSON response union: `status: "collision"` with no mutation, or `status: "success"` with `updated_segments` and `enrollment_queued`. A no-match is an error (or an explicit non-success status handled identically by the UI), and must return before any filesystem work. This keeps collision an expected, inspectable condition while operational/database failures remain rejected Tauri commands.

Validate both trimmed fields before logging or querying. Reject either field if it is empty or contains any of `=`, `\n`, or `\r`; do not sanitize, because silently changing a requested display name is surprising and can create collisions. Reject identical trimmed names. Use one generic safe validation message without echoing control characters.

Only attempt enrollment when `updated_segments > 0` and a non-empty meeting folder exists. Before append, read existing `speakers.txt` if present and resolve `old_speaker` back through prior `Name=Label` mappings. Treat the mappings as a directed multimap: for every exact left-hand match, follow every branch until it reaches a label with no left-hand match, detect cycles, and return all distinct reachable terminal diarizer labels in deterministic file/first-discovery order. Multiple mappings for the same left-hand name are all meaningful after merges; there is no “latest line wins” rule. For example, `Bob=Speaker 1` plus `Bob=Speaker 2`, followed by renaming Bob to Robert, appends both `Robert=Speaker 1` and `Robert=Speaker 2` (once each).

Append one `new_speaker=resolved_terminal_label` line per distinct terminal, never `new_speaker=old_speaker` blindly. In particular, a confirmed merge appends these `new_speaker=resolved(old_speaker)` lines; it does not rewrite, replace, or remove the merge target's existing lines. Preserving those target lines is what allows a later rename of the merged display name to reach every original diarizer label. Ignore unrelated well-formed lines; if the file is missing or there is no left-hand match, treat the current old label as the sole terminal. For an unreadable file, malformed mapping on a reachable branch, cycle, open failure, or write failure, leave the database rename successful but return `enrollment_queued: false` and log the reason; do not append a partial or knowingly invalid mapping set. Build the complete append payload first and use existing append behavior rather than rewriting the sweep-owned file.

The resolver guarantees chaining and merge provenance while the pending mapping file exists (for example `Bob=Speaker 1` and `Bob=Speaker 2`, then `Robert=Speaker 1` and `Robert=Speaker 2`). If the external sweep has already archived the file, no local provenance remains; using the current label is the only available fallback and is valid if the sweep has already relabeled that meeting's diarization artifacts. Persisting a new provenance table/sidecar solely for that timing window is out of scope and would not be a minimal patch.

**Rejected alternatives:**

- Sanitizing delimiters/control characters risks renaming to a value the user did not approve.
- Rewriting/deduplicating `speakers.txt` risks racing or violating the external sweep's queue/archive contract.
- Rolling back the database rename when enrollment cannot be queued couples a useful UI rename to optional external profile enrollment and is difficult to make atomic across SQLite and the filesystem.

**Edge cases:** zero rows, missing/blank folder, missing file, absent terminal newline, CRLF input, unrelated or malformed lines, repeated identical edges, multiple distinct edges for one left-hand name, converging/diverging multi-hop chains, cycles, non-UTF-8/unreadable content, and a successful DB merge whose enrollment write fails. Validation must prevent line or field injection from either old or new name.

**Verification:** add Rust `#[cfg(test)]` tests only for the pure `speakers.txt` resolver. Cover direct and multi-hop resolution, multiple terminals from duplicate left-hand names, branch convergence/deduplication, deterministic order, malformed reachable mappings, CRLF, and cycles. Manually verify command validation rejects empty/equal names and `=`, `\n`, or `\r` in either field; zero rows and collisions do not create/modify `speakers.txt`; a normal rename writes `Bob=Speaker 1`; a confirmed merge preserves the target's lines while appending one line per source terminal; a later chained rename appends all distinct terminals; and write failure returns success with `enrollment_queued: false`. Run the resolver tests, `cargo fmt --check`, and `cargo check`.

**Dependency:** requires the transactional outcomes from step 3.

## 5. Add explicit merge confirmation and rename-result toasts

**Files/functions:** update `renameSpeaker` and its local response types in `frontend/src/components/VirtualizedTranscriptView.tsx`; import `toast` from `sonner`. Use native `window.confirm` for merge confirmation. This mechanism is already used by `frontend/src/components/TranscriptRecovery/TranscriptRecovery.tsx`, proving it works in the Tauri webview; do not add or condition this work on another dialog framework.

**Chosen approach:** invoke `api_rename_speaker` first with `allowMerge: false` and a typed response. On `status: "collision"`, show a warning confirmation explaining that the target already exists, the operation merges all segments into it, and undo requires re-diarization. Cancel leaves UI and backend unchanged; confirm retries once with `allowMerge: true`. Update `speakerRenames` only after a success with `updated_segments > 0`.

Show `toast.error("Failed to rename speaker", { description })` for rejected commands, invalid/no-match outcomes, or malformed responses. On full success, show a concise success toast including the affected segment count. If the rename succeeded but `enrollment_queued` is false, use `toast.warning` saying the displayed transcript was renamed but voice-profile enrollment was not queued; this is a partial success and must not be presented as failure. A confirmed merge uses the same success/partial rules. Preserve console logging only as supplemental diagnostics.

Prevent duplicate submissions while an invocation/confirmation retry is in flight (component-level pending state or an in-flight ref keyed by old label), so Enter/blur cannot produce duplicate file lines or conflicting retries.

**Rejected alternatives:**

- Silently blocking collisions gives no route for intentional merges.
- Automatically merging after a generic success toast does not communicate the destructive consequence.
- Treating `enrollment_queued: false` as total failure is inaccurate because the database/UI rename has already committed.

**Edge cases:** user cancels merge; confirmed merge fails on retry; component unmounts during the promise; repeated Enter/blur; zero updated segments; pluralization of the segment count; and missing meeting ID. No optimistic local mapping should survive a backend failure.

**Verification:** run `npx tsc --noEmit` and the frontend build. Manually verify ordinary success updates labels and toasts; collision does not mutate before `window.confirm`; cancel performs no retry; confirm sends `allowMerge: true`; rejected/no-match or malformed responses show an error; `enrollment_queued: false` shows a warning while retaining the rename; and duplicate submission is suppressed. Exercise a normal rename, collision cancel/confirm, a multi-label merge chain, and a folder made unwritable/unavailable. No frontend unit tests or test-harness additions are planned.

**Dependencies:** depends on steps 3–4's response contract and validation. It completes findings 1 and 4 without changing the existing transcript rendering architecture.

## Finding traceability checklist

Use this list during implementation and the final regression pass:

1. **Silent merge** — steps 3 and 5 add the transactional collision outcome, explicit native confirmation, and opt-in retry.
2. **`speakers.txt` appended when `updated_segments == 0` / chained labels lost** — step 4 gates filesystem work on a positive update count and resolves all distinct reachable terminal labels, including merged branches.
3. **`=`/newline injection** — step 4 rejects `=`, `\n`, and `\r` in both trimmed speaker fields before logging, SQL, or file work.
4. **Silent UI failures** — step 5 handles typed outcomes and rejected/malformed commands with success, warning, or error toasts.
5. **Duplicate options in the Settings picker** — step 2 removes displayed recents from “All languages.”
6. **Recents dropped in dialogs (37 vs. 101 catalog, and Parakeet empty-group behavior)** — step 2 resolves dialog recents against the 101-entry name catalog, deliberately makes them selectable, and suppresses invalid/empty Parakeet recent groups.
7. **Same-document synchronization** — step 1 reads storage at mutation time and broadcasts a namespaced same-document custom event.
8. **Hook/JSX duplication** — steps 1 and 2 keep one shared transcription-recents hook behavior and centralize duplicated grouping/filter derivation in a pure helper without introducing a conflict-prone shared Select component.

## Final regression pass

Check off all eight findings above. Review the resulting diff against commits `cc133a7` and `6beab6a` to ensure changes remain confined to fork-added code plus the one small pure helper. Confirm no schema migration or sweep-file rewrite was introduced. Confirm the only language-scope expansion is the intentional ability to select 101-catalog recents from the dialogs; their full “All languages” catalogs remain unchanged. Run `npx tsc --noEmit`, the frontend build, the pure resolver's Rust tests, `cargo fmt --check`, and `cargo check`. Then perform one end-to-end Tauri session with Settings, Import, and Retranscribe mounted/opened in sequence, including same-document sequential MRU writes, and with a normal speaker rename, collision cancel, intentional merge, and chained rename across multiple original diarizer labels.
