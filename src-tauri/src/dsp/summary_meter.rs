use crate::dsp::filters::{init_true_peak_filters, KWeightMono, KWeightStereo};
use crate::dsp::gating::{
  gated_integrated_lufs, gated_lra, lufs_from_mean_squares, IBL_CAP, STH_CAP,
  SURROUND_LOUDNESS_WEIGHT,
};

fn db_from_linear(value: f64) -> f64 {
  if value > 0.0 {
    20.0 * value.log10()
  } else {
    f64::NEG_INFINITY
  }
}

#[derive(Debug, Clone)]
pub struct SummaryMetrics {
  pub integrated_lufs: f64,
  pub lra: f64,
  pub m_max_lufs: f64,
  pub st_max_lufs: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_peak_max_l_db: f64,
  pub sample_peak_max_r_db: f64,
}

pub struct SummaryMeter {
  sample_rate: f64,
  channels: u16,
  kf: KWeightStereo,
  kf_mc: Vec<KWeightMono>,
  block_size: usize,
  block_sum: [f64; 2],
  block_frames: usize,
  ring: Vec<f64>,
  ring_head: usize,
  ring_count: usize,
  integrated_blocks: Vec<[f64; 2]>,
  short_terms: Vec<f64>,
  m_max_lufs: f64,
  st_max_lufs: f64,
  true_peak_max: f64,
  sample_peak_max_l: f64,
  sample_peak_max_r: f64,
  tp_t: usize,
  tp_p: usize,
  tp_ph: Vec<Vec<f64>>,
  tp_h: [Vec<f64>; 2],
  tp_wp: [usize; 2],
}

impl SummaryMeter {
  pub fn new(sample_rate: u32, channels: u16) -> Self {
    let sample_rate = sample_rate as f64;
    let (tp_t, tp_p, tp_ph) = init_true_peak_filters();
    Self {
      sample_rate,
      channels,
      kf: KWeightStereo::new(sample_rate),
      kf_mc: Vec::new(),
      block_size: (sample_rate * 0.1).round().max(1.0) as usize,
      block_sum: [0.0, 0.0],
      block_frames: 0,
      ring: vec![0.0_f64; 60 * 2],
      ring_head: 0,
      ring_count: 0,
      integrated_blocks: Vec::with_capacity(1024),
      short_terms: Vec::with_capacity(1024),
      m_max_lufs: f64::NEG_INFINITY,
      st_max_lufs: f64::NEG_INFINITY,
      true_peak_max: 0.0,
      sample_peak_max_l: 0.0,
      sample_peak_max_r: 0.0,
      tp_t,
      tp_p,
      tp_ph,
      tp_h: [vec![0.0_f64; tp_t], vec![0.0_f64; tp_t]],
      tp_wp: [0, 0],
    }
  }

  pub fn push_interleaved(&mut self, interleaved: &[f32]) {
    let channels = self.channels.max(1) as usize;
    let frames = interleaved.len() / channels;
    let weights = self.auto_weights(channels);
    self.ensure_multichannel_filters(weights.map_or(0, |weights| weights.len()));
    for frame in 0..frames {
      let base = frame * channels;
      let (sum_ms, left, right) = if let Some(weights) = weights {
        let mut sum_ms = 0.0_f64;
        for (index, weight) in weights.iter().copied().enumerate() {
          if weight == 0.0 {
            continue;
          }
          let sample = interleaved[base + index] as f64;
          let weighted = self.kf_mc[index].tick(sample);
          sum_ms += weight * weighted * weighted;
        }
        let left = interleaved[base] as f64;
        let right = if channels > 1 {
          interleaved[base + 1] as f64
        } else {
          left
        };
        (sum_ms, left, right)
      } else if channels == 1 {
        let sample = interleaved[base] as f64;
        let (kw_l, kw_r) = self.kf.tick_lr(sample, sample);
        (kw_l * kw_l + kw_r * kw_r, sample, sample)
      } else {
        let left = interleaved[base] as f64;
        let right = interleaved[base + 1] as f64;
        let (kw_l, kw_r) = self.kf.tick_lr(left, right);
        (kw_l * kw_l + kw_r * kw_r, left, right)
      };

      self.block_sum[0] += sum_ms;
      self.update_peaks(left, right);
      self.block_frames += 1;
      if self.block_frames >= self.block_size {
        self.close_block();
      }
    }
  }

  pub fn finish(&self) -> SummaryMetrics {
    SummaryMetrics {
      integrated_lufs: gated_integrated_lufs(&self.integrated_blocks),
      lra: gated_lra(&self.short_terms),
      m_max_lufs: self.m_max_lufs,
      st_max_lufs: self.st_max_lufs,
      true_peak_max_dbtp: db_from_linear(self.true_peak_max),
      sample_peak_max_l_db: db_from_linear(self.sample_peak_max_l),
      sample_peak_max_r_db: db_from_linear(self.sample_peak_max_r),
    }
  }

  fn auto_weights(&self, channels: usize) -> Option<&'static [f64]> {
    match channels {
      5 => Some(&[
        1.0,
        1.0,
        1.0,
        SURROUND_LOUDNESS_WEIGHT,
        SURROUND_LOUDNESS_WEIGHT,
      ]),
      6 => Some(&[
        1.0,
        1.0,
        1.0,
        0.0,
        SURROUND_LOUDNESS_WEIGHT,
        SURROUND_LOUDNESS_WEIGHT,
      ]),
      7 => Some(&[
        1.0,
        1.0,
        1.0,
        SURROUND_LOUDNESS_WEIGHT,
        SURROUND_LOUDNESS_WEIGHT,
        SURROUND_LOUDNESS_WEIGHT,
        SURROUND_LOUDNESS_WEIGHT,
      ]),
      8 => Some(&[
        1.0,
        1.0,
        1.0,
        0.0,
        SURROUND_LOUDNESS_WEIGHT,
        SURROUND_LOUDNESS_WEIGHT,
        SURROUND_LOUDNESS_WEIGHT,
        SURROUND_LOUDNESS_WEIGHT,
      ]),
      _ => None,
    }
  }

  fn ensure_multichannel_filters(&mut self, len: usize) {
    if len > 0 && self.kf_mc.len() != len {
      self.kf_mc = (0..len)
        .map(|_| KWeightMono::new(self.sample_rate))
        .collect();
    }
  }

  fn update_peaks(&mut self, left: f64, right: f64) {
    self.sample_peak_max_l = self.sample_peak_max_l.max(left.abs());
    self.sample_peak_max_r = self.sample_peak_max_r.max(right.abs());
    let tp_l = self.tp_sample(left, 0);
    let tp_r = self.tp_sample(right, 1);
    self.true_peak_max = self.true_peak_max.max(tp_l).max(tp_r);
  }

  fn tp_sample(&mut self, sample: f64, channel: usize) -> f64 {
    let write_pos = self.tp_wp[channel];
    self.tp_h[channel][write_pos] = sample;
    self.tp_wp[channel] = (write_pos + 1) % self.tp_t;
    let mut max = sample.abs();
    for phase in 1..self.tp_p {
      let mut y = 0.0;
      for (tap, coeff) in self.tp_ph[phase].iter().enumerate().take(self.tp_t) {
        let index = (write_pos + self.tp_t - tap) % self.tp_t;
        y += coeff * self.tp_h[channel][index];
      }
      max = max.max(y.abs());
    }
    max
  }

  fn close_block(&mut self) {
    let mean = [
      self.block_sum[0] / self.block_frames as f64,
      self.block_sum[1] / self.block_frames as f64,
    ];
    let ring_index = self.ring_head * 2;
    self.ring[ring_index] = mean[0];
    self.ring[ring_index + 1] = mean[1];
    self.ring_head = (self.ring_head + 1) % 60;
    self.ring_count = (self.ring_count + 1).min(60);
    self.integrated_blocks.push(mean);
    if self.integrated_blocks.len() > IBL_CAP {
      self.integrated_blocks.remove(0);
    }

    let momentary = self.window_lufs(4);
    let short_term = self.window_lufs(30);
    if momentary.is_finite() {
      self.m_max_lufs = self.m_max_lufs.max(momentary);
    }
    if short_term.is_finite() {
      self.st_max_lufs = self.st_max_lufs.max(short_term);
      self.short_terms.push(short_term);
      if self.short_terms.len() > STH_CAP {
        self.short_terms.remove(0);
      }
    }

    self.block_sum = [0.0, 0.0];
    self.block_frames = 0;
  }

  fn window_lufs(&self, blocks: usize) -> f64 {
    let mut sum = [0.0_f64, 0.0_f64];
    let mut count = 0_usize;
    for offset in 0..blocks.min(self.ring_count) {
      let index = ((self.ring_head + 60 - 1 - offset) % 60) * 2;
      sum[0] += self.ring[index];
      sum[1] += self.ring[index + 1];
      count += 1;
    }
    if count == 0 {
      f64::NEG_INFINITY
    } else {
      lufs_from_mean_squares(sum[0] / count as f64, sum[1] / count as f64)
    }
  }
}
