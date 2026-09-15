use crate::dsp::channel_weights::{standard_layout_name, standard_loudness_weights};
use crate::dsp::filters::{init_true_peak_filters, KWeightMono, KWeightStereo};
use crate::dsp::gating::{
  gated_integrated_lufs, gated_lra, lufs_from_mean_squares, IBL_CAP, STH_CAP,
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
  /// `standard_layout_name` for the channel count, or `"unknown"` (Ch1/Ch2 stereo loudness).
  pub loudness_layout: &'static str,
  pub loudness_layout_known: bool,
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
  tp_h: Vec<Vec<f64>>,
  tp_wp: Vec<usize>,
  /// BS.1770-5 weights for a standard layout; Ch1/Ch2 only for an unrecognized count above two;
  /// `None` for mono and stereo, which keep their dedicated paths.
  loudness_weights: Option<Vec<f64>>,
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
      tp_h: vec![vec![0.0_f64; tp_t]; channels.max(1) as usize],
      tp_wp: vec![0; channels.max(1) as usize],
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
    }
  }

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

  pub fn finish(&self) -> SummaryMetrics {
    SummaryMetrics {
      integrated_lufs: gated_integrated_lufs(&self.integrated_blocks),
      lra: gated_lra(&self.short_terms),
      m_max_lufs: self.m_max_lufs,
      st_max_lufs: self.st_max_lufs,
      true_peak_max_dbtp: db_from_linear(self.true_peak_max),
      sample_peak_max_l_db: db_from_linear(self.sample_peak_max_l),
      sample_peak_max_r_db: db_from_linear(self.sample_peak_max_r),
      loudness_layout: standard_layout_name(self.channels.max(1)).unwrap_or("unknown"),
      loudness_layout_known: standard_layout_name(self.channels.max(1)).is_some(),
    }
  }

  fn ensure_multichannel_filters(&mut self, len: usize) {
    if len > 0 && self.kf_mc.len() != len {
      self.kf_mc = (0..len)
        .map(|_| KWeightMono::new(self.sample_rate))
        .collect();
    }
  }

  /// Sample peaks stay Ch1/Ch2; True Peak Max covers every channel.
  fn update_peaks(&mut self, frame: &[f32]) {
    let left = frame[0] as f64;
    let right = if frame.len() > 1 {
      frame[1] as f64
    } else {
      left
    };
    self.sample_peak_max_l = self.sample_peak_max_l.max(left.abs());
    self.sample_peak_max_r = self.sample_peak_max_r.max(right.abs());
    for (channel, sample) in frame.iter().enumerate() {
      let tp = self.tp_sample(*sample as f64, channel);
      self.true_peak_max = self.true_peak_max.max(tp);
    }
  }

  fn tp_sample(&mut self, sample: f64, channel: usize) -> f64 {
    let write_pos = self.tp_wp[channel];
    self.tp_h[channel][write_pos] = sample;
    self.tp_wp[channel] = if write_pos + 1 == self.tp_t {
      0
    } else {
      write_pos + 1
    };
    let mut max = sample.abs();
    for phase in 1..self.tp_p {
      let mut y = 0.0;
      for (tap, coeff) in self.tp_ph[phase].iter().enumerate().take(self.tp_t) {
        // A branch, not `%`: the runtime-divisor modulo dominated this loop at 8–16 channels.
        let index = if tap <= write_pos {
          write_pos - tap
        } else {
          write_pos + self.tp_t - tap
        };
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
    assert_eq!(
      (eight.loudness_layout, eight.loudness_layout_known),
      ("7.1", true)
    );
    let ten = run(10, &vec![0.0; 4_800 * 10]);
    assert_eq!(
      (ten.loudness_layout, ten.loudness_layout_known),
      ("unknown", false)
    );
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
