//! **FFT-style RTA display** (aligned with `src/scales.js` `buildRtaBands` + legacy `spectrumMath`): matches common pro-spectrum-plugin practice,
//! **not** IEC 61260 metrology-grade per-band filter banks. Product wording: **`docs/architecture.md` §6 Spectrum / RTA**.
//!
//! Summary: rFFT + Hann → bin magnitudes scaled **2/N (interior) / 1/N (DC, Nyquist)** to dB → linear power sum in each `[f_lo, f_hi]` band
//! then `10·log10` → Z/A/C weighting and smoothing. `realfft` does not apply N scaling for you; missing normalization clips the dB top.

use realfft::RealFftPlanner;
use rustfft::num_complex::Complex;

const FFT_LEN: usize = 4096;

fn rta_bands_per_octave(resolution: &str) -> f64 {
  match resolution {
    "1/3" => 3.0,
    "1/12" => 12.0,
    "1/24" => 24.0,
    "1/48" => 48.0,
    _ => 6.0,
  }
}

fn build_rta_bands(min_hz: f64, max_hz: f64, resolution: &str) -> Vec<(f64, f64, f64)> {
  let lo = min_hz.max(1.0);
  let hi = max_hz.max(lo + 1.0);
  let n = rta_bands_per_octave(resolution);
  let half = 2_f64.powf(1.0 / (2.0 * n));
  let step = 2_f64.powf(1.0 / n);
  let mut bands = Vec::new();
  let mut center = lo;
  let mut guard = 0;
  while guard < 512 && center <= hi * 1.001 {
    let f_low = center / half;
    let f_high = center * half;
    if f_high >= lo && f_low <= hi {
      bands.push((f_low.max(lo), f_high.min(hi), center));
    }
    center *= step;
    guard += 1;
  }
  bands
}

fn weighting_a(f_hz: f64) -> f64 {
  let f = f_hz;
  let f2 = f * f;
  let num = 12194.0_f64.powi(2) * f2 * f2;
  let den = (f2 + 20.6_f64.powi(2))
    * ((f2 + 107.7_f64.powi(2)) * (f2 + 737.9_f64.powi(2))).sqrt()
    * (f2 + 12194.0_f64.powi(2));
  2.0 + 20.0 * (num / den.max(1e-20)).log10()
}

fn weighting_c(f_hz: f64) -> f64 {
  let f = f_hz;
  let f2 = f * f;
  let num = 12194.0_f64.powi(2) * f2;
  let den = (f2 + 20.6_f64.powi(2)) * (f2 + 12194.0_f64.powi(2));
  0.06 + 20.0 * (num / den.max(1e-20)).log10()
}

fn weighting_db(freq_hz: f64, mode: &str) -> f64 {
  let f = freq_hz.max(10.0);
  match mode {
    "a" => weighting_a(f),
    "c" => weighting_c(f),
    _ => 0.0,
  }
}

fn smooth_by_kernel(values: &[f64], kernel: &[f64]) -> Vec<f64> {
  if values.len() < 3 || kernel.len() < 3 {
    return values.to_vec();
  }
  let radius = kernel.len() / 2;
  let sum: f64 = kernel.iter().sum::<f64>().max(1e-20);
  let mut out = Vec::with_capacity(values.len());
  for (i, _) in values.iter().enumerate() {
    let mut acc = 0.0;
    for (k, kw) in kernel.iter().enumerate() {
      let idx = (i + k).saturating_sub(radius).min(values.len() - 1);
      acc += values[idx] * kw;
    }
    out.push(acc / sum);
  }
  out
}

pub struct SpectrumEngine {
  r2c: std::sync::Arc<dyn realfft::RealToComplex<f32>>,
  scratch_in: Vec<f32>,
  scratch_spec: Vec<Complex<f32>>,
  window: Vec<f32>,
  ring_l: Vec<f32>,
  ring_r: Vec<f32>,
  ring_write: usize,
  ring_filled: usize,
  smooth_db: Vec<f64>,
  peak_db: Vec<f64>,
  peak_hold_until: Vec<f64>,
  last_time_sec: f64,
  sample_rate: f64,
  bands: Vec<(f64, f64, f64)>,
  weighting: String,
  attack_ms: f64,
  release_ms: f64,
  peak_hold_sec: f64,
  peak_decay_db_per_sec: f64,
  freq_kernel: Vec<f64>,
  tilt_db_per_octave: f64,
  min_hz: f64,
  max_hz: f64,
}

impl SpectrumEngine {
  pub fn new(sample_rate: f64) -> Self {
    let mut planner = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(FFT_LEN);
    let scratch_spec = r2c.make_output_vec();
    let mut window = vec![0.0_f32; FFT_LEN];
    for (n, w) in window.iter_mut().enumerate() {
      *w = (0.5
        * (1.0 - (2.0 * std::f64::consts::PI * n as f64 / (FFT_LEN - 1).max(1) as f64).cos()))
        as f32;
    }
    let min_hz = 20.0;
    let max_hz = 20000.0_f64.min(sample_rate * 0.499);
    let bands = build_rta_bands(min_hz, max_hz, "1/24");
    Self {
      r2c,
      scratch_in: vec![0.0_f32; FFT_LEN],
      scratch_spec,
      window,
      ring_l: vec![0.0_f32; FFT_LEN],
      ring_r: vec![0.0_f32; FFT_LEN],
      ring_write: 0,
      ring_filled: 0,
      smooth_db: Vec::new(),
      peak_db: Vec::new(),
      peak_hold_until: Vec::new(),
      last_time_sec: 0.0,
      sample_rate,
      bands,
      weighting: "z".to_string(),
      attack_ms: 30.0,
      release_ms: 150.0,
      peak_hold_sec: 0.0,
      peak_decay_db_per_sec: 12.0,
      freq_kernel: vec![0.12, 0.76, 0.12],
      tilt_db_per_octave: 0.0,
      min_hz,
      max_hz,
    }
  }

  fn push_sample_pair(&mut self, l: f32, r: f32) {
    let w = self.ring_write % FFT_LEN;
    self.ring_l[w] = l;
    self.ring_r[w] = r;
    self.ring_write = self.ring_write.wrapping_add(1);
    self.ring_filled = (self.ring_filled + 1).min(FFT_LEN);
  }

  /// Returns `(smooth_db, peak_db)` for SVG paths on the frontend, or `None` until the ring is full.
  /// `channels` samples per frame:
  /// - **Mono / stereo (N<=2)**: unchanged; spectrum is based on the stereo-average signal \(0.5·(L+R)\).
  /// - **Multichannel (N>2)**: a single curve represents **summed per-band power/energy across all channels**, then converted to dB.
  pub fn push_interleaved(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    now_sec: f64,
  ) -> Option<(Vec<f64>, Vec<f64>)> {
    let ch = channels.max(1) as usize;
    let frames = interleaved.len() / ch;
    for i in 0..frames {
      let l = interleaved[i * ch];
      let r = if ch >= 2 { interleaved[i * ch + 1] } else { l };
      self.push_sample_pair(l, r);
    }
    if self.ring_filled < FFT_LEN {
      return None;
    }
    let delta_sec = if self.last_time_sec > 0.0 {
      (now_sec - self.last_time_sec).clamp(1.0 / 240.0, 0.25)
    } else {
      1.0 / 60.0
    };
    self.last_time_sec = now_sec;
    let sr = self.sample_rate;
    let n = FFT_LEN as f64;
    let min_f = self.min_hz.max(20.0);
    let _max_f = self.max_hz.max(min_f * 1.2).min(sr * 0.5);
    let log_min_f = min_f.log2();
    for (i, slot) in self.scratch_in.iter_mut().enumerate().take(FFT_LEN) {
      let idx = (self.ring_write.wrapping_sub(FFT_LEN) + i) % FFT_LEN;
      *slot = 0.5 * (self.ring_l[idx] + self.ring_r[idx]) * self.window[i];
    }
    self
      .r2c
      .process(&mut self.scratch_in, &mut self.scratch_spec)
      .expect("fft");
    let bin_count = self.scratch_spec.len();
    let mut mag_db = vec![0.0_f64; bin_count];
    for (k, c) in self.scratch_spec.iter().enumerate() {
      let m = (c.re * c.re + c.im * c.im).sqrt() as f64;
      // Real-signal rFFT: DC / Nyquist bins are real; interior uses 2/N per one-sided energy convention (full-scale sine peak |X|≈N/2).
      let m_norm = if k == 0 || k + 1 == bin_count {
        m / n
      } else {
        m * 2.0 / n
      };
      mag_db[k] = 20.0 * m_norm.max(1e-12).log10();
    }
    let mut weighted_db = Vec::with_capacity(self.bands.len());
    for (_f_lo, _f_hi, f_center) in &self.bands {
      let lo_bin = ((*_f_lo / sr) * n)
        .floor()
        .clamp(0.0, (bin_count - 1) as f64) as usize;
      let hi_bin = ((*_f_hi / sr) * n)
        .ceil()
        .clamp(lo_bin as f64, (bin_count - 1) as f64) as usize;
      let mut power_sum = 0.0_f64;
      for &dbv in mag_db.get(lo_bin..=hi_bin).unwrap_or(&[]) {
        let db = dbv.clamp(-160.0, 20.0);
        power_sum += 10_f64.powf(db / 10.0);
      }
      let mut db = 10.0 * power_sum.max(1e-16).log10();
      db += weighting_db(*f_center, &self.weighting);
      let oct = f_center.max(min_f).log2() - log_min_f;
      db += self.tilt_db_per_octave * oct;
      weighted_db.push(db);
    }
    let freq_smoothed = smooth_by_kernel(&weighted_db, &self.freq_kernel);
    if self.smooth_db.len() != freq_smoothed.len() {
      self.smooth_db = freq_smoothed.clone();
      self.peak_db = freq_smoothed.clone();
      self.peak_hold_until = vec![now_sec; freq_smoothed.len()];
    }
    let atk = 1.0 - (-delta_sec / (self.attack_ms / 1000.0).max(0.001)).exp();
    let rel = 1.0 - (-delta_sec / (self.release_ms / 1000.0).max(0.001)).exp();
    for (i, incoming) in freq_smoothed.iter().enumerate() {
      let incoming = *incoming;
      let prev = self.smooth_db[i];
      let alpha = if incoming > prev { atk } else { rel };
      self.smooth_db[i] = prev + (incoming - prev) * alpha;
      let smoothed = self.smooth_db[i];
      if smoothed >= self.peak_db[i] {
        self.peak_db[i] = smoothed;
        self.peak_hold_until[i] = now_sec + self.peak_hold_sec;
      } else if now_sec > self.peak_hold_until[i] {
        self.peak_db[i] = smoothed.max(self.peak_db[i] - self.peak_decay_db_per_sec * delta_sec);
      }
    }
    Some((self.smooth_db.clone(), self.peak_db.clone()))
  }

  pub fn push_mono_duplex(&mut self, mono: &[f32], now_sec: f64) -> Option<(Vec<f64>, Vec<f64>)> {
    let mut tmp = Vec::with_capacity(mono.len() * 2);
    for &s in mono {
      tmp.push(s);
      tmp.push(s);
    }
    self.push_interleaved(&tmp, 2, now_sec)
  }

  pub fn band_centers(&self) -> Vec<f64> {
    self.bands.iter().map(|(_, _, c)| *c).collect()
  }

  /// Reset FFT ring, band energies, and peak-hold (UI Clear).
  pub fn reset(&mut self) {
    let sr = self.sample_rate;
    *self = SpectrumEngine::new(sr);
  }
}
