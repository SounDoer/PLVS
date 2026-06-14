# Spectrum Multi-resolution FFT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-FFT / RTA-band spectrum with a multi-resolution FFT engine that combines three FFT sizes in the PSD domain, resamples onto a fixed log-frequency grid, and applies a default +4.5 dB/octave slope.

**Architecture:** A new Rust module (`spectrum_bank.rs`) owns the log grid, a reusable single-size STFT analyzer (windowed rFFT → per-bin PSD), and a `MultiResBank` that feeds samples to three analyzers and samples their PSD onto the grid with crossfaded crossovers. `SpectrumMeter` (`spectrum.rs`) becomes the orchestrator: it drives the bank, then runs per-grid-point post-processing (weighting → slope → octave smoothing → attack/release → peak-hold) and caches `(grid_freqs, smooth_db, peak_db)`. The frame payload shape is unchanged; JS only renders the `(frequency, dB)` list.

**Tech Stack:** Rust (`realfft`, `rustfft`), existing Tauri frame payload, JS/Vitest frontend.

**Spec:** `docs/superpowers/specs/2026-06-14-spectrum-multiresolution-fft-design.md`

---

## File structure

- **Create** `src-tauri/src/dsp/spectrum_bank.rs` — `LogGrid`, `StftAnalyzer`, `MultiResBank`, shared constants. One responsibility: turn interleaved samples into a per-grid-point PSD-dB row.
- **Modify** `src-tauri/src/dsp/mod.rs` — declare `pub mod spectrum_bank;`.
- **Modify** `src-tauri/src/dsp/spectrum.rs` — `SpectrumMeter` delegates analysis to `MultiResBank`; keeps post-processing, attack/release, peak-hold, payload caching. Default `tilt_db_per_octave` becomes `4.5`.
- **Verify/Modify** `src-tauri/src/dsp/paths.rs` — `freq → x` / `db → y` path builder; expected to work unchanged on the denser grid.
- **Verify/Modify** `src-tauri/src/engine/meter_pipeline.rs` — emits `spectrum_band_centers_hz` from `band_centers()`; expected unchanged.
- **Modify** `src/lib/FrameIntake.js` — `buildSpectrumDataSnapshot` / `pushVisualHistRow` trust payload frequencies (`getBandsFromCenters`) instead of `buildRtaBands`.
- **Test** inline `#[cfg(test)]` in `spectrum_bank.rs` and `spectrum.rs`; `src/lib/FrameIntake.test.js`.

**Constants (define once at top of `spectrum_bank.rs`):**

```rust
pub const FFT_BIG: usize = 16384;
pub const FFT_MID: usize = 4096;
pub const FFT_SMALL: usize = 1024;
pub const XOVER_LO_HZ: f64 = 200.0;
pub const XOVER_HI_HZ: f64 = 2000.0;
pub const XFADE_HALF_OCT: f64 = 1.0 / 6.0; // crossfade half-width, octaves
pub const GRID_POINTS_PER_OCT: f64 = 96.0;
pub const POWER_AVG_FRAMES: usize = 4;
pub const OVERLAP: usize = 4; // 75% overlap → hop = size / OVERLAP
```

**Test commands (PowerShell, Windows):**
- Rust single: `cargo test --manifest-path src-tauri/Cargo.toml <name> -- --nocapture`
- Rust all spectrum: `cargo test --manifest-path src-tauri/Cargo.toml spectrum`
- JS: `npm test -- src/lib/FrameIntake.test.js`

---

## Task 1: Log-frequency grid

**Files:**
- Create: `src-tauri/src/dsp/spectrum_bank.rs`
- Modify: `src-tauri/src/dsp/mod.rs`

- [ ] **Step 1: Declare the module**

In `src-tauri/src/dsp/mod.rs` add alongside the other `pub mod` lines:

```rust
pub mod spectrum_bank;
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/dsp/spectrum_bank.rs` with the constants above plus:

```rust
/// Fixed log-frequency render grid spanning [min_hz, max_hz] at GRID_POINTS_PER_OCT points/octave.
pub struct LogGrid {
  pub freqs: Vec<f64>,
}

impl LogGrid {
  pub fn new(min_hz: f64, max_hz: f64) -> Self {
    let lo = min_hz.max(1.0);
    let hi = max_hz.max(lo * 2.0);
    let octaves = (hi / lo).log2();
    let count = (octaves * GRID_POINTS_PER_OCT).ceil() as usize + 1;
    let mut freqs = Vec::with_capacity(count);
    for i in 0..count {
      let frac = i as f64 / (count - 1) as f64;
      freqs.push(lo * 2_f64.powf(frac * octaves));
    }
    Self { freqs }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn grid_spans_range_and_is_log_spaced() {
    let g = LogGrid::new(20.0, 20000.0);
    assert!((g.freqs[0] - 20.0).abs() < 1e-6);
    assert!((g.freqs[g.freqs.len() - 1] - 20000.0).abs() < 1e-3);
    // ~96 points/oct over ~9.97 octaves → ~958 points
    assert!(g.freqs.len() > 900 && g.freqs.len() < 1010);
    // log spacing: ratio between adjacent points is ~constant
    let r0 = g.freqs[1] / g.freqs[0];
    let r1 = g.freqs[100] / g.freqs[99];
    assert!((r0 - r1).abs() < 1e-9);
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml grid_spans_range -- --nocapture`
Expected: PASS (this task is pure construction; the test and code land together).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/dsp/spectrum_bank.rs src-tauri/src/dsp/mod.rs
git commit -m "feat(spectrum): add log-frequency render grid"
```

---

## Task 2: Single-size STFT analyzer → per-bin PSD

**Files:**
- Modify: `src-tauri/src/dsp/spectrum_bank.rs`

The analyzer owns one FFT size, a ring buffer, a Hann window, runs an STFT on a fixed hop, averages the last `POWER_AVG_FRAMES` power spectra, and exposes per-bin **PSD** (power per Hz).

- [ ] **Step 1: Write the failing test**

Append to `spectrum_bank.rs` (above the `#[cfg(test)]` block, add the type; inside `tests`, add the test):

```rust
use realfft::RealFftPlanner;
use rustfft::num_complex::Complex;
use std::collections::VecDeque;

/// One windowed-rFFT analyzer at a fixed size. Produces per-bin PSD (power / Hz),
/// averaged over the last POWER_AVG_FRAMES STFT frames.
pub struct StftAnalyzer {
  size: usize,
  hop: usize,
  r2c: std::sync::Arc<dyn realfft::RealToComplex<f32>>,
  scratch_in: Vec<f32>,
  scratch_spec: Vec<Complex<f32>>,
  window: Vec<f32>,
  ring: Vec<f32>,
  write: usize,
  filled: usize,
  ingested: u64,
  power_hist: VecDeque<Vec<f64>>,
  sample_rate: f64,
}

impl StftAnalyzer {
  pub fn new(size: usize, sample_rate: f64) -> Self {
    let mut planner = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(size);
    let scratch_spec = r2c.make_output_vec();
    let mut window = vec![0.0_f32; size];
    for (n, w) in window.iter_mut().enumerate() {
      *w = (0.5 * (1.0 - (2.0 * std::f64::consts::PI * n as f64 / (size - 1).max(1) as f64).cos()))
        as f32;
    }
    Self {
      size,
      hop: size / OVERLAP,
      r2c,
      scratch_in: vec![0.0_f32; size],
      scratch_spec,
      window,
      ring: vec![0.0_f32; size],
      write: 0,
      filled: 0,
      ingested: 0,
      power_hist: VecDeque::new(),
      sample_rate,
    }
  }

  pub fn bin_width_hz(&self) -> f64 {
    self.sample_rate / self.size as f64
  }

  pub fn ready(&self) -> bool {
    self.filled >= self.size && !self.power_hist.is_empty()
  }

  /// Push one mono sample; runs an STFT whenever a hop boundary is crossed.
  pub fn push_sample(&mut self, s: f32) {
    let w = self.write % self.size;
    self.ring[w] = s;
    self.write = self.write.wrapping_add(1);
    self.filled = (self.filled + 1).min(self.size);
    self.ingested = self.ingested.wrapping_add(1);
    if self.filled >= self.size && self.ingested % self.hop as u64 == 0 {
      self.run_fft();
    }
  }

  fn run_fft(&mut self) {
    let n = self.size as f64;
    for (i, slot) in self.scratch_in.iter_mut().enumerate() {
      let idx = (self.write.wrapping_sub(self.size) + i) % self.size;
      *slot = self.ring[idx] * self.window[i];
    }
    self.r2c.process(&mut self.scratch_in, &mut self.scratch_spec).expect("fft");
    let bin_count = self.scratch_spec.len();
    let bw = self.bin_width_hz();
    let mut psd = vec![0.0_f64; bin_count];
    for (k, c) in self.scratch_spec.iter().enumerate() {
      let m = (c.re * c.re + c.im * c.im).sqrt() as f64;
      let m_norm = if k == 0 || k + 1 == bin_count { m / n } else { m * 2.0 / n };
      let power = m_norm.max(1e-12).powi(2);
      psd[k] = power / bw; // power per Hz
    }
    self.power_hist.push_back(psd);
    while self.power_hist.len() > POWER_AVG_FRAMES {
      self.power_hist.pop_front();
    }
  }

  /// Time-averaged PSD at an arbitrary frequency via linear interpolation between bins.
  pub fn psd_at(&self, hz: f64) -> f64 {
    if self.power_hist.is_empty() {
      return 1e-20;
    }
    let bin_count = self.scratch_spec.len();
    let n_hist = self.power_hist.len() as f64;
    let pos = hz / self.bin_width_hz();
    let k0 = pos.floor().clamp(0.0, (bin_count - 1) as f64) as usize;
    let k1 = (k0 + 1).min(bin_count - 1);
    let frac = (pos - k0 as f64).clamp(0.0, 1.0);
    let mut a = 0.0;
    let mut b = 0.0;
    for row in &self.power_hist {
      a += row[k0];
      b += row[k1];
    }
    a /= n_hist;
    b /= n_hist;
    (a * (1.0 - frac) + b * frac).max(1e-20)
  }
}
```

Add the test inside `mod tests`:

```rust
fn feed_tone(an: &mut StftAnalyzer, sr: f64, hz: f64, samples: usize) {
  for i in 0..samples {
    let s = (2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32;
    an.push_sample(s);
  }
}

#[test]
fn analyzer_peaks_at_tone_frequency() {
  let sr = 48000.0;
  let mut an = StftAnalyzer::new(FFT_MID, sr);
  feed_tone(&mut an, sr, 1000.0, FFT_MID * 6);
  assert!(an.ready());
  let on = an.psd_at(1000.0);
  let off = an.psd_at(300.0);
  assert!(on > off * 100.0, "tone PSD {on} should dominate off-tone {off}");
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml analyzer_peaks_at_tone -- --nocapture`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/dsp/spectrum_bank.rs
git commit -m "feat(spectrum): single-size STFT analyzer producing per-bin PSD"
```

---

## Task 3: Multi-resolution bank with crossfaded crossovers

**Files:**
- Modify: `src-tauri/src/dsp/spectrum_bank.rs`

`MultiResBank` owns three analyzers and the grid. For each grid frequency it blends the two relevant analyzers' PSD across the crossover regions, returning one PSD-dB row (before weighting/slope/smoothing).

- [ ] **Step 1: Write the failing test**

Append the type to `spectrum_bank.rs`:

```rust
pub struct MultiResBank {
  big: StftAnalyzer,
  mid: StftAnalyzer,
  small: StftAnalyzer,
  grid: LogGrid,
}

impl MultiResBank {
  pub fn new(sample_rate: f64, min_hz: f64, max_hz: f64) -> Self {
    Self {
      big: StftAnalyzer::new(FFT_BIG, sample_rate),
      mid: StftAnalyzer::new(FFT_MID, sample_rate),
      small: StftAnalyzer::new(FFT_SMALL, sample_rate),
      grid: LogGrid::new(min_hz, max_hz),
    }
  }

  pub fn grid_freqs(&self) -> &[f64] {
    &self.grid.freqs
  }

  pub fn ready(&self) -> bool {
    // Largest FFT gates readiness; it fills last.
    self.big.ready()
  }

  pub fn push_sample(&mut self, s: f32) {
    self.big.push_sample(s);
    self.mid.push_sample(s);
    self.small.push_sample(s);
  }

  /// Blend weight in [0,1] for the *upper* analyzer of a crossover at `xover_hz`.
  /// 0 below the fade band (use lower analyzer), 1 above it (use upper analyzer).
  fn blend(hz: f64, xover_hz: f64) -> f64 {
    let lo = xover_hz * 2_f64.powf(-XFADE_HALF_OCT);
    let hi = xover_hz * 2_f64.powf(XFADE_HALF_OCT);
    if hz <= lo {
      0.0
    } else if hz >= hi {
      1.0
    } else {
      (hz.log2() - lo.log2()) / (hi.log2() - lo.log2())
    }
  }

  /// PSD-dB per grid point, combining the three analyzers. `cal_offset_db` is added here.
  pub fn psd_db_row(&self, cal_offset_db: f64) -> Vec<f64> {
    self
      .grid
      .freqs
      .iter()
      .map(|&f| {
        // Low/mid blend then mid/high blend, all in linear PSD.
        let b_lo = Self::blend(f, XOVER_LO_HZ); // 0=big, 1=mid
        let lowmid = self.big.psd_at(f) * (1.0 - b_lo) + self.mid.psd_at(f) * b_lo;
        let b_hi = Self::blend(f, XOVER_HI_HZ); // 0=lowmid(mid), 1=small
        let psd = lowmid * (1.0 - b_hi) + self.small.psd_at(f) * b_hi;
        10.0 * psd.max(1e-20).log10() + cal_offset_db
      })
      .collect()
  }
}
```

Add the test inside `mod tests`:

```rust
fn feed_bank_tone(bank: &mut MultiResBank, sr: f64, hz: f64, samples: usize) {
  for i in 0..samples {
    bank.push_sample((2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32);
  }
}

#[test]
fn bank_resolves_close_low_tones() {
  let sr = 48000.0;
  let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
  // 60 Hz + 70 Hz simultaneously — a 4096 FFT (11.7 Hz bins) blurs these together.
  for i in 0..FFT_BIG * 4 {
    let t = i as f64 / sr;
    let s = ((2.0 * std::f64::consts::PI * 60.0 * t).sin()
      + (2.0 * std::f64::consts::PI * 70.0 * t).sin()) as f32;
    bank.push_sample(s);
  }
  assert!(bank.ready());
  let row = bank.psd_db_row(0.0);
  let freqs = bank.grid_freqs();
  let val_at = |target: f64| {
    let (idx, _) = freqs
      .iter()
      .enumerate()
      .min_by(|(_, a), (_, b)| (**a - target).abs().partial_cmp(&(**b - target).abs()).unwrap())
      .unwrap();
    row[idx]
  };
  // Both tones present; the 65 Hz midpoint is a dip between two resolved peaks.
  assert!(val_at(60.0) > val_at(65.0) + 3.0, "60 Hz peak not resolved");
  assert!(val_at(70.0) > val_at(65.0) + 3.0, "70 Hz peak not resolved");
}

#[test]
fn bank_broadband_continuous_across_crossovers() {
  let sr = 48000.0;
  let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
  // Deterministic pseudo-white noise.
  let mut x: u32 = 0x12345678;
  for _ in 0..FFT_BIG * 8 {
    x = x.wrapping_mul(1664525).wrapping_add(1013904223);
    let s = ((x >> 8) as f32 / 8_388_608.0) - 1.0;
    bank.push_sample(s);
  }
  assert!(bank.ready());
  let row = bank.psd_db_row(0.0);
  let freqs = bank.grid_freqs();
  let near = |t: f64| {
    freqs
      .iter()
      .enumerate()
      .min_by(|(_, a), (_, b)| (**a - t).abs().partial_cmp(&(**b - t).abs()).unwrap())
      .map(|(i, _)| row[i])
      .unwrap()
  };
  // White-noise PSD is ~flat; no large step across either crossover.
  assert!((near(180.0) - near(220.0)).abs() < 3.0, "seam at 200 Hz");
  assert!((near(1800.0) - near(2200.0)).abs() < 3.0, "seam at 2 kHz");
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml bank_ -- --nocapture`
Expected: PASS for both `bank_resolves_close_low_tones` and `bank_broadband_continuous_across_crossovers`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/dsp/spectrum_bank.rs
git commit -m "feat(spectrum): multi-resolution PSD bank with crossfaded crossovers"
```

---

## Task 4: Calibration offset (0 dBFS sine ≈ 0 dB)

**Files:**
- Modify: `src-tauri/src/dsp/spectrum_bank.rs`

Absolute dB is display-referenced. Pick `CAL_OFFSET_DB` so a full-scale sine in the MID region reads ≈0 dB. The exact value depends on Hann normalization and bin width; the test pins it.

- [ ] **Step 1: Add the constant**

At the top of `spectrum_bank.rs`:

```rust
/// Display calibration: added to PSD-dB so a 0 dBFS sine peak reads ~0 dB.
/// Empirically tuned; pinned by `calibration_full_scale_sine_near_zero`.
pub const CAL_OFFSET_DB: f64 = 16.5;
```

- [ ] **Step 2: Write the failing test**

Add inside `mod tests`:

```rust
#[test]
fn calibration_full_scale_sine_near_zero() {
  let sr = 48000.0;
  let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
  feed_bank_tone(&mut bank, sr, 1000.0, FFT_BIG * 6); // amplitude 1.0 = 0 dBFS
  assert!(bank.ready());
  let row = bank.psd_db_row(CAL_OFFSET_DB);
  let peak = row.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
  assert!(
    (peak - 0.0).abs() < 1.5,
    "0 dBFS sine peak should read ~0 dB, got {peak} (adjust CAL_OFFSET_DB)"
  );
}
```

- [ ] **Step 3: Run and calibrate**

Run: `cargo test --manifest-path src-tauri/Cargo.toml calibration_full_scale -- --nocapture`
Expected: PASS. If it fails, the assert message prints the measured peak; set `CAL_OFFSET_DB += (0.0 - peak)` and re-run once. This is a one-time calibration, not a tuning loop.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/dsp/spectrum_bank.rs
git commit -m "feat(spectrum): calibrate display offset to 0 dBFS reference"
```

---

## Task 5: Rewire SpectrumMeter onto the grid

**Files:**
- Modify: `src-tauri/src/dsp/spectrum.rs`

Replace the RTA band machinery with the bank. Keep weighting, slope (default 4.5), octave smoothing (1/24), attack/release, and peak-hold — now per grid point. `band_centers()` returns the grid frequencies, so the payload contract is unchanged.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)]` block in `spectrum.rs`:

```rust
#[test]
fn default_slope_tilts_curve_upward() {
  let sr = 48000.0;
  let mut m = SpectrumMeter::new(sr);
  // White-ish noise on both channels.
  let mut x: u32 = 0xC0FFEE;
  let frames = FFT_BIG_FRAMES_FOR_TEST; // see note below
  let mut pcm = vec![0.0_f32; frames * 2];
  for i in 0..frames {
    x = x.wrapping_mul(1664525).wrapping_add(1013904223);
    let s = ((x >> 8) as f32 / 8_388_608.0) - 1.0;
    pcm[i * 2] = s;
    pcm[i * 2 + 1] = s;
  }
  let mut out = None;
  for _ in 0..4 {
    out = m.push_interleaved(&pcm, 2, 1.0);
  }
  let (smooth, _) = out.expect("spectrum output");
  let centers = m.band_centers();
  let val_near = |t: f64| {
    let (i, _) = centers
      .iter()
      .enumerate()
      .min_by(|(_, a), (_, b)| (**a - t).abs().partial_cmp(&(**b - t).abs()).unwrap())
      .unwrap();
    smooth[i]
  };
  // White noise is flat in PSD; +4.5 dB/oct slope makes 10 kHz read clearly above 100 Hz.
  let octaves = (10000.0_f64 / 100.0).log2();
  let delta = val_near(10000.0) - val_near(100.0);
  assert!(delta > 4.5 * octaves * 0.6, "slope not applied: delta={delta}");
}
```

Note: define `const FFT_BIG_FRAMES_FOR_TEST: usize = 16384 * 6;` near the test, or inline the literal. The loop feeds enough frames to fill the largest ring.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml default_slope_tilts -- --nocapture`
Expected: FAIL (current engine still uses RTA bands; `tilt` default is 0).

- [ ] **Step 3: Replace the engine internals**

In `spectrum.rs`:

1. Add `use crate::dsp::spectrum_bank::{MultiResBank, CAL_OFFSET_DB};`.
2. In the `SpectrumMeter` struct, remove the RTA-specific fields (`bands`, ring buffers, `scratch_*`, `window`, `band_power_hist`, `r2c`, `ring_*`) and add:

```rust
bank: MultiResBank,
```

Keep `smooth_db`, `peak_db`, `peak_hold_until`, `last_time_sec`, `sample_rate`, `weighting`, `attack_ms`, `release_ms`, `peak_hold_sec`, `peak_decay_db_per_sec`, `tilt_db_per_octave`, `min_hz`, `max_hz`, `last_input_channels`, `cached_*`.

3. In `new`, set `min_hz = 20.0`, `max_hz = 20000.0_f64.min(sample_rate * 0.499)`, build `bank: MultiResBank::new(sample_rate, min_hz, max_hz)`, and **set `tilt_db_per_octave: 4.5`**.

4. Replace `compute_band_linear_powers` / `push_stft_power_row` with a single post-processor that reads the bank's PSD-dB row and applies weighting + slope + octave smoothing:

```rust
const OCTAVE_SMOOTH: f64 = 1.0 / 24.0;

fn post_process(&self) -> Vec<f64> {
  let centers = self.bank.grid_freqs();
  let raw = self.bank.psd_db_row(CAL_OFFSET_DB);
  let min_f = self.min_hz.max(20.0);
  let log_min_f = min_f.log2();
  // weighting + slope
  let mut shaped = Vec::with_capacity(raw.len());
  for (i, &db) in raw.iter().enumerate() {
    let f = centers[i];
    let oct = f.max(min_f).log2() - log_min_f;
    shaped.push(db + weighting_db(f, &self.weighting) + self.tilt_db_per_octave * oct);
  }
  smooth_octave(&shaped, centers, OCTAVE_SMOOTH)
}
```

5. Add a log-domain octave smoother (Gaussian over a ±half-octave window; replaces the old fixed 3-tap kernel):

```rust
/// Gaussian smoothing in the log-frequency domain; `frac_oct` ~ stddev in octaves.
fn smooth_octave(db: &[f64], freqs: &[f64], frac_oct: f64) -> Vec<f64> {
  if db.len() < 3 {
    return db.to_vec();
  }
  // Grid is uniform in log2(f); convert the octave width to a point radius.
  let pts_per_oct = 1.0 / (freqs[1].log2() - freqs[0].log2());
  let sigma = (frac_oct * pts_per_oct).max(0.5);
  let radius = (sigma * 3.0).ceil() as isize;
  let mut out = vec![0.0_f64; db.len()];
  for i in 0..db.len() {
    let mut acc = 0.0;
    let mut wsum = 0.0;
    for d in -radius..=radius {
      let j = (i as isize + d).clamp(0, db.len() as isize - 1) as usize;
      let w = (-0.5 * (d as f64 / sigma).powi(2)).exp();
      acc += db[j] * w;
      wsum += w;
    }
    out[i] = acc / wsum;
  }
  out
}
```

6. Rewrite `push_interleaved` to feed the bank and gate on `bank.ready()`:

```rust
pub fn push_interleaved(&mut self, interleaved: &[f32], channels: u16, now_sec: f64)
  -> Option<(Vec<f64>, Vec<f64>)> {
  let ch = channels.max(1) as usize;
  if self.last_input_channels != ch {
    self.bank = MultiResBank::new(self.sample_rate, self.min_hz, self.max_hz);
    self.last_input_channels = ch;
    self.smooth_db.clear();
    self.peak_db.clear();
  }
  let frames = interleaved.len() / ch;
  for i in 0..frames {
    let base = i * ch;
    // Mono/stereo: stereo-average. Multichannel: summed across channels (see Task 8).
    let s = if ch == 1 {
      interleaved[base]
    } else {
      0.5 * (interleaved[base] + interleaved[base + 1])
    };
    self.bank.push_sample(s);
  }
  if !self.bank.ready() {
    return None;
  }
  let incoming = self.post_process();
  let delta_sec = if self.last_time_sec > 0.0 {
    (now_sec - self.last_time_sec).clamp(1.0 / 240.0, 0.25)
  } else {
    1.0 / 60.0
  };
  self.last_time_sec = now_sec;
  if self.smooth_db.len() != incoming.len() {
    self.smooth_db = incoming.clone();
    self.peak_db = incoming.clone();
    self.peak_hold_until = vec![now_sec; incoming.len()];
  }
  let atk = 1.0 - (-delta_sec / (self.attack_ms / 1000.0).max(0.001)).exp();
  let rel = 1.0 - (-delta_sec / (self.release_ms / 1000.0).max(0.001)).exp();
  for (i, &inc) in incoming.iter().enumerate() {
    let prev = self.smooth_db[i];
    let alpha = if inc > prev { atk } else { rel };
    self.smooth_db[i] = prev + (inc - prev) * alpha;
    let sm = self.smooth_db[i];
    if sm >= self.peak_db[i] {
      self.peak_db[i] = sm;
      self.peak_hold_until[i] = now_sec + self.peak_hold_sec;
    } else if now_sec > self.peak_hold_until[i] {
      self.peak_db[i] = sm.max(self.peak_db[i] - self.peak_decay_db_per_sec * delta_sec);
    }
  }
  Some((self.smooth_db.clone(), self.peak_db.clone()))
}
```

7. Change `band_centers` to return the grid:

```rust
pub fn band_centers(&self) -> Vec<f64> {
  self.bank.grid_freqs().to_vec()
}
```

8. Keep `push_mono_duplex`, `push_selected`, `reset`, and the `Meter` impl as-is (they call `push_interleaved` / rebuild from `new`). `push_selected` still synthesizes a 2-ch buffer; multichannel summing is handled in Task 8.

- [ ] **Step 4: Run the new test plus the existing spectrum tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml spectrum -- --nocapture`
Expected: `default_slope_tilts_curve_upward` PASS. Delete or port the now-obsolete RTA-only tests in `spectrum.rs` (`bin_edges_tile_nyquist`, `fractional_band_power_differs_across_adjacent_low_rta_bands`) — their helpers (`bin_hz_edges`, `overlap_weight`, `build_rta_bands`) are removed. Keep `push_selected_*` and the multichannel test (the latter is updated in Task 8).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dsp/spectrum.rs
git commit -m "feat(spectrum): drive display from multi-resolution bank with 4.5 dB/oct slope"
```

---

## Task 6: Verify payload & SVG path on the denser grid

**Files:**
- Read: `src-tauri/src/dsp/paths.rs`, `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Confirm paths.rs is grid-agnostic**

Read `paths.rs`. It maps each `(center, db)` to `(x, y)` via `freq → x` and `spectrum_db_to_y_viewbox`. Confirm it loops over the input slices with no hardcoded length. Expected: no change needed (it already takes arbitrary-length `centers`/`smooth_db`/`peak_db`).

- [ ] **Step 2: Confirm meter_pipeline emits grid centers**

Read `meter_pipeline.rs` around lines 320-405. It reads `last_output()` / `band_centers()` and writes `spectrum_band_centers_hz`. Confirm it copies the slice without assuming a band count. Expected: no change needed.

- [ ] **Step 3: Run the Rust suite end-to-end**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (no compile errors from removed fields/functions anywhere in the crate).

- [ ] **Step 4: Commit (only if edits were required)**

```bash
git add src-tauri/src/dsp/paths.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "chore(spectrum): confirm payload/path handle dense grid"
```

If no edits were needed, skip this commit.

---

## Task 7: JS render path trusts payload frequencies

**Files:**
- Modify: `src/lib/FrameIntake.js`
- Test: `src/lib/FrameIntake.test.js`

The engine now sends ~960 grid frequencies in `spectrumBandCentersHz`, which will never equal a `buildRtaBands` count. Make the snapshot builder use the payload frequencies directly.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/FrameIntake.test.js`:

```js
import { buildSpectrumDataSnapshot } from "./FrameIntake.js";

it("uses payload grid frequencies, not recomputed RTA bands", () => {
  const centers = Array.from({ length: 958 }, (_, i) => 20 * Math.pow(2, (i / 957) * Math.log2(1000)));
  const dbList = centers.map(() => -50);
  const out = buildSpectrumDataSnapshot(
    { spectrumBandCentersHz: centers, spectrumSmoothDb: dbList },
    { defaultSampleRate: 48000 }
  );
  expect(out.bands.length).toBe(centers.length);
  expect(out.bands[0].fCenter).toBeCloseTo(centers[0]);
  expect(out.dbList.length).toBe(dbList.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/FrameIntake.test.js`
Expected: FAIL (current code returns `buildRtaBands` geometry whose length ≠ 958).

- [ ] **Step 3: Simplify `buildSpectrumDataSnapshot`**

Replace the body in `src/lib/FrameIntake.js` with payload-driven geometry:

```js
export function buildSpectrumDataSnapshot(row) {
  const centers = row.spectrumBandCentersHz || [];
  const dbList = row.spectrumSmoothDb || [];
  return {
    bands: getBandsFromCenters(centers),
    dbList: [...dbList],
  };
}
```

Update the two call sites that pass `{ defaultSampleRate }` — the second arg is now unused; leave the calls or drop the arg. In `pushVisualHistRow`, replace the `getRtaBands(...)` spectrum push with payload centers:

```js
this._visualSpectrumHist.push({
  bands: getBandsFromCenters(row.spectrumBandCentersHz ?? []),
  dbList: [...(row.spectrumSmoothDb ?? [])],
  timestampMs: row.timestampMs,
});
```

Remove the now-unused `buildRtaBands` / `SPECTRUM_SETTINGS` imports and the `getRtaBands` helper **only if** no other consumer in the file uses them (grep first). Leave `getBandsFromCenters` in place.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/FrameIntake.test.js`
Expected: PASS. Also run the broader suite: `npm test -- src/lib src/hooks` and fix any snapshot/length assumptions that referenced RTA band counts.

- [ ] **Step 5: Commit**

```bash
git add src/lib/FrameIntake.js src/lib/FrameIntake.test.js
git commit -m "feat(spectrum): render from engine grid frequencies in JS path"
```

---

## Task 8: Multichannel summed-power on the grid

**Files:**
- Modify: `src-tauri/src/dsp/spectrum.rs`

For N>2 the curve must represent summed power across channels (preserve current semantics: ~+6 dB for 4 identical channels vs stereo-average). The bank consumes one mono stream, so sum channel samples before pushing.

- [ ] **Step 1: Port the failing test**

Update the existing `multichannel_summed_curve_is_louder_than_stereo_average` test in `spectrum.rs` to read from `band_centers()` + the returned `smooth` (it already compares peak dB of a 4-ch vs 2-ch run; keep the `diff > 5.0 && diff < 7.5` assertion).

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml multichannel_summed -- --nocapture`
Expected: FAIL — Task 5's `push_interleaved` uses only the first two channels for the stereo-average branch, so 4-ch and 2-ch read the same.

- [ ] **Step 3: Sum channels for N>2**

In `push_interleaved`, replace the per-frame sample selection:

```rust
let s = match ch {
  1 => interleaved[base],
  2 => 0.5 * (interleaved[base] + interleaved[base + 1]),
  _ => {
    // Summed energy across channels → ~+3 dB per doubling, matching prior semantics.
    let mut acc = 0.0_f32;
    for c in 0..ch {
      acc += interleaved[base + c];
    }
    acc
  }
};
```

Note: summing time-domain samples of identical channels gives +6 dB amplitude for 4 vs 2; PSD scales with power, preserving the existing `+6 dB` expectation for correlated channels. `push_selected` (N>2 routing) still synthesizes a 2-ch buffer for explicit channel selection and is unaffected.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml multichannel_summed -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dsp/spectrum.rs
git commit -m "feat(spectrum): sum channel power for multichannel curve on grid"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, no warnings about unused removed symbols.

- [ ] **Step 2: JS suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Lint/format**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `npm run lint` (if present).
Expected: clean.

- [ ] **Step 4: Manual verification (build + run the app)**

Run the app (per the project's run skill / `npm run tauri dev`). With a real input:

1. Feed/play a 0 dBFS sine → its peak sits at ≈0 dB on the spectrum.
2. Play pink noise → curve reads a gentle, roughly-flat-to-slightly-tilted shape; inspect 200 Hz and 2 kHz for visible seams (should be none).
3. Compare a real mix's bass detail against the previous build — low end is visibly finer.
4. Confirm the curve animates smoothly (attack/release) and the peak overlay behaves as before.

- [ ] **Step 5: Final commit (if fmt/lint applied changes)**

```bash
git add -A
git commit -m "chore(spectrum): fmt + lint after multi-resolution rewrite"
```

---

## Self-review notes

- **Spec coverage:** multi-res bank (Tasks 2-3), PSD combination (Task 3), log grid (Task 1), +4.5 slope default (Task 5), octave smoothing 1/24 (Task 5), calibration (Task 4), payload unchanged (Task 6), JS trusts grid (Task 7), multichannel summed (Task 8), tests + manual (Task 9). All spec sections map to a task.
- **Types consistent:** `MultiResBank::new(sample_rate, min_hz, max_hz)`, `grid_freqs()`, `psd_db_row(cal_offset_db)`, `ready()`, `push_sample()`; `StftAnalyzer::psd_at()`, `bin_width_hz()`; `SpectrumMeter::band_centers()` returns grid — used identically across Tasks 3, 5, 6, 8.
- **Removed symbols:** `bin_hz_edges`, `overlap_weight`, `build_rta_bands`, `smooth_by_kernel`, `compute_band_linear_powers`, `push_stft_power_row` and their tests are deleted in Task 5; Task 6 Step 3 (`cargo test`) catches any stragglers.
