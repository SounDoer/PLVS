# Full-Resolution History Hot Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed 240-minute live-render and snapshot-resolution hot paths without changing retained history precision, cadence, chart output, or snapshot semantics.

**Architecture:** Keep history frontend-owned and preserve all current source rows. First add a repeatable 240-minute benchmark shape, then remove dead path construction, replace timestamp scans with binary search, expose scalar history through chronological ring views, memoize frozen snapshot resolution, and separate “active source owns latest data” from “React should publish this frame” so snapshot mode can keep ingesting without rendering at 60 Hz.

**Tech Stack:** React 19, JavaScript typed arrays/ring views, Vitest, Node benchmark scripts.

**Reference spec:** `docs/superpowers/specs/2026-07-23-full-resolution-history-performance-design.md`

---

## File map

- Create: `scripts/history-perf-benchmark.mjs` — repeatable manual timing report without audio hardware.
- Modify: `package.json` — add `benchmark:history`.
- Modify: `src/lib/snapshotResolve.js` — generic history-view reads and binary nearest-timestamp lookup.
- Modify: `src/lib/snapshotResolve.test.js` — differential and comparison-count tests.
- Modify: `src/hooks/useLoudnessHistory.js` — remove unused path construction.
- Modify: `src/hooks/useLoudnessHistory.test.jsx` — assert no rendered-path ownership remains in the hook.
- Modify: `src/lib/RingBuffer.js` — stable chronological read-view API and version.
- Modify: `src/lib/RingBuffer.test.js` — wraparound/version/read-view coverage.
- Modify: `src/lib/FrameIntake.js` — use non-shifting rings for aligned scalar histories.
- Modify: `src/lib/FrameIntake.test.js` — alignment, wraparound, clear, and capacity coverage.
- Modify: `src/math/historyMath.js` — consume array-or-view rows.
- Modify: `src/math/waveformMath.js` — consume array-or-view rows.
- Modify: `src/math/spectrogramTimeline.js` — consume array-or-view history rows.
- Modify: `src/math/hoverMath.js` — consume array-or-view history rows.
- Modify: `src/components/panels/LoudnessPanel.jsx` — read the latest row through the view API.
- Modify: `src/components/panels/WaveformPanel.jsx` — read viewport edge rows through the view API.
- Modify: `src/dock/modules/DockLoudness.jsx` — read the latest row through the view API.
- Modify: `src/dock/modules/DockWaveform.jsx` — read the latest row through the view API.
- Modify: `src/hooks/useFileAnalysisEngine.js` — consume chronological scalar views.
- Modify: `src/App.jsx` — consume the newest scalar row through the view API.
- Modify: `src/hooks/useSnapshot.js` — cold-path materialization plus memoized main/keyed resolution.
- Modify: `src/hooks/useSnapshot.test.jsx` — frozen-resolution cache behavior.
- Modify: `src/hooks/useMeterDisplay.js` — own latest active-source audio independently of published React audio.
- Modify: `src/hooks/useMeterDisplay.test.jsx` — snapshot exit publishes latest once.
- Modify: `src/lib/tauriFrameApply.js` — always reduce latest active-source frame, conditionally publish React state.
- Modify: `src/lib/tauriFrameApply.test.js` — intake/ack/latest/publish gate contract.
- Modify: `src/hooks/useAudioEngine.js` — wire snapshot publish gate.
- Modify: `src/hooks/useFileAnalysisEngine.js` — combine active-file and snapshot gates.

---

## Task 1: Add the 240-minute performance feedback loop

**Files:**

- Create: `scripts/history-perf-benchmark.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the benchmark script**

Create `scripts/history-perf-benchmark.mjs`. Keep the default run safe: allocate
144,000 compact main rows, represent 360,000 visual timestamps with a lazy view,
and report projected visual bytes instead of allocating a 1.3 GiB Spectrum slab.

```js
import { performance } from "node:perf_hooks";
import { buildHistoryPath } from "../src/math/historyMath.js";
import { sliceWaveformSubHistory } from "../src/math/waveformMath.js";
import { nearestTimestampIndex } from "../src/lib/snapshotResolve.js";

const HIST_ROWS = 144_000;
const VISUAL_ROWS = 360_000;
const SPECTRUM_BANDS = 958;
const VECTOR_VALUES = 200;

function mainRows() {
  return Array.from({ length: HIST_ROWS }, (_, index) => ({
    m: -20 + Math.sin(index / 41),
    st: -22 + Math.cos(index / 67),
    waveformMin: [-0.5, -0.4],
    waveformMax: [0.5, 0.4],
    waveformSubPairs: new Float32Array(0),
    waveformSubCount: 0,
    timestampMs: index * 100,
  }));
}

function visualTimestampView() {
  let comparisons = 0;
  return {
    get length() {
      return VISUAL_ROWS;
    },
    timestampAt(index) {
      comparisons += 1;
      return index >= 0 && index < VISUAL_ROWS ? index * 40 : NaN;
    },
    comparisons() {
      return comparisons;
    },
  };
}

function time(label, callback, iterations = 20) {
  for (let index = 0; index < 3; index += 1) callback();
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) callback();
  const elapsed = (performance.now() - started) / iterations;
  console.log(`${label}: ${elapsed.toFixed(3)} ms`);
}

const rows = mainRows();
time("loudness M+ST / 240m / 600px", () => {
  buildHistoryPath(rows, "m", HIST_ROWS, 0, (value) => value, 600, 600);
  buildHistoryPath(rows, "st", HIST_ROWS, 0, (value) => value, 600, 600);
});
time("waveform / 240m / 600px", () => {
  sliceWaveformSubHistory(rows, HIST_ROWS, 0, 2, 600);
});

const timestamps = visualTimestampView();
const readsBefore = timestamps.comparisons();
time(
  "nearest visual timestamp / 240m",
  () => nearestTimestampIndex(timestamps, (VISUAL_ROWS - 2.5) * 40),
  100
);
const readsPerLookup = (timestamps.comparisons() - readsBefore) / 100;

const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(`nearest timestamp comparisons/lookup: ${readsPerLookup}`);
console.log(`projected Spectrum primary: ${mib(VISUAL_ROWS * SPECTRUM_BANDS * 4)} MiB`);
console.log(`projected Vectorscope: ${mib(VISUAL_ROWS * VECTOR_VALUES * 4)} MiB`);
```

- [ ] **Step 2: Add the package script**

Add to `package.json` scripts:

```json
"benchmark:history": "node scripts/history-perf-benchmark.mjs"
```

- [ ] **Step 3: Run and save the baseline in the task notes**

Run:

```powershell
npm run benchmark:history
```

Expected: the script completes without allocating full visual slabs and prints
separate Loudness, Waveform, timestamp-comparison, and projected-memory values.
Copy the numbers into the implementation task notes; do not assert wall-clock
values in Vitest.

- [ ] **Step 4: Verify the script does not alter generated or lock files**

Run:

```powershell
git status --short
```

Expected: only `package.json` and `scripts/history-perf-benchmark.mjs` are changed.

- [ ] **Step 5: Commit**

```powershell
git add package.json scripts/history-perf-benchmark.mjs
git commit -m "test(perf): add full-resolution history benchmark"
```

---

## Task 2: Replace nearest-timestamp linear scans with binary search

**Files:**

- Modify: `src/lib/snapshotResolve.js`
- Modify: `src/lib/snapshotResolve.test.js`

- [ ] **Step 1: Add differential and edge-case tests**

Export `nearestTimestampIndex` in the test import and add a local linear reference
that preserves the current later-row-on-tie behavior:

```js
import {
  nearestTimestampIndex,
  resolveSnapshot,
  resolveKeyedVisualIndex,
} from "./snapshotResolve.js";

function linearNearest(rows, targetMs) {
  if (rows.length === 0 || !Number.isFinite(targetMs)) return -1;
  let best = 0;
  let distance = Math.abs(rows[0].timestampMs - targetMs);
  for (let index = 1; index < rows.length; index += 1) {
    const next = Math.abs(rows[index].timestampMs - targetMs);
    if (next <= distance) {
      best = index;
      distance = next;
    }
  }
  return best;
}
```

Add:

```js
describe("nearestTimestampIndex", () => {
  it("prefers the later row on an exact tie", () => {
    expect(
      nearestTimestampIndex(viewOf([{ timestampMs: 1000 }, { timestampMs: 1020 }]), 1010)
    ).toBe(1);
  });

  it("clamps naturally to the first and last rows", () => {
    const view = viewOf([{ timestampMs: 1000 }, { timestampMs: 1040 }, { timestampMs: 1080 }]);
    expect(nearestTimestampIndex(view, 1)).toBe(0);
    expect(nearestTimestampIndex(view, 9000)).toBe(2);
  });

  it("matches the linear reference for chronological rows with gaps", () => {
    let timestamp = 0;
    const rows = Array.from({ length: 500 }, (_, index) => {
      timestamp += index % 17 === 0 ? 400 : 40;
      return { timestampMs: timestamp };
    });
    const view = viewOf(rows);
    for (let target = -50; target <= timestamp + 50; target += 13) {
      expect(nearestTimestampIndex(view, target)).toBe(linearNearest(rows, target));
    }
  });

  it("uses logarithmic timestamp reads for a 240-minute visual view", () => {
    let reads = 0;
    const view = {
      length: 360_000,
      timestampAt(index) {
        reads += 1;
        return index * 40;
      },
    };
    expect(nearestTimestampIndex(view, 8_765_432)).toBeGreaterThanOrEqual(0);
    expect(reads).toBeLessThanOrEqual(24);
  });
});
```

- [ ] **Step 2: Run the focused test and observe the structural failure**

```powershell
npx vitest run src/lib/snapshotResolve.test.js -t "nearestTimestampIndex"
```

Expected: the logarithmic-read test fails because the current implementation reads
approximately 360,000 timestamps.

- [ ] **Step 3: Implement lower-bound nearest lookup**

Replace `nearestTimestampIndex` with:

```js
export function nearestTimestampIndex(entries, targetMs) {
  const length = lengthOf(entries);
  if (!hasTimestampEntries(entries) || !Number.isFinite(targetMs)) return -1;

  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (timestampAt(entries, middle) < targetMs) low = middle + 1;
    else high = middle;
  }

  if (low <= 0) return 0;
  if (low >= length) return length - 1;

  const before = low - 1;
  const beforeDistance = Math.abs(timestampAt(entries, before) - targetMs);
  const afterDistance = Math.abs(timestampAt(entries, low) - targetMs);
  return afterDistance <= beforeDistance ? low : before;
}
```

- [ ] **Step 4: Run snapshot resolution tests**

```powershell
npx vitest run src/lib/snapshotResolve.test.js
```

Expected: PASS, including interior-gap and later-row tie behavior.

- [ ] **Step 5: Re-run the benchmark**

```powershell
npm run benchmark:history
```

Expected: timestamp reads remain logarithmic and the timing no longer grows
linearly with 360,000 rows.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/snapshotResolve.js src/lib/snapshotResolve.test.js
git commit -m "perf(snapshot): resolve timestamps with binary search"
```

---

## Task 3: Remove redundant Loudness path construction

**Files:**

- Modify: `src/hooks/useLoudnessHistory.js`
- Modify: `src/hooks/useLoudnessHistory.test.jsx`
- Verify: `src/components/panels/LoudnessPanel.test.jsx`

- [ ] **Step 1: Add an ownership regression test**

In `useLoudnessHistory.test.jsx`, add:

```js
it("returns viewport data without owning rendered SVG paths", () => {
  const { result } = renderHook(() => useLoudnessHistory({ ...baseProps, sourceMode: "live" }));
  expect(result.current).not.toHaveProperty("displayHistoryPathM");
  expect(result.current).not.toHaveProperty("displayHistoryPathST");
});
```

This fails against the current hook and directly locks the ownership boundary:
`LoudnessPanel` owns displayed paths.

- [ ] **Step 2: Run the focused test and observe failure**

```powershell
npx vitest run src/hooks/useLoudnessHistory.test.jsx -t "without owning rendered SVG paths"
```

Expected: FAIL because both properties are currently returned.

- [ ] **Step 3: Remove the dead work**

In `useLoudnessHistory.js`:

- remove `loudnessHistY` from the scales import;
- remove `buildHistoryPath` from the history-math import;
- remove `CHART_HEIGHT_PX`;
- delete both `buildHistoryPath(...)` calls;
- delete `displayHistoryPathM` and `displayHistoryPathST` from the return object.

Do not change `LoudnessPanel.jsx`; its width-aware, timestamp-keyed `useMemo` remains
the single rendered-path implementation.

- [ ] **Step 4: Run hook and panel tests**

```powershell
npx vitest run src/hooks/useLoudnessHistory.test.jsx src/components/panels/LoudnessPanel.test.jsx
```

Expected: PASS, including the existing test that keeps the curve advancing after
the retention ring fills.

- [ ] **Step 5: Re-run the benchmark and record the architectural result**

The pure path benchmark remains intentionally unchanged because the path function
still exists. The App hot path is improved because `useLoudnessHistory` no longer
calls it at UI-frame cadence.

- [ ] **Step 6: Commit**

```powershell
git add src/hooks/useLoudnessHistory.js src/hooks/useLoudnessHistory.test.jsx
git commit -m "perf(loudness): remove redundant history path builds"
```

---

## Task 4: Migrate scalar histories to chronological ring views

**Files:**

- Modify: `src/lib/RingBuffer.js`
- Modify: `src/lib/RingBuffer.test.js`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/lib/snapshotResolve.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/math/historyMath.js`
- Modify: `src/math/waveformMath.js`
- Modify: `src/math/spectrogramTimeline.js`
- Modify: `src/math/hoverMath.js`
- Modify: `src/components/panels/LoudnessPanel.jsx`
- Modify: `src/components/panels/WaveformPanel.jsx`
- Modify: `src/dock/modules/DockLoudness.jsx`
- Modify: `src/dock/modules/DockWaveform.jsx`
- Modify: `src/hooks/useFileAnalysisEngine.js`
- Modify: `src/App.jsx`

- [ ] **Step 1: Define and test the chronological view contract**

Add these tests to `RingBuffer.test.js`:

```js
it("implements rowAt as a chronological alias of at", () => {
  const rb = new RingBuffer(3);
  rb.push({ timestampMs: 10 });
  rb.push({ timestampMs: 20 });
  rb.push({ timestampMs: 30 });
  rb.push({ timestampMs: 40 });
  expect(rb.rowAt(0)).toEqual({ timestampMs: 20 });
  expect(rb.rowAt(2)).toEqual({ timestampMs: 40 });
});

it("reads row timestamps without materializing the ring", () => {
  const rb = new RingBuffer(2);
  rb.push({ timestampMs: 10 });
  rb.push({ timestampMs: 20 });
  expect(rb.timestampAt(0)).toBe(10);
  expect(rb.timestampAt(1)).toBe(20);
});

it("increments version on push and clear", () => {
  const rb = new RingBuffer(2);
  const initial = rb.version;
  rb.push("a");
  expect(rb.version).toBe(initial + 1);
  rb.clear();
  expect(rb.version).toBe(initial + 2);
});

it("supports chronological iteration and map during array-view migration", () => {
  const rb = new RingBuffer(2);
  rb.push("a");
  rb.push("b");
  rb.push("c");
  expect([...rb]).toEqual(["b", "c"]);
  expect(rb.map((value, index) => `${index}:${value}`)).toEqual(["0:b", "1:c"]);
});
```

- [ ] **Step 2: Implement the view API**

In `RingBuffer.js`, initialize `_version = 0`, increment it in `push` and `clear`,
and add:

```js
rowAt(index) {
  return this.at(index);
}

timestampAt(index) {
  return this.at(index)?.timestampMs;
}

get version() {
  return this._version;
}

*[Symbol.iterator]() {
  for (let index = 0; index < this.length; index += 1) yield this.at(index);
}

map(callback) {
  const output = new Array(this.length);
  for (let index = 0; index < this.length; index += 1) {
    output[index] = callback(this.at(index), index, this);
  }
  return output;
}
```

Run:

```powershell
npx vitest run src/lib/RingBuffer.test.js
```

Expected: PASS.

- [ ] **Step 3: Add array-or-view access helpers inside each pure module**

Use the same local helper shape in `historyMath.js`, `waveformMath.js`,
`spectrogramTimeline.js`, `hoverMath.js`, and `snapshotResolve.js`:

```js
function rowAt(entries, index) {
  if (!entries) return undefined;
  if (typeof entries.rowAt === "function") return entries.rowAt(index);
  if (typeof entries.at === "function" && !Array.isArray(entries)) return entries.at(index);
  return entries[index];
}
```

Replace direct `histSourceList[index]` reads in those files with `rowAt(...)`.
In `snapshotResolve`, use `rowAt` for the newest hist row, audio, correlation,
and channel metadata:

```js
const newestHist = rowAt(histSourceList, lengthOf(histSourceList) - 1);
const displayAudio = audioSnapIdx >= 0 ? rowAt(audioList, audioSnapIdx) : liveAudio;
const snapCorrelation = rowAt(corrList, snapIdx);
const channelMetadata = snapIdx >= 0 ? rowAt(channelMetadataList, snapIdx) : null;
```

Keep plain arrays supported so panel/unit fixtures do not need a flag-day rewrite.

- [ ] **Step 4: Replace FrameIntake scalar arrays with rings**

In `FrameIntake` constructor, initialize scalar rings with a minimal capacity:

```js
this._histCapacity = 1;
this._loudnessHist = new RingBuffer(1);
this._audioSnap = new RingBuffer(1);
this._corrSnap = new RingBuffer(1);
this._frequencyChannelMarkers = new RingBuffer(1);
this._channelMetadataSnap = new RingBuffer(1);
```

Add a private rebuild method:

```js
_rebuildScalarHistory(capacity) {
  this._histCapacity = capacity;
  this._loudnessHist = new RingBuffer(capacity);
  this._audioSnap = new RingBuffer(capacity);
  this._corrSnap = new RingBuffer(capacity);
  this._frequencyChannelMarkers = new RingBuffer(capacity);
  this._channelMetadataSnap = new RingBuffer(capacity);
}
```

Require a positive `histMaxSamples` at the existing call boundary. In
`pushHistRow`, call `_rebuildScalarHistory(histMaxSamples)` on mismatch, then
replace each `ringPush(array, value, max)` with `ring.push(value)`. Delete the
local `ringPush` function.

In `reset`, call `clear()` on each ring rather than replacing it with an array.
Capacity changes continue to replace all five rings together.

- [ ] **Step 5: Update cold materialization and direct edge reads**

In `useSnapshot.freezeSnapshot`, use:

```js
function snapshotRows(view) {
  if (!view) return [];
  if (typeof view.toArray === "function") return view.toArray();
  return Array.from(view);
}
```

Apply it to loudness, corr, audio, and channel metadata.

In `useFileAnalysisEngine.detectHistoryTruncation`:

```js
const first = typeof loudness.rowAt === "function" ? loudness.rowAt(0) : loudness[0];
const last =
  typeof loudness.rowAt === "function"
    ? loudness.rowAt(loudness.length - 1)
    : loudness[loudness.length - 1];
```

In `App.jsx`, `LoudnessPanel.jsx`, and both Dock history renderers, read the newest
history row through `rowAt` when available. In `WaveformPanel.jsx`, use `rowAt` for
the viewport start/end rows.

- [ ] **Step 6: Update FrameIntake assertions**

Change tests that compare getter results directly with arrays to compare
`getter().toArray()`. Add:

```js
it("keeps all scalar columns aligned after wraparound without Array.shift", () => {
  const intake = new FrameIntake();
  const shift = vi.spyOn(Array.prototype, "shift");
  for (let index = 0; index < 6; index += 1) {
    intake.setCurrentChannelMetadata({
      frequencyLabel: `f-${index}`,
      vectorscopePairLabel: `v-${index}`,
    });
    intake.pushHistRow(makeRow({ timestampMs: index * 100, correlation: index }), 3);
  }
  expect(
    intake
      .getLoudnessHistory()
      .toArray()
      .map((row) => row.timestampMs)
  ).toEqual([300, 400, 500]);
  expect(intake.getCorrSnap().toArray()).toEqual([3, 4, 5]);
  expect(
    intake
      .getChannelMetadataSnap()
      .toArray()
      .map((row) => row.frequencyLabel)
  ).toEqual(["f-3", "f-4", "f-5"]);
  expect(shift).not.toHaveBeenCalled();
});
```

Restore the spy after the assertion.

- [ ] **Step 7: Run focused migration tests**

```powershell
npx vitest run src/lib/RingBuffer.test.js src/lib/FrameIntake.test.js src/lib/snapshotResolve.test.js src/math/historyMath.test.js src/math/waveformMath.test.js src/math/spectrogramTimeline.test.js src/math/hoverMath.test.js src/components/panels/LoudnessPanel.test.jsx src/components/panels/WaveformPanel.test.jsx src/dock/modules/DockLoudness.test.jsx src/dock/modules/DockWaveform.test.jsx src/hooks/useFileAnalysisEngine.test.jsx src/hooks/useSnapshot.test.jsx
```

Expected: PASS with both plain-array fixtures and live RingBuffer views.

- [ ] **Step 8: Search for remaining direct assumptions**

Run:

```powershell
rg "get(LoudnessHistory|AudioSnap|CorrSnap|FrequencyChannelMarkers|ChannelMetadataSnap)" src
```

Inspect every match. No production consumer may spread or bracket-index a scalar
getter result unless it first branches for the chronological view API.

- [ ] **Step 9: Commit**

```powershell
git add src/lib/RingBuffer.js src/lib/RingBuffer.test.js src/lib/FrameIntake.js src/lib/FrameIntake.test.js src/lib/snapshotResolve.js src/hooks/useSnapshot.js src/math/historyMath.js src/math/waveformMath.js src/math/spectrogramTimeline.js src/math/hoverMath.js src/components/panels/LoudnessPanel.jsx src/components/panels/WaveformPanel.jsx src/dock/modules/DockLoudness.jsx src/dock/modules/DockWaveform.jsx src/hooks/useFileAnalysisEngine.js src/App.jsx
git commit -m "perf(history): replace shifting scalar arrays with rings"
```

---

## Task 5: Memoize frozen snapshot resolution

**Files:**

- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`

- [ ] **Step 1: Add repeat-resolution call-count tests**

Use fake views whose `timestampAt` increments a counter. Add tests that:

1. enter snapshot once;
2. rerender with a new live `audio` object and the same selected offset;
3. assert main frozen timestamp reads do not increase;
4. call the same keyed Spectrum resolver twice and assert the second call performs
   no timestamp reads;
5. call with a different target offset and assert the cache invalidates.

Core assertion shape:

```js
expect(readsAfterSecondLiveFrame).toBe(readsAfterFreeze);
expect(readsAfterSecondKeyResolve).toBe(readsAfterFirstKeyResolve);
```

- [ ] **Step 2: Run the tests and observe repeated work**

```powershell
npx vitest run src/hooks/useSnapshot.test.jsx -t "memo"
```

Expected: FAIL because `resolveSnapshot` and keyed path builders currently run on
each render/call.

- [ ] **Step 3: Memoize main resolution with a snapshot-stable live fallback**

Inside `useSnapshot`:

```js
const resolveLiveAudio = isSnapshotSelected ? (snapSource?.audio.at(-1) ?? audio) : audio;

const resolved = useMemo(
  () =>
    resolveSnapshot({
      selectedOffset,
      sampleSec,
      histSourceList,
      audioList: snapSource ? snapSource.audio : intake.getAudioSnap(),
      corrList: snapSource ? snapSource.corr : intake.getCorrSnap(),
      channelMetadataList: snapSource
        ? snapSource.channelMetadata
        : (intake.getChannelMetadataSnap?.() ?? []),
      liveAudio: resolveLiveAudio,
    }),
  [selectedOffset, sampleSec, histSourceList, snapSource, resolveLiveAudio, intake]
);
```

Because `resolveLiveAudio` is derived from frozen data in snapshot mode, incoming
live audio objects no longer invalidate the frozen resolve.

- [ ] **Step 4: Add per-view keyed caches**

Keep caches scoped to the current `snapSource`. A suitable shape is:

```js
const keyedCacheRef = useRef({
  snapSource: null,
  spectrum: new WeakMap(),
  vectorscope: new WeakMap(),
});
if (keyedCacheRef.current.snapSource !== snapSource) {
  keyedCacheRef.current = {
    snapSource,
    spectrum: new WeakMap(),
    vectorscope: new WeakMap(),
  };
}
```

For each entries object, store a `Map` keyed by target timestamp. Vectorscope keys
also include `withPeakHold`. Cache the final returned object, including SVG path,
so repeated panel renders do not rebuild paths.

Do not cache a live mutable view in this task; keyed resolvers are snapshot-only.

- [ ] **Step 5: Keep resolver callbacks identity-stable**

Wrap `resolveSpectrumSnapshotForKey` and
`resolveVectorscopeSnapshotForKey` in `useCallback`, keyed by `snapSource`,
`resolved.targetTimestampMs`, and `keyToleranceMs`.

- [ ] **Step 6: Run snapshot suites**

```powershell
npx vitest run src/hooks/useSnapshot.test.jsx src/lib/snapshotResolve.test.js src/components/panels/SpectrumPanel.test.jsx src/components/panels/VectorscopePanel.test.jsx
```

Expected: PASS; request-gap and Polar Level peak-hold behavior remain unchanged.

- [ ] **Step 7: Commit**

```powershell
git add src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx
git commit -m "perf(snapshot): cache frozen history resolution"
```

---

## Task 6: Stop publishing 60 Hz React audio state while snapshot is open

**Files:**

- Modify: `src/hooks/useMeterDisplay.js`
- Modify: `src/hooks/useMeterDisplay.test.jsx`
- Modify: `src/lib/tauriFrameApply.js`
- Modify: `src/lib/tauriFrameApply.test.js`
- Modify: `src/hooks/useAudioEngine.js`
- Modify: `src/hooks/useFileAnalysisEngine.js`

- [ ] **Step 1: Test latest-data ownership separately from React publication**

Extend `tauriFrameApply.test.js` with:

```js
it("tracks the latest active-source audio during snapshot without publishing React state", () => {
  const latestAudioRef = {
    current: {
      peakDb: [],
      peakHoldDb: [],
      samplePeakMaxL: -Infinity,
      samplePeakMaxR: -Infinity,
      spectrumResultsByKey: {},
      vectorscopeResultsByKey: {},
    },
  };
  const setAudio = vi.fn();
  const pushFrame = vi.fn();
  const { applyFrame } = buildTauriFrameApply(
    makeOptions({
      latestAudioRef,
      setAudio,
      intake: { pushFrame },
      shouldPublishDisplay: () => false,
    })
  );
  applyFrame({
    lufsMomentary: -12,
    lufsShortTerm: -14,
    sampleLDb: -3,
    sampleRDb: -4,
    peakDb: [],
    peakHoldDb: [],
  });
  expect(pushFrame).toHaveBeenCalledTimes(1);
  expect(latestAudioRef.current.momentary).toBe(-12);
  expect(setAudio).not.toHaveBeenCalled();
});
```

Add a second test proving `shouldDriveDisplay: false` does not update the shared
latest ref, so background file analysis cannot hijack the active display.

- [ ] **Step 2: Extract a pure frame reducer**

In `tauriFrameApply.js`, extract the body of the current `setAudio` updater:

```js
export function reduceMeterAudioFrame(previous, frame) {
  const m = Number.isFinite(frame.lufsMomentary) ? frame.lufsMomentary : -Infinity;
  const st = Number.isFinite(frame.lufsShortTerm) ? frame.lufsShortTerm : -Infinity;
  return {
    ...previous,
    // Preserve the existing field assignments verbatim.
    momentary: m,
    shortTerm: st,
    // Keep samplePeakMaxL/R based on previous so paused publication still accumulates maxima.
  };
}
```

Move every existing field from the updater without renaming or changing fallbacks.

- [ ] **Step 3: Split active-source and publish gates**

Add options:

```js
latestAudioRef,
shouldPublishDisplay = () => true,
```

After intake and ack:

```js
if (!shouldDriveDisplay()) return;
const nextAudio = reduceMeterAudioFrame(latestAudioRef.current, f);
latestAudioRef.current = nextAudio;
if (!shouldPublishDisplay()) return;
setAudio(nextAudio);
```

This ordering is mandatory:

1. intake and ack always;
2. inactive source returns before touching shared latest audio;
3. active source always reduces latest audio;
4. snapshot only suppresses React publication.

- [ ] **Step 4: Make `useMeterDisplay` own the latest ref**

Replace the raw state setter with an identity-stable wrapper:

```js
const [audio, setAudioState] = useState({ ...INITIAL_METER_AUDIO });
const latestAudioRef = useRef({ ...INITIAL_METER_AUDIO });
const setAudio = useCallback((nextOrUpdater) => {
  const next =
    typeof nextOrUpdater === "function" ? nextOrUpdater(latestAudioRef.current) : nextOrUpdater;
  latestAudioRef.current = next;
  setAudioState(next);
}, []);
```

When `setSelectedOffset` transitions from a non-negative previous ref to a negative
value, publish `latestAudioRef.current` once:

```js
const wasSnapshot = selectedOffsetRef.current >= 0;
selectedOffsetRef.current = value;
if (wasSnapshot && value < 0) setAudio(latestAudioRef.current);
```

Return `latestAudioRef` from the hook. Implement `clearAudio` through `setAudio` so
state and ref clear together.

- [ ] **Step 5: Add snapshot-exit tests**

In `useMeterDisplay.test.jsx`:

```js
it("publishes the latest active-source frame once when snapshot exits", () => {
  const { result } = renderHook(() => useMeterDisplay());
  act(() => result.current.setSelectedOffset(10));
  result.current.latestAudioRef.current = {
    ...INITIAL_METER_AUDIO,
    momentary: -7,
  };
  act(() => result.current.setSelectedOffset(-1));
  expect(result.current.audio.momentary).toBe(-7);
});
```

Extend the identity-stability test with `latestAudioRef`.

- [ ] **Step 6: Wire both engines**

In `useAudioEngine`, pass:

```js
latestAudioRef: display.latestAudioRef,
shouldPublishDisplay: () => display.selectedOffsetRef.current < 0,
```

In `useFileAnalysisEngine`, retain the existing active-file
`shouldDriveDisplay` callback and pass the same `latestAudioRef` and snapshot
publish callback. Do not fold snapshot state into `shouldDriveDisplay`, because the
active file must continue updating latest audio while snapshot is open.

- [ ] **Step 7: Run runtime tests**

```powershell
npx vitest run src/lib/tauriFrameApply.test.js src/hooks/useMeterDisplay.test.jsx src/hooks/useAudioEngine.test.js src/hooks/useFileAnalysisEngine.test.jsx src/hooks/useSnapshot.test.jsx
```

Expected: PASS. Intake and acknowledgements continue under both inactive-source and
snapshot conditions; only the active source updates latest audio; only live mode
publishes every frame.

- [ ] **Step 8: Commit**

```powershell
git add src/hooks/useMeterDisplay.js src/hooks/useMeterDisplay.test.jsx src/lib/tauriFrameApply.js src/lib/tauriFrameApply.test.js src/hooks/useAudioEngine.js src/hooks/useFileAnalysisEngine.js
git commit -m "perf(runtime): pause frame publication during snapshots"
```

---

## Task 7: Stage-1 verification and baseline handoff

**Files:** none unless verification exposes a defect.

- [ ] **Step 1: Run focused performance-related suites**

```powershell
npx vitest run src/lib/snapshotResolve.test.js src/hooks/useLoudnessHistory.test.jsx src/lib/RingBuffer.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/lib/tauriFrameApply.test.js src/hooks/useMeterDisplay.test.jsx
```

Expected: PASS.

- [ ] **Step 2: Run the manual benchmark**

```powershell
npm run benchmark:history
```

Expected structural results:

- nearest timestamp uses no more than 24 timestamp reads;
- no benchmark stage allocates a full 240-minute Spectrum slab;
- Loudness/Waveform timings are recorded as the before-index baseline for plan 2.

- [ ] **Step 3: Run the merge gate**

The fresh worktree needs verified sidecars before the Rust half of the merge gate:

```powershell
npm run ffmpeg:fetch
npm run check
```

Expected: version, format, lint, 1971+ tests, build, Rust fmt/clippy/test all pass.

- [ ] **Step 4: Run the real desktop comparison**

```powershell
npm run desktop
```

Using a retained or synthetic 240-minute session:

- compare maximum zoom with the 1-minute viewport;
- enter and exit snapshot;
- confirm audio intake continues while snapshot is open;
- confirm exiting snapshot shows current data immediately;
- record a browser performance trace around snapshot entry.

Stage 1 is accepted when there is no retained-history scan in the approximately
60 Hz path and timestamp resolution is logarithmic. Full-slab snapshot copy and
history-cadence full-window scans remain the explicit baselines for plan 2.

---

## Self-review

- **Spec coverage:** benchmark, dead Loudness work, binary timestamps, non-shifting scalar rings, snapshot memo, and snapshot publication gating are covered.
- **Precision:** no task changes cadence, row count, numeric type, Spectrum bands, Vectorscope pairs, or chart aggregation semantics.
- **Snapshot semantics:** intake and latest active-source state continue; frozen display remains stable; exit publishes latest once.
- **Type consistency:** all migrated histories expose `length`, `rowAt`, optional `timestampAt`, `toArray`, and `version`; plain arrays remain accepted by pure helpers.
- **No timing flakiness:** CI assertions use read counts, call counts, and output equality. Wall-clock values stay in the manual benchmark.
- **Commit boundaries:** each behavior change is independently testable and reversible.
