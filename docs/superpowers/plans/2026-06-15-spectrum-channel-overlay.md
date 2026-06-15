# Spectrum channel overlay (M/S + L/R) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-panel view mode (`combined` / `lr` / `ms`) that overlays up to two spectrum curves (M vs S, or L vs R) for any channel pair, in both live and snapshot modes.

**Architecture:** Two orthogonal axes — the existing `spectrumChannel` picks the source group (a `Pair` or `Single`); a new `spectrumView` decides how that group renders. The Rust engine runs a second `MultiResBank` only when the view is `lr`/`ms`, emitting an optional secondary curve (`spectrum_path_b` + `spectrum_smooth_db_b`) alongside the existing primary one. JS threads the secondary curve through the live frame, the snapshot history rings, hover HUD, and a small legend.

**Tech Stack:** Rust (DSP in `src-tauri/src/dsp`, pipeline in `src-tauri/src/engine`, IPC `tauri::command`), React/JS frontend (Vitest), CSS-variable theming.

**Spec:** `docs/superpowers/specs/2026-06-15-spectrum-channel-overlay-design.md`

**M/S scaling:** `M = (x+y)/2`, `S = (x−y)/2` (M is identical to the current `combined` average, so toggling `combined`↔`ms` leaves M still).

---

## File Structure

**Rust (create / modify):**
- `src-tauri/src/dsp/channel_sel.rs` — add `SpectrumView` enum next to `SpectrumChannelSel`.
- `src-tauri/src/dsp/mod.rs` — re-export `SpectrumView`.
- `src-tauri/src/dsp/meter.rs` — add `spectrum_view` to `PcmContext`.
- `src-tauri/src/dsp/spectrum.rs` — second bank + secondary smooth/peak; multi-curve output.
- `src-tauri/src/dsp/paths.rs` — (unchanged; reused to build the B path from B dB).
- `src-tauri/src/ipc/types.rs` — `spectrum_path_b` + `spectrum_smooth_db_b` on `AudioFramePayload`; `spectrum_smooth_db_b` on `MeterHistoryEntry` and `VisualHistEntry`.
- `src-tauri/src/ipc/commands.rs` — `set_spectrum_view` command.
- `src-tauri/src/state.rs` — `spectrum_view: Arc<Mutex<SpectrumView>>`.
- `src-tauri/src/audio/capture.rs` + `platform_backend.rs` + `macos/mod.rs` + `cpal_backend.rs` — thread `spectrum_view` into the capture session (mirror `spectrum_channel`).
- `src-tauri/src/engine/meter_pipeline.rs` — read `spectrum_view`, build B path, populate B fields on frame + history entries.
- `src-tauri/src/lib.rs` — register `set_spectrum_view` in the invoke handler.

**JS (modify):**
- `src/lib/panelControls.js` — `spectrumView` default + normalize.
- `src/ipc/commands.js` — `setSpectrumView`.
- `src/lib/FrameIntake.js` — thread `dbListB` through spectrum data + visual ring.
- `src/lib/tauriFrameApply.js` — set the live B path.
- `src/lib/snapshotResolve.js` — resolve `spectrumSnapDbListB`.
- `src/hooks/useSnapshot.js` — build `displaySpectrumPathB`.
- `src/math/spectrumChannelViewOptions.js` (create) — view-option helpers + visibility.
- `src/components/PanelHeaderControls.jsx` — render the view toggle (incl. stereo).
- `src/components/panels/SpectrumPanel.jsx` — render the 2nd curve, 2-row hover, legend.
- `src/theme/builtinThemes.js` + `builtinThemes.test.js` — `strokeLiveB` / `strokeSnapB`.
- `src/preferences/applyDocumentTheme.js` — emit the two new CSS vars.
- `src/App.jsx` — `spectrumView` state/ref/IPC wiring; expose B paths + view props.
- `src/workspace/AudioDataContext.jsx` (or wherever the context value is assembled) — pass through `displaySpectrumPathB` and view props (follow the existing `displaySpectrumPath` wiring in App.jsx).

---

## Phase A — Rust engine: second bank + multi-curve output

### Task A1: `SpectrumView` enum

**Files:**
- Modify: `src-tauri/src/dsp/channel_sel.rs`
- Modify: `src-tauri/src/dsp/mod.rs`

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/dsp/channel_sel.rs`:

```rust
#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn spectrum_view_default_is_combined() {
    assert_eq!(SpectrumView::default(), SpectrumView::Combined);
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p plvs spectrum_view_default_is_combined`
Expected: FAIL — `SpectrumView` not found.

- [ ] **Step 3: Implement the enum**

Add to `src-tauri/src/dsp/channel_sel.rs` (above the existing `tests` module):

```rust
/// How a selected channel pair is rendered in the spectrum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpectrumView {
  /// Two channels averaged into one curve (default; identical to the historical behaviour).
  Combined,
  /// The two raw channels overlaid as two curves.
  Lr,
  /// Mid = (x+y)/2 and Side = (x−y)/2 overlaid as two curves.
  Ms,
}

impl Default for SpectrumView {
  fn default() -> Self {
    Self::Combined
  }
}
```

In `src-tauri/src/dsp/mod.rs`, find the line re-exporting `SpectrumChannelSel` and add `SpectrumView` to it (e.g. `pub use channel_sel::{SpectrumChannelSel, SpectrumView};`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p plvs spectrum_view_default_is_combined`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dsp/channel_sel.rs src-tauri/src/dsp/mod.rs
git commit -m "feat(spectrum): add SpectrumView enum (combined/lr/ms)"
```

---

### Task A2: Thread `spectrum_view` into `PcmContext`

**Files:**
- Modify: `src-tauri/src/dsp/meter.rs`

- [ ] **Step 1: Add the field**

In `src-tauri/src/dsp/meter.rs`, add the import and field:

```rust
use crate::dsp::channel_sel::{SpectrumChannelSel, SpectrumView};
```

Add to `PcmContext` after `spectrum_channel`:

```rust
  pub spectrum_view: SpectrumView,
```

- [ ] **Step 2: Verify it compiles (callers updated later)**

Run: `cargo build -p plvs`
Expected: FAIL — `meter_pipeline.rs` constructs `PcmContext` without `spectrum_view`. That is fixed in Task B4. To keep this task self-contained, temporarily add `spectrum_view: SpectrumView::default(),` to the `PcmContext { … }` literal in `src-tauri/src/engine/meter_pipeline.rs` (around line 195) and `use crate::dsp::SpectrumView;` at the top.

Run: `cargo build -p plvs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/dsp/meter.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(spectrum): add spectrum_view to PcmContext"
```

---

### Task A3: Second bank + secondary curve in `SpectrumMeter`

**Files:**
- Modify: `src-tauri/src/dsp/spectrum.rs`

This is the core engine change. The envelope/peak logic currently inlined in `push_interleaved` is factored into a helper that runs against one bank's state, then we drive one or two banks depending on the view.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src-tauri/src/dsp/spectrum.rs`:

```rust
  #[test]
  fn combined_view_has_no_secondary() {
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    let frames = 16384 * 4;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = s;
    }
    for _ in 0..2 {
      m.push_pair(&pcm, 2, 1.0, SpectrumChannelSel::Pair(0, 1), SpectrumView::Combined);
    }
    assert!(m.last_output_secondary().is_none());
  }

  #[test]
  fn ms_view_side_is_silent_for_mono_signal() {
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    // identical L and R (centered mono) → M has energy, S ~ silent
    let frames = 16384 * 6;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = s;
    }
    for _ in 0..2 {
      m.push_pair(&pcm, 2, 1.0, SpectrumChannelSel::Pair(0, 1), SpectrumView::Ms);
    }
    let (centers, m_smooth, _) = m.last_output();
    let (s_smooth, _) = m.last_output_secondary().expect("ms has a secondary curve");
    assert_eq!(s_smooth.len(), centers.len());
    let m_peak = m_smooth.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let s_peak = s_smooth.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    assert!(m_peak > s_peak + 40.0, "M should dominate S for a centered signal: M={m_peak} S={s_peak}");
  }

  #[test]
  fn ms_mid_matches_combined() {
    // M = (x+y)/2 is exactly the combined average, so the M curve must match Combined.
    let sr = 48000.0;
    let frames = 16384 * 6;
    let mut pcm = vec![0.0_f32; frames * 2];
    let mut x: u32 = 0x1234_5678;
    for i in 0..frames {
      x = x.wrapping_mul(1664525).wrapping_add(1013904223);
      let l = ((x >> 8) as f32 / 8_388_608.0) - 1.0;
      x = x.wrapping_mul(1664525).wrapping_add(1013904223);
      let r = ((x >> 8) as f32 / 8_388_608.0) - 1.0;
      pcm[i * 2] = l;
      pcm[i * 2 + 1] = r;
    }
    let mut comb = SpectrumMeter::new(sr);
    let mut ms = SpectrumMeter::new(sr);
    for _ in 0..3 {
      comb.push_pair(&pcm, 2, 1.0, SpectrumChannelSel::Pair(0, 1), SpectrumView::Combined);
      ms.push_pair(&pcm, 2, 1.0, SpectrumChannelSel::Pair(0, 1), SpectrumView::Ms);
    }
    let (_, comb_smooth, _) = comb.last_output();
    let (_, mid_smooth, _) = ms.last_output();
    assert_eq!(comb_smooth.len(), mid_smooth.len());
    for (a, b) in comb_smooth.iter().zip(mid_smooth.iter()) {
      assert!((a - b).abs() < 1e-6, "M must equal Combined: {a} vs {b}");
    }
  }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p plvs --lib spectrum::`
Expected: FAIL — `push_pair` and `last_output_secondary` do not exist.

- [ ] **Step 3: Implement the second bank + helper**

In `src-tauri/src/dsp/spectrum.rs`:

(a) Add the import:

```rust
use crate::dsp::{SpectrumChannelSel, SpectrumView};
```
(replace the existing `use crate::dsp::SpectrumChannelSel;`).

(b) Add secondary state to the struct (after the primary fields `cached_peak`):

```rust
  /// Secondary curve state (only used for Lr/Ms views).
  bank_b: Option<MultiResBank>,
  smooth_db_b: Vec<f64>,
  peak_db_b: Vec<f64>,
  peak_hold_until_b: Vec<f64>,
  cached_smooth_b: Vec<f64>,
  cached_peak_b: Vec<f64>,
  has_secondary: bool,
```

Initialise them in `new()`:

```rust
      bank_b: None,
      smooth_db_b: Vec::new(),
      peak_db_b: Vec::new(),
      peak_hold_until_b: Vec::new(),
      cached_smooth_b: Vec::new(),
      cached_peak_b: Vec::new(),
      has_secondary: false,
```

(c) Factor the envelope update into a free helper (place above `impl SpectrumMeter`):

```rust
/// Apply attack/release smoothing + peak-hold for one bank's incoming dB row.
/// Mutates `smooth`, `peak`, `hold_until` in place (resizing on first use).
#[allow(clippy::too_many_arguments)]
fn apply_envelope(
  incoming: &[f64],
  smooth: &mut Vec<f64>,
  peak: &mut Vec<f64>,
  hold_until: &mut Vec<f64>,
  now_sec: f64,
  delta_sec: f64,
  attack_ms: f64,
  release_ms: f64,
  peak_hold_sec: f64,
  peak_decay_db_per_sec: f64,
) {
  if smooth.len() != incoming.len() {
    *smooth = incoming.to_vec();
    *peak = incoming.to_vec();
    *hold_until = vec![now_sec; incoming.len()];
    return;
  }
  let atk = 1.0 - (-delta_sec / (attack_ms / 1000.0).max(0.001)).exp();
  let rel = 1.0 - (-delta_sec / (release_ms / 1000.0).max(0.001)).exp();
  for (i, &inc) in incoming.iter().enumerate() {
    let prev = smooth[i];
    let alpha = if inc > prev { atk } else { rel };
    smooth[i] = prev + (inc - prev) * alpha;
    let sm = smooth[i];
    if sm >= peak[i] {
      peak[i] = sm;
      hold_until[i] = now_sec + peak_hold_sec;
    } else if now_sec > hold_until[i] {
      peak[i] = sm.max(peak[i] - peak_decay_db_per_sec * delta_sec);
    }
  }
}
```

(d) Add a `post_process_for(bank)` that runs the existing shaping against an arbitrary bank (refactor `post_process` to delegate):

```rust
  fn post_process_for(&self, bank: &MultiResBank) -> Vec<f64> {
    let centers = bank.grid_freqs();
    let raw = bank.psd_db_row(CAL_OFFSET_DB);
    let log_pivot = SLOPE_PIVOT_HZ.log2();
    let mut shaped = Vec::with_capacity(raw.len());
    for (i, &db) in raw.iter().enumerate() {
      let f = centers[i];
      let oct = f.log2() - log_pivot;
      shaped.push(db + weighting_db(f, &self.weighting) + self.tilt_db_per_octave * oct);
    }
    shaped
  }
```

Replace the body of the existing `post_process` with `self.post_process_for(&self.bank)`.

(e) Add the new `push_pair` entry point. It computes the two per-sample signals for the view, drives one or two banks, and updates the cached outputs. Place it in the `impl SpectrumMeter` block:

```rust
  /// Drive the spectrum for a selected pair under a given view.
  /// Combined/Single → one curve. Lr/Ms → primary + secondary curve.
  pub fn push_pair(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    now_sec: f64,
    sel: SpectrumChannelSel,
    view: SpectrumView,
  ) {
    let ch = channels.max(1) as usize;
    // Singles always collapse to a single combined curve.
    let two_curve = matches!(sel, SpectrumChannelSel::Pair(_, _))
      && matches!(view, SpectrumView::Lr | SpectrumView::Ms);

    if !two_curve {
      // Existing single-curve behaviour.
      let _ = self.push_selected(interleaved, channels, now_sec, sel);
      self.has_secondary = false;
      self.cached_smooth_b.clear();
      self.cached_peak_b.clear();
      return;
    }

    let (xi, yi) = match sel {
      SpectrumChannelSel::Pair(x, y) => ((x as usize).min(ch - 1), (y as usize).min(ch - 1)),
      SpectrumChannelSel::Single(c) => {
        let ci = (c as usize).min(ch - 1);
        (ci, ci)
      }
    };

    // (Re)create banks on channel-count change or first secondary use.
    if self.last_input_channels != ch {
      self.bank = MultiResBank::new(self.sample_rate, self.min_hz, self.max_hz);
      self.last_input_channels = ch;
      self.smooth_db.clear();
      self.peak_db.clear();
      self.bank_b = None;
    }
    if self.bank_b.is_none() {
      self.bank_b = Some(MultiResBank::new(self.sample_rate, self.min_hz, self.max_hz));
      self.smooth_db_b.clear();
      self.peak_db_b.clear();
    }

    let frames = interleaved.len() / ch;
    for i in 0..frames {
      let base = i * ch;
      let x = interleaved[base + xi];
      let y = interleaved[base + yi];
      let (a, b) = match view {
        SpectrumView::Lr => (x, y),
        SpectrumView::Ms => (0.5 * (x + y), 0.5 * (x - y)),
        SpectrumView::Combined => unreachable!(),
      };
      self.bank.push_sample(a);
      if let Some(bb) = self.bank_b.as_mut() {
        bb.push_sample(b);
      }
    }

    let bank_b_ready = self.bank_b.as_ref().map(|b| b.ready()).unwrap_or(false);
    if !self.bank.ready() || !bank_b_ready {
      return;
    }

    let delta_sec = if self.last_time_sec > 0.0 {
      (now_sec - self.last_time_sec).clamp(1.0 / 240.0, 0.25)
    } else {
      1.0 / 60.0
    };
    self.last_time_sec = now_sec;

    let inc_a = self.post_process_for(&self.bank);
    let inc_b = self.post_process_for(self.bank_b.as_ref().unwrap());
    apply_envelope(
      &inc_a, &mut self.smooth_db, &mut self.peak_db, &mut self.peak_hold_until,
      now_sec, delta_sec, self.attack_ms, self.release_ms, self.peak_hold_sec,
      self.peak_decay_db_per_sec,
    );
    apply_envelope(
      &inc_b, &mut self.smooth_db_b, &mut self.peak_db_b, &mut self.peak_hold_until_b,
      now_sec, delta_sec, self.attack_ms, self.release_ms, self.peak_hold_sec,
      self.peak_decay_db_per_sec,
    );

    self.cached_centers = self.band_centers();
    self.cached_smooth = self.smooth_db.clone();
    self.cached_peak = self.peak_db.clone();
    self.cached_smooth_b = self.smooth_db_b.clone();
    self.cached_peak_b = self.peak_db_b.clone();
    self.has_secondary = true;
  }

  /// Secondary `(smooth_db, peak_db)` when the current view emits two curves, else `None`.
  pub fn last_output_secondary(&self) -> Option<(&[f64], &[f64])> {
    if self.has_secondary {
      Some((&self.cached_smooth_b, &self.cached_peak_b))
    } else {
      None
    }
  }
```

(f) Refactor the inline envelope in `push_interleaved` to call `apply_envelope` (so single-curve mode and two-curve mode share one code path). Replace the block from `if self.smooth_db.len() != incoming.len() { … }` through the `for` loop with:

```rust
    apply_envelope(
      &incoming, &mut self.smooth_db, &mut self.peak_db, &mut self.peak_hold_until,
      now_sec, delta_sec, self.attack_ms, self.release_ms, self.peak_hold_sec,
      self.peak_decay_db_per_sec,
    );
    Some((self.smooth_db.clone(), self.peak_db.clone()))
```

(g) Clear secondary caches in `push_interleaved`'s channel-change branch is not required (push_pair owns secondary state), but ensure `reset()` (the `*self = SpectrumMeter::new(sr)` form) already resets everything — it does, since it reconstructs the struct.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p plvs --lib spectrum::`
Expected: PASS (new tests + all existing spectrum tests still green).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dsp/spectrum.rs
git commit -m "feat(spectrum): second bank + secondary curve for lr/ms views"
```

---

### Task A4: Route `push_pcm` through `push_pair`

**Files:**
- Modify: `src-tauri/src/dsp/spectrum.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module:

```rust
  #[test]
  fn push_pcm_ms_populates_secondary() {
    use crate::dsp::meter::{Meter, PcmContext};
    use crate::engine::ChannelLayoutSetting;
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    let frames = 16384 * 6;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      // hard-panned to L so S has energy
      pcm[i * 2] = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
    }
    for _ in 0..2 {
      let ctx = PcmContext {
        interleaved: &pcm,
        channels: 2,
        now_sec: 1.0,
        channel_layout: ChannelLayoutSetting::Auto,
        loudness_weights: None,
        vectorscope_pair: (0, 1),
        spectrum_channel: SpectrumChannelSel::Pair(0, 1),
        spectrum_view: SpectrumView::Ms,
        dialogue_gating: false,
      };
      m.push_pcm(&ctx);
    }
    assert!(m.last_output_secondary().is_some());
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p plvs --lib push_pcm_ms_populates_secondary`
Expected: FAIL — `push_pcm` ignores the view, secondary stays `None`.

- [ ] **Step 3: Rewrite the `Meter::push_pcm` impl**

Replace the body of `fn push_pcm` in `impl Meter for SpectrumMeter` with:

```rust
  fn push_pcm(&mut self, ctx: &PcmContext<'_>) {
    if ctx.channels == 1 {
      let _ = self.push_mono_duplex(ctx.interleaved, ctx.now_sec);
      self.has_secondary = false;
      self.cached_smooth_b.clear();
      self.cached_peak_b.clear();
      if let (c, sm, pk) = (self.band_centers(), self.smooth_db.clone(), self.peak_db.clone()) {
        self.cached_centers = c;
        self.cached_smooth = sm;
        self.cached_peak = pk;
      }
      return;
    }
    self.push_pair(
      ctx.interleaved,
      ctx.channels,
      ctx.now_sec,
      ctx.spectrum_channel,
      ctx.spectrum_view,
    );
  }
```

Note: `push_pair` already updates `cached_*` for the two-curve path; for the single-curve path it delegates to `push_selected`/`push_interleaved` which return the tuple but do **not** set `cached_*`. So the single-curve branch of `push_pair` must also refresh caches. Update the `if !two_curve { … }` block in `push_pair` to:

```rust
    if !two_curve {
      let out = if ch == 1 {
        self.push_mono_duplex(interleaved, now_sec)
      } else {
        self.push_selected(interleaved, channels, now_sec, sel)
      };
      if let Some((sm, pk)) = out {
        self.cached_centers = self.band_centers();
        self.cached_smooth = sm;
        self.cached_peak = pk;
      }
      self.has_secondary = false;
      self.cached_smooth_b.clear();
      self.cached_peak_b.clear();
      return;
    }
```

Then simplify `push_pcm` back to (mono path also handled inside `push_pair` via `ch == 1`):

```rust
  fn push_pcm(&mut self, ctx: &PcmContext<'_>) {
    self.push_pair(
      ctx.interleaved,
      ctx.channels,
      ctx.now_sec,
      ctx.spectrum_channel,
      ctx.spectrum_view,
    );
  }
```

(`push_pair` with `channels == 1` falls into `!two_curve` and calls `push_mono_duplex`, matching the old behaviour.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p plvs --lib spectrum::`
Expected: PASS (including the prior `push_selected_*` tests, which still exercise the single-curve path).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dsp/spectrum.rs
git commit -m "feat(spectrum): route push_pcm through view-aware push_pair"
```

---

## Phase B — Rust payload, pipeline, IPC, state

### Task B1: Payload fields for the secondary curve

**Files:**
- Modify: `src-tauri/src/ipc/types.rs`

- [ ] **Step 1: Add fields**

In `AudioFramePayload`, after `spectrum_smooth_db`:

```rust
  /// Secondary spectrum SVG path (empty unless view is lr/ms).
  pub spectrum_path_b: String,
  /// Secondary smoothed per-band dB (empty unless view is lr/ms).
  pub spectrum_smooth_db_b: Vec<f64>,
```

In `MeterHistoryEntry`, after `spectrum_smooth_db`:

```rust
  /// Secondary smoothed per-band dB for snapshot overlay (empty unless view is lr/ms).
  pub spectrum_smooth_db_b: Vec<f64>,
```

In `VisualHistEntry`, after `spectrum_smooth_db`:

```rust
  /// Secondary smoothed per-band dB for snapshot overlay (empty unless view is lr/ms).
  pub spectrum_smooth_db_b: Vec<f64>,
```

- [ ] **Step 2: Verify it fails to compile**

Run: `cargo build -p plvs`
Expected: FAIL — `meter_pipeline.rs` struct literals are missing the new fields. Fixed in B2.

- [ ] **Step 3: (no code; proceed to B2)**

- [ ] **Step 4: Commit after B2 compiles** (commit together with B2).

---

### Task B2: Pipeline builds the B path + populates B fields

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Build the secondary path next to the primary**

Replace the spectrum-path block (currently around lines 283–293) with:

```rust
    let (centers, smooth, peak) = self.spectrum.last_output();
    let (spath, spk) = if !centers.is_empty() && smooth.len() == centers.len() {
      let pk = if peak.len() == centers.len() { peak } else { smooth };
      spectrum_paths_from_bands(centers, smooth, pk, false)
    } else {
      (String::new(), String::new())
    };
    let (spath_b, smooth_b_vec): (String, Vec<f64>) = match self.spectrum.last_output_secondary() {
      Some((sb, _)) if sb.len() == centers.len() && !centers.is_empty() => {
        let (p, _) = spectrum_paths_from_bands(centers, sb, sb, false);
        (p, sb.to_vec())
      }
      _ => (String::new(), Vec::new()),
    };
    let centers = centers.to_vec();
```

(The existing `let centers = centers.to_vec();` line is replaced by the one above — make sure there is only one.)

- [ ] **Step 2: Populate the history + frame fields**

In the `MeterHistoryEntry { … }` literal (around line 313), after `spectrum_smooth_db: smooth.clone(),` add:

```rust
        spectrum_smooth_db_b: smooth_b_vec.clone(),
```

In the `VisualHistEntry { … }` literal (around line 361), after `spectrum_smooth_db: smooth.clone(),` add:

```rust
          spectrum_smooth_db_b: smooth_b_vec.clone(),
```

In the `AudioFramePayload { … }` literal (around line 399), after `spectrum_smooth_db: smooth,` add:

```rust
      spectrum_path_b: spath_b,
      spectrum_smooth_db_b: smooth_b_vec,
```

- [ ] **Step 3: Build**

Run: `cargo build -p plvs`
Expected: PASS.

- [ ] **Step 4: Run the Rust suite**

Run: `cargo test -p plvs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/types.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(spectrum): emit secondary curve in frame + history payloads"
```

---

### Task B3: `set_spectrum_view` command + state

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/ipc/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/ipc/commands.rs`:

```rust
  #[test]
  fn parse_spectrum_view_maps_strings() {
    use crate::ipc::commands::parse_spectrum_view;
    use crate::dsp::SpectrumView;
    assert_eq!(parse_spectrum_view("combined").unwrap(), SpectrumView::Combined);
    assert_eq!(parse_spectrum_view("lr").unwrap(), SpectrumView::Lr);
    assert_eq!(parse_spectrum_view("ms").unwrap(), SpectrumView::Ms);
    assert!(parse_spectrum_view("bogus").is_err());
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p plvs parse_spectrum_view_maps_strings`
Expected: FAIL — `parse_spectrum_view` not found.

- [ ] **Step 3: Add state, parser, and command**

In `src-tauri/src/state.rs`, find the `spectrum_channel` field on `AppState` and add alongside it:

```rust
  pub spectrum_view: Arc<Mutex<crate::dsp::SpectrumView>>,
```

Initialise it where `spectrum_channel` is initialised (in the same `Default`/`new` constructor):

```rust
      spectrum_view: Arc::new(Mutex::new(crate::dsp::SpectrumView::default())),
```

In `src-tauri/src/ipc/commands.rs`, add a pub parser + command:

```rust
pub fn parse_spectrum_view(s: &str) -> Result<crate::dsp::SpectrumView, String> {
  use crate::dsp::SpectrumView;
  match s {
    "combined" => Ok(SpectrumView::Combined),
    "lr" => Ok(SpectrumView::Lr),
    "ms" => Ok(SpectrumView::Ms),
    other => Err(format!("unknown spectrum_view: {other}")),
  }
}

/// Update spectrum view mode. Applied on the capture thread for subsequent frames.
#[tauri::command]
pub fn set_spectrum_view(view: String, state: State<'_, AppState>) -> Result<(), String> {
  let parsed = parse_spectrum_view(&view)?;
  let mut g = state
    .inner()
    .spectrum_view
    .lock()
    .map_err(|_| "spectrum view lock poisoned".to_string())?;
  *g = parsed;
  Ok(())
}
```

In `src-tauri/src/lib.rs`, add `set_spectrum_view` to the `tauri::generate_handler![…]` list next to `set_spectrum_channel`.

- [ ] **Step 4: Run test + build**

Run: `cargo test -p plvs parse_spectrum_view_maps_strings && cargo build -p plvs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/ipc/commands.rs src-tauri/src/lib.rs
git commit -m "feat(spectrum): add set_spectrum_view IPC command + state"
```

---

### Task B4: Thread `spectrum_view` from state into the capture session

**Files:**
- Modify: `src-tauri/src/ipc/commands.rs` (audio_start)
- Modify: `src-tauri/src/audio/capture.rs`
- Modify: `src-tauri/src/audio/platform_backend.rs`
- Modify: `src-tauri/src/audio/macos/mod.rs`
- Modify: `src-tauri/src/audio/cpal_backend.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

This mirrors exactly how `spectrum_channel` is plumbed. Use the existing `spectrum_channel` parameter as the template at every layer.

- [ ] **Step 1: Find every `spectrum_channel` plumbing site**

Run: `git grep -n "spectrum_channel" src-tauri/src/audio src-tauri/src/engine/meter_pipeline.rs src-tauri/src/ipc/commands.rs`
Expected: a list of `start_session` signatures, the capture thread loop, and the `PcmContext` construction.

- [ ] **Step 2: Add a parallel `spectrum_view` parameter**

At each site that takes `spectrum: Arc<Mutex<SpectrumChannelSel>>`, add a sibling `spectrum_view: Arc<Mutex<SpectrumView>>` parameter and pass it through. In `audio_start` (commands.rs), add before the `start_session` call:

```rust
  let spectrum_view = state.inner().spectrum_view.clone();
```
and pass `spectrum_view` as the new argument.

In the capture thread loop (where `spectrum_channel` is read each block, e.g. `*spectrum.lock().unwrap()`), read the view the same way:

```rust
let spectrum_view = *spectrum_view_arc.lock().unwrap();
```
and set it on the `PcmContext` literal:

```rust
      spectrum_view,
```
(replacing the temporary `spectrum_view: SpectrumView::default(),` added in Task A2).

Add `use crate::dsp::SpectrumView;` imports where needed.

- [ ] **Step 3: Build**

Run: `cargo build -p plvs`
Expected: PASS.

- [ ] **Step 4: Run the Rust suite**

Run: `cargo test -p plvs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/audio src-tauri/src/ipc/commands.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(spectrum): plumb spectrum_view into the capture session"
```

---

## Phase C — JS data model, IPC, persistence

### Task C1: `spectrumView` in panel controls

**Files:**
- Modify: `src/lib/panelControls.js`
- Modify: `src/lib/panelControls.test.js`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/panelControls.test.js`:

```js
import { describe, it, expect } from "vitest";
import { normalizePanelControls, DEFAULT_PANEL_CONTROLS } from "./panelControls.js";

describe("spectrumView normalization", () => {
  it("defaults to combined", () => {
    expect(normalizePanelControls({}).spectrumView).toBe("combined");
    expect(DEFAULT_PANEL_CONTROLS.spectrumView).toBe("combined");
  });
  it("keeps valid values", () => {
    expect(normalizePanelControls({ spectrumView: "ms" }).spectrumView).toBe("ms");
    expect(normalizePanelControls({ spectrumView: "lr" }).spectrumView).toBe("lr");
  });
  it("falls back on garbage", () => {
    expect(normalizePanelControls({ spectrumView: "xyz" }).spectrumView).toBe("combined");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: FAIL — `spectrumView` is undefined.

- [ ] **Step 3: Implement**

In `src/lib/panelControls.js`:

Add to `DEFAULT_PANEL_CONTROLS` (after `spectrumChannel`):

```js
  spectrumView: "combined",
```

Add a normalizer:

```js
const SPECTRUM_VIEWS = new Set(["combined", "lr", "ms"]);
function normalizeSpectrumView(raw) {
  return SPECTRUM_VIEWS.has(raw) ? raw : DEFAULT_PANEL_CONTROLS.spectrumView;
}
```

Add to the object returned by `normalizePanelControls`:

```js
    spectrumView: normalizeSpectrumView(raw?.spectrumView),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "feat(spectrum): add spectrumView to panel controls"
```

---

### Task C2: `setSpectrumView` IPC

**Files:**
- Modify: `src/ipc/commands.js`

- [ ] **Step 1: Implement (thin wrapper, no unit test — matches sibling `setSpectrumChannel`)**

Add to `src/ipc/commands.js`:

```js
/** @param {"combined" | "lr" | "ms"} view */
export function setSpectrumView(view) {
  return invoke("set_spectrum_view", { view });
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `npx vitest run src/hooks/useAudioEngine.test.js`
Expected: PASS (no regressions; this only adds an export).

- [ ] **Step 3: Commit**

```bash
git add src/ipc/commands.js
git commit -m "feat(spectrum): add setSpectrumView invoke wrapper"
```

---

### Task C3: View options + visibility helper

**Files:**
- Create: `src/math/spectrumChannelViewOptions.js`
- Create: `src/math/spectrumChannelViewOptions.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/math/spectrumChannelViewOptions.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  SPECTRUM_VIEW_OPTIONS,
  spectrumViewApplies,
  spectrumViewLegend,
} from "./spectrumChannelViewOptions.js";

describe("spectrum view options", () => {
  it("exposes three view options", () => {
    expect(SPECTRUM_VIEW_OPTIONS.map((o) => o.key)).toEqual(["combined", "lr", "ms"]);
  });

  it("applies only to pair selections", () => {
    expect(spectrumViewApplies({ type: "pair", x: 0, y: 1 })).toBe(true);
    expect(spectrumViewApplies({ type: "single", ch: 2 })).toBe(false);
    expect(spectrumViewApplies(null)).toBe(false);
  });

  it("builds a two-entry legend for lr/ms, null otherwise", () => {
    const labels = ["L", "R", "C", "LFE", "Ls", "Rs"];
    expect(spectrumViewLegend("combined", { type: "pair", x: 0, y: 1 }, labels)).toBeNull();
    expect(spectrumViewLegend("ms", { type: "pair", x: 0, y: 1 }, labels)).toEqual([
      { token: "primary", label: "Mid" },
      { token: "secondary", label: "Side" },
    ]);
    expect(spectrumViewLegend("lr", { type: "pair", x: 4, y: 5 }, labels)).toEqual([
      { token: "primary", label: "Ls" },
      { token: "secondary", label: "Rs" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/spectrumChannelViewOptions.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/math/spectrumChannelViewOptions.js`:

```js
/**
 * @typedef {{ type: "pair"; x: number; y: number } | { type: "single"; ch: number }} SpectrumChannelSel
 */

export const SPECTRUM_VIEW_OPTIONS = [
  { key: "combined", label: "Combined" },
  { key: "lr", label: "L / R" },
  { key: "ms", label: "M / S" },
];

/** View modes only apply to pair selections (singles are always one curve). */
export function spectrumViewApplies(sel) {
  return sel?.type === "pair";
}

/**
 * Legend entries for the overlaid curves, or null when there is only one curve.
 * @param {"combined"|"lr"|"ms"} view
 * @param {SpectrumChannelSel} sel
 * @param {string[]} labels per-channel labels (index by channel)
 * @returns {{ token: "primary"|"secondary"; label: string }[] | null}
 */
export function spectrumViewLegend(view, sel, labels) {
  if (!spectrumViewApplies(sel)) return null;
  if (view === "ms") {
    return [
      { token: "primary", label: "Mid" },
      { token: "secondary", label: "Side" },
    ];
  }
  if (view === "lr") {
    const lx = labels[sel.x] ?? `Ch ${sel.x + 1}`;
    const ly = labels[sel.y] ?? `Ch ${sel.y + 1}`;
    return [
      { token: "primary", label: lx },
      { token: "secondary", label: ly },
    ];
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/spectrumChannelViewOptions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrumChannelViewOptions.js src/math/spectrumChannelViewOptions.test.js
git commit -m "feat(spectrum): view-option + legend helpers"
```

---

## Phase D — JS frame intake + snapshot threading

### Task D1: Carry `dbListB` through spectrum data + visual ring

**Files:**
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/FrameIntake.test.js`:

```js
import { buildSpectrumDataSnapshot } from "./FrameIntake.js";

describe("secondary curve in spectrum data", () => {
  it("includes dbListB when present", () => {
    const data = buildSpectrumDataSnapshot({
      spectrumBandCentersHz: [100, 1000],
      spectrumSmoothDb: [-10, -20],
      spectrumSmoothDbB: [-15, -25],
    });
    expect(data.dbListB).toEqual([-15, -25]);
  });
  it("defaults dbListB to empty when absent", () => {
    const data = buildSpectrumDataSnapshot({
      spectrumBandCentersHz: [100],
      spectrumSmoothDb: [-10],
    });
    expect(data.dbListB).toEqual([]);
  });
});
```

(Adjust the `import` line if the test file already imports from `./FrameIntake.js`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: FAIL — `dbListB` is undefined.

- [ ] **Step 3: Implement**

In `src/lib/FrameIntake.js`, extend `buildSpectrumDataSnapshot`:

```js
export function buildSpectrumDataSnapshot(row) {
  const centers = row.spectrumBandCentersHz || [];
  const dbList = row.spectrumSmoothDb || [];
  const dbListB = row.spectrumSmoothDbB || [];
  return {
    bands: getBandsFromCenters(centers),
    dbList: [...dbList],
    dbListB: [...dbListB],
  };
}
```

In `pushVisualHistRow`, extend the `_visualSpectrumHist.push({…})` object:

```js
    this._visualSpectrumHist.push({
      bands: getBandsFromCenters(row.spectrumBandCentersHz ?? this._lastSpectrumCenters),
      dbList: [...(row.spectrumSmoothDb ?? [])],
      dbListB: [...(row.spectrumSmoothDbB ?? [])],
      timestampMs: row.timestampMs,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/FrameIntake.js src/lib/FrameIntake.test.js
git commit -m "feat(spectrum): carry secondary dbList through frame intake"
```

---

### Task D2: Resolve `spectrumSnapDbListB` in snapshots

**Files:**
- Modify: `src/lib/snapshotResolve.js`
- Modify: `src/lib/snapshotResolve.test.js` (if present; otherwise add coverage here)

- [ ] **Step 1: Write the failing test**

Add to `src/lib/snapshotResolve.test.js` (create it if it does not exist, importing `resolveSnapshot`):

```js
import { describe, it, expect } from "vitest";
import { resolveSnapshot } from "./snapshotResolve.js";

it("returns spectrumSnapDbListB from the visual snap", () => {
  const out = resolveSnapshot({
    selectedOffset: 0,
    sampleSec: 0.1,
    visualSampleSec: 0.04,
    histSourceList: [{ timestampMs: 1000 }],
    audioList: [{ correlation: 0.5 }],
    corrList: [0.5],
    spectrumDataList: [{ bands: [{ fCenter: 100 }], dbList: [-10], dbListB: [-12] }],
    channelMetadataList: [{}],
    visualSpectrum: [{ timestampMs: 1000, dbList: [-10], dbListB: [-12] }],
    visualVectorscope: [{ timestampMs: 1000, pairs: [] }],
    liveAudio: {},
    liveSpectrumData: { bands: [], dbList: [], dbListB: [] },
  });
  expect(out.spectrumSnapDbListB).toEqual([-12]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/snapshotResolve.test.js`
Expected: FAIL — `spectrumSnapDbListB` is undefined.

- [ ] **Step 3: Implement**

In `src/lib/snapshotResolve.js`, in the block that sets `spectrumSnapDbList`:

```js
  let spectrumSnapCenters = null;
  let spectrumSnapDbList = null;
  let spectrumSnapDbListB = null;
  if (visualSnapIdx >= 0 && visualSpectrum[visualSnapIdx]) {
    const snap = visualSpectrum[visualSnapIdx];
    const centerSource = displaySpectrumData;
    spectrumSnapCenters = (centerSource?.bands ?? []).map((b) => b.fCenter);
    spectrumSnapDbList = snap.dbList ?? [];
    spectrumSnapDbListB = snap.dbListB ?? [];
  }
```

Add `spectrumSnapDbListB` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/snapshotResolve.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/snapshotResolve.js src/lib/snapshotResolve.test.js
git commit -m "feat(spectrum): resolve secondary dbList in snapshots"
```

---

### Task D3: `displaySpectrumPathB` in useSnapshot

**Files:**
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `src/hooks/useSnapshot.test.jsx` (mirror the existing `displaySpectrumPeakPath` cases): assert that when `selectedOffset < 0` (live) the hook returns the passed-in `spectrumPathB`, and when a snapshot is selected with a resolvable `spectrumSnapDbListB`, it returns a rebuilt path. Minimal live-case test:

```jsx
it("passes through live spectrumPathB when not in snapshot", () => {
  const { result } = renderHook(() =>
    useSnapshot({
      selectedOffset: -1,
      sampleSec: 0.1,
      intake: makeIntakeStub(), // existing helper in this file
      audio: {},
      spectrumPath: "live",
      spectrumPeakPath: "",
      spectrumPathB: "live-b",
      vectorPath: "",
    })
  );
  expect(result.current.displaySpectrumPathB).toBe("live-b");
});
```

(If `makeIntakeStub`/the existing harness differs, follow the file's established pattern; the assertion is the contract.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useSnapshot.test.jsx`
Expected: FAIL — `displaySpectrumPathB` is undefined.

- [ ] **Step 3: Implement**

In `src/hooks/useSnapshot.js`:

Add `spectrumPathB` to the destructured params:

```js
export function useSnapshot({
  selectedOffset,
  sampleSec,
  intake,
  audio,
  spectrumPath,
  spectrumPeakPath,
  spectrumPathB,
  vectorPath,
}) {
```

After the existing `displaySpectrumPath` computation, add:

```js
  const displaySpectrumPathB =
    resolved.spectrumSnapDbListB != null && resolved.spectrumSnapDbListB.length > 0
      ? buildSpectrumSvgFromBandsAndDb(resolved.spectrumSnapCenters, resolved.spectrumSnapDbListB)
      : selectedOffset >= 0
        ? ""
        : spectrumPathB;
```

Add `displaySpectrumPathB` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useSnapshot.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx
git commit -m "feat(spectrum): expose displaySpectrumPathB from useSnapshot"
```

---

## Phase E — Wiring, UI, colors

### Task E1: Secondary curve theme tokens

**Files:**
- Modify: `src/theme/builtinThemes.js`
- Modify: `src/theme/builtinThemes.test.js`
- Modify: `src/preferences/applyDocumentTheme.js`

- [ ] **Step 1: Write the failing test**

In `src/theme/builtinThemes.test.js`, extend the spectrum assertions object (the block at lines ~37-38):

```js
    spectrumLive: charts.spectrum.strokeLive,
    spectrumSnap: charts.spectrum.strokeSnap,
    spectrumLiveB: charts.spectrum.strokeLiveB,
    spectrumSnapB: charts.spectrum.strokeSnapB,
```

And add an assertion that both built-in themes define the B colors as non-empty strings distinct from the primary:

```js
  it("defines a distinct secondary spectrum color", () => {
    for (const theme of BUILTIN_THEMES) { // use the file's existing iteration var
      const sp = theme.charts.spectrum;
      expect(typeof sp.strokeLiveB).toBe("string");
      expect(sp.strokeLiveB).not.toBe(sp.strokeLive);
      expect(typeof sp.strokeSnapB).toBe("string");
    }
  });
```

(Match the file's existing import/iteration names; if themes are accessed individually rather than via a `BUILTIN_THEMES` array, assert per theme object.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/theme/builtinThemes.test.js`
Expected: FAIL — `strokeLiveB` undefined.

- [ ] **Step 3: Implement**

In `src/theme/builtinThemes.js`, in the **plvs-dark** `spectrum` block (around line 70), add a contrasting secondary (dark theme primary is orange `#fb923c`; use a cyan/teal counterpart):

```js
  spectrum: {
    strokeLive: "#fb923c",
    strokeSnap: "#fcd34d",
    strokeLiveB: "#38bdf8",
    strokeSnapB: "#7dd3fc",
    strokeWidth: 1.5,
```

In the **plvs-light** `spectrum` block (around line 114; primary `#e07020`), add:

```js
  spectrum: {
    strokeLive: "#e07020",
    strokeSnap: "#b76b00",
    strokeLiveB: "#0e7490",
    strokeSnapB: "#155e75",
    strokeWidth: 1.5,
```

In `src/preferences/applyDocumentTheme.js`, after line 160:

```js
  setCssVar("--ui-chart-spectrum-live-b", charts.spectrum.strokeLiveB);
  setCssVar("--ui-chart-spectrum-snap-b", charts.spectrum.strokeSnapB);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/theme/builtinThemes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/theme/builtinThemes.js src/theme/builtinThemes.test.js src/preferences/applyDocumentTheme.js
git commit -m "feat(spectrum): secondary curve theme tokens"
```

---

### Task E2: View toggle in the panel header (incl. stereo)

**Files:**
- Modify: `src/components/PanelHeaderControls.jsx`
- Modify: `src/components/PanelHeaderControls.test.jsx`

The view toggle must render for the spectrum tab whenever `channelCount >= 2` **and** the current selection is a pair — including stereo, where the existing `channelCount <= 2` early-return currently hides all chips.

- [ ] **Step 1: Write the failing test**

Add to `src/components/PanelHeaderControls.test.jsx`:

```jsx
it("shows the view toggle for a stereo spectrum panel", () => {
  render(
    <PanelHeaderControls
      activeTab="spectrum"
      channelCount={2}
      spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
      spectrumValueKey="p-0-1"
      spectrumView="combined"
      onSpectrumViewChange={vi.fn()}
    />
  );
  expect(screen.getByLabelText("spectrum view")).toBeInTheDocument();
});

it("hides the view toggle when a single channel is selected", () => {
  render(
    <PanelHeaderControls
      activeTab="spectrum"
      channelCount={6}
      spectrumOptions={[{ key: "s-2", label: "C", sel: { type: "single", ch: 2 } }]}
      spectrumValueKey="s-2"
      spectrumView="combined"
      onSpectrumViewChange={vi.fn()}
    />
  );
  expect(screen.queryByLabelText("spectrum view")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PanelHeaderControls.test.jsx`
Expected: FAIL — no element with label "spectrum view".

- [ ] **Step 3: Implement**

In `src/components/PanelHeaderControls.jsx`:

(a) Add the new props to the signature:

```jsx
  spectrumView = "combined",
  onSpectrumViewChange,
```

(b) Add the import:

```jsx
import {
  SPECTRUM_VIEW_OPTIONS,
  spectrumViewApplies,
} from "@/math/spectrumChannelViewOptions.js";
```

(c) Render the view toggle for spectrum/spectrogram **before** the `channelCount <= 2` early-return, so stereo gets it. Insert this block right after the `loudness` early-return block (before `if (!Number.isFinite(channelCount) || channelCount <= 2) return null;`):

```jsx
  if (activeTab === "spectrum" || activeTab === "spectrogram") {
    const { selectedOption } = getSelectedOption(spectrumOptions, spectrumValueKey);
    const sel = selectedOption?.sel ?? null;
    const showView = spectrumViewApplies(sel) && typeof onSpectrumViewChange === "function";
    const showChannel = channelCount > 2 && spectrumOptions.length > 0;

    return (
      <div className="flex items-center gap-0.5">
        {showChannel ? (
          <SingleSelectChip
            label={
              getSelectedOption(spectrumOptions, spectrumValueKey).matchedOption && spectrumDisplayLabel
                ? spectrumDisplayLabel
                : selectedOption.label
            }
            ariaLabel={`${activeTab} channel`}
            options={spectrumOptions}
            value={selectedOption.key}
            onChange={(key) => {
              const opt = spectrumOptions.find((o) => o.key === key);
              if (opt && typeof onSpectrumChange === "function") onSpectrumChange(opt.sel);
            }}
          />
        ) : null}
        {showView ? (
          <SingleSelectChip
            label={SPECTRUM_VIEW_OPTIONS.find((o) => o.key === spectrumView)?.label ?? "Combined"}
            ariaLabel="spectrum view"
            options={SPECTRUM_VIEW_OPTIONS}
            value={spectrumView}
            onChange={(key) => onSpectrumViewChange(key)}
          />
        ) : null}
      </div>
    );
  }
```

(d) Delete the **old** spectrum block lower down (the `if ((activeTab === "spectrum" || activeTab === "spectrogram") && spectrumOptions.length > 0) { … }` at lines ~183-202) — the new block above supersedes it. Leave the vectorscope block and the `channelCount <= 2` guard (which now only gates vectorscope) intact.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PanelHeaderControls.test.jsx`
Expected: PASS (new + existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/PanelHeaderControls.jsx src/components/PanelHeaderControls.test.jsx
git commit -m "feat(spectrum): view toggle in panel header (incl. stereo)"
```

---

### Task E3: App wiring — view state, IPC, props, B paths

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/lib/tauriFrameApply.js`
- Modify: `src/lib/tauriFrameApply.test.js`

- [ ] **Step 1: Write the failing test (frame apply sets the B path)**

Add to `src/lib/tauriFrameApply.test.js` (mirror the existing `setSpectrumPeakPath` assertion):

```js
it("sets spectrum B path from the frame", () => {
  const setSpectrumPathB = vi.fn();
  const { applyFrame } = buildTauriFrameApply({
    ...baseOpts(), // existing helper that supplies required deps
    setSpectrumPathB,
  });
  applyFrame({ ...baseFrame(), spectrumPathB: "abc" });
  expect(setSpectrumPathB).toHaveBeenCalledWith("abc");
});
```

(Use the file's existing `baseOpts`/`baseFrame` helpers; if absent, follow the established stub pattern in that test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tauriFrameApply.test.js`
Expected: FAIL — `setSpectrumPathB` not called.

- [ ] **Step 3: Implement frame-apply change**

In `src/lib/tauriFrameApply.js`, add `setSpectrumPathB` to the destructured options and set it in the same `!freeze && live && shouldPaintUi` block as `setSpectrumPath`:

```js
        setSpectrumPath(f.spectrumPath || "");
        setSpectrumPathB(f.spectrumPathB || "");
        setSpectrumPeakPath(f.spectrumPeakPath || "");
```

- [ ] **Step 4: Wire App.jsx**

In `src/App.jsx`:

(a) Add state next to `spectrumPeakPath` (line ~230):

```jsx
  const [spectrumPathB, setSpectrumPathB] = useState("");
```

Clear it where `setSpectrumPeakPath("")` is called (lines ~742). Pass `setSpectrumPathB` into the frame-apply builder (line ~914) and into `useAudioEngine` if that hook forwards setters (mirror `setSpectrumPeakPath`; update `useAudioEngine.js` + its test the same way `setSpectrumPeakPath` is handled).

(b) Read `spectrumViewUi` from panel controls (next to `spectrumChannelUi`, line ~205):

```jsx
  const spectrumViewUi = normalizedPanelControls.spectrumView;
```

(c) Import the command and helper:

```jsx
import { setSpectrumView } from "./ipc/commands.js";
import { spectrumViewLegend } from "./math/spectrumChannelViewOptions.js";
```

(d) Add an `onSpectrumViewChange` handler (mirror `onSpectrumChannelChange`, persisting + sending IPC when running):

```jsx
  const onSpectrumViewChange = async (view) => {
    if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
    updatePanelControls((current) => ({ ...current, spectrumView: view }));
    try {
      if (running || !isTauri()) await setSpectrumView(view);
    } catch (_) {}
  };
```

(e) On capture start, send the current view so the engine matches the UI. In the same effect/sequence that calls `sendTrackedSpectrumChannel` on start (line ~622-632), also `void setSpectrumView(spectrumViewUi);` when `running && isTauri()`.

(f) Pass `displaySpectrumPathB` through `useSnapshot` (add `spectrumPathB` to its argument object, line ~688+) and expose it plus the view props on the audio-data context value (the object around lines 977-982), following exactly how `displaySpectrumPath` / `onSpectrumChannelChange` are exposed:

```jsx
    displaySpectrumPathB,
    spectrumView: spectrumViewUi,
    onSpectrumViewChange,
    spectrumViewLegend: spectrumViewLegend(
      spectrumViewUi,
      spectrumChannelUi,
      getPeakMeterChannelLabels(channelCount >= 2 ? channelCount : 2, peakLabelContext)
    ),
```

(g) Pass the new props from `LeafView.jsx` into `PanelHeaderControls` (next to `onSpectrumChange`, line ~178):

```jsx
            spectrumView={audioData?.spectrumView ?? "combined"}
            onSpectrumViewChange={audioData?.onSpectrumViewChange}
```

- [ ] **Step 5: Run the relevant suites**

Run: `npx vitest run src/lib/tauriFrameApply.test.js src/hooks/useAudioEngine.test.js src/App.toolbar.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/lib/tauriFrameApply.js src/lib/tauriFrameApply.test.js src/hooks/useAudioEngine.js src/hooks/useAudioEngine.test.js src/workspace/LeafView.jsx
git commit -m "feat(spectrum): wire spectrumView state, IPC, and B path through App"
```

---

### Task E4: Render the secondary curve + 2-row hover + legend

**Files:**
- Modify: `src/components/panels/SpectrumPanel.jsx`
- Modify: `src/components/panels/SpectrumPanel.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `src/components/panels/SpectrumPanel.test.jsx` (mirror the existing `displaySpectrumPeakPath` rendering test): provide `displaySpectrumPathB` via the `useAudioData` mock and assert a second path renders with the secondary stroke. Minimal:

```jsx
it("renders the secondary curve when displaySpectrumPathB is set", () => {
  mockAudioData({
    displaySpectrumPath: "M 0 0 L 10 10",
    displaySpectrumPathB: "M 0 5 L 10 15",
    displaySpectrumData: { bands: [], dbList: [], dbListB: [] },
    spectrumViewLegend: [
      { token: "primary", label: "Mid" },
      { token: "secondary", label: "Side" },
    ],
  });
  const { container } = render(<SpectrumPanel />);
  expect(
    container.querySelector('path[stroke="var(--ui-chart-spectrum-live-b)"]')
  ).toBeInTheDocument();
});
```

(Use the test file's existing `mockAudioData`/`useAudioData` mocking approach.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/panels/SpectrumPanel.test.jsx`
Expected: FAIL — no secondary path.

- [ ] **Step 3: Implement**

In `src/components/panels/SpectrumPanel.jsx`:

(a) Pull the new context fields:

```jsx
  const {
    displaySpectrumPath,
    displaySpectrumPeakPath,
    displaySpectrumPathB,
    selectedOffset,
    displaySpectrumData,
    spectrumViewLegend,
  } = useAudioData();
```

(b) In the hover callback, read the secondary dB and add a second HUD value:

```jsx
    const dbB = data.dbListB?.[nearestIdx];
    return {
      leftPct: freqToXFrac(band.fCenter) * 100,
      topPct: spectrumDbToTopFrac(db) * 100,
      freqLabel: formatSpectrumFreq(band.fCenter),
      dbLabel: `${db.toFixed(1)} dB`,
      dbLabelB: Number.isFinite(dbB) ? `${dbB.toFixed(1)} dB` : null,
      noteLabel: freqToNote(band.fCenter),
    };
```

(c) Render the secondary curve immediately after the primary `<path d={displaySpectrumPath} …>` (inside the same `motion.g`), using the secondary token (and its snap variant when a snapshot is selected):

```jsx
                        {displaySpectrumPathB ? (
                          <path
                            d={displaySpectrumPathB}
                            fill="none"
                            stroke={
                              selectedOffset >= 0
                                ? "var(--ui-chart-spectrum-snap-b)"
                                : "var(--ui-chart-spectrum-live-b)"
                            }
                            strokeWidth="var(--ui-sp-stroke-w)"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ) : null}
```

(d) In the hover HUD block, render the second dB row when present (after the existing `dbLabel` row):

```jsx
                    {spectrumHover.dbLabelB ? (
                      <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                        {spectrumHover.dbLabelB}
                      </div>
                    ) : null}
```

(e) Render the legend (top-right of the plot) when `spectrumViewLegend` is non-null. Add inside the chart container `<div className="relative min-h-0 h-full rounded-lg bg-muted" …>`, as a first child:

```jsx
              {spectrumViewLegend ? (
                <div className="pointer-events-none absolute right-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)] z-10 flex gap-2 rounded border border-border bg-secondary px-2 py-0.5 text-[length:var(--ui-fs-axis)] text-muted-foreground">
                  {spectrumViewLegend.map((e) => (
                    <span key={e.token} className="flex items-center gap-1">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor:
                            e.token === "primary"
                              ? "var(--ui-chart-spectrum-live)"
                              : "var(--ui-chart-spectrum-live-b)",
                        }}
                      />
                      {e.label}
                    </span>
                  ))}
                </div>
              ) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/panels/SpectrumPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/SpectrumPanel.jsx src/components/panels/SpectrumPanel.test.jsx
git commit -m "feat(spectrum): render secondary curve, 2-row hover, legend"
```

---

## Phase F — Full verification

### Task F1: Full suites + format

- [ ] **Step 1: Rust**

Run: `cargo test -p plvs && cargo fmt --check`
Expected: all tests PASS, fmt clean.

- [ ] **Step 2: JS**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 3: Commit any fmt fixes** (if `cargo fmt --check` flagged formatting, run `cargo fmt` and commit).

```bash
git add -A
git commit -m "chore(spectrum): fmt"
```

### Task F2: Manual app verification (human)

- [ ] Run the app (see `/run`). With a stereo source:
  - View chip shows on the spectrum panel; `Combined` matches today's curve.
  - `M-S`: two curves; centered/mono content → Side curve sits far below Mid; panned content lifts Side. Toggling Combined↔M-S leaves the Mid/Combined curve unmoved.
  - `L-R`: two curves; hard-panning raises one and drops the other.
  - Hover shows two dB rows; legend shows Mid/Side or the channel labels.
  - Enter snapshot/scrub: both curves remain and track history.
- [ ] With a 5.1 source: channel chip + view chip both show; selecting `C`/`LFE` (single) hides the view chip; selecting `Ls+Rs` + `M-S` works.

---

## Self-Review notes (addressed)

- **Stereo visibility:** `PanelHeaderControls`' `channelCount <= 2` guard previously hid all spectrum chips; Task E2 moves the spectrum/view block above that guard so stereo gets the view toggle while the channel dropdown stays gated to `channelCount > 2`.
- **M == Combined:** guaranteed by `M = (x+y)/2` and verified by `ms_mid_matches_combined` (Task A3).
- **Backward compatibility:** all B fields default empty; single-curve modes behave exactly as before (existing `push_selected_*` / calibration tests unchanged).
- **Peak-hold:** intentionally untouched (still gated off at `meter_pipeline.rs` — separate UI-controls batch, per spec out-of-scope).
- **Web/non-Tauri path:** this plan targets the Tauri frame path. If a separate web/WASM frame producer exists, it emits no `spectrumPathB`/`spectrumSmoothDbB`, so JS degrades to single-curve cleanly (empty B). Confirm during F2 that the web build, if used, is unaffected.
