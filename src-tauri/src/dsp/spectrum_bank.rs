use realfft::RealFftPlanner;
use rustfft::num_complex::Complex;
use std::collections::VecDeque;

pub const FFT_BIG: usize = 16384;
pub const FFT_MID: usize = 4096;
pub const FFT_SMALL: usize = 1024;
pub const XOVER_LO_HZ: f64 = 200.0;
pub const XOVER_HI_HZ: f64 = 2000.0;
pub const XFADE_HALF_OCT: f64 = 1.0 / 6.0; // crossfade half-width, octaves
pub const GRID_POINTS_PER_OCT: f64 = 96.0;
pub const POWER_AVG_FRAMES: usize = 4;
pub const OVERLAP: usize = 4; // 75% overlap → hop = size / OVERLAP

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

#[cfg(test)]
mod tests {
  use super::*;

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
