# Spectrogram Scroll Stability (Anti-Flicker)

**Date:** 2026-06-16
**Status:** Draft
**Sibling:** `2026-06-16-waveform-scroll-stability.md` (same idea, applied to the waveform)

## Motivation

The spectrogram flickers while scrolling, worst **when the timeline is tightly packed** (zoomed out / many visual snapshots per pixel). Root cause in `useSpectrogramCanvas.js` `paintImageData`:

- Painting is **snapshot-driven and window-relative**: each visible snapshot `col` is painted at `xStart = round((leadingEmptySamples + col) * W / windowSamples)`, `xEnd = round((slot + 1) * W / windowSamples)`.
- When more snapshots than pixels (downsampling), many snapshots round to `colW = xEnd - xStart === 0` and are **silently dropped** (`if (colW <= 0) continue`). **Which** snapshots survive depends on the rounding, which shifts as the offset/window changes → columns appear/disappear and content jumps as you scroll. That popping is the flicker.
- There is **no aggregation**: a pixel shows whichever single snapshot happened to round onto it, not a representation of all snapshots under it. So loud transients can vanish entirely between scroll positions.

## Goal

Scrolling the spectrogram produces a **stable image that translates smoothly** at every zoom and panel size — no columns popping in/out, no transients disappearing — especially in the dense (downsampled) regime.

## Key principle (mirrors the waveform fix)

> Drive painting by **output pixel column**, not by snapshot. Each pixel column covers a snapshot range whose boundaries are anchored to **absolute snapshot index** (scroll-invariant), and the column is the **per-band max** over every snapshot in that range (nothing dropped). Scrolling then translates the same columns instead of re-selecting survivors.

This holds across all zoom levels and panel sizes because the column granularity is parameterised by `visibleSamples` (zoom) and `W` (pixel width); it is recomputed only on the discrete actions that change them (zoom, resize).

## Design

### Coordinate basis

The spectrogram already runs on the **visual stream** (~25 Hz snaps); `mapHistoryViewportToVisual` converts the shared history viewport to integer visual offset/visible. We stay in visual-snap-index space (matching the existing axis), so no upstream change is needed.

Absolute snapshot position is just the snapshot's index `i` in the visual ring. Within a render and across consecutive scroll frames (no new data) it is stable; live-edge growth appends new columns on the right as expected.

### Column granularity, absolute-anchored

Let `W` = canvas backing-store pixel width.

```
snapsPerBucket = windowSamples / W              // visual snaps per pixel column; depends on zoom AND W
absBucket(i)   = floor(i / snapsPerBucket)       // boundaries at fixed absolute multiples → scroll-invariant
```

Visible range (from the existing `spectrogramVisibleRange`): snaps `[start .. end]`, with
`oldestVisible = (len - 1 - off) - windowSamples + 1`.

```
kStart  = floor(oldestVisible / snapsPerBucket)
kEnd    = floor((newestVisible + 1) / snapsPerBucket)
bucketCount = max(1, kEnd - kStart + 1)          // ≈ W (+1)
column x ⇐ snaps i where absBucket(i) - kStart === x
```

Because `absBucket(i)` does not depend on the scroll offset, a given snapshot always lands in the same **absolute** bucket; scrolling only changes `kStart` (which bucket is at the left edge) → the image translates, it does not re-select.

### Per-band max aggregation (nothing dropped)

For each output column `x`, aggregate the **per-band maximum dB** across all snapshots mapped to it:

```
colDb[band] = max over snaps i in bucket(x) of snap[i].dbList[band]
```

This is the heatmap analogue of the waveform's per-pixel min/max: loud content in a dense column is preserved and stable under scroll, instead of a flickering arbitrary single-snapshot winner.

- **Downsampling** (snapsPerBucket ≥ 1): each column aggregates several snaps — none dropped.
- **Upsampling** (snapsPerBucket < 1): some columns have no snapshot → **carry-forward** the previous column's spectrum (continuous image), matching the waveform's empty-column handling.
- **Leading empty** (startup, fewer snaps than the window): columns before the first snapshot stay cleared (black), right-aligning partial data — unchanged behaviour.

### Testable seam — extract a pure helper

Add a pure function in `spectrogramMath.js` so the stability invariant is unit-testable without a canvas:

```js
// Returns, per output column, the absolute snapshot index range covering it.
// ranges[x] = [i0, i1) (i1 exclusive); empty column ⇒ i0 === i1.
export function spectrogramColumnRanges(totalSnaps, effectiveOffsetSamples, visibleSamples, pixelWidth)
  → { ranges: Array<[number, number]>, bucketCount, leadingEmpty }
```

`paintImageData` consumes `ranges`: for each column it computes the per-band max over `snaps[i0 .. i1)` into a reused scratch `Float32Array(bandCount)` (no per-column heap allocation), maps `y → band` via the existing `yToBand`, and writes the column's pixels. Empty ranges carry forward the previous column.

Returning index ranges (two ints/column) rather than W aggregated spectra keeps this allocation-light; the max aggregation lives in the painter with a single reused scratch buffer.

### Sub-pixel phase — out of scope (intentionally)

The waveform used a `fracPhase` sub-pixel translation. The spectrogram's viewport offset is already **integer-rounded** to visual snaps upstream (`mapHistoryViewportToVisual` uses `Math.round`), so sub-pixel phase is not available without a larger viewport change, and `putImageData` cannot place a bitmap at a fractional x. Absolute-anchored integer-pixel buckets already remove the flicker (the actual complaint); scroll steps are ≤ 1 px and stay within < 1 px of the waveform/loudness axes. Smooth sub-pixel heatmap scrolling (offscreen `drawImage` blit) is deferred — it trades crispness for smoothness and is not needed to fix the reported problem.

## Files to modify

| File | Change |
|------|--------|
| `src/math/spectrogramMath.js` | Add pure `spectrogramColumnRanges(...)` (absolute-anchored column→snap-range mapping) |
| `src/math/spectrogramMath.test.js` | Add scroll-stability + no-dropped-column + bucketCount tests |
| `src/hooks/useSpectrogramCanvas.js` | Rewrite `paintImageData` to be pixel-column-driven via `spectrogramColumnRanges`, per-band max into a reused scratch, carry-forward empties |

(`useSpectrogramCanvas` already receives `effectiveOffsetSamples`, `visibleSamples`, `snaps`, and canvas `W`/`H`; no new inputs needed. The existing `lastPaintRef` repaint-skip guard stays.)

## Acceptance test

Core invariant — **scroll stability under tight packing**. In `spectrogramMath.test.js`:

```js
// totalSnaps far larger than pixelWidth (downsampled / "tightly packed").
// At offset O and O + snapsPerBucket (one whole bucket):
//  - bucketCount identical.
//  - ranges translate by exactly one column: ranges_b[x+1] deep-equals ranges_a[x]
//    for interior columns (pure translation, current code fails this).
//  - NO interior column is empty (every pixel covered ⇒ no snapshot dropped).
// Degenerate: totalSnaps = 0 and pixelWidth = 0 return empty ranges without throwing.
```

(Per-band max aggregation correctness is simple and covered by a small painter-level check; the flicker fix lives in the range mapping, which the invariant above pins down.)

## Non-goals / out of scope

- Sub-pixel (fractional-pixel) heatmap scrolling — deferred (see above).
- Eliminating the one-frame re-settle on zoom/resize (would need a position-keyed offscreen cache).
- Any change to the Rust pipeline, the visual IPC stream, or `mapHistoryViewportToVisual`.
- The Loudness History chart (single value per entry, no decimation — not susceptible).
