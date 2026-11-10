# File Maximum Locations: Validation and Live Impact

Date: 2026-11-10
Baseline: `7bbb03c1` (per-channel whole-file peaks)
Scope: File-only maximum-location opt-in, completion payloads, JSON/Markdown and CLI reports.
The implementation is an uncommitted working-tree change on `codex/file-mode-review-20261110`.

## Location contract

- Each channel peak has nullable `samplePeakMaxLocation` and `truePeakMaxLocation`.
- `maximaLocations` contains nullable `samplePeakMax`, `truePeakMax`, `mMaxWindowEnd`, and
  `stMaxWindowEnd`. Global peak locations include zero-based decoded `channelIndex`.
- Coordinates contain `framePosition` and `timeSeconds`, relative to the analyzed track start.
  Sample Peak uses the zero-based sample index; M/S use exclusive window ends.
- True Peak keeps direct samples at `n` and maps evaluated FIR phases 1, 2 and 3 to
  `n + phase/4 - 15.875`, in eighth-frame ticks. A later-processed FIR candidate can occur earlier
  in source time. Equal magnitudes use the earliest source coordinate, then the lowest channel
  index for an exact global tie. Negative start-padding coordinates are retained as Before Start.
- No FIR end padding or new peak candidates are introduced. Existing numerical maxima and their
  precision are preserved. Unavailable values have no invented location; older results use null.
- Integrated, LRA and dialogue metrics have no new locations. No timeline export or jump action.

## Shared paths and Live behavior

This is not an isolated File DSP implementation. `SummaryMeter` is also used by
`audio/capture_summary.rs`, `audio/windows_process_loopback.rs`, and capture-harness evidence replay.
`LoudnessMeter`, `SlidingWindowMax`, and `MeterPipeline` also serve Live. Those users were reviewed.

Only the offline summary constructor and File pipeline constructor enable tracking. Live constructors
leave both location-state pointers empty, allocate no location buffers and advance no location
counter. A const-generic implementation selects the untracked or tracked loop once per PCM push;
the untracked sample and FIR phase loops contain no position updates. Block-finalization retains
an optional-state check, and common internal summary structs gain nullable location slots. Existing
per-channel peak snapshots remain available internally; Live public capture/measurement payloads
and UI gain no fields. This does not claim that a shared-code change has zero binary-layout or
block-dispatch cost.

Tracking uses fixed per-channel buffers and fixed window metadata, allocated at File initialization
or reset. Its storage does not grow with duration. No new sample-loop allocation, lock, syscall,
wall-clock lookup or callback change was introduced. File resets preserve the opt-in.

## Checks completed

- File analysis smoke with staged checksum-verified FFmpeg/ffprobe: 24 tests passed. Includes actual
  eight-channel WAV decoding, the last-sample impulse, mono, silence, tail blocks and differently
  chunked GUI/CLI comparisons of values and locations.
- Capture-harness-enabled location and allocation suite: 16 tests passed. Includes source-order
  ties, FIR phase/delay mapping, negative coordinates, independent direct convolution, window-end
  ties across blocks, silent/unavailable maxima, file reset semantics, Live/File bit identity,
  fixed storage, and warmed audio-callback/position-helper zero-heap-allocation checks.
- Capture evidence recording/replay tests with `capture-harness`: 4 passed.
- CLI regression suite: 159 passed.
- EBU 3341/3342 synthesizable conformance cases: 12 passed; no tolerance changes.
- Focused JavaScript suites including Agent Control report parity and frontend completion-payload
  preservation: 285 tests passed across 8 files.
- Type checking, changed-file ESLint/Prettier, Rust formatting, and workspace/all-target Clippy with
  `capture-harness` and warnings denied passed. No generated contract files were hand-edited.

## Isolated SummaryMeter comparison

The baseline DSP sources were read from `7bbb03c1`; current sources were separately compiled with
`rustc -O` against the same dependency artifacts. The fixture has 960,503 frames at 48 kHz, varied
per-channel phases and a level step. Four rotated process orders, five runs per order and channel,
produce 20 timings per mode/channel. Existing metric and per-channel peak bit patterns match the
baseline exactly in every run, with tracking both disabled and enabled.

Median milliseconds to process approximately 20.01 seconds of PCM:

| Channels | Baseline | Current, Disabled | Current, Enabled | Disabled vs Baseline |
| -------- | -------- | ----------------- | ---------------- | -------------------- |
| 1        | 86.894   | 82.844            | 86.480           | -4.66%               |
| 2        | 137.916  | 137.577           | 153.214          | -0.25%               |
| 8        | 504.164  | 524.500           | 528.542          | +4.03%               |
| 10       | 620.172  | 631.822           | 657.392          | +1.88%               |

The short-fixture measurements varied substantially, which motivated the longer, isolated run.
These are local microbenchmarks of SummaryMeter, not whole-pipeline or hardware capture acceptance.
Default stereo was essentially unchanged; the measured default range across layouts is about
-4.7% to +4.0%. File tracking has additional CPU work; enabled stereo measured about +11.1% against
the baseline. Do not infer zero overhead or improved hardware reliability from these timings.
Raw bit patterns, source hashes, timing runs, compiled source snapshots, and the rerun helper are
under ignored `artifacts/file-maxima-validation/` (`summary-meter-comparison.json`).

## Outstanding hardware acceptance

`npm run smoke:capture -- --wait` was attempted. Its clean-worktree/source-SHA preflight refused
before device discovery, lease acquisition or playback because implementation files and the
preserved discussion spec are uncommitted. That guard was not bypassed. This is **not** a passed
hardware smoke, and device-enumeration/real-capture behavior remain unverified for this change.
The exact-SHA capture harness build and Windows/macOS/Linux capture acceptance still need a clean
candidate revision and the normal rig workflow. No four-hour soak was run. After the clean candidate
is ready, run `npm run soak:capture` and review drift against complete same-platform baselines.

No push or merge was performed; `check:changes` remains a required pre-push/pre-merge step.
The active discussion spec was preserved without editing or adding it to a commit.
