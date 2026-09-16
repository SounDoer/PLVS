# Waveform Scroll Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the waveform envelope from flickering while scrolling by decimating to one min/max bucket per device pixel with bucket boundaries anchored to absolute entry-index position, so scrolling translates the envelope (sub-pixel) instead of re-bucketing every frame.

**Architecture:** Rewrite the pure `sliceWaveformSubHistory` to take the canvas pixel width and return absolute-anchored buckets plus a sub-pixel `fracPhase`. The panel measures the shared canvas-area width once and slices with it; each lane draws bucket `j` at device-pixel `x = j - fracPhase`.

**Tech Stack:** JavaScript/React (Vite + Vitest), HTML canvas 2D.

**Spec:** `docs/working/superpowers/specs/2026-06-16-waveform-scroll-stability.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/math/waveformMath.js` | Pure decimation | Rewrite `sliceWaveformSubHistory`; remove `WAVEFORM_DECIM_COLUMNS` |
| `src/math/waveformMath.test.js` | Tests | Replace with absolute-anchoring + scroll-stability tests |
| `src/components/panels/WaveformPanel.jsx` | Render | Measure canvas width; pass `W` to slice; pass `bucketCount`/`fracPhase` to lanes; lane draws `x = j - fracPhase` |

`hoverMath.js` needs **no code change** — `computeWaveformHoverPoint`'s 4th arg is already a column count; the panel just passes `bucketCount` into it.

**Task order:** 1 (math + tests) → 2 (panel/lane wiring).

---

### Task 1: Rewrite `sliceWaveformSubHistory` (absolute-anchored, pixel-width)

**Files:**
- Modify: `src/math/waveformMath.js` (replace whole file)
- Test: `src/math/waveformMath.test.js` (replace whole file)

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/math/waveformMath.test.js` with:

```js
import { describe, it, expect } from "vitest";
import { sliceWaveformSubHistory } from "./waveformMath.js";

const SUBS = 19;
function flatEntry(amp) {
  const pairs = new Float32Array(SUBS * 2); // 1 channel, stride 2
  for (let s = 0; s < SUBS; s++) {
    pairs[s * 2] = -amp;
    pairs[s * 2 + 1] = amp;
  }
  return { waveformSubPairs: pairs, waveformSubCount: SUBS, waveformMin: [-amp], waveformMax: [amp] };
}
function spikeEntry(baseAmp, spikeAmp, spikeSub) {
  const pairs = new Float32Array(SUBS * 2);
  for (let s = 0; s < SUBS; s++) {
    const a = s === spikeSub ? spikeAmp : baseAmp;
    pairs[s * 2] = -a;
    pairs[s * 2 + 1] = a;
  }
  return {
    waveformSubPairs: pairs,
    waveformSubCount: SUBS,
    waveformMin: [-spikeAmp],
    waveformMax: [spikeAmp],
  };
}
// 50 flat entries with one sharp spike at entry 25.
function spikeTrack() {
  return Array.from({ length: 50 }, (_, i) =>
    i === 25 ? spikeEntry(0.2, 0.95, 9) : flatEntry(0.2)
  );
}

describe("sliceWaveformSubHistory", () => {
  it("returns zero arrays without throwing for empty input", () => {
    const r = sliceWaveformSubHistory([], 100, 0, 2, 300);
    expect(r.bucketCount).toBeGreaterThanOrEqual(1);
    expect(r.mins).toHaveLength(2);
    expect(r.maxes[0]).toHaveLength(r.bucketCount);
    expect(r.maxes[0].every((v) => v === 0)).toBe(true);
    expect(Number.isFinite(r.fracPhase)).toBe(true);
  });

  it("emits roughly one bucket per device pixel", () => {
    const r = sliceWaveformSubHistory(spikeTrack(), 50, 0, 1, 300);
    expect(r.bucketCount).toBeGreaterThanOrEqual(300);
    expect(r.bucketCount).toBeLessThanOrEqual(302);
  });

  it("produces a smooth curve — far more distinct levels than the ~50 ticks", () => {
    const entries = Array.from({ length: 50 }, (_, i) => flatEntry((0.8 * (i + 1)) / 50));
    const r = sliceWaveformSubHistory(entries, 50, 0, 1, 300);
    expect(new Set(r.maxes[0]).size).toBeGreaterThan(40);
  });

  it("SCROLL STABILITY: scrolling exactly one bucket translates by one column, peak unchanged", () => {
    const entries = spikeTrack();
    const W = 300;
    const coordsPerBucket = 50 / W;
    const a = sliceWaveformSubHistory(entries, 50, 0, 1, W);
    const b = sliceWaveformSubHistory(entries, 50, coordsPerBucket, 1, W);

    expect(Math.max(...a.maxes[0])).toBeCloseTo(0.95, 5);
    expect(Math.max(...b.maxes[0])).toBeCloseTo(0.95, 5); // peak preserved, not dropped
    expect(b.fracPhase).toBeCloseTo(a.fracPhase, 6); // whole-bucket scroll keeps phase

    const peakA = a.maxes[0].indexOf(Math.max(...a.maxes[0]));
    const peakB = b.maxes[0].indexOf(Math.max(...b.maxes[0]));
    expect(peakB).toBe(peakA + 1); // pure 1-column translation
  });

  it("SUB-BUCKET scroll preserves the peak value and yields fracPhase in [0,1)", () => {
    const entries = spikeTrack();
    const W = 300;
    const coordsPerBucket = 50 / W;
    const c = sliceWaveformSubHistory(entries, 50, coordsPerBucket * 0.4, 1, W);
    expect(Math.max(...c.maxes[0])).toBeCloseTo(0.95, 5);
    expect(c.fracPhase).toBeGreaterThanOrEqual(0);
    expect(c.fracPhase).toBeLessThan(1);
  });

  it("falls back to whole-tick bounds for entries lacking sub-pairs", () => {
    const entries = [
      { waveformMin: [-0.4], waveformMax: [0.4] },
      { waveformMin: [-0.9], waveformMax: [0.9] },
    ];
    const r = sliceWaveformSubHistory(entries, 2, 0, 1, 200);
    expect(Math.max(...r.maxes[0])).toBeCloseTo(0.9, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/math/waveformMath.test.js`
Expected: FAIL — current `sliceWaveformSubHistory` returns `{ mins, maxes, columns }` (no `bucketCount`/`fracPhase`) and ignores `pixelWidth`.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `src/math/waveformMath.js` with:

```js
/**
 * Decimate the visible sub-block history to one min/max bucket per device pixel,
 * with bucket boundaries anchored to absolute entry-index position so that
 * scrolling translates the envelope (sub-pixel) instead of re-bucketing.
 *
 * Coordinate basis is entry-index space (matches the shared Loudness History axis):
 *   absPos(e, s) = e + (s + 0.5) / subCount
 *
 * @param {{waveformSubPairs?: Float32Array|number[], waveformSubCount?: number, waveformMin?: number[], waveformMax?: number[]}[]} histSourceList
 * @param {number} visibleSamples         window width in history entries (zoom)
 * @param {number} effectiveOffsetSamples entries from the live edge (may be fractional)
 * @param {number} channelCount
 * @param {number} pixelWidth             canvas backing-store width in device px (W)
 * @returns {{ mins: number[][], maxes: number[][], bucketCount: number, fracPhase: number }}
 */
export function sliceWaveformSubHistory(
  histSourceList,
  visibleSamples,
  effectiveOffsetSamples,
  channelCount,
  pixelWidth
) {
  const W = Math.max(1, Math.floor(pixelWidth));
  const total = histSourceList.length;
  const windowSamples = Math.max(1, visibleSamples);
  const coordsPerBucket = windowSamples / W;

  const off = Math.max(0, Math.min(Math.max(0, total - 1), effectiveOffsetSamples));
  const newestVisible = total - 1 - off;
  const oldestVisible = newestVisible - windowSamples + 1; // may be negative at startup

  const kStart = Math.floor(oldestVisible / coordsPerBucket);
  const kEnd = Math.floor((newestVisible + 1) / coordsPerBucket);
  const bucketCount = Math.max(1, kEnd - kStart + 1);
  const fracPhase = oldestVisible / coordsPerBucket - kStart;

  const mins = Array.from({ length: channelCount }, () => new Array(bucketCount).fill(0));
  const maxes = Array.from({ length: channelCount }, () => new Array(bucketCount).fill(0));

  if (total === 0) return { mins, maxes, bucketCount, fracPhase };

  const start = Math.max(0, Math.floor(oldestVisible));
  const end = Math.min(total - 1, Math.ceil(newestVisible));
  if (end < start) return { mins, maxes, bucketCount, fracPhase };

  const hasData = new Array(bucketCount).fill(false);
  const stride = 2 * channelCount;

  const fold = (j, ch, mn, mx) => {
    if (!hasData[j]) {
      mins[ch][j] = mn;
      maxes[ch][j] = mx;
    } else {
      if (mn < mins[ch][j]) mins[ch][j] = mn;
      if (mx > maxes[ch][j]) maxes[ch][j] = mx;
    }
  };

  for (let e = start; e <= end; e++) {
    const row = histSourceList[e];
    const pairs = row.waveformSubPairs;
    const subCount = row.waveformSubCount | 0;

    if (pairs && subCount > 0 && pairs.length >= subCount * stride) {
      for (let s = 0; s < subCount; s++) {
        const absPos = e + (s + 0.5) / subCount;
        const j = Math.floor(absPos / coordsPerBucket) - kStart;
        if (j < 0 || j >= bucketCount) continue;
        const base = s * stride;
        for (let ch = 0; ch < channelCount; ch++) {
          fold(j, ch, pairs[base + ch * 2], pairs[base + ch * 2 + 1]);
        }
        hasData[j] = true;
      }
    } else {
      const absPos = e + 0.5;
      const j = Math.floor(absPos / coordsPerBucket) - kStart;
      if (j < 0 || j >= bucketCount) continue;
      const wmin = row.waveformMin ?? [];
      const wmax = row.waveformMax ?? [];
      for (let ch = 0; ch < channelCount; ch++) {
        fold(j, ch, wmin[ch] ?? 0, wmax[ch] ?? 0);
      }
      hasData[j] = true;
    }
  }

  // Carry-forward across empty interior buckets for a continuous envelope.
  const firstJ = hasData.indexOf(true);
  const lastJ = hasData.lastIndexOf(true);
  if (firstJ >= 0) {
    for (let j = firstJ + 1; j <= lastJ; j++) {
      if (!hasData[j]) {
        for (let ch = 0; ch < channelCount; ch++) {
          mins[ch][j] = mins[ch][j - 1];
          maxes[ch][j] = maxes[ch][j - 1];
        }
      }
    }
  }

  return { mins, maxes, bucketCount, fracPhase };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/math/waveformMath.test.js`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/math/waveformMath.js src/math/waveformMath.test.js
git commit -m "feat(waveform): absolute-anchored pixel-width decimation for scroll stability"
```

---

### Task 2: Wire the panel and lane to W + fracPhase

**Files:**
- Modify: `src/components/panels/WaveformPanel.jsx` (panel slice call ~49-54, hover call ~62-72, lanes container ~89, lane props ~90-98, `WaveformLane` ~212-287)
- Test: full suite must stay green; manual app verification

- [ ] **Step 1: Add canvas-width measurement state to the panel**

In `WaveformPanel`, after the `useAudioData()` destructure block (after line 45), add:

```js
  const lanesRef = useRef(null);
  const [canvasW, setCanvasW] = useState(0);
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(0, el.clientWidth - LABEL_WIDTH_PX);
      setCanvasW(Math.round(cssW * dpr));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
```

(`useRef`, `useEffect`, `useState` are already imported on line 1; `LABEL_WIDTH_PX` is already defined in the file.)

- [ ] **Step 2: Slice with W and destructure the new shape**

Replace the slice call (lines 49-54) with:

```js
  const { mins, maxes, bucketCount, fracPhase } = sliceWaveformSubHistory(
    histSourceList ?? [],
    visibleSamples ?? 0,
    effectiveOffsetSamples ?? 0,
    effectiveChannels,
    canvasW
  );
```

- [ ] **Step 3: Update the hover call**

In the `computeWaveformHoverPoint(...)` arguments (lines 62-72), replace `columns` with `bucketCount`:

```js
      ? computeWaveformHoverPoint(
          xFrac,
          mins,
          maxes,
          bucketCount,
          effectiveOffsetSamples ?? 0,
          visibleSamples ?? 0,
          HIST_SAMPLE_SEC,
          labels
        )
```

- [ ] **Step 4: Attach the ref and update lane props**

Add `ref={lanesRef}` to the lanes-container div (line 89):

```jsx
      <div ref={lanesRef} className="relative isolate flex min-h-0 flex-1 flex-col gap-0.5">
```

Replace the `<WaveformLane .../>` props (lines 91-97) with:

```jsx
          <WaveformLane
            key={ch}
            label={labels[ch] ?? `Ch${ch + 1}`}
            mins={mins[ch]}
            maxes={maxes[ch]}
            bucketCount={bucketCount}
            fracPhase={fracPhase}
            compact={compact}
          />
```

- [ ] **Step 5: Update `WaveformLane` to draw `x = j - fracPhase`**

Change the signature (line 212) to:

```jsx
function WaveformLane({ label, mins, maxes, bucketCount, fracPhase, compact }) {
```

Replace the envelope-building block (the part from `if (!columns || !mins?.length) return;` through the `ctx.closePath();` that ends the envelope path — lines 259-275) with:

```js
    if (!bucketCount || !mins?.length) return;

    const xFor = (j) => j - fracPhase; // one bucket per device pixel, sub-pixel phase
    ctx.beginPath();
    for (let j = 0; j < bucketCount; j++) {
      const x = xFor(j);
      const y = cy - maxes[j] * cy;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let j = bucketCount - 1; j >= 0; j--) {
      const x = xFor(j);
      const y = cy - mins[j] * cy;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
```

Update the redraw effect's dependency array (line 287) to:

```js
  }, [mins, maxes, bucketCount, fracPhase, canvasSize]);
```

- [ ] **Step 6: Run the targeted suite + full suite + lint**

Run: `npx vitest run src/components/panels/WaveformPanel.test.jsx src/math/waveformMath.test.js src/math/hoverMath.test.js`
Expected: PASS.

Run: `npm test`
Expected: all green. If `WaveformPanel.test.jsx` references the removed `columns` prop/shape, fix the wiring so it passes; report any test file changed.

Run: `npm run lint`
Expected: clean. (`W` capitalised local is fine; if eslint flags the old unused `xForEntry`/`columns`/`denom`, remove the now-dead lines you replaced.)

- [ ] **Step 7: Commit**

```bash
git add src/components/panels/WaveformPanel.jsx
git commit -m "feat(waveform): render with absolute buckets + sub-pixel phase (anti-flicker)"
```

- [ ] **Step 8: Manual verification (human)**

`npm run desktop`, play audio, scroll/scrub the timeline at the 5 s max zoom: the envelope must translate smoothly with no per-column popping. Resize the window and re-check at a couple of zoom levels. Confirm the waveform stays aligned with the Loudness History chart while scrubbing.

---

## Self-Review

**Spec coverage:**
- Decimate to device pixels (not fixed 1000) → Task 1 (`pixelWidth` / `W`).
- Absolute-anchored buckets (`floor(absPos / coordsPerBucket)`) → Task 1.
- Sub-pixel `fracPhase`, no offset rounding → Task 1 returns it; Task 2 draws `x = j - fracPhase`.
- W plumbing via panel ResizeObserver → Task 2 Step 1-2.
- Hover uses bucket count → Task 2 Step 3 (no hoverMath.js change needed).
- Carry-forward / leading-empty / fallback preserved → Task 1.
- Scroll-stability acceptance test → Task 1 Step 1 (whole-bucket translation + sub-bucket peak preservation).
- Alignment with Loudness History → Task 2 Step 8 (manual).
- Zoom/resize re-settle accepted (out of scope) → no task; rebuild happens naturally when `visibleSamples`/`canvasW` change.

**Placeholder scan:** none — all code steps complete, commands explicit.

**Type consistency:** `sliceWaveformSubHistory` returns `{ mins, maxes, bucketCount, fracPhase }`; panel destructures exactly those; lane takes `{ mins, maxes, bucketCount, fracPhase }`; `computeWaveformHoverPoint` 4th arg receives `bucketCount` (a column count, matching its existing param). `WAVEFORM_DECIM_COLUMNS` removed and no longer referenced anywhere (panel no longer imports it).
