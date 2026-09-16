# Bounded-Cost Snapshot Entry Implementation Plan

**Status:** Implementation complete on `main` (2026-08-27); real four-hour validation pending.

**Goal:** Remove full-history copying from Snapshot entry so four-hour entry cost is bounded by
small active chunk tails and min/max index level count, without changing retention, cadence,
timestamps, precision, or visible behavior.

**Architecture:** Store aligned main-history domains in immutable fixed-size chunks. Frozen views
share sealed chunks and copy only active tails. Apply the same storage rule to min/max index levels
and sparse supporting sequences. Freeze one coherent scalar bundle in `FrameIntake`, then let
`useSnapshot` and existing math consume indexed views directly.

**Tech stack:** JavaScript ES modules, React 19, Vitest, Node performance benchmarks.

**Spec:** `docs/superpowers/specs/2026-08-27-snapshot-entry-freeze-design.md`

---

## Decisions fixed by this plan

1. **No data compromise.** Four-hour length, 10 Hz cadence, timestamps, row count, and numeric
   precision remain unchanged.
2. **No global RingBuffer rewrite.** New persistent storage is introduced only where Snapshot entry
   needs it; unrelated RingBuffer users stay untouched.
3. **One scalar boundary.** Loudness, audio, and correlation freeze from one aligned store and one
   end sequence.
4. **Metadata is losslessly sparse.** It stores changes, while indexed reads reproduce the value at
   every original tick.
5. **Indexes are part of the fix.** The work is incomplete while `PowerOfTwoMinMaxIndex`, Waveform
   support rows, or sparse markers still flatten retained history on entry.
6. **Views, not arrays.** Production consumers use `length`, `at`/`rowAt`, `timestampAt`, and
   `version`; pure helpers retain Array compatibility.
7. **Timing is diagnostic.** Tests assert copied-row/reference bounds and immutability rather than a
   flaky millisecond threshold.
8. **Snapshot and live CPU remain separate.** This plan does not throttle or reschedule panel draws.
9. **Work lands on `main`.** No branch or worktree is created unless the user later requests one.

---

## File map

### Persistent sequence foundation

- Create: `src/lib/ChunkedSequence.js`
- Create: `src/lib/ChunkedSequence.test.js`
- Reuse: `src/lib/historyChunkConfig.js`

### Persistent query indexes

- Modify: `src/lib/PowerOfTwoMinMaxIndex.js`
- Modify: `src/lib/PowerOfTwoMinMaxIndex.test.js`
- Modify: `src/math/loudnessHistoryIndex.js`
- Modify: `src/math/loudnessHistoryIndex.test.js`
- Modify: `src/math/waveformHistoryIndex.js`
- Modify: `src/math/waveformHistoryIndex.test.js`
- Modify: `src/lib/SparseHistoryMarkers.js`
- Modify: `src/lib/SparseHistoryMarkers.test.js`

### Aligned scalar history and metadata

- Create: `src/lib/ScalarHistoryStore.js`
- Create: `src/lib/ScalarHistoryStore.test.js`
- Create: `src/lib/ChannelMetadataHistory.js`
- Create: `src/lib/ChannelMetadataHistory.test.js`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`

### Snapshot integration

- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`
- Modify as required by protocol audit: `src/lib/snapshotResolve.js`
- Modify as required by protocol audit: `src/lib/snapshotResolve.test.js`
- Modify as required by protocol audit: `src/math/hoverMath.js`
- Modify as required by protocol audit: `src/math/hoverMath.test.js`
- Modify only if a bracket-access path remains: affected Loudness, Waveform, or Spectrogram panel
  and Dock tests.

### Measurement

- Modify: `scripts/history-perf-benchmark.mjs`
- Modify: `scripts/history-perf-benchmark.test.js`
- Modify: `src/dev/historyPerformanceHarness.js`
- Modify: `src/dev/historyPerformanceHarness.test.js`

---

## Task 1: Pin the current cost and behavior

### Slice 1A — Benchmark contract

- [ ] Add a scalar Snapshot section to `scripts/history-perf-benchmark.test.js` before changing
      storage.
- [ ] Require the report to include retained rows, freeze duration, copied dense rows/references,
      copied index references, metadata changes, sparse markers, and a result checksum.
- [ ] Add a structural comparison for a short capacity and four-hour capacity: retained rows grow,
      but the final implementation's copied payload must remain bounded.
- [ ] Keep wall time report-only; do not encode a machine-specific pass/fail number.

### Slice 1B — Integration baseline

- [ ] Add a `useSnapshot` test that fills wrapped main history, enters Snapshot, appends enough live
      rows to overwrite the old RingBuffers, and verifies all frozen scalar results remain unchanged.
- [ ] Cover loudness, audio, correlation, channel metadata, both display indexes, and sparse markers.
- [ ] Add a second Snapshot session assertion proving that exit/re-entry captures the newer boundary.

Run:

```bash
npx vitest run scripts/history-perf-benchmark.test.js src/hooks/useSnapshot.test.jsx
```

Expected red state: the benchmark cannot report bounded scalar freeze statistics, and the new
public freeze seam does not exist.

## Task 2: Add a frozen chunked sequence

### Slice 2A — Core access and wrap

- [ ] Test positive integer capacity validation.
- [ ] Test append, `length`, `version`, `at`, `rowAt`, iteration if required, capacity wrap, and
      partial-front-chunk lookup.
- [ ] Implement monotonically increasing sequence addressing with fixed-size chunks.
- [ ] Drop only chunks wholly outside the retained window.

### Slice 2B — Freeze and lifecycle

- [ ] Test that freeze shares sealed chunks and copies only the used active-tail prefix.
- [ ] Test frozen immutability after append, live wrap, and clear.
- [ ] Test two frozen boundaries and an empty freeze.
- [ ] Expose `storageStats()` with retained rows, chunk count, shared sealed chunks, copied tail rows,
      and copied references.
- [ ] Make clear advance to a non-conflicting sequence boundary.

Run:

```bash
npx vitest run src/lib/ChunkedSequence.test.js
```

## Task 3: Make PowerOfTwoMinMaxIndex freeze persistent

### Slice 3A — Replace level rings

- [ ] Add randomized equivalence tests comparing live and frozen range queries before and after
      wrap.
- [ ] Replace each completed-bucket `RingBuffer` with `ChunkedSequence` while retaining the existing
      bucket width and sequence semantics.
- [ ] Preserve pending buckets and all current query statistics.

### Slice 3B — Bound freeze work

- [ ] Add a four-hour-capacity structural test proving freeze does not flatten all level entries.
- [ ] Report shared chunks and copied tail references per level and in aggregate.
- [ ] Test partial front ranges and ranges that must fall back to raw rows.

Run:

```bash
npx vitest run src/lib/PowerOfTwoMinMaxIndex.test.js
```

## Task 4: Remove hidden index flattening

### Slice 4A — Loudness index

- [ ] Verify `LoudnessHistoryIndex.freeze()` preserves M/ST min/max results for randomized ranges.
- [ ] Route freeze statistics through the wrapper without exposing private level arrays.

### Slice 4B — Waveform index

- [ ] Add tests for frozen multi-channel min/max, NaN ranges, wrap, and later live appends.
- [ ] Migrate `_rawRows` and `_nanSequences` from flattening RingBuffers to chunked sequences.
- [ ] Ensure freeze copies no full raw-row or NaN-sequence history.

### Slice 4C — Sparse frequency markers

- [ ] Add a worst-case test with one marker per row.
- [ ] Migrate marker storage to `ChunkedSequence` while keeping binary-search result and query-stat
      behavior unchanged.
- [ ] Prove freeze work is tail-bounded even in the worst case.

Run:

```bash
npx vitest run src/math/loudnessHistoryIndex.test.js src/math/waveformHistoryIndex.test.js src/lib/SparseHistoryMarkers.test.js
```

## Task 5: Add aligned scalar history storage

### Slice 5A — Projection protocol

- [ ] Test aligned append and projected loudness/audio/correlation views.
- [ ] Test `length`, stable live `version`, `at`, `rowAt`, loudness `timestampAt`, and required
      iteration compatibility.
- [ ] Test capacity wrap and verify all projections retain the same logical rows.
- [ ] Implement one chunk boundary and sequence timeline for all dense scalar columns.

### Slice 5B — Frozen projections

- [ ] Test one atomic freeze returning three projected views with the same boundary.
- [ ] Test tail-only copy statistics and frozen immutability after enough appends to wrap live
      storage.
- [ ] Test clear and capacity reconstruction without invalidating old views.

Run:

```bash
npx vitest run src/lib/ScalarHistoryStore.test.js
```

## Task 6: Add lossless sparse channel metadata

### Slice 6A — Change compression

- [ ] Test that repeated identical labels create one change record while every logical row resolves
      the expected object.
- [ ] Test exact-row changes and alternating frequency/vectorscope label changes.
- [ ] Compare values, not object identity, when deciding whether metadata changed.

### Slice 6B — Retention and freeze

- [ ] Test predecessor retention when the original change lies before the retained window.
- [ ] Test wrap, freeze, later changes, clear, and capacity rebuild.
- [ ] Expose change count and tail-copy statistics.

Run:

```bash
npx vitest run src/lib/ChannelMetadataHistory.test.js
```

## Task 7: Migrate FrameIntake behind existing getters

### Slice 7A — Live path

- [ ] Replace `_loudnessHist`, `_audioSnap`, and `_corrSnap` with one `ScalarHistoryStore`.
- [ ] Preserve existing getter names and return stable projected view identities so React memo and
      version-based invalidation continue to work.
- [ ] Replace dense `_channelMetadataSnap` with `ChannelMetadataHistory`.
- [ ] Audit `getFrequencyChannelMarkers`; remove the unused dense ring only if production search
      confirms no caller, otherwise migrate it to bounded storage.
- [ ] Preserve `pushHistRow`, reset, capacity-change, timestamp normalization, and row alignment.

### Slice 7B — Atomic freeze API

- [ ] Add `snapshotScalarHistory()` returning the aligned frozen projections, metadata, Loudness
      index, Waveform index, and sparse marker index.
- [ ] Include aggregate structural freeze statistics through an explicit diagnostic seam.
- [ ] Keep older individual snapshot methods only where compatibility tests or callers require
      them; production Snapshot must use the atomic API.

Run:

```bash
npx vitest run src/lib/FrameIntake.test.js src/lib/ScalarHistoryStore.test.js src/lib/ChannelMetadataHistory.test.js
```

Manual checkpoint: run the app live for several minutes and confirm Loudness, Stats, Waveform,
channel labels, Clear, and source restarts behave normally before changing `useSnapshot`.

## Task 8: Switch useSnapshot to frozen views

### Slice 8A — Remove flattening

- [ ] Change `freezeSnapshot` to call `intake.snapshotScalarHistory()` once.
- [ ] Remove production `snapshotRows(...toArray())` calls for loudness, audio, correlation, and
      channel metadata.
- [ ] Retain the `liveAudioFallback` behavior and existing packed visual-history freeze calls.
- [ ] Verify entering Snapshot freezes once; scrubbing and live audio rerenders do not refreeze.

### Slice 8B — Protocol audit

- [ ] Search every production consumer of `histSourceList` and the scalar projections for numeric
      bracket access or Array-only operations.
- [ ] Route production reads through `rowAt`/`at` helpers while preserving Array fallbacks in pure
      functions and tests.
- [ ] Verify Loudness, Waveform, Spectrogram time alignment, hover, and Dock live reads.

### Slice 8C — Lifecycle behavior

- [ ] Test Snapshot entry after wrap, scrubbing, Hold, hover, Clear while frozen, exit-to-live, and a
      new Snapshot session.
- [ ] Test source/capture-session timestamp rebasing and channel metadata changes around the frozen
      boundary.

Run:

```bash
npx vitest run src/hooks/useSnapshot.test.jsx src/lib/snapshotResolve.test.js src/math/hoverMath.test.js src/components/panels/LoudnessPanel.test.jsx src/components/panels/WaveformPanel.test.jsx src/components/panels/SpectrogramPanel.test.jsx src/dock/modules/DockLoudness.test.jsx src/dock/modules/DockWaveform.test.jsx
```

## Task 9: Finish measurement and regression coverage

### Slice 9A — Node benchmark

- [ ] Populate short and four-hour scalar histories with representative stereo rows.
- [ ] Freeze the complete scalar bundle and verify checksums at oldest, middle, and newest rows.
- [ ] Continue appending through wrap and verify the frozen checksums do not change.
- [ ] Print per-domain and per-index copy accounting plus diagnostic timing.
- [ ] Assert copied payload/reference counts follow chunk-tail and level formulas, not retained-row
      count.

### Slice 9B — Developer harness

- [ ] Surface scalar Snapshot freeze statistics in the existing developer history report.
- [ ] Keep the reporting path opt-in so normal production capture does not allocate diagnostics per
      tick.
- [ ] Label live retained bytes separately from one Snapshot's shared and copied bytes.

Run:

```bash
npm run benchmark:history
npx vitest run scripts/history-perf-benchmark.test.js src/dev/historyPerformanceHarness.test.js
```

## Task 10: Full verification and handoff

- [ ] Run `git diff --check`.
- [ ] Run `npm run check`.
- [ ] Run `npm run benchmark:history` and save the before/after scalar Snapshot section in the
      handoff.
- [ ] Manually test live-to-Snapshot entry near the start of a session and after a long run.
- [ ] Verify repeated entry/exit, scrubbing across the full window, channel-layout changes, Clear,
      source restart, and exit back to live.
- [ ] Run `npm run soak:capture` for the real four-hour result. Treat drift-threshold failures as
      investigation leads, per repository guidance, but require Snapshot responsiveness and stable
      memory behavior before calling the objective complete.

---

## Commit strategy

Keep commits independently reviewable and green where practical:

1. `docs: specify bounded snapshot entry`
2. `feat: add frozen chunked sequences`
3. `perf: make history indexes snapshot-shareable`
4. `perf: add aligned scalar history snapshots`
5. `perf: remove full copies from snapshot entry`
6. `test: benchmark scalar snapshot freeze`

Do not split a storage migration at a point where `FrameIntake` produces one representation and
`useSnapshot` expects another. Combine adjacent commits if that is necessary to keep `main`
runnable.

## Completion checklist

- [ ] No full main-history copy remains in the production Snapshot-entry call graph.
- [ ] Four-hour retained row count remains 144,000 at the current 10 Hz cadence.
- [ ] Scalar values and indexes remain full precision.
- [ ] Frozen data survives live wrap, Clear, capacity changes, and later Snapshot sessions.
- [ ] Structural benchmark proves bounded copy work.
- [ ] Focused suites, benchmark, and `npm run check` pass.
- [ ] Real four-hour behavior is reported separately from synthetic timing.

## Implementation result

The code phase completed on `main` on 2026-08-27. The safe benchmark filled all 144,000 scalar
rows and reported:

- approximately 1.3 ms for the complete scalar Snapshot freeze on the reporting machine;
- 1,920 copied dense tail references across loudness, audio, and correlation, rather than 432,000
  full-column references;
- 3,707 copied summary references for each of the Loudness and Waveform min/max indexes;
- two stored channel-metadata changes for 144,000 logically addressable metadata rows; and
- a frozen oldest-row checksum that remained unchanged after the live store wrapped once.

These timings are diagnostic, not a release threshold. Automated coverage pins the structural copy
bounds. Manual app validation and the real four-hour soak remain outstanding.
