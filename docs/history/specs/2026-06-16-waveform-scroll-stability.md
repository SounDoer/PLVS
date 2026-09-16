# Waveform Scroll Stability (Anti-Flicker)

**Date:** 2026-06-16
**Status:** Draft
**Builds on:** `2026-06-15-waveform-subblock-precision.md` (sub-block precision, already implemented)

## Motivation

After the sub-block precision upgrade, the waveform envelope is much denser (~19 sub-pairs per tick). While **scrolling/scrubbing** the timeline, tall transients visibly **jump between adjacent pixel columns** — a flickering, unstable envelope.

Root cause — two compounding sources in the current `sliceWaveformSubHistory` + `WaveformLane` path:

1. **Window-relative bucketing.** Decimation columns are computed from `entryPos = e - oldestVisible`. When the scroll offset changes, `oldestVisible` shifts, so every sub-pair is re-assigned to a different column. Because each column shows the min/max of whatever falls in it, a sharp peak crossing a column boundary makes one column drop and the next jump — classic decimation *scintillation*.
2. **Fixed 1000 columns rescaled to W pixels.** The slice emits a fixed `WAVEFORM_DECIM_COLUMNS = 1000` array that `WaveformLane` then rescales across the actual canvas width `W`. Two mismatched grids beating against each other shimmer as content shifts.

## Goal

Scrolling the waveform at a constant zoom produces a **stable envelope that translates smoothly** — no per-column popping — at every zoom level and every panel size.

## Key principle

> Bucket **width** is a function of (zoom × panel pixel width); it is rebuilt only on the **discrete** actions that change it (zoom, panel resize). Bucket **phase** is anchored to absolute data position, so during continuous **scroll** the same buckets simply translate (sub-pixel), and each bucket's min/max is identical frame-to-frame.

| Action | Frequency | Behaviour |
|--------|-----------|-----------|
| Scroll / scrub | continuous | buckets fixed in data space, sub-pixel translate → no flicker |
| Zoom | discrete | bucket width changes → re-bucket once (acceptable re-settle) |
| Panel resize | discrete | bucket count changes → re-bucket once (acceptable re-settle) |

This holds for **all** zoom levels and panel sizes because the bucket grid is *parameterised* by both `visibleSamples` (zoom) and `W` (pixel width); nothing is hard-coded to one configuration.

## Design

### Coordinate basis

Use the existing **entry-index space** (the same basis the shared Loudness History axis uses), so the two panels stay aligned. A sub-pair's absolute position is:

```
absPos(e, s) = e + (s + 0.5) / subCount        // monotonic across history
```

The visible window is `[oldestVisible, newestVisible + 1)` in this space, where
`newestVisible = total - 1 - effectiveOffsetSamples` and
`oldestVisible = newestVisible - windowSamples + 1`. `effectiveOffsetSamples` may be fractional (scrubbing) — that is fine and is the source of smooth sub-pixel motion.

### Decimate to pixels, anchored absolutely

Let `W` = canvas backing-store pixel width (`clientWidth * dpr`). One bucket per device pixel:

```
coordsPerBucket = windowSamples / W            // window-coords per pixel; depends on zoom AND W
absBucket(absPos) = floor(absPos / coordsPerBucket)   // boundaries at fixed multiples → scroll-invariant
```

Because boundaries are multiples of `coordsPerBucket` in **absolute** space, a given bucket covers the **same data** regardless of scroll offset, so its min/max does not change as you scroll — the popping is gone.

Visible bucket range:

```
kStart = floor(oldestVisible / coordsPerBucket)
kEnd   = floor((newestVisible + 1) / coordsPerBucket)
output column j = absBucket - kStart            // j in 0 .. (kEnd - kStart)
```

### Sub-pixel phase (smooth scroll, stays aligned)

Do **not** round `effectiveOffsetSamples` (that would drift < 1 px from the Loudness History chart). Instead return the fractional phase so the renderer translates by it:

```
fracPhase = (oldestVisible / coordsPerBucket) - kStart      // in [0, 1)
```

Bucket column `j` draws at backing-pixel `x = j - fracPhase`. As the offset scrolls continuously, `fracPhase` slides continuously and all columns shift together by the same sub-pixel amount → smooth translation, no recomputation of bucket contents.

### `waveformMath.js` — revised `sliceWaveformSubHistory`

New signature takes `pixelWidth` (W) instead of an internal fixed column count:

```js
export function sliceWaveformSubHistory(
  histSourceList,
  visibleSamples,
  effectiveOffsetSamples,   // may be fractional
  channelCount,
  pixelWidth                // canvas backing-store width W (device px)
) {
  // 1. windowSamples = max(1, visibleSamples); compute newest/oldestVisible (fractional ok).
  // 2. coordsPerBucket = windowSamples / max(1, pixelWidth).
  // 3. kStart = floor(oldestVisible / coordsPerBucket); kEnd = floor((newestVisible+1)/coordsPerBucket).
  //    bucketCount = kEnd - kStart + 1.
  // 4. mins/maxes = channelCount arrays of length bucketCount (filled 0).
  // 5. For each visible entry e and each sub-pair s:
  //       absPos = e + (s + 0.5) / subCount
  //       j = floor(absPos / coordsPerBucket) - kStart   (skip if out of [0, bucketCount))
  //       fold min/max into column j.
  //    (Entries lacking sub-pairs fall back to whole-tick waveformMin/Max at absPos = e + 0.5.)
  // 6. Carry-forward empty interior columns (continuity).
  // 7. fracPhase = (oldestVisible / coordsPerBucket) - kStart.
  // 8. return { mins, maxes, bucketCount, fracPhase };
}
```

`WAVEFORM_DECIM_COLUMNS` is removed.

### `WaveformPanel.jsx` — measure width, slice once

The panel must know `W` before slicing, and all lanes share the same width. Add a `ResizeObserver` on the canvas-area container (the flex region right of the 28 px label column) to track its `clientWidth`; multiply by `devicePixelRatio`. Slice once with that `W`, pass `mins[ch]`, `maxes[ch]`, `bucketCount`, and `fracPhase` to each lane. (Hover uses `bucketCount` as the column count, same as today's `columns`.)

### `WaveformLane` — translate, don't rescale

Replace the `xForCol` rescale (`i / (columns-1) * W`) with a 1:1 mapping plus sub-pixel phase:

```
x(j) = j - fracPhase     // backing-store pixels, one bucket per pixel
```

Draw the max trace left→right and the min trace right→left as today (filled envelope). The lane no longer rescales 1000→W; it draws exactly `bucketCount ≈ W` columns at device-pixel resolution.

### Alignment & edge cases

- **Loudness History alignment:** offset is never rounded; sub-pixel phase keeps the waveform within < 1 px of the loudness chart. Verify visually.
- **Leading empty (startup):** columns before the first available entry stay at the 0 fill (flat at centre), right-aligning partial data — same behaviour as today.
- **Live edge advancing:** when new entries arrive and the oldest is evicted, all entry indices shift by one, but `oldestVisible` shifts with them, so positions are preserved and the waveform scrolls left as expected. This is intended motion, not the flicker being fixed.
- **Zoom / resize re-settle:** `coordsPerBucket` changes, so the grid rebuilds for one frame. This is a one-time re-layout tied to a deliberate user action, not continuous flicker. Out of scope to eliminate (would require an offscreen position-keyed cache).

## Files to modify

| File | Change |
|------|--------|
| `src/math/waveformMath.js` | Rewrite `sliceWaveformSubHistory`: absolute-anchored bucketing to `pixelWidth`; return `{ mins, maxes, bucketCount, fracPhase }`; remove `WAVEFORM_DECIM_COLUMNS` |
| `src/math/waveformMath.test.js` | Replace tests: scroll-stability invariant + bucket count == pixelWidth-ish + fracPhase range |
| `src/components/panels/WaveformPanel.jsx` | Add canvas-area `ResizeObserver`; pass `W` to slice; pass `bucketCount`/`fracPhase` to lanes; update hover call to use `bucketCount` |
| `src/math/hoverMath.js` | `computeWaveformHoverPoint` column index already uses the passed column count — confirm it receives `bucketCount`; map `xFrac → round(xFrac*(bucketCount-1))` unchanged |

## Acceptance test

The core invariant is **translation stability**: scrolling by less than one bucket must not change the set of bucket extrema (only their sub-pixel phase). In `waveformMath.test.js`:

```js
// One sharp spike at a fixed absolute position, dense sub-pairs, fixed zoom & width.
// Slice at offset O and at offset O + δ (δ a small fraction of one bucket).
// Assert:
//  - bucketCount is identical for both.
//  - The maximum bucket value (the spike peak) is identical for both
//    (current window-relative code fails this: the peak pops between columns).
//  - The COUNT of buckets whose max exceeds a threshold is identical
//    (the spike occupies a stable number of columns, it doesn't smear/jump).
//  - fracPhase differs between the two offsets and lies in [0, 1).
```

Add a degenerate test: `pixelWidth = 0` and empty `histSourceList` return empty/zero arrays without throwing.

## Non-goals / out of scope

- Eliminating the one-frame re-settle on zoom or panel resize (would need an offscreen, position-keyed render cache — separate, heavier work).
- Temporal smoothing of the envelope (hides flicker but adds lag and misrepresents the data — rejected for a metering tool).
- Any change to the Rust pipeline, IPC, or the 2-hour storage (data is unchanged; this is purely a rendering-math fix).
- RMS band / display modes (tracked separately).
