# Multichannel Measurement Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multichannel loudness and True Peak readings correct per ITU-R BS.1770-5, and make
Ch1/Ch2 degradation on unrecognized layouts visible everywhere loudness is read out.

**Architecture:** One Rust table (`dsp/channel_weights.rs`) owns layout names and BS.1770-5 weights
by channel count in WAVE / ffmpeg order. `LoudnessMeter`, `SummaryMeter` and
`loudness_layout_meta` all read it. True Peak history becomes per channel. Layout metadata flows
into pipeline, file, CLI analyze and CLI capture summaries, and the frontend carries
`loudnessLayoutKnown` through live frames and history snapshots to one shared marker component.

**Tech Stack:** Rust (Tauri 2 backend, `cargo test`), React 19 + Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-multichannel-measurement-correctness-design.md`

**Working directory:** the worktree `.claude/worktrees/multichannel` (branch `feat/multichannel`).
All commands below run from the worktree root. Commit messages end with the line
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` (pass it as a second `-m`).

**Weight shorthand used in code comments:** `S` = `SURROUND_LOUDNESS_WEIGHT` = 10^(1.5/10) ≈ 1.4125.

---

## File map

| File | Change |
| --- | --- |
| `src-tauri/src/dsp/channel_weights.rs` | **Create.** Layout name + BS.1770-5 weight table by channel count |
| `src-tauri/src/dsp/mod.rs` | Register the module |
| `src-tauri/src/dsp/loudness.rs` | Use the table; delete hand-written 5.1/7.1 loops; True Peak over every channel; tests |
| `src-tauri/src/dsp/summary_meter.rs` | Use the table; True Peak over every channel; report layout; tests |
| `src-tauri/src/engine/meter_pipeline.rs` | `loudness_layout_meta` from the table; `PipelineSummary` carries layout; tests |
| `src-tauri/src/file_analysis/types.rs` | `FileAnalysisSummaryMetrics` gains layout fields |
| `src-tauri/src/file_analysis/summary.rs` | Fill layout fields |
| `src-tauri/src/file_analysis/session.rs` | Fill layout fields; multichannel CLI/GUI parity test |
| `src-tauri/src/cli_analyze.rs` | `CliAnalyzeSummary` gains layout fields; test |
| `src-tauri/src/audio/capture_summary.rs` | `CaptureRun` gains layout fields |
| `src-tauri/src/cli_capture.rs` | `CliCaptureSummary` gains layout fields; test |
| `src/math/peakMeterChannelLabels.js` (+ test) | 7.0 / 7.1 default labels in WAVE order |
| `src/math/channelRoles.js` (+ test) | `Lb/Rb/Cs` weight 1.00; header comment |
| `src/lib/tauriFrameApply.js` (+ test) | Carry `loudnessLayoutKnown` on live frames |
| `src/lib/FrameIntake.js` | Carry `loudnessLayoutKnown` into audio snaps |
| `src/lib/AudioSnapHistorySlab.js` (+ test) | Store `loudnessLayoutKnown` column |
| `src/components/LoudnessLayoutMarker.jsx` (+ test) | **Create.** `Ch 1–2` marker with tooltip |
| `src/components/panels/StatsPanel.jsx` (+ test) | Show marker |
| `src/components/panels/LoudnessPanel.jsx` (+ test) | Show marker |
| `src/dock/modules/DockLoudness.jsx` (+ test) | Show marker |
| `src/components/FileAnalysisSummary.jsx` (+ test) | Show marker |
| `docs/prd.md`, `docs/architecture.md`, `docs/agent-control/measurements.md` | Documentation |

---

### Task 1: Standard layout weight table

**Files:**
- Create: `src-tauri/src/dsp/channel_weights.rs`
- Modify: `src-tauri/src/dsp/mod.rs`

- [ ] **Step 1: Write the module with failing-by-absence tests**

Create `src-tauri/src/dsp/channel_weights.rs`:

```rust
//! Standard channel layouts inferred from channel count, with ITU-R BS.1770-5 loudness weights.
//!
//! Channel order is the native WAVE (`KSAUDIO_SPEAKER_*`) order, which is also ffmpeg's native
//! layout order, so WASAPI capture and file decode agree. Weights follow BS.1770-5 Annex 3
//! Table 5: 1.41 for the surround pair between 60° and 120° azimuth (`Ls/Rs`), 1.00 for front,
//! back (±135°, `Lb/Rb`) and every other position, 0 for LFE.

use super::gating::SURROUND_LOUDNESS_WEIGHT as S;

/// Layout name reported for a channel count, or `None` when the count has no standard layout.
pub(crate) fn standard_layout_name(channels: u16) -> Option<&'static str> {
  match channels {
    1 => Some("mono"),
    2 => Some("stereo"),
    3 => Some("lcr"),
    4 => Some("quad"),
    5 => Some("5.0"),
    6 => Some("5.1"),
    7 => Some("7.0"),
    8 => Some("7.1"),
    _ => None,
  }
}

/// Per-channel loudness weights for 3–8 channels. Mono and stereo keep their dedicated paths.
pub(crate) fn standard_loudness_weights(channels: u16) -> Option<&'static [f64]> {
  match channels {
    // L R C
    3 => Some(&[1.0, 1.0, 1.0]),
    // L R Ls Rs
    4 => Some(&[1.0, 1.0, S, S]),
    // L R C Ls Rs
    5 => Some(&[1.0, 1.0, 1.0, S, S]),
    // L R C LFE Ls Rs
    6 => Some(&[1.0, 1.0, 1.0, 0.0, S, S]),
    // L R C Lb Rb Ls Rs
    7 => Some(&[1.0, 1.0, 1.0, 1.0, 1.0, S, S]),
    // L R C LFE Lb Rb Ls Rs
    8 => Some(&[1.0, 1.0, 1.0, 0.0, 1.0, 1.0, S, S]),
    _ => None,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn weights_follow_bs1770_5_table_5() {
    assert_eq!(standard_loudness_weights(3), Some(&[1.0, 1.0, 1.0][..]));
    assert_eq!(standard_loudness_weights(4), Some(&[1.0, 1.0, S, S][..]));
    assert_eq!(standard_loudness_weights(5), Some(&[1.0, 1.0, 1.0, S, S][..]));
    assert_eq!(
      standard_loudness_weights(6),
      Some(&[1.0, 1.0, 1.0, 0.0, S, S][..])
    );
    // Back surrounds sit at ±135°, outside the 60°–120° band, so BS.1770-5 gives them 1.00.
    assert_eq!(
      standard_loudness_weights(7),
      Some(&[1.0, 1.0, 1.0, 1.0, 1.0, S, S][..])
    );
    assert_eq!(
      standard_loudness_weights(8),
      Some(&[1.0, 1.0, 1.0, 0.0, 1.0, 1.0, S, S][..])
    );
  }

  #[test]
  fn every_weight_row_has_one_weight_per_channel() {
    for channels in 3..=8_u16 {
      let weights = standard_loudness_weights(channels).expect("row for 3..=8");
      assert_eq!(weights.len(), channels as usize, "{channels} channels");
    }
  }

  #[test]
  fn counts_without_a_standard_layout_have_no_name_or_weights() {
    for channels in [0_u16, 9, 10, 12, 16, 24] {
      assert_eq!(standard_layout_name(channels), None, "{channels} channels");
      assert_eq!(standard_loudness_weights(channels), None, "{channels} channels");
    }
    assert_eq!(standard_loudness_weights(1), None);
    assert_eq!(standard_loudness_weights(2), None);
  }

  #[test]
  fn names_match_the_frontend_resolver() {
    let names: Vec<_> = (1..=8_u16).map(|ch| standard_layout_name(ch).unwrap()).collect();
    assert_eq!(names, ["mono", "stereo", "lcr", "quad", "5.0", "5.1", "7.0", "7.1"]);
  }

  #[test]
  fn surround_weight_is_plus_one_and_a_half_db() {
    assert!((10.0 * S.log10() - 1.5).abs() < 1e-12);
  }
}
```

In `src-tauri/src/dsp/mod.rs`, add after `pub mod channel_sel;`:

```rust
pub(crate) mod channel_weights;
```

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib dsp::channel_weights`
Expected: 5 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/dsp/channel_weights.rs src-tauri/src/dsp/mod.rs
git commit -m "feat(dsp): add BS.1770-5 standard layout weight table" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `LoudnessMeter` uses the table

**Files:**
- Modify: `src-tauri/src/dsp/loudness.rs` (imports; `push_interleaved_multichannel`, currently lines 376–696; tests from line 1098)

- [ ] **Step 1: Write the failing tests**

In the `tests` module of `loudness.rs`, add:

```rust
  /// Eight channels of 400 ms of a 1 kHz sine at `amp` on the listed channel indices only.
  fn sine_on_channels(channels: usize, active: &[usize], amp: f32) -> Vec<f32> {
    let sr = 48_000.0_f64;
    let frames = (sr * 0.4) as usize;
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32 * amp;
      for &ch in active {
        pcm[i * channels + ch] = s;
      }
    }
    pcm
  }

  /// BS.1770-5 Table 5: side surrounds (±90°) weigh 1.41, back surrounds (±135°) 1.00. The same
  /// signal on the back pair must therefore read exactly 1.5 LU below the side pair.
  #[test]
  fn auto_71_weights_back_surrounds_below_side_surrounds() {
    let back = sine_on_channels(8, &[4, 5], 0.1);
    let side = sine_on_channels(8, &[6, 7], 0.1);
    let mut back_meter = LoudnessMeter::new(48_000.0);
    let mut side_meter = LoudnessMeter::new(48_000.0);
    let back_block = back_meter
      .push_interleaved_multichannel(&back, 8, ChannelLayoutSetting::Auto)
      .expect("back block");
    let side_block = side_meter
      .push_interleaved_multichannel(&side, 8, ChannelLayoutSetting::Auto)
      .expect("side block");
    assert!(
      (side_block.momentary - back_block.momentary - 1.5).abs() < 0.01,
      "side {} vs back {}",
      side_block.momentary,
      back_block.momentary
    );
  }

  #[test]
  fn auto_lcr_and_quad_use_standard_weights() {
    for (channels, weights) in [
      (3_u16, vec![1.0, 1.0, 1.0]),
      (4_u16, vec![1.0, 1.0, SURROUND_LOUDNESS_WEIGHT, SURROUND_LOUDNESS_WEIGHT]),
    ] {
      let all: Vec<usize> = (0..channels as usize).collect();
      let pcm = sine_on_channels(channels as usize, &all, 0.1);
      let mut auto = LoudnessMeter::new(48_000.0);
      let mut weighted = LoudnessMeter::new(48_000.0);
      let auto_block = auto
        .push_interleaved_multichannel(&pcm, channels, ChannelLayoutSetting::Auto)
        .expect("auto block");
      let weighted_block = weighted
        .push_interleaved_weighted(&pcm, channels, &weights)
        .expect("weighted block");
      assert_eq!(
        auto_block.momentary, weighted_block.momentary,
        "{channels} channels"
      );
    }
  }

  /// Counts without a standard layout measure the loudness of Ch1/Ch2 and ignore every other
  /// channel, however loud.
  #[test]
  fn unknown_layout_measures_only_the_first_two_channels() {
    let channels = 10_usize;
    let mut pcm = sine_on_channels(channels, &[0, 1], 0.1);
    for frame in pcm.chunks_exact_mut(channels) {
      for sample in &mut frame[2..] {
        *sample = 0.5;
      }
    }
    let stereo: Vec<f32> = pcm
      .chunks_exact(channels)
      .flat_map(|frame| [frame[0], frame[1]])
      .collect();
    let mut wide = LoudnessMeter::new(48_000.0);
    let mut two = LoudnessMeter::new(48_000.0);
    let wide_block = wide
      .push_interleaved_multichannel(&pcm, channels as u16, ChannelLayoutSetting::Auto)
      .expect("10ch block");
    let two_block = two
      .push_interleaved_weighted(&stereo, 2, &[1.0, 1.0])
      .expect("Ch1/Ch2 block");
    assert_eq!(wide_block.momentary, two_block.momentary);
    // The same reading as the dedicated stereo path, to well within display precision.
    let mut stereo_path = LoudnessMeter::new(48_000.0);
    let stereo_block = stereo_path.push_interleaved(&stereo).expect("stereo block");
    assert!((wide_block.momentary - stereo_block.momentary).abs() < 1e-9);
  }
```

Replace the body of the existing `auto_70_matches_standard_surround_weights` test's weight array and
rename the test, so it pins the corrected 7.0 row:

```rust
  #[test]
  fn auto_70_matches_bs1770_5_weights() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 7usize;
    let mut pcm = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      pcm[base + 3] = 0.1;
      pcm[base + 4] = 0.1;
      pcm[base + 5] = 0.1;
      pcm[base + 6] = 0.1;
    }
    let surround_weight = 10_f64.powf(1.5 / 10.0);

    let mut auto = LoudnessMeter::new(sr);
    let mut standard = LoudnessMeter::new(sr);
    let auto_block = auto
      .push_interleaved_multichannel(&pcm, ch as u16, ChannelLayoutSetting::Auto)
      .expect("7.0 auto block");
    let standard_block = standard
      .push_interleaved_weighted(
        &pcm,
        ch as u16,
        &[1.0, 1.0, 1.0, 1.0, 1.0, surround_weight, surround_weight],
      )
      .expect("7.0 standard block");

    assert!(
      (auto_block.momentary - standard_block.momentary).abs() < 0.15,
      "7.0 auto should use BS.1770-5 weights: {} vs {}",
      auto_block.momentary,
      standard_block.momentary
    );
  }
```

Likewise replace `hardcoded_71_matches_standard_surround_weights` with:

```rust
  #[test]
  fn manual_71_matches_bs1770_5_weights() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 8usize;
    let mut pcm = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      pcm[base + 4] = 0.1;
      pcm[base + 5] = 0.1;
      pcm[base + 6] = 0.1;
      pcm[base + 7] = 0.1;
    }
    let surround_weight = 10_f64.powf(1.5 / 10.0);

    let mut manual = LoudnessMeter::new(sr);
    let mut standard = LoudnessMeter::new(sr);
    let manual_block = manual
      .push_interleaved_multichannel(&pcm, ch as u16, ChannelLayoutSetting::Surround71)
      .expect("7.1 manual block");
    let standard_block = standard
      .push_interleaved_weighted(
        &pcm,
        ch as u16,
        &[1.0, 1.0, 1.0, 0.0, 1.0, 1.0, surround_weight, surround_weight],
      )
      .expect("7.1 standard block");

    assert!(
      (manual_block.momentary - standard_block.momentary).abs() < 0.15,
      "7.1 manual should use BS.1770-5 weights: {} vs {}",
      manual_block.momentary,
      standard_block.momentary
    );
  }
```

In `surround71_lufs_uses_all_channels_except_lfe`, change the first comment line to:

```rust
    // 7.1 in WAVE order: FL FR C LFE BL BR SL SR. LFE (ch index 3) should have 0 weight.
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib dsp::loudness`
Expected: FAIL in `auto_71_weights_back_surrounds_below_side_surrounds` (difference ≈ 0),
`auto_lcr_and_quad_use_standard_weights`, `auto_70_matches_bs1770_5_weights` and
`manual_71_matches_bs1770_5_weights`.

- [ ] **Step 3: Implement**

In the `use` block at the top of `loudness.rs`, replace the `super::gating` import with:

```rust
use super::channel_weights::standard_loudness_weights;
use super::gating::{gated_integrated_lufs, gated_lra, lufs_from_mean_squares, IBL_CAP, STH_CAP};
```

The new tests use `SURROUND_LOUDNESS_WEIGHT`, so add this line inside `mod tests`, below
`use super::*;`:

```rust
  use crate::dsp::gating::SURROUND_LOUDNESS_WEIGHT;
```

Replace the whole `push_interleaved_multichannel` function (doc comment through the closing brace,
currently lines 376–696) with:

```rust
  /// Multichannel intake. Counts with a standard layout (`channel_weights`) are summed with
  /// BS.1770-5 weights; `Surround51` / `Surround71` apply the 5.1 / 7.1 rows only at exactly 6 / 8
  /// channels. Stereo keeps its dedicated path. Every other count measures the loudness of Ch1/Ch2
  /// through the weighted path (so True Peak still sees every channel) and is reported as an
  /// unknown layout by `loudness_layout_meta`.
  pub fn push_interleaved_multichannel(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    channel_layout: ChannelLayoutSetting,
  ) -> Option<LoudnessBlock> {
    let ch = channels.max(1);
    if ch == 1 {
      return self.push_mono_duplex(interleaved);
    }
    if ch == 2 {
      return self.push_interleaved(interleaved);
    }

    let weights = match channel_layout {
      ChannelLayoutSetting::Stereo => None,
      ChannelLayoutSetting::Surround51 if ch == 6 => standard_loudness_weights(6),
      ChannelLayoutSetting::Surround71 if ch == 8 => standard_loudness_weights(8),
      ChannelLayoutSetting::Surround51 | ChannelLayoutSetting::Surround71 => None,
      ChannelLayoutSetting::Auto => standard_loudness_weights(ch),
    };
    if let Some(weights) = weights {
      return self.push_interleaved_weighted(interleaved, ch, weights);
    }

    // Unrecognized layout: Ch1/Ch2 loudness only. Built per call on the DSP consumer thread, like
    // the stereo copy this replaces.
    let mut ch1_ch2 = vec![0.0_f64; ch as usize];
    ch1_ch2[0] = 1.0;
    ch1_ch2[1] = 1.0;
    self.push_interleaved_weighted(interleaved, ch, &ch1_ch2)
  }
```

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib dsp::loudness`
Expected: all pass, including the existing `manual_51_ignores_lfe_for_loudness`,
`surround71_lfe_has_zero_weight` and `manual_51_matches_stereo_when_only_fl_fr_present`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dsp/loudness.rs
git commit -m "fix(dsp): weight 7.x back surrounds per BS.1770-5 and share one layout table" -m "Back surrounds (Lb/Rb, +/-135 deg) now weigh 1.00 instead of 1.41, per ITU-R BS.1770-5 Annex 3 Table 5. 7.0 and 7.1 loudness readings drop by up to 1.5 LU depending on back-surround energy. Channel order is WAVE/ffmpeg: L R C LFE Lb Rb Ls Rs. LCR and quad are now measured with standard weights instead of Ch1/Ch2." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `LoudnessMeter` True Peak over every channel

**Files:**
- Modify: `src-tauri/src/dsp/loudness.rs` (struct fields lines 26–32, `new` lines 49–70, `push_interleaved_weighted` lines 234–292)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module:

```rust
  /// BS.1770 True Peak is the maximum over every channel. An inter-sample peak on channel 8 alone
  /// must reach the overall reading while the Ch1/Ch2 readouts stay silent.
  #[test]
  fn true_peak_covers_every_channel_while_left_right_stay_ch1_ch2() {
    let sr = 48_000.0_f64;
    let channels = 8_usize;
    let mut meter = LoudnessMeter::new(sr);
    let mut overall = f64::NEG_INFINITY;
    let mut left = f64::NEG_INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut buf = Vec::with_capacity(4_800 * channels);
    for n in 0..(sr as usize) {
      let x = (std::f64::consts::PI * n as f64 / 2.0 + std::f64::consts::FRAC_PI_4).sin();
      for ch in 0..channels {
        buf.push(if ch == 7 { x as f32 } else { 0.0 });
      }
      if buf.len() >= 4_800 * channels {
        if let Some(block) = meter.push_interleaved_multichannel(
          &buf,
          channels as u16,
          ChannelLayoutSetting::Auto,
        ) {
          overall = overall.max(block.true_peak);
          left = left.max(block.true_peak_l);
          right = right.max(block.true_peak_r);
        }
        buf.clear();
      }
    }
    assert!(overall.abs() < 0.25, "channel 8 peak should reach 0 dBTP, got {overall}");
    assert!(!left.is_finite(), "Ch1 is silent, got {left}");
    assert!(!right.is_finite(), "Ch2 is silent, got {right}");
  }
```

- [ ] **Step 2: Run it to see it fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib dsp::loudness::tests::true_peak_covers_every_channel`
Expected: FAIL, `overall` is `-inf`.

- [ ] **Step 3: Implement**

Struct fields — replace

```rust
  tp_h: [Vec<f64>; 2],
  tp_wp: [usize; 2],
```

with

```rust
  /// Oversampling history per channel. Grows on the first block with more channels; never
  /// resized per sample.
  tp_h: Vec<Vec<f64>>,
  tp_wp: Vec<usize>,
```

In `new`, replace `let tp_h = [vec![0.0_f64; tp_t], vec![0.0_f64; tp_t]];` with
`let tp_h = vec![vec![0.0_f64; tp_t]; 2];`, and `tp_wp: [0, 0],` with `tp_wp: vec![0; 2],`.

Add below `tp_sample`:

```rust
  fn ensure_true_peak_channels(&mut self, channels: usize) {
    if self.tp_h.len() < channels {
      self.tp_h.resize(channels, vec![0.0_f64; self.tp_t]);
      self.tp_wp.resize(channels, 0);
    }
  }
```

In `push_interleaved_weighted`, directly after the `kf_mc` reallocation block, add:

```rust
    self.ensure_true_peak_channels(ch);
```

Replace the per-frame True Peak section (from the comment
`// Keep true-peak semantics consistent with the existing UI: report L/R from channels 1/2.` through
the `tp_block_ch[1]` update) with:

```rust
      // True Peak Max covers every channel; the L/R readouts stay Ch1/Ch2.
      for ci in 0..ch {
        let tp = self.tp_sample(interleaved[base + ci] as f64, ci);
        if tp > self.tp_block {
          self.tp_block = tp;
        }
        if ci < 2 && tp > self.tp_block_ch[ci] {
          self.tp_block_ch[ci] = tp;
        }
      }
```

- [ ] **Step 4: Run the loudness tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib dsp::loudness`
Expected: all pass, including the stereo True Peak tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dsp/loudness.rs
git commit -m "fix(dsp): measure live True Peak Max across every channel" -m "True Peak Max, and the PSR/PLR derived from it, now include channels beyond Ch1/Ch2. The True Peak L/R readouts still report Ch1/Ch2." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Layout metadata from the table

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs:44-72` and tests near line 3922

- [ ] **Step 1: Write the failing tests**

Add to the `meter_pipeline.rs` tests module:

```rust
  #[test]
  fn loudness_layout_meta_names_lcr_and_quad() {
    assert_eq!(
      loudness_layout_meta(3, ChannelLayoutSetting::Auto),
      ("lcr".to_string(), true)
    );
    assert_eq!(
      loudness_layout_meta(4, ChannelLayoutSetting::Auto),
      ("quad".to_string(), true)
    );
  }

  #[test]
  fn loudness_layout_meta_reports_unknown_above_eight_channels() {
    for channels in [9_u16, 10, 12, 16] {
      assert_eq!(
        loudness_layout_meta(channels, ChannelLayoutSetting::Auto),
        ("unknown".to_string(), false),
        "{channels} channels"
      );
    }
  }

  #[test]
  fn manual_surround_presets_need_their_exact_channel_count() {
    assert_eq!(
      loudness_layout_meta(8, ChannelLayoutSetting::Surround51),
      ("stereo".to_string(), false)
    );
    assert_eq!(
      loudness_layout_meta(10, ChannelLayoutSetting::Surround71),
      ("stereo".to_string(), false)
    );
  }

```

- [ ] **Step 2: Run to see them fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib engine::meter_pipeline::tests`
Expected: FAIL for `lcr` / `quad` and for manual presets above their count.

- [ ] **Step 3: Implement**

Replace `loudness_layout_meta` with:

```rust
fn loudness_layout_meta(channels: u16, channel_layout: ChannelLayoutSetting) -> (String, bool) {
  let ch = channels.max(1);
  match channel_layout {
    ChannelLayoutSetting::Stereo => ("stereo".to_string(), true),
    ChannelLayoutSetting::Surround51 if ch == 6 => ("5.1".to_string(), true),
    ChannelLayoutSetting::Surround71 if ch == 8 => ("7.1".to_string(), true),
    ChannelLayoutSetting::Surround51 | ChannelLayoutSetting::Surround71 => {
      ("stereo".to_string(), false)
    }
    ChannelLayoutSetting::Auto => match standard_layout_name(ch) {
      Some(name) => (name.to_string(), true),
      None => ("unknown".to_string(), false),
    },
  }
}
```

- [ ] **Step 4: Run the Rust tests**

Run: `npm run rust:test`
Expected: all pass, including the existing `loudness_layout_meta_*` tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine/meter_pipeline.rs
git commit -m "fix(engine): report LCR, quad and unknown loudness layouts from the shared table" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `SummaryMeter` uses the table, covers every channel, reports layout

**Files:**
- Modify: `src-tauri/src/dsp/summary_meter.rs`
- Modify: `src-tauri/src/file_analysis/summary.rs:181-194`
- Modify: `src-tauri/src/file_analysis/types.rs:44-60`
- Modify: `src-tauri/src/file_analysis/session.rs:418-431` and test helpers at 1068–1125
- Modify: `src-tauri/src/engine/meter_pipeline.rs` (`PipelineSummary`, `summary_metrics`, struct field, `new`, layout update)
- Modify: `src-tauri/src/cli_analyze.rs:137-155`, `summary_from_metrics`, test helper `summary_with_peaks`
- Modify: `src-tauri/src/audio/capture_summary.rs:26-40, 132-146`
- Modify: `src-tauri/src/cli_capture.rs:77-86, 146-160` and test fixture at 213

This task changes several structs together because `FileAnalysisSummaryMetrics` is constructed on
both the CLI and GUI paths; the crate does not compile until every constructor carries the fields.

- [ ] **Step 1: Write the failing `SummaryMeter` tests**

Append to `src-tauri/src/dsp/summary_meter.rs`:

```rust
#[cfg(test)]
mod tests {
  use super::*;

  fn run(channels: u16, pcm: &[f32]) -> SummaryMetrics {
    let mut meter = SummaryMeter::new(48_000, channels);
    meter.push_interleaved(pcm);
    meter.finish()
  }

  #[test]
  fn true_peak_max_covers_every_channel() {
    let channels = 8_usize;
    let mut pcm = Vec::with_capacity(48_000 * channels);
    for n in 0..48_000 {
      let x = (std::f64::consts::PI * n as f64 / 2.0 + std::f64::consts::FRAC_PI_4).sin();
      for ch in 0..channels {
        pcm.push(if ch == 7 { x as f32 } else { 0.0 });
      }
    }
    let metrics = run(channels as u16, &pcm);
    assert!(
      metrics.true_peak_max_dbtp.abs() < 0.25,
      "channel 8 peak should reach 0 dBTP, got {}",
      metrics.true_peak_max_dbtp
    );
    assert!(!metrics.sample_peak_max_l_db.is_finite());
  }

  #[test]
  fn layout_is_reported_from_channel_count() {
    let eight = run(8, &vec![0.0; 4_800 * 8]);
    assert_eq!((eight.loudness_layout, eight.loudness_layout_known), ("7.1", true));
    let ten = run(10, &vec![0.0; 4_800 * 10]);
    assert_eq!((ten.loudness_layout, ten.loudness_layout_known), ("unknown", false));
  }

  #[test]
  fn back_surrounds_weigh_one_point_five_lu_below_side_surrounds() {
    let tone = |active: [usize; 2]| -> Vec<f32> {
      let mut pcm = vec![0.0_f32; 48_000 * 4 * 8];
      for n in 0..48_000 * 4 {
        let s = (2.0 * std::f64::consts::PI * 1000.0 * n as f64 / 48_000.0).sin() as f32 * 0.1;
        for ch in active {
          pcm[n * 8 + ch] = s;
        }
      }
      pcm
    };
    let back = run(8, &tone([4, 5]));
    let side = run(8, &tone([6, 7]));
    assert!(
      (side.integrated_lufs - back.integrated_lufs - 1.5).abs() < 0.01,
      "side {} vs back {}",
      side.integrated_lufs,
      back.integrated_lufs
    );
  }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib dsp::summary_meter`
Expected: compile error (`loudness_layout` missing on `SummaryMetrics`).

- [ ] **Step 3: Implement `SummaryMeter`**

Imports — replace the `gating` import with:

```rust
use crate::dsp::channel_weights::{standard_layout_name, standard_loudness_weights};
use crate::dsp::gating::{gated_integrated_lufs, gated_lra, lufs_from_mean_squares, IBL_CAP, STH_CAP};
```

`SummaryMetrics` gains, after `sample_peak_max_r_db`:

```rust
  /// `standard_layout_name` for the channel count, or `"unknown"` (Ch1/Ch2 stereo loudness).
  pub loudness_layout: &'static str,
  pub loudness_layout_known: bool,
```

Struct fields: `tp_h: [Vec<f64>; 2],` → `tp_h: Vec<Vec<f64>>,` and `tp_wp: [usize; 2],` →
`tp_wp: Vec<usize>,`. In `new`, replace the two initializers with:

```rust
      tp_h: vec![vec![0.0_f64; tp_t]; channels.max(1) as usize],
      tp_wp: vec![0; channels.max(1) as usize],
```

Add a field after `kf_mc`:

```rust
  /// BS.1770-5 weights for a standard layout; Ch1/Ch2 only for an unrecognized count above two;
  /// `None` for mono and stereo, which keep their dedicated paths.
  loudness_weights: Option<Vec<f64>>,
```

and initialize it in `new`, after `kf_mc: Vec::new(),`:

```rust
      loudness_weights: match standard_loudness_weights(channels.max(1)) {
        Some(weights) => Some(weights.to_vec()),
        None if channels > 2 => {
          let mut ch1_ch2 = vec![0.0; channels as usize];
          ch1_ch2[0] = 1.0;
          ch1_ch2[1] = 1.0;
          Some(ch1_ch2)
        }
        None => None,
      },
```

Replace `push_interleaved` with:

```rust
  pub fn push_interleaved(&mut self, interleaved: &[f32]) {
    let channels = self.channels.max(1) as usize;
    let frames = interleaved.len() / channels;
    // Taken out and put back so the loop can borrow the filters mutably.
    let weights = self.loudness_weights.take();
    self.ensure_multichannel_filters(weights.as_ref().map_or(0, |weights| weights.len()));
    for frame in 0..frames {
      let base = frame * channels;
      let sum_ms = if let Some(weights) = weights.as_deref() {
        let mut sum_ms = 0.0_f64;
        for (index, weight) in weights.iter().copied().enumerate() {
          if weight == 0.0 {
            continue;
          }
          let sample = interleaved[base + index] as f64;
          let weighted = self.kf_mc[index].tick(sample);
          sum_ms += weight * weighted * weighted;
        }
        sum_ms
      } else if channels == 1 {
        let sample = interleaved[base] as f64;
        let (kw_l, kw_r) = self.kf.tick_lr(sample, sample);
        kw_l * kw_l + kw_r * kw_r
      } else {
        let left = interleaved[base] as f64;
        let right = interleaved[base + 1] as f64;
        let (kw_l, kw_r) = self.kf.tick_lr(left, right);
        kw_l * kw_l + kw_r * kw_r
      };

      self.block_sum[0] += sum_ms;
      self.update_peaks(&interleaved[base..base + channels]);
      self.block_frames += 1;
      if self.block_frames >= self.block_size {
        self.close_block();
      }
    }
    self.loudness_weights = weights;
  }
```

In `finish`, add after `sample_peak_max_r_db`:

```rust
      loudness_layout: standard_layout_name(self.channels.max(1)).unwrap_or("unknown"),
      loudness_layout_known: standard_layout_name(self.channels.max(1)).is_some(),
```

Delete `fn auto_weights`. Replace `update_peaks` with:

```rust
  /// Sample peaks stay Ch1/Ch2; True Peak Max covers every channel.
  fn update_peaks(&mut self, frame: &[f32]) {
    let left = frame[0] as f64;
    let right = if frame.len() > 1 { frame[1] as f64 } else { left };
    self.sample_peak_max_l = self.sample_peak_max_l.max(left.abs());
    self.sample_peak_max_r = self.sample_peak_max_r.max(right.abs());
    for (channel, sample) in frame.iter().enumerate() {
      let tp = self.tp_sample(*sample as f64, channel);
      self.true_peak_max = self.true_peak_max.max(tp);
    }
  }
```

- [ ] **Step 4: Carry layout through every summary struct**

`src-tauri/src/file_analysis/types.rs` — add to `FileAnalysisSummaryMetrics` after
`sample_peak_max_r_db`:

```rust
  /// Loudness layout the summary was measured with (`stereo`, `7.1`, `custom`, `unknown`, ...).
  pub loudness_layout: String,
  /// False when loudness is Ch1/Ch2 stereo loudness of an unrecognized layout.
  pub loudness_layout_known: bool,
```

`src-tauri/src/file_analysis/summary.rs` — in the `FileAnalysisSummaryMetrics` literal add:

```rust
    loudness_layout: metrics.loudness_layout.to_string(),
    loudness_layout_known: metrics.loudness_layout_known,
```

`src-tauri/src/file_analysis/session.rs` — in `run_summary_path`'s literal add the same two lines.

`src-tauri/src/engine/meter_pipeline.rs`:

1. Import: add `use crate::dsp::channel_weights::standard_layout_name;`.
2. `PipelineSummary` gains after `dialogue_lra`:

```rust
  pub loudness_layout: String,
  pub loudness_layout_known: bool,
```

3. `MeterPipeline` struct gains after `last_loudness_weights`:

```rust
  /// Layout reported with the most recent PCM push, for whole-file summaries.
  last_loudness_layout: (String, bool),
```

4. In `new`, after `last_loudness_weights: None,` add
   `last_loudness_layout: loudness_layout_meta(channels, ChannelLayoutSetting::Auto),`.
   If `new_for_file` builds the struct with its own literal instead of calling `new`, add the same
   line there.
5. Right after the `let (loudness_layout, loudness_layout_known) = ...;` statement, add:

```rust
    if self.last_loudness_layout.0 != loudness_layout
      || self.last_loudness_layout.1 != loudness_layout_known
    {
      self.last_loudness_layout = (loudness_layout.clone(), loudness_layout_known);
    }
```

6. In `summary_metrics`, add to the literal:

```rust
      loudness_layout: self.last_loudness_layout.0.clone(),
      loudness_layout_known: self.last_loudness_layout.1,
```

`src-tauri/src/file_analysis/session.rs` — in the live `FileAnalysisSummaryMetrics` literal
(line ~418) and in `run_session_path`'s literal add:

```rust
    loudness_layout: metrics.loudness_layout,
    loudness_layout_known: metrics.loudness_layout_known,
```

`src-tauri/src/cli_analyze.rs` — `CliAnalyzeSummary` gains after `channel_count`:

```rust
  pub loudness_layout: String,
  pub loudness_layout_known: bool,
```

`summary_from_metrics` gains, after `channel_count: summary.channels,`:

```rust
    loudness_layout: summary.loudness_layout.clone(),
    loudness_layout_known: summary.loudness_layout_known,
```

and `summary_with_peaks` gains `loudness_layout: "stereo".to_string(), loudness_layout_known: true,`.

`src-tauri/src/audio/capture_summary.rs` — `CaptureRun` gains after `sample_peak_max_r_db`:

```rust
  pub loudness_layout: &'static str,
  pub loudness_layout_known: bool,
```

and the `Ok(CaptureRun { ... })` literal gains:

```rust
    loudness_layout: metrics.loudness_layout,
    loudness_layout_known: metrics.loudness_layout_known,
```

`src-tauri/src/cli_capture.rs` — `CliCaptureSummary` gains after `sample_peak_max_db`:

```rust
  pub loudness_layout: String,
  pub loudness_layout_known: bool,
```

`success_report` gains in the `CliCaptureSummary` literal:

```rust
        loudness_layout: run.loudness_layout.to_string(),
        loudness_layout_known: run.loudness_layout_known,
```

and the test fixture `run()` gains `loudness_layout: "stereo", loudness_layout_known: true,`.

- [ ] **Step 5: Add contract tests for the JSON fields**

In `src-tauri/src/cli_capture.rs` tests, next to the existing `json["summary"]["integratedLufs"]`
assertions, add:

```rust
    assert_eq!(json["summary"]["loudnessLayout"], "stereo");
    assert_eq!(json["summary"]["loudnessLayoutKnown"], true);
```

In `src-tauri/src/cli_analyze.rs` tests, add:

```rust
  #[test]
  fn summary_reports_the_loudness_layout() {
    let mut metrics = summary_with_peaks(-1.0, -2.0);
    metrics.loudness_layout = "unknown".to_string();
    metrics.loudness_layout_known = false;
    let json = serde_json::to_value(summary_from_metrics(metrics, false)).unwrap();
    assert_eq!(json["loudnessLayout"], "unknown");
    assert_eq!(json["loudnessLayoutKnown"], false);
  }
```

In `src-tauri/src/engine/meter_pipeline.rs` tests, add:

```rust
  #[test]
  fn summary_metrics_report_the_frame_layout() {
    for (channels, expected) in [(8_u16, ("7.1", true)), (10, ("unknown", false))] {
      let mut pipeline = MeterPipeline::new(48_000, channels);
      let pcm = vec![0.1_f32; 4_800 * channels as usize];
      let frame = push_pcm_no_requests(&mut pipeline, &pcm, ChannelLayoutSetting::Auto, None, false)
        .expect("100ms chunk should emit a frame");
      assert_eq!(
        (frame.loudness_layout.as_str(), frame.loudness_layout_known),
        expected
      );
      let summary = pipeline.summary_metrics();
      assert_eq!(
        (summary.loudness_layout.as_str(), summary.loudness_layout_known),
        expected
      );
    }
  }
```

- [ ] **Step 6: Add the multichannel CLI/GUI parity test**

In `src-tauri/src/file_analysis/session.rs` tests, next to
`summary_and_session_paths_agree_on_delivery_metrics`, add:

```rust
  /// The weight table and True Peak are shared by name, not by code path: `SummaryMeter` and
  /// `LoudnessMeter` each implement the sum. Pin them together for every standard multichannel
  /// count and for an unknown one.
  #[test]
  fn summary_and_session_paths_agree_for_multichannel_layouts() {
    const FFMPEG_READ_SAMPLES: usize = (64 * 1024) / 4;
    let sr = 48_000_u32;
    let stereo = stepped_sine_stereo_f32(sr, 12);
    for channels in [3_u16, 4, 5, 6, 7, 8, 10] {
      let pcm: Vec<f32> = stereo
        .chunks_exact(2)
        .flat_map(|frame| (0..channels).map(move |ci| frame[0] / (ci as f32 + 1.0)))
        .collect();
      let cli = run_summary_path(&pcm, sr, channels, FFMPEG_READ_SAMPLES);
      let gui = run_session_path(&pcm, sr, channels, FFMPEG_READ_SAMPLES);
      for (name, a, b) in [
        ("integrated_lufs", cli.integrated_lufs, gui.integrated_lufs),
        ("m_max_lufs", cli.m_max_lufs, gui.m_max_lufs),
        ("st_max_lufs", cli.st_max_lufs, gui.st_max_lufs),
        ("true_peak_max_dbtp", cli.true_peak_max_dbtp, gui.true_peak_max_dbtp),
      ] {
        assert!((a - b).abs() < 1e-9, "{channels} ch {name}: cli {a} vs gui {b}");
      }
      assert_eq!(cli.loudness_layout, gui.loudness_layout, "{channels} ch");
      assert_eq!(cli.loudness_layout_known, gui.loudness_layout_known, "{channels} ch");
    }
  }
```

- [ ] **Step 7: Run the Rust test suite**

Run: `npm run rust:test`
Expected: all pass. If `summary_and_session_paths_agree_for_multichannel_layouts` fails on a
metric, the two meters diverge in weighting or block handling; fix the divergence, do not widen the
tolerance.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src
git commit -m "fix(dsp): share layout weights and all-channel True Peak with CLI summaries" -m "plvs-cli analyze and capture now use the BS.1770-5 layout table, measure True Peak Max across every channel, and report loudnessLayout / loudnessLayoutKnown. File-analysis summaries carry the same fields." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend labels and role weights

**Files:**
- Modify: `src/math/peakMeterChannelLabels.js:1-49` and `src/math/peakMeterChannelLabels.test.js:18,22,81-120`
- Modify: `src/math/channelRoles.js:1-4,53-70` and `src/math/channelRoles.test.js:52-75`

- [ ] **Step 1: Update the tests to the new expectations**

`peakMeterChannelLabels.test.js`:

- line 18 expectation → `["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"]`
- line 22 expectation → `["L", "R", "C", "Lb", "Rb", "Ls", "Rs"]`
- in `shows ITU labels when resolvedLayout is a known format`, the `resolvedLayout: "7.1"`
  expectation → `["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"]` and the `"7.0"` expectation →
  `["L", "R", "C", "Lb", "Rb", "Ls", "Rs"]`.

`channelRoles.test.js` — replace the two surround-weight `it` blocks in
`describe("roleTokensToLoudnessWeights")` (the ones declaring `const surroundWeight`) with:

```js
  it("weights side surrounds +1.5 dB and back or centre surrounds at unity (BS.1770-5)", () => {
    const surroundWeight = 10 ** (1.5 / 10);
    expect(roleTokensToLoudnessWeights(["Ls", "Rs", "Lb", "Rb", "Cs"])).toEqual([
      surroundWeight,
      surroundWeight,
      1,
      1,
      1,
    ]);
  });

  it("weights a 7.0 layout in WAVE order", () => {
    const surroundWeight = 10 ** (1.5 / 10);
    expect(roleTokensToLoudnessWeights(["L", "R", "C", "Lb", "Rb", "Ls", "Rs"])).toEqual([
      1,
      1,
      1,
      1,
      1,
      surroundWeight,
      surroundWeight,
    ]);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/math/peakMeterChannelLabels.test.js src/math/channelRoles.test.js`
Expected: FAIL on the 7.x labels and on `Lb/Rb/Cs` weights.

- [ ] **Step 3: Implement**

`peakMeterChannelLabels.js` — replace the header doc comment's first two lines with:

```js
/**
 * Peak meter column titles by interleaved channel index, in WAVE / ffmpeg channel order:
 * 5.1 is FL FR FC LFE SL SR → L R C LFE Ls Rs; 7.1 is FL FR FC LFE BL BR SL SR →
 * L R C LFE Lb Rb Ls Rs. Must match `src-tauri/src/dsp/channel_weights.rs`.
```

and the two entries:

```js
  surround70: {
    id: "surround70",
    channels: 7,
    labels: ["L", "R", "C", "Lb", "Rb", "Ls", "Rs"],
  },
  surround71: {
    id: "surround71",
    channels: 8,
    labels: ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"],
  },
```

`channelRoles.js` — replace the header comment with:

```js
/**
 * Fixed per-channel role vocabulary and pure helpers for the user channel-label override.
 * Roles drive both labels and BS.1770-5 loudness weights (Annex 3 Table 5).
 */
```

and in `LOUDNESS_WEIGHT_BY_ROLE_ID`:

```js
  ["Lb", 1],
  ["Rb", 1],
  ["Cs", 1],
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/math src/runtime/appRuntimeDerivations.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/math/peakMeterChannelLabels.js src/math/peakMeterChannelLabels.test.js src/math/channelRoles.js src/math/channelRoles.test.js
git commit -m "fix(channels): label 7.x in WAVE order and weight back surrounds at unity" -m "Default 7.0/7.1 labels now read L R C (LFE) Lb Rb Ls Rs, matching the engine. Saved 7.x channel-label overrides are not migrated; users who saved the old default labels should re-check them." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Carry `loudnessLayoutKnown` through live frames and history

**Files:**
- Modify: `src/lib/tauriFrameApply.js` (`reduceMeterAudioFrame`) and `src/lib/tauriFrameApply.test.js`
- Modify: `src/lib/FrameIntake.js` (`buildAudioSnap`)
- Modify: `src/lib/AudioSnapHistorySlab.js` and `src/lib/AudioSnapHistorySlab.test.js`
- Modify: `src/ipc/types.js` (`AudioFramePayload` typedef)

- [ ] **Step 1: Write the failing tests**

`tauriFrameApply.test.js`, inside `describe("buildTauriFrameApply")`:

```js
  it("carries whether the loudness layout is known, defaulting to known", () => {
    const { reduceMeterAudioFrame } = tauriFrameApply;
    expect(reduceMeterAudioFrame({}, { loudnessLayoutKnown: false }).loudnessLayoutKnown).toBe(
      false
    );
    expect(reduceMeterAudioFrame({}, { loudnessLayoutKnown: true }).loudnessLayoutKnown).toBe(true);
    expect(reduceMeterAudioFrame({ loudnessLayoutKnown: false }, {}).loudnessLayoutKnown).toBe(
      false
    );
    expect(reduceMeterAudioFrame({}, {}).loudnessLayoutKnown).toBe(true);
  });
```

`AudioSnapHistorySlab.test.js`, inside its top-level `describe`:

```js
  it("keeps whether the loudness layout was known", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap({ loudnessLayoutKnown: false }), 100);
    slab.push(snap({ loudnessLayoutKnown: true }), 200);
    slab.push(snap(), 300);
    expect(slab.at(0).loudnessLayoutKnown).toBe(false);
    expect(slab.at(1).loudnessLayoutKnown).toBe(true);
    expect(slab.at(2).loudnessLayoutKnown).toBe(true);
    expect(slab.freeze().at(0).loudnessLayoutKnown).toBe(false);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/tauriFrameApply.test.js src/lib/AudioSnapHistorySlab.test.js`
Expected: FAIL, `loudnessLayoutKnown` is `undefined`.

- [ ] **Step 3: Implement**

`tauriFrameApply.js` — in the object returned by `reduceMeterAudioFrame`, after `dialogueActiveNow`:

```js
    loudnessLayoutKnown:
      typeof frame.loudnessLayoutKnown === "boolean"
        ? frame.loudnessLayoutKnown
        : (previous.loudnessLayoutKnown ?? true),
```

`FrameIntake.js` — in `buildAudioSnap`, after `dialogueActiveNow`:

```js
    loudnessLayoutKnown: row.loudnessLayoutKnown !== false,
```

`AudioSnapHistorySlab.js`:

- `createChunk`, after the `dialogueActiveNow` column:
  `chunk.loudnessLayoutKnown = new Uint8Array(VISUAL_HISTORY_CHUNK_ROWS);`
- `cloneChunk`, in the `copy` literal:
  `loudnessLayoutKnown: chunk.loudnessLayoutKnown.slice(0, chunk.rowCount),`
- `payloadBytes`, in the initial sum: `+ chunk.loudnessLayoutKnown.byteLength`
- `rowFrom`, after `dialogueActiveNow`:
  `result.loudnessLayoutKnown = chunk.loudnessLayoutKnown[row] === 1;`
- `push`, after the `dialogueActiveNow` write:
  `chunk.loudnessLayoutKnown[row] = snap?.loudnessLayoutKnown === false ? 0 : 1;`

`src/ipc/types.js` — in the `AudioFramePayload` typedef add:

```js
 * @property {string} loudnessLayout
 * @property {boolean} loudnessLayoutKnown
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauriFrameApply.js src/lib/tauriFrameApply.test.js src/lib/FrameIntake.js src/lib/AudioSnapHistorySlab.js src/lib/AudioSnapHistorySlab.test.js src/ipc/types.js
git commit -m "feat(meter): carry loudness layout knowledge through frames and history" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `Ch 1–2` marker on every loudness surface

**Files:**
- Create: `src/components/LoudnessLayoutMarker.jsx`, `src/components/LoudnessLayoutMarker.test.jsx`
- Modify: `src/components/panels/StatsPanel.jsx` (+ test)
- Modify: `src/components/panels/LoudnessPanel.jsx` (+ test)
- Modify: `src/dock/modules/DockLoudness.jsx` (+ test)
- Modify: `src/components/FileAnalysisSummary.jsx` (+ test)

- [ ] **Step 1: Write the failing component test**

Create `src/components/LoudnessLayoutMarker.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoudnessLayoutMarker, UNKNOWN_LAYOUT_TIP } from "./LoudnessLayoutMarker.jsx";

describe("LoudnessLayoutMarker", () => {
  it("renders nothing while the layout is known or not yet reported", () => {
    const { container, rerender } = render(<LoudnessLayoutMarker known={true} />);
    expect(container.textContent).toBe("");
    rerender(<LoudnessLayoutMarker known={undefined} />);
    expect(container.textContent).toBe("");
  });

  it("marks Ch1/Ch2 loudness and explains it on hover", () => {
    render(<LoudnessLayoutMarker known={false} />);
    const marker = screen.getByTestId("loudness-layout-marker");
    expect(marker.textContent).toBe("Ch 1–2");
    fireEvent.mouseEnter(marker);
    expect(screen.getByText(UNKNOWN_LAYOUT_TIP)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/LoudnessLayoutMarker.test.jsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/LoudnessLayoutMarker.jsx`:

```jsx
import { HoverTip } from "@/components/HoverTip";
import { cn } from "@/lib/utils";

export const UNKNOWN_LAYOUT_TIP = "Layout not recognized. Loudness uses channels 1–2 only.";

/**
 * Shown wherever loudness is read out while the engine measured Ch1/Ch2 of an unrecognized
 * channel layout. `known` is `loudnessLayoutKnown`; only an explicit `false` shows the marker.
 */
export function LoudnessLayoutMarker({ known, className }) {
  if (known !== false) return null;
  return (
    <HoverTip
      tip={UNKNOWN_LAYOUT_TIP}
      className={cn("inline-flex shrink-0", className)}
      tipClassName="whitespace-normal w-max max-w-[15rem]"
    >
      <span
        data-testid="loudness-layout-marker"
        aria-label="loudness uses channels 1 and 2 only"
        className="rounded-sm border border-[color:var(--ui-signal-warn)] px-1 font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-caption)] leading-none text-[color:var(--ui-signal-warn)]"
      >
        Ch 1–2
      </span>
    </HoverTip>
  );
}
```

- [ ] **Step 4: Run the component test**

Run: `npx vitest run src/components/LoudnessLayoutMarker.test.jsx`
Expected: PASS.

- [ ] **Step 5: Write the failing surface tests**

`StatsPanel.test.jsx`, inside `describe("StatsPanel")`:

```jsx
  it("marks Ch1/Ch2 loudness only when a loudness stat is visible", () => {
    renderStatsPanel({
      shared: { statsMetrics, dialogueActiveNow: false },
      panelControls: { statsVisibleIds: ["integrated"] },
      displayAudio: { integrated: -20, loudnessLayoutKnown: false },
    });
    expect(screen.getByTestId("loudness-layout-marker")).toBeTruthy();
  });

  it("does not mark stats while the layout is known", () => {
    renderStatsPanel({
      shared: { statsMetrics, dialogueActiveNow: false },
      panelControls: { statsVisibleIds: ["integrated"] },
      displayAudio: { integrated: -20, loudnessLayoutKnown: true },
    });
    expect(screen.queryByTestId("loudness-layout-marker")).toBeNull();
  });
```

`LoudnessPanel.test.jsx` — add `FrameDataProvider` to the `AudioDataContext.jsx` import, then inside
`describe("LoudnessPanel")`:

```jsx
  it("marks Ch1/Ch2 loudness when the layout is not recognized", () => {
    render(
      <FrameDataProvider value={{ displayAudio: { loudnessLayoutKnown: false } }}>
        <HistoryDataProvider value={baseAudioData}>
          <PanelInstanceProvider value={{ panelControls: {} }}>
            <LoudnessPanel />
          </PanelInstanceProvider>
        </HistoryDataProvider>
      </FrameDataProvider>
    );
    expect(screen.getByTestId("loudness-layout-marker")).toBeTruthy();
  });
```

`DockLoudness.test.jsx`, inside `describe("DockLoudness")`:

```jsx
  it("marks Ch1/Ch2 loudness when the layout is not recognized", () => {
    renderWith({ displayAudio: { integrated: -20, loudnessLayoutKnown: false } });
    expect(screen.getByTestId("loudness-layout-marker")).toBeTruthy();
  });

  it("does not mark loudness while the layout is known", () => {
    renderWith({ displayAudio: { integrated: -20, loudnessLayoutKnown: true } });
    expect(screen.queryByTestId("loudness-layout-marker")).toBeNull();
  });
```

`FileAnalysisSummary.test.jsx`, inside `describe("FileAnalysisSummary")`:

```jsx
  it("marks a completed summary measured on an unrecognized layout", () => {
    render(
      <FileAnalysisSummary
        {...menuProps}
        fileSession={{
          state: "complete",
          fileName: "stems.wav",
          metadata: {
            container: "wav",
            selectedTrack: { index: 0, codec: "pcm", sampleRateHz: 48000, channels: 12 },
          },
          summary: {
            integratedLufs: -20,
            lra: 3,
            truePeakMaxDbtp: -1,
            loudnessLayout: "unknown",
            loudnessLayoutKnown: false,
          },
        }}
      />
    );
    expect(screen.getByTestId("loudness-layout-marker")).toBeTruthy();
  });
```

- [ ] **Step 6: Run to see them fail**

Run: `npx vitest run src/components/panels/StatsPanel.test.jsx src/components/panels/LoudnessPanel.test.jsx src/dock/modules/DockLoudness.test.jsx src/components/FileAnalysisSummary.test.jsx`
Expected: the new marker tests FAIL; existing tests pass.

- [ ] **Step 7: Wire the marker into each surface**

`StatsPanel.jsx`:

```jsx
import { LoudnessLayoutMarker } from "@/components/LoudnessLayoutMarker";
```

Above `export function StatsPanel`:

```jsx
/** Stats whose value depends on how channels are summed into loudness. */
const LAYOUT_DEPENDENT_STAT_IDS = new Set([
  "momentary",
  "shortTerm",
  "integrated",
  "momentaryMax",
  "shortTermMax",
  "lra",
  "psr",
  "plr",
  "dialogueIntegrated",
  "dialogueRange",
  "dialogueOffset",
]);
```

Inside the component, after `visibleMetrics`:

```jsx
  const showsLayoutDependentStat = visibleMetrics.some((metric) =>
    LAYOUT_DEPENDENT_STAT_IDS.has(metric.id)
  );
```

and as the first child of `<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">`:

```jsx
        {showsLayoutDependentStat ? (
          <LoudnessLayoutMarker
            known={displayAudio?.loudnessLayoutKnown}
            className="self-end px-[var(--ui-metric-row-pad-x)] pb-[var(--ui-metric-list-gap)]"
          />
        ) : null}
```

`LoudnessPanel.jsx`:

```jsx
import { useFrameData, useHistoryData, usePanelInstanceData } from "../../workspace/AudioDataContext.jsx";
import { LoudnessLayoutMarker } from "@/components/LoudnessLayoutMarker";
```

(replacing the existing `AudioDataContext.jsx` import). In the component body, after
`usePanelInstanceData()`:

```jsx
  const { displayAudio } = useFrameData() ?? {};
```

and as the last child of the outer `relative` container `div`, after the inner `flex` wrapper:

```jsx
      <LoudnessLayoutMarker
        known={displayAudio?.loudnessLayoutKnown}
        className="absolute left-[var(--ui-panel-pad-x)] top-[var(--ui-panel-pad-y)] z-10"
      />
```

`DockLoudness.jsx`:

```jsx
import { LoudnessLayoutMarker } from "../../components/LoudnessLayoutMarker.jsx";
```

and inside `<div className="relative min-h-0 min-w-12 flex-1">`, after `<DockHistoryWindowHud ... />`:

```jsx
        <LoudnessLayoutMarker
          known={displayAudio?.loudnessLayoutKnown}
          className="absolute left-0 top-0"
        />
```

`FileAnalysisSummary.jsx`:

```jsx
import { LoudnessLayoutMarker } from "@/components/LoudnessLayoutMarker";
```

and after the `True Peak Max` `MetricPair`:

```jsx
          <LoudnessLayoutMarker known={summary.loudnessLayoutKnown} className="self-center" />
```

- [ ] **Step 8: Run the frontend suite and lint**

Run: `npm test && npm run lint && npm run format:check`
Expected: all pass. If `format:check` fails, run `npm run format` and re-run.

- [ ] **Step 9: Commit**

```bash
git add src/components/LoudnessLayoutMarker.jsx src/components/LoudnessLayoutMarker.test.jsx src/components/panels/StatsPanel.jsx src/components/panels/StatsPanel.test.jsx src/components/panels/LoudnessPanel.jsx src/components/panels/LoudnessPanel.test.jsx src/dock/modules/DockLoudness.jsx src/dock/modules/DockLoudness.test.jsx src/components/FileAnalysisSummary.jsx src/components/FileAnalysisSummary.test.jsx
git commit -m "feat(loudness): mark Ch1/Ch2 loudness on unrecognized channel layouts" -m "Loudness, Stats, Dock Loudness and the file summary show a Ch 1-2 marker with an explanation when the engine cannot recognize the channel layout." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/prd.md:63-66, 156, 211, 220-226`
- Modify: `docs/architecture.md:177-184`
- Modify: `docs/agent-control/measurements.md:66-68`
- Modify: `src-tauri/src/dsp/loudness.rs` doc comment on `push_interleaved_weighted` if it still
  references "architecture §5"

- [ ] **Step 1: PRD product section (lines 63–66)**

Replace the `Loudness`, `布局策略` and `布局交互` bullets with:

```markdown
  - **Loudness**：标准布局走 **正统多声道积分（L1）**，权重依据 **ITU-R BS.1770-5 Annex 3 Table 5**（侧环绕 ±90°/±110° 为 +1.5 dB，后环绕 ±135° 与其余位置为 0 dB，LFE 不计入）；当前范围覆盖 **mono / stereo / LCR / quad / 5.0 / 5.1 / 7.0 / 7.1**，声道顺序为 **WAVE / ffmpeg 原生顺序**。  
  - **True Peak**：**True Peak Max 覆盖全部声道**；True Peak L/R 读数仅表示 Ch1/Ch2。  
  - **布局策略**：**Z + Y** —— 能可靠识别标准布局则走 L1；识别失败则 **降级为 Ch1/Ch2 立体声响度**，并在 Loudness、Stats、Dock Loudness 与文件摘要中显示 **`Ch 1–2` 标记**；退化读数必须可读、不可装成「环绕正统读数」。  
  - **布局交互**：默认按声道数自动识别上述布局；设置中提供手动 **Stereo / 5.1 / 7.1** 预设。  
```

- [ ] **Step 2: PRD implementation mapping (lines 156 and 211) and gaps (A.3)**

Line 156 → `- **多声道**：按声道数自动识别 mono / stereo / LCR / quad / 5.0 / 5.1 / 7.0 / 7.1，权重依据 BS.1770-5；未知布局降级 Ch1/Ch2 并显示标记；True Peak Max 覆盖全部声道。  `

Line 211 → `- **多声道**：Level Meter 逐通道显示；按声道数自动识别 mono / stereo / LCR / quad / 5.0 / 5.1 / 7.0 / 7.1（BS.1770-5 权重，WAVE 顺序）；未知布局降级 Ch1/Ch2 并显示 `Ch 1–2` 标记；True Peak Max 覆盖全部声道；Spectrum 与 Vectorscope 支持声道/声道对选择。  `

Append to `### A.3 缺口与路线图`:

```markdown
- **手动布局预设缺口**：第 5 节承诺的手动 **Stereo / 5.1 / 7.1** 预设目前没有 UI 入口（引擎侧枚举仍在）；由多声道子项目 B（沉浸式布局）补齐，同时覆盖 5.1.2 / 5.1.4 / 7.1.2 / 7.1.4 / 9.1.6 与来源声明的声道布局。  
- **对象 / 场景音频（路线图）**：ADM BWF、Dolby Atmos 对象、Ambisonics 不在当前承诺内。BS.1770-5 Annex 4 要求先渲染到 BS.2051 扬声器布局再测量，因此需要内置渲染器，单独评估。  
```

- [ ] **Step 3: Architecture DSP table (lines 177–184)**

Replace the `loudness.rs` row and add a row after it:

```markdown
| `loudness.rs`    | K-weighting → gate → M / S / I / LRA（ITU-R BS.1770 / EBU R128）；True Peak Max 覆盖全部声道        |
| `channel_weights.rs` | 按声道数识别标准布局（mono…7.1，WAVE / ffmpeg 顺序）与 BS.1770-5 声道权重；实时与 CLI 摘要共用 |
```

(Adjust table column padding so `npx prettier --check docs/architecture.md` does not regress; the
file is not in the CI format gate.)

- [ ] **Step 4: Agent Control measurements (after line 68)**

Insert after the paragraph ending `Measurement Control never creates one.`:

```markdown
`levels.truePeak.maxDbtp` is the maximum True Peak across every channel. `leftDbtp` and `rightDbtp`
report Ch1 and Ch2 only, whatever the channel count.

`loudnessLayout` is one of `mono`, `stereo`, `lcr`, `quad`, `5.0`, `5.1`, `7.0`, `7.1`, `custom`
(a user channel-label override) or `unknown`. `unknown` means loudness is the stereo loudness of
Ch1/Ch2 and `loudnessLayoutKnown` is false. Standard layouts use WAVE / ffmpeg channel order and
ITU-R BS.1770-5 weights. Treat the set as open: later releases add immersive layouts.
```

- [ ] **Step 5: Stale code comment**

Run: `grep -n "architecture §5" src-tauri/src/dsp/loudness.rs`
If a match remains, replace `(v1.0; N>2 see architecture §5)` with `(multichannel: see channel_weights.rs)`.

- [ ] **Step 6: Commit**

```bash
git add docs/prd.md docs/architecture.md docs/agent-control/measurements.md src-tauri/src/dsp/loudness.rs
git commit -m "docs(channels): document BS.1770-5 layout weights, all-channel True Peak and Ch1/Ch2 degradation" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Verification

- [ ] **Step 1: Merge gate**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 2: Capture smoke**

Run: `npm run smoke:capture`
Expected: pass. The rig is stereo VB-Cable, so the integrated-loudness baseline must be unchanged.
If the rig is unavailable, stop and ask the user (AGENTS.md: never route around a red smoke).

- [ ] **Step 3: Manual checks in `npm run desktop`** (report results to the user; do not claim them)

1. Windows, 7.1 file in File mode: labels read `L R C LFE Lb Rb Ls Rs`; no marker.
2. A 10- or 12-channel WAV in File mode: `Ch 1–2` marker on Loudness, Stats, Dock Loudness and the
   file summary; the tooltip text matches the spec; scrubbing history keeps the marker.
3. A 7.1 file with a peak only on channel 8: TP Max marker in the Level Meter reflects it.
4. macOS with a 7.1 device (spec risk 1): verify which physical speaker slots 5–6 and 7–8 map to.
5. Marker placement does not overlap the Loudness history HUD or Dock history HUD.

- [ ] **Step 4: Update spec status and remind about soak**

Change line 3 of the spec to `Status: Implemented (<date>) per docs/superpowers/plans/2026-09-15-multichannel-measurement-correctness.md.`
and commit `docs(spec): mark multichannel measurement correctness implemented`.

Remind the user to run `npm run soak:capture` (4 hours) after merge; judge it against the retained
0.0028–0.0034 dB band.
