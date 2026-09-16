# Visual History Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple visual history (Waveform, Spectrogram, Spectrum, Vectorscope) from the loudness tick — running at 25 Hz with 2-hour depth — while Loudness/Peak history stays at 10 Hz.

**Architecture:** A new `visual_hist_tick` fires every 40 ms in the Rust `MeterPipeline`, independent of `loudness_hist_tick`. The frontend stores visual history in dedicated `RingBuffer` instances (O(1) push) inside `FrameIntake`. When scrubbing, panels read from visual history; Vectorscope stores 200 raw float pairs instead of SVG; Spectrum stores only `dbList` and reconstructs SVG on demand.

**Tech Stack:** Rust (Tauri), JavaScript/React, Vitest

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/RingBuffer.js` | O(1) circular ring buffer |
| Create | `src/lib/RingBuffer.test.js` | Unit tests |
| Create | `src/math/vectorscopeMath.js` | SVG reconstruction from float pairs |
| Create | `src/math/spectrumMath.js` | SVG reconstruction from dbList |
| Modify | `src-tauri/src/ipc/types.rs` | Add `VisualHistEntry` struct |
| Modify | `src-tauri/src/dsp/vectorscope.rs` | Add `get_history_pairs(n)` |
| Modify | `src-tauri/src/engine/meter_pipeline.rs` | `VISUAL_EMIT_MS`, visual accumulators, emit logic |
| Modify | `src/math/historyMath.js` | `HISTORY_MAX_WINDOW_SEC = 7200` |
| Modify | `src/App.jsx` | `HIST_MAX_SAMPLES = 72_000`, `VISUAL_MAX_SAMPLES = 180_000` |
| Modify | `src/lib/FrameIntake.js` | Visual ring buffers, `pushVisualHistRow` |
| Modify | `src/lib/tauriFrameApply.js` | Route `visual_hist_tick` to `intake` |
| Modify | `src/hooks/useSnapshot.js` | Visual scrub logic |
| Modify | `src/components/panels/SpectrogramPanel.jsx` | Visual sample time axis |
| Modify | `src/components/panels/WaveformPanel.jsx` | Visual time axis + visual data source |

---

## Task 1: Extend loudness history to 2 hours

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs:22`
- Modify: `src/App.jsx:65`
- Modify: `src/math/historyMath.js:2`

- [ ] **Step 1: Update Rust ring capacity**

In `src-tauri/src/engine/meter_pipeline.rs`, change line 22:
```rust
// before
const HIST_RING_CAP: usize = 36_000;
// after
const HIST_RING_CAP: usize = 72_000;
```

- [ ] **Step 2: Update JS loudness history capacity**

In `src/App.jsx`, change line 65:
```js
// before
const HIST_MAX_SAMPLES = 36000;
// after
const HIST_MAX_SAMPLES = 72000;
```

- [ ] **Step 3: Update max window constant**

In `src/math/historyMath.js`, change line 2:
```js
// before
export const HISTORY_MAX_WINDOW_SEC = 1800;
// after
export const HISTORY_MAX_WINDOW_SEC = 7200;
```

- [ ] **Step 4: Run existing tests**

```bash
npm test
```

Expected: all tests pass (no logic change, only constants).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine/meter_pipeline.rs src/App.jsx src/math/historyMath.js
git commit -m "feat(history): extend loudness history depth to 2 hours"
```

---

## Task 2: RingBuffer — O(1) circular buffer

**Files:**
- Create: `src/lib/RingBuffer.js`
- Create: `src/lib/RingBuffer.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/lib/RingBuffer.test.js`:
```js
import { describe, it, expect } from "vitest";
import { RingBuffer } from "./RingBuffer.js";

describe("RingBuffer", () => {
  it("starts empty", () => {
    const rb = new RingBuffer(4);
    expect(rb.length).toBe(0);
  });

  it("stores and retrieves items in order (oldest=0, newest=length-1)", () => {
    const rb = new RingBuffer(4);
    rb.push(1); rb.push(2); rb.push(3);
    expect(rb.at(0)).toBe(1);
    expect(rb.at(2)).toBe(3);
  });

  it("evicts oldest when full", () => {
    const rb = new RingBuffer(3);
    rb.push("a"); rb.push("b"); rb.push("c"); rb.push("d");
    expect(rb.length).toBe(3);
    expect(rb.at(0)).toBe("b");
    expect(rb.at(2)).toBe("d");
  });

  it("toArray returns ordered slice newest-last", () => {
    const rb = new RingBuffer(3);
    rb.push(10); rb.push(20); rb.push(30); rb.push(40);
    expect(rb.toArray()).toEqual([20, 30, 40]);
  });

  it("clear resets to empty", () => {
    const rb = new RingBuffer(3);
    rb.push(1); rb.push(2);
    rb.clear();
    expect(rb.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test RingBuffer
```

Expected: FAIL — "Cannot find module './RingBuffer.js'"

- [ ] **Step 3: Implement RingBuffer**

Create `src/lib/RingBuffer.js`:
```js
export class RingBuffer {
  constructor(capacity) {
    this._cap = capacity;
    this._buf = new Array(capacity);
    this._head = 0;
    this._size = 0;
  }

  push(value) {
    const idx = (this._head + this._size) % this._cap;
    this._buf[idx] = value;
    if (this._size < this._cap) {
      this._size++;
    } else {
      this._head = (this._head + 1) % this._cap;
    }
  }

  // 0 = oldest, length-1 = newest
  at(i) {
    return this._buf[(this._head + i) % this._cap];
  }

  get length() {
    return this._size;
  }

  toArray() {
    const out = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      out[i] = this._buf[(this._head + i) % this._cap];
    }
    return out;
  }

  clear() {
    this._head = 0;
    this._size = 0;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test RingBuffer
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/RingBuffer.js src/lib/RingBuffer.test.js
git commit -m "feat(lib): add O(1) RingBuffer for visual history buffers"
```

---

## Task 3: Rust — VisualHistEntry type

**Files:**
- Modify: `src-tauri/src/ipc/types.rs`

The `VisualHistEntry` carries the 40 ms snapshot for the four visual panels:
- `waveform_min` / `waveform_max`: per-channel amplitude envelope
- `spectrum_smooth_db`: frequency dB values (no SVG — frontend reconstructs)
- `vectorscope_pairs`: 200 interleaved (L, R) float pairs = 400 `f32` values
- `correlation`: stereo correlation coefficient

- [ ] **Step 1: Add struct to types.rs**

In `src-tauri/src/ipc/types.rs`, after the existing `MeterHistoryEntry` typedef block, add:

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct VisualHistEntry {
    /// Per-channel linear amplitude minimum over this ~40ms window.
    pub waveform_min: Vec<f32>,
    /// Per-channel linear amplitude maximum over this ~40ms window.
    pub waveform_max: Vec<f32>,
    /// Smoothed per-band dB values for Spectrum/Spectrogram display.
    pub spectrum_smooth_db: Vec<f64>,
    /// Vectorscope Lissajous: interleaved [L0,R0, L1,R1, …] for 200 subsampled points.
    pub vectorscope_pairs: Vec<f32>,
    /// Pearson correlation coefficient [-1, 1].
    pub correlation: f64,
}
```

- [ ] **Step 2: Add field to AudioFramePayload**

In the same file, find the `AudioFramePayload` struct and add:
```rust
pub visual_hist_tick: Option<VisualHistEntry>,
```

- [ ] **Step 3: Build to confirm no errors**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: compiles; warnings about unused field are OK.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ipc/types.rs
git commit -m "feat(ipc): add VisualHistEntry and visual_hist_tick to AudioFramePayload"
```

---

## Task 4: Rust — Vectorscope raw pairs output

**Files:**
- Modify: `src-tauri/src/dsp/vectorscope.rs`

Currently `get_output()` returns `(correlation, svg_string)`. We need a second method that returns 200 subsampled raw float pairs for history storage (no SVG generation).

- [ ] **Step 1: Add `get_history_pairs` method**

In `src-tauri/src/dsp/vectorscope.rs`, add after `get_output()`:

```rust
/// Returns interleaved [L0, R0, L1, R1, …] subsampled to `n` points,
/// and the Pearson correlation coefficient.
/// Used for visual history storage (no SVG allocation).
pub fn get_history_pairs(&mut self, n: usize) -> (f64, Vec<f32>) {
    if self.vs_l.is_empty() || n == 0 {
        return (0.0, Vec::new());
    }
    self.vs_flat_l.clear();
    self.vs_flat_r.clear();
    self.vs_flat_l.extend(self.vs_l.iter().copied());
    self.vs_flat_r.extend(self.vs_r.iter().copied());

    let len = self.vs_flat_l.len().min(self.vs_flat_r.len());
    let step = (len as f64 / n as f64).max(1.0);

    // Compute correlation while subsampling.
    let mut sum_l = 0.0_f64;
    let mut sum_r = 0.0_f64;
    let mut sum_lr = 0.0_f64;
    let mut pairs = Vec::with_capacity(n * 2);

    for i in 0..n {
        let idx = ((i as f64 * step) as usize).min(len - 1);
        let l = self.vs_flat_l[idx] as f64;
        let r = self.vs_flat_r[idx] as f64;
        sum_l += l * l;
        sum_r += r * r;
        sum_lr += l * r;
        pairs.push(self.vs_flat_l[idx]);
        pairs.push(self.vs_flat_r[idx]);
    }

    let corr_den = (sum_l * sum_r).sqrt();
    let corr = if corr_den > 1e-9 {
        (sum_lr / corr_den).clamp(-1.0, 1.0)
    } else {
        0.0
    };
    (corr, pairs)
}
```

- [ ] **Step 2: Add unit test**

In the `#[cfg(test)]` block at the bottom of `vectorscope.rs`, add:

```rust
#[test]
fn get_history_pairs_returns_n_pairs() {
    let mut vm = VectorscopeMeter::new();
    // Feed 1000 samples
    let pcm: Vec<f32> = (0..2000).map(|i| (i as f32 * 0.001).sin()).collect();
    let ctx = crate::dsp::meter::PcmContext {
        interleaved: &pcm,
        channels: 2,
        vectorscope_pair: (0, 1),
        spectrum_channel: crate::dsp::SpectrumChannelSel::default(),
    };
    vm.push_pcm(&ctx);
    let (_corr, pairs) = vm.get_history_pairs(200);
    assert_eq!(pairs.len(), 400, "200 pairs = 400 f32 values");
}
```

- [ ] **Step 3: Run Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- dsp::vectorscope
```

Expected: all vectorscope tests pass including the new one.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/dsp/vectorscope.rs
git commit -m "feat(dsp): add get_history_pairs() to VectorscopeMeter for visual history"
```

---

## Task 5: Rust — Visual emit logic in MeterPipeline

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

Add `VISUAL_EMIT_MS = 40`, separate waveform accumulators for the visual window, and populate `visual_hist_tick` in every `AudioFramePayload`.

- [ ] **Step 1: Add constant and struct fields**

At the top of `meter_pipeline.rs`, after the existing constants, add:
```rust
const VISUAL_EMIT_MS: u128 = 40;
const VS_HISTORY_POINTS: usize = 200;
```

In `MeterPipeline` struct, add:
```rust
last_visual_emit: Instant,
/// Running per-channel min since last visual tick. Sentinel INFINITY = no samples seen yet.
visual_waveform_min_acc: Vec<f32>,
/// Running per-channel max since last visual tick.
visual_waveform_max_acc: Vec<f32>,
```

- [ ] **Step 2: Initialize new fields in `new()`**

In `MeterPipeline::new()`, add to the struct initializer:
```rust
last_visual_emit: Instant::now() - std::time::Duration::from_millis(200),
visual_waveform_min_acc: vec![f32::INFINITY; channels.max(1) as usize],
visual_waveform_max_acc: vec![f32::NEG_INFINITY; channels.max(1) as usize],
```

- [ ] **Step 3: Accumulate visual waveform alongside loudness waveform**

Find the existing waveform accumulation block (around line 191–203). After each sample is accumulated into `self.waveform_min_acc` / `self.waveform_max_acc`, add the same logic for visual accumulators:

```rust
// Visual waveform accumulation (identical logic, separate accumulators)
if c < self.visual_waveform_min_acc.len() {
    if s < self.visual_waveform_min_acc[c] {
        self.visual_waveform_min_acc[c] = s;
    }
    if s > self.visual_waveform_max_acc[c] {
        self.visual_waveform_max_acc[c] = s;
    }
}
```

- [ ] **Step 4: Emit visual_hist_tick**

Find the section that builds `AudioFramePayload` (around line 355–370). Before building the payload, add the visual tick logic:

```rust
let visual_hist_tick = {
    let since_visual = now.duration_since(self.last_visual_emit).as_millis();
    if since_visual >= VISUAL_EMIT_MS {
        self.last_visual_emit = now;

        let visual_waveform_min: Vec<f32> = self.visual_waveform_min_acc
            .iter()
            .map(|&v| if v.is_finite() { v } else { 0.0 })
            .collect();
        let visual_waveform_max: Vec<f32> = self.visual_waveform_max_acc
            .iter()
            .map(|&v| if v.is_finite() { v } else { 0.0 })
            .collect();
        self.visual_waveform_min_acc.fill(f32::INFINITY);
        self.visual_waveform_max_acc.fill(f32::NEG_INFINITY);

        let (centers, smooth, _peak) = self.spectrum.last_output();
        let (corr, vs_pairs) = self.vectorscope.get_history_pairs(VS_HISTORY_POINTS);

        Some(crate::ipc::types::VisualHistEntry {
            waveform_min: visual_waveform_min,
            waveform_max: visual_waveform_max,
            spectrum_smooth_db: smooth.clone(),
            vectorscope_pairs: vs_pairs,
            correlation: corr,
        })
    } else {
        None
    }
};
```

Then set `visual_hist_tick` in the `AudioFramePayload` construction:
```rust
visual_hist_tick,
```

- [ ] **Step 5: Reset visual accumulators in `clear_peak_and_history`**

In `clear_peak_and_history()`, add:
```rust
self.visual_waveform_min_acc.fill(f32::INFINITY);
self.visual_waveform_max_acc.fill(f32::NEG_INFINITY);
self.last_visual_emit = Instant::now() - std::time::Duration::from_millis(200);
```

- [ ] **Step 6: Build**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: clean build.

- [ ] **Step 7: Run Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- engine::meter_pipeline
```

Expected: all existing pipeline tests pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(pipeline): emit visual_hist_tick at 25Hz independent of loudness tick"
```

---

## Task 6: Frontend — Visual history ring buffers in FrameIntake

**Files:**
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/App.jsx`

Add four visual ring buffers and `pushVisualHistRow()`. The spectrogram canvas needs a plain-array view (updated each tick) because `useSpectrogramCanvas` indexes into it directly.

- [ ] **Step 1: Add VISUAL_* constants**

In `src/App.jsx`, after `HIST_MAX_SAMPLES`, add:
```js
const VISUAL_HIST_SAMPLE_SEC = 0.04; // 25 Hz
const VISUAL_MAX_SAMPLES = 180_000;  // 25 Hz × 2 h
```

Export `VISUAL_HIST_SAMPLE_SEC` and `VISUAL_MAX_SAMPLES` via context so panels can use them, or pass as props to `useAudioEngine`. (The exact wiring depends on App.jsx's existing pattern — follow how `HIST_MAX_SAMPLES` is currently passed.)

- [ ] **Step 2: Add visual constants to useLoudnessHistory export area**

In `src/hooks/useLoudnessHistory.js`, add after `HIST_SAMPLE_SEC`:
```js
export const VISUAL_HIST_SAMPLE_SEC = 0.04;
```

This makes the constant importable by panels (same file already imported by SpectrogramPanel).

- [ ] **Step 3: Write failing test for pushVisualHistRow**

In `src/lib/FrameIntake.test.js`, add:
```js
import { RingBuffer } from "./RingBuffer.js";

it("pushVisualHistRow stores entry in visual ring buffers", () => {
  const intake = new FrameIntake();
  const row = {
    waveform_min: [-0.5, -0.3],
    waveform_max: [0.5, 0.3],
    spectrum_smooth_db: [-20, -30, -40],
    vectorscope_pairs: new Array(400).fill(0.1),
    correlation: 0.8,
  };
  intake.pushVisualHistRow(row, 10);
  expect(intake.getVisualWaveformHist().length).toBe(1);
  expect(intake.getVisualSpectrumHist().length).toBe(1);
  expect(intake.getVisualVectorscopeHist().length).toBe(1);
  expect(intake.getVisualCorrHist().length).toBe(1);
  expect(intake.getVisualWaveformHist().at(0)).toEqual({
    waveformMin: [-0.5, -0.3],
    waveformMax: [0.5, 0.3],
  });
});

it("visual ring evicts oldest when over capacity", () => {
  const intake = new FrameIntake();
  const row = {
    waveform_min: [0], waveform_max: [0],
    spectrum_smooth_db: [], vectorscope_pairs: [], correlation: 0,
  };
  for (let i = 0; i < 5; i++) intake.pushVisualHistRow(row, 3);
  expect(intake.getVisualWaveformHist().length).toBe(3);
});
```

- [ ] **Step 4: Run to confirm failure**

```bash
npm test FrameIntake
```

Expected: FAIL — `pushVisualHistRow is not a function`.

- [ ] **Step 5: Implement visual ring buffers in FrameIntake**

In `src/lib/FrameIntake.js`, import RingBuffer:
```js
import { RingBuffer } from "./RingBuffer.js";
```

Add to the `FrameIntake` constructor:
```js
this._visualWaveformHist = new RingBuffer(0);   // resized on first push
this._visualSpectrumHist = new RingBuffer(0);
this._visualVectorscopeHist = new RingBuffer(0);
this._visualCorrHist = new RingBuffer(0);
// Plain array view kept in sync with _visualSpectrumHist for canvas hook.
this._spectrogramSnapArray = [];
```

Add `pushVisualHistRow` method:
```js
pushVisualHistRow(row, visualMaxSamples) {
  // Lazily resize ring buffers to the configured capacity.
  if (this._visualWaveformHist._cap !== visualMaxSamples) {
    this._visualWaveformHist = new RingBuffer(visualMaxSamples);
    this._visualSpectrumHist = new RingBuffer(visualMaxSamples);
    this._visualVectorscopeHist = new RingBuffer(visualMaxSamples);
    this._visualCorrHist = new RingBuffer(visualMaxSamples);
  }

  this._visualWaveformHist.push({
    waveformMin: row.waveform_min ?? [],
    waveformMax: row.waveform_max ?? [],
  });

  const specEntry = {
    bands: getBandsFromCenters([]),  // bands are fixed; canvas only needs dbList
    dbList: [...(row.spectrum_smooth_db ?? [])],
  };
  this._visualSpectrumHist.push(specEntry);

  this._visualVectorscopeHist.push(row.vectorscope_pairs ?? []);
  this._visualCorrHist.push(
    Number.isFinite(row.correlation) ? row.correlation : -Infinity
  );

  // Rebuild the ordered array view for useSpectrogramCanvas.
  this._spectrogramSnapArray = this._visualSpectrumHist.toArray();
}
```

Note: `getBandsFromCenters` is defined earlier in the same file. The spectrogram canvas only reads `snap.dbList`; `bands` is used for the Y-axis frequency lookup which is rebuilt separately.

Add getters:
```js
getVisualWaveformHist() { return this._visualWaveformHist; }
getVisualSpectrumHist() { return this._visualSpectrumHist; }
getVisualVectorscopeHist() { return this._visualVectorscopeHist; }
getVisualCorrHist() { return this._visualCorrHist; }
getSpectrogramSnapArray() { return this._spectrogramSnapArray; }
```

Update `reset()` to clear visual buffers:
```js
this._visualWaveformHist.clear();
this._visualSpectrumHist.clear();
this._visualVectorscopeHist.clear();
this._visualCorrHist.clear();
this._spectrogramSnapArray = [];
```

- [ ] **Step 6: Run tests**

```bash
npm test FrameIntake
```

Expected: all tests pass including the two new ones.

- [ ] **Step 7: Commit**

```bash
git add src/lib/FrameIntake.js src/App.jsx src/hooks/useLoudnessHistory.js
git commit -m "feat(intake): add visual history ring buffers at 25Hz"
```

---

## Task 7: Frontend — Wire visual tick in frame handler

**Files:**
- Modify: `src/lib/tauriFrameApply.js`

`tauriFrameApply` is the single place all incoming Rust frames are processed. Add handling for `visual_hist_tick`.

- [ ] **Step 1: Accept visualMaxSamples parameter**

In `buildTauriFrameApply`, add `visualMaxSamples` to the options object:
```js
export function buildTauriFrameApply({
  histMaxSamples,
  visualMaxSamples,   // ← add this
  intake,
  // ...rest unchanged
}) {
```

- [ ] **Step 2: Route visual_hist_tick inside applyFrame**

After `intake.pushFrame(f, histMaxSamples, ...)`, add:
```js
if (f.visual_hist_tick != null) {
  intake.pushVisualHistRow(f.visual_hist_tick, visualMaxSamples);
}
```

- [ ] **Step 3: Pass visualMaxSamples from App.jsx**

In `src/App.jsx`, find where `buildTauriFrameApply` is called and add `visualMaxSamples: VISUAL_MAX_SAMPLES` to its options object.

- [ ] **Step 4: Confirm Rust → frontend flow compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml && npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauriFrameApply.js src/App.jsx
git commit -m "feat(frame): route visual_hist_tick to FrameIntake visual ring buffers"
```

---

## Task 8: Frontend — SVG reconstruction helpers

**Files:**
- Create: `src/math/vectorscopeMath.js`
- Create: `src/math/spectrumMath.js`

These are pure functions called at scrub time to regenerate SVG paths from stored data. They must produce output identical to the Rust-side generators.

- [ ] **Step 1: Write vectorscope reconstruction test**

Create `src/math/vectorscopeMath.test.js`:
```js
import { describe, it, expect } from "vitest";
import { buildVectorscopeSvgFromPairs } from "./vectorscopeMath.js";

describe("buildVectorscopeSvgFromPairs", () => {
  it("returns empty string for empty pairs", () => {
    expect(buildVectorscopeSvgFromPairs([])).toBe("");
  });

  it("returns SVG path starting with M for valid pairs", () => {
    const pairs = [0.5, -0.5, 0.3, 0.3, -0.2, 0.1];
    const svg = buildVectorscopeSvgFromPairs(pairs);
    expect(svg).toMatch(/^M /);
    expect(svg).toContain(" L ");
  });
});
```

- [ ] **Step 2: Implement vectorscopeMath.js**

Create `src/math/vectorscopeMath.js`:
```js
// Matches the geometry in src-tauri/src/dsp/vectorscope.rs process().
const INV_SQRT2 = 1 / Math.sqrt(2);
const VS_HALF = 130.0;
const VS_SAFE_INSET = 8.0;
const VS_EXTENT_FLOOR = 0.02;
const BASE_PLOT_RADIUS = 96.0;

/**
 * Reconstruct a Lissajous SVG path from stored float pairs.
 * @param {number[]} pairs - interleaved [L0, R0, L1, R1, …]
 * @returns {string} SVG path d attribute
 */
export function buildVectorscopeSvgFromPairs(pairs) {
  const n = Math.floor(pairs.length / 2);
  if (n === 0) return "";

  let maxCheb = 0;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, pairs[i * 2]));
    const r = Math.max(-1, Math.min(1, pairs[i * 2 + 1]));
    const side = (r - l) * INV_SQRT2;
    const mid = (l + r) * INV_SQRT2;
    const e = Math.max(Math.abs(side), Math.abs(mid));
    if (e > maxCheb) maxCheb = e;
  }

  const extent = Math.max(VS_EXTENT_FLOOR, maxCheb);
  const effRadius = Math.min(BASE_PLOT_RADIUS, (VS_HALF - VS_SAFE_INSET) / extent);

  const pts = [];
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, pairs[i * 2]));
    const r = Math.max(-1, Math.min(1, pairs[i * 2 + 1]));
    const side = (r - l) * INV_SQRT2;
    const mid = (l + r) * INV_SQRT2;
    const x = VS_HALF + side * effRadius;
    const y = VS_HALF - mid * effRadius;
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M ${pts.join(" L ")}`;
}
```

- [ ] **Step 3: Write spectrum reconstruction test**

Create `src/math/spectrumMath.test.js`:
```js
import { describe, it, expect } from "vitest";
import { buildSpectrumSvgFromBandsAndDb } from "./spectrumMath.js";

describe("buildSpectrumSvgFromBandsAndDb", () => {
  it("returns empty for empty input", () => {
    expect(buildSpectrumSvgFromBandsAndDb([], [])).toBe("");
  });

  it("returns SVG path starting with M", () => {
    const centers = [100, 1000, 10000];
    const db = [-20, -30, -40];
    const svg = buildSpectrumSvgFromBandsAndDb(centers, db);
    expect(svg).toMatch(/^M /);
  });
});
```

- [ ] **Step 4: Implement spectrumMath.js**

Create `src/math/spectrumMath.js`:
```js
// Matches geometry in src-tauri/src/dsp/paths.rs spectrum_paths_from_bands().
const SPECTRUM_VIEW_W = 1000.0;
const SPEC_VIEW_H = 260.0;
const SPEC_VIEW_TOP_PAD = 10.0;
const SPEC_VIEW_BOTTOM_PAD = 4.0;
const SPEC_DB_MIN = -100.0;
const SPEC_DB_MAX = 0.0;

function freqToXFrac(f) {
  const ff = Math.max(20, Math.min(20000, f));
  const log20 = Math.log10(20);
  const log20k = Math.log10(20000);
  return (Math.log10(ff) - log20) / (log20k - log20);
}

function dbToY(d) {
  const dd = Math.max(SPEC_DB_MIN, Math.min(SPEC_DB_MAX, d));
  const plotH = SPEC_VIEW_H - SPEC_VIEW_TOP_PAD - SPEC_VIEW_BOTTOM_PAD;
  return SPEC_VIEW_H - SPEC_VIEW_BOTTOM_PAD - ((dd - SPEC_DB_MIN) / (SPEC_DB_MAX - SPEC_DB_MIN)) * plotH;
}

/**
 * Reconstruct spectrum SVG path from band centers and dB values.
 * @param {number[]} centers - band center frequencies in Hz
 * @param {number[]} db - smoothed dB per band
 * @returns {string} SVG path d attribute
 */
export function buildSpectrumSvgFromBandsAndDb(centers, db) {
  if (!centers.length || centers.length !== db.length) return "";
  const pts = centers.map((fc, i) => {
    const x = freqToXFrac(fc) * SPECTRUM_VIEW_W;
    const y = dbToY(db[i]);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return `M ${pts.join(" L ")}`;
}
```

- [ ] **Step 5: Run new math tests**

```bash
npm test vectorscopeMath spectrumMath
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/math/vectorscopeMath.js src/math/vectorscopeMath.test.js src/math/spectrumMath.js src/math/spectrumMath.test.js
git commit -m "feat(math): add SVG reconstruction helpers for visual history scrubbing"
```

---

## Task 9: Frontend — Visual scrubbing in useSnapshot

**Files:**
- Modify: `src/hooks/useSnapshot.js`

When `selectedOffset >= 0`, the snapshot should read from visual history for Spectrum/Vectorscope/Waveform. Loudness and Peak still read from the existing snap sources.

- [ ] **Step 1: Import new helpers**

At the top of `src/hooks/useSnapshot.js`:
```js
import { VISUAL_HIST_SAMPLE_SEC } from "../hooks/useLoudnessHistory.js";
import { buildVectorscopeSvgFromPairs } from "../math/vectorscopeMath.js";
import { buildSpectrumSvgFromBandsAndDb } from "../math/spectrumMath.js";
```

- [ ] **Step 2: Update freezeSnapshot to include visual history**

```js
function freezeSnapshot(intake) {
  return {
    loudness: [...intake.getLoudnessHistory()],
    spectrum: [...intake.getSpectrumSnap()],
    spectrumData: [...intake.getSpectrumDataSnap()],
    vector: [...intake.getVectorSnap()],
    corr: [...intake.getCorrSnap()],
    audio: [...intake.getAudioSnap()],
    channelMetadata: [...(intake.getChannelMetadataSnap?.() ?? [])],
    // Visual history snapshots
    visualWaveform: intake.getVisualWaveformHist().toArray(),
    visualSpectrum: intake.getVisualSpectrumHist().toArray(),
    visualVectorscope: intake.getVisualVectorscopeHist().toArray(),
    visualCorr: intake.getVisualCorrHist().toArray(),
  };
}
```

- [ ] **Step 3: Compute visual snap index**

After the existing `snapIdx` / `audioSnapIdx` calculations, add:
```js
const visualSnapIdx =
  selectedOffset >= 0
    ? Math.max(
        0,
        (snapSource?.visualSpectrum ?? []).length -
          1 -
          Math.round(selectedOffset / VISUAL_HIST_SAMPLE_SEC)
      )
    : -1;

const visualSpecSnap = snapSource?.visualSpectrum ?? [];
const visualVsSnap = snapSource?.visualVectorscope ?? [];
```

- [ ] **Step 4: Override displaySpectrumPath and displayVectorPath**

Replace the existing `displaySpectrumPath` and `displayVectorPath` derivations:
```js
const displaySpectrumPath = (() => {
  if (visualSnapIdx >= 0 && visualSpecSnap[visualSnapIdx]) {
    const snap = visualSpecSnap[visualSnapIdx];
    // Centers come from the cached bands in spectrumDataSnap, or derive from snap.bands
    const centers = snap.bands ? snap.bands.map((b) => b.fCenter) : [];
    return buildSpectrumSvgFromBandsAndDb(centers, snap.dbList ?? []);
  }
  return snapIdx >= 0 && snapSpecList[snapIdx] ? snapSpecList[snapIdx] : spectrumPath;
})();

const displayVectorPath = (() => {
  if (visualSnapIdx >= 0 && visualVsSnap[visualSnapIdx]) {
    return buildVectorscopeSvgFromPairs(visualVsSnap[visualSnapIdx]);
  }
  return snapIdx >= 0 && snapVecList[snapIdx] ? snapVecList[snapIdx] : vectorPath;
})();
```

- [ ] **Step 5: Export visual waveform data**

Add to the return object:
```js
visualWaveformSnap: snapSource?.visualWaveform ?? null,
visualSnapIdx,
```

- [ ] **Step 6: Run existing snapshot tests**

```bash
npm test useSnapshot
```

Expected: all existing tests pass (new fields are additive).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSnapshot.js
git commit -m "feat(snapshot): use visual history for Spectrum and Vectorscope scrubbing"
```

---

## Task 10: Frontend — Panel time axes use visual sample counts

**Files:**
- Modify: `src/components/panels/SpectrogramPanel.jsx`
- Modify: `src/components/panels/WaveformPanel.jsx`

Both panels currently build time-axis labels using `visibleSamples` (loudness samples, 10 Hz). They should use visual sample counts (25 Hz) so the displayed time matches the visual history resolution.

The `effectiveOffsetSamples` and `visibleSamples` in `AudioDataContext` are currently in loudness-tick units. For visual panels, derive visual equivalents by scaling:

```
visualVisibleSamples = Math.round(visibleSamples * (HIST_SAMPLE_SEC / VISUAL_HIST_SAMPLE_SEC))
```

This keeps the displayed time window identical while using the denser sample count.

- [ ] **Step 1: Update SpectrogramPanel time axis**

In `src/components/panels/SpectrogramPanel.jsx`, import `VISUAL_HIST_SAMPLE_SEC`:
```js
import { HIST_SAMPLE_SEC, VISUAL_HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory";
```

Replace the `spectrogramTimeTicks` memo:
```js
const spectrogramTimeTicks = useMemo(() => {
  const visualVisibleSamples = Math.round(
    visibleSamples * (HIST_SAMPLE_SEC / VISUAL_HIST_SAMPLE_SEC)
  );
  const visualEffectiveOffset = Math.round(
    effectiveOffsetSamples * (HIST_SAMPLE_SEC / VISUAL_HIST_SAMPLE_SEC)
  );
  return buildHistoryTimeAxisLabels(
    visualEffectiveOffset * VISUAL_HIST_SAMPLE_SEC,
    visualVisibleSamples * VISUAL_HIST_SAMPLE_SEC
  );
}, [effectiveOffsetSamples, visibleSamples]);
```

- [ ] **Step 2: Update Spectrogram canvas to use visual snap array**

In `SpectrogramPanel.jsx`, import the new getter:
```js
const { spectrogramSnapRef, ... } = useAudioData();
```

In `App.jsx` (or wherever `spectrogramSnapRef` is wired), update so that `spectrogramSnapRef.current` is set to `intake.getSpectrogramSnapArray()` after each visual tick — this is already done in Task 6 Step 5 (`_spectrogramSnapArray` is rebuilt in `pushVisualHistRow`).

Confirm in App.jsx that `spectrogramSnapRef` is assigned:
```js
spectrogramSnapRef.current = intake.getSpectrogramSnapArray();
```
(The exact location depends on where `spectrogramSnapRef` is currently updated; follow that pattern.)

- [ ] **Step 3: Update WaveformPanel time axis**

In `src/components/panels/WaveformPanel.jsx`, the `historyTimeTicks` currently come from `useLoudnessHistory` (which was fixed in an earlier commit to use `visibleSamples * HIST_SAMPLE_SEC`). No change needed to the labels — they're already correct in seconds. But verify the component still renders correctly.

- [ ] **Step 4: Update WaveformPanel data source**

The Waveform panel reads `waveformMin`/`waveformMax` from `histSourceList` (loudness history). For visual history scrubbing, it should use `visualWaveformSnap` from `useSnapshot`.

In `WaveformPanel.jsx` (or the component that builds the waveform path), when `visualWaveformSnap` and `visualSnapIdx` are available and `selectedOffset >= 0`, use `visualWaveformSnap[visualSnapIdx]` as the source. This follows the same pattern as `displaySpectrumPath`.

The exact integration point depends on how `WaveformPanel` accesses data from `useAudioData` — check and follow the existing `snapIdx` pattern in `useSnapshot`.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/SpectrogramPanel.jsx src/components/panels/WaveformPanel.jsx
git commit -m "feat(panels): use visual history sample counts for time axis and scrub data"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Decouple visual from loudness tick | Tasks 3–5 (Rust), Task 7 (JS wiring) |
| 2-hour depth | Task 1 (loudness), Task 6 (visual: 180k samples) |
| Different per-panel rates (all 25Hz for now) | Task 5 (`VISUAL_EMIT_MS=40`) |
| Vectorscope: float pairs 200 points | Tasks 4, 6, 8, 9 |
| Spectrum: dbList only, SVG on demand | Tasks 6, 8, 9 |
| Fix ringPush O(n) | Task 2 (RingBuffer) + Task 6 (use it) |
| Waveform uses visual history | Tasks 6, 10 |
| Spectrogram canvas at 25Hz | Tasks 6 (`_spectrogramSnapArray`), 10 |
| Time axes correct after change | Tasks 6 (VISUAL_HIST_SAMPLE_SEC constant), 10 |

**Placeholder check:** No TBD/TODO in code steps. Task 10 Step 4 notes "check and follow the existing pattern" — acceptable since exact line numbers depend on App.jsx context not fully read; the pattern is unambiguous.

**Type consistency:** `VisualHistEntry` (Rust Task 3) → `f.visual_hist_tick` (Task 7) → `pushVisualHistRow(row, ...)` (Task 6, where `row` is the deserialized `VisualHistEntry`) → `row.waveform_min`, `row.spectrum_smooth_db`, `row.vectorscope_pairs`, `row.correlation` — consistent throughout.
