# Exact Chunked History and Lossless Indexes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 240-minute snapshot entry and maximum-zoom history rendering independent of retained source-row count while preserving every 10 Hz/25 Hz row, all 958 Spectrum bands, all 200 Vectorscope float values, and current snapshot/display semantics.

**Architecture:** Replace each monolithic visual-history ring with metric-specific fixed-row typed-array chunks. Completed chunks are immutable and shared with frozen snapshots; only the active tail is copied. Add incrementally maintained power-of-two min/max indexes for Loudness and Waveform. Indexes are derived caches over exact raw rows, and every optimized query is differential-tested against the current full scan.

**Tech Stack:** JavaScript typed arrays, React 19, Canvas/SVG, Vitest, Node benchmark scripts.

**Depends on:** `docs/superpowers/plans/2026-07-23-full-resolution-history-hot-paths.md`

**Reference spec:** `docs/superpowers/specs/2026-07-23-full-resolution-history-performance-design.md`

---

## Decisions fixed by this plan

1. **No generic storage framework.** Spectrum and Vectorscope keep their existing
   public classes and own their metric-specific chunks. Only sequence/chunk constants
   and small lookup helpers are shared.
2. **Typed arrays cannot be made immutable with `Object.freeze`.** Immutability is
   enforced by ownership: once a chunk is sealed, production code never writes its
   backing arrays again. Tests verify post-freeze buffer identity and values.
3. **Snapshot boundary is sequence-based.** Each append gets a monotonically
   increasing sequence. A frozen view records an inclusive start and exclusive end.
4. **Exact capacity is logical.** Eviction advances the retained start sequence and
   drops only wholly expired chunk references. A partially retained oldest chunk is
   never rewritten.
5. **Index query is exact.** Arbitrary display-column ranges are decomposed into
   aligned power-of-two buckets plus exact raw rows. No approximation replaces source
   history.
6. **Vectorscope benchmark width is 200 float values per row.** This matches
   `VS_HISTORY_POINTS=100` pairs in the Rust meter pipeline; a two-float test would
   understate the real workload.

---

## File map

- Create: `src/lib/historyChunkConfig.js` — measured chunk-row constant.
- Create: `src/lib/historyChunkMath.js` — sequence/chunk lookup helpers only.
- Create: `scripts/history-chunk-size-benchmark.mjs` — choose and document chunk size.
- Modify: `src/lib/SpectrumHistorySlab.js` and test — metric-specific chunk storage.
- Modify: `src/lib/VectorscopeHistorySlab.js` and test — metric-specific chunk storage.
- Modify: `src/lib/FrameIntake.js` and test — chunked keyed stores and cheap snapshots.
- Modify: `src/hooks/useSnapshot.js` and test — frozen visual views and frozen indexes.
- Modify: `src/math/spectrogramTimeline.js` and test — chunk-metadata gap queries.
- Create: `src/lib/SparseHistoryMarkers.js` and test — output-sized frequency-marker queries.
- Create: `src/lib/PowerOfTwoMinMaxIndex.js` and test — exact derived summaries.
- Create: `src/math/loudnessHistoryIndex.js` and test — M/ST indexed path queries.
- Modify: `src/math/historyMath.js` and test — reference and indexed path entry points.
- Create: `src/math/waveformHistoryIndex.js` and test — per-channel exact summaries.
- Modify: `src/math/waveformMath.js` and test — indexed wide-window query.
- Modify: `src/components/panels/LoudnessPanel.jsx` and test — indexed main panel.
- Modify: `src/dock/modules/DockLoudness.jsx` and test — indexed dock.
- Modify: `src/components/panels/WaveformPanel.jsx` and test — indexed main panel.
- Modify: `src/dock/modules/DockWaveform.jsx` and test — indexed dock.
- Modify: `src/App.jsx` — expose source-matched indexes through history context.
- Create: `src/dev/historyPerformanceHarness.js` — opt-in 240-minute dev seed.
- Modify: `scripts/history-perf-benchmark.mjs` — Stage-2/3 timing and structural report.

---

## Task 0: Confirm the Stage-1 prerequisite

**Files:** no changes.

- [ ] **Step 1: Run the Stage-1 focused suites**

```powershell
npx vitest run src/lib/snapshotResolve.test.js src/hooks/useLoudnessHistory.test.jsx src/lib/RingBuffer.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/lib/tauriFrameApply.test.js src/hooks/useMeterDisplay.test.jsx
```

Expected: PASS.

- [ ] **Step 2: Run the Stage-1 benchmark**

```powershell
npm run benchmark:history
```

Expected:

- nearest timestamp lookup is logarithmic;
- scalar full-capacity push does not use `Array.shift`;
- the benchmark reports 144,000 scalar rows and 360,000 visual rows.

Do not start Task 1 if the scalar getters do not yet implement the chronological
`length`/`rowAt`/`timestampAt`/`toArray` view contract.

---

## Task 1: Measure and fix the visual chunk size

**Files:**

- Create: `scripts/history-chunk-size-benchmark.mjs`
- Create: `src/lib/historyChunkConfig.js`
- Create: `src/lib/historyChunkMath.js`
- Modify: `package.json`

- [ ] **Step 1: Add the candidate benchmark**

Benchmark candidates `[256, 512, 1024]`. For each candidate, measure p50/p95 tail
copy for:

- Spectrum primary only: `rows * 958 * 4` bytes;
- Spectrum primary + secondary + `hasB`: `rows * 958 * 8 + rows` bytes;
- Vectorscope: `rows * 200 * 4` plus five scalar columns.

Core benchmark operation:

```js
function copySpectrumTail(rows, secondary) {
  const timestamps = new Float64Array(rows);
  const sourceA = new Float32Array(rows * 958);
  const sourceB = secondary ? new Float32Array(rows * 958) : null;
  const targetTimestamps = new Float64Array(rows);
  const targetA = new Float32Array(sourceA.length);
  const targetB = sourceB ? new Float32Array(sourceB.length) : null;
  targetTimestamps.set(timestamps);
  targetA.set(sourceA);
  targetB?.set(sourceB);
}
```

Warm up before recording. Run enough iterations for stable p95, but allocate outside
the timed callback and reuse destination buffers to avoid measuring garbage
collection.

- [ ] **Step 2: Add explicit selection criteria**

Choose the largest candidate satisfying both:

- dual-Spectrum tail bytes are at most 8 MiB;
- p95 copy time is below 8 ms on the reference development machine.

These leave half a 60 Hz frame for React/layout and keep a full 240-minute key below
roughly 1,500 chunks.

- [ ] **Step 3: Run the benchmark**

```powershell
node scripts/history-chunk-size-benchmark.mjs
```

Record CPU, Node version, candidate table, and chosen row count in the file comment
in `historyChunkConfig.js`:

```js
// Selected by scripts/history-chunk-size-benchmark.mjs on <machine/date>.
// Worst tested dual-Spectrum tail: <bytes>, p95 <milliseconds>.
export const VISUAL_HISTORY_CHUNK_ROWS = 512; // replace with measured winner
```

The example `512` is not authoritative; commit the measured winner.

- [ ] **Step 4: Add minimal sequence helpers**

`historyChunkMath.js` should contain only:

```js
export function chunkIdForSequence(sequence, chunkRows) {
  return Math.floor(sequence / chunkRows);
}

export function chunkOffsetForSequence(sequence, chunkRows) {
  return sequence % chunkRows;
}

export function findChunkForSequence(chunks, firstChunkId, sequence, chunkRows) {
  return chunks[chunkIdForSequence(sequence, chunkRows) - firstChunkId];
}
```

Do not add base chunk/store classes.

- [ ] **Step 5: Add the package script and run formatting**

```json
"benchmark:history-chunks": "node scripts/history-chunk-size-benchmark.mjs"
```

Run:

```powershell
npm run format:check
```

- [ ] **Step 6: Commit**

```powershell
git add package.json scripts/history-chunk-size-benchmark.mjs src/lib/historyChunkConfig.js src/lib/historyChunkMath.js
git commit -m "test(perf): benchmark visual history chunk size"
```

---

## Task 2: Convert Spectrum history to immutable chunks

**Files:**

- Modify: `src/lib/SpectrumHistorySlab.js`
- Modify: `src/lib/SpectrumHistorySlab.test.js`

- [ ] **Step 1: Add chunk-specific failing tests**

Keep every existing test, then add:

```js
it("shares sealed Spectrum buffers and copies only the active tail", () => {
  const slab = new SpectrumHistorySlab(CHUNK_ROWS * 3, bands);
  pushSpectrumRows(slab, CHUNK_ROWS + 2);

  const liveSealed = slab.rowAt(0).dbList.buffer;
  const liveTail = slab.rowAt(CHUNK_ROWS).dbList.buffer;
  const frozen = slab.freeze();

  expect(frozen.rowAt(0).dbList.buffer).toBe(liveSealed);
  expect(frozen.rowAt(CHUNK_ROWS).dbList.buffer).not.toBe(liveTail);
});

it("keeps a frozen Spectrum view stable while live retention advances", () => {
  const slab = new SpectrumHistorySlab(CHUNK_ROWS + 2, bands);
  pushSpectrumRows(slab, CHUNK_ROWS + 2);
  const frozen = slab.freeze();
  const before = Float32Array.from(frozen.rowAt(0).dbList);
  pushSpectrumRows(slab, CHUNK_ROWS * 2);
  expect(frozen.rowAt(0).dbList).toEqual(before);
});

it("retains exactly capacity rows through a partial oldest chunk", () => {
  const slab = new SpectrumHistorySlab(CHUNK_ROWS + 3, bands);
  pushSpectrumRows(slab, CHUNK_ROWS * 2);
  expect(slab.length).toBe(CHUNK_ROWS + 3);
  expect(slab.timestampAt(0)).toBe(expectedOldestTimestamp);
});
```

Add equivalent coverage for:

- secondary curve lazy allocation;
- `hasB` per row;
- band-grid mismatch;
- clear then append;
- `version` increment;
- oldest partial chunk plus sealed middle plus active tail.

- [ ] **Step 2: Run and observe failure**

```powershell
npx vitest run src/lib/SpectrumHistorySlab.test.js
```

Expected: buffer-sharing tests fail because `freeze()` currently deep-copies every
retained row.

- [ ] **Step 3: Implement metric-specific Spectrum chunks**

Inside `SpectrumHistorySlab.js`, add private factory functions:

```js
function createSpectrumChunk(sequenceStart, bands, rowCapacity) {
  return {
    sequenceStart,
    rowCapacity,
    rowCount: 0,
    sealed: false,
    bands,
    timestamps: new Float64Array(rowCapacity),
    dbA: new Float32Array(rowCapacity * bands.length),
    dbB: null,
    hasB: null,
    maxInternalTimestampDeltaMs: 0,
  };
}
```

The slab owns:

```js
this._capacity = capacity;
this._chunkRows = VISUAL_HISTORY_CHUNK_ROWS;
this._chunks = [];
this._firstChunkId = 0;
this._startSequence = 0;
this._nextSequence = 0;
this._version = 0;
```

Append rules:

1. allocate a chunk aligned to `chunkIdForSequence(_nextSequence, _chunkRows)`;
2. write only to the unsealed active chunk;
3. update row count and timestamp-delta metadata;
4. mark it sealed when full;
5. increment `_nextSequence` and `_version`;
6. set `_startSequence = max(0, _nextSequence - _capacity)`;
7. drop chunks whose exclusive sequence end is `<= _startSequence`;
8. leave a partially retained oldest chunk untouched.

Use `Float32Array#set` only when source rows are already normalized. Preserve the
current `-Infinity`/`NaN` fallback behavior for malformed entries.

- [ ] **Step 4: Implement O(1) live reads**

Map logical index to absolute sequence:

```js
const sequence = this._startSequence + index;
const chunk = findChunkForSequence(this._chunks, this._firstChunkId, sequence, this._chunkRows);
const local = chunkOffsetForSequence(sequence, this._chunkRows);
```

`length`, `rowAt`, `timestampAt`, `at`, `bands`, `bandCount`, `capacity`,
`matchesBands`, `hasSecondary`, `version`, and `toArray` preserve their current
observable behavior.

The current `dbA`, `dbB`, and `timestamps` getters expose the monolithic
implementation and have no production consumers. Remove them rather than
materializing a fake contiguous array. Update their tests to assert
`storageStats().allocatedChunks`, `rowAt(...).dbList.buffer` sharing within a chunk,
and reference release after `clear()`.

- [ ] **Step 5: Implement structural-sharing `freeze()`**

At one JavaScript turn boundary:

1. record `startSequence` and `endSequence = _nextSequence`;
2. share every sealed chunk intersecting that interval;
3. clone only the active chunk rows included before `endSequence`;
4. return `FrozenSpectrumHistory` with its own chunk-reference array and sequence
   range.

If the newest chunk is exactly full and sealed, copy no payload.

`FrozenSpectrumHistory.rowAt` and `timestampAt` use the same sequence mapping. Its
`version` remains fixed.

- [ ] **Step 6: Run tests**

```powershell
npx vitest run src/lib/SpectrumHistorySlab.test.js
```

Expected: PASS with buffer identity for sealed rows and distinct buffer identity for
the mutable tail.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/SpectrumHistorySlab.js src/lib/SpectrumHistorySlab.test.js
git commit -m "perf(history): chunk Spectrum visual history"
```

---

## Task 3: Convert Vectorscope history to immutable chunks

**Files:**

- Modify: `src/lib/VectorscopeHistorySlab.js`
- Modify: `src/lib/VectorscopeHistorySlab.test.js`

- [ ] **Step 1: Add the same storage-contract tests**

Cover sealed-buffer sharing, active-tail copy, partial oldest chunk, freeze followed
by live eviction, clear, version, and capacity. Use 200 float values per row in the
production-shape case:

```js
const pairs = new Float32Array(200);
```

Keep exact coverage for `correlation`, `sideToMidDb`, `midEnergy`, and `sideEnergy`.

- [ ] **Step 2: Run and observe failure**

```powershell
npx vitest run src/lib/VectorscopeHistorySlab.test.js
```

- [ ] **Step 3: Implement Vectorscope chunks**

Use the same sequence/eviction/freeze rules as Spectrum, with chunk columns:

```js
{
  sequenceStart,
  rowCount,
  sealed,
  timestamps: Float64Array,
  pairs: Float32Array,
  correlation: Float64Array,
  sideToMidDb: Float64Array,
  midEnergy: Float64Array,
  sideEnergy: Float64Array,
  maxInternalTimestampDeltaMs
}
```

Do not introduce a shared inheritance hierarchy with Spectrum.

- [ ] **Step 4: Preserve the existing façade**

Keep `capacity`, `length`, `pairValueCount`, `matchesPairValueCount`, `push`,
`at`, `rowAt`, `timestampAt`, `toArray`, `freeze`, `clear`, and `version`.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run src/lib/VectorscopeHistorySlab.test.js src/math/vectorscopePolarMath.test.js src/math/vectorscopePersistence.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/VectorscopeHistorySlab.js src/lib/VectorscopeHistorySlab.test.js
git commit -m "perf(history): chunk Vectorscope visual history"
```

---

## Task 4: Integrate chunk sharing with FrameIntake and snapshots

**Files:**

- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`

- [ ] **Step 1: Strengthen keyed snapshot tests**

For at least two Spectrum keys and two Vectorscope keys:

- one key has sealed chunks plus a tail;
- one key has only a tail;
- freezing returns all retained keys;
- a key with sealed rows shares their backing buffer;
- each active tail gets its own frozen copy;
- pushes and eviction after freeze do not alter any frozen view;
- missing/request-gap behavior stays unchanged.

- [ ] **Step 2: Run and observe deep-copy behavior**

```powershell
npx vitest run src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx
```

The new buffer-identity assertion fails against monolithic snapshots.

- [ ] **Step 3: Keep FrameIntake’s public keyed API stable**

`snapshotVisualSpectrumByKey()` and `snapshotVisualVectorscopeByKey()` continue to
return `Record<requestKey, HistoryView>`, but each value now comes from the slab’s
structural-sharing `freeze()`.

Do not evict inactive request keys and do not backfill newly active keys.

- [ ] **Step 4: Keep scalar and visual freeze responsibilities separate**

`useSnapshot.freezeSnapshot` should:

- materialize scalar RingBuffer views through `toArray()` as established in plan 1;
- call FrameIntake’s keyed visual snapshot methods;
- perform no `Float32Array.from`, `slice`, or visual-row spread.

- [ ] **Step 5: Add structural freeze diagnostics to the benchmark**

Extend `scripts/history-perf-benchmark.mjs` to report per key:

- retained rows;
- sealed chunks shared;
- copied tail rows;
- copied tail bytes;
- elapsed freeze time.

Obtain diagnostics from a read-only `storageStats()` method on the slab/frozen view,
not `__private` fields. The method should return counts only.

Automated assertion:

```js
expect(frozen.storageStats().copiedTailRows).toBeLessThanOrEqual(VISUAL_HISTORY_CHUNK_ROWS);
expect(frozen.storageStats().sharedSealedChunks).toBeGreaterThan(0);
```

- [ ] **Step 6: Run the consumer regression set**

```powershell
npx vitest run src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/lib/snapshotResolve.test.js src/hooks/useSpectrogramCanvas.test.jsx src/components/panels/SpectrogramPanel.test.jsx src/dock/modules/DockSpectrogram.test.jsx src/components/panels/VectorscopePanel.test.jsx src/math/vectorscopePolarMath.test.js src/math/vectorscopePersistence.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/FrameIntake.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx scripts/history-perf-benchmark.mjs
git commit -m "perf(snapshot): share sealed visual history chunks"
```

---

## Task 5: Skip continuous Spectrogram chunks during gap scans

**Files:**

- Modify: `src/lib/SpectrumHistorySlab.js`
- Modify: `src/lib/SpectrumHistorySlab.test.js`
- Modify: `src/math/spectrogramTimeline.js`
- Modify: `src/math/spectrogramTimeline.test.js`
- Create: `src/lib/SparseHistoryMarkers.js`
- Create: `src/lib/SparseHistoryMarkers.test.js`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/panels/SpectrogramPanel.jsx`
- Modify: `src/components/panels/SpectrogramPanel.test.jsx`

- [ ] **Step 1: Add the optional optimized view contract**

Spectrum live and frozen views expose:

```js
timestampGapBoundaries(startIndex, endIndex, maxGapMs) {
  // Returns [{ previousTimestampMs, nextTimestampMs }] in chronological order.
}
```

Each chunk already maintains `maxInternalTimestampDeltaMs`. The query:

1. checks cross-chunk timestamp deltas;
2. skips internal rows when `maxInternalTimestampDeltaMs <= maxGapMs`;
3. scans rows only in chunks whose maximum internal delta exceeds the threshold;
4. clips results to the requested logical range.

- [ ] **Step 2: Add correctness and read-count tests**

```js
it("returns the same boundaries through metadata and the reference scan", () => {
  const view = buildChunkedTimestampView(withSeveralInteriorGaps);
  expect(view.timestampGapBoundaries(0, view.length - 1, 80)).toEqual(
    referenceTimestampGapBoundaries(view, 0, view.length - 1, 80)
  );
});

it("does not inspect every timestamp in a continuous 240-minute view", () => {
  const view = buildContinuousChunkedTimestampView(360_000);
  view.timestampGapBoundaries(0, view.length - 1, 80);
  const stats = view.lastGapQueryStats();
  expect(stats.rowsScanned).toBe(0);
  expect(stats.chunksInspected).toBeLessThanOrEqual(view.storageStats().chunkCount);
});
```

`lastGapQueryStats` records aggregate chunk/row counts once per query; do not add a
counter to every `timestampAt` call.

- [ ] **Step 3: Delegate from Spectrogram timeline math**

Keep the existing full scan as reference/fallback:

```js
if (typeof snaps.timestampGapBoundaries === "function") {
  return snaps.timestampGapBoundaries(startIndex, endIndex, maxGapMs).map(toMarker);
}
```

The optimized and fallback paths must return identical markers and ordering.

- [ ] **Step 4: Add a sparse frequency-marker index**

Before running, remove the other scalar retained-row scan in Spectrogram rendering.
`frequencyChannelMarkers.map(...)` currently visits every scalar row during render.
Add `SparseHistoryMarkers`:

```js
append(sequence, marker) {
  if (marker != null) this._entries.push({ sequence, marker });
}

query(startSequence, endSequence) {
  // Binary-search the first matching sequence, then return only matching markers.
}
```

Back it with the Stage-1 `RingBuffer` at scalar-history capacity. Stale entries may
remain before the retained start, but binary search skips them; because there is at
most one marker per source row, the most recent `capacity` marker entries contain
every marker that can still belong to the retained row window.

Expose live/frozen sparse marker indexes from FrameIntake/useSnapshot alongside the
source-matched display indexes. `SpectrogramPanel` queries only the visible sequence
range and maps returned `{ sequence, marker }` entries to x positions. Keep the
aligned marker RingBuffer during this migration because existing snapshot/export
contracts may still read it.

Add tests for empty, before/after range, wrap, binary-search read count, freeze
stability, and exact x positions.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run src/lib/SpectrumHistorySlab.test.js src/math/spectrogramTimeline.test.js src/hooks/useSpectrogramCanvas.test.jsx src/lib/SparseHistoryMarkers.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/components/panels/SpectrogramPanel.test.jsx
```

- [ ] **Step 6: Commit**

```powershell
git add src/lib/SpectrumHistorySlab.js src/lib/SpectrumHistorySlab.test.js src/math/spectrogramTimeline.js src/math/spectrogramTimeline.test.js src/lib/SparseHistoryMarkers.js src/lib/SparseHistoryMarkers.test.js src/lib/FrameIntake.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx src/App.jsx src/components/panels/SpectrogramPanel.jsx src/components/panels/SpectrogramPanel.test.jsx
git commit -m "perf(spectrogram): skip continuous history chunks"
```

---

## Task 6: Build an exact power-of-two min/max index

**Files:**

- Create: `src/lib/PowerOfTwoMinMaxIndex.js`
- Create: `src/lib/PowerOfTwoMinMaxIndex.test.js`

- [ ] **Step 1: Add deterministic and randomized failing tests**

The index accepts variable-width min/max vectors so Waveform can add channels
without rebuilding old history. Missing older channel values mean zero, matching
the current `row.waveformMin[ch] ?? 0` behavior.

Test:

- append and query one row;
- aligned and unaligned ranges;
- ring retention wrap;
- clear and capacity rebuild;
- dynamically increasing vector width;
- live and frozen query equality;
- randomized range results against a raw scan;
- operation count.

Core differential:

```js
for (const [start, end] of randomRanges) {
  const expected = rawRangeMinMax(rows, start, end, valueCount);
  const actual = index.queryRange(start, end, (sequence) => rawRowAt(sequence));
  expect(actual).toEqual(expected);
}
```

Structural bound:

```js
expect(index.lastQueryStats().nodesVisited).toBeLessThanOrEqual(
  valueCount * (2 * Math.ceil(Math.log2(capacity)) + 2)
);
```

- [ ] **Step 2: Implement immutable summary buckets**

Each bucket stores:

```js
{
  (startSequence,
    width, // power of two
    mins, // numeric array
    maxes); // numeric array
}
```

On append, binary-carry a width-1 bucket through pending levels. When two adjacent
equal-width buckets merge, store the resulting immutable bucket in that level’s
Stage-1 `RingBuffer`. Size each level to `ceil(capacity / width) + 2`.

Never call `Array.shift`.

- [ ] **Step 3: Implement exact arbitrary-range decomposition**

`queryRange(startSequence, endSequence, rawRowAt)` walks left to right:

1. use the largest aligned indexed bucket that fits wholly inside the range;
2. if no summary bucket fits, read that exact raw row;
3. merge min/max vectors;
4. continue after the selected bucket.

This is a canonical power-of-two decomposition, not “one guessed level plus a
large raw boundary scan.”

- [ ] **Step 4: Implement frozen index views**

`freeze()` snapshots each level with `RingBuffer.toArray()`. This copies only
immutable bucket references, not source rows or typed visual payloads. Record the
retained sequence range and pending buckets. A frozen query uses the same
decomposition.

Add benchmark output for index-freeze reference count and time. If this measured
copy exceeds one frame budget, replace per-level arrays with small immutable
reference chunks before proceeding; do not move the work to a Worker speculatively.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run src/lib/PowerOfTwoMinMaxIndex.test.js
```

Expected: PASS for randomized equality and operation bounds.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/PowerOfTwoMinMaxIndex.js src/lib/PowerOfTwoMinMaxIndex.test.js
git commit -m "feat(history): add exact min-max summary index"
```

---

## Task 7: Index and wire Loudness history paths

**Files:**

- Create: `src/math/loudnessHistoryIndex.js`
- Create: `src/math/loudnessHistoryIndex.test.js`
- Modify: `src/math/historyMath.js`
- Modify: `src/math/historyMath.test.js`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/panels/LoudnessPanel.jsx`
- Modify: `src/components/panels/LoudnessPanel.test.jsx`
- Modify: `src/dock/modules/DockLoudness.jsx`
- Modify: `src/dock/modules/DockLoudness.test.jsx`

- [ ] **Step 1: Implement a two-value Loudness wrapper**

`LoudnessHistoryIndex` owns one `PowerOfTwoMinMaxIndex` with values `[m, st]`:

```js
append(sequence, row) {
  this._index.append(sequence, [row.m, row.st], [row.m, row.st]);
}
```

Expose `queryRange`, `freeze`, `clear`, `version`, and `lastQueryStats`.

- [ ] **Step 2: Add an indexed path builder**

Keep `buildHistoryPath` unchanged as the reference implementation. Add:

```js
export function buildHistoryPathFromIndex(
  histSourceList,
  displayIndex,
  key,
  visibleSamples,
  effectiveOffsetSamples,
  toY,
  viewWidth = 600,
  targetColumns = viewWidth
) {
  // Preserve the reference start/end/count/x/bucket formulas exactly.
}
```

For each reference display bucket `b`, derive its inclusive source-index range:

```js
const bucketStart = start + Math.ceil((b * count) / cols);
const bucketEnd = start + Math.ceil(((b + 1) * count) / cols) - 1;
```

Translate logical indices to source sequences, query exact min/max, apply `toY` to
both endpoints, then preserve the reference path order (`maxY` followed by `minY`).
If `count <= cols`, call the reference raw path.

- [ ] **Step 3: Differential-test exact SVG envelopes**

Across randomized data, retention wrap, startup-short history, 600/1200 columns,
fractional offsets, and M/ST:

```js
expect(parseEnvelope(buildHistoryPathFromIndex(...)))
  .toEqual(parseEnvelope(buildHistoryPath(...)));
```

Also assert:

```js
expect(index.lastQueryStats().nodesVisited).toBeLessThanOrEqual(
  cols * (2 * Math.ceil(Math.log2(capacity)) + 2)
);
```

- [ ] **Step 4: Update FrameIntake atomically**

When scalar capacity is created/rebuilt, create a matching Loudness index. On each
`pushHistRow`, append to the scalar ring and index in the same method. On reset,
clear both.

Expose:

```js
getLoudnessDisplayIndex();
snapshotLoudnessDisplayIndex();
```

Add alignment tests proving newest row sequence and index retained range remain
equal after wrap.

- [ ] **Step 5: Freeze the source-matched index**

`useSnapshot.freezeSnapshot` stores `loudnessDisplayIndex:
intake.snapshotLoudnessDisplayIndex()`. Live mode uses
`intake.getLoudnessDisplayIndex()`. Return the selected source’s index from
`useSnapshot`.

Add it to `historyData` in `App.jsx`.

- [ ] **Step 6: Wire both Loudness renderers with fallback**

`LoudnessPanel` and `DockLoudness` call the indexed builder when the index exists;
plain-array tests and unusual callers fall back to `buildHistoryPath`.

Keep `latestSampleTimestampMs` in memo dependencies. Index identity and ring length
remain stable after capacity fills, so newest timestamp is still the update key.

- [ ] **Step 7: Run tests**

```powershell
npx vitest run src/lib/PowerOfTwoMinMaxIndex.test.js src/math/loudnessHistoryIndex.test.js src/math/historyMath.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/components/panels/LoudnessPanel.test.jsx src/dock/modules/DockLoudness.test.jsx
```

- [ ] **Step 8: Commit**

```powershell
git add src/math/loudnessHistoryIndex.js src/math/loudnessHistoryIndex.test.js src/math/historyMath.js src/math/historyMath.test.js src/lib/FrameIntake.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx src/App.jsx src/components/panels/LoudnessPanel.jsx src/components/panels/LoudnessPanel.test.jsx src/dock/modules/DockLoudness.jsx src/dock/modules/DockLoudness.test.jsx
git commit -m "perf(loudness): query exact history summaries"
```

---

## Task 8: Index and wire Waveform history

**Files:**

- Create: `src/math/waveformHistoryIndex.js`
- Create: `src/math/waveformHistoryIndex.test.js`
- Modify: `src/math/waveformMath.js`
- Modify: `src/math/waveformMath.test.js`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/panels/WaveformPanel.jsx`
- Modify: `src/components/panels/WaveformPanel.test.jsx`
- Modify: `src/dock/modules/DockWaveform.jsx`
- Modify: `src/dock/modules/DockWaveform.test.jsx`

- [ ] **Step 1: Implement the Waveform wrapper**

For every scalar history row, append:

```js
const valueCount = Math.max(row.waveformMin?.length ?? 0, row.waveformMax?.length ?? 0);
const mins = Array.from({ length: valueCount }, (_, ch) => row.waveformMin?.[ch] ?? 0);
const maxes = Array.from({ length: valueCount }, (_, ch) => row.waveformMax?.[ch] ?? 0);
```

The underlying index’s variable vector width treats missing values in older rows as
zero.

- [ ] **Step 2: Add an indexed wide-window query**

Keep `sliceWaveformSubHistory` as reference. Add
`sliceWaveformSubHistoryFromIndex`.

Reuse all current calculations for:

- `W`, `coordsPerBucket`;
- `newestVisible`, `oldestVisible`;
- `kStart`, `kEnd`, `bucketCount`, `fracPhase`;
- `firstBucket`, `lastBucket`;
- empty interior carry-forward.

Use the index only when `coordsPerBucket >= 1`. In that branch the reference already
uses whole-tick bounds for every row. For `coordsPerBucket < 1`, call the raw
reference path; at most approximately one raw history row per device pixel is
visible, so cost is already output-bounded and sub-block fidelity remains exact.

For output bucket `j`, solve the reference mapping
`floor((entry + 0.5) / coordsPerBucket) - kStart === j` for the inclusive integer
entry range, then query that range from the index.

- [ ] **Step 3: Differential-test the full return value**

Across randomized rows, 1–8 channels, startup gaps, wrap, integer/fractional
offsets, and 600/1200 widths:

```js
const expected = sliceWaveformSubHistory(...);
const actual = sliceWaveformSubHistoryFromIndex(...);
expect(actual.bucketCount).toBe(expected.bucketCount);
expect(actual.firstBucket).toBe(expected.firstBucket);
expect(actual.lastBucket).toBe(expected.lastBucket);
expect(actual.fracPhase).toBeCloseTo(expected.fracPhase);
expect(actual.mins).toEqual(expected.mins);
expect(actual.maxes).toEqual(expected.maxes);
```

Require exact equality for finite fixture values; use `toBeCloseTo` only where the
existing function produces fractional positioning.

- [ ] **Step 4: Integrate, freeze, and expose the index**

Follow the Loudness pattern:

- FrameIntake updates Waveform index in the same `pushHistRow`;
- capacity rebuild/reset updates raw and derived stores together;
- `useSnapshot` freezes and selects the source-matched Waveform index;
- `App` adds it to `historyData`;
- main and dock Waveform renderers use indexed query with raw fallback.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run src/lib/PowerOfTwoMinMaxIndex.test.js src/math/waveformHistoryIndex.test.js src/math/waveformMath.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/components/panels/WaveformPanel.test.jsx src/dock/modules/DockWaveform.test.jsx
```

- [ ] **Step 6: Commit**

```powershell
git add src/math/waveformHistoryIndex.js src/math/waveformHistoryIndex.test.js src/math/waveformMath.js src/math/waveformMath.test.js src/lib/FrameIntake.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx src/App.jsx src/components/panels/WaveformPanel.jsx src/components/panels/WaveformPanel.test.jsx src/dock/modules/DockWaveform.jsx src/dock/modules/DockWaveform.test.jsx
git commit -m "perf(waveform): query exact history summaries"
```

---

## Task 9: Add the synthetic 240-minute harness and final feedback loop

**Files:**

- Create: `src/dev/historyPerformanceHarness.js`
- Modify: `src/App.jsx`
- Modify: `scripts/history-perf-benchmark.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add an opt-in development-only harness**

Activate only when all are true:

```js
import.meta.env.DEV && new URLSearchParams(window.location.search).get("historyPerf") === "240m";
```

The module:

- seeds 144,000 scalar rows at 100 ms cadence;
- seeds 360,000 visual timestamps at 40 ms cadence;
- uses 958 Spectrum bands and 200 Vectorscope float values;
- seeds in idle batches and exposes progress, so it does not create one misleading
  multi-second UI long task;
- continues synthetic live appends after seeding;
- never loads in production builds.

Keep integration to one guarded dynamic import in `App.jsx`. The dev module may use
FrameIntake’s public push methods only; do not add production-only “bulk load” APIs
that bypass normalization or indexes.

Because full visual seeding consumes production-scale memory, support:

- default scalar + timestamp/index mode for quick UI checks;
- explicit `historyPerfFullVisual=1` for the full 958-band payload.

- [ ] **Step 2: Complete the benchmark report**

For 600 px and 1200 px report separately:

- full-window Loudness reference vs index;
- full-window Waveform reference vs index;
- snapshot freeze per visual key and total;
- copied tail bytes;
- nearest timestamp lookup;
- index freeze;
- scalar full-capacity push;
- projected and, with `--full-visual`, measured memory.

Automated structural assertions:

```js
expect(nearestReads).toBeLessThanOrEqual(24);
expect(snapshotStats.copiedTailRowsPerKey).toBeLessThanOrEqual(CHUNK_ROWS);
expect(loudnessStats.nodesVisited).toBeLessThanOrEqual(loudnessBound);
expect(waveformStats.nodesVisited).toBeLessThanOrEqual(waveformBound);
expect(arrayShiftCalls).toBe(0);
```

Do not put wall-clock thresholds in Vitest.

- [ ] **Step 3: Run the safe benchmark**

```powershell
npm run benchmark:history
```

Expected: completes without allocating all projected visual payloads and prints all
structural counts.

- [ ] **Step 4: Run the full visual benchmark intentionally**

Close other memory-heavy applications first:

```powershell
npm run benchmark:history -- --full-visual
```

Expected: stores all 360,000 rows at production widths, snapshot shares sealed
chunks, and only the final active chunk is copied.

- [ ] **Step 5: Run the complete focused regression**

```powershell
npx vitest run src/lib/SpectrumHistorySlab.test.js src/lib/VectorscopeHistorySlab.test.js src/lib/FrameIntake.test.js src/lib/snapshotResolve.test.js src/hooks/useSnapshot.test.jsx src/hooks/useSpectrogramCanvas.test.jsx src/math/spectrogramTimeline.test.js src/math/vectorscopePolarMath.test.js src/math/vectorscopePersistence.test.js src/lib/PowerOfTwoMinMaxIndex.test.js src/math/loudnessHistoryIndex.test.js src/math/historyMath.test.js src/math/waveformHistoryIndex.test.js src/math/waveformMath.test.js src/components/panels/LoudnessPanel.test.jsx src/components/panels/WaveformPanel.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Run the merge gate**

If sidecars are absent in this worktree:

```powershell
npm run ffmpeg:fetch
```

Then:

```powershell
npm run check
```

Expected: PASS.

- [ ] **Step 7: Verify the real UI**

```powershell
npm run dev -- --open "/?historyPerf=240m"
```

Then repeat with `&historyPerfFullVisual=1` when enough memory is available.

Verify:

- maximum zoom has no repeated retained-row long task;
- panel animations stay responsive;
- snapshot entry copies no sealed visual chunk;
- scrubbing and zooming into old data resolve exact rows;
- snapshot remains stable while synthetic live rows continue;
- snapshot exit immediately publishes the latest frame;
- 1-minute behavior and rendered envelopes are unchanged.

- [ ] **Step 8: Commit**

```powershell
git add src/dev/historyPerformanceHarness.js src/App.jsx scripts/history-perf-benchmark.mjs package.json
git commit -m "test(perf): add 240-minute history harness"
```

---

## Final acceptance checklist

- [ ] Every retained source cadence, row, Spectrum band, Vectorscope pair, and typed
      numeric payload matches the pre-change implementation.
- [ ] Snapshot visual freeze shares all sealed chunks and copies at most one tail per
      retained request key.
- [ ] Frozen views remain unchanged after arbitrary live appends and eviction.
- [ ] Timestamp lookup remains logarithmic.
- [ ] Spectrogram gap-marker work scales with chunk/gap count for continuous history.
- [ ] Loudness and wide-window Waveform queries inspect structurally bounded summary
      nodes, not every retained row.
- [ ] Randomized indexed/reference differential tests pass.
- [ ] The 240-minute safe and full-visual benchmarks pass.
- [ ] `npm run check` passes.
- [ ] No Rust capture-layer file changed; smoke/soak is therefore not required.

---

## Self-review

- **Precision:** chunks and indexes derive from exact source rows; no source row or
  frequency/time value is discarded.
- **Snapshot immutability:** sealed chunks are ownership-immutable; mutable tails are
  copied; live eviction only drops live references.
- **Memory honesty:** the plan does not claim full-resolution 240-minute Spectrum
  history is small. It removes eager monolithic allocation and duplicate snapshot
  copies while reporting projected/measured payload size.
- **Complexity honesty:** full-window indexed queries are bounded by display columns
  times logarithmic summary decomposition, independent of retained-row scans.
- **Surgical scope:** no Worker, Rust migration, persistence change, request-key
  eviction, or capture-thread work is introduced.
