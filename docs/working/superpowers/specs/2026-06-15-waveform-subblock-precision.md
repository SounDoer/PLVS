# Waveform Sub-Block Precision Upgrade

**Date:** 2026-06-15
**Status:** Draft (v3 — simplified 2026-06-16)

> **v3 changes:** corrected a 10× arithmetic error carried since v1 — a 256-sample
> sub-block is ~19 sub-blocks per ~100 ms tick, **not ~188**. With the count right,
> the data is small enough to keep full sub-block detail for the **entire 2-hour
> history ring** (~22 MB stereo, flat `Float32Array`). That **removes** the v2
> "separate bounded ring + whole-tick downgrade" machinery entirely — sub-pairs now
> live in the main hist-rate ring with the same lifetime as every other panel.
> Retained from v2: flat layout (Rust `Vec<f32>` / JS `Float32Array`), entry-index
> (not wall-clock) axis alignment, the acceptance test, and the `VisualHistEntry`
> note. RMS energy band and REAPER-style display modes are explicitly **out of
> scope** for this spec (deferred).

## Motivation

The current Waveform panel (spec: `2026-06-05-waveform-panel-design.md`) emits one min/max pair per channel per ~100 ms history tick (~10 Hz). This yields:

| Zoom window | Data points | 400px panel spacing | Visual result |
|-------------|------------|---------------------|---------------|
| 60 s | 600 | ~0.67 px | Acceptable |
| 10 s | 100 | ~4 px | Visible stepping |
| 5 s (max zoom) | 50 | ~8 px | Coarse blocky stair-step |

At the current max zoom of 5 seconds, the waveform envelope is barely informative — the user sees ~50 rectangular blocks per lane rather than a smooth amplitude envelope.

The root cause is that the time resolution is fixed at one datum per ~100 ms regardless of display pixel width. DAWs solve this with **pixel-driven decimation**: the data granularity adapts to the pixel count so that every pixel column carries the min/max of all underlying samples, producing a smooth curve at any zoom level.

## Goal

Upgrade the Waveform panel data pipeline so rendering quality is pixel-driven rather than history-tick-driven. The 5-second maximum zoom window should show a smooth envelope comparable to a DAW waveform overview — **without** shortening the waveform's 2-hour history, which must stay consistent with every other panel.

## Non-goals

- No raw PCM streaming to the frontend.
- No independent time window per panel (time axis remains shared with Loudness History).
- No waveform zoom below the current 5-second minimum.
- No change to the overall history tick cadence (~10 Hz).
- No change to the canvas lane layout or channel label scheme.
- **No RMS energy band** (separate future work — see memory `project-waveform-rms-band`).
- **No REAPER-style display modes** (LUFS overlay, spectrogram, spectral coloring — deferred; most overlap existing PLVS panels).

## Design

### Sub-block granularity — and the sizing that makes 2-hour retention free

Within each ~100 ms history tick, the PCM block is divided into **sub-blocks of 256 samples** (`SUBBLOCK_SAMPLES`). At 48 kHz this is ~5.3 ms per sub-block, producing **~19 sub-blocks per tick** (4800 / 256 = 18.75). Each sub-block yields one `(min, max)` pair per channel.

```
One ~100ms history tick (4800 samples @48kHz, stereo):

sub-block 0     sub-block 1          sub-block 18
[256 samples]   [256 samples]  ...   [256 samples]
   → (min,max)L    → (min,max)L          → (min,max)L
   → (min,max)R    → (min,max)R          → (min,max)R
```

**Why 256 / ~19 per tick is the right size — not more.** The only thing that needs sub-tick detail is the deepest zoom. At the 5 s max zoom (≈ 50 ticks visible):

```
50 ticks × 19 sub-blocks = ~950 sub-pairs across the window
  400 px panel: 950 / 400 ≈ 2.4 sub-pairs/px   → smooth
  800 px panel: 950 / 800 ≈ 1.2 sub-pairs/px   → ≥1/px, still smooth
 1000 px panel: 950 / 1000 ≈ 0.95/px           → ~1/px, fine
```

So ~19/tick already gives ≥ 1 sub-pair per pixel at the deepest zoom on any realistic panel width. Going finer (the v1/v2 mistake of imagining ~94–188/tick) buys nothing visible while multiplying storage. 256 is the sweet spot: enough headroom at the widest panels, small enough that the full 2-hour ring fits in tens of MB (below). `SUBBLOCK_SAMPLES` remains the single cost knob — raising it to 384 (~13/tick) roughly halves storage if the 7.1 figure below ever needs trimming.

### Bandwidth & memory — full 2-hour retention

Sub-pairs ride the **same** hist-rate ring as every other panel (`HIST_MAX_SAMPLES = 72000` ≈ 1.9 h, `App.jsx`). No separate ring, no downgrade tier — the whole point of right-sizing the sub-block count is that full detail for the entire history is affordable.

**IPC bandwidth (stereo, ~19 sub-blocks/tick, 10 ticks/s):**

```
19 sub-blocks × 2 ch × 2 values × 4 bytes = 304 bytes/tick
× 10 ticks/s = ~3 kB/s
```

7.1 (8 ch): `19 × 8 × 2 × 4 × 10 ≈ 12 kB/s`. Negligible.

**Frontend memory (full 72 000-entry ring, flat `Float32Array` per entry):**

```
stereo: 72 000 × 19 × 2 ch × 2 × 4 B ≈ 22 MB
7.1:    72 000 × 19 × 8 ch × 2 × 4 B ≈ 88 MB
```

Stereo at ~22 MB for the full 2 hours is comfortable. 7.1 at ~88 MB is heavier but uncommon; raise `SUBBLOCK_SAMPLES` to trim it if it ever matters. Storage **must** be a flat `Float32Array` (stride `2 * channelCount`), not nested `number[][]` — nested arrays carry ~32–64 B per `[min,max]` in V8, which would inflate the above ~10×.

(For comparison, raw PCM would be 384 kB/s and unbounded; sub-block min/max is a large, bounded compression that preserves visual fidelity.)

### Rust: `MeterHistoryEntry` new field

Flat, row-major layout — avoids per-sub-block heap allocation on the audio-adjacent path and maps directly onto a frontend `Float32Array`.

```rust
/// Per-channel sub-block (min, max) pairs within this ~100ms history window,
/// flattened row-major. Layout per sub-block: [min_ch0, max_ch0, min_ch1, max_ch1, ...].
/// Stride = 2 * channel_count. Length = sub_block_count * stride.
/// At 48 kHz with 256-sample sub-blocks, ~19 sub-blocks per tick.
pub waveform_sub_pairs: Vec<f32>,
/// Number of sub-blocks in this tick, so the frontend can recover the stride.
/// Equals waveform_sub_pairs.len() / (2 * channel_count).
pub waveform_sub_count: u32,
```

The existing `waveform_min: Vec<f32>` / `waveform_max: Vec<f32>` whole-tick fields are **retained unchanged** — they still feed any quick whole-tick read and cost almost nothing. (They are no longer a "downgrade tier"; every entry now also carries full sub-pairs.)

### Rust: `meter_pipeline.rs` accumulator

Keep the existing whole-tick scalar accumulators (`waveform_min_acc` / `waveform_max_acc`). Add a flat sub-block accumulator alongside them:

```rust
/// Flat row-major sub-block (min, max) pairs accumulated since the last history
/// tick: [min_ch0, max_ch0, min_ch1, max_ch1, ...] per completed sub-block.
/// Reused across ticks; cleared (len = 0) on emit, never reallocated steadily.
waveform_sub_acc: Vec<f32>,
/// Sample counter within the current in-progress sub-block (0..SUBBLOCK_SAMPLES).
waveform_sub_idx: usize,
/// Running per-channel (min, max) for the current in-progress sub-block,
/// flat: [min_ch0, max_ch0, ...], len = 2 * channel_count.
waveform_sub_cur: Vec<f32>,
```

Constant:
```rust
const SUBBLOCK_SAMPLES: usize = 256;
```

In `push_pcm_f32`, fold the sub-block update into the existing per-sample scan loop (it already visits every sample for the whole-tick min/max):
- For each sample, update `waveform_sub_cur[2*ch]` (min) / `waveform_sub_cur[2*ch+1]` (max).
- When `waveform_sub_idx` reaches `SUBBLOCK_SAMPLES`, append `waveform_sub_cur` to `waveform_sub_acc` via `extend_from_slice`, reset each pair to `(INFINITY, NEG_INFINITY)`, reset the index. No per-sub-block heap allocation.
- On history tick emit, move `waveform_sub_acc` into `MeterHistoryEntry.waveform_sub_pairs` (`std::mem::take`), set `waveform_sub_count`, and `clear()` the accumulator for reuse.

Edge case: the final incomplete sub-block at the tick boundary is flushed as-is (fewer than `SUBBLOCK_SAMPLES` samples) so no data is lost. Mirror the existing INFINITY/NEG_INFINITY → 0.0 sentinel mapping used for the whole-tick bounds.

### Frontend: `ipc/types.js`

Add to the `MeterHistoryEntry` typedef (flat layout matching the Rust side):

```js
@property {Float32Array|number[]} waveformSubPairs
// flat row-major, stride = 2 * channelCount:
// [min_ch0, max_ch0, min_ch1, max_ch1, ...] per sub-block
@property {number} waveformSubCount   // sub-blocks in this tick
```

### Frontend: `FrameIntake.js`

Store the flat sub-pairs in a hist-rate ring capped at the **same** `histMaxSamples` as the other rings — keeping the waveform's sub-block history exactly as long as every other panel (2 hours):

```js
// In pushHistRow, alongside the existing rings:
ringPush(
  this._waveformSubRing,
  {
    pairs: row.waveformSubPairs ?? EMPTY_F32, // Float32Array, stride = 2*ch
    subCount: row.waveformSubCount ?? 0,
  },
  histMaxSamples
);
```

Expose via a new `getWaveformSubRing()` accessor and surface it on `AudioDataContext` (e.g. `waveformSubList`) so `WaveformPanel` can read it alongside `histSourceList`. The whole-tick `waveformMin` / `waveformMax` continue to ride `_loudnessHist` unchanged.

### Frontend: `WaveformPanel.jsx` rendering

The rendering changes from "one data point per history entry" to "per-pixel min/max decimation".

**Horizontal positioning is entry-index based, not wall-clock timestamp.** The time axis is shared with Loudness History, which positions purely by entry index (`xForEntry = (leadingEmptySamples + i) / denom`). History ticks are *not* evenly spaced in wall-clock time (`HIST_EMIT_MS` is gated on loudness-block cadence), so decimating by `timestamp` would drift out of alignment with the loudness chart. A sub-pair's x position is:

```
x_fraction(entryIndex, subIndex) =
    (leadingEmptySamples + entryIndex + subIndex / subCount) / denom
```

i.e. **entry index plus the sub-block's fractional position within its tick** — locked to the same axis the loudness history uses, and correct under fractional scrub offset and startup `leadingEmptySamples`.

Decimation:

1. Walk the visible entries; for each, emit its sub-pairs at `x_fraction(entryIndex, subIndex)`. (Every entry in the 2 h ring carries sub-pairs, so there is no fallback branch.)
2. For each pixel column `px` (0..canvasWidth):
   - Take the global min of mins and global max of maxes of every sub-pair whose `x_fraction × W` falls in `[px, px+1)`.
   - If a column has no sub-pairs (very wide zoom), carry the previous column's bounds so the envelope stays continuous.
   - Draw the vertical extent from `cy - max * cy` to `cy - min * cy`.
3. Fill the region between min and max traces as today (filled envelope).

At 5 s / 400 px this is ~2.4 sub-pairs per pixel column; at 60 s the visible entries simply contribute many sub-pairs per pixel — still smooth. Performance: the per-pixel loop is 400 columns × channels, each scanning a few sub-pairs — well under ~10 k comparisons per frame, trivial for the existing ~10 Hz re-render.

### `waveformMath.js` changes

Replace `sliceWaveformHistory` with `sliceWaveformSubHistory` (the old whole-tick slicer is no longer needed on the render path, since every entry now has sub-pairs; keep it only if another caller uses it):

```js
export function sliceWaveformSubHistory(
  waveformSubList,       // hist-rate ring: { pairs: Float32Array, subCount }
  visibleSamples,
  effectiveOffsetSamples,
  channelCount,
  canvasWidth            // pixel count for decimation
) {
  // 1. Slice the visible entry range (same index math as before).
  // 2. Place each entry's sub-pairs at x = (leadingEmptySamples + i + sub/subCount) / denom.
  // 3. Per pixel column: min-of-mins / max-of-maxes; carry previous column when empty.
  // 4. Return { mins, maxes, entryCount: canvasWidth, leadingEmptySamples, windowSamples }
}
```

### `hoverMath.js` changes

`computeWaveformHoverPoint` currently maps `xFrac` to an entry index. With sub-blocks it maps to the nearest sub-pair for more precise dBFS readings. Update accordingly.

### Acceptance test

In `waveformMath.test.js`: feed a swept sine across a 5 s window at `canvasWidth = 400`, call `sliceWaveformSubHistory`, and assert the returned `maxes[ch]` has length 400 with **no long run of identical adjacent columns** (e.g. no value repeated across more than ~3 consecutive pixels), proving the whole-tick stair-stepping is gone. Add a wide-zoom test (60 s) confirming continuous output (no empty columns leak through as gaps).

### Out of band: `VisualHistEntry`

A parallel 25 Hz waveform stream exists on `VisualHistEntry` (`waveform_min` / `waveform_max`, `meter_pipeline.rs`). It is **not** consumed by `WaveformPanel` (which reads the hist-rate rings) and is **not changed** by this spec. Noted only to prevent confusion about why two waveform data paths exist.

## Files to modify

| File | Change |
|------|--------|
| `src-tauri/src/ipc/types.rs` | Add flat `waveform_sub_pairs: Vec<f32>` + `waveform_sub_count: u32` to `MeterHistoryEntry` |
| `src-tauri/src/engine/meter_pipeline.rs` | Add flat sub-block accumulator (`SUBBLOCK_SAMPLES = 256`) folded into the existing per-sample scan; emit flat sub-pairs + count on history tick; clear/reuse buffer |
| `src/ipc/types.js` | Add `waveformSubPairs` (flat) + `waveformSubCount` to typedef |
| `src/lib/FrameIntake.js` | Add `_waveformSubRing` capped at `histMaxSamples` (full 2 h); store flat `Float32Array` per entry; add `getWaveformSubRing()` |
| `src/App.jsx` / `AudioDataContext` | Surface the sub-pair ring (e.g. `waveformSubList`) on context |
| `src/math/waveformMath.js` | Replace `sliceWaveformHistory` with `sliceWaveformSubHistory` (entry-index + intra-tick fraction decimation) |
| `src/math/waveformMath.test.js` | Smoothness + wide-zoom continuity tests |
| `src/components/panels/WaveformPanel.jsx` | Use new slice function; pass `canvasWidth` and `waveformSubList` |
| `src/math/hoverMath.js` | Update `computeWaveformHoverPoint` for sub-pair precision |
| `src/math/hoverMath.test.js` | Update tests |

## Out of scope

- RMS energy band inside the envelope (separate future spec).
- REAPER-style display modes (LUFS overlay, spectrogram, spectral coloring).
- Changing the visual style from filled envelope to classic DAW vertical-line waveform.
- Decoupling Waveform time axis from Loudness History.
- Zoom below 5 seconds.
- Per-channel color override.
