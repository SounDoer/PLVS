//! Request-keyed Stereo Map primitives derived from aligned spectral pairs.
//!
//! For every FFT bin, Speed's time-domain EMA is applied first to `PL = E[|XL|²]`,
//! `PR = E[|XR|²]`, and the full complex `C = E[XL * conj(XR)]`. The three resolution rows
//! are then interpolated/crossfaded onto the shared full log-frequency grid. Fractional-octave
//! smoothing is the final DSP operation and runs in linear power/complex space. Only after that
//! does publication discard `Im(C)` and convert the row to Float32.

#[cfg(test)]
use rustfft::num_complex::Complex32;
use rustfft::num_complex::Complex64;

use super::spectral_transform::ComplexSpectralFrame;
use super::spectrum_bank::{
  analysis_average_sec_for_speed_percent, spectrum_frequency_bounds, LogGrid, OctaveSmoothing,
  FFT_BIG, FFT_MID, FFT_SMALL, OVERLAP_BIG, OVERLAP_MID, OVERLAP_SMALL, XFADE_HALF_OCT,
  XOVER_HI_HZ, XOVER_LO_HZ,
};

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct StereoMapPrimitiveRow {
  pub band_centers_hz: Vec<f32>,
  pub pl: Vec<f32>,
  pub pr: Vec<f32>,
  /// The wire row intentionally contains only `Re(C)`.
  pub c: Vec<f32>,
}

struct PrimitiveAverage {
  fft_size: usize,
  overlap: usize,
  pl: Vec<f64>,
  pr: Vec<f64>,
  c: Vec<Complex64>,
  initialized: bool,
}

impl PrimitiveAverage {
  fn new(fft_size: usize, overlap: usize) -> Self {
    Self {
      fft_size,
      overlap,
      pl: Vec::new(),
      pr: Vec::new(),
      c: Vec::new(),
      initialized: false,
    }
  }

  fn consume(
    &mut self,
    left: &ComplexSpectralFrame<'_>,
    right: &ComplexSpectralFrame<'_>,
    sample_rate: f64,
    analysis_average_sec: f64,
  ) {
    debug_assert_eq!(left.fft_size, self.fft_size);
    let bin_count = left.bins.len();
    if self.pl.len() != bin_count {
      self.pl.resize(bin_count, 0.0);
      self.pr.resize(bin_count, 0.0);
      self.c.resize(bin_count, Complex64::new(0.0, 0.0));
      self.initialized = false;
    }

    let hop_sec = (self.fft_size / self.overlap) as f64 / sample_rate;
    let alpha = if analysis_average_sec <= 0.0 {
      1.0
    } else {
      1.0 - (-hop_sec / analysis_average_sec).exp()
    };
    for (index, (&left, &right)) in left.bins.iter().zip(right.bins).enumerate() {
      let left = Complex64::new(left.re as f64, left.im as f64);
      let right = Complex64::new(right.re as f64, right.im as f64);
      let pl = left.norm_sqr();
      let pr = right.norm_sqr();
      let c = left * right.conj();
      if !pl.is_finite() || !pr.is_finite() || !c.re.is_finite() || !c.im.is_finite() {
        self.pl[index] = 0.0;
        self.pr[index] = 0.0;
        self.c[index] = Complex64::new(0.0, 0.0);
        continue;
      }
      if self.initialized {
        if !self.pl[index].is_finite()
          || !self.pr[index].is_finite()
          || !self.c[index].re.is_finite()
          || !self.c[index].im.is_finite()
        {
          self.pl[index] = 0.0;
          self.pr[index] = 0.0;
          self.c[index] = Complex64::new(0.0, 0.0);
        }
        self.pl[index] += (pl - self.pl[index]) * alpha;
        self.pr[index] += (pr - self.pr[index]) * alpha;
        let previous_c = self.c[index];
        self.c[index] += (c - previous_c) * alpha;
      } else {
        self.pl[index] = pl;
        self.pr[index] = pr;
        self.c[index] = c;
      }
    }
    self.initialized = true;
  }
}

#[derive(Clone, Copy)]
struct PrimitiveBinTap {
  k0: usize,
  k1: usize,
  frac: f64,
}

impl PrimitiveBinTap {
  fn new(fft_size: usize, sample_rate: f64, hz: f64) -> Self {
    let bin_count = fft_size / 2 + 1;
    let position = hz / (sample_rate / fft_size as f64);
    let k0 = position.floor().clamp(0.0, (bin_count - 1) as f64) as usize;
    Self {
      k0,
      k1: (k0 + 1).min(bin_count - 1),
      frac: (position - k0 as f64).clamp(0.0, 1.0),
    }
  }

  fn read_f64(self, values: &[f64]) -> f64 {
    values[self.k0] * (1.0 - self.frac) + values[self.k1] * self.frac
  }

  fn read_complex(self, values: &[Complex64]) -> Complex64 {
    values[self.k0] * (1.0 - self.frac) + values[self.k1] * self.frac
  }
}

struct PrimitiveGridTap {
  big: PrimitiveBinTap,
  mid: PrimitiveBinTap,
  small: PrimitiveBinTap,
  low_blend: f64,
  high_blend: f64,
}

struct PrimitiveGrid {
  frequencies: Vec<f64>,
  taps: Vec<PrimitiveGridTap>,
}

impl PrimitiveGrid {
  fn new(sample_rate: f64, min_hz: f64, max_hz: f64) -> Self {
    let frequencies = LogGrid::new(min_hz, max_hz).freqs;
    let taps = frequencies
      .iter()
      .map(|&frequency| PrimitiveGridTap {
        big: PrimitiveBinTap::new(FFT_BIG, sample_rate, frequency),
        mid: PrimitiveBinTap::new(FFT_MID, sample_rate, frequency),
        small: PrimitiveBinTap::new(FFT_SMALL, sample_rate, frequency),
        low_blend: crossover_blend(frequency, XOVER_LO_HZ),
        high_blend: crossover_blend(frequency, XOVER_HI_HZ),
      })
      .collect();
    Self { frequencies, taps }
  }

  fn row_f64(&self, big: &[f64], mid: &[f64], small: &[f64], output: &mut Vec<f64>) {
    output.clear();
    output.reserve(self.taps.len().saturating_sub(output.capacity()));
    output.extend(self.taps.iter().map(|tap| {
      let low_mid =
        tap.big.read_f64(big) * (1.0 - tap.low_blend) + tap.mid.read_f64(mid) * tap.low_blend;
      low_mid * (1.0 - tap.high_blend) + tap.small.read_f64(small) * tap.high_blend
    }));
  }

  fn row_complex(
    &self,
    big: &[Complex64],
    mid: &[Complex64],
    small: &[Complex64],
    output: &mut Vec<Complex64>,
  ) {
    output.clear();
    output.reserve(self.taps.len().saturating_sub(output.capacity()));
    output.extend(self.taps.iter().map(|tap| {
      let low_mid = tap.big.read_complex(big) * (1.0 - tap.low_blend)
        + tap.mid.read_complex(mid) * tap.low_blend;
      low_mid * (1.0 - tap.high_blend) + tap.small.read_complex(small) * tap.high_blend
    }));
  }
}

fn crossover_blend(frequency: f64, crossover_hz: f64) -> f64 {
  let low = crossover_hz * 2_f64.powf(-XFADE_HALF_OCT);
  let high = crossover_hz * 2_f64.powf(XFADE_HALF_OCT);
  if frequency <= low {
    0.0
  } else if frequency >= high {
    1.0
  } else {
    (frequency.log2() - low.log2()) / (high.log2() - low.log2())
  }
}

fn box_average_f64(values: &[f64], half_width: usize, output: &mut Vec<f64>) {
  output.clear();
  output.reserve(values.len().saturating_sub(output.capacity()));
  output.extend((0..values.len()).map(|index| {
    let low = index.saturating_sub(half_width);
    let high = (index + half_width + 1).min(values.len());
    values[low..high].iter().sum::<f64>() / (high - low) as f64
  }));
}

fn box_average_complex(values: &[Complex64], half_width: usize, output: &mut Vec<Complex64>) {
  output.clear();
  output.reserve(values.len().saturating_sub(output.capacity()));
  output.extend((0..values.len()).map(|index| {
    let low = index.saturating_sub(half_width);
    let high = (index + half_width + 1).min(values.len());
    values[low..high].iter().sum::<Complex64>() / (high - low) as f64
  }));
}

#[cfg(test)]
fn box_average_into_f32(values: &[f32], half_width: usize, output: &mut Vec<f32>) {
  output.clear();
  output.reserve(values.len().saturating_sub(output.capacity()));
  output.extend((0..values.len()).map(|index| {
    let low = index.saturating_sub(half_width);
    let high = (index + half_width + 1).min(values.len());
    values[low..high].iter().sum::<f32>() / (high - low) as f32
  }));
}

pub(crate) struct StereoMapConsumer {
  sample_rate: f64,
  analysis_average_sec: f64,
  octave_smoothing: OctaveSmoothing,
  big: PrimitiveAverage,
  mid: PrimitiveAverage,
  small: PrimitiveAverage,
  grid: PrimitiveGrid,
  pl_row: Vec<f64>,
  pr_row: Vec<f64>,
  c_row: Vec<Complex64>,
  smoothed_pl: Vec<f64>,
  smoothed_pr: Vec<f64>,
  smoothed_c: Vec<Complex64>,
  published_row: StereoMapPrimitiveRow,
}

impl StereoMapConsumer {
  pub(crate) fn new(sample_rate: f64, min_hz: f64, max_hz: f64) -> Self {
    let grid = PrimitiveGrid::new(sample_rate, min_hz, max_hz);
    let row_len = grid.frequencies.len();
    let band_centers_hz = grid
      .frequencies
      .iter()
      .map(|&frequency| frequency as f32)
      .collect();
    Self {
      sample_rate,
      analysis_average_sec: analysis_average_sec_for_speed_percent(50.0),
      octave_smoothing: OctaveSmoothing::Off,
      big: PrimitiveAverage::new(FFT_BIG, OVERLAP_BIG),
      mid: PrimitiveAverage::new(FFT_MID, OVERLAP_MID),
      small: PrimitiveAverage::new(FFT_SMALL, OVERLAP_SMALL),
      grid,
      pl_row: Vec::new(),
      pr_row: Vec::new(),
      c_row: Vec::new(),
      smoothed_pl: Vec::new(),
      smoothed_pr: Vec::new(),
      smoothed_c: Vec::new(),
      published_row: StereoMapPrimitiveRow {
        band_centers_hz,
        pl: vec![0.0; row_len],
        pr: vec![0.0; row_len],
        c: vec![0.0; row_len],
      },
    }
  }

  pub(crate) fn for_sample_rate(sample_rate: f64) -> Self {
    let (min_hz, max_hz) = spectrum_frequency_bounds(sample_rate);
    Self::new(sample_rate, min_hz, max_hz)
  }

  pub(crate) fn set_display_controls(
    &mut self,
    speed_percent: f64,
    octave_smoothing: OctaveSmoothing,
  ) {
    self.analysis_average_sec = analysis_average_sec_for_speed_percent(speed_percent);
    self.octave_smoothing = octave_smoothing;
  }

  pub(crate) fn consume_aligned(
    &mut self,
    left: &ComplexSpectralFrame<'_>,
    right: &ComplexSpectralFrame<'_>,
  ) -> bool {
    if !matches!(left.fft_size, FFT_BIG | FFT_MID | FFT_SMALL)
      || right.fft_size != left.fft_size
      || right.sample_clock != left.sample_clock
      || left.bins.len() != left.fft_size / 2 + 1
      || right.bins.len() != left.bins.len()
    {
      return false;
    }
    let average = match left.fft_size {
      FFT_BIG => &mut self.big,
      FFT_MID => &mut self.mid,
      FFT_SMALL => &mut self.small,
      _ => unreachable!("validated FFT size"),
    };
    average.consume(left, right, self.sample_rate, self.analysis_average_sec);
    true
  }

  pub(crate) fn output(&mut self) -> Option<&StereoMapPrimitiveRow> {
    if !self.big.initialized || !self.mid.initialized || !self.small.initialized {
      return None;
    }
    self
      .grid
      .row_f64(&self.big.pl, &self.mid.pl, &self.small.pl, &mut self.pl_row);
    self
      .grid
      .row_f64(&self.big.pr, &self.mid.pr, &self.small.pr, &mut self.pr_row);
    self
      .grid
      .row_complex(&self.big.c, &self.mid.c, &self.small.c, &mut self.c_row);
    let (pl, pr, c) = if let Some(half_width) = self.octave_smoothing.half_width_points() {
      box_average_f64(&self.pl_row, half_width, &mut self.smoothed_pl);
      box_average_f64(&self.pr_row, half_width, &mut self.smoothed_pr);
      box_average_complex(&self.c_row, half_width, &mut self.smoothed_c);
      (&self.smoothed_pl, &self.smoothed_pr, &self.smoothed_c)
    } else {
      (&self.pl_row, &self.pr_row, &self.c_row)
    };

    for (index, ((&pl, &pr), &c)) in pl.iter().zip(pr).zip(c).enumerate() {
      let frequency = self.published_row.band_centers_hz[index];
      let pl = pl as f32;
      let pr = pr as f32;
      let c_re = c.re as f32;
      let c_im = c.im as f32;
      if frequency.is_finite()
        && pl.is_finite()
        && pr.is_finite()
        && c_re.is_finite()
        && c_im.is_finite()
      {
        self.published_row.pl[index] = pl;
        self.published_row.pr[index] = pr;
        self.published_row.c[index] = c_re;
      } else {
        self.published_row.band_centers_hz[index] = if frequency.is_finite() {
          frequency
        } else {
          0.0
        };
        self.published_row.pl[index] = 0.0;
        self.published_row.pr[index] = 0.0;
        self.published_row.c[index] = 0.0;
      }
    }
    Some(&self.published_row)
  }

  #[cfg(test)]
  pub(crate) fn band_centers_for_test(&self) -> &[f32] {
    &self.published_row.band_centers_hz
  }

  #[cfg(test)]
  fn complex_output_row_for_test(&self) -> &[Complex64] {
    if self.octave_smoothing.half_width_points().is_some() {
      &self.smoothed_c
    } else {
      &self.c_row
    }
  }

  #[cfg(test)]
  fn resolution_primitives_for_test(
    &self,
    fft_size: usize,
  ) -> Option<(&[f64], &[f64], Vec<Complex32>)> {
    let average = match fft_size {
      FFT_BIG => &self.big,
      FFT_MID => &self.mid,
      FFT_SMALL => &self.small,
      _ => return None,
    };
    average.initialized.then(|| {
      (
        average.pl.as_slice(),
        average.pr.as_slice(),
        average
          .c
          .iter()
          .map(|value| Complex32::new(value.re as f32, value.im as f32))
          .collect(),
      )
    })
  }
}

#[cfg(test)]
mod tests {
  /// The frame protocol sends one band grid for every row on it, Stereo Map's included, so this
  /// pins the thing that makes that legal: the two are built from the same `LogGrid` over the same
  /// bounds, and a divergence here would misplace every Stereo Map band without failing anything
  /// else.
  #[test]
  fn rows_sit_on_the_same_band_grid_the_spectrum_does() {
    for sample_rate in [44_100.0, 48_000.0, 96_000.0] {
      let consumer = super::StereoMapConsumer::for_sample_rate(sample_rate);
      let expected: Vec<f32> = crate::dsp::spectrum_band_centers(sample_rate)
        .into_iter()
        .map(|frequency| frequency as f32)
        .collect();
      assert_eq!(
        consumer.band_centers_for_test(),
        expected.as_slice(),
        "{sample_rate} Hz grid"
      );
    }
  }

  use super::*;
  use crate::dsp::shared_spectral_engine::allocation_counter;
  use crate::dsp::spectral_transform::ComplexSpectralFrame;
  use crate::dsp::spectrum_bank::{
    box_average_into, FFT_BIG, FFT_MID, FFT_SMALL, OVERLAP_BIG, OVERLAP_MID, OVERLAP_SMALL,
  };
  use rustfft::num_complex::Complex32;

  const SR: f64 = 48_000.0;

  fn overlap(fft_size: usize) -> usize {
    match fft_size {
      FFT_BIG => OVERLAP_BIG,
      FFT_MID => OVERLAP_MID,
      FFT_SMALL => OVERLAP_SMALL,
      _ => panic!("unexpected FFT size"),
    }
  }

  fn frame<'a>(
    fft_size: usize,
    sample_clock: u64,
    bins: &'a [Complex32],
  ) -> ComplexSpectralFrame<'a> {
    ComplexSpectralFrame {
      fft_size,
      sample_clock,
      bins,
    }
  }

  fn uniform_bins(fft_size: usize, value: Complex32) -> Vec<Complex32> {
    vec![value; fft_size / 2 + 1]
  }

  fn consume_uniform_pair(
    consumer: &mut StereoMapConsumer,
    left: Complex32,
    right: Complex32,
    clock_multiplier: usize,
  ) {
    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let clock = (fft_size / overlap(fft_size) * clock_multiplier) as u64;
      let left_bins = uniform_bins(fft_size, left);
      let right_bins = uniform_bins(fft_size, right);
      assert!(consumer.consume_aligned(
        &frame(fft_size, clock, &left_bins),
        &frame(fft_size, clock, &right_bins),
      ));
    }
  }

  fn assert_close(actual: f64, expected: f64, context: &str) {
    assert!(
      (actual - expected).abs() < 1e-6,
      "{context}: actual={actual}, expected={expected}"
    );
  }

  #[test]
  fn aligned_complex_bins_match_reference_primitives() {
    let cases = [
      (
        "equal-energy in-phase",
        Complex32::new(1.0, 0.0),
        Complex32::new(1.0, 0.0),
        (1.0, 1.0, Complex32::new(1.0, 0.0)),
      ),
      (
        "equal-energy anti-phase",
        Complex32::new(1.0, 0.0),
        Complex32::new(-1.0, 0.0),
        (1.0, 1.0, Complex32::new(-1.0, 0.0)),
      ),
      (
        "quadrature",
        Complex32::new(1.0, 0.0),
        Complex32::new(0.0, 1.0),
        (1.0, 1.0, Complex32::new(0.0, -1.0)),
      ),
      (
        "unequal in-phase amplitudes",
        Complex32::new(2.0, 0.0),
        Complex32::new(0.5, 0.0),
        (4.0, 0.25, Complex32::new(1.0, 0.0)),
      ),
      (
        "single-sided",
        Complex32::new(1.25, -0.5),
        Complex32::new(0.0, 0.0),
        (1.8125, 0.0, Complex32::new(0.0, 0.0)),
      ),
    ];

    for (name, left, right, expected) in cases {
      let mut consumer = StereoMapConsumer::new(SR, 20.0, 20_000.0);
      consumer.set_display_controls(0.0, OctaveSmoothing::Off);
      consume_uniform_pair(&mut consumer, left, right, 1);
      let actual = consumer
        .resolution_primitives_for_test(FFT_MID)
        .expect("mid primitives");
      assert_close(actual.0[0], expected.0, &format!("{name} PL"));
      assert_close(actual.1[0], expected.1, &format!("{name} PR"));
      assert_close(
        actual.2[0].re as f64,
        expected.2.re as f64,
        &format!("{name} C.re"),
      );
      assert_close(
        actual.2[0].im as f64,
        expected.2.im as f64,
        &format!("{name} C.im"),
      );
    }
  }

  #[test]
  fn deterministic_independent_noise_cross_average_converges_near_zero() {
    let mut consumer = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    consumer.set_display_controls(100.0, OctaveSmoothing::Off);
    let mut left_state = 0x1234_5678_u32;
    let mut right_state = 0x8765_4321_u32;
    for step in 1..=4_000 {
      left_state = left_state
        .wrapping_mul(1_664_525)
        .wrapping_add(1_013_904_223);
      right_state = right_state.wrapping_mul(22_695_477).wrapping_add(1);
      let left = ((left_state >> 8) as f32 / 8_388_608.0) - 1.0;
      let right = ((right_state >> 8) as f32 / 8_388_608.0) - 1.0;
      let fft_size = FFT_SMALL;
      let left_bins = uniform_bins(fft_size, Complex32::new(left, 0.0));
      let right_bins = uniform_bins(fft_size, Complex32::new(right, 0.0));
      assert!(consumer.consume_aligned(
        &frame(
          fft_size,
          (step * FFT_SMALL / OVERLAP_SMALL) as u64,
          &left_bins
        ),
        &frame(
          fft_size,
          (step * FFT_SMALL / OVERLAP_SMALL) as u64,
          &right_bins,
        ),
      ));
    }
    let (pl, pr, c) = consumer
      .resolution_primitives_for_test(FFT_SMALL)
      .expect("small primitives");
    assert!(pl[0] > 0.05);
    assert!(pr[0] > 0.05);
    assert!(c[0].norm() < 0.05, "independent cross average: {}", c[0]);
  }

  #[test]
  fn speed_ema_is_independent_per_consumer_and_applies_to_complex_c() {
    let mut fast = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    fast.set_display_controls(0.0, OctaveSmoothing::Off);
    let mut slow = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    slow.set_display_controls(100.0, OctaveSmoothing::Off);
    consume_uniform_pair(
      &mut fast,
      Complex32::new(1.0, 0.0),
      Complex32::new(1.0, 0.0),
      1,
    );
    consume_uniform_pair(
      &mut slow,
      Complex32::new(1.0, 0.0),
      Complex32::new(1.0, 0.0),
      1,
    );
    consume_uniform_pair(
      &mut fast,
      Complex32::new(0.25, 0.0),
      Complex32::new(0.0, 0.25),
      2,
    );
    consume_uniform_pair(
      &mut slow,
      Complex32::new(0.25, 0.0),
      Complex32::new(0.0, 0.25),
      2,
    );

    let fast = fast
      .resolution_primitives_for_test(FFT_MID)
      .expect("fast state");
    let slow = slow
      .resolution_primitives_for_test(FFT_MID)
      .expect("slow state");
    assert_close(fast.0[0], 0.0625, "fast PL");
    assert_close(fast.1[0], 0.0625, "fast PR");
    assert_close(fast.2[0].re as f64, 0.0, "fast C.re");
    assert_close(fast.2[0].im as f64, -0.0625, "fast C.im");
    assert!(slow.0[0] > fast.0[0]);
    assert!(slow.1[0] > fast.1[0]);
    assert!(slow.2[0].re > fast.2[0].re);
    assert!(slow.2[0].im > fast.2[0].im);
  }

  #[test]
  fn speed_ema_uses_each_resolution_hop_for_every_primitive() {
    let tau = 0.150;
    let first_left = Complex32::new(0.8, -0.3);
    let first_right = Complex32::new(-0.2, 0.6);
    let second_left = Complex32::new(0.1, 0.4);
    let second_right = Complex32::new(0.7, -0.25);
    let to_f64 = |value: Complex32| Complex64::new(value.re as f64, value.im as f64);
    let first_left_64 = to_f64(first_left);
    let first_right_64 = to_f64(first_right);
    let second_left_64 = to_f64(second_left);
    let second_right_64 = to_f64(second_right);
    let first = (
      first_left_64.norm_sqr(),
      first_right_64.norm_sqr(),
      first_left_64 * first_right_64.conj(),
    );
    let second = (
      second_left_64.norm_sqr(),
      second_right_64.norm_sqr(),
      second_left_64 * second_right_64.conj(),
    );
    let mut consumer = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    consumer.set_display_controls(100.0, OctaveSmoothing::Off);

    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let hop = fft_size / overlap(fft_size);
      let first_left_bins = uniform_bins(fft_size, first_left);
      let first_right_bins = uniform_bins(fft_size, first_right);
      assert!(consumer.consume_aligned(
        &frame(fft_size, hop as u64, &first_left_bins),
        &frame(fft_size, hop as u64, &first_right_bins),
      ));
      let actual = consumer
        .resolution_primitives_for_test(fft_size)
        .expect("first EMA frame");
      assert_eq!(actual.0[0], first.0, "{fft_size} first PL");
      assert_eq!(actual.1[0], first.1, "{fft_size} first PR");
      assert_close(
        actual.2[0].re as f64,
        first.2.re,
        &format!("{fft_size} first C.re"),
      );
      assert_close(
        actual.2[0].im as f64,
        first.2.im,
        &format!("{fft_size} first C.im"),
      );

      let second_left_bins = uniform_bins(fft_size, second_left);
      let second_right_bins = uniform_bins(fft_size, second_right);
      assert!(consumer.consume_aligned(
        &frame(fft_size, (hop * 2) as u64, &second_left_bins),
        &frame(fft_size, (hop * 2) as u64, &second_right_bins),
      ));
      let alpha = 1.0 - (-(hop as f64 / SR) / tau).exp();
      let expected_pl = first.0 + (second.0 - first.0) * alpha;
      let expected_pr = first.1 + (second.1 - first.1) * alpha;
      let expected_c = first.2 + (second.2 - first.2) * alpha;
      let actual = consumer
        .resolution_primitives_for_test(fft_size)
        .expect("second EMA frame");
      assert!(
        (actual.0[0] - expected_pl).abs() < 1e-14,
        "{fft_size} PL used wrong hop"
      );
      assert!(
        (actual.1[0] - expected_pr).abs() < 1e-14,
        "{fft_size} PR used wrong hop"
      );
      assert_close(
        actual.2[0].re as f64,
        expected_c.re,
        &format!("{fft_size} C.re used wrong hop"),
      );
      assert_close(
        actual.2[0].im as f64,
        expected_c.im,
        &format!("{fft_size} C.im used wrong hop"),
      );
    }
  }

  #[test]
  fn frequency_smoothing_runs_on_linear_pl_pr_and_complex_c_before_publish() {
    let mut plain = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    plain.set_display_controls(0.0, OctaveSmoothing::Off);
    let mut smoothed = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    smoothed.set_display_controls(0.0, OctaveSmoothing::OneThird);

    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let left: Vec<_> = (0..=fft_size / 2)
        .map(|index| Complex32::new(0.1 + (index % 23) as f32 / 20.0, 0.25))
        .collect();
      let right: Vec<_> = (0..=fft_size / 2)
        .map(|index| Complex32::new(0.2, -0.1 - (index % 17) as f32 / 30.0))
        .collect();
      let clock = (fft_size / overlap(fft_size)) as u64;
      assert!(plain.consume_aligned(
        &frame(fft_size, clock, &left),
        &frame(fft_size, clock, &right),
      ));
      assert!(smoothed.consume_aligned(
        &frame(fft_size, clock, &left),
        &frame(fft_size, clock, &right),
      ));
    }

    let plain = plain.output().expect("plain row");
    let actual = smoothed.output().expect("smoothed row");
    let half = OctaveSmoothing::OneThird
      .half_width_points()
      .expect("smoothing width");
    let mut expected_pl = Vec::new();
    let mut expected_pr = Vec::new();
    let mut expected_c = Vec::new();
    box_average_into_f32(&plain.pl, half, &mut expected_pl);
    box_average_into_f32(&plain.pr, half, &mut expected_pr);
    box_average_into(
      &plain.c.iter().map(|&v| v as f64).collect::<Vec<_>>(),
      half,
      &mut expected_c,
    );

    for (index, (&actual, &expected)) in actual.pl.iter().zip(&expected_pl).enumerate() {
      assert!((actual - expected).abs() < 2e-6, "smoothed PL[{index}]");
    }
    for (index, (&actual, &expected)) in actual.pr.iter().zip(&expected_pr).enumerate() {
      assert!((actual - expected).abs() < 2e-6, "smoothed PR[{index}]");
    }
    for (index, (&actual, expected)) in actual.c.iter().zip(expected_c).enumerate() {
      assert!(
        (actual - expected as f32).abs() < 2e-6,
        "smoothed C.re[{index}]"
      );
    }
  }

  #[test]
  fn frequency_smoothing_applies_identical_grid_weights_to_both_complex_components() {
    let mut plain = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    plain.set_display_controls(0.0, OctaveSmoothing::Off);
    let mut smoothed = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    smoothed.set_display_controls(0.0, OctaveSmoothing::OneSixth);
    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let left: Vec<_> = (0..=fft_size / 2)
        .map(|index| {
          Complex32::new(
            0.15 + (index % 19) as f32 * 0.031,
            -0.4 + (index % 13) as f32 * 0.047,
          )
        })
        .collect();
      let right: Vec<_> = (0..=fft_size / 2)
        .map(|index| {
          Complex32::new(
            -0.35 + (index % 11) as f32 * 0.053,
            0.2 + (index % 17) as f32 * 0.029,
          )
        })
        .collect();
      let clock = (fft_size / overlap(fft_size)) as u64;
      assert!(plain.consume_aligned(
        &frame(fft_size, clock, &left),
        &frame(fft_size, clock, &right),
      ));
      assert!(smoothed.consume_aligned(
        &frame(fft_size, clock, &left),
        &frame(fft_size, clock, &right),
      ));
    }

    plain.output().expect("plain output");
    let plain_c = plain.complex_output_row_for_test().to_vec();
    let wire_c = smoothed.output().expect("smoothed output").c.clone();
    let actual_c = smoothed.complex_output_row_for_test();
    let half = OctaveSmoothing::OneSixth
      .half_width_points()
      .expect("smoothing width");
    let mut expected = Vec::new();
    box_average_complex(&plain_c, half, &mut expected);
    assert_eq!(actual_c.len(), expected.len());
    assert!(expected.iter().any(|value| value.im.abs() > 1e-5));
    for (index, (&actual, &expected)) in actual_c.iter().zip(&expected).enumerate() {
      assert!(
        (actual.re - expected.re).abs() < 1e-12,
        "C.re[{index}] grid/smoothing mismatch"
      );
      assert!(
        (actual.im - expected.im).abs() < 1e-12,
        "C.im[{index}] grid/smoothing mismatch"
      );
      assert!(
        (wire_c[index] - actual.re as f32).abs() < 1e-6,
        "wire C[{index}] was not derived after complex smoothing"
      );
    }
  }

  #[test]
  fn wire_row_is_float32_and_publishes_only_real_c_while_internal_c_stays_complex() {
    let mut consumer = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    consumer.set_display_controls(0.0, OctaveSmoothing::Off);
    consume_uniform_pair(
      &mut consumer,
      Complex32::new(1.0, 0.0),
      Complex32::new(0.0, 1.0),
      1,
    );

    let internal = consumer
      .resolution_primitives_for_test(FFT_MID)
      .expect("internal primitives");
    assert_close(internal.2[0].im as f64, -1.0, "internal C.im");
    let row: &StereoMapPrimitiveRow = consumer.output().expect("wire row");
    assert!(row.c.iter().all(|&value| value == 0.0));
    assert_eq!(row.band_centers_hz.len(), row.pl.len());
    assert_eq!(row.pl.len(), row.pr.len());
    assert_eq!(row.pr.len(), row.c.len());
  }

  #[test]
  fn any_non_finite_primitive_canonicalizes_the_whole_point_and_all_output_is_finite() {
    for bad in [
      Complex32::new(f32::NAN, 0.0),
      Complex32::new(f32::INFINITY, 0.0),
      Complex32::new(0.0, f32::NEG_INFINITY),
    ] {
      let mut consumer = StereoMapConsumer::new(SR, 20.0, 20_000.0);
      consumer.set_display_controls(0.0, OctaveSmoothing::Off);
      consume_uniform_pair(&mut consumer, bad, Complex32::new(1.0, 0.0), 1);
      let row = consumer.output().expect("canonical row");
      assert!(row.band_centers_hz.iter().all(|value| value.is_finite()));
      assert!(row.pl.iter().all(|&value| value == 0.0));
      assert!(row.pr.iter().all(|&value| value == 0.0));
      assert!(row.c.iter().all(|&value| value == 0.0));
    }
  }

  #[test]
  fn non_finite_bin_resets_complete_triplet_and_next_finite_frame_recovers_by_ema_from_zero() {
    let fft_size = FFT_SMALL;
    let hop = fft_size / OVERLAP_SMALL;
    let bad_index = 17;
    let mut consumer = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    consumer.set_display_controls(100.0, OctaveSmoothing::OneThird);
    let mut bad_left = uniform_bins(fft_size, Complex32::new(0.5, 0.25));
    let bad_right = uniform_bins(fft_size, Complex32::new(-0.25, 0.75));
    bad_left[bad_index] = Complex32::new(f32::NAN, 0.25);
    assert!(consumer.consume_aligned(
      &frame(fft_size, hop as u64, &bad_left),
      &frame(fft_size, hop as u64, &bad_right),
    ));
    let after_bad = consumer
      .resolution_primitives_for_test(fft_size)
      .expect("bad frame establishes explicit zero state");
    assert_eq!(after_bad.0[bad_index], 0.0);
    assert_eq!(after_bad.1[bad_index], 0.0);
    assert_eq!(after_bad.2[bad_index], Complex32::new(0.0, 0.0));
    assert!(after_bad.0[bad_index - 1].is_finite());
    assert!(after_bad.1[bad_index - 1].is_finite());
    assert!(after_bad.2[bad_index - 1].re.is_finite());
    assert!(after_bad.2[bad_index - 1].im.is_finite());

    let finite_left = Complex32::new(0.4, -0.3);
    let finite_right = Complex32::new(-0.2, 0.6);
    let finite_left_bins = uniform_bins(fft_size, finite_left);
    let finite_right_bins = uniform_bins(fft_size, finite_right);
    assert!(consumer.consume_aligned(
      &frame(fft_size, (hop * 2) as u64, &finite_left_bins),
      &frame(fft_size, (hop * 2) as u64, &finite_right_bins),
    ));
    let alpha = 1.0 - (-(hop as f64 / SR) / 0.150).exp();
    let left = Complex64::new(finite_left.re as f64, finite_left.im as f64);
    let right = Complex64::new(finite_right.re as f64, finite_right.im as f64);
    let expected_pl = left.norm_sqr() * alpha;
    let expected_pr = right.norm_sqr() * alpha;
    let expected_c = left * right.conj() * alpha;
    let recovered = consumer
      .resolution_primitives_for_test(fft_size)
      .expect("finite recovery state");
    assert!(
      (recovered.0[bad_index] - expected_pl).abs() < 1e-14,
      "recovered PL={}",
      recovered.0[bad_index]
    );
    assert!(
      (recovered.1[bad_index] - expected_pr).abs() < 1e-14,
      "recovered PR={}",
      recovered.1[bad_index]
    );
    assert_close(
      recovered.2[bad_index].re as f64,
      expected_c.re,
      "recovered C.re",
    );
    assert_close(
      recovered.2[bad_index].im as f64,
      expected_c.im,
      "recovered C.im",
    );
  }

  #[test]
  fn rejects_misaligned_pairs_without_mutating_state() {
    let mut consumer = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    let left = uniform_bins(FFT_SMALL, Complex32::new(1.0, 0.0));
    let right = uniform_bins(FFT_SMALL, Complex32::new(1.0, 0.0));
    assert!(!consumer.consume_aligned(
      &frame(FFT_SMALL, 512, &left),
      &frame(FFT_SMALL, 513, &right),
    ));
    assert!(consumer.resolution_primitives_for_test(FFT_SMALL).is_none());
  }

  #[test]
  fn warmed_consume_reuses_primitive_buffers() {
    let mut consumer = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    let left = uniform_bins(FFT_SMALL, Complex32::new(0.75, 0.25));
    let right = uniform_bins(FFT_SMALL, Complex32::new(0.5, -0.125));
    let first = frame(FFT_SMALL, 512, &left);
    let second = frame(FFT_SMALL, 1_024, &left);
    let right_first = frame(FFT_SMALL, 512, &right);
    let right_second = frame(FFT_SMALL, 1_024, &right);
    assert!(consumer.consume_aligned(&first, &right_first));

    let allocations = allocation_counter::count_current_thread_allocations(|| {
      assert!(consumer.consume_aligned(&second, &right_second));
    });
    assert_eq!(allocations, 0, "steady-state pair consume allocated");
  }

  #[test]
  fn warmed_consume_and_output_reuse_all_persistent_rows_without_allocating() {
    let mut consumer = StereoMapConsumer::new(SR, 20.0, 20_000.0);
    consumer.set_display_controls(50.0, OctaveSmoothing::OneThird);
    consume_uniform_pair(
      &mut consumer,
      Complex32::new(0.75, 0.25),
      Complex32::new(0.5, -0.125),
      1,
    );
    let first = consumer.output().expect("warm output");
    let centers_ptr = first.band_centers_hz.as_ptr();
    let pl_ptr = first.pl.as_ptr();
    let pr_ptr = first.pr.as_ptr();
    let c_ptr = first.c.as_ptr();

    let big_left = uniform_bins(FFT_BIG, Complex32::new(0.4, 0.2));
    let big_right = uniform_bins(FFT_BIG, Complex32::new(0.3, -0.1));
    let mid_left = uniform_bins(FFT_MID, Complex32::new(0.4, 0.2));
    let mid_right = uniform_bins(FFT_MID, Complex32::new(0.3, -0.1));
    let small_left = uniform_bins(FFT_SMALL, Complex32::new(0.4, 0.2));
    let small_right = uniform_bins(FFT_SMALL, Complex32::new(0.3, -0.1));

    let allocations = allocation_counter::count_current_thread_allocations(|| {
      for (fft_size, left, right) in [
        (FFT_BIG, big_left.as_slice(), big_right.as_slice()),
        (FFT_MID, mid_left.as_slice(), mid_right.as_slice()),
        (FFT_SMALL, small_left.as_slice(), small_right.as_slice()),
      ] {
        let clock = (fft_size / overlap(fft_size) * 2) as u64;
        assert!(consumer.consume_aligned(
          &frame(fft_size, clock, left),
          &frame(fft_size, clock, right),
        ));
      }
      let row = consumer.output().expect("steady output");
      assert_eq!(row.band_centers_hz.as_ptr(), centers_ptr);
      assert_eq!(row.pl.as_ptr(), pl_ptr);
      assert_eq!(row.pr.as_ptr(), pr_ptr);
      assert_eq!(row.c.as_ptr(), c_ptr);
    });
    assert_eq!(allocations, 0, "steady-state consume/output allocated");
  }
}
