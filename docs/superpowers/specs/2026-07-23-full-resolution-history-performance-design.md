# Full-Resolution History Performance — Design

**Date:** 2026-07-23  
**Status:** Draft for owner review

## Summary

Make 30–240 minute history windows remain responsive without changing retained
measurement precision or snapshot semantics.

The work is staged:

1. remove confirmed redundant work and add deterministic 240-minute performance
   coverage;
2. replace linear timestamp lookup and shifting scalar arrays;
3. replace monolithic visual slabs with immutable typed-array chunks so entering
   snapshot mode freezes references instead of copying gigabytes;
4. add lossless, incrementally maintained display indexes for history plots whose
   current decimators still scan every visible source row.

All source rows remain available at their current cadence. Display indexes are
derived caches, not replacements for source history.

## User-visible contract

### Precision

- Main history remains sampled at its existing 100 ms semantic cadence.
- Visual history remains sampled at its existing 40 ms semantic cadence.
- Spectrum history retains every emitted frequency band at the same numeric type
  and band grid as today.
- Vectorscope history retains every emitted pair and metric as today.
- Zooming back into an old interval resolves the same source rows that the current
  implementation would resolve.
- A pixel-wide zoomed-out view may aggregate multiple rows because the display has
  fewer pixels than samples. That aggregation must not delete or rewrite the source
  rows, and zooming in must recover them.

### Snapshot

- Entering snapshot mode establishes an as-of boundary.
- Live capture continues while a snapshot is open.
- Rows appended or overwritten after that boundary cannot change the frozen view.
- Exiting snapshot returns immediately to the latest live data.
- Existing request-key gap semantics remain unchanged: a key that was inactive at
  the selected timestamp reports no data.

### Retention

- Existing 30, 60, 120, and 240 minute settings remain unchanged.
- Changing retention continues to clear and rebuild the active history, matching
  current behavior.
- Live and file modes keep the same bounded-history semantics.

## Confirmed causes

### Redundant 60 Hz history path construction

`useLoudnessHistory` builds M and ST paths on every App render even though App no
longer consumes those return values. `tauriFrameApply` calls `setAudio` at the UI
frame cadence, so the unused paths scan the visible window at approximately 60 Hz.
At a 240-minute full-window view this is two scans over roughly 144,000 rows per
render.

`LoudnessPanel` separately owns the paths that are actually displayed and already
memoizes them by history timestamp and viewport.

### Pixel-bounded output with source-linear input

`buildHistoryPath` and `sliceWaveformSubHistory` cap their output by canvas width,
but still scan every visible source row. This prevents huge SVG/canvas output while
leaving CPU cost proportional to zoomed-out duration.

### Monolithic snapshot copies

Entering snapshot calls `freezeSnapshot` during React render. Every retained
Spectrum and Vectorscope slab is copied into a new typed-array backing store.
A full 240-minute Spectrum key is approximately 360,000 rows × 958 bands × four
bytes before secondary data; the synchronous copy blocks event handling and paint.

### Other linear work

- `nearestTimestampIndex` linearly scans sorted timestamps.
- Scalar histories use `Array.shift()` after reaching capacity.
- Snapshot mode continues accepting live `setAudio` writes that cannot affect the
  frozen display but still trigger React work.

## Goals

- Preserve the precision and cadences in the user-visible contract.
- Remove source-history-size work from the approximately 60 Hz React path.
- Make snapshot entry proportional to chunk count plus one partial chunk, not total
  retained bytes.
- Make timestamp resolution logarithmic.
- Make full-window Loudness and Waveform display preparation proportional to
  display width, not retained row count.
- Keep capture intake and acknowledgement running while snapshot display updates
  are paused.
- Add regression signals that exercise the 240-minute shape without requiring a
  sound card.

## Non-goals

- Reducing visual-history cadence, frequency-band count, vectorscope pair count, or
  numeric precision.
- Changing chart appearance, hover semantics, time axes, or snapshot selection.
- Persisting history across application restarts.
- Moving history ownership to Rust or adding disk-backed cold storage in this
  change. Those remain options if measured steady-state memory pressure is still
  unacceptable after synchronous copies are removed.
- Changing Rust DSP or capture callback behavior.

## Approaches considered

### A — Tactical fixes only

Remove dead path construction, use binary search, memoize snapshot resolution, and
stop snapshot-only renders.

This is low risk and should materially improve live animation, but snapshot entry
still copies full visual slabs and full-window display preparation remains
source-linear at history cadence. It is necessary but not sufficient.

### B — Reduce old-history resolution

Store fewer old rows or fewer Spectrum bands.

This offers the largest memory reduction but violates the explicit requirement
that every retention length keep the same source precision. Rejected.

### C — Exact chunked history plus lossless display indexes

Keep every current source row. Store visual histories in fixed-size immutable
typed-array chunks, share completed chunks with snapshots, copy only the mutable
tail, and maintain derived min/max indexes for pixel-bounded history rendering.

Chosen because it fixes the confirmed synchronous and source-linear hot paths
without changing retained data. It does not pretend the raw data is small: a full
240-minute Spectrum key still consumes roughly 1.3 GiB for its primary curve.

## Design

## Stage 1 — Low-risk hot-path corrections

### Remove unused Loudness paths

Delete `displayHistoryPathM` and `displayHistoryPathST` construction and return
fields from `useLoudnessHistory`. `LoudnessPanel` remains the sole owner of rendered
history paths.

Tests must assert that the hook no longer invokes path construction during an
audio-only rerender and that LoudnessPanel still updates on a new history
timestamp.

### Binary timestamp resolution

Replace `nearestTimestampIndex` with lower-bound search over the chronological
history-view interface. Compare the lower-bound row and its predecessor to preserve
the current nearest-row and later-row-on-tie behavior.

Both plain arrays and slab views remain supported until the chunked store lands.

### Stable snapshot resolution

Memoize the main snapshot resolution by frozen source identity and selected offset.
Per-key Spectrum and Vectorscope resolution must cache by key, frozen view identity,
target timestamp, and the Vectorscope peak-hold option.

No cache may use a live mutable slab without also including its version.

### Pause irrelevant snapshot display writes

Continue `FrameIntake.pushFrame`, frame acknowledgements, and latest-live-frame
tracking while snapshot mode is active. Do not call React `setAudio` for each live
frame while the displayed values come from frozen history.

Keep the latest live frame in a ref. Exiting snapshot publishes that frame once so
the UI returns directly to current values rather than waiting for the next channel
delivery.

### Scalar ring storage

Replace the five aligned scalar arrays in `FrameIntake` with an indexable ring
representation that provides chronological `length`, `at`, and snapshot iteration
without `Array.shift()`.

The aligned histories must advance and clear atomically. Existing consumers may use
a compatibility view during migration, but no hot push path may materialize the
whole ring.

## Stage 2 — Immutable chunked visual history

### Chunk contract

Spectrum and Vectorscope histories use fixed-row typed-array chunks. A chunk has:

- chronological timestamps;
- metric-specific flat typed arrays;
- a row count and monotonically increasing sequence range;
- immutable backing arrays once sealed.

The active tail chunk is mutable and append-only. When full, it is sealed and a new
tail is allocated. Capacity eviction removes chunks or advances a logical start
within the oldest chunk; it never rewrites a sealed chunk.

Chunk size is an implementation constant selected by benchmark. It must bound the
worst snapshot tail copy to less than one frame budget on the reference development
machine while avoiding thousands of tiny allocations. The benchmark, rather than a
guessed row count in this spec, is the acceptance authority.

### Snapshot view

Entering snapshot:

1. records the latest included sequence;
2. shares references to sealed chunks that intersect the retained range;
3. copies only the active tail rows up to the boundary;
4. records the logical start and length.

The frozen view implements the existing read-only history interface:
`length`, `timestampAt(index)`, and `rowAt(index)`.

Live eviction can drop its reference to an old chunk while the frozen view keeps the
chunk alive. Memory temporarily grows only by data appended while a long-running
snapshot pins otherwise-evictable chunks. Exiting snapshot releases those
references.

### Request keys

The existing no-backfill and retained-inactive-key behavior remains unchanged.
Chunk sharing makes freezing all retained keys cheap in CPU and incremental memory;
it does not introduce silent key eviction.

### Clear and retention changes

Clear releases all live and frozen chunk references. A retention change rebuilds
stores at the new capacity, matching current clear-on-change behavior.

## Stage 3 — Lossless display indexes

### Loudness

Maintain append-only power-of-two summary levels for M and ST. Each summary bucket
stores source-index range plus min and max values. Ring eviction advances each
level's logical start.

For a viewport, choose the finest level whose bucket width maps to approximately one
display column, then merge boundary source rows exactly. The generated min/max
envelope must match a full reference scan for every display column.

### Waveform

Maintain equivalent per-channel min/max summaries over history-entry coordinates.
Sub-block detail remains available in raw rows for close zoom. At wider zoom, use
the summary level only when the existing rule would already use whole-tick bounds.

The optimized result must match `sliceWaveformSubHistory` for bucket count,
first/last populated bucket, and per-channel extrema.

### Spectrogram

The existing long-window painter already resolves one exact retained frame per
physical x pixel using timestamp binary search. Keep that behavior and adapt it to
chunked views. No frequency or time rows are removed.

Boundary-marker scans must use chunk metadata to skip continuous chunks and inspect
only chunk boundaries plus chunks known to contain gaps.

## Data flow

```text
Rust metering frame
  -> frontend intake (unchanged cadence and payload precision)
  -> raw exact scalar/chunked visual history
  -> incremental lossless display indexes
  -> viewport query bounded by display width
  -> panel render

Snapshot entry
  -> record sequence boundary
  -> share sealed chunks + copy active tail
  -> frozen read-only views
  -> memoized timestamp/key resolution
```

## Thread and ownership boundaries

- No change allocates, locks, or performs I/O on an audio callback thread.
- This design remains frontend-owned; Tauri Channel delivery and Rust metering are
  unchanged.
- Heavy index construction is incremental at history cadence. If measurement shows
  an individual update can exceed the frame budget, the same pure index builder can
  move to a Web Worker without changing its data contract. Worker migration is not
  included speculatively.

## Failure behavior

- Allocation failure cannot be recovered safely inside the frontend; preserve the
  current fatal behavior rather than silently dropping precision.
- Missing request-key data remains an explicit snapshot empty state.
- A malformed or non-monotonic timestamp must use existing fallback behavior in the
  intake normalization layer; binary-search consumers assume chronological views.

## Testing

### Correctness

- Differential tests compare binary nearest-index results with the current linear
  reference across empty, one-row, gap, tie, before-first, and after-last cases.
- Ring tests cover wraparound, aligned scalar views, clear, and capacity changes.
- Chunk tests cover append, seal, partial oldest chunk, wrap/eviction, freeze,
  post-freeze overwrite, long-lived snapshot pinning, secondary Spectrum curves,
  and multiple request keys.
- Randomized differential tests compare indexed Loudness/Waveform viewport output
  with full-scan reference output.
- Existing live/file snapshot and request-gap suites remain unchanged in observable
  assertions.

### Performance feedback loop

Add a deterministic benchmark script using synthetic 240-minute data:

- 144,000 main-history rows;
- 360,000 visual timestamps;
- the production Spectrum band count and Vectorscope pair count;
- 600 px and 1,200 px viewports.

Record separately:

- audio-only App rerender work;
- full-window Loudness query;
- full-window Waveform query;
- scalar full-capacity push;
- snapshot freeze per key and total;
- nearest timestamp resolution.

Automated tests assert structural bounds and call counts rather than fragile
wall-clock thresholds. A manually invoked benchmark records timings and memory for
before/after comparison.

### Desktop verification

Use a synthetic-history developer harness so the 240-minute state is available
without four hours of capture. Verify:

- no repeated long task while live at maximum zoom;
- snapshot input-to-next-paint has no full-slab copy;
- snapshot remains stable while synthetic live rows continue;
- exiting snapshot publishes the latest frame;
- zooming into old data resolves exact retained rows.

Run `npm run check` before integration. Because this work does not change
`src-tauri/src/audio`, `dsp`, or `engine`, capture smoke/soak is not required unless
the implementation scope later crosses that boundary.

## Rollout and plan split

Implementation is split into two independently testable plans:

1. **Frontend hot-path corrections:** Stage 1 plus benchmark/harness foundations.
2. **Exact chunked history:** Stages 2–3, reusing the Stage-1 feedback loop.

After plan 1, repeat the original 240-minute scenario. Plan 2 remains required to
remove full-slab snapshot copies and make full-window query cost independent of
retained row count; the checkpoint determines measured baselines, not whether
precision may be reduced.

## Acceptance criteria

- All retained source cadences, rows, bands, pairs, and numeric types match the
  current implementation.
- A snapshot is immutable while capture continues.
- No approximately 60 Hz path scans all retained history.
- Snapshot entry does not copy sealed visual-history chunks.
- Loudness and Waveform full-window display queries inspect a number of summary
  buckets proportional to viewport width, with differential equality to the
  full-scan reference.
- Scalar full-capacity push performs no `Array.shift()`.
- The synthetic 240-minute benchmark and existing test suite pass.
