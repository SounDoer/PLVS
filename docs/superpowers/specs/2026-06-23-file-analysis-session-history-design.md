# File Analysis Session History

**Date:** 2026-06-23  
**Status:** Draft

## Summary

Extend `File` mode from a single-file session into an in-memory multi-file session
history. During one app run, users can analyze multiple local files, keep their
completed results, and switch which file result is shown without re-decoding.

This is a session-scoped feature:

- file results and scrub history are retained only until the app closes;
- PLVS still analyzes at most one file at a time;
- switching among completed files is a frontend display operation;
- full cross-restart history, batch queues, and side-by-side comparison remain
  out of scope for this slice.

This spec updates the first `File Analysis Mode` design, which treated File mode
as a single active file slot.

## Motivation

After the first File mode slice, the user can quickly analyze one local file and
scrub its meter history. In real workflows, the next natural behavior is:

```txt
analyze mix_v1.wav
analyze mix_v2.wav
switch back to mix_v1.wav
compare the remembered integrated loudness / true peak / scrub history
remove the failed or irrelevant entries
```

The first version should make that workflow possible without turning File mode
into a batch processor or a comparison dashboard.

## Current Model

The current frontend has:

- one `fileSession` object in `src/App.jsx`;
- one `fileIntakeRef` `FrameIntake` for File mode;
- one active `pendingFilePath` plus `fileRunId` that triggers
  `useFileAnalysisEngine`;
- a `FileAnalysisSummary` banner that displays the current file result above the
  panel layout.

That is enough to preserve the most recent file result across `Live`/`File`
source switches. It cannot preserve multiple analyzed files, because a new file
analysis resets and reuses the single File `FrameIntake`.

The backend already has the right first-version constraint: `EngineSource`
ensures PLVS runs at most one active source (`Live` or `File`) at a time.
Completed file switching does not need backend work, because completed histories
can live in frontend memory.

## Product Model

File mode becomes a session history with one active file entry.

```txt
File mode
  activeFileId -> fileSessionsById[activeFileId]      // displayed entry
  analyzingFileId -> fileSessionsById[analyzingFileId] // current worker, if any
  history list -> [entry A, entry B, entry C]
```

Each history entry represents one analysis attempt, not merely one path. If the
same path is imported twice, PLVS creates two entries so the user can compare
results from before and after an external file change.

### Entry States

```txt
ready      selected/imported, not analyzed yet
analyzing  currently being decoded and metered
complete   has summary metrics and retained scrub history
error      failed probe/decode/analyze with a visible message
```

`ready`, `complete`, and `error` entries can be shown in the history list.
`analyzing` is also listed so progress is visible.

### Retention

The first version retains at most **5** file entries in memory.

When the limit is exceeded:

1. keep the active entry;
2. prefer evicting the oldest non-active `complete` or `error` entry;
3. if all entries are active/analyzing or otherwise protected, defer eviction
   until a removable entry exists.

Errors count toward the limit because they are part of the user's immediate
workflow and explain why a file did not produce results.

### Clear Semantics

The toolbar `Clear` action in File mode clears the current active file entry
only. It should not silently delete the entire file history.

The history UI may expose `Clear all` separately. `Clear all` removes all file
entries, stops any in-progress analysis if needed, and returns File mode to the
empty state.

### Reanalyze Semantics

`REANALYZE` reruns the active entry and overwrites that entry's previous result
and `FrameIntake`.

Opening or dropping the same path again creates a new entry instead of
overwriting an existing one. This keeps explicit import and explicit reanalysis
semantically different:

- `Open file` / drop: create a new history entry and make it active;
- `REANALYZE`: update the active entry in place.

### Switching While Analyzing

The backend still runs only one file worker. The first version allows the user to
switch the displayed active file while another entry is analyzing, but it does
not allow starting a second analysis concurrently.

This requires separating display identity from worker identity:

- `activeFileId` is the entry currently shown in the banner and panels;
- `analyzingFileId` is the entry currently receiving backend progress, frames,
  completion, or error events;
- when the user starts analyzing a newly imported file, both ids initially point
  to that entry;
- if the user switches to another completed entry while analysis continues, only
  `activeFileId` changes.

If this proves too complex during implementation, the fallback is acceptable:
disable switching/deleting while an analysis is running and only allow `STOP`.
The preferred design is to keep completed entries inspectable while the active
worker continues.

### Source Switching

`Live` and `File` remain mutually exclusive active sources.

Switching from File to Live:

- clears Live display/history so file history never bleeds into Live;
- keeps the in-memory File history registry;
- stops an in-progress File analysis, matching the existing single active source
  model.

Switching from Live back to File:

- clears Live history;
- restores the active file entry, if any;
- does not re-decode completed entries.

## UI Design

The File result banner remains outside the panel layout:

```txt
Header
File Result / History Banner
Panels
Footer
```

The banner is the home for File history controls. It is not a module and does
not participate in `SplitLayout`, panel persistence, or the Modules popover.

### Banner Contents

The banner should show:

- current file name and track metadata;
- delivery metric chips from the active entry's summary;
- warning chip/text when the active entry's scrub history is truncated;
- a compact history selector on the right.

### History Selector

The selector should be visible in File mode whenever at least one entry exists.
The trigger can show a compact count such as `3 files`.

The dropdown/list should show each entry with:

- file name;
- state (`Ready`, percentage, `Done`, `Error`);
- duration when known;
- analyzed/imported time or a short relative ordering indicator if useful;
- active marker;
- entry actions for `Show`, `Reanalyze`, and `Remove`.

The first implementation can keep the list simple. Search, grouping, sorting
options, and drag reordering are out of scope.

### File Pill

The File transport pill should remain generic. It must not show the file name.
It shows only state, progress, or media time:

```txt
empty:       [ File v | No file ]  [ ANALYZE   ]
ready:       [ File v | Ready ]    [ ANALYZE   ]
analyzing:   [ File v | 42% ]      [ STOP      ]
complete:    [ File v | 00:02:03 ] [ REANALYZE ]
scrubbed:    [ File v | 00:01:24 ] [ RESULT    ]
```

## Frontend Architecture

Introduce a file session registry owned by the app shell or a focused hook.

```txt
fileSessionsById: Map<string, FileSessionEntry>
activeFileId: string | null      // currently displayed entry
analyzingFileId: string | null   // currently running worker entry
activeFileSession: FileSessionEntry | null
analyzingFileSession: FileSessionEntry | null
```

Each `FileSessionEntry` should contain:

```txt
id
path
fileName
state
metadata
summary
progress
error
intake: FrameIntake
historyTruncated
historyCoveredMs
createdAt
analyzedAt
```

`FrameIntake` stays reusable and instance-based. The main display chooses the
active intake:

```txt
sourceMode === "live" -> liveIntakeRef.current
sourceMode === "file" -> activeFileSession?.intake
```

The existing `useSnapshot`, `useLoudnessHistory`, panel components, and
`AudioDataContext` should continue to consume one active intake. The registry
only changes how File mode selects that intake.

## Analysis Engine Adaptation

`useFileAnalysisEngine` should stop assuming there is one global file session.
It should receive enough identity to update the correct entry:

```txt
enabled
sessionId
filePath
runId
intake
updateFileSession(sessionId, patch | updater)
```

On an explicit analysis run:

1. reset only that entry's `intake`;
2. set the entry to `analyzing`;
3. set `analyzingFileId` to that entry id;
4. probe the path and store metadata on that entry;
5. start the existing backend file worker;
6. apply emitted frames to that entry's `intake`, even if another entry is
   currently displayed;
7. on completion, store summary and truncation info on that entry and clear
   `analyzingFileId`;
8. on error, store the visible error on that entry and clear `analyzingFileId`.

Events should be filtered by a frontend session id in addition to path wherever
possible. If backend payloads remain path-only in the first implementation, the
frontend must guard against stale events using the active run's `{ sessionId,
path, runId }` tuple.

## Backend Design

No backend architectural change is required for the first version.

PLVS continues to use:

- `file_analysis_probe`;
- `file_analysis_start`;
- `file_analysis_stop`;
- `file-analysis-progress`;
- `file-analysis-completed`;
- `file-analysis-error`.

The backend still owns one active File worker at a time. Multi-file retention is
implemented by retaining completed frontend `FrameIntake` instances and summary
metadata.

If future versions add batch queues or parallel file analysis, then `EngineSource`
and `FileAnalysisSession` will need a separate design.

## Persistence

The first version is memory-only. Closing the app discards:

- the file history list;
- all `FrameIntake` histories;
- all completed summaries in the registry.

Do not store full `FrameIntake` history in plugin-store or localStorage.

Future work may persist a lightweight summary-only list:

```txt
path
fileName
summary
metadata
analyzedAt
```

Such entries would not have scrub history after restart and should be clearly
marked as summary-only. That is out of scope for this slice.

## Implementation Slices

### Slice 1: Registry Model

Add the registry and active id while preserving current single-file UI behavior.

Likely files:

- `src/App.jsx`
- optional `src/hooks/useFileSessionRegistry.js`
- optional `src/lib/fileSessionRegistry.js`
- registry unit tests

Verification:

- creating entries assigns stable ids;
- same path imported twice creates two entries;
- active entry selection works;
- active display identity and analyzing worker identity can differ;
- retention limit removes the expected entry.

### Slice 2: Per-Entry Intake

Give each file entry its own `FrameIntake`, and make File display bind to the
active entry's intake.

Likely files:

- `src/App.jsx`
- `src/hooks/useFileAnalysisEngine.js`
- `src/hooks/useFileAnalysisEngine.test.jsx`

Verification:

- analyzing file B does not erase completed file A;
- switching from B back to A restores A's history without backend calls;
- frames from an in-progress worker continue updating the analyzing entry when a
  different completed entry is displayed;
- truncation state is stored per entry.

### Slice 3: Analysis Lifecycle

Adapt `beginFileAnalysis`, `REANALYZE`, `STOP`, and drag/drop to registry
semantics.

Likely files:

- `src/App.jsx`
- `src/lib/sourceTransportState.js`
- `src/lib/sourceTransportState.test.js`

Verification:

- `Open file` creates a new active entry;
- `REANALYZE` overwrites the active entry;
- `STOP` stops the current worker and marks only the analyzing entry as ready or
  stopped;
- same-path imports remain separate entries.

### Slice 4: History UI

Add the history selector to the File result banner.

Likely files:

- `src/components/FileAnalysisSummary.jsx`
- new `src/components/FileAnalysisHistoryMenu.jsx`
- component tests

Verification:

- list renders active, complete, analyzing, and error entries;
- selecting an entry updates the displayed panels;
- removing current entry selects the most recent remaining entry;
- removing the last entry returns File mode to empty.

### Slice 5: Clear and Clear All

Finalize deletion semantics.

Likely files:

- `src/App.jsx`
- `src/components/FileAnalysisHistoryMenu.jsx`

Verification:

- toolbar `Clear` removes only the active entry;
- history `Clear all` removes every entry;
- clear actions do not affect Live history.

## Non-Goals

- Persisting file history across app restarts.
- Persisting scrub history or `FrameIntake` contents.
- Batch importing multiple selected files.
- Dragging multiple files to create a queue.
- Running multiple file analyses concurrently.
- Side-by-side comparison panels.
- Manual audio track selection.
- Search, tagging, or long-term library management.

## Risks and Mitigations

### Memory Growth

Each retained entry can hold a full bounded history and visual history. Keep the
first version capped at 5 entries and make eviction deterministic.

### Stale Paths

Paths may be moved, deleted, or replaced after analysis. Completed entries remain
valid because their results are already in memory. Reanalysis may fail and should
update only that entry to `error`.

### Stale Events

The same path can appear in multiple entries. Event handling must not update an
old or wrong entry. Prefer session/run identity in the frontend; consider adding
an optional backend `run_id` later if path-only filtering proves fragile.

### Display Rebinding

Panels assume one active intake. Switching entries should only rebind the active
intake and reset scrub/display state as needed; it should not mutate inactive
entries.

### Clear Confusion

Because there will be multiple entries, destructive actions must be scoped and
labeled clearly. Toolbar `Clear` means current entry; `Clear all` must be
separate.

## Acceptance Criteria

- A user can analyze at least two files in one app session and switch between
  their retained results without re-decoding.
- The File banner shows the active file's metadata, summary metrics, and history
  selector.
- The File transport pill never displays file names.
- Opening/dropping the same path twice creates two distinct history entries.
- `REANALYZE` updates the active entry in place.
- Toolbar `Clear` removes only the active file entry.
- The app keeps at most 5 file history entries.
- Closing and reopening the app starts with no file history.
- Existing Live mode behavior and panel layout persistence are unchanged.
