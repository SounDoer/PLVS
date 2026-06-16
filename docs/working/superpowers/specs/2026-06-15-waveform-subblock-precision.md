# Waveform Sub-Block Precision Upgrade

**Date:** 2026-06-15
**Status:** Draft (v2 — revised after code review on 2026-06-16)

> **v2 changes:** corrected the frontend memory model (the history ring holds
> ~72 000 entries ≈ 1.9 h, not 60 s, and nested JS arrays carry large overhead);
> sub-pairs are now retained in a **separate bounded short ring** with **flat
> `Float32Array`** storage; Rust accumulators use a **flat layout** instead of
> `Vec<Vec<(f32, f32)>>`; horizontal positioning is **entry-index based**, not
> wall-clock timestamp; default sub-block size raised to **512** as an explicit
> cost knob; added an acceptance test and a note on the parallel `VisualHistEntry`
> path.

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

Within each ~100ms history tick, the PCM block is divided into **sub-blocks of 512 samples** (`SUBBLOCK_SAMPLES`). At 48 kHz this gives ~10.7 ms per sub-block, producing ~94 sub-blocks per tick. Each sub-block yields one `(min, max)` pair per channel.

```
One ~100ms history tick (4800 samples @48kHz, stereo):

sub-block 0     sub-block 1          sub-block 93
[512 samples]   [512 samples]  ...   [512 samples]
   → (min,max)L    → (min,max)L          → (min,max)L
   → (min,max)R    → (min,max)R          → (min,max)R
```

**Sub-block size is the primary cost knob.** It trades fidelity against
bandwidth and memory linearly. Sizing target: at the 5 s max zoom on a 400 px
canvas we need ≥ 400 columns / 5 s = 80 sub-pairs/s to fill every pixel; on an
800 px canvas, 160/s. 512 samples gives ~94/tick = ~940/s — ~11× oversampling at
400 px, ~6× at 800 px — smooth with comfortable headroom while roughly halving
the data of a 256-sample block. Drop to 256 only if a future wider panel or
deeper zoom needs it.

### Rust: `MeterHistoryEntry` new field

Use a **flat, row-major layout** rather than `Vec<Vec<(f32, f32)>>`. The nested
form allocates ~94 small inner vecs per tick (×10/s) on the audio-adjacent path
and serializes as nested arrays; a flat `Vec<f32>` with a known stride avoids the
allocation churn and is cheaper to (de)serialize and to map onto a frontend
`Float32Array`.

```rust
/// Per-channel sub-block (min, max) pairs within this ~100ms history window,
/// flattened row-major. Layout per sub-block: [min_ch0, max_ch0, min_ch1, max_ch1, ...].
/// Stride = 2 * channel_count. Length = sub_block_count * stride.
/// At 48 kHz with 512-sample sub-blocks, ~94 sub-blocks per tick.
pub waveform_sub_pairs: Vec<f32>,
/// Number of sub-blocks in this tick (so the frontend can recover the stride
/// without dividing by a possibly-zero channel count). Equals
/// waveform_sub_pairs.len() / (2 * channel_count).
pub waveform_sub_count: u32,
```

The existing `waveform_min: Vec<f32>` and `waveform_max: Vec<f32>` fields are
**retained** as whole-tick aggregates. Their role is now the **downgrade
representation for old history**: only the most recent window keeps full
sub-block detail (see *Frontend memory* below), and everything older falls back
to these per-tick bounds, which the spec's own motivation table shows are already
smooth at ≥ 60 s windows. They are not kept for IPC version compatibility — Rust
and JS ship together, so no version skew exists.

### Rust: `meter_pipeline.rs` accumulator

Keep the existing whole-tick scalar accumulators (`waveform_min_acc` /
`waveform_max_acc`) — they still feed the retained per-tick bounds. Add a flat
sub-block accumulator alongside them:

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

Constants:
```rust
const SUBBLOCK_SAMPLES: usize = 512;
```

In `push_pcm_f32`, fold the sub-block update into the existing per-sample scan
loop (it already visits every sample for the whole-tick min/max):
- For each sample, update `waveform_sub_cur[2*ch]` (min) / `waveform_sub_cur[2*ch+1]` (max).
- When `waveform_sub_idx` reaches `SUBBLOCK_SAMPLES`, append `waveform_sub_cur`
  to `waveform_sub_acc` via `extend_from_slice`, reset each pair to
  `(INFINITY, NEG_INFINITY)`, and reset the index. No per-sub-block heap
  allocation occurs.
- On history tick emit, move `waveform_sub_acc` into
  `MeterHistoryEntry.waveform_sub_pairs` (`std::mem::take`), set
  `waveform_sub_count`, and `clear()` the accumulator for reuse.

Edge case: the final incomplete sub-block at the tick boundary is flushed as-is
(fewer than `SUBBLOCK_SAMPLES` samples) so no data is lost. Mirror the existing
INFINITY/NEG_INFINITY → 0.0 sentinel mapping used for the whole-tick bounds.

### Bandwidth & memory

**IPC bandwidth (stereo, ~94 sub-blocks/tick @512 samples, 10 ticks/s):**

```
94 sub-blocks × 2 channels × 2 values × 4 bytes = 1 504 bytes/tick
× 10 ticks/s = ~15 kB/s
```

For 7.1 (8 channels): `94 × 8 × 2 × 4 × 10 = ~60 kB/s`. Still negligible.

**Frontend memory — the part v1 got wrong.**

Two facts make the naive estimate off by ~2–3 orders of magnitude:

1. **The history ring is not 60 s.** `HIST_MAX_SAMPLES = 72000` (`App.jsx`), i.e.
   ~72 000 entries ≈ **1.9 hours** at 10 Hz, not 600 entries.
2. **Nested JS arrays are not byte-packed.** A `[min, max]` array in V8 costs
   ~32–64 B, not 8 B. Storing `number[][][]` for every ring entry would mean,
   stereo: `72 000 × 94 × 2 ch ≈ 13.5 M` small arrays × ~40 B ≈ **~0.5 GB** (×4
   for 7.1). Unworkable.

**Fix — bounded short ring + `Float32Array`:**

Sub-block precision only matters while zoomed in (≤ ~10 s); the retained
whole-tick bounds are already smooth at wider windows. So full sub-pairs are kept
**only for the most recent `SUBPAIR_RING_SEC` of history** in a *separate* ring,
stored as one flat `Float32Array` per entry (stride `2 * channelCount`). Older
entries carry only `waveform_min` / `waveform_max`.

With `SUBPAIR_RING_SEC = 120` (2 min — well beyond the 60 s default window and
the 5 s max zoom):

```
Per entry @512 samples: 94 × 2 ch × 2 × 4 B ≈ 1.5 kB  (flat Float32Array)
120 s × 10 ticks × 1.5 kB ≈ 1.8 MB (stereo)
```

For 7.1: ~7.2 MB. Bounded and constant regardless of session length — a long
session no longer grows sub-pair memory. (These numbers match what v1 *claimed*,
but now they actually hold, because retention is bounded and storage is packed.)

**Compared to alternatives:**
- Raw PCM (48 kHz × 2 ch × 4 bytes) = 384 kB/s — far higher, and unbounded.
- Sub-block min/max is a large compression vs raw PCM while preserving visual fidelity.

### Frontend: `FrameIntake.js` and `AudioDataContext`

**Do not** add `waveformSubPairs` to the main `histMaxSamples`-capped rings — that
ring is ~72 000 entries (see *Bandwidth & memory*). Instead add a **separate
bounded sub-pair ring** sized for the recent window only:

```js
const SUBPAIR_RING_LEN = 1200; // SUBPAIR_RING_SEC(120) × 10 Hz

// In pushHistRow, store the flat Float32Array (zero-copy from the IPC payload
// where possible) plus the per-entry sub-block count and timestamp for alignment:
ringPush(
  this._waveformSubRing,
  {
    pairs: row.waveformSubPairs ?? EMPTY_F32,   // Float32Array, stride = 2*ch
    subCount: row.waveformSubCount ?? 0,
    timestampMs: row.timestampMs,
  },
  SUBPAIR_RING_LEN
);
```

The whole-tick `waveformMin` / `waveformMax` continue to ride the existing
`_loudnessHist` ring unchanged, serving as the downgrade representation for
entries older than the sub-pair ring.

Expose the sub-pair ring via a new `getWaveformSubRing()` accessor and surface it
on `AudioDataContext` (e.g. `waveformSubList`) so `WaveformPanel` can read it
alongside `histSourceList`.

### Frontend: `WaveformPanel.jsx` rendering

The rendering changes from "one data point per history entry" to "per-pixel min/max decimation".

**Horizontal positioning is entry-index based, not wall-clock timestamp.** The
time axis is shared with Loudness History, which positions purely by entry index
(`xForEntry = (leadingEmptySamples + i) / denom`, see `WaveformPanel.jsx`).
History ticks are *not* evenly spaced in wall-clock time — `HIST_EMIT_MS` is gated
on loudness-block cadence — so decimating by `timestamp` would drift out of
alignment with the loudness chart. Instead, a sub-pair's x position is:

```
x_fraction(entryIndex, subIndex) =
    (leadingEmptySamples + entryIndex + subIndex / subCount) / denom
```

i.e. **entry index plus the sub-block's fractional position within its tick**.
This keeps every sub-pair locked to the same axis the loudness history uses, and
correctly handles the fractional scrub offset and the startup `leadingEmptySamples`.

Decimation:

1. Walk the visible entries. For each entry that exists in the sub-pair ring,
   emit its sub-pairs at `x_fraction(entryIndex, subIndex)`. For an entry **older
   than the sub-pair ring** (no sub-pairs), emit a single point per entry from
   its whole-tick `waveformMin` / `waveformMax` — the downgrade representation.
2. For each pixel column `px` (0..canvasWidth):
   - Take the global min of mins and global max of maxes of every sub-pair whose
     `x_fraction × W` falls in `[px, px+1)`.
   - If a column has no sub-pairs (wide zoom, sparse), carry the previous
     column's bounds so the envelope stays continuous.
   - Draw a vertical line from `cy - max * cy` to `cy - min * cy`.
3. Fill the region between min and max traces as before (or draw per-pixel vertical lines for the classic DAW look).

This is a **pixel-driven decimation** — data density dynamically matches pixel count. At 400px canvas width and 5s window:

```
400 px / 5s = 80 px/s needed
Sub-block rate ≈ 94/s × 50 entries / 5s = 940/s → ~11.75 sub-blocks per pixel → smooth
```

At 60s window the visible range mostly exceeds the 120 s sub-pair ring's reach
only for sessions longer than 2 min of scrollback; within the ring the density is
~94/s ÷ 6.67 px/s ≈ 14 sub-blocks per pixel — still smooth. Beyond the ring, the
whole-tick downgrade is already smooth at this width (per the motivation table).

Performance: for stereo at 400px, the per-pixel loop runs 400 iterations × 2 channels, each scanning ~12 sub-pairs at max zoom. Total well under ~10 k comparisons per frame — trivially fast for the existing ~10 Hz re-render cycle.

### `waveformMath.js` changes

Add a new function `sliceWaveformSubHistory` (keep `sliceWaveformHistory` — it
still serves the whole-tick downgrade path / older entries) that:
- Reads the bounded sub-pair ring plus the whole-tick `histSourceList` for the
  downgrade fallback.
- Decimates by **entry index + intra-tick fraction** (see rendering section),
  *not* wall-clock timestamp.
- Emits 2D arrays `mins[ch][px]`, `maxes[ch][px]` sized to `canvasWidth` instead
  of `entryCount`.

```js
export function sliceWaveformSubHistory(
  histSourceList,        // whole-tick bounds, for entries outside the sub-pair ring
  waveformSubList,       // bounded ring: { pairs: Float32Array, subCount, timestampMs }
  visibleSamples,
  effectiveOffsetSamples,
  channelCount,
  canvasWidth            // NEW: pixel count for decimation
) {
  // 1. Slice the visible entry range (same index math as sliceWaveformHistory).
  // 2. For each visible entry: if present in the sub-pair ring, place its
  //    sub-pairs at x = (leadingEmptySamples + i + sub/subCount) / denom;
  //    else place one point from waveformMin/waveformMax at the entry index.
  // 3. For each pixel column, compute min-of-mins and max-of-maxes; carry the
  //    previous column when empty.
  // 4. Return { mins, maxes, entryCount: canvasWidth }
}
```

### `ipc/types.js`

Add to the `MeterHistoryEntry` typedef (flat layout matching the Rust side):

```js
@property {Float32Array|number[]} waveformSubPairs
// flat row-major, stride = 2 * channelCount:
// [min_ch0, max_ch0, min_ch1, max_ch1, ...] per sub-block
@property {number} waveformSubCount   // sub-blocks in this tick
```

### `hoverMath.js` changes

`computeWaveformHoverPoint` currently maps `xFrac` to an entry index. With
sub-blocks it can map to the nearest sub-pair (within the ring) for more precise
dBFS readings, falling back to entry-level bounds outside the ring. Update
accordingly.

### Acceptance test

The smoothness goal needs a concrete check. In `waveformMath.test.js`: feed a
swept sine across a 5 s window at `canvasWidth = 400`, call
`sliceWaveformSubHistory`, and assert the returned `maxes[ch]` has length 400 and
**no long run of identical adjacent columns** (e.g. no value repeated across more
than ~3 consecutive pixels), proving the stair-stepping of the whole-tick path is
gone. Pair with a degenerate test: entries outside the sub-pair ring fall back to
the whole-tick bounds without throwing.

### Out of band: `VisualHistEntry`

A parallel 25 Hz waveform stream exists on `VisualHistEntry`
(`waveform_min`/`waveform_max`, `meter_pipeline.rs`). It is **not** consumed by
`WaveformPanel` (which reads `histSourceList`) and is **not changed** by this
spec. Noted only to prevent confusion about why two waveform data paths exist.

## Files to modify

| File | Change |
|------|--------|
| `src-tauri/src/ipc/types.rs` | Add flat `waveform_sub_pairs: Vec<f32>` + `waveform_sub_count: u32` to `MeterHistoryEntry` |
| `src-tauri/src/engine/meter_pipeline.rs` | Add flat sub-block accumulator (`SUBBLOCK_SAMPLES = 512`) folded into the existing per-sample scan; emit flat sub-pairs + count on history tick; clear/reuse buffer |
| `src/ipc/types.js` | Add `waveformSubPairs` (flat) + `waveformSubCount` to typedef |
| `src/lib/FrameIntake.js` | Add a separate bounded `_waveformSubRing` (`SUBPAIR_RING_LEN = 1200`) storing flat `Float32Array` per entry; add `getWaveformSubRing()`; leave the 72k whole-tick rings untouched |
| `src/App.jsx` / `AudioDataContext` | Surface the sub-pair ring (e.g. `waveformSubList`) on context |
| `src/math/waveformMath.js` | Add `sliceWaveformSubHistory` (entry-index + intra-tick fraction decimation, with whole-tick downgrade); keep `sliceWaveformHistory` |
| `src/math/waveformMath.test.js` | Add smoothness + downgrade-fallback tests |
| `src/components/panels/WaveformPanel.jsx` | Use new slice function; pass `canvasWidth` and `waveformSubList`; optionally per-pixel vertical-line rendering |
| `src/math/hoverMath.js` | Update `computeWaveformHoverPoint` for sub-pair precision with entry-level fallback |
| `src/math/hoverMath.test.js` | Update tests |

## Out of scope

- Changing the visual style from filled envelope to classic DAW vertical-line waveform (can be done later).
- Decoupling Waveform time axis from Loudness History.
- Zoom below 5 seconds.
- Per-channel color override.
