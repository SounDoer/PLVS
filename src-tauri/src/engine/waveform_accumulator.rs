//! Stateful waveform windows shared by live capture and offline file analysis.

/// PCM samples per waveform sub-block. ~19 sub-blocks per ~100 ms tick at 48 kHz.
const SUBBLOCK_SAMPLES: usize = 256;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct HistoryWaveform {
  pub min: Vec<f32>,
  pub max: Vec<f32>,
  pub sub_pairs: Vec<f32>,
  pub sub_count: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct VisualWaveform {
  pub min: Vec<f32>,
  pub max: Vec<f32>,
}

/// Accumulates the two waveform windows consumed by Meter history and Visual history.
///
/// The windows deliberately reset independently: loudness production controls the Meter-history
/// window, while the visual-history cadence controls the visual window.
pub(super) struct WaveformAccumulator {
  channels: usize,
  history_min: Vec<f32>,
  history_max: Vec<f32>,
  history_sub_pairs: Vec<f32>,
  history_sub_index: usize,
  history_sub_current: Vec<f32>,
  visual_min: Vec<f32>,
  visual_max: Vec<f32>,
}

impl WaveformAccumulator {
  pub(super) fn new(channels: u16) -> Self {
    let channels = channels.max(1) as usize;
    let mut history_sub_current = vec![0.0; channels * 2];
    reset_pairs(&mut history_sub_current);
    Self {
      channels,
      history_min: vec![f32::INFINITY; channels],
      history_max: vec![f32::NEG_INFINITY; channels],
      history_sub_pairs: Vec::new(),
      history_sub_index: 0,
      history_sub_current,
      visual_min: vec![f32::INFINITY; channels],
      visual_max: vec![f32::NEG_INFINITY; channels],
    }
  }

  pub(super) fn push_interleaved(&mut self, interleaved: &[f32]) {
    for frame in interleaved.chunks_exact(self.channels) {
      for (channel, &sample) in frame.iter().enumerate() {
        self.history_min[channel] = self.history_min[channel].min(sample);
        self.history_max[channel] = self.history_max[channel].max(sample);
        self.visual_min[channel] = self.visual_min[channel].min(sample);
        self.visual_max[channel] = self.visual_max[channel].max(sample);

        let pair_index = channel * 2;
        self.history_sub_current[pair_index] = self.history_sub_current[pair_index].min(sample);
        self.history_sub_current[pair_index + 1] =
          self.history_sub_current[pair_index + 1].max(sample);
      }

      self.history_sub_index += 1;
      if self.history_sub_index == SUBBLOCK_SAMPLES {
        self
          .history_sub_pairs
          .extend_from_slice(&self.history_sub_current);
        reset_pairs(&mut self.history_sub_current);
        self.history_sub_index = 0;
      }
    }
  }

  pub(super) fn take_history(&mut self) -> HistoryWaveform {
    if self.history_sub_index > 0 {
      self
        .history_sub_pairs
        .extend_from_slice(&self.history_sub_current);
      reset_pairs(&mut self.history_sub_current);
      self.history_sub_index = 0;
    }

    let min = take_extrema(&mut self.history_min, f32::INFINITY);
    let max = take_extrema(&mut self.history_max, f32::NEG_INFINITY);
    let stride = self.channels * 2;
    let sub_count = self
      .history_sub_pairs
      .len()
      .checked_div(stride)
      .unwrap_or(0) as u32;
    let mut sub_pairs = std::mem::take(&mut self.history_sub_pairs);
    sanitize(&mut sub_pairs);

    HistoryWaveform {
      min,
      max,
      sub_pairs,
      sub_count,
    }
  }

  pub(super) fn take_visual(&mut self) -> VisualWaveform {
    VisualWaveform {
      min: take_extrema(&mut self.visual_min, f32::INFINITY),
      max: take_extrema(&mut self.visual_max, f32::NEG_INFINITY),
    }
  }

  pub(super) fn reset(&mut self) {
    self.history_min.fill(f32::INFINITY);
    self.history_max.fill(f32::NEG_INFINITY);
    self.history_sub_pairs.clear();
    self.history_sub_index = 0;
    reset_pairs(&mut self.history_sub_current);
    self.visual_min.fill(f32::INFINITY);
    self.visual_max.fill(f32::NEG_INFINITY);
  }
}

fn reset_pairs(pairs: &mut [f32]) {
  for pair in pairs.chunks_exact_mut(2) {
    pair[0] = f32::INFINITY;
    pair[1] = f32::NEG_INFINITY;
  }
}

fn take_extrema(values: &mut [f32], sentinel: f32) -> Vec<f32> {
  let result = values
    .iter()
    .map(|&value| if value.is_finite() { value } else { 0.0 })
    .collect();
  values.fill(sentinel);
  result
}

fn sanitize(values: &mut [f32]) {
  for value in values {
    if !value.is_finite() {
      *value = 0.0;
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn captures_channel_extrema_without_the_meter_pipeline() {
    let mut accumulator = WaveformAccumulator::new(2);
    accumulator.push_interleaved(&[-0.2, 0.7, 0.5, -0.4, 0.1, 0.3]);

    let history = accumulator.take_history();
    assert_eq!(history.min, vec![-0.2, -0.4]);
    assert_eq!(history.max, vec![0.5, 0.7]);
    assert_eq!(history.sub_count, 1);
    assert_eq!(history.sub_pairs, vec![-0.2, 0.5, -0.4, 0.7]);
  }

  #[test]
  fn sub_block_boundary_survives_multiple_pushes() {
    let mut accumulator = WaveformAccumulator::new(1);
    accumulator.push_interleaved(&vec![0.25; SUBBLOCK_SAMPLES - 1]);
    accumulator.push_interleaved(&[-0.5, 0.75]);

    let history = accumulator.take_history();
    assert_eq!(history.sub_count, 2);
    assert_eq!(history.sub_pairs, vec![-0.5, 0.25, 0.75, 0.75]);
  }

  #[test]
  fn history_and_visual_windows_reset_independently() {
    let mut accumulator = WaveformAccumulator::new(1);
    accumulator.push_interleaved(&[-0.5, 0.25]);
    assert_eq!(accumulator.take_history().min, vec![-0.5]);

    accumulator.push_interleaved(&[0.75]);
    assert_eq!(accumulator.take_history().min, vec![0.75]);
    assert_eq!(
      accumulator.take_visual(),
      VisualWaveform {
        min: vec![-0.5],
        max: vec![0.75]
      }
    );
    assert_eq!(accumulator.take_visual().min, vec![0.0]);
  }
}
