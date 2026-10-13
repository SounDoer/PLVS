//! Dialogue-gated loudness accumulation.
//!
//! Given a stream of per-100ms K-weighted mean-square blocks, each tagged with a
//! speech/non-speech decision from the VAD sidechain, this computes the dialogue-gated
//! loudness, PLVS Dialogue Range, and Dialogue Coverage. Dialogue selection is independent
//! from the programme-relative gate and from the Coverage denominator.

use super::gating::{lufs_from_mean_squares, WeightedRangeAccumulator};

const RANGE_WINDOW_BLOCKS: usize = 30;
const RANGE_HOP_BLOCKS: usize = 10;

struct DialogueRangeAccumulator {
  recent: [Option<[f64; 2]>; RANGE_WINDOW_BLOCKS],
  recent_head: usize,
  block_count: usize,
  observations: WeightedRangeAccumulator,
}

impl DialogueRangeAccumulator {
  fn new() -> Self {
    Self {
      recent: [None; RANGE_WINDOW_BLOCKS],
      recent_head: 0,
      block_count: 0,
      observations: WeightedRangeAccumulator::new(),
    }
  }

  fn push(&mut self, selected: Option<[f64; 2]>) {
    self.recent[self.recent_head] = selected;
    self.recent_head = (self.recent_head + 1) % RANGE_WINDOW_BLOCKS;
    self.block_count += 1;
    if self.block_count < RANGE_WINDOW_BLOCKS
      || !(self.block_count - RANGE_WINDOW_BLOCKS).is_multiple_of(RANGE_HOP_BLOCKS)
    {
      return;
    }

    let (count, sum0, sum1) = self
      .recent
      .iter()
      .flatten()
      .fold((0_usize, 0.0_f64, 0.0_f64), |(count, sum0, sum1), block| {
        (count + 1, sum0 + block[0], sum1 + block[1])
      });
    if count == 0 {
      return;
    }
    let loudness = lufs_from_mean_squares(sum0 / count as f64, sum1 / count as f64);
    self.observations.push(loudness, count);
  }

  fn value(&self) -> f64 {
    self.observations.value()
  }
}

/// Accumulates speech-classified loudness blocks for dialogue-gated readouts.
pub struct DialogueIntegrator {
  integrated_sum: [f64; 2],
  integrated_count: usize,
  range: DialogueRangeAccumulator,
  /// Every valid 100 ms measurement block, including silence.
  valid_blocks: usize,
  /// Valid blocks classified as dialogue, without a loudness gate.
  dialogue_blocks: usize,
}

impl DialogueIntegrator {
  pub fn new() -> Self {
    Self {
      integrated_sum: [0.0, 0.0],
      integrated_count: 0,
      range: DialogueRangeAccumulator::new(),
      valid_blocks: 0,
      dialogue_blocks: 0,
    }
  }

  /// Feed one time-aligned 100 ms programme-energy block and dialogue decision.
  pub fn push_block(&mut self, ms: [f64; 2], is_speech: bool) {
    self.valid_blocks += 1;
    if is_speech {
      self.dialogue_blocks += 1;
    }

    if is_speech && lufs_from_mean_squares(ms[0], ms[1]) > -70.0 {
      self.integrated_sum[0] += ms[0];
      self.integrated_sum[1] += ms[1];
      self.integrated_count += 1;
    }
    let selected = (is_speech && lufs_from_mean_squares(ms[0], ms[1]) > -70.0).then_some(ms);
    self.range.push(selected);
  }

  /// Dialogue Coverage: dialogue-classified duration over all valid measurement time.
  pub fn percent(&self) -> f64 {
    if self.valid_blocks == 0 {
      f64::NEG_INFINITY
    } else {
      100.0 * self.dialogue_blocks as f64 / self.valid_blocks as f64
    }
  }

  /// Dialogue-gated integrated loudness over speech-classified blocks (LUFS),
  /// `NEG_INFINITY` when there are no qualifying speech blocks.
  pub fn integrated(&self) -> f64 {
    if self.integrated_count == 0 {
      f64::NEG_INFINITY
    } else {
      lufs_from_mean_squares(
        self.integrated_sum[0] / self.integrated_count as f64,
        self.integrated_sum[1] / self.integrated_count as f64,
      )
    }
  }

  /// PLVS Dialogue Range over three-second, dialogue-masked observations.
  pub fn lra(&self) -> f64 {
    self.range.value()
  }

  pub fn reset(&mut self) {
    *self = Self::new();
  }

  #[cfg(test)]
  pub(crate) fn valid_blocks_for_test(&self) -> usize {
    self.valid_blocks
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
  fn percent_is_speech_blocks_over_valid_blocks() {
    let mut d = DialogueIntegrator::new();
    let audible = ms_for_lufs(-23.0);
    d.push_block(audible, true);
    d.push_block(audible, false);
    d.push_block(audible, false);
    d.push_block(audible, false);
    assert_eq!(d.percent(), 25.0);
  }

  #[test]
  fn percent_includes_silent_blocks_in_valid_time() {
    let mut d = DialogueIntegrator::new();
    let audible = ms_for_lufs(-23.0);
    let silent = ms_for_lufs(-80.0); // below the −70 LUFS absolute gate
    d.push_block(audible, true);
    d.push_block(audible, true);
    d.push_block(silent, false);
    d.push_block(silent, false);
    assert_eq!(d.percent(), 50.0);
  }

  #[test]
  fn integrated_measures_speech_blocks_and_ignores_loud_non_speech() {
    let mut d = DialogueIntegrator::new();
    let speech = ms_for_lufs(-23.0);
    let loud_music = ms_for_lufs(-10.0);
    for _ in 0..20 {
      d.push_block(speech, true);
      d.push_block(loud_music, false);
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
  fn integrated_has_no_programme_relative_gate() {
    let mut d = DialogueIntegrator::new();
    let loud = ms_for_lufs(-20.0);
    let quiet = ms_for_lufs(-50.0);
    d.push_block(loud, true);
    for _ in 0..9 {
      d.push_block(quiet, true);
    }
    assert!(
      d.integrated() < -29.0,
      "quiet dialogue must not be relatively gated"
    );
  }

  #[test]
  fn range_uses_dialogue_masked_three_second_observations() {
    let mut d = DialogueIntegrator::new();
    for _ in 0..30 {
      d.push_block(ms_for_lufs(-28.0), true);
    }
    for _ in 0..30 {
      d.push_block(ms_for_lufs(0.0), false);
    }
    for _ in 0..30 {
      d.push_block(ms_for_lufs(-18.0), true);
    }
    let range = d.lra();
    assert!(
      (range - 10.0).abs() < 0.1,
      "dialogue range should ignore intervening non-dialogue, got {range}"
    );
  }

  #[test]
  fn range_is_unavailable_until_a_complete_observation_exists() {
    let mut d = DialogueIntegrator::new();
    for _ in 0..29 {
      d.push_block(ms_for_lufs(-23.0), true);
    }
    assert_eq!(d.lra(), f64::NEG_INFINITY);
    d.push_block(ms_for_lufs(-23.0), true);
    assert_eq!(d.lra(), 0.0);
  }
}
