# Waveform Sub-Block Precision Upgrade

**Date:** 2026-06-15
**Status:** Draft

## Motivation

The current Waveform panel (spec: `2026-06-05-waveform-panel-design.md`) emits one min/max pair per channel per ~100ms history tick (~10 Hz). This yields:

| Zoom window | Data points | 400px panel spacing | Visual result |
|-------------|------------|---------------------|---------------|
| 60 s | 600 | ~0.67 px | Acceptable |
| 10 s | 100 | ~4 px | Visible stepping |
| 5 s (max zoom) | 50 | ~8 px | Coarse blocky stair-step |

At the current max zoom of 5 seconds, the waveform envelope is barely informative — the user sees ~50 rectangular blocks per lane rather than a smooth amplitude envelope.

The root cause is that the time resolution is fixed at one datum per ~100ms regardless of display pixel width. DAWs solve this with **pixel-driven decimation**: the data granularity adapts to the pixel count so that every pixel column carries the min/max of all underlying samples, producing a smooth curve at any zoom level.

## Goal

Upgrade the Waveform panel data pipeline so rendering quality is pixel-driven rather than history-tick-driven. The 5-second maximum zoom window should show a smooth envelope comparable to a DAW waveform overview.

## Non-goals

- No raw PCM streaming to the frontend.
- No independent time window per panel (time axis remains shared with Loudness History).
- No waveform zoom below the current 5-second minimum.
- No change to the overall history tick cadence (~10 Hz).
- No change to the canvas lane layout or channel label scheme.

## Design

### Sub-block granularity

Within each ~100ms history tick, the PCM block is divided into **sub-blocks of 256 samples**. At 48 kHz this gives ~5.3 ms per sub-block, producing ~188 sub-blocks per tick. Each sub-block yields one `(min, max)` pair per channel.

```
One ~100ms history tick (4800 samples @48kHz, stereo):

sub-block 0     sub-block 1          sub-block 187
[256 samples]   [256 samples]  ...   [256 samples]
   → (min,max)L    → (min,max)L          → (min,max)L
   → (min,max)R    → (min,max)R          → (min,max)R
```

### Rust: `MeterHistoryEntry` new field

```rust
/// Per-channel sub-block waveform pairs within this ~100ms history window.
/// Outer vec: one element per sub-block.
/// Inner vec: one (min, max) per channel, same order as `waveform_min`/`waveform_max`.
/// At 48 kHz with 256-sample sub-blocks, ~188 sub-blocks per tick.
pub waveform_sub_pairs: Vec<Vec<(f32, f32)>>,
```

The existing `waveform_min: Vec<f32>` and `waveform_max: Vec<f32>` fields are **retained** as whole-tick aggregates so that:
- The Loudness History panel can still quickly read amplitude bounds if needed.
- Backward compatibility during the transition window.

### Rust: `meter_pipeline.rs` accumulator

Replace the scalar accumulators `waveform_min_acc: Vec<f32>` / `waveform_max_acc: Vec<f32>` with a sub-block ring:

```rust
/// Per-channel sub-block (min, max) pairs accumulated since the last history tick.
/// One entry per sub-block; each entry is a per-channel (min, max) vec.
waveform_sub_acc: Vec<Vec<(f32, f32)>>,
/// Current sub-block index within the 256-sample window (0..SUBBLOCK_SAMPLES).
waveform_sub_idx: usize,
/// Running per-channel (min, max) for the current in-progress sub-block.
waveform_sub_cur: Vec<(f32, f32)>,
```

Constants:
```rust
const SUBBLOCK_SAMPLES: usize = 256;
```

In `push_pcm_f32`, the per-sample scan loop is modified:
- For each sample, update `waveform_sub_cur[ch].0` / `.1` for min/max.
- When `waveform_sub_idx` reaches `SUBBLOCK_SAMPLES`, push `waveform_sub_cur.clone()` into `waveform_sub_acc`, reset `waveform_sub_cur` to `(INFINITY, NEG_INFINITY)`, and reset the index.
- On history tick emit, drain `waveform_sub_acc` into `MeterHistoryEntry.waveform_sub_pairs` and allocate fresh vectors.

Edge case: the final incomplete sub-block at tick boundary is included as-is (fewer than 256 samples) so no data is lost.

### Bandwidth & memory

**IPC bandwidth (stereo, ~188 sub-blocks/tick, 10 ticks/s):**

```
188 sub-blocks × 2 channels × 2 values × 4 bytes = 3 008 bytes/tick
× 10 ticks/s = ~30 kB/s
```

For 7.1 (8 channels): `188 × 8 × 2 × 4 × 10 = ~120 kB/s`. Still negligible.

**Frontend memory (60 s history, stereo):**

```
60 s × 10 ticks × 188 sub-blocks × 2 ch × 2 × 4 bytes ≈ 1.8 MB
```

For 7.1: ~7.2 MB. Acceptable given modern browser memory budgets.

**Compared to alternatives:**
- Raw PCM (48 kHz × 2 ch × 4 bytes) = 384 kB/s — a full order of magnitude higher.
- Sub-block min/max is a 12× compression vs raw PCM while preserving visual fidelity.

### Frontend: `FrameIntake.js` and `AudioDataContext`

Add `waveformSubPairs` to the stored history row shape in `pushHistRow`:

```js
// FrameIntake.js pushHistRow:
this._histSourceList.push({
  // ...existing fields...
  waveformSubPairs: row.waveformSubPairs ?? [],
});
```

Expose via `getHistSourceList()` — no new context field needed since `histSourceList` already carries `MeterHistoryEntry` objects.

### Frontend: `WaveformPanel.jsx` rendering

The rendering changes from "one data point per history entry" to "per-pixel min/max decimation":

1. Flatten all visible sub-pairs into a time-ordered list of `(timestamp_fraction, channel_mins, channel_maxes)`.
2. For each pixel column `px` (0..canvasWidth):
   - Compute the time range `[px_start, px_end]` that this pixel covers.
   - Find all sub-pairs whose timestamp falls in this range.
   - Take the global min of mins and global max of maxes across those sub-pairs.
   - Draw a vertical line from `cy - max * cy` to `cy - min * cy`.
3. Fill the region between min and max traces as before (or draw per-pixel vertical lines for the classic DAW look).

This is a **pixel-driven decimation** — data density dynamically matches pixel count. At 400px canvas width and 5s window:

```
400 px / 5s = 80 px/s
Sub-block rate ≈ 188/s → ~2.35 sub-blocks per pixel → smooth
```

At 60s window:

```
400 px / 60s = 6.67 px/s
Sub-block rate ≈ 188/s → ~28 sub-blocks per pixel → still smooth
```

Performance: for stereo at 400px, the per-pixel loop runs 400 iterations × 2 channels, each scanning ~2–28 sub-pairs. Total ~800–22 400 comparisons per frame — trivially fast for `requestAnimationFrame` or the existing ~10 Hz re-render cycle.

### `waveformMath.js` changes

Replace `sliceWaveformHistory` with a new function `sliceWaveformSubHistory` that:
- Accepts the same parameters but reads `waveformSubPairs` from each entry.
- Emits three 2D arrays: `mins[ch][px]`, `maxes[ch][px]`, sized to `canvasWidth` instead of `entryCount`.

```js
export function sliceWaveformSubHistory(
  histSourceList,
  visibleSamples,
  effectiveOffsetSamples,
  channelCount,
  canvasWidth  // NEW: pixel count for decimation
) {
  // 1. Slice visible entries.
  // 2. Flatten all sub-pairs with their normalized time position.
  // 3. For each pixel column, compute min-of-mins and max-of-maxes.
  // 4. Return { mins, maxes, entryCount: canvasWidth }
}
```

### `ipc/types.js`

Add to `MeterHistoryEntry` typedef:

```js
@property {number[][][]} waveformSubPairs
// waveformSubPairs[subBlockIdx][channelIdx] = [min, max]
```

### `hoverMath.js` changes

`computeWaveformHoverPoint` currently maps `xFrac` to an entry index. With sub-blocks it can map to the nearest sub-pair, giving more precise dBFS readings. Update accordingly.

## Files to modify

| File | Change |
|------|--------|
| `src-tauri/src/ipc/types.rs` | Add `waveform_sub_pairs` field to `MeterHistoryEntry` |
| `src-tauri/src/engine/meter_pipeline.rs` | Replace scalar accumulators with sub-block ring; emit sub-pairs on history tick |
| `src/ipc/types.js` | Add `waveformSubPairs` to typedef |
| `src/lib/FrameIntake.js` | Store `waveformSubPairs` in `pushHistRow` |
| `src/math/waveformMath.js` | Replace `sliceWaveformHistory` with `sliceWaveformSubHistory` (or add new function) |
| `src/math/waveformMath.test.js` | Update tests |
| `src/components/panels/WaveformPanel.jsx` | Use new slice function; pass `canvasWidth`; optionally switch to per-pixel vertical-line rendering |
| `src/math/hoverMath.js` | Update `computeWaveformHoverPoint` for sub-pair precision |
| `src/math/hoverMath.test.js` | Update tests |

## Out of scope

- Changing the visual style from filled envelope to classic DAW vertical-line waveform (can be done later).
- Decoupling Waveform time axis from Loudness History.
- Zoom below 5 seconds.
- Per-channel color override.
