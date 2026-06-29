# File Mode — Header Region & Pill Refinement

**Date:** 2026-06-29
**Status:** Draft

## Summary

Tidy up the File-mode UI so that status is expressed in one place, file
switching behaves predictably during analysis, and the header summary region
shows only the whole-file delivery verdict. No new module is introduced: the
existing `SourceTransportCluster` (the top-left pill) and `FileAnalysisSummary`
(the region under the header) are refined in place.

This slice does **not** add analysis export/import — that was discussed and
deferred.

## Motivation

File mode currently expresses "status" in three overlapping places:

1. The top-left pill (`SourceTransportCluster`) — source switch + status text +
   primary action button.
2. `FileAnalysisSummary` — a status label (`Analyzing file` / `Analyzed file` /
   `File selected`) plus filename, metadata, metric chips, and a progress/Ready
   line.
3. `FileAnalysisHistoryMenu` — per-file status inside the file-list popover.

The pill status, the region status label, and the region progress line all say
the same thing, which is the "messy" feeling we want to remove. At the same
time, switching the active file while another file is analyzing is currently
allowed by the data layer but the pill picks a confusing thing to display.

## Key Facts About the Current Architecture

These are load-bearing for the design and were verified against `main`:

- **Each file session owns its own `FrameIntake`.** `beginFileAnalysis` creates
  `new FrameIntake()` per session. Panels read from
  `fileDisplayIntake = activeFileSession.intake`; analysis frames are written to
  `fileAnalysisIntake = analyzingFileSession.intake`. The two are separate, so
  switching the active file while another analyzes **already repaints the panels
  correctly** to the selected file's data. File switching during analysis is a
  UI-presentation question, not a feasibility question.
- **The region metric chips are authoritative whole-file values.** They come
  from `fileSession.summary` (see the comment at the top of
  `FileAnalysisSummary.jsx`), not the scrub frame. The stats panel in file mode
  reflects the value at the current scrub position. The two are genuinely
  different and the region's whole-file verdict has no other home.
- **Reanalyze is blocked while any analysis is in progress** (`beginFileAnalysis`
  / `reanalyzeActiveFile` early-return with "File analysis already in progress"
  when `analyzingFileId` is set).

## Design

### Pill (`SourceTransportCluster` / `deriveSourceTransportState`)

- The pill keeps its current three-in-one form (FILE source dropdown + status
  text + primary action button). No structural change.
- **Change: the pill follows the active file.** Today `deriveFileState`
  prioritizes the analyzing session (it shows the in-flight `45%` / `STOP` even
  when a different file is active). After this change it reflects the **active**
  file's state, so the pill stays consistent with the panels below it.
- **Greyed-out analyze action.** When another file is analyzing
  (`analyzingFileId` is set and `!== activeFileId`), the pill's primary action is
  disabled whenever that action would start a new analysis — i.e. `REANALYZE`
  (active file `complete`) or `ANALYZE` (active file `ready`). Reanalyze/analyze
  is blocked in that situation and would otherwise only emit an "already in
  progress" status. `STOP` (when the active file is itself the analyzing one) is
  never disabled.

### File switching

- Switching the active file is allowed at any time, including while another file
  is analyzing. No new code is needed for correct panel repaint (per-session
  intakes already handle it); the design simply commits to allowing it.

### Region (`FileAnalysisSummary`)

- **Remove the redundant status label** (`Analyzing file` / `Analyzed file` /
  `File selected`) and the **active-file progress/Ready line**. The pill owns
  status now.
- **Metric chips: keep exactly three, in this order:**
  1. Integrated LUFS
  2. LRA
  3. True Peak Max (dBTP)
  Sample Peak Max is removed from the region (True Peak supersedes it for
  compliance; the detail still lives in the stats panel).
- **Metadata line: unchanged** (`container - audio track - language - codec -
  sample rate - channel layout - duration`).
- **File-list popover trigger moves from the right to the left** of the region.
  The list stays a popover (no always-visible list).
- The history-truncation warning is kept but visually de-emphasized.
- **No extra row is added to the region** for background analysis (see below).

### Background-analysis visibility & control (inside the popover)

Because the pill now follows the active file, switching away from an analyzing
file leaves no ambient cue that analysis is still running. Rather than add a row
to the region:

- **Add a Stop control to the analyzing entry inside the file-list popover.**
  Stop returns that session to `ready` (progress reset, entry kept) — distinct
  from Remove, which deletes the entry. This reuses the existing
  `stopCurrentFileAnalysis` path, which already resets the analyzing session to
  `ready`.
- **Add a lightweight "analyzing" indicator to the popover trigger button**
  (e.g. a small spinner/dot or `· 45%` beside the file count) so the user knows
  a background analysis is running without opening the popover.

### Out of scope

- Analysis result export / import (deferred).
- Any change to the stats panel, DSP, or the Rust analysis pipeline.

## Affected Files (expected)

- `src/lib/sourceTransportState.js` — `deriveFileState` follows the active file;
  surface a disabled flag for REANALYZE when another analysis is in progress.
- `src/components/SourceTransportCluster.jsx` — honor the disabled primary
  action.
- `src/components/FileAnalysisSummary.jsx` — drop status label + progress line;
  reorder/trim chips to Integrated / LRA / TP Max; move the popover trigger left.
- `src/components/FileAnalysisHistoryMenu.jsx` — add Stop on the analyzing
  entry; add the analyzing indicator on the trigger button.
- `src/App.jsx` — wire a stop callback through to the popover; pass the
  disabled/analyzing flags needed by the pill and menu.
- Co-located `*.test.{js,jsx}` updates for the above.

## Testing

- `deriveFileState` unit tests: active-follows behavior when active != analyzing;
  REANALYZE disabled flag when another analysis is in progress.
- `FileAnalysisSummary` tests: status label and progress line are gone; chips
  render in order Integrated / LRA / TP Max with no Sample Peak; trigger is on
  the left.
- `FileAnalysisHistoryMenu` tests: Stop appears on the analyzing entry and
  invokes the stop callback (not remove); trigger shows the analyzing indicator
  when a background analysis is running.
- `npm run check` must pass before merge.
