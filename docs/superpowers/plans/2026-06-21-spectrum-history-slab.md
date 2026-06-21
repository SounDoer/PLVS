# Spectrum History Slab Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce WebView2 memory pressure from long-running Spectrum and Spectrogram history by replacing request-keyed per-tick JS object/array storage with `Float32Array` slab storage, while keeping the existing 2-hour visual history cap and user-visible behavior.

**Architecture:** Add a pure `SpectrumHistorySlab` storage module that implements ring-buffer semantics over contiguous typed arrays. `FrameIntake` continues to own history and public reader methods, but request-keyed spectrum histories move from `RingBuffer<{ bands, dbList, dbListB, timestampMs }>` to `SpectrumHistorySlab`. Component-facing history entries remain array-shaped for v1, using typed-array row views under the hood.

**Tech Stack:** React 19, Vite, Vitest, JS modules, typed arrays (`Float32Array`, `Float64Array`).

**Spec:** `docs/superpowers/specs/2026-06-21-spectrum-history-slab-design.md`

---

## File Structure

- **Create** `src/lib/SpectrumHistorySlab.js` - typed-array ring storage for per-request spectrum history.
- **Create** `src/lib/SpectrumHistorySlab.test.js` - unit tests for storage, chronological reads, overwrite behavior, grid reset, secondary curve, and clear.
- **Modify** `src/lib/FrameIntake.js` - replace request-keyed spectrum visual rings with slabs; keep existing public methods stable.
- **Modify** `src/lib/FrameIntake.test.js` - update request-keyed history expectations for typed row views and add regression coverage for slab clear/reset behavior.
- **Possibly modify** `src/hooks/useSnapshot.test.jsx` / `src/components/panels/SpectrogramPanel.test.jsx` only if typed row views expose consumer assumptions that need explicit test fixtures.

---

## Task 1: Add `SpectrumHistorySlab`

**Files:**
- Create: `src/lib/SpectrumHistorySlab.js`
- Create: `src/lib/SpectrumHistorySlab.test.js`

- [ ] **Step 1: Write failing storage tests**

Create `src/lib/SpectrumHistorySlab.test.js` with focused tests:

```js
import { describe, expect, it } from "vitest";
import { SpectrumHistorySlab } from "./SpectrumHistorySlab.js";

const bands = [{ fCenter: 100 }, { fCenter: 200 }, { fCenter: 400 }];

describe("SpectrumHistorySlab", () => {
  it("stores rows and returns them in chronological order", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({ bands, dbList: [-10, -20, -30], timestampMs: 1000 });
    slab.push({ bands, dbList: [-11, -21, -31], timestampMs: 1040 });

    expect(slab.length).toBe(2);
    expect(slab.capacity).toBe(4);
    expect(slab.at(0).timestampMs).toBe(1000);
    expect(Array.from(slab.at(0).dbList)).toEqual([-10, -20, -30]);
    expect(slab.at(1).timestampMs).toBe(1040);
    expect(Array.from(slab.toArray().map((row) => row.timestampMs))).toEqual([1000, 1040]);
  });

  it("overwrites the oldest rows after capacity is full", () => {
    const slab = new SpectrumHistorySlab(2, bands);

    slab.push({ bands, dbList: [1, 2, 3], timestampMs: 1 });
    slab.push({ bands, dbList: [4, 5, 6], timestampMs: 2 });
    slab.push({ bands, dbList: [7, 8, 9], timestampMs: 3 });

    expect(slab.length).toBe(2);
    expect(slab.toArray().map((row) => row.timestampMs)).toEqual([2, 3]);
    expect(Array.from(slab.at(1).dbList)).toEqual([7, 8, 9]);
  });

  it("allocates the secondary curve lazily", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({ bands, dbList: [-1, -2, -3], timestampMs: 1 });
    expect(slab.hasSecondary).toBe(false);
    expect(slab.at(0).dbListB.length).toBe(0);

    slab.push({
      bands,
      dbList: [-4, -5, -6],
      dbListB: [-7, -8, -9],
      timestampMs: 2,
    });

    expect(slab.hasSecondary).toBe(true);
    expect(Array.from(slab.at(1).dbListB)).toEqual([-7, -8, -9]);
  });

  it("fills missing primary values with -Infinity and truncates extras", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({ bands, dbList: [-1], timestampMs: 1 });
    slab.push({ bands, dbList: [-2, -3, -4, -5], timestampMs: 2 });

    expect(Array.from(slab.at(0).dbList)).toEqual([-1, -Infinity, -Infinity]);
    expect(Array.from(slab.at(1).dbList)).toEqual([-2, -3, -4]);
  });

  it("detects incompatible band grids", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    expect(slab.matchesBands(bands)).toBe(true);
    expect(slab.matchesBands([{ fCenter: 100 }, { fCenter: 300 }, { fCenter: 400 }])).toBe(false);
    expect(slab.matchesBands([{ fCenter: 100 }, { fCenter: 200 }])).toBe(false);
  });

  it("clear releases backing arrays and resets length", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({ bands, dbList: [-1, -2, -3], timestampMs: 1 });
    const before = slab.dbA;

    slab.clear();

    expect(slab.length).toBe(0);
    expect(slab.dbA).toBeNull();
    expect(slab.timestamps).toBeNull();
    expect(before).toBeInstanceOf(Float32Array);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```txt
npm test -- src/lib/SpectrumHistorySlab.test.js
```

Expected: FAIL because `SpectrumHistorySlab.js` does not exist yet.

- [ ] **Step 3: Implement the storage module**

Create `src/lib/SpectrumHistorySlab.js`.

Implementation requirements:

- constructor signature: `new SpectrumHistorySlab(capacity, bands)`;
- throw `RangeError` when `capacity <= 0`;
- store a shared `bands` reference;
- allocate `timestamps = new Float64Array(capacity)`;
- allocate `dbA = new Float32Array(capacity * bandCount)`;
- leave `dbB = null` until first non-empty secondary row;
- expose getters: `capacity`, `length`, `bandCount`, `hasSecondary`;
- expose `matchesBands(bands)` using `length:first:last` plus exact center checks for safety;
- expose `push({ bands, dbList, dbListB, timestampMs })`;
- expose `at(index)`, returning chronological rows;
- expose `toArray()`, returning chronological rows;
- expose `clear()`, nulling typed-array references and resetting counters.

Suggested row shape returned by `at()` / `toArray()`:

```js
{
  bands: this.bands,
  dbList: this.dbA.subarray(offset, offset + this.bandCount),
  dbListB: this.dbB ? this.dbB.subarray(offset, offset + this.bandCount) : EMPTY_F32,
  timestampMs: this.timestamps[slot],
}
```

Use `-Infinity` for missing primary cells. For missing secondary cells after
`dbB` exists, use `NaN` so consumers can distinguish "secondary absent" from a
real dB value.

- [ ] **Step 4: Run the storage tests**

Run:

```txt
npm test -- src/lib/SpectrumHistorySlab.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/SpectrumHistorySlab.js src/lib/SpectrumHistorySlab.test.js
git commit -m "feat(spectrum): add typed-array history slab"
```

---

## Task 2: Integrate slabs into request-keyed `FrameIntake` history

**Files:**
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`

- [ ] **Step 1: Add failing `FrameIntake` expectations for typed row views**

In `src/lib/FrameIntake.test.js`, update the request-keyed visual history test so it accepts typed array views but still verifies values:

Current assertion:

```js
expect(specRing.at(0).dbList).toEqual([-20, -30]);
```

Change to:

```js
expect(Array.from(specRing.at(0).dbList)).toEqual([-20, -30]);
expect(specRing.at(0).dbList).toBeInstanceOf(Float32Array);
```

Add a test near the existing request-keyed tests:

```js
it("recreates a request-keyed spectrum slab when the band grid changes", () => {
  const intake = new FrameIntake();
  const key = "spectrum:single:0:combined";
  const baseRow = {
    waveformMin: [0],
    waveformMax: [0],
    spectrumSmoothDb: [],
    vectorscopePairs: [],
    correlation: 0,
  };

  intake.pushVisualHistRow(
    {
      ...baseRow,
      timestampMs: 1000,
      spectrumByKey: {
        [key]: { bandCentersHz: [100, 200], smoothDb: [-10, -20] },
      },
    },
    10
  );

  intake.pushVisualHistRow(
    {
      ...baseRow,
      timestampMs: 1040,
      spectrumByKey: {
        [key]: { bandCentersHz: [100, 200, 400], smoothDb: [-30, -40, -50] },
      },
    },
    10
  );

  const history = intake.getVisualSpectrumHistByKey(key);
  expect(history.length).toBe(1);
  expect(history.at(0).timestampMs).toBe(1040);
  expect(Array.from(history.at(0).dbList)).toEqual([-30, -40, -50]);
});
```

Add a test that Clear releases cached live spectrogram arrays:

```js
it("clear releases request-keyed spectrum slabs and spectrogram arrays", () => {
  const intake = new FrameIntake();
  const key = "spectrum:single:0:combined";
  const row = {
    waveformMin: [0],
    waveformMax: [0],
    spectrumSmoothDb: [],
    vectorscopePairs: [],
    correlation: 0,
    spectrumByKey: { [key]: { bandCentersHz: [100], smoothDb: [-10] } },
  };

  intake.pushVisualHistRow(row, 10);
  expect(intake.getVisualSpectrumHistByKey(key)).not.toBeNull();
  expect(intake.getSpectrogramSnapArrayForKey(key).length).toBe(1);

  intake.reset();

  expect(intake.getVisualSpectrumHistByKey(key)).toBeNull();
  expect(intake.getSpectrogramSnapArrayForKey(key)).toEqual([]);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```txt
npm test -- src/lib/FrameIntake.test.js
```

Expected: FAIL on the typed-array expectations and grid-change reset until the implementation is wired.

- [ ] **Step 3: Import and wire `SpectrumHistorySlab`**

In `src/lib/FrameIntake.js`, import:

```js
import { SpectrumHistorySlab } from "./SpectrumHistorySlab.js";
```

Replace only request-keyed spectrum visual storage:

```txt
_visualSpectrumHistByKey: Map<string, SpectrumHistorySlab>
```

Do not change shared `_visualSpectrumHist` in this task.

Inside `pushVisualHistRow(row, visualMaxSamples)`, for `row.spectrumByKey`:

1. derive `bands` with existing `getBandsFromCenters(entry.bandCentersHz ?? this._lastSpectrumCenters)`;
2. find the existing slab by key;
3. create a new slab if missing;
4. recreate the slab if capacity changed or `!slab.matchesBands(bands)`;
5. push `{ bands, dbList: entry.smoothDb, dbListB: entry.smoothDbB, timestampMs: row.timestampMs }`;
6. update `_spectrogramSnapArrayByKey` for that key with the cached chronological array.

Suggested shape:

```js
let slab = this._visualSpectrumHistByKey.get(key);
const bands = getBandsFromCenters(entry.bandCentersHz ?? this._lastSpectrumCenters);
if (!slab || slab.capacity !== visualMaxSamples || !slab.matchesBands(bands)) {
  slab = new SpectrumHistorySlab(visualMaxSamples, bands);
  this._visualSpectrumHistByKey.set(key, slab);
}
slab.push({
  bands,
  dbList: entry.smoothDb,
  dbListB: entry.smoothDbB,
  timestampMs: row.timestampMs,
});
this._spectrogramSnapArrayByKey.set(key, slab.toArray());
```

Keep capacity-change handling at the top of `pushVisualHistRow()` as-is: dropping maps on capacity change is still correct.

- [ ] **Step 4: Keep public `FrameIntake` methods stable**

Ensure these existing methods still work:

- `getVisualSpectrumHistByKey(key)` returns slab or `null`;
- `getSpectrogramSnapArrayForKey(key)` returns an array or `EMPTY_ARRAY`;
- `snapshotVisualSpectrumByKey()` returns `{ [key]: slab.toArray() }`;
- `reset()` drops `_visualSpectrumHistByKey` and `_spectrogramSnapArrayByKey`.

Do not convert `snapshotVisualSpectrumByKey()` row typed arrays back to JS arrays. Snapshot/spectrogram consumers should treat them as array-like.

- [ ] **Step 5: Run focused tests**

Run:

```txt
npm test -- src/lib/SpectrumHistorySlab.test.js src/lib/FrameIntake.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/FrameIntake.js src/lib/FrameIntake.test.js
git commit -m "feat(spectrum): store request-keyed visual history in slabs"
```

---

## Task 3: Verify snapshot and Spectrogram compatibility

**Files:**
- Possibly modify: `src/hooks/useSnapshot.test.jsx`
- Possibly modify: `src/components/panels/SpectrogramPanel.test.jsx`
- Possibly modify: `src/hooks/useSpectrogramCanvas.js` only if a real array-only assumption appears.

- [ ] **Step 1: Run consumer tests without changing code**

Run:

```txt
npm test -- src/hooks/useSnapshot.test.jsx src/components/panels/SpectrogramPanel.test.jsx src/lib/snapshotResolve.test.js src/math/hoverMath.test.js
```

Expected: ideally PASS. If failures appear, inspect whether consumers assume `Array.isArray(dbList)` instead of using array-like indexing/length.

- [ ] **Step 2: Prefer test fixture updates over production churn**

If a test fixture compares typed views with `toEqual([...])`, change the assertion to:

```js
expect(Array.from(row.dbList)).toEqual([...]);
```

Only change production code if a real runtime path requires plain arrays.

- [ ] **Step 3: If production code requires plain arrays, adapt at the narrowest boundary**

Allowed narrow fixes:

- convert only for a specific consumer that truly needs `Array`;
- update the consumer to use `.length` and numeric indexing;
- avoid converting in `FrameIntake`, because that would reintroduce storage-layer allocations.

Do not replace slab row views with JS arrays globally.

- [ ] **Step 4: Run consumer tests again**

Run:

```txt
npm test -- src/hooks/useSnapshot.test.jsx src/components/panels/SpectrogramPanel.test.jsx src/lib/snapshotResolve.test.js src/math/hoverMath.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit if any consumer/test changes were needed**

If files changed:

```bash
git add src/hooks/useSnapshot.test.jsx src/components/panels/SpectrogramPanel.test.jsx src/hooks/useSpectrogramCanvas.js src/lib/snapshotResolve.test.js src/math/hoverMath.test.js
git commit -m "test(spectrum): accept typed-array spectrum history rows"
```

Skip this commit if Task 3 produced no changes.

---

## Task 4: Add memory-oriented regression coverage

**Files:**
- Modify: `src/lib/SpectrumHistorySlab.test.js`
- Modify: `src/lib/FrameIntake.test.js`

- [ ] **Step 1: Add a no-per-row-array regression test for the slab**

In `src/lib/SpectrumHistorySlab.test.js`, add:

```js
it("returns row views backed by one contiguous Float32Array", () => {
  const slab = new SpectrumHistorySlab(4, bands);

  slab.push({ bands, dbList: [-10, -20, -30], timestampMs: 1 });
  slab.push({ bands, dbList: [-11, -21, -31], timestampMs: 2 });

  const first = slab.at(0).dbList;
  const second = slab.at(1).dbList;

  expect(first).toBeInstanceOf(Float32Array);
  expect(second).toBeInstanceOf(Float32Array);
  expect(first.buffer).toBe(slab.dbA.buffer);
  expect(second.buffer).toBe(slab.dbA.buffer);
  expect(first.byteOffset).not.toBe(second.byteOffset);
});
```

- [ ] **Step 2: Add a FrameIntake secondary-curve test**

In `src/lib/FrameIntake.test.js`, add near the request-keyed tests:

```js
it("stores request-keyed secondary spectrum curves in typed row views", () => {
  const intake = new FrameIntake();
  const key = "spectrum:pair:0:1:lr";
  const row = {
    waveformMin: [0],
    waveformMax: [0],
    spectrumSmoothDb: [],
    vectorscopePairs: [],
    correlation: 0,
    spectrumByKey: {
      [key]: {
        bandCentersHz: [100, 200],
        smoothDb: [-10, -20],
        smoothDbB: [-30, -40],
      },
    },
  };

  intake.pushVisualHistRow(row, 10);
  const snap = intake.getVisualSpectrumHistByKey(key).at(0);

  expect(snap.dbList).toBeInstanceOf(Float32Array);
  expect(snap.dbListB).toBeInstanceOf(Float32Array);
  expect(Array.from(snap.dbListB)).toEqual([-30, -40]);
});
```

- [ ] **Step 3: Run focused regression tests**

Run:

```txt
npm test -- src/lib/SpectrumHistorySlab.test.js src/lib/FrameIntake.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/SpectrumHistorySlab.test.js src/lib/FrameIntake.test.js
git commit -m "test(spectrum): cover slab-backed spectrum history rows"
```

---

## Task 5: Full verification and desktop memory comparison

- [ ] **Step 1: Run targeted suites**

Run:

```txt
npm test -- src/lib/SpectrumHistorySlab.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/components/panels/SpectrogramPanel.test.jsx src/lib/snapshotResolve.test.js src/math/hoverMath.test.js
```

Expected: PASS.

- [ ] **Step 2: Run the project check**

Run:

```txt
npm run check
```

Expected: PASS.

- [ ] **Step 3: Inspect diff**

Run:

```txt
git diff --check
git diff --stat
```

Expected: no whitespace errors; diff scoped to slab storage, `FrameIntake`, and related tests.

- [ ] **Step 4: Desktop memory comparison**

Run the desktop app and repeat the motivating stress layout:

```txt
3 Level Meter
2 Spectrum
1 Spectrogram
1 Waveform
1 Loudness
1 Vectorscope
1 Stats
30 minutes capture
```

Record:

- WebView2 process peak working set;
- WebView2 process memory after Clear;
- whether memory growth appears roughly linear before the cap;
- whether Spectrum/Spectrogram UI, hover, and snapshot scrubbing behave normally.

Expected: peak memory is materially lower than the previous near-6GB half-hour observation. Passing tests alone is not enough to call the memory work done.

- [ ] **Step 5: Commit verification notes if useful**

If the repo keeps implementation notes for this work, add a short note under the relevant plan or PR description. Do not add noisy benchmark logs unless the user asks.

---

## Notes for the Implementer

- `Float32Array` is the v1 decision. Do not start with `Float64Array` unless a precise reproduction problem appears.
- Inactive request-key slabs stay retained until Clear in v1. Do not add eviction in this slice.
- Keep `VISUAL_MAX_SAMPLES = 180_000` unchanged.
- Keep request caps unchanged.
- Keep Stop/Clear product semantics unchanged; only ensure Clear releases slab references.
- Treat typed-row `dbList` / `dbListB` as read-only.
- Do not convert typed rows back to JS arrays in `FrameIntake`; that would erase much of the memory win.
- Keep the old shared `_visualSpectrumHist` untouched unless tests prove it is unused and trivial to remove. Removal is a later cleanup, not part of the main memory-risk reduction.
