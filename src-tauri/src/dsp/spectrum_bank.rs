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
/// Display calibration added to PSD-dB; it only decides where zero sits on the axis.
/// Empirically tuned against a 0 dBFS sine **in the mid band** — 1 kHz falls between the two
/// crossovers, so it reads ~0 dB there and only there. Rows are PSD (power/Hz), so a tone's level
/// tracks bin width: the same sine reads ~+6 dB on `FFT_BIG` and ~-6 dB on `FFT_SMALL`. Noise is
/// continuous across bands instead, which is the convention this display is built on — see the
/// module docs of `dsp::spectrum`. Pinned by `calibration_mid_band_full_scale_sine_near_zero`.
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
    if self.filled >= self.size && self.ingested.is_multiple_of(self.hop as u64) {
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

  /// Where one frequency reads from: the bins to interpolate and the fraction between them.
  /// Fixed by size and sample rate, so it is resolved once and replayed every frame.
  pub fn bin_tap(&self, hz: f64) -> BinTap {
    let bin_count = self.size / 2 + 1; // matches `r2c.make_output_vec()`
    let pos = hz / self.bin_width_hz();
    let k0 = pos.floor().clamp(0.0, (bin_count - 1) as f64) as usize;
    let k1 = (k0 + 1).min(bin_count - 1);
    let frac = (pos - k0 as f64).clamp(0.0, 1.0);
    BinTap { k0, k1, frac }
  }

  /// Time-averaged PSD at a resolved tap.
  pub fn psd_at_tap(&self, tap: BinTap) -> f64 {
    if !self.average_initialized {
      return 1e-20;
    }
    let a = self.smoothed_psd[tap.k0];
    let b = self.smoothed_psd[tap.k1];
    (a * (1.0 - tap.frac) + b * tap.frac).max(1e-20)
  }

  /// Time-averaged PSD at an arbitrary frequency, resolving the tap on each call. Convenience
  /// for tests; the render path holds a precomputed tap table instead.
  #[cfg(test)]
  pub fn psd_at(&self, hz: f64) -> f64 {
    self.psd_at_tap(self.bin_tap(hz))
  }
}

/// Resolved read position for one frequency on one analyzer.
#[derive(Clone, Copy)]
pub struct BinTap {
  k0: usize,
  k1: usize,
  frac: f64,
}

/// Fractional-octave smoothing width for the render grid. This is the frequency axis; the
/// time axis is Speed (see `SpectrumMeter::set_display_controls`).
///
/// "Smoothing" here is averaging, not banding/summation — the level convention is untouched,
/// peaks are only pulled down and spread out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OctaveSmoothing {
  /// Raw grid; every resolved partial stays sharp.
  #[default]
  Off,
  OneTwelfth,
  OneSixth,
  OneThird,
}

impl OctaveSmoothing {
  /// Compact token for the analysis request key. Free of ':' and '/' so it cannot break the
  /// colon-delimited grammar; mirrored in `spectrumRequestKeyFromControls`.
  pub fn key_token(self) -> &'static str {
    match self {
      Self::Off => "off",
      Self::OneTwelfth => "12",
      Self::OneSixth => "6",
      Self::OneThird => "3",
    }
  }

  /// Half-window in grid points, or None for `Off`.
  ///
  /// The grid is uniform in log frequency, so a fractional-octave window is a *constant* number
  /// of points everywhere — 1/N octave spans `GRID_POINTS_PER_OCT / N`, half of that each side.
  /// No per-point width search, and the same window at 30 Hz as at 15 kHz.
  fn half_width_points(self) -> Option<usize> {
    let denom = match self {
      Self::Off => return None,
      Self::OneTwelfth => 12.0,
      Self::OneSixth => 6.0,
      Self::OneThird => 3.0,
    };
    Some((GRID_POINTS_PER_OCT / (2.0 * denom)).round() as usize)
  }
}

/// Box-average `src` over ±`half` points, truncating at the ends.
///
/// Summed directly rather than via prefix sums on purpose: PSD values span the full display
/// range, so a running total sits near the loudest bin seen so far and adding a 1e-18 neighbour
/// to it loses that neighbour entirely. Differencing two such totals then returns noise for
/// quiet windows. At ~1k points and a ≤33-wide window the direct loop is not worth optimising
/// into that bug.
fn box_average(src: &[f64], half: usize) -> Vec<f64> {
  let n = src.len();
  (0..n)
    .map(|i| {
      let lo = i.saturating_sub(half);
      let hi = (i + half + 1).min(n);
      let sum: f64 = src[lo..hi].iter().sum();
      sum / (hi - lo) as f64
    })
    .collect()
}

/// One grid point's read plan: where each analyzer is sampled and the two crossover weights.
/// Every field is fixed by the grid, the FFT sizes and the crossovers, so the whole table is
/// built once in `MultiResBank::new` rather than re-derived for ~1k points on every frame.
struct GridTap {
  big: BinTap,
  mid: BinTap,
  small: BinTap,
  b_lo: f64,
  b_hi: f64,
}

pub struct MultiResBank {
  big: StftAnalyzer,
  mid: StftAnalyzer,
  small: StftAnalyzer,
  grid: LogGrid,
  taps: Vec<GridTap>,
}

impl MultiResBank {
  pub fn new(sample_rate: f64, min_hz: f64, max_hz: f64) -> Self {
    let big = StftAnalyzer::new(FFT_BIG, sample_rate);
    let mid = StftAnalyzer::new(FFT_MID, sample_rate);
    let small = StftAnalyzer::new(FFT_SMALL, sample_rate);
    let grid = LogGrid::new(min_hz, max_hz);
    let taps = grid
      .freqs
      .iter()
      .map(|&f| GridTap {
        big: big.bin_tap(f),
        mid: mid.bin_tap(f),
        small: small.bin_tap(f),
        b_lo: Self::blend(f, XOVER_LO_HZ), // 0=big, 1=mid
        b_hi: Self::blend(f, XOVER_HI_HZ), // 0=lowmid(mid), 1=small
      })
      .collect();
    Self {
      big,
      mid,
      small,
      grid,
      taps,
    }
  }

  pub fn analysis_average_sec_for_speed_percent(percent: f64) -> f64 {
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

  /// Linear PSD per grid point, combining the three analyzers.
  /// Reads the precomputed tap table; the arithmetic below is deliberately in the same order as
  /// the naive form so the row stays bit-identical (floating point is not associative).
  fn psd_linear_row(&self) -> Vec<f64> {
    self
      .taps
      .iter()
      .map(|t| {
        // Low/mid blend then mid/high blend, all in linear PSD.
        let lowmid =
          self.big.psd_at_tap(t.big) * (1.0 - t.b_lo) + self.mid.psd_at_tap(t.mid) * t.b_lo;
        lowmid * (1.0 - t.b_hi) + self.small.psd_at_tap(t.small) * t.b_hi
      })
      .collect()
  }

  /// PSD-dB per grid point. `cal_offset_db` is added here.
  ///
  /// Smoothing runs on linear power, before the log: averaging dB instead would be a geometric
  /// mean, which drags a lone loud partial's neighbours down far harder than the energy in the
  /// band justifies. Power-averaging keeps the band's energy honest, which is the whole point of
  /// a noise-referenced display (see `CAL_OFFSET_DB`).
  pub fn psd_db_row(&self, cal_offset_db: f64, smoothing: OctaveSmoothing) -> Vec<f64> {
    let lin = self.psd_linear_row();
    let lin = match smoothing.half_width_points() {
      // `Off` must stay bit-identical to the unsmoothed row, so it does not touch `lin` at all.
      None => lin,
      Some(half) => box_average(&lin, half),
    };
    lin
      .iter()
      .map(|psd| 10.0 * psd.max(1e-20).log10() + cal_offset_db)
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
  fn analysis_average_scales_across_full_speed_range() {
    assert_eq!(
      MultiResBank::analysis_average_sec_for_speed_percent(0.0),
      0.0
    );
    assert!((MultiResBank::analysis_average_sec_for_speed_percent(50.0) - 0.075).abs() < 1e-9);
    assert!(
      (MultiResBank::analysis_average_sec_for_speed_percent(100.0) - ANALYSIS_AVERAGE_SEC).abs()
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
    let row = bank.psd_db_row(0.0, OctaveSmoothing::Off);
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
  fn octave_smoothing_half_widths_are_constant_grid_points() {
    // 1/N octave spans GRID_POINTS_PER_OCT / N points, half each side. The grid is uniform in
    // log frequency, so these hold at every frequency.
    assert_eq!(OctaveSmoothing::Off.half_width_points(), None);
    assert_eq!(OctaveSmoothing::OneThird.half_width_points(), Some(16));
    assert_eq!(OctaveSmoothing::OneSixth.half_width_points(), Some(8));
    assert_eq!(OctaveSmoothing::OneTwelfth.half_width_points(), Some(4));
  }

  #[test]
  fn octave_smoothing_off_leaves_the_row_untouched() {
    let sr = 48000.0;
    let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
    feed_bank_tone(&mut bank, sr, 1000.0, FFT_BIG * 6);
    assert!(bank.ready());
    // Off must not merely look similar: it must not touch the row at all, so that turning the
    // control off is exactly the old behaviour rather than a 1-wide average of it.
    let plain = bank.psd_db_row(CAL_OFFSET_DB, OctaveSmoothing::Off);
    let linear = bank.psd_linear_row();
    let expected: Vec<f64> = linear
      .iter()
      .map(|p| 10.0 * p.max(1e-20).log10() + CAL_OFFSET_DB)
      .collect();
    assert_eq!(plain, expected, "Off row is not bit-identical");
  }

  #[test]
  fn octave_smoothing_lowers_and_widens_a_tone_peak() {
    let sr = 48000.0;
    let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
    feed_bank_tone(&mut bank, sr, 1000.0, FFT_BIG * 6);
    assert!(bank.ready());
    let freqs = bank.grid_freqs().to_vec();
    let val_at = |row: &[f64], target: f64| {
      let (i, _) = freqs
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
          (**a - target)
            .abs()
            .partial_cmp(&(**b - target).abs())
            .unwrap()
        })
        .unwrap();
      row[i]
    };
    let off = bank.psd_db_row(CAL_OFFSET_DB, OctaveSmoothing::Off);
    let third = bank.psd_db_row(CAL_OFFSET_DB, OctaveSmoothing::OneThird);
    let peak = |row: &[f64]| row.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    // Spreading one tone's energy over a band lowers its peak...
    assert!(
      peak(&third) < peak(&off) - 6.0,
      "1/3 oct should pull the peak well down: off={:.2} third={:.2}",
      peak(&off),
      peak(&third)
    );
    // ...and lifts the skirt beside it, which is the point of the control.
    let skirt_off = val_at(&off, 1150.0);
    let skirt_third = val_at(&third, 1150.0);
    assert!(
      skirt_third > skirt_off + 6.0,
      "1/3 oct should lift the skirt: off={skirt_off:.2} third={skirt_third:.2}"
    );
  }

  #[test]
  fn octave_smoothing_widths_are_ordered() {
    let sr = 48000.0;
    let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
    feed_bank_tone(&mut bank, sr, 1000.0, FFT_BIG * 6);
    assert!(bank.ready());
    let peak = |s| {
      bank
        .psd_db_row(CAL_OFFSET_DB, s)
        .iter()
        .cloned()
        .fold(f64::NEG_INFINITY, f64::max)
    };
    // More smoothing spreads a tone further, so its peak drops monotonically with width.
    let (off, twelfth, sixth, third) = (
      peak(OctaveSmoothing::Off),
      peak(OctaveSmoothing::OneTwelfth),
      peak(OctaveSmoothing::OneSixth),
      peak(OctaveSmoothing::OneThird),
    );
    assert!(
      off > twelfth && twelfth > sixth && sixth > third,
      "peak must fall as the window widens: {off:.2} {twelfth:.2} {sixth:.2} {third:.2}"
    );
  }

  #[test]
  fn octave_smoothing_keeps_broadband_noise_flat() {
    let sr = 48000.0;
    let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
    bank.set_analysis_average_sec(2.0);
    let mut x: u32 = 0x12345678;
    for _ in 0..FFT_BIG * 64 {
      x = x.wrapping_mul(1664525).wrapping_add(1013904223);
      bank.push_sample(((x >> 8) as f32 / 8_388_608.0) - 1.0);
    }
    assert!(bank.ready());
    let row = bank.psd_db_row(0.0, OctaveSmoothing::OneThird);
    let freqs = bank.grid_freqs();
    let band_mean = |lo: f64, hi: f64| {
      let v: Vec<f64> = freqs
        .iter()
        .zip(&row)
        .filter(|(f, _)| **f >= lo && **f <= hi)
        .map(|(_, d)| *d)
        .collect();
      v.iter().sum::<f64>() / v.len() as f64
    };
    // Averaging power across a band must not move a flat spectrum's level: smoothing is
    // averaging, not banding/summation, so white noise stays where it was.
    let seam_200 = (band_mean(120.0, 175.0) - band_mean(230.0, 330.0)).abs();
    let seam_2k = (band_mean(1200.0, 1750.0) - band_mean(2300.0, 3200.0)).abs();
    assert!(seam_200 < 1.0, "smoothed seam at 200 Hz: {seam_200:.2} dB");
    assert!(seam_2k < 1.0, "smoothed seam at 2 kHz: {seam_2k:.2} dB");
  }

  #[test]
  fn calibration_mid_band_full_scale_sine_near_zero() {
    let sr = 48000.0;
    let mut bank = MultiResBank::new(sr, 20.0, 20000.0);
    // 1 kHz sits between both crossovers, so this pins CAL_OFFSET_DB against `FFT_MID` alone.
    // It is deliberately not a claim about tones in general: rows are PSD, so the same sine
    // reads ~+6 dB on `FFT_BIG` and ~-6 dB on `FFT_SMALL`. See CAL_OFFSET_DB.
    feed_bank_tone(&mut bank, sr, 1000.0, FFT_BIG * 6); // amplitude 1.0 = 0 dBFS
    assert!(bank.ready());
    let row = bank.psd_db_row(CAL_OFFSET_DB, OctaveSmoothing::Off);
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
    // Converge the PSD estimate before measuring. A single grid point under the default 150 ms
    // average carries several dB of chi-squared spread, which is what forced the old 4 dB
    // tolerance — wide enough to pass a badly broken seam. Long averaging plus a band mean
    // below drops the spread far enough to assert what this display actually promises.
    bank.set_analysis_average_sec(2.0);
    // Deterministic pseudo-white noise.
    let mut x: u32 = 0x12345678;
    for _ in 0..FFT_BIG * 64 {
      x = x.wrapping_mul(1664525).wrapping_add(1013904223);
      let s = ((x >> 8) as f32 / 8_388_608.0) - 1.0;
      bank.push_sample(s);
    }
    assert!(bank.ready());
    let row = bank.psd_db_row(0.0, OctaveSmoothing::Off);
    let freqs = bank.grid_freqs();
    // Mean dB over a band, kept clear of the ±1/6-octave crossfade around each crossover.
    let band_mean = |lo: f64, hi: f64| {
      let v: Vec<f64> = freqs
        .iter()
        .zip(&row)
        .filter(|(f, _)| **f >= lo && **f <= hi)
        .map(|(_, d)| *d)
        .collect();
      assert!(!v.is_empty(), "no grid points in {lo}-{hi} Hz");
      v.iter().sum::<f64>() / v.len() as f64
    };
    // White-noise PSD is flat, so both analyzers either side of a crossover must agree. This is
    // the display's core convention — noise-referenced levels (see CAL_OFFSET_DB) — so it is
    // asserted tightly. A tone would legitimately step ~6 dB here; noise must not.
    let seam_200 = (band_mean(120.0, 175.0) - band_mean(230.0, 330.0)).abs();
    let seam_2k = (band_mean(1200.0, 1750.0) - band_mean(2300.0, 3200.0)).abs();
    assert!(seam_200 < 1.0, "seam at 200 Hz: {seam_200:.2} dB");
    assert!(seam_2k < 1.0, "seam at 2 kHz: {seam_2k:.2} dB");
  }
}
