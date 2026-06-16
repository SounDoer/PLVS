# Waveform Sub-Block Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Waveform panel render a smooth amplitude envelope at the 5-second max zoom by carrying ~19 per-channel sub-block min/max pairs per ~100 ms history tick, kept for the full 2-hour history ring.

**Architecture:** The Rust meter pipeline already scans every PCM sample for the whole-tick min/max; fold a 256-sample sub-block accumulator into that same loop and emit a flat `Vec<f32>` of `(min,max)` pairs plus a count on each history tick. The frontend stores those flat pairs (as a `Float32Array`) on the existing hist-rate row (same 2-hour lifetime as every other panel), and a new pure decimation function buckets the visible sub-pairs into fixed per-pixel columns for rendering.

**Tech Stack:** Rust (Tauri backend, `cargo test`), JavaScript/React (Vite + Vitest), serde camelCase IPC.

**Spec:** `docs/working/superpowers/specs/2026-06-15-waveform-subblock-precision.md` (v3)

**Note on a deliberate simplification vs the spec:** the spec described a separate `_waveformSubRing`. This plan instead stores `waveformSubPairs`/`waveformSubCount` on the **existing** `_loudnessHist` row (which is already capped at `histMaxSamples` and already surfaced to `WaveformPanel` as `histSourceList`). Same 2-hour lifetime, less plumbing, no new `AudioDataContext` field.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src-tauri/src/ipc/types.rs` | IPC struct | Add two fields to `MeterHistoryEntry` |
| `src-tauri/src/engine/meter_pipeline.rs` | PCM → meters | Sub-block accumulator + emit |
| `src/ipc/types.js` | JSDoc typedef | Document the two new fields |
| `src/lib/FrameIntake.js` | Ring buffers | Store sub-pairs on the hist row as a `Float32Array` |
| `src/math/waveformMath.js` | Pure decimation | Replace `sliceWaveformHistory` with `sliceWaveformSubHistory` |
| `src/math/waveformMath.test.js` | Tests | Replace with sub-history tests |
| `src/math/hoverMath.js` | Hover readout | Column-indexed dBFS + xFrac-based time |
| `src/math/hoverMath.test.js` | Tests | Add waveform-hover test |
| `src/components/panels/WaveformPanel.jsx` | Render | Use new slice fn; even-spaced lane draw |

**Task order (dependencies):** 1 (Rust) → 2 (FrameIntake) → 3 (waveformMath) → 4 (hoverMath) → 5 (WaveformPanel wiring).

---

### Task 1: Rust — emit sub-block min/max pairs

**Files:**
- Modify: `src-tauri/src/ipc/types.rs:36-64` (`MeterHistoryEntry`)
- Modify: `src-tauri/src/engine/meter_pipeline.rs` (struct fields ~53-82, `new` ~104-108, `clear_peak_and_history` ~132-135, scan loop ~229-254, emit ~313-349)
- Test: `src-tauri/src/engine/meter_pipeline.rs` (`#[cfg(test)]` module)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `meter_pipeline.rs` (after `history_entry_captures_waveform_min_max_per_channel`):

```rust
  #[test]
  fn history_entry_captures_sub_block_pairs() {
    let sr = 48_000_u32;
    let channels = 2_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);

    // 200ms of a 100Hz sine on L, inverted on R, amplitude 0.7
    let frames = sr as usize / 5;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 100.0 * i as f64 / sr as f64).sin() as f32 * 0.7;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = -s;
    }

    let mut entries = Vec::new();
    for _ in 0..5 {
      let frame = pipeline.push_pcm_f32(
        &pcm,
        (0, 1),
        ChannelLayoutSetting::Auto,
        SpectrumChannelSel::default(),
        SpectrumView::default(),
        None,
        false,
      );
      if let Some(tick) = frame.and_then(|f| f.loudness_hist_tick) {
        entries.push(tick);
      }
    }

    assert!(!entries.is_empty(), "must emit at least one history entry");
    let e = &entries[0];
    let stride = 2 * channels as usize;
    assert!(e.waveform_sub_count >= 10, "expected many sub-blocks, got {}", e.waveform_sub_count);
    assert_eq!(
      e.waveform_sub_pairs.len(),
      e.waveform_sub_count as usize * stride,
      "flat length == sub_count * 2 * channels"
    );
    // Every value must be finite (sentinels mapped to 0.0).
    assert!(e.waveform_sub_pairs.iter().all(|v| v.is_finite()));
    // Some sub-block on L must capture a positive peak near 0.7.
    let l_max = e
      .waveform_sub_pairs
      .chunks(stride)
      .map(|c| c[1])
      .fold(f32::NEG_INFINITY, f32::max);
    assert!(l_max > 0.5, "L sub-block max should capture the peak, got {l_max}");
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml history_entry_captures_sub_block_pairs`
Expected: FAIL to compile — `no field waveform_sub_count on MeterHistoryEntry`.

- [ ] **Step 3: Add the two IPC fields**

In `src-tauri/src/ipc/types.rs`, after the `waveform_max` field (line 63) inside `MeterHistoryEntry`:

```rust
  /// Per-channel sub-block (min, max) pairs over this ~100ms window, flat row-major:
  /// [min_ch0, max_ch0, min_ch1, max_ch1, ...] per sub-block. Stride = 2 * channel_count.
  pub waveform_sub_pairs: Vec<f32>,
  /// Number of sub-blocks in this tick. Equals waveform_sub_pairs.len() / (2 * channel_count).
  pub waveform_sub_count: u32,
```

- [ ] **Step 4: Add the accumulator fields + constant**

In `meter_pipeline.rs`, add the constant near the top (after line 20):

```rust
/// PCM samples per waveform sub-block. ~19 sub-blocks per ~100ms tick @48kHz.
const SUBBLOCK_SAMPLES: usize = 256;
```

Add these struct fields after `waveform_max_acc` (line 75):

```rust
  /// Flat row-major sub-block (min, max) pairs accumulated since the last history tick:
  /// [min_ch0, max_ch0, ...] per completed sub-block. Reused across ticks (taken on emit).
  waveform_sub_acc: Vec<f32>,
  /// Sample counter within the in-progress sub-block (0..SUBBLOCK_SAMPLES).
  waveform_sub_idx: usize,
  /// Running per-channel (min, max) for the in-progress sub-block, flat, len = 2 * channels.
  waveform_sub_cur: Vec<f32>,
```

In `new` (after `waveform_max_acc` init, line 105) add:

```rust
      waveform_sub_acc: Vec::new(),
      waveform_sub_idx: 0,
      waveform_sub_cur: {
        let ch = channels.max(1) as usize;
        let mut v = vec![0.0_f32; 2 * ch];
        for c in 0..ch {
          v[2 * c] = f32::INFINITY;
          v[2 * c + 1] = f32::NEG_INFINITY;
        }
        v
      },
```

In `clear_peak_and_history` (after line 133, the `waveform_max_acc.fill`):

```rust
    self.waveform_sub_acc.clear();
    self.waveform_sub_idx = 0;
    for c in 0..(self.channels.max(1) as usize) {
      self.waveform_sub_cur[2 * c] = f32::INFINITY;
      self.waveform_sub_cur[2 * c + 1] = f32::NEG_INFINITY;
    }
```

- [ ] **Step 5: Fold the sub-block update into the per-sample scan loop**

In `push_pcm_f32`, the existing loop is `for f in 0..frames_count { let base = ...; for c in 0..ch_usize { ... } }` (lines 232-254). Add, **immediately after** the inner `for c` loop closes (i.e. once per frame), still inside `for f`:

```rust
      for c in 0..ch_usize {
        if 2 * c + 1 < self.waveform_sub_cur.len() {
          let s = interleaved[base + c];
          if s < self.waveform_sub_cur[2 * c] {
            self.waveform_sub_cur[2 * c] = s;
          }
          if s > self.waveform_sub_cur[2 * c + 1] {
            self.waveform_sub_cur[2 * c + 1] = s;
          }
        }
      }
      self.waveform_sub_idx += 1;
      if self.waveform_sub_idx >= SUBBLOCK_SAMPLES {
        self.waveform_sub_acc.extend_from_slice(&self.waveform_sub_cur);
        for c in 0..ch_usize {
          self.waveform_sub_cur[2 * c] = f32::INFINITY;
          self.waveform_sub_cur[2 * c + 1] = f32::NEG_INFINITY;
        }
        self.waveform_sub_idx = 0;
      }
```

- [ ] **Step 6: Drain into the emitted entry**

In the `loudness_hist_tick` block, right after the existing `self.waveform_max_acc.fill(f32::NEG_INFINITY);` (line 325) and **before** `let entry = MeterHistoryEntry {`:

```rust
      // Flush the final incomplete sub-block so no samples are lost.
      if self.waveform_sub_idx > 0 {
        self.waveform_sub_acc.extend_from_slice(&self.waveform_sub_cur);
        for c in 0..ch_usize {
          self.waveform_sub_cur[2 * c] = f32::INFINITY;
          self.waveform_sub_cur[2 * c + 1] = f32::NEG_INFINITY;
        }
        self.waveform_sub_idx = 0;
      }
      let stride = 2 * ch_usize;
      let waveform_sub_count = if stride > 0 {
        (self.waveform_sub_acc.len() / stride) as u32
      } else {
        0
      };
      let mut waveform_sub_pairs = std::mem::take(&mut self.waveform_sub_acc);
      for v in waveform_sub_pairs.iter_mut() {
        if !v.is_finite() {
          *v = 0.0;
        }
      }
```

Then add the two fields to the `MeterHistoryEntry { ... }` literal (after `waveform_max,` on line 348):

```rust
        waveform_sub_pairs,
        waveform_sub_count,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml history_entry_captures_sub_block_pairs`
Expected: PASS.

- [ ] **Step 8: Run the full Rust suite + clippy**

Run: `npm run rust:test` then `npm run rust:clippy`
Expected: all pass, no clippy warnings.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/ipc/types.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(waveform): emit per-channel sub-block min/max pairs from meter pipeline"
```

---

### Task 2: Frontend — store sub-pairs on the hist row

**Files:**
- Modify: `src/ipc/types.js:19-21` (typedef)
- Modify: `src/lib/FrameIntake.js` (module const ~57, `pushHistRow` 117-127)
- Test: `src/lib/FrameIntake.test.js`

- [ ] **Step 1: Write the failing test**

Add to `FrameIntake.test.js` (inside the existing top-level `describe`, near the other `pushHistRow` tests). First check the existing `makeRow` helper there and pass the new fields through it; if `makeRow` spreads its argument, this works as written:

```js
  it("pushHistRow stores waveform sub-pairs as a Float32Array on the row", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(
      makeRow({ waveformSubPairs: [-0.5, 0.5, -0.3, 0.3], waveformSubCount: 1 }),
      HIST_MAX,
      SR
    );
    const [row] = intake.getLoudnessHistory();
    expect(row.waveformSubCount).toBe(1);
    expect(row.waveformSubPairs).toBeInstanceOf(Float32Array);
    expect(Array.from(row.waveformSubPairs)).toEqual([-0.5, 0.5, -0.3, 0.3]);
  });

  it("pushHistRow defaults sub-pairs to an empty Float32Array when absent", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    const [row] = intake.getLoudnessHistory();
    expect(row.waveformSubPairs).toBeInstanceOf(Float32Array);
    expect(row.waveformSubPairs).toHaveLength(0);
    expect(row.waveformSubCount).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: FAIL — `row.waveformSubPairs` is `undefined`.

- [ ] **Step 3: Add a shared empty constant**

In `FrameIntake.js`, after the `ringPush` function (line 57):

```js
const EMPTY_F32 = new Float32Array(0);
```

- [ ] **Step 4: Store the fields on the hist row**

In `pushHistRow`, extend the object pushed to `this._loudnessHist` (lines 119-125) so it reads:

```js
      {
        m: hm,
        st: hst,
        waveformMin: row.waveformMin ?? [],
        waveformMax: row.waveformMax ?? [],
        waveformSubPairs: row.waveformSubPairs ? Float32Array.from(row.waveformSubPairs) : EMPTY_F32,
        waveformSubCount: row.waveformSubCount ?? 0,
        timestampMs: row.timestampMs,
      },
```

- [ ] **Step 5: Update the JSDoc typedef**

In `src/ipc/types.js`, after the `waveformMax` line (line 21):

```js
 * @property {Float32Array|number[]} waveformSubPairs flat, stride 2*channelCount: [minCh0,maxCh0,...] per sub-block
 * @property {number} waveformSubCount sub-blocks in this tick
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ipc/types.js src/lib/FrameIntake.js src/lib/FrameIntake.test.js
git commit -m "feat(waveform): carry sub-block pairs on the hist-rate ring as Float32Array"
```

---

### Task 3: Pure decimation — `sliceWaveformSubHistory`

**Files:**
- Modify: `src/math/waveformMath.js` (replace `sliceWaveformHistory`)
- Test: `src/math/waveformMath.test.js` (replace contents)

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/math/waveformMath.test.js` with:

```js
import { describe, it, expect } from "vitest";
import { sliceWaveformSubHistory, WAVEFORM_DECIM_COLUMNS } from "./waveformMath.js";

// Build an entry whose sub-blocks ramp from -amp..+amp across `subCount` blocks,
// single channel.
function rampEntry(subCount, amp) {
  const pairs = new Float32Array(subCount * 2);
  for (let s = 0; s < subCount; s++) {
    const v = amp * ((s + 1) / subCount);
    pairs[s * 2] = -v;
    pairs[s * 2 + 1] = v;
  }
  return { waveformSubPairs: pairs, waveformSubCount: subCount, waveformMin: [-amp], waveformMax: [amp] };
}

describe("sliceWaveformSubHistory", () => {
  it("returns zero-filled column arrays of length WAVEFORM_DECIM_COLUMNS for empty input", () => {
    const r = sliceWaveformSubHistory([], 100, 0, 2);
    expect(r.columns).toBe(WAVEFORM_DECIM_COLUMNS);
    expect(r.mins).toHaveLength(2);
    expect(r.maxes[0]).toHaveLength(WAVEFORM_DECIM_COLUMNS);
    expect(r.maxes[0].every((v) => v === 0)).toBe(true);
  });

  it("produces a smooth curve — far more distinct levels than the ~50 history ticks", () => {
    // 50 entries (5s @10Hz), each 19 sub-blocks ramping → ~950 distinct sub-pairs.
    const entries = Array.from({ length: 50 }, () => rampEntry(19, 0.8));
    const r = sliceWaveformSubHistory(entries, 50, 0, 1);
    expect(r.maxes[0]).toHaveLength(WAVEFORM_DECIM_COLUMNS);
    // The old whole-tick path would yield <= 50 distinct values; sub-blocks must beat that.
    const distinct = new Set(r.maxes[0]).size;
    expect(distinct).toBeGreaterThan(100);
  });

  it("has no empty interior gaps — every interior column carries data", () => {
    const entries = Array.from({ length: 50 }, () => rampEntry(19, 0.8));
    const r = sliceWaveformSubHistory(entries, 50, 0, 1);
    // With a full window, the last column must be data, not the initial 0 fill.
    expect(r.maxes[0][WAVEFORM_DECIM_COLUMNS - 1]).toBeGreaterThan(0);
  });

  it("falls back to whole-tick min/max for entries lacking sub-pairs", () => {
    const entries = [
      { waveformMin: [-0.4], waveformMax: [0.4] }, // no sub-pairs
      { waveformMin: [-0.9], waveformMax: [0.9] },
    ];
    const r = sliceWaveformSubHistory(entries, 2, 0, 1);
    expect(r.maxes[0]).toHaveLength(WAVEFORM_DECIM_COLUMNS);
    const peak = Math.max(...r.maxes[0]);
    expect(peak).toBeCloseTo(0.9, 5);
  });

  it("respects effectiveOffsetSamples — skips the most-recent entries", () => {
    const entries = [rampEntry(19, 0.2), rampEntry(19, 0.5), rampEntry(19, 0.9)];
    const skipNewest = sliceWaveformSubHistory(entries, 10, 1, 1); // exclude last (0.9)
    expect(Math.max(...skipNewest.maxes[0])).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/math/waveformMath.test.js`
Expected: FAIL — `sliceWaveformSubHistory is not a function`.

- [ ] **Step 3: Implement the decimation function**

Replace the entire contents of `src/math/waveformMath.js` with:

```js
/**
 * Number of output columns the waveform is decimated to. Chosen ≥ the widest
 * realistic panel pixel width so each column maps to ~1 screen pixel at any zoom.
 */
export const WAVEFORM_DECIM_COLUMNS = 1000;

/**
 * Decimate the visible sub-block history into fixed per-column min/max arrays.
 *
 * Positioning is entry-index based (NOT wall-clock): a sub-pair sits at
 * (entryPosInWindow + subIndex/subCount) / (windowSamples-1), matching the
 * index-based axis the Loudness History chart uses.
 *
 * @param {{waveformSubPairs?: Float32Array|number[], waveformSubCount?: number, waveformMin?: number[], waveformMax?: number[]}[]} histSourceList
 * @param {number} visibleSamples       window width in history entries
 * @param {number} effectiveOffsetSamples entries to skip from the live edge (0 = live)
 * @param {number} channelCount
 * @param {number} [columns]            output column count (default WAVEFORM_DECIM_COLUMNS)
 * @returns {{ mins: number[][], maxes: number[][], columns: number }}
 */
export function sliceWaveformSubHistory(
  histSourceList,
  visibleSamples,
  effectiveOffsetSamples,
  channelCount,
  columns = WAVEFORM_DECIM_COLUMNS
) {
  const mins = Array.from({ length: channelCount }, () => new Array(columns).fill(0));
  const maxes = Array.from({ length: channelCount }, () => new Array(columns).fill(0));

  const total = histSourceList.length;
  if (total === 0) return { mins, maxes, columns };

  const windowSamples = Math.max(1, visibleSamples);
  const offSamples = Math.max(0, Math.min(Math.max(0, total - 1), effectiveOffsetSamples));
  const newestVisible = total - 1 - offSamples;
  const oldestVisible = newestVisible - windowSamples + 1; // may be negative (leading empty)
  const start = Math.max(0, oldestVisible);
  const end = Math.min(total - 1, newestVisible);
  if (end < start) return { mins, maxes, columns };

  const denom = windowSamples - 1 <= 0 ? 1 : windowSamples - 1;
  const hasData = new Array(columns).fill(false);

  const fold = (col, ch, mn, mx) => {
    if (!hasData[col]) {
      mins[ch][col] = mn;
      maxes[ch][col] = mx;
    } else {
      if (mn < mins[ch][col]) mins[ch][col] = mn;
      if (mx > maxes[ch][col]) maxes[ch][col] = mx;
    }
  };
  const colFor = (frac) => {
    let c = Math.round(frac * (columns - 1));
    if (c < 0) c = 0;
    else if (c >= columns) c = columns - 1;
    return c;
  };

  for (let e = start; e <= end; e++) {
    const row = histSourceList[e];
    const entryPos = e - oldestVisible; // 0..windowSamples-1
    const pairs = row.waveformSubPairs;
    const subCount = row.waveformSubCount | 0;
    const stride = 2 * channelCount;

    if (pairs && subCount > 0 && pairs.length >= subCount * stride) {
      for (let s = 0; s < subCount; s++) {
        const frac = (entryPos + (subCount > 1 ? s / subCount : 0)) / denom;
        const col = colFor(frac);
        const base = s * stride;
        for (let ch = 0; ch < channelCount; ch++) {
          fold(col, ch, pairs[base + ch * 2], pairs[base + ch * 2 + 1]);
        }
        hasData[col] = true;
      }
    } else {
      // Fallback: one point per entry from whole-tick bounds.
      const col = colFor(entryPos / denom);
      const wmin = row.waveformMin ?? [];
      const wmax = row.waveformMax ?? [];
      for (let ch = 0; ch < channelCount; ch++) {
        fold(col, ch, wmin[ch] ?? 0, wmax[ch] ?? 0);
      }
      hasData[col] = true;
    }
  }

  // Carry-forward across empty interior columns so the envelope stays continuous.
  const firstCol = hasData.indexOf(true);
  const lastCol = hasData.lastIndexOf(true);
  if (firstCol >= 0) {
    for (let c = firstCol + 1; c <= lastCol; c++) {
      if (!hasData[c]) {
        for (let ch = 0; ch < channelCount; ch++) {
          mins[ch][c] = mins[ch][c - 1];
          maxes[ch][c] = maxes[ch][c - 1];
        }
      }
    }
  }

  return { mins, maxes, columns };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/math/waveformMath.test.js`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/math/waveformMath.js src/math/waveformMath.test.js
git commit -m "feat(waveform): add sub-block pixel decimation (sliceWaveformSubHistory)"
```

---

### Task 4: Hover readout — column-indexed dBFS

**Files:**
- Modify: `src/math/hoverMath.js:102-124` (`computeWaveformHoverPoint`)
- Test: `src/math/hoverMath.test.js`

- [ ] **Step 1: Write the failing test**

Add to `hoverMath.test.js` (create a `describe("computeWaveformHoverPoint", ...)` block; import it alongside the existing imports):

```js
import { computeWaveformHoverPoint } from "./hoverMath.js";

describe("computeWaveformHoverPoint", () => {
  it("reads dBFS from the column under xFrac and time from the window", () => {
    const columns = 1000;
    const maxes = [new Array(columns).fill(0)];
    const mins = [new Array(columns).fill(0)];
    maxes[0][columns - 1] = 1.0; // right edge = 0 dBFS

    const r = computeWaveformHoverPoint(1, mins, maxes, columns, 0, 50, 0.1, ["L"]);
    expect(r.channels[0].dbFs).toBeCloseTo(0, 3);
    // xFrac=1 → newest → 0s ago (offset 0, right edge).
    expect(r.timeLabel).toBe("0.0s ago");
    expect(r.leftPct).toBe(100);
  });

  it("returns null for empty columns", () => {
    expect(computeWaveformHoverPoint(0.5, [[]], [[]], 0, 0, 50, 0.1, ["L"])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/hoverMath.test.js`
Expected: FAIL — current `timeLabel` math uses `columns` as if it were entries, so the time is wrong (not `"0.0s ago"`).

- [ ] **Step 3: Rewrite `computeWaveformHoverPoint`**

Replace the function (lines 89-124) with:

```js
/**
 * Resolves the hover data for the waveform panel from a normalized X fraction.
 * dBFS is read from the decimated column under xFrac; the time label derives from
 * xFrac across the visible window (decoupled from the column count).
 *
 * @param {number} xFrac - normalized X (0 = left/oldest, 1 = right/newest)
 * @param {number[][]} mins - mins[ch][col] linear amplitude min
 * @param {number[][]} maxes - maxes[ch][col] linear amplitude max
 * @param {number} columns - number of decimated columns (mins[ch].length)
 * @param {number} effectiveOffsetSamples - entries the window is offset from the live edge
 * @param {number} visibleSamples - window width in entries
 * @param {number} sampleSec - seconds per history entry
 * @param {string[]} labels - channel labels
 * @returns {{ leftPct: number, timeLabel: string, channels: Array<{ label: string, dbFs: number }> } | null}
 */
export function computeWaveformHoverPoint(
  xFrac,
  mins,
  maxes,
  columns,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec,
  labels
) {
  if (!columns || columns === 0) return null;
  const col = Math.round(xFrac * Math.max(0, columns - 1));
  const offsetFromEnd = effectiveOffsetSamples + (1 - xFrac) * Math.max(0, visibleSamples - 1);
  const offsetSec = Math.max(0, offsetFromEnd * sampleSec);
  return {
    leftPct: xFrac * 100,
    timeLabel: formatHoverOffset(offsetSec),
    channels: labels.map((label, ch) => ({
      label,
      dbFs: 20 * Math.log10(Math.max(1e-9, Math.abs(maxes[ch]?.[col] ?? 0))),
    })),
  };
}
```

(`mins` stays in the signature for call-site symmetry and future min-side readouts; it is intentionally unused here. If the linter flags it, prefix with `_mins`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/math/hoverMath.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/math/hoverMath.js src/math/hoverMath.test.js
git commit -m "feat(waveform): column-indexed hover dBFS with window-based time label"
```

---

### Task 5: Wire the panel to the new decimation

**Files:**
- Modify: `src/components/panels/WaveformPanel.jsx` (imports 7-10, slice call 49-54, hover call 60-73, lane props 90-101, `WaveformLane` 214-302)
- Test: manual verification (canvas rendering is not unit-tested; `WaveformPanel.test.jsx` must still pass)

- [ ] **Step 1: Swap the slice import and call**

In `WaveformPanel.jsx`, change line 7:

```js
import { sliceWaveformSubHistory } from "../../math/waveformMath.js";
```

Replace the `sliceWaveformHistory(...)` call (lines 49-54) with:

```js
  const { mins, maxes, columns } = sliceWaveformSubHistory(
    histSourceList ?? [],
    visibleSamples ?? 0,
    effectiveOffsetSamples ?? 0,
    effectiveChannels
  );
```

- [ ] **Step 2: Update the hover call**

Replace the `computeWaveformHoverPoint(...)` arguments (lines 62-72) so `columns` replaces `entryCount`:

```js
      ? computeWaveformHoverPoint(
          xFrac,
          mins,
          maxes,
          columns,
          effectiveOffsetSamples ?? 0,
          visibleSamples ?? 0,
          HIST_SAMPLE_SEC,
          labels
        )
```

- [ ] **Step 3: Update the lane props**

Replace the `<WaveformLane .../>` props (lines 91-100) so the lane gets the column count instead of `entryCount`/`leadingEmptySamples`/`windowSamples`:

```jsx
          <WaveformLane
            key={ch}
            label={labels[ch] ?? `Ch${ch + 1}`}
            mins={mins[ch]}
            maxes={maxes[ch]}
            columns={columns}
            compact={compact}
          />
```

- [ ] **Step 4: Update `WaveformLane` to draw evenly-spaced columns**

Change the `WaveformLane` signature (line 214-222) to:

```jsx
function WaveformLane({ label, mins, maxes, columns, compact }) {
```

Replace the envelope-building block (lines 269-301) with even-spaced columns (no `leadingEmptySamples`):

```js
    if (!columns || !mins?.length) return;

    const denom = Math.max(1, columns - 1);
    const xForCol = (i) => (i / denom) * W;
    ctx.beginPath();
    for (let i = 0; i < columns; i++) {
      const x = xForCol(i);
      const y = cy - maxes[i] * cy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = columns - 1; i >= 0; i--) {
      const x = xForCol(i);
      const y = cy - mins[i] * cy;
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Fill
    ctx.globalAlpha = fillOpacity;
    ctx.fillStyle = strokeColor;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stroke the envelope outline
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = window.devicePixelRatio || 1;
    ctx.stroke();
```

Update the redraw effect dependency array (line 302) to `[mins, maxes, columns, canvasSize]`.

- [ ] **Step 5: Run the JS suite**

Run: `npx vitest run src/components/panels/WaveformPanel.test.jsx src/math/waveformMath.test.js src/math/hoverMath.test.js src/lib/FrameIntake.test.js`
Expected: PASS. (`WaveformPanel.test.jsx` supplies `histSourceList: []`; the new code returns zero-filled arrays and the lane early-returns when the canvas context is unavailable in jsdom.)

- [ ] **Step 6: Full check + manual verification**

Run: `npm test`
Expected: PASS.

Then run the app (`npm run desktop`), play voice/music, and confirm: at the 5-second max zoom the waveform is a smooth envelope (no ~8 px stair-steps), scrubbing/panning stays aligned with the Loudness History chart, and hover dBFS tracks the curve.

- [ ] **Step 7: Commit**

```bash
git add src/components/panels/WaveformPanel.jsx
git commit -m "feat(waveform): render pixel-decimated sub-block envelope"
```

---

## Self-Review

**Spec coverage:**
- Sub-block granularity 256 / ~19/tick → Task 1 (`SUBBLOCK_SAMPLES = 256`).
- Flat Rust `Vec<f32>` + count, folded into existing scan, partial flush, sentinel→0 → Task 1.
- 2-hour retention (same ring) → Task 2 (stored on `_loudnessHist`, capped at `histMaxSamples`).
- Flat `Float32Array` storage → Task 2.
- Entry-index + intra-tick fraction positioning (not wall-clock) → Task 3 (`(entryPos + s/subCount)/denom`).
- Per-pixel decimation with carry-forward → Task 3.
- Acceptance test (smoothness, distinct levels, continuity, fallback) → Task 3.
- Hover precision → Task 4.
- Rendering wiring → Task 5.
- `VisualHistEntry` untouched → not modified by any task. ✓
- Out of scope (RMS, display modes) → no task. ✓

**Placeholder scan:** none — every code step contains complete code and exact commands.

**Type consistency:** `waveform_sub_pairs: Vec<f32>` / `waveform_sub_count: u32` (Rust) ↔ `waveformSubPairs: Float32Array` / `waveformSubCount: number` (JS). `sliceWaveformSubHistory` returns `{ mins, maxes, columns }`; `WaveformPanel` destructures exactly those; `WaveformLane` takes `{ mins, maxes, columns }`; `computeWaveformHoverPoint` 4th arg is `columns`. Consistent across tasks.
