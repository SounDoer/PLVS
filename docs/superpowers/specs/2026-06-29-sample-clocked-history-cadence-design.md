# Sample-Clocked History Cadence

**Date:** 2026-06-29
**Status:** Phase 1 landed (commit `6871ac5`). This document retroactively records
that fix and plans the optional follow-up (Phase 2-4). The user-visible
file-duration compression bug is already resolved.

## Summary

Make PLVS history production explicitly sample-clocked instead of accidentally
dependent on incoming PCM chunk size.

The current realtime path works because live device chunks are small and steady:
the existing `MeterPipeline` sees enough pushes that its loudness, history, and
frame throttles stay close to the intended cadence. File analysis exposed a
hidden coupling: ffmpeg stdout reads can be much larger than a history period, so
one pipeline push can cover more than one loudness/history interval. When the
frontend then maps history index `i` to `i * HIST_SAMPLE_SEC`, file-mode time
axes can compress.

The target model is:

```txt
PCM source
  -> sample-clocked blockization
  -> metric accumulation
  -> history samplers
  -> UI frame batching
```

Live and File may differ in source, decode speed, and UI batching, but neither
mode should let source read size decide how many history rows exist.

## Motivation

PLVS already has clear cadence concepts, but they are spread across layers:

- `MeterHistoryEntry` is the main aligned history row, documented as `~10 Hz`.
- `HIST_SAMPLE_SEC = 0.1` makes frontend loudness, waveform, viewport, and scrub
  math treat main history as a 100 ms grid.
- visual history uses `VISUAL_HIST_SAMPLE_SEC = 0.04` / `VISUAL_EMIT_MS = 40`
  for a separate ~25 Hz stream.
- `LoudnessMeter` naturally closes loudness blocks every ~100 ms.
- `FRAME_EMIT_MS = 16` is only a UI delivery cadence, not an analysis cadence.

These are valid choices, but the current `MeterPipeline` mixes them with input
push cadence. That is safe enough for live capture, where chunks are small. It
is fragile for file analysis, where a decode read can be 170 ms or more of
audio.

The recent `speech_pure.wav` failure is the concrete symptom:

```txt
file duration:        ~101.26 s
ffmpeg read chunk:    64 KiB = 8192 stereo frames @ 48 kHz = ~170.67 ms
old history rows:     ~594
frontend axis:        (594 - 1) * 0.1 s = ~59.3 s
expected axis:        ~101 s
```

The summary duration was correct because it came from probe/sample counts. The
panel time axis was wrong because history row count no longer matched the
frontend's 10 Hz contract.

## Definitions

### Main History

The `MeterHistoryEntry` stream used for:

- Loudness History curves
- main snapshot/scrub timeline
- waveform min/max entries stored with the loudness row
- fields needed for `audioSnapRef` replay

Cadence: approximately one row per 100 ms of media/session time.

Frontend sample interval: `HIST_SAMPLE_SEC = 0.1`.

### Visual History

The `VisualHistEntry` stream used for higher-rate visual panels and keyed visual
analysis history.

Cadence: approximately one row per 40 ms of media/session time.

Frontend sample interval: `VISUAL_HIST_SAMPLE_SEC = 0.04`.

### UI Frame

An `AudioFramePayload` delivery to the frontend. A frame may carry:

- current meter readings;
- zero or one live history tick;
- a batch of file-mode history ticks;
- current spectrum/vectorscope results;
- visual history ticks or batches.

Frame cadence should be optimized for UI responsiveness and backpressure. It
must not define analysis cadence.

## Current Model

### Live

```txt
device PCM chunks
  -> MeterPipeline::push_pcm_f32_with_requests(...)
  -> LoudnessMeter closes ~100 ms blocks
  -> HIST_EMIT_MS wall-clock gate queues main history
  -> VISUAL_EMIT_MS wall-clock gate queues visual history
  -> FRAME_EMIT_MS wall-clock gate emits UI frames
```

This works because live chunks arrive frequently. `HIST_EMIT_MS = 95` is a
tolerance gate: it allows a nominal 100 ms block to emit even when wall-clock
timing lands slightly under 100 ms. It is not intended to be a sampler that
reconstructs missing 100 ms grid points.

### File

```txt
ffmpeg stdout read chunks
  -> bytes_to_f32
  -> MeterPipeline::push_pcm_f32_with_requests_at_media_time(...)
  -> file-mode history gates use media timestamps
  -> pending file history batches drain on emitted frames / flush
```

File mode already moved timestamps from wall clock to media time, which is
correct. The original defect was that a single push could contain multiple
history periods: if the pipeline only observed the last closed loudness block
from that push, earlier 100 ms opportunities vanished.

**This is already fixed** (commit `6871ac5`). `FilePcmHistoryChunker` in
`file_analysis/session.rs` now splits ffmpeg PCM into one 100 ms media chunk per
pipeline push, so each push closes exactly one loudness block and no 100 ms
opportunity is lost. The description below is the cleaned-up model that fix
realizes; the remaining Phases (2-4) are optional consolidation, not bug fixes.

## Target Model

History cadence should be driven by sample/media time:

```txt
any PCM source
  -> PcmCadenceAdapter
       - accepts arbitrary interleaved f32 chunks
       - keeps partial frames across pushes
       - emits deterministic sample-clock windows
  -> MeterPipeline
       - consumes analysis windows, not source read chunks
       - updates loudness, true peak, waveform, spectrum, vectorscope
  -> HistorySamplers
       - main sampler at 100 ms
       - visual sampler at 40 ms
  -> FrameBatcher
       - live: throttle frames and respect backpressure
       - file: batch ticks and flush at EOF
```

The important rule:

```txt
source chunk size may affect CPU batching, but never history duration
```

This diagram is the **conceptual contract**, not a literal call graph both modes
share. Per Resolved Decisions and Non-Goals: live capture does **not** physically
route through `PcmCadenceAdapter` (realtime-safety), and the visual 40 ms sampler
stays inside `MeterPipeline` rather than the adapter. Both modes honor the rule
above; they do not share one code path.

## Proposed Architecture

### 1. Introduce an explicit cadence adapter

This component already exists as `FilePcmHistoryChunker` in
`file_analysis/session.rs` (commit `6871ac5`). `PcmCadenceAdapter` is the
promoted/renamed form of that same component, not a second implementation. Do
not write a new chunker — Phase 2 moves and renames the existing one.

The shape:

```txt
PcmCadenceAdapter
  input: arbitrary interleaved f32 PCM chunks
  config: sample_rate, channels, main_history_period_frames
  output: contiguous media windows with end-frame / end-time metadata
```

Initial period:

```txt
main_history_period_frames = sample_rate / 10
```

Responsibilities:

- keep partial samples/frames across pushes;
- emit whole 100 ms windows when enough PCM is available;
- flush the final partial window at end-of-stream;
- track decoded frame count and media timestamp;
- expose deterministic tests independent of ffmpeg or audio devices.

This is the cleaned-up version of the local file-mode chunker. The concept is
not "work around 64 KiB ffmpeg reads"; it is "adapt arbitrary PCM source chunks
to PLVS main history cadence."

### 2. Separate analysis cadence from frame cadence

Keep `FRAME_EMIT_MS` as UI delivery policy only.

Main history and visual history should be generated according to media/session
time, then attached to whichever UI frame carries them. In file mode this can be
a batch. In live mode this can remain one tick per emitted frame when available.

### 3. Make history contracts testable

Add tests that assert behavior by decoded media duration rather than by input
chunk shape:

- 2 seconds of 48 kHz stereo PCM fed as 64 KiB chunks produces about 20 main
  history rows.
- The same PCM fed as 32-frame chunks produces the same row count and similar
  timestamps.
- A final partial 37 ms tail does not corrupt decoded duration.
- History timestamps are monotonic and near the expected grid.
- UI frame count may vary without changing history row count.

### 4. Keep frontend index-grid math for main history

Do not migrate Loudness/Waveform/Scrub to timestamp-positioned rendering as part
of this change.

Reason: the current frontend contract is already index-grid based for main
history. It is simpler and faster as long as the backend guarantees the grid.
Timestamp-positioned rendering remains useful for keyed visual history with real
gaps, as in the Spectrogram timestamp-positioned design.

### 5. Document cadence constants in one place

Add or update architecture docs so the cadence constants have clear ownership:

```txt
main history:   100 ms media/session cadence, frontend HIST_SAMPLE_SEC = 0.1
visual history:  40 ms media/session cadence, frontend VISUAL_HIST_SAMPLE_SEC = 0.04
UI frames:       delivery cadence, not a history sampler
```

`HIST_EMIT_MS = 95` should be described as tolerance for live wall-clock emit,
not as the semantic history period.

## Migration Plan

### Phase 1: Stabilize file mode — DONE (commit `6871ac5`)

`FilePcmHistoryChunker` lives near `file_analysis/session.rs` and:

- splits ffmpeg PCM into 100 ms media chunks (`sample_rate / 10` frames);
- preserves decoded frame count;
- flushes the final tail;
- has a regression test using 64 KiB-equivalent chunks.

This fixed the visible file-duration compression without touching frontend
interaction code.

### Phase 2: Promote the adapter — conditional, deferred

Promotion to an engine-facing module is **not scheduled**. Live capture is
explicitly not routed through the adapter (see Non-Goals), so there is no second
caller and no shared-test motivation today. Moving a single-caller component into
`engine/` now would be speculative.

Keep `FilePcmHistoryChunker` where it is. Promote to
`src-tauri/src/engine/pcm_cadence.rs` (renaming to `PcmCadenceAdapter`) only when
a concrete second consumer appears. Until then, prefer the honest file-local home
and a small, sample-clocked public API.

### Phase 3: Untangle `MeterPipeline`

Audit `MeterPipeline` for places where source push cadence still affects
history output:

- `LoudnessMeter::push_interleaved` returning only the last closed block from a
  large push;
- visual history queues gated at push boundaries;
- waveform accumulators drained only when a frame is assembled;
- file-mode batch drain coupled to frame throttle.

Refactor only where tests show source chunk shape changes history output.

### Phase 4: Architecture docs

Update:

- `docs/architecture.md`
- relevant file-analysis design docs
- `MeterHistoryEntry` comments if needed

The goal is for future features to know which layer owns cadence.

## Non-Goals

- No change to the frontend `HIST_SAMPLE_SEC` contract in this spec.
- No move to full timestamp-positioned Loudness/Waveform rendering.
- No raw PCM retention for arbitrary waveform zoom depth.
- No change to loudness math, true peak math, or summary metrics.
- No change to live-device behavior unless tests show chunk-shape sensitivity.
- **Live capture is not routed through the cadence adapter.** The live PCM source
  is the realtime audio callback thread, which must not allocate, lock, or make
  syscalls (CLAUDE.md realtime-safe convention; docs/architecture.md §7). The
  adapter buffers PCM (`pending: Vec<f32>` allocation), so feeding live through it
  would either violate realtime-safety or require a second cross-thread layer that
  is not really "unified." Live and file differ here because of a physical
  constraint, not legacy debt. Unifying the *contract* (docs + naming) is in
  scope; unifying the *code path* is not.

## Risks and Tradeoffs

### More explicit buffering

The adapter keeps pending PCM between pushes. This is expected and bounded to
less than one cadence window plus the current input chunk.

### More history rows in file mode

Correct file-mode history produces the intended number of rows. This can be
larger than the broken output, but it matches the existing UI contract and
history caps.

### Edge precision

At sample rates not divisible by 10, `sample_rate / 10` has rounding behavior.
The adapter should define this explicitly. Options:

- integer frames per period using nearest rounding;
- fractional accumulator that alternates frame counts to preserve long-term
  cadence.

For common 48 kHz and 44.1 kHz sources, exact 100 ms frame counts are available
(`4800`, `4410`).

### Live parity

Routing live capture through the same adapter looks like conceptual purity but is
rejected — see Non-Goals. The live source is the realtime callback thread, where
the adapter's buffering allocation is not allowed. Live keeps its own
wall-clock-tolerant path; the two modes share the *contract*, not the code.

### File-mode visual resolution

Because the adapter feeds 100 ms chunks and visual ticks are gated at push
boundaries, file-mode visual history runs at ~10 Hz, not the live ~25 Hz. This is
accepted as a known limitation: the Spectrogram is timestamp-positioned (frames
placed by media timestamp, not entry index), so its time axis stays correct — the
only effect is coarser temporal resolution in file mode. Raising it to 25 Hz would
require the adapter to also emit 40 ms windows (a non-integer 2.5:1 relationship
to the 100 ms main grid), which is not worth the added complexity here.

## Resolved Decisions

1. **Visual cadence stays inside `MeterPipeline`.** The adapter owns only the
   main 100 ms grid. File-mode visual history therefore runs at ~10 Hz; accepted
   as a known limitation (see Risks → File-mode visual resolution).
2. **File-mode pipeline receives one 100 ms chunk per push** (current behavior).
   `LoudnessMeter` is not changed to return all closed blocks from a large push —
   one chunk per push means each push closes exactly one block, so its
   last-block-only return is moot.
3. **The final partial tail does not create a main history row.** A sub-100 ms
   tail does not close a loudness block, so it produces no main row; its samples
   still count toward `decoded_frames` and summary metrics. A partial row would
   misposition the index-grid frontend.
4. **`HIST_EMIT_MS = 95` stays for live, unchanged in code.** It is re-documented
   as a wall-clock tolerance gate for live emit, not a semantic history period.
   No live code change.
5. **The main history grid is a contract enforced by deterministic adapter unit
   tests and documentation, not by a runtime assertion at the IPC boundary.**
   Runtime checks in the frame hot path would cost throughput and risk
   panic/log-spam; tests are the right enforcement point.

## Acceptance Criteria

Already satisfied by commit `6871ac5` (regression baseline — keep passing):

- A 101.26 s, 48 kHz stereo file produces a main history axis near 101 s, not
  near 59 s, regardless of ffmpeg read size.
- Feeding the same PCM with different source chunk sizes yields the same decoded
  frame count and nearly the same main history row count.

Pending for the remaining doc/test work (Phase 3-4):

- Live capture behavior remains visually unchanged.
- The architecture docs clearly distinguish analysis cadence from UI frame
  cadence, and document `HIST_EMIT_MS` as a live tolerance gate plus the ~10 Hz
  file-mode visual limitation.
- `npm run check` passes.

