use realfft::RealFftPlanner;
use rustfft::num_complex::Complex;

pub const FFT_BIG: usize = 16384;
pub const FFT_MID: usize = 4096;
pub const FFT_SMALL: usize = 1024;
pub const XOVER_LO_HZ: f64 = 200.0;
pub const XOVER_HI_HZ: f64 = 2000.0;
pub const XFADE_HALF_OCT: f64 = 1.0 / 6.0; // crossfade half-width, octaves
pub const GRID_POINTS_PER_OCT: f64 = 96.0;
pub const ANALYSIS_AVERAGE_SEC: f64 = 0.150;
pub const OVERLAP_BIG: usize = 8; // smoother low-band updates without changing bass resolution
pub const OVERLAP_MID: usize = 4; // 75% overlap → hop = size / overlap
pub const OVERLAP_SMALL: usize = 2; // calmer high-band updates while keeping the 1024-point window
/// Display calibration: added to PSD-dB so a 0 dBFS sine peak reads ~0 dB.
/// Empirically tuned; pinned by `calibration_full_scale_sine_near_zero`.
pub const CAL_OFFSET_DB: f64 = 16.5;

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
/// averaged by real time so different FFT sizes share comparable display ballistics.
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
  smoothed_psd: Vec<f64>,
  average_initialized: bool,
  analysis_average_sec: f64,
  sample_rate: f64,
}

impl StftAnalyzer {
  pub fn new(size: usize, sample_rate: f64) -> Self {
    let overlap = match size {
      FFT_BIG => OVERLAP_BIG,
      FFT_SMALL => OVERLAP_SMALL,
      _ => OVERLAP_MID,
    };
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
      hop: size / overlap,
      r2c,
      scratch_in: vec![0.0_f32; size],
      scratch_spec,
      window,
      ring: vec![0.0_f32; size],
      write: 0,
      filled: 0,
      ingested: 0,
      smoothed_psd: Vec::new(),
      average_initialized: false,
      analysis_average_sec: ANALYSIS_AVERAGE_SEC,
      sample_rate,
    }
  }

  pub fn bin_width_hz(&self) -> f64 {
    self.sample_rate / self.size as f64
  }

  pub fn ready(&self) -> bool {
    self.filled >= self.size && self.average_initialized
  }

  pub fn set_analysis_average_sec(&mut self, seconds: f64) {
    self.analysis_average_sec = if seconds.is_finite() {
      seconds.max(0.0)
    } else {
      ANALYSIS_AVERAGE_SEC
    };
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
    self
      .r2c
      .process(&mut self.scratch_in, &mut self.scratch_spec)
      .expect("fft");
    let bin_count = self.scratch_spec.len();
    let bw = self.bin_width_hz();
    if self.smoothed_psd.len() != bin_count {
      self.smoothed_psd = vec![0.0_f64; bin_count];
      self.average_initialized = false;
    }
    let hop_sec = self.hop as f64 / self.sample_rate;
    let alpha = if self.analysis_average_sec <= 0.0 {
      1.0
    } else {
      1.0 - (-hop_sec / self.analysis_average_sec).exp()
    };
    for (k, c) in self.scratch_spec.iter().enumerate() {
      let m = (c.re * c.re + c.im * c.im).sqrt() as f64;
      let m_norm = if k == 0 || k + 1 == bin_count {
        m / n
      } else {
        m * 2.0 / n
      };
      let power = m_norm.max(1e-12).powi(2);
      let psd = power / bw; // power per Hz
      if self.average_initialized {
        self.smoothed_psd[k] += (psd - self.smoothed_psd[k]) * alpha;
      } else {
        self.smoothed_psd[k] = psd;
      }
    }
    self.average_initialized = true;
  }

  /// Time-averaged PSD at an arbitrary frequency via linear interpolation between bins.
  pub fn psd_at(&self, hz: f64) -> f64 {
    if !self.average_initialized {
      return 1e-20;
    }
    let bin_count = self.smoothed_psd.len();
    let pos = hz / self.bin_width_hz();
    let k0 = pos.floor().clamp(0.0, (bin_count - 1) as f64) as usize;
    let k1 = (k0 + 1).min(bin_count - 1);
    let frac = (pos - k0 as f64).clamp(0.0, 1.0);
    let a = self.smoothed_psd[k0];
    let b = self.smoothed_psd[k1];
    (a * (1.0 - frac) + b * frac).max(1e-20)
  }
}

pub struct MultiResBank {
  big: StftAnalyzer,
  mid: StftAnalyzer,
  small: StftAnalyzer,
  grid: LogGrid,
}

impl MultiResBank {
  pub fn new(sample_rate: f64, min_hz: f64, max_hz: f64) -> Self {
    Self {
      big: StftAnalyzer::new(FFT_BIG, sample_rate),
      mid: StftAnalyzer::new(FFT_MID, sample_rate),
      small: StftAnalyzer::new(FFT_SMALL, sample_rate),
      grid: LogGrid::new(min_hz, max_hz),
    }
  }

  pub fn analysis_average_sec_for_smoothing_percent(percent: f64) -> f64 {
    let p = percent.clamp(0.0, 100.0);
    if p <= 0.0 {
      0.0
    } else {
      ANALYSIS_AVERAGE_SEC * (p / 100.0)
    }
  }

  pub fn grid_freqs(&self) -> &[f64] {
    &self.grid.freqs
  }

  pub fn set_analysis_average_sec(&mut self, seconds: f64) {
    self.big.set_analysis_average_sec(seconds);
    self.mid.set_analysis_average_sec(seconds);
    self.small.set_analysis_average_sec(seconds);
  }

  pub fn ready(&self) -> bool {
    // Largest FFT gates readiness; it fills last.
    self.big.ready()
  }

  pub fn push_sample(&mut self, s: f32) {
    self.big.push_sample(s);
    self.mid.push_sample(s);
    self.small.push_sample(s);
  }

  /// Blend weight in [0,1] for the *upper* analyzer of a crossover at `xover_hz`.
  /// 0 below the fade band (use lower analyzer), 1 above it (use upper analyzer).
  fn blend(hz: f64, xover_hz: f64) -> f64 {
    let lo = xover_hz * 2_f64.powf(-XFADE_HALF_OCT);
    let hi = xover_hz * 2_f64.powf(XFADE_HALF_OCT);
    if hz <= lo {
      0.0
    } else if hz >= hi {
      1.0
    } else {
      (hz.log2() - lo.log2()) / (hi.log2() - lo.log2())
    }
  }

  /// PSD-dB per grid point, combining the three analyzers. `cal_offset_db` is added here.
  pub fn psd_db_row(&self, cal_offset_db: f64) -> Vec<f64> {
    self
      .grid
      .freqs
      .iter()
      .map(|&f| {
        // Low/mid blend then mid/high blend, all in linear PSD.
        let b_lo = Self::blend(f, XOVER_LO_HZ); // 0=big, 1=mid
        let lowmid = self.big.psd_at(f) * (1.0 - b_lo) + self.mid.psd_at(f) * b_lo;
        let b_hi = Self::blend(f, XOVER_HI_HZ); // 0=lowmid(mid), 1=small
        let psd = lowmid * (1.0 - b_hi) + self.small.psd_at(f) * b_hi;
        10.0 * psd.max(1e-20).log10() + cal_offset_db
      })
      .collect()
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

  fn feed_silence(an: &mut StftAnalyzer, samples: usize) {
    for _ in 0..samples {
      an.push_sample(0.0);
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
    assert!(
      on > off * 100.0,
      "tone PSD {on} should dominate off-tone {off}"
    );
  }

  #[test]
  fn high_band_analysis_average_decays_by_time_not_frame_count() {
    let sr = 48000.0;
    let hz = 8000.0;
    let mut an = StftAnalyzer::new(FFT_SMALL, sr);
    feed_tone(&mut an, sr, hz, FFT_SMALL * 16);
    assert!(an.ready());
    let steady = an.psd_at(hz);

    feed_silence(&mut an, (sr * 0.100) as usize);
    let after_100ms = an.psd_at(hz);
    let ratio = after_100ms / steady.max(1e-20);

    assert!(
      ratio > 0.15,
      "high-band averaging should decay over real time, not drop after four short frames: ratio={ratio}"
    );
  }

  #[test]
  fn fft_overlaps_balance_low_band_smoothness_and_high_band_stability() {
    let sr = 48000.0;
    let big = StftAnalyzer::new(FFT_BIG, sr);
    let mid = StftAnalyzer::new(FFT_MID, sr);
    let small = StftAnalyzer::new(FFT_SMALL, sr);

    assert_eq!(big.hop, FFT_BIG / 8);
    assert_eq!(mid.hop, FFT_MID / 4);
    assert_eq!(small.hop, FFT_SMALL / 2);
  }

  #[test]
  fn analysis_average_scales_across_full_smoothing_range() {
    assert_eq!(
      MultiResBank::analysis_average_sec_for_smoothing_percent(0.0),
      0.0
    );
    assert!((MultiResBank::analysis_average_sec_for_smoothing_percent(50.0) - 0.075).abs() < 1e-9);
    assert!(
      (MultiResBank::analysis_average_sec_for_smoothing_percent(100.0) - ANALYSIS_AVERAGE_SEC)
        .abs()
        < 1e-9
    );
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

  fn feed_bank_tone(bank: &mut MultiResBank, sr: f64, hz: f64, samples: usize) {
    for i in 0..samples {
      bank.push_sample((2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32);
    }
  }

  #[test]
  fn bank_resolves_close_low_tones() {
    let sr = 48000.0;
    let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
    // 60 Hz + 70 Hz simultaneously — a 4096 FFT (11.7 Hz bins) blurs these together.
    for i in 0..FFT_BIG * 4 {
      let t = i as f64 / sr;
      let s = ((2.0 * std::f64::consts::PI * 60.0 * t).sin()
        + (2.0 * std::f64::consts::PI * 70.0 * t).sin()) as f32;
      bank.push_sample(s);
    }
    assert!(bank.ready());
    let row = bank.psd_db_row(0.0);
    let freqs = bank.grid_freqs();
    let val_at = |target: f64| {
      let (idx, _) = freqs
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
          (**a - target)
            .abs()
            .partial_cmp(&(**b - target).abs())
            .unwrap()
        })
        .unwrap();
      row[idx]
    };
    // Both tones present; the 65 Hz midpoint is a dip between two resolved peaks.
    assert!(val_at(60.0) > val_at(65.0) + 3.0, "60 Hz peak not resolved");
    assert!(val_at(70.0) > val_at(65.0) + 3.0, "70 Hz peak not resolved");
  }

  #[test]
  fn calibration_full_scale_sine_near_zero() {
    let sr = 48000.0;
    let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
    feed_bank_tone(&mut bank, sr, 1000.0, FFT_BIG * 6); // amplitude 1.0 = 0 dBFS
    assert!(bank.ready());
    let row = bank.psd_db_row(CAL_OFFSET_DB);
    let peak = row.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    // Tone peak varies a few dB with bin alignment (1 kHz is not bin-centered); a loose
    // tolerance is fine for a display-referenced analyzer.
    assert!(
      (peak - 0.0).abs() < 2.5,
      "0 dBFS sine peak should read ~0 dB, got {peak} (adjust CAL_OFFSET_DB)"
    );
  }

  #[test]
  fn bank_broadband_continuous_across_crossovers() {
    let sr = 48000.0;
    let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
    // Deterministic pseudo-white noise.
    let mut x: u32 = 0x12345678;
    for _ in 0..FFT_BIG * 8 {
      x = x.wrapping_mul(1664525).wrapping_add(1013904223);
      let s = ((x >> 8) as f32 / 8_388_608.0) - 1.0;
      bank.push_sample(s);
    }
    assert!(bank.ready());
    let row = bank.psd_db_row(0.0);
    let freqs = bank.grid_freqs();
    let near = |t: f64| {
      freqs
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| (**a - t).abs().partial_cmp(&(**b - t).abs()).unwrap())
        .map(|(i, _)| row[i])
        .unwrap()
    };
    // White-noise PSD is ~flat; no large step across either crossover.
    // Tolerance accounts for window/edge variance in pseudo-noise; tighten later if desired.
    assert!((near(180.0) - near(220.0)).abs() < 4.0, "seam at 200 Hz");
    assert!((near(1800.0) - near(2200.0)).abs() < 4.0, "seam at 2 kHz");
  }
}
