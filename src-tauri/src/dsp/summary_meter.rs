use crate::dsp::filters::{KWeightMono, KWeightStereo};

const IBL_CAP: usize = 36_000;
const STH_CAP: usize = 36_000;
const SURROUND_LOUDNESS_WEIGHT: f64 = 1.412_537_544_622_754_4;

fn lufs_from_mean_squares(m0: f64, m1: f64) -> f64 {
  let s = m0 + m1;
  if s <= 0.0 {
    f64::NEG_INFINITY
  } else {
    -0.691 + 10.0 * s.log10()
  }
}

fn gating_blocks_400ms(sub: &[[f64; 2]]) -> Vec<[f64; 2]> {
  if sub.len() < 4 {
    return sub.to_vec();
  }
  let mut out = Vec::with_capacity(sub.len() - 3);
  for j in 3..sub.len() {
    let mut s0 = 0.0;
    let mut s1 = 0.0;
    for b in &sub[j - 3..=j] {
      s0 += b[0];
      s1 += b[1];
    }
    out.push([s0 / 4.0, s1 / 4.0]);
  }
  out
}

fn gated_integrated_lufs(sub_blocks: &[[f64; 2]]) -> f64 {
  let blocks = gating_blocks_400ms(sub_blocks);
  let blocks = blocks.as_slice();
  if blocks.is_empty() {
    return f64::NEG_INFINITY;
  }
  let mut s0 = 0.0;
  let mut s1 = 0.0;
  let mut n = 0_usize;
  for x in blocks {
    if lufs_from_mean_squares(x[0], x[1]) > -70.0 {
      s0 += x[0];
      s1 += x[1];
      n += 1;
    }
  }
  if n == 0 {
    return f64::NEG_INFINITY;
  }
  let ga = -0.691 + 10.0 * ((s0 / n as f64) + (s1 / n as f64)).log10() - 10.0;
  s0 = 0.0;
  s1 = 0.0;
  n = 0;
  for x in blocks {
    let l = lufs_from_mean_squares(x[0], x[1]);
    if l > -70.0 && l > ga {
      s0 += x[0];
      s1 += x[1];
      n += 1;
    }
  }
  if n == 0 {
    f64::NEG_INFINITY
  } else {
    -0.691 + 10.0 * ((s0 / n as f64) + (s1 / n as f64)).log10()
  }
}

fn gated_lra(short_terms: &[f64]) -> f64 {
  let h: Vec<f64> = short_terms
    .iter()
    .copied()
    .filter(|l| l.is_finite() && *l > -70.0)
    .collect();
  if h.len() < 2 {
    return 0.0;
  }
  let mean: f64 = h.iter().map(|l| 10_f64.powf(l / 10.0)).sum::<f64>() / h.len() as f64;
  let gr = 10.0 * mean.log10() - 20.0;
  let mut r: Vec<f64> = h.into_iter().filter(|l| *l > gr).collect();
  if r.len() < 2 {
    return 0.0;
  }
  r.sort_by(|a, b| a.partial_cmp(b).unwrap());
  let p95 = r[(r.len() as f64 * 0.95).floor() as usize].min(r[r.len() - 1]);
  let p10 = r[(r.len() as f64 * 0.1).floor() as usize];
  (p95 - p10).max(0.0)
}

fn init_true_peak_filters() -> (usize, usize, Vec<Vec<f64>>) {
  let p = 4_usize;
  let t = 32_usize;
  let n = p * t;
  let mut h = vec![0.0_f64; n];
  let ctr = (n - 1) as f64 / 2.0;
  for (i, hi) in h.iter_mut().enumerate().take(n) {
    let n0 = i as f64 - ctr;
    let x = n0 / p as f64;
    let sinc = if x.abs() < 1e-12 {
      1.0
    } else {
      (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x)
    };
    let bh = 0.35875 - 0.48829 * (2.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos()
      + 0.14128 * (4.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos()
      - 0.01168 * (6.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos();
    *hi = sinc * bh;
  }
  let mut tp_ph = Vec::with_capacity(p);
  for ph_idx in 0..p {
    let mut ph = vec![0.0_f64; t];
    for (tt, slot) in ph.iter_mut().enumerate().take(t) {
      *slot = h[ph_idx + tt * p];
    }
    let s: f64 = ph.iter().sum();
    if s.abs() > 1e-10 {
      for v in &mut ph {
        *v /= s;
      }
    }
    tp_ph.push(ph);
  }
  (t, p, tp_ph)
}

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
