# Spectrogram Scroll Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the spectrogram flickering while scrolling (worst when tightly packed) by painting per output pixel column from an absolute-anchored snapshot range with per-band max aggregation, instead of snapshot-driven window-relative blocks that drop columns.

**Architecture:** A new pure helper `spectrogramColumnRanges` maps each pixel column to a scroll-invariant absolute snapshot index range. `paintImageData` becomes column-driven: per column it takes the per-band max over the snapshots in its range (nothing dropped), carrying forward empty columns.

**Tech Stack:** JavaScript (Vitest), HTML canvas ImageData.

**Spec:** `docs/working/superpowers/specs/2026-06-16-spectrogram-scroll-stability.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/math/spectrogramMath.js` | Pure math | Add `spectrogramColumnRanges(...)` |
| `src/math/spectrogramMath.test.js` | Tests | Add (create if absent) scroll-stability tests |
| `src/hooks/useSpectrogramCanvas.js` | Canvas paint | Rewrite `paintImageData` + `draw()` to use the helper |

**Task order:** 1 (helper + tests) → 2 (painter rewrite).

---

### Task 1: Pure `spectrogramColumnRanges`

**Files:**
- Modify: `src/math/spectrogramMath.js` (add export)
- Test: `src/math/spectrogramMath.test.js` (create if absent, else append)

- [ ] **Step 1: Write the failing tests**

Create `src/math/spectrogramMath.test.js` if it does not exist (with the import + describe below); if it already exists, add the `describe("spectrogramColumnRanges", ...)` block and ensure `spectrogramColumnRanges` is imported.

```js
import { describe, it, expect } from "vitest";
import { spectrogramColumnRanges } from "./spectrogramMath.js";

describe("spectrogramColumnRanges", () => {
  it("returns empty for no snapshots without throwing", () => {
    const r = spectrogramColumnRanges(0, 0, 100, 300);
    expect(r.bucketCount).toBe(0);
    expect(r.ranges).toEqual([]);
  });

  it("DENSE: scrolling one bucket translates columns by exactly one, nothing dropped", () => {
    const total = 2000;
    const W = 300;
    const vis = 1500; // snapsPerBucket = 5 (integer)
    const spb = vis / W;
    const a = spectrogramColumnRanges(total, 0, vis, W);
    const b = spectrogramColumnRanges(total, spb, vis, W);

    expect(a.bucketCount).toBe(b.bucketCount);

    // Each absolute bucket sits one column to the right after scrolling one bucket.
    for (let x = 5; x < a.bucketCount - 5; x++) {
      expect(b.ranges[x + 1]).toEqual(a.ranges[x]);
    }
    // No empty interior column when downsampled (every pixel covered → no dropped snapshot).
    for (let x = 1; x < a.bucketCount - 1; x++) {
      expect(a.ranges[x][1]).toBeGreaterThan(a.ranges[x][0]);
    }
  });

  it("UPSAMPLED: more pixels than snapshots yields empty columns (painter carries them forward)", () => {
    const total = 50;
    const W = 300;
    const vis = 50; // snapsPerBucket ≈ 0.167
    const r = spectrogramColumnRanges(total, 0, vis, W);
    const nonEmpty = r.ranges.filter(([i0, i1]) => i1 > i0).length;
    expect(nonEmpty).toBeLessThanOrEqual(50);
    expect(nonEmpty).toBeGreaterThan(0);
    expect(r.ranges.some(([i0, i1]) => i1 === i0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/math/spectrogramMath.test.js`
Expected: FAIL — `spectrogramColumnRanges is not a function`.

- [ ] **Step 3: Implement the helper**

Append to `src/math/spectrogramMath.js`:

```js
/**
 * Map each output pixel column to an absolute snapshot index range, anchored so
 * that scrolling translates columns instead of re-selecting which snapshots survive.
 *
 * @param {number} totalSnaps         length of the visual snapshot ring
 * @param {number} effectiveOffsetSamples snapshots from the live edge (integer)
 * @param {number} visibleSamples     window width in snapshots (zoom)
 * @param {number} pixelWidth         canvas backing-store width W (device px)
 * @returns {{ ranges: Array<[number, number]>, bucketCount: number }}
 *   ranges[x] = [i0, i1) into the snaps array; i0 === i1 means an empty column.
 */
export function spectrogramColumnRanges(totalSnaps, effectiveOffsetSamples, visibleSamples, pixelWidth) {
  const W = Math.max(1, Math.floor(pixelWidth));
  const windowSamples = Math.max(1, visibleSamples);
  if (totalSnaps <= 0) return { ranges: [], bucketCount: 0 };

  const snapsPerBucket = windowSamples / W;
  const off = Math.max(0, Math.min(Math.max(0, totalSnaps - 1), effectiveOffsetSamples));
  const newestVisible = totalSnaps - 1 - off;
  const oldestVisible = newestVisible - windowSamples + 1; // may be < 0 at startup

  const kStart = Math.floor(oldestVisible / snapsPerBucket);
  const kEnd = Math.floor(newestVisible / snapsPerBucket);
  const bucketCount = Math.max(1, kEnd - kStart + 1);

  const visLo = Math.max(0, oldestVisible);
  const visHiExcl = newestVisible + 1; // exclusive
  const ranges = new Array(bucketCount);
  for (let x = 0; x < bucketCount; x++) {
    const k = kStart + x;
    let i0 = Math.ceil(k * snapsPerBucket);
    let i1 = Math.ceil((k + 1) * snapsPerBucket);
    if (i0 < visLo) i0 = visLo;
    if (i1 > visHiExcl) i1 = visHiExcl;
    if (i1 < i0) i1 = i0;
    ranges[x] = [i0, i1];
  }
  return { ranges, bucketCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/math/spectrogramMath.test.js`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogramMath.js src/math/spectrogramMath.test.js
git commit -m "feat(spectrogram): add absolute-anchored column-range mapping"
```

---

### Task 2: Rewrite `paintImageData` to be column-driven

**Files:**
- Modify: `src/hooks/useSpectrogramCanvas.js` (imports line 1-8, `paintImageData` 23-61, `draw()` body 132-151)
- Test: full JS suite + lint must stay green; manual app verification

- [ ] **Step 1: Update imports**

At the top of `useSpectrogramCanvas.js`, remove `spectrogramVisibleRange` from the `../config/scales.js` import (it is no longer used) and add `spectrogramColumnRanges` to the existing `../math/spectrogramMath.js` import:

```js
import {
  spectrogramColor,
  SPEC_DB_MIN,
  SPEC_DB_MAX,
} from "../config/scales.js";
import { buildYToBand, spectrogramColumnRanges } from "../math/spectrogramMath.js";
```

- [ ] **Step 2: Replace `paintImageData`**

Replace the entire `paintImageData` function (lines 23-61) with:

```js
function paintImageData(imageData, snaps, ranges, yToBand) {
  const { data, width: W, height: H } = imageData;
  const rng = SPEC_DB_MAX - SPEC_DB_MIN;
  data.fill(0);

  const bucketCount = ranges.length;
  if (bucketCount === 0) return;

  // Band count from the first non-empty column's snapshot.
  let bandCount = 0;
  for (let x = 0; x < bucketCount; x++) {
    const [i0, i1] = ranges[x];
    if (i1 > i0 && snaps[i0] && snaps[i0].dbList) {
      bandCount = snaps[i0].dbList.length;
      break;
    }
  }
  if (bandCount === 0) return;

  const colDb = new Float32Array(bandCount);
  const lastColDb = new Float32Array(bandCount);
  let hasLast = false;

  for (let x = 0; x < bucketCount; x++) {
    const [i0, i1] = ranges[x];
    let colData = null;

    if (i1 > i0) {
      colDb.fill(SPEC_DB_MIN);
      for (let i = i0; i < i1; i++) {
        const dl = snaps[i] && snaps[i].dbList;
        if (!dl) continue;
        for (let b = 0; b < bandCount; b++) {
          if (dl[b] > colDb[b]) colDb[b] = dl[b];
        }
      }
      colData = colDb;
      lastColDb.set(colDb);
      hasLast = true;
    } else if (hasLast) {
      colData = lastColDb; // carry forward across an empty (upsampled) column
    } else {
      continue; // leading empty → stays black
    }

    const xStart = Math.round((x * W) / bucketCount);
    const xEnd = Math.round(((x + 1) * W) / bucketCount);
    if (xEnd <= xStart) continue;

    for (let y = 0; y < H; y++) {
      const db = colData[yToBand[y]] ?? SPEC_DB_MIN;
      const t = Math.max(0, Math.min(1, (db - SPEC_DB_MIN) / rng));
      const lutIdx = Math.round(t * 255) * 3;
      const r = _INFERNO_FLAT[lutIdx];
      const g = _INFERNO_FLAT[lutIdx + 1];
      const b = _INFERNO_FLAT[lutIdx + 2];
      const a = Math.round(t * 255);
      const rowBase = y * W;
      for (let dx = xStart; dx < xEnd; dx++) {
        const idx = (rowBase + dx) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
  }
}
```

- [ ] **Step 3: Update the `draw()` call site**

In `draw()`, replace the block that calls `spectrogramVisibleRange` and `paintImageData` (lines 132-151) with:

```js
      const { ranges } = spectrogramColumnRanges(
        len,
        effectiveOffsetSamples,
        visibleSamples,
        W
      );
      let anyData = false;
      for (let x = 0; x < ranges.length; x++) {
        if (ranges[x][1] > ranges[x][0]) {
          anyData = true;
          break;
        }
      }
      if (!anyData) {
        ctx.clearRect(0, 0, W, H);
        return;
      }

      paintImageData(cache.imageData, snaps, ranges, cache.yToBand);
      ctx.putImageData(cache.imageData, 0, 0);
```

(`effectiveOffsetSamples`, `visibleSamples`, `len`, `W`, `cache`, `ctx`, `snaps` are all already in scope in `draw()`.)

- [ ] **Step 4: Run the spectrogram + full suite**

Run: `npx vitest run src/math/spectrogramMath.test.js src/components/panels/SpectrogramPanel.test.jsx`
Expected: PASS.

Run: `npm test`
Expected: all green. If a test referenced the old `paintImageData` signature or `spectrogramVisibleRange` via this hook, fix the wiring so it passes; report any test file changed.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean. Remove any now-unused imports/vars (e.g. the old `spectrogramVisibleRange`, `startIdx`/`count`/`leadingEmptySamples`/`windowSamples` locals).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSpectrogramCanvas.js
git commit -m "feat(spectrogram): column-driven absolute-anchored paint (anti-flicker)"
```

- [ ] **Step 7: Manual verification (human)**

`npm run desktop`, play audio, scroll/scrub the spectrogram — especially when zoomed out / tightly packed: columns must translate smoothly with no popping or disappearing content. Check at a couple of zoom levels and after resizing the window.

---

## Self-Review

**Spec coverage:**
- Pixel-column-driven painting → Task 2 (`paintImageData` iterates `bucketCount` columns).
- Absolute-anchored, scroll-invariant ranges → Task 1 (`absBucket(i) = floor(i / snapsPerBucket)`).
- Per-band max aggregation, nothing dropped → Task 2 (max into `colDb`).
- Carry-forward empties / leading-empty black → Task 2 (`hasLast` / `continue`).
- Testable seam → Task 1 pure helper + invariant tests.
- Sub-pixel out of scope → no task (integer-pixel columns; offset already integer upstream).
- No change to Rust/IPC/viewport mapping → only the two frontend files touched.

**Placeholder scan:** none — all code complete, commands explicit.

**Type consistency:** `spectrogramColumnRanges` returns `{ ranges: Array<[number,number]>, bucketCount }`; `draw()` destructures `{ ranges }` and passes `ranges` to `paintImageData(imageData, snaps, ranges, yToBand)`, whose new 4-arg signature matches the call. `_INFERNO_FLAT`, `SPEC_DB_MIN`, `SPEC_DB_MAX`, `buildYToBand` remain defined/imported.
