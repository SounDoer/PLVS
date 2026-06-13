//! Dialogue-gated loudness accumulation.
//!
//! Given a stream of per-100ms K-weighted mean-square blocks, each tagged with a
//! speech/non-speech decision from the VAD sidechain, this computes the dialogue-gated
//! integrated loudness, dialogue LRA, and the dialogue percentage. The BS.1770 −70/−10
//! gate math is identical to the main integrated loudness path; only the input set
//! differs (speech-classified blocks for loudness, energy-gated blocks for the %
//! denominator).

use super::loudness::{gated_integrated_lufs, gated_lra, lufs_from_mean_squares};

/// Accumulates speech-classified loudness blocks for dialogue-gated readouts.
pub struct DialogueIntegrator {
  /// Mean-square blocks `[m0, m1]` that were speech-classified AND passed the −70 LUFS gate.
  speech_blocks: Vec<[f64; 2]>,
  /// Short-term loudness values (LUFS) observed at speech-classified blocks, for dialogue LRA.
  speech_short_terms: Vec<f64>,
  /// Count of blocks that passed the −70 LUFS absolute gate (the % denominator).
  gated_total: usize,
  /// Count of blocks that were both speech-classified and passed the −70 LUFS gate.
  speech_gated: usize,
}

impl DialogueIntegrator {
  pub fn new() -> Self {
    Self {
      speech_blocks: Vec::new(),
      speech_short_terms: Vec::new(),
      gated_total: 0,
      speech_gated: 0,
    }
  }

  /// Feed one 100ms block: its mean-square energy `ms`, the current short-term loudness
  /// `short_term` (LUFS), and whether the block was speech-classified.
  pub fn push_block(&mut self, ms: [f64; 2], short_term: f64, is_speech: bool) {
    if lufs_from_mean_squares(ms[0], ms[1]) <= -70.0 {
      return;
    }
    self.gated_total += 1;
    if is_speech {
      self.speech_gated += 1;
      self.speech_blocks.push(ms);
      self.speech_short_terms.push(short_term);
    }
  }

  /// Dialogue percentage: speech-and-audible blocks over audible blocks, in 0..=100.
  pub fn percent(&self) -> f64 {
    if self.gated_total == 0 {
      0.0
    } else {
      100.0 * self.speech_gated as f64 / self.gated_total as f64
    }
  }

  /// Dialogue-gated integrated loudness over speech-classified blocks (LUFS),
  /// `NEG_INFINITY` when there are no qualifying speech blocks.
  pub fn integrated(&self) -> f64 {
    gated_integrated_lufs(&self.speech_blocks)
  }

  /// Dialogue Range: loudness range over the short-term values seen during speech.
  pub fn lra(&self) -> f64 {
    gated_lra(&self.speech_short_terms)
  }

  pub fn reset(&mut self) {
    *self = Self::new();
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Mean-square block `[m0, m1]` whose combined energy sits at `lufs` (split evenly).
  fn ms_for_lufs(lufs: f64) -> [f64; 2] {
    let s = 10_f64.powf((lufs + 0.691) / 10.0);
    [s / 2.0, s / 2.0]
  }

  #[test]
  fn percent_is_speech_blocks_over_audible_blocks() {
    let mut d = DialogueIntegrator::new();
    let audible = ms_for_lufs(-23.0);
    d.push_block(audible, -23.0, true);
    d.push_block(audible, -23.0, false);
    d.push_block(audible, -23.0, false);
    d.push_block(audible, -23.0, false);
    assert_eq!(d.percent(), 25.0);
  }

  #[test]
  fn percent_excludes_silent_blocks_from_denominator() {
    let mut d = DialogueIntegrator::new();
    let audible = ms_for_lufs(-23.0);
    let silent = ms_for_lufs(-80.0); // below the −70 LUFS absolute gate
    d.push_block(audible, -23.0, true);
    d.push_block(audible, -23.0, true);
    d.push_block(silent, -80.0, true);
    d.push_block(silent, -80.0, true);
    // Only the two audible blocks count; both are speech → 100%, not 50%.
    assert_eq!(d.percent(), 100.0);
  }

  #[test]
  fn integrated_measures_speech_blocks_and_ignores_loud_non_speech() {
    let mut d = DialogueIntegrator::new();
    let speech = ms_for_lufs(-23.0);
    let loud_music = ms_for_lufs(-10.0);
    for _ in 0..20 {
      d.push_block(speech, -23.0, true);
      d.push_block(loud_music, -10.0, false);
    }
    // Dialogue integrated should reflect the −23 LUFS speech, not be pulled up by the
    // louder non-speech blocks.
    assert!(
      (d.integrated() - (-23.0)).abs() < 0.1,
      "dialogue integrated should be ~-23 LUFS, got {}",
      d.integrated()
    );
  }

  #[test]
  fn lra_reflects_speech_short_term_spread_only() {
    let mut d = DialogueIntegrator::new();
    let block = ms_for_lufs(-23.0); // keep blocks audible; LRA uses the short-term arg
                                    // Speech short-terms alternate between -28 and -18 LUFS → ~10 LU range.
    for _ in 0..50 {
      d.push_block(block, -28.0, true);
      d.push_block(block, -18.0, true);
      // Loud non-speech short-terms must not widen the dialogue range.
      d.push_block(block, 0.0, false);
    }
    let lra = d.lra();
    assert!(
      (lra - 10.0).abs() < 1.0,
      "dialogue LRA should reflect the ~10 LU speech spread, got {lra}"
    );
  }
}
