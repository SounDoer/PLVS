# Spectrogram History Read Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop materialising the whole per-key spectrum history on every 25 Hz tick (and on snapshot entry), so capture cost no longer grows with elapsed time.

**Architecture:** Introduce one read-only history interface — `length` / `timestampAt(i)` / `rowAt(i)` / `version` — implemented by the live ring (`SpectrumHistorySlab`) and by a bulk-copied snapshot (`FrozenSpectrumHistory`). All spectrogram readers (canvas paint, hover, in-window range, gap boundaries, snapshot resolution) read through this interface by index instead of consuming a freshly-built plain-object array. Spec: `docs/superpowers/specs/2026-06-22-spectrogram-history-read-perf-design.md`.

**Tech Stack:** React 19 + Vite frontend; Vitest; plain ESM modules. No Rust changes.

**Behaviour contract:** Observable behaviour (live rendering, hover, snapshot scrubbing, gap markers) is unchanged — only cost changes. Each task updates its own tests so `npm run test` stays green per commit; full app runtime correctness is verified in the final task.

---

## The read-only history interface (duck-typed)

All readers depend only on:

- `length` — number of chronological frames.
- `timestampAt(i)` — `timestampMs` of frame `i`, or `NaN` when out of range. No allocation.
- `rowAt(i)` — `{ bands, dbList, dbListB, timestampMs }` for frame `i`, or `undefined` when out of range. `dbList` / `dbListB` are read-only `Float32Array` views.
- `version` — monotonically increasing while new rows are pushed (live); constant for a frozen snapshot. Used as a cheap React memo-invalidation signal.

Two implementations live in `src/lib/SpectrumHistorySlab.js`: `SpectrumHistorySlab` (live) and `FrozenSpectrumHistory` (snapshot), plus an `EMPTY_SPECTRUM_VIEW` constant for the no-data case.

### Shared test helper

Pure-math tests wrap plain rows into the interface. Add this inline near the top of each test file that needs it (`spectrogramTimeline.test.js`, `hoverMath.test.js`, `snapshotResolve.test.js`):

```js
function viewOf(rows) {
  return {
    get length() {
      return rows.length;
    },
    version: 0,
    timestampAt: (i) => (i >= 0 && i < rows.length ? rows[i].timestampMs : NaN),
    rowAt: (i) => (i >= 0 && i < rows.length ? rows[i] : undefined),
  };
}
```

---

## Task 1: Slab read accessors (`version`, `timestampAt`, `rowAt`)

**Files:**
- Modify: `src/lib/SpectrumHistorySlab.js`
- Test: `src/lib/SpectrumHistorySlab.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/SpectrumHistorySlab.test.js`:

```js
it("exposes version, timestampAt, and rowAt over wrap-around", () => {
  const bands = [{ fCenter: 100 }, { fCenter: 200 }];
  const slab = new SpectrumHistorySlab(2, bands);
  const v0 = slab.version;
  slab.push({ bands, dbList: [-10, -20], timestampMs: 1000 });
  slab.push({ bands, dbList: [-30, -40], timestampMs: 1040 });
  slab.push({ bands, dbList: [-50, -60], timestampMs: 1080 }); // overwrites slot 0

  expect(slab.length).toBe(2);
  expect(slab.version).toBeGreaterThan(v0);
  expect(slab.timestampAt(0)).toBe(1040);
  expect(slab.timestampAt(1)).toBe(1080);
  expect(slab.timestampAt(2)).toBeNaN();
  expect(Array.from(slab.rowAt(0).dbList)).toEqual([-30, -40]);
  expect(slab.rowAt(1).timestampMs).toBe(1080);
  expect(slab.rowAt(5)).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/SpectrumHistorySlab.test.js`
Expected: FAIL (`slab.version` / `slab.timestampAt` is not a function).

- [ ] **Step 3: Implement the accessors**

In `src/lib/SpectrumHistorySlab.js`, add `this._version = 0;` to the constructor (after `this._size = 0;`):

```js
    this._head = 0;
    this._size = 0;
    this._version = 0;
```

Increment it at the end of `push(...)`, immediately before the method's closing brace:

```js
    if (this._size < this._cap) {
      this._size += 1;
    } else {
      this._head = (this._head + 1) % this._cap;
    }
    this._version += 1;
  }
```

Add these getters/methods to the class (e.g. after the existing `timestamps` getter):

```js
  get version() {
    return this._version;
  }

  timestampAt(index) {
    if (index < 0 || index >= this._size || !this._timestamps) return NaN;
    const slot = (this._head + index) % this._cap;
    return this._timestamps[slot];
  }

  rowAt(index) {
    return this.at(index);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/SpectrumHistorySlab.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/SpectrumHistorySlab.js src/lib/SpectrumHistorySlab.test.js
git commit -m "feat(spectrum): add slab version + index read accessors"
```

---

## Task 2: `freeze()`, `FrozenSpectrumHistory`, `EMPTY_SPECTRUM_VIEW`

**Files:**
- Modify: `src/lib/SpectrumHistorySlab.js`
- Test: `src/lib/SpectrumHistorySlab.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/SpectrumHistorySlab.test.js` (import `FrozenSpectrumHistory` and `EMPTY_SPECTRUM_VIEW` at the top alongside `SpectrumHistorySlab`):

```js
it("freeze() copies the ring and is immune to later pushes", () => {
  const bands = [{ fCenter: 100 }, { fCenter: 200 }];
  const slab = new SpectrumHistorySlab(2, bands);
  slab.push({ bands, dbList: [-10, -20], dbListB: [-1, -2], timestampMs: 1000 });
  slab.push({ bands, dbList: [-30, -40], dbListB: [-3, -4], timestampMs: 1040 });

  const frozen = slab.freeze();
  slab.push({ bands, dbList: [-50, -60], timestampMs: 1080 }); // overwrites slot 0 in the live ring

  expect(frozen).toBeInstanceOf(FrozenSpectrumHistory);
  expect(frozen.length).toBe(2);
  expect(frozen.timestampAt(0)).toBe(1000);
  expect(Array.from(frozen.rowAt(0).dbList)).toEqual([-10, -20]);
  expect(Array.from(frozen.rowAt(0).dbListB)).toEqual([-1, -2]);
  expect(Array.from(frozen.rowAt(1).dbList)).toEqual([-30, -40]);
  // Live ring moved on; frozen snapshot did not.
  expect(Array.from(slab.rowAt(1).dbList)).toEqual([-50, -60]);
});

it("EMPTY_SPECTRUM_VIEW is an empty read-only view", () => {
  expect(EMPTY_SPECTRUM_VIEW.length).toBe(0);
  expect(EMPTY_SPECTRUM_VIEW.timestampAt(0)).toBeNaN();
  expect(EMPTY_SPECTRUM_VIEW.rowAt(0)).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/SpectrumHistorySlab.test.js`
Expected: FAIL (`slab.freeze` / `FrozenSpectrumHistory` not defined).

- [ ] **Step 3: Implement freeze + frozen view + empty view**

In `src/lib/SpectrumHistorySlab.js`, add a `freeze()` method to `SpectrumHistorySlab` (e.g. after `rowAt`):

```js
  freeze() {
    const n = this._size;
    const bc = this._bandCount;
    const timestamps = new Float64Array(n);
    const dbA = new Float32Array(n * bc);
    let dbB = null;
    let hasB = null;
    if (this._dbB) {
      dbB = new Float32Array(n * bc);
      hasB = new Uint8Array(n);
    }
    for (let i = 0; i < n; i += 1) {
      const slot = (this._head + i) % this._cap;
      timestamps[i] = this._timestamps[slot];
      dbA.set(this._dbA.subarray(slot * bc, slot * bc + bc), i * bc);
      if (dbB) {
        dbB.set(this._dbB.subarray(slot * bc, slot * bc + bc), i * bc);
        hasB[i] = this._hasB[slot];
      }
    }
    return new FrozenSpectrumHistory({ bands: this._bands, bandCount: bc, size: n, timestamps, dbA, dbB, hasB });
  }
```

Add the `FrozenSpectrumHistory` class and `EMPTY_SPECTRUM_VIEW` constant at the end of the file (after the `SpectrumHistorySlab` class). `EMPTY_F32` is already defined at the top of the file — reuse it:

```js
export class FrozenSpectrumHistory {
  constructor({ bands, bandCount, size, timestamps, dbA, dbB, hasB }) {
    this._bands = bands ?? [];
    this._bandCount = bandCount;
    this._size = size;
    this._timestamps = timestamps;
    this._dbA = dbA;
    this._dbB = dbB ?? null;
    this._hasB = hasB ?? null;
  }

  get length() {
    return this._size;
  }

  get version() {
    return 0;
  }

  timestampAt(index) {
    if (index < 0 || index >= this._size) return NaN;
    return this._timestamps[index];
  }

  rowAt(index) {
    if (index < 0 || index >= this._size) return undefined;
    const offset = index * this._bandCount;
    const dbList = this._dbA.subarray(offset, offset + this._bandCount);
    const dbListB =
      this._dbB && this._hasB?.[index]
        ? this._dbB.subarray(offset, offset + this._bandCount)
        : EMPTY_F32;
    return { bands: this._bands, dbList, dbListB, timestampMs: this._timestamps[index] };
  }
}

export const EMPTY_SPECTRUM_VIEW = {
  length: 0,
  version: 0,
  timestampAt() {
    return NaN;
  },
  rowAt() {
    return undefined;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/SpectrumHistorySlab.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/SpectrumHistorySlab.js src/lib/SpectrumHistorySlab.test.js
git commit -m "feat(spectrum): bulk-copy freeze() + FrozenSpectrumHistory view"
```

---

## Task 3: `spectrogramTimeline` reads via the view interface

**Files:**
- Modify: `src/math/spectrogramTimeline.js`
- Test: `src/math/spectrogramTimeline.test.js`

`inWindowRange` and `spectrogramDataBoundaries` currently index `frames[i].timestampMs`. Switch them to `view.length` / `view.timestampAt(i)`. `spectrogramTimeWindow` is unchanged (it reads the loudness history array, not spectrum frames).

- [ ] **Step 1: Update the tests to pass views**

In `src/math/spectrogramTimeline.test.js`, add the `viewOf` helper (from the interface section) near the top. Change the `frames()` helper to return a view:

```js
function frames(startMs, endMs, step = SAMPLE_MS) {
  const rows = [];
  for (let ts = startMs; ts <= endMs; ts += step) rows.push({ timestampMs: ts });
  return viewOf(rows);
}
```

In the `inWindowRange` describe block, replace the two raw-array cases so empty input is a view:

```js
  it("returns an empty range when no frame is inside", () => {
    expect(inWindowRange(f, 300, 400)).toEqual({ startIdx: 0, endIdx: -1 });
    expect(inWindowRange(viewOf([]), 100, 200)).toEqual({ startIdx: 0, endIdx: -1 });
  });
```

In the `spectrogramDataBoundaries` empty case, wrap the empty array:

```js
    expect(spectrogramDataBoundaries(viewOf([]), 1000, 2000, SAMPLE_MS)).toEqual([]);
```

(The `spectrogramTimeWindow` describe block keeps using plain arrays — it is unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/spectrogramTimeline.test.js`
Expected: FAIL (functions still index `frames[mid]`, so `view.timestampAt` is unused and `frames[mid]` is `undefined`).

- [ ] **Step 3: Rewrite the readers against the view**

In `src/math/spectrogramTimeline.js`, replace `lowerBound`, `upperBound`, `inWindowRange`, and `spectrogramDataBoundaries` so they read `view.length` and `view.timestampAt(i)`:

```js
/** First index whose timestampAt >= target (lower bound). view is ascending by timestamp. */
function lowerBound(view, target) {
  let lo = 0;
  let hi = view.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (view.timestampAt(mid) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose timestampAt > target (upper bound). view is ascending by timestamp. */
function upperBound(view, target) {
  let lo = 0;
  let hi = view.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (view.timestampAt(mid) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
```

```js
export function inWindowRange(view, oldestMs, newestMs) {
  if (!view || view.length === 0) return { startIdx: 0, endIdx: -1 };
  const startIdx = lowerBound(view, oldestMs);
  const endIdx = upperBound(view, newestMs) - 1;
  if (startIdx > endIdx) return { startIdx: 0, endIdx: -1 };
  return { startIdx, endIdx };
}
```

```js
export function spectrogramDataBoundaries(view, oldestMs, newestMs, sampleMs, gapFactor = 1.8) {
  if (!view || view.length === 0 || !(newestMs > oldestMs)) return [];
  const gapThresh = gapFactor * sampleMs;
  const eps = sampleMs * 0.5;
  const startScan = Math.max(0, lowerBound(view, oldestMs - 2 * sampleMs));
  const endScan = Math.min(view.length - 1, upperBound(view, newestMs + 2 * sampleMs) - 1);
  const marks = [];
  for (let i = startScan; i <= endScan; i += 1) {
    const ts = view.timestampAt(i);
    if (!Number.isFinite(ts)) continue;
    const gapBefore = i === 0 || ts - view.timestampAt(i - 1) > gapThresh;
    if (gapBefore && ts > oldestMs + eps && ts < newestMs - eps) marks.push(ts);
    const gapAfter = i === view.length - 1 || view.timestampAt(i + 1) - ts > gapThresh;
    const endEdge = ts + sampleMs;
    if (gapAfter && endEdge > oldestMs + eps && endEdge < newestMs - eps) marks.push(endEdge);
  }
  return marks;
}
```

Update the JSDoc `@param` lines for both functions to read `@param {{ length, timestampAt }} view`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/spectrogramTimeline.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogramTimeline.js src/math/spectrogramTimeline.test.js
git commit -m "refactor(spectrogram): read timeline range/boundaries via view interface"
```

---

## Task 4: `computeSpectrogramHoverPoint` reads via the view interface

**Files:**
- Modify: `src/math/hoverMath.js`
- Test: `src/math/hoverMath.test.js`

- [ ] **Step 1: Update the tests to pass views**

In `src/math/hoverMath.test.js`, add the `viewOf` helper near the top. In the `computeSpectrogramHoverPoint` describe block, wrap every `snaps`/sparse/single/empty argument passed to `computeSpectrogramHoverPoint` in `viewOf(...)`:

- `const snaps = makeSnaps();` → `const snaps = viewOf(makeSnaps());`
- `makeSnaps({ bands: [] })` → `viewOf(makeSnaps({ bands: [] }))`
- `makeSnaps({ dbList: [] })` → `viewOf(makeSnaps({ dbList: [] }))`
- `computeSpectrogramHoverPoint(0.5, 0.5, [], OLD, NEW, SMS)` → `... viewOf([]) ...`
- `const sparse = [ ... ];` → `const sparse = viewOf([ ... ]);`
- `const single = [ ... ];` → `const single = viewOf([ ... ]);`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/hoverMath.test.js`
Expected: FAIL (function still does `snaps[i]`, now `undefined` on a view).

- [ ] **Step 3: Rewrite the hover reader against the view**

In `src/math/hoverMath.js`, change `computeSpectrogramHoverPoint` to read via the interface. Replace the body from the guard through the `snap` lookup:

```js
export function computeSpectrogramHoverPoint(xFrac, yFrac, snaps, oldestMs, newestMs, sampleMs) {
  if (!snaps || !snaps.length || !(newestMs > oldestMs)) return null;

  const ts = oldestMs + xFrac * (newestMs - oldestMs);
  const { startIdx, endIdx } = inWindowRange(snaps, oldestMs, newestMs);
  if (endIdx < startIdx) return null;
  let hoverIndex = -1;
  let bestDist = Infinity;
  for (let i = startIdx; i <= endIdx; i += 1) {
    const dist = Math.abs(snaps.timestampAt(i) - ts);
    if (dist < bestDist) {
      bestDist = dist;
      hoverIndex = i;
    }
  }
  if (hoverIndex < 0 || bestDist > sampleMs) return null; // hovering a gap
  const snap = snaps.rowAt(hoverIndex);
  if (!snap) return null;
  const newestTs = snaps.timestampAt(snaps.length - 1);
  const offsetSec = Math.max(0, (newestTs - snap.timestampMs) / 1000);
```

The rest of the function (band binary search, label formatting, return object) is unchanged. Update the `@param` JSDoc for `snaps` to `{{ length, timestampAt, rowAt }} snaps`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/hoverMath.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/math/hoverMath.js src/math/hoverMath.test.js
git commit -m "refactor(spectrogram): read hover frames via view interface"
```

---

## Task 5: snapshot keyed resolution reads via the view interface

**Files:**
- Modify: `src/lib/snapshotResolve.js`
- Test: `src/lib/snapshotResolve.test.js`

`nearestTimestampIndex` and `resolveKeyedVisualIndex` operate on per-key visual `entries`. The keyed (spectrum) entries become a frozen view; the loudness `histSourceList` stays a plain array. Make `nearestTimestampIndex` work for both array and view by reading through small accessors, so `resolveSnapshot` (loudness array) is unaffected while keyed resolution accepts a view.

- [ ] **Step 1: Update the tests**

In `src/lib/snapshotResolve.test.js`, add the `viewOf` helper near the top. For every `resolveKeyedVisualIndex(entries, ...)` call where `entries` is a plain array of `{ timestampMs }`, wrap it: `resolveKeyedVisualIndex(viewOf(entries), ...)`. Leave `resolveSnapshot` / `nearestTimestampIndex` tests that pass loudness-style arrays unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/snapshotResolve.test.js`
Expected: FAIL (view has no `entries.length`-indexed `[i]` access in `nearestTimestampIndex`).

- [ ] **Step 3: Make the readers accept array-or-view**

In `src/lib/snapshotResolve.js`, add accessors at the top and use them in the timestamp helpers:

```js
function lengthOf(entries) {
  return entries ? entries.length : 0;
}

function timestampAt(entries, i) {
  if (!entries) return undefined;
  if (typeof entries.timestampAt === "function") return entries.timestampAt(i);
  return entries[i]?.timestampMs;
}
```

Rewrite `hasTimestampEntries`, `nearestTimestampIndex`, and `resolveKeyedVisualIndex` to use them:

```js
function hasTimestampEntries(entries) {
  return lengthOf(entries) > 0 && Number.isFinite(timestampAt(entries, 0));
}

export function nearestTimestampIndex(entries, targetMs) {
  if (!hasTimestampEntries(entries) || !Number.isFinite(targetMs)) return -1;
  let bestIdx = 0;
  let bestDistance = Math.abs(timestampAt(entries, 0) - targetMs);
  for (let i = 1; i < lengthOf(entries); i += 1) {
    const distance = Math.abs(timestampAt(entries, i) - targetMs);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIdx = i;
    }
  }
  return bestIdx;
}
```

```js
export function resolveKeyedVisualIndex(entries, targetTimestampMs, toleranceMs = 0) {
  if (!hasTimestampEntries(entries)) return { index: -1, missing: true };
  if (!Number.isFinite(targetTimestampMs)) return { index: lengthOf(entries) - 1, missing: false };
  const index = nearestTimestampIndex(entries, targetTimestampMs);
  if (index < 0 || Math.abs(timestampAt(entries, index) - targetTimestampMs) > toleranceMs) {
    return { index: -1, missing: true };
  }
  return { index, missing: false };
}
```

`resolveSnapshot` keeps calling `nearestTimestampIndex(histSourceList, ...)` with the loudness array — the array branch of the accessors handles it unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/snapshotResolve.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/snapshotResolve.js src/lib/snapshotResolve.test.js
git commit -m "refactor(snapshot): keyed visual resolution accepts array or view"
```

---

## Task 6: Spectrogram canvas paints via the view interface

**Files:**
- Modify: `src/hooks/useSpectrogramCanvas.js`

No unit test exists for this rAF/canvas hook; correctness is covered by the final-task benchmark and manual run. Keep the change mechanical.

- [ ] **Step 1: Read frames through the view in `paintImageData`**

In `src/hooks/useSpectrogramCanvas.js`, in `paintImageData`, change the per-column read:

```js
  for (let i = startIdx; i <= endIdx; i++) {
    const snap = snaps.rowAt(i);
    if (!snap || !snap.dbList) continue;
```

- [ ] **Step 2: Read `bands` through the view in `draw`**

Replace the `firstSnap` / `bands` lines:

```js
      const firstSnap = snaps && snaps.length > 0 ? snaps.rowAt(snaps.length - 1) : null;
      const bands = firstSnap?.bands;
```

`len = snaps ? snaps.length : 0`, the `inWindowRange(snaps, ...)` call, and the skip-repaint check are unchanged (they already use `.length` and `inWindowRange`).

- [ ] **Step 3: Verify the build compiles**

Run: `npx vitest run src/math/spectrogramTimeline.test.js` (sanity — paint depends on `inWindowRange`).
Expected: PASS. (App-level paint is verified in Task 9.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSpectrogramCanvas.js
git commit -m "refactor(spectrogram): paint canvas via view interface"
```

---

## Task 7: FrameIntake stops materialising; returns views

**Files:**
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/App.jsx` (rename the wrapped intake method call)
- Test: `src/lib/FrameIntake.test.js`

- [ ] **Step 1: Update the FrameIntake tests**

In `src/lib/FrameIntake.test.js`:

1. The "clear releases …" test (currently asserts `getSpectrogramSnapArrayForKey`):

```js
    intake.pushVisualHistRow(row, 10);
    expect(intake.getVisualSpectrumHistByKey(key)).not.toBeNull();
    expect(intake.getSpectrogramSnapsForKey(key).length).toBe(1);

    intake.reset();

    expect(intake.getVisualSpectrumHistByKey(key)).toBeNull();
    expect(intake.getSpectrogramSnapsForKey(key).length).toBe(0);
```

2. The "freezes request-keyed spectrum snapshot rows …" test — read the frozen view via `rowAt`:

```js
    expect(Array.from(frozen.rowAt(0).dbList)).toEqual([-10, -20]);
    expect(Array.from(intake.getVisualSpectrumHistByKey(key).at(1).dbList)).toEqual([-50, -60]);
```

3. The "per-key spectrogram bands …" test — read via the view:

```js
    const snap = intake.getSpectrogramSnapsForKey(key);
    expect(snap.rowAt(0).bands.length).toBe(centers.length);
    expect(snap.rowAt(0).bands[0].fCenter).toBeCloseTo(centers[0]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: FAIL (`getSpectrogramSnapsForKey` not defined; `frozen.rowAt` not a function).

- [ ] **Step 3: Drop the per-tick rebuild and return views**

In `src/lib/FrameIntake.js`:

Import the empty view:

```js
import { RingBuffer } from "./RingBuffer.js";
import { SpectrumHistorySlab, EMPTY_SPECTRUM_VIEW } from "./SpectrumHistorySlab.js";
```

Remove the `_spectrogramSnapArrayByKey` field and its comment from the constructor:

```js
    this._visualSpectrumHistByKey = new Map();
    this._visualVectorscopeHistByKey = new Map();
```

Remove the cache reset in the capacity-change block of `pushVisualHistRow`:

```js
      this._visualSpectrumHistByKey = new Map();
      this._visualVectorscopeHistByKey = new Map();
```

(delete the `this._spectrogramSnapArrayByKey = new Map();` line there).

Remove the per-tick rebuild line inside the spectrum loop:

```js
        slab.push({
          bands,
          dbList: entry.smoothDb,
          dbListB: entry.smoothDbB,
          timestampMs: row.timestampMs,
        });
```

(delete the following `this._spectrogramSnapArrayByKey.set(key, slab.toArray());` line).

Rename the getter and return the live slab (or empty view):

```js
  getSpectrogramSnapsForKey(key) {
    return this._visualSpectrumHistByKey.get(key) ?? EMPTY_SPECTRUM_VIEW;
  }
```

Change `snapshotVisualSpectrumByKey` to return frozen views:

```js
  /** Freeze per-key spectrum history into read-only views for snapshot scrubbing. */
  snapshotVisualSpectrumByKey() {
    const out = {};
    for (const [key, slab] of this._visualSpectrumHistByKey) out[key] = slab.freeze();
    return out;
  }
```

Remove `this._spectrogramSnapArrayByKey = new Map();` from `reset()`.

- [ ] **Step 4: Update the App wiring**

In `src/App.jsx`, the callback at line ~331 calls the renamed method:

```js
  const getSpectrogramSnapsForKey = useCallback(
    (key) => intakeRef.current.getSpectrogramSnapsForKey(key),
    []
  );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/FrameIntake.js src/lib/FrameIntake.test.js src/App.jsx
git commit -m "perf(spectrogram): drop per-tick toArray; return slab/frozen views"
```

---

## Task 8: useSnapshot + SpectrogramPanel consume views

**Files:**
- Modify: `src/components/panels/SpectrogramPanel.jsx`
- Test: `src/components/panels/SpectrogramPanel.test.jsx`
- Test: `src/hooks/useSnapshot.test.jsx` (only if it asserts the old array shape of `snapshotSpectrumByKey` / spectrum resolution; update to the view interface)

`useSnapshot.resolveSpectrumSnapshotForKey` already reads `entries[index]` after `resolveKeyedVisualIndex`. With frozen views, read by `rowAt`.

- [ ] **Step 1: Update `useSnapshot` spectrum resolution**

In `src/hooks/useSnapshot.js`, in `resolveSpectrumSnapshotForKey`, replace the `entries[index]` read:

```js
    const { index, missing } = resolveKeyedVisualIndex(
      entries,
      resolved.targetTimestampMs,
      keyToleranceMs
    );
    if (missing) return { missing: true, path: "", pathB: "", data: null };
    const snap = entries.rowAt(index);
```

`entries` here is `snapSource.spectrumByKey[key]` — a `FrozenSpectrumHistory`. `resolveKeyedVisualIndex` already accepts the view (Task 5). The remaining lines (`snap.bands`, `snap.dbList`, `snap.dbListB`) are unchanged.

- [ ] **Step 2: Update SpectrogramPanel to view-typed snaps**

In `src/components/panels/SpectrogramPanel.jsx`:

Import the empty view:

```js
import { EMPTY_SPECTRUM_VIEW } from "../../lib/SpectrumHistorySlab.js";
```

`snapRef` getter falls back to the empty view:

```js
  const snapRef = useMemo(
    () => ({
      get current() {
        return getSpectrogramSnapsForKey?.(spectrogramKey) ?? EMPTY_SPECTRUM_VIEW;
      },
    }),
    [getSpectrogramSnapsForKey, spectrogramKey]
  );
```

`spectrogramSnaps` falls back to the empty view on both branches:

```js
  const spectrogramSnaps =
    selectedOffset >= 0
      ? (snapshotSpectrumByKey?.[spectrogramKey] ?? EMPTY_SPECTRUM_VIEW)
      : (snapRef.current ?? EMPTY_SPECTRUM_VIEW);
```

Add the view `version` to the `dataBoundaries` memo deps so live capture still recomputes gap markers as new rows arrive (the live slab reference is now stable, so reference identity alone no longer changes per tick):

```js
  const dataBoundaries = useMemo(
    () => spectrogramDataBoundaries(spectrogramSnaps, oldestMs, newestMs, sampleMs),
    [spectrogramSnaps, spectrogramSnaps.version, oldestMs, newestMs, sampleMs]
  );
```

- [ ] **Step 3: Update SpectrogramPanel / useSnapshot tests**

Run the two suites first to see what breaks:

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx src/hooks/useSnapshot.test.jsx`

For any test that supplies `getSpectrogramSnapsForKey` / `snapshotSpectrumByKey` as plain arrays of rows, replace those fixtures with views. Use a real slab or the `viewOf` helper:

```js
function viewOf(rows) {
  return {
    get length() {
      return rows.length;
    },
    version: 0,
    timestampAt: (i) => (i >= 0 && i < rows.length ? rows[i].timestampMs : NaN),
    rowAt: (i) => (i >= 0 && i < rows.length ? rows[i] : undefined),
  };
}
```

- a context `getSpectrogramSnapsForKey: () => [rows]` becomes `() => viewOf([rows])`;
- a `snapshotSpectrumByKey: { [key]: [rows] }` becomes `{ [key]: viewOf([rows]) }`;
- assertions that indexed `snaps[0]` become `snaps.rowAt(0)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx src/hooks/useSnapshot.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/SpectrogramPanel.jsx src/components/panels/SpectrogramPanel.test.jsx src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx
git commit -m "refactor(spectrogram): panel + snapshot consume history views"
```

---

## Task 9: Verify the fix and the full suite

**Files:**
- Use: `bench-spectrogram-snap.mjs` (existing throwaway, repo root)

- [ ] **Step 1: Re-run the benchmark and confirm the regression is gone**

Run: `node bench-spectrogram-snap.mjs`
Expected: per-tick `pushVisualHistRow` is flat across fills (e.g. < 0.1 ms/tick at 180k, no longer ~21 ms/tick); `snapshotVisualSpectrumByKey` at 120 min is single-digit ms (was ~175 ms).

If `pushVisualHistRow` is still flat-but-the-canvas-is-needed, note that the benchmark only exercises intake; the paint path is verified manually below.

- [ ] **Step 2: Full check**

Run: `npm run check`
Expected: PASS (format + lint + test + build + version + Rust fmt/clippy/test).

- [ ] **Step 3: Manual smoke (app)**

Run the desktop app (`npm run tauri dev`), start capture with a Spectrogram panel, let it run, scrub into snapshot and back, hover the spectrogram, and switch the panel's channel/view to create a data gap. Confirm: heatmap renders and advances, hover labels are correct, gap boundary markers appear, snapshot scrubbing shows the right column. No visual change vs. before.

- [ ] **Step 4: Remove the throwaway benchmark**

```bash
git rm bench-spectrogram-snap.mjs
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(spectrogram): remove throwaway perf benchmark after verification"
```

---

## Self-review notes

- **Spec coverage:** symptom A (per-tick rebuild) → Tasks 6–8 read by index + Task 7 removes the rebuild; symptom B (snapshot deep-copy) → Task 2 `freeze()` + Task 7 wiring; shared read interface → Tasks 1–2; consumers → Tasks 3–8; testing/verification → Task 9. Vectorscope explicitly untouched.
- **Memo invalidation risk (called out in the spec):** handled in Task 8 Step 2 by adding `spectrogramSnaps.version` to the `dataBoundaries` deps; the live slab `version` increments per push (Task 1).
- **Naming consistency:** `getSpectrogramSnapsForKey` (intake method, Task 7) matches the App callback name (Task 7 Step 4) and the context key already consumed by SpectrogramPanel. Interface methods `length` / `timestampAt` / `rowAt` / `version` are identical across `SpectrumHistorySlab`, `FrozenSpectrumHistory`, `EMPTY_SPECTRUM_VIEW`, and `viewOf`.
- **Green per commit:** each task updates its own tests; cross-module app runtime is fully verified in Task 9.
