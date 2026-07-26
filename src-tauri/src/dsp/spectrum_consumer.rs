#![allow(dead_code)]

use super::spectral_transform::ComplexSpectralFrame;
use super::spectrum::{apply_envelope, weighting_db, SLOPE_PIVOT_HZ};
use super::spectrum_bank::{
  analysis_average_sec_for_speed_percent, attack_release_ms_for_speed_percent, box_average_into,
  OctaveSmoothing, SpectrumGrid, CAL_OFFSET_DB, FFT_BIG, FFT_MID, FFT_SMALL, OVERLAP_BIG,
  OVERLAP_MID, OVERLAP_SMALL,
};
use rustfft::num_complex::Complex32;
#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(test)]
static NEXT_STATE_EPOCH: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CurveProjection {
  First,
  Second,
  Combined,
  Mid,
  Side,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpectralProjection {
  Single,
  Combined,
  Lr,
  Ms,
}

fn projected_power(x: Complex32, y: Complex32, projection: CurveProjection) -> f64 {
  let direct_power = |bin: Complex32| {
    let magnitude = (bin.re * bin.re + bin.im * bin.im).sqrt() as f64;
    magnitude.powi(2)
  };
  let projected = match projection {
    CurveProjection::First => return direct_power(x),
    CurveProjection::Second => return direct_power(y),
    CurveProjection::Combined | CurveProjection::Mid => (x + y) * 0.5,
    CurveProjection::Side => (x - y) * 0.5,
  };
  projected.norm_sqr() as f64
}

struct ResolutionAverage {
  fft_size: usize,
  overlap: usize,
  psd: Vec<f64>,
  initialized: bool,
}

impl ResolutionAverage {
  fn new(fft_size: usize, overlap: usize) -> Self {
    Self {
      fft_size,
      overlap,
      psd: Vec::new(),
      initialized: false,
    }
  }

  fn consume_projected(
    &mut self,
    x: &ComplexSpectralFrame<'_>,
    y: Option<&ComplexSpectralFrame<'_>>,
    projection: CurveProjection,
    sample_rate: f64,
    analysis_average_sec: f64,
  ) {
    debug_assert_eq!(x.fft_size, self.fft_size);
    if x.bins.len() != self.fft_size / 2 + 1 {
      return;
    }
    if self.psd.len() != x.bins.len() {
      self.psd.resize(x.bins.len(), 0.0);
      self.initialized = false;
    }

    let bin_width_hz = sample_rate / self.fft_size as f64;
    let hop_sec = (self.fft_size / self.overlap) as f64 / sample_rate;
    let alpha = if analysis_average_sec <= 0.0 {
      1.0
    } else {
      1.0 - (-hop_sec / analysis_average_sec).exp()
    };
    for (index, average) in self.psd.iter_mut().enumerate() {
      let second = y.map(|frame| frame.bins[index]).unwrap_or_default();
      let psd = projected_power(x.bins[index], second, projection).max(1e-24) / bin_width_hz;
      if self.initialized {
        *average += (psd - *average) * alpha;
      } else {
        *average = psd;
      }
    }
    self.initialized = true;
  }
}

struct CurveState {
  big: ResolutionAverage,
  mid: ResolutionAverage,
  small: ResolutionAverage,
  linear_row: Vec<f64>,
  smoothed_linear: Vec<f64>,
  incoming_db: Vec<f64>,
  smooth_db: Vec<f64>,
  peak_db: Vec<f64>,
  peak_hold_until: Vec<f64>,
  last_time_sec: f64,
}

impl CurveState {
  fn new() -> Self {
    Self {
      big: ResolutionAverage::new(FFT_BIG, OVERLAP_BIG),
      mid: ResolutionAverage::new(FFT_MID, OVERLAP_MID),
      small: ResolutionAverage::new(FFT_SMALL, OVERLAP_SMALL),
      linear_row: Vec::new(),
      smoothed_linear: Vec::new(),
      incoming_db: Vec::new(),
      smooth_db: Vec::new(),
      peak_db: Vec::new(),
      peak_hold_until: Vec::new(),
      last_time_sec: 0.0,
    }
  }

  fn consume(
    &mut self,
    x: &ComplexSpectralFrame<'_>,
    y: Option<&ComplexSpectralFrame<'_>>,
    projection: CurveProjection,
    sample_rate: f64,
    analysis_average_sec: f64,
  ) {
    let average = match x.fft_size {
      FFT_BIG => &mut self.big,
      FFT_MID => &mut self.mid,
      FFT_SMALL => &mut self.small,
      _ => return,
    };
    average.consume_projected(x, y, projection, sample_rate, analysis_average_sec);
  }

  #[allow(clippy::too_many_arguments)]
  fn output(
    &mut self,
    grid: &SpectrumGrid,
    weighting: &str,
    attack_ms: f64,
    release_ms: f64,
    peak_hold_sec: f64,
    peak_decay_db_per_sec: f64,
    tilt_db_per_octave: f64,
    octave_smoothing: OctaveSmoothing,
    now_sec: f64,
  ) -> Option<SpectralCurveOutput<'_>> {
    if !self.big.initialized || !self.mid.initialized || !self.small.initialized {
      return None;
    }

    grid.linear_row_into(
      &self.big.psd,
      &self.mid.psd,
      &self.small.psd,
      &mut self.linear_row,
    );
    let linear = if let Some(half) = octave_smoothing.half_width_points() {
      box_average_into(&self.linear_row, half, &mut self.smoothed_linear);
      &self.smoothed_linear
    } else {
      &self.linear_row
    };

    self.incoming_db.clear();
    self
      .incoming_db
      .reserve(linear.len().saturating_sub(self.incoming_db.capacity()));
    let log_pivot = SLOPE_PIVOT_HZ.log2();
    self
      .incoming_db
      .extend(linear.iter().zip(grid.freqs()).map(|(&psd, &frequency)| {
        10.0 * psd.max(1e-20).log10()
          + CAL_OFFSET_DB
          + weighting_db(frequency, weighting)
          + tilt_db_per_octave * (frequency.log2() - log_pivot)
      }));

    let delta_sec = if self.last_time_sec > 0.0 {
      (now_sec - self.last_time_sec).clamp(1.0 / 240.0, 0.25)
    } else {
      1.0 / 60.0
    };
    self.last_time_sec = now_sec;
    apply_envelope(
      &self.incoming_db,
      &mut self.smooth_db,
      &mut self.peak_db,
      &mut self.peak_hold_until,
      now_sec,
      delta_sec,
      attack_ms,
      release_ms,
      peak_hold_sec,
      peak_decay_db_per_sec,
    );

    Some(SpectralCurveOutput {
      smooth_db: &self.smooth_db,
      peak_db: &self.peak_db,
    })
  }

  #[cfg(test)]
  fn psd(&self, fft_size: usize) -> &[f64] {
    match fft_size {
      FFT_BIG => &self.big.psd,
      FFT_MID => &self.mid.psd,
      FFT_SMALL => &self.small.psd,
      _ => &[],
    }
  }
}

pub(crate) struct SpectralCurveOutput<'a> {
  pub smooth_db: &'a [f64],
  pub peak_db: &'a [f64],
}

pub(crate) struct SpectralOutput<'a> {
  pub centers_hz: &'a [f64],
  pub smooth_db: &'a [f64],
  pub peak_db: &'a [f64],
  pub secondary: Option<SpectralCurveOutput<'a>>,
}

#[allow(dead_code)]
pub(crate) struct SpectralConsumer {
  sample_rate: f64,
  analysis_average_sec: f64,
  grid: SpectrumGrid,
  projection: SpectralProjection,
  primary: CurveState,
  secondary: Option<CurveState>,
  weighting: String,
  attack_ms: f64,
  release_ms: f64,
  peak_hold_sec: f64,
  peak_decay_db_per_sec: f64,
  tilt_db_per_octave: f64,
  octave_smoothing: OctaveSmoothing,
  #[cfg(test)]
  state_epoch: u64,
}

#[allow(dead_code)]
impl SpectralConsumer {
  pub(crate) fn new(sample_rate: f64, min_hz: f64, max_hz: f64) -> Self {
    Self::new_projected(sample_rate, min_hz, max_hz, SpectralProjection::Single)
  }

  pub(crate) fn new_projected(
    sample_rate: f64,
    min_hz: f64,
    max_hz: f64,
    projection: SpectralProjection,
  ) -> Self {
    Self {
      sample_rate,
      analysis_average_sec: analysis_average_sec_for_speed_percent(50.0),
      grid: SpectrumGrid::new(sample_rate, min_hz, max_hz),
      projection,
      primary: CurveState::new(),
      secondary: matches!(projection, SpectralProjection::Lr | SpectralProjection::Ms)
        .then(CurveState::new),
      weighting: "z".to_string(),
      attack_ms: 30.0,
      release_ms: 150.0,
      peak_hold_sec: 1.5,
      peak_decay_db_per_sec: 8.0,
      tilt_db_per_octave: 3.0,
      octave_smoothing: OctaveSmoothing::Off,
      #[cfg(test)]
      state_epoch: NEXT_STATE_EPOCH.fetch_add(1, Ordering::Relaxed),
    }
  }

  pub(crate) fn set_display_controls(
    &mut self,
    speed_percent: f64,
    tilt_db_per_octave: f64,
    octave_smoothing: OctaveSmoothing,
  ) {
    (self.attack_ms, self.release_ms) = attack_release_ms_for_speed_percent(speed_percent);
    self.analysis_average_sec = analysis_average_sec_for_speed_percent(speed_percent);
    self.tilt_db_per_octave = tilt_db_per_octave.clamp(0.0, 6.0);
    self.octave_smoothing = octave_smoothing;
  }

  pub(crate) fn set_weighting(&mut self, weighting: &str) {
    self.weighting.clear();
    self.weighting.push_str(weighting);
  }

  pub(crate) fn set_projection(&mut self, projection: SpectralProjection) {
    if self.projection == projection {
      return;
    }
    let needs_secondary = matches!(projection, SpectralProjection::Lr | SpectralProjection::Ms);
    if needs_secondary && self.secondary.is_none() {
      self.secondary = Some(CurveState::new());
    } else if !needs_secondary {
      self.secondary = None;
    }
    self.projection = projection;
  }

  pub(crate) fn consume(&mut self, frame: &ComplexSpectralFrame<'_>) {
    let _ = self.consume_aligned(frame, None);
  }

  pub(crate) fn consume_aligned(
    &mut self,
    x: &ComplexSpectralFrame<'_>,
    y: Option<&ComplexSpectralFrame<'_>>,
  ) -> bool {
    let needs_pair = !matches!(self.projection, SpectralProjection::Single);
    if !matches!(x.fft_size, FFT_BIG | FFT_MID | FFT_SMALL)
      || x.bins.len() != x.fft_size / 2 + 1
      || (needs_pair
        && !matches!(
          y,
          Some(second)
            if second.fft_size == x.fft_size
              && second.sample_clock == x.sample_clock
              && second.bins.len() == x.bins.len()
        ))
    {
      return false;
    }

    let (primary_projection, secondary_projection) = match self.projection {
      SpectralProjection::Single => (CurveProjection::First, None),
      SpectralProjection::Combined => (CurveProjection::Combined, None),
      SpectralProjection::Lr => (CurveProjection::First, Some(CurveProjection::Second)),
      SpectralProjection::Ms => (CurveProjection::Mid, Some(CurveProjection::Side)),
    };
    self.primary.consume(
      x,
      y,
      primary_projection,
      self.sample_rate,
      self.analysis_average_sec,
    );
    if let (Some(state), Some(projection)) = (&mut self.secondary, secondary_projection) {
      state.consume(
        x,
        y,
        projection,
        self.sample_rate,
        self.analysis_average_sec,
      );
    }
    true
  }

  pub(crate) fn output(&mut self, now_sec: f64) -> Option<SpectralOutput<'_>> {
    let secondary = match self.secondary.as_mut() {
      Some(state) => Some(state.output(
        &self.grid,
        &self.weighting,
        self.attack_ms,
        self.release_ms,
        self.peak_hold_sec,
        self.peak_decay_db_per_sec,
        self.tilt_db_per_octave,
        self.octave_smoothing,
        now_sec,
      )?),
      None => None,
    };
    let primary = self.primary.output(
      &self.grid,
      &self.weighting,
      self.attack_ms,
      self.release_ms,
      self.peak_hold_sec,
      self.peak_decay_db_per_sec,
      self.tilt_db_per_octave,
      self.octave_smoothing,
      now_sec,
    )?;

    Some(SpectralOutput {
      centers_hz: self.grid.freqs(),
      smooth_db: primary.smooth_db,
      peak_db: primary.peak_db,
      secondary,
    })
  }

  #[cfg(test)]
  pub(crate) fn state_snapshot_for_test(&self) -> SpectralConsumerStateSnapshot {
    let curve_snapshot = |state: &CurveState| SpectralCurveStateSnapshot {
      ema_initialized: [
        state.big.initialized,
        state.mid.initialized,
        state.small.initialized,
      ],
      psd: [
        state.big.psd.clone(),
        state.mid.psd.clone(),
        state.small.psd.clone(),
      ],
      smooth_db: state.smooth_db.clone(),
      peak_db: state.peak_db.clone(),
      peak_hold_until: state.peak_hold_until.clone(),
      envelope_last_time: state.last_time_sec,
    };
    let primary = curve_snapshot(&self.primary);
    SpectralConsumerStateSnapshot {
      state_epoch: self.state_epoch,
      ema_initialized: primary.ema_initialized,
      envelope_last_time: self.primary.last_time_sec,
      peak_hold_len: self.primary.peak_hold_until.len(),
      peak_hold_max_until: self
        .primary
        .peak_hold_until
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max),
      primary,
      secondary: self.secondary.as_ref().map(curve_snapshot),
    }
  }

  #[cfg(test)]
  pub(crate) fn centers_for_test(&self) -> &[f64] {
    self.grid.freqs()
  }

  #[cfg(test)]
  fn psd_for_test(&self, fft_size: usize, secondary: bool) -> &[f64] {
    if secondary {
      self
        .secondary
        .as_ref()
        .map(|state| state.psd(fft_size))
        .unwrap_or_default()
    } else {
      self.primary.psd(fft_size)
    }
  }
}

#[cfg(test)]
#[derive(Clone)]
pub(crate) struct SpectralConsumerStateSnapshot {
  pub(crate) state_epoch: u64,
  pub(crate) ema_initialized: [bool; 3],
  pub(crate) envelope_last_time: f64,
  pub(crate) peak_hold_len: usize,
  pub(crate) peak_hold_max_until: f64,
  pub(crate) primary: SpectralCurveStateSnapshot,
  pub(crate) secondary: Option<SpectralCurveStateSnapshot>,
}

#[cfg(test)]
#[derive(Clone)]
pub(crate) struct SpectralCurveStateSnapshot {
  pub(crate) ema_initialized: [bool; 3],
  pub(crate) psd: [Vec<f64>; 3],
  pub(crate) smooth_db: Vec<f64>,
  pub(crate) peak_db: Vec<f64>,
  pub(crate) peak_hold_until: Vec<f64>,
  pub(crate) envelope_last_time: f64,
}

#[cfg(test)]
mod tests {
  use super::{
    projected_power, CurveProjection, SpectralConsumer, SpectralProjection, SLOPE_PIVOT_HZ,
  };
  use crate::dsp::spectral_transform::{ComplexSpectralFrame, SpectralTransform};
  use crate::dsp::spectrum::SpectrumMeter;
  use crate::dsp::spectrum_bank::{
    box_average_into, OctaveSmoothing, SpectrumGrid, CAL_OFFSET_DB, FFT_BIG, FFT_MID, FFT_SMALL,
    OVERLAP_BIG, OVERLAP_MID, OVERLAP_SMALL,
  };
  use rustfft::num_complex::Complex32;

  const SR: f64 = 48_000.0;

  fn bins(fft_size: usize, magnitude: f32) -> Vec<Complex32> {
    vec![Complex32::new(magnitude, 0.0); fft_size / 2 + 1]
  }

  fn consume(
    consumer: &mut SpectralConsumer,
    fft_size: usize,
    sample_clock: u64,
    bins: &[Complex32],
  ) {
    consumer.consume(&ComplexSpectralFrame {
      fft_size,
      sample_clock,
      bins,
    });
  }

  fn overlap(fft_size: usize) -> usize {
    match fft_size {
      FFT_BIG => OVERLAP_BIG,
      FFT_MID => OVERLAP_MID,
      FFT_SMALL => OVERLAP_SMALL,
      _ => panic!("unexpected FFT size"),
    }
  }

  fn feed_transforms(
    consumer: &mut SpectralConsumer,
    transforms: &mut [SpectralTransform; 3],
    samples: &[f32],
  ) {
    for &sample in samples {
      for transform in transforms.iter_mut() {
        if let Some(frame) = transform.push_sample(sample) {
          consumer.consume(&frame);
        }
      }
    }
  }

  fn new_transforms() -> [SpectralTransform; 3] {
    [
      SpectralTransform::new(FFT_BIG, OVERLAP_BIG, 0),
      SpectralTransform::new(FFT_MID, OVERLAP_MID, 0),
      SpectralTransform::new(FFT_SMALL, OVERLAP_SMALL, 0),
    ]
  }

  fn consume_uniform_level(
    consumer: &mut SpectralConsumer,
    magnitude: f32,
    clock_multiplier: usize,
  ) {
    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let frame_bins = bins(fft_size, magnitude);
      consume(
        consumer,
        fft_size,
        (fft_size / overlap(fft_size) * clock_multiplier) as u64,
        &frame_bins,
      );
    }
  }

  fn expected_uniform_linear_row(magnitudes: [f64; 3]) -> Vec<f64> {
    let grid = SpectrumGrid::new(SR, 20.0, 20_000.0);
    let [big, mid, small] = magnitudes;
    let big = vec![big; FFT_BIG / 2 + 1];
    let mid = vec![mid; FFT_MID / 2 + 1];
    let small = vec![small; FFT_SMALL / 2 + 1];
    let mut row = Vec::new();
    grid.linear_row_into(&big, &mid, &small, &mut row);
    row
  }

  fn independent_attack_release(speed_percent: f64) -> (f64, f64) {
    let percent = speed_percent.clamp(0.0, 100.0);
    if percent <= 0.0 {
      return (0.0, 0.0);
    }
    let normalized = percent / 100.0;
    let exponent = (15.0_f64.log10() / 200.0_f64.log10()).ln() / 0.5_f64.ln();
    let release_ms = 10.0 * 200.0_f64.powf(normalized.powf(exponent));
    (release_ms * 0.2, release_ms)
  }

  fn assert_exhaustive_speed_behavior(speeds: impl IntoIterator<Item = i32>) {
    for speed in speeds {
      let speed = speed as f64;
      let mut consumer = SpectralConsumer::new(SR, 20.0, 20_000.0);
      consumer.set_display_controls(speed, 0.0, OctaveSmoothing::Off);
      consume_uniform_level(&mut consumer, 0.8, 1);
      let initial = consumer.output(1.0).expect("initial speed output");
      let initial = initial.smooth_db.to_vec();

      consume_uniform_level(&mut consumer, 0.2, 2);
      let average_sec = 0.150 * speed / 100.0;
      let expected_psd = [FFT_BIG, FFT_MID, FFT_SMALL].map(|fft_size| {
        let bin_width = SR / fft_size as f64;
        let first = (0.8_f32 as f64).powi(2) / bin_width;
        let second = (0.2_f32 as f64).powi(2) / bin_width;
        let hop_sec = (fft_size / overlap(fft_size)) as f64 / SR;
        let alpha = if average_sec <= 0.0 {
          1.0
        } else {
          1.0 - (-hop_sec / average_sec).exp()
        };
        first + (second - first) * alpha
      });
      for (fft_size, expected) in [FFT_BIG, FFT_MID, FFT_SMALL].into_iter().zip(expected_psd) {
        assert!(consumer
          .psd_for_test(fft_size, false)
          .iter()
          .all(|actual| (*actual - expected).abs() < 1e-15));
      }

      let incoming: Vec<_> = expected_uniform_linear_row(expected_psd)
        .into_iter()
        .map(|power| 10.0 * power.max(1e-20).log10() + CAL_OFFSET_DB)
        .collect();
      let (_, release_ms) = independent_attack_release(speed);
      let release_alpha = if speed <= 0.0 {
        1.0
      } else {
        1.0 - (-0.1 / (release_ms / 1000.0).max(0.001)).exp()
      };
      let expected_smooth: Vec<_> = initial
        .iter()
        .zip(&incoming)
        .map(|(&previous, &next)| previous + (next - previous) * release_alpha)
        .collect();
      let output = consumer.output(1.1).expect("second speed output");
      assert_rows_close(
        output.smooth_db,
        &expected_smooth,
        &format!("UI speed {speed}"),
      );

      let mut attack_consumer = SpectralConsumer::new(SR, 20.0, 20_000.0);
      attack_consumer.set_display_controls(speed, 0.0, OctaveSmoothing::Off);
      consume_uniform_level(&mut attack_consumer, 0.2, 1);
      let attack_initial = attack_consumer
        .output(1.0)
        .expect("initial attack output")
        .smooth_db
        .to_vec();
      consume_uniform_level(&mut attack_consumer, 0.8, 2);
      let attack_psd = [FFT_BIG, FFT_MID, FFT_SMALL].map(|fft_size| {
        let bin_width = SR / fft_size as f64;
        let first = (0.2_f32 as f64).powi(2) / bin_width;
        let second = (0.8_f32 as f64).powi(2) / bin_width;
        let hop_sec = (fft_size / overlap(fft_size)) as f64 / SR;
        let alpha = if average_sec <= 0.0 {
          1.0
        } else {
          1.0 - (-hop_sec / average_sec).exp()
        };
        first + (second - first) * alpha
      });
      let attack_incoming: Vec<_> = expected_uniform_linear_row(attack_psd)
        .into_iter()
        .map(|power| 10.0 * power.max(1e-20).log10() + CAL_OFFSET_DB)
        .collect();
      let (attack_ms, _) = independent_attack_release(speed);
      let attack_alpha = if speed <= 0.0 {
        1.0
      } else {
        1.0 - (-0.1 / (attack_ms / 1000.0).max(0.001)).exp()
      };
      let expected_attack: Vec<_> = attack_initial
        .iter()
        .zip(&attack_incoming)
        .map(|(&previous, &next)| previous + (next - previous) * attack_alpha)
        .collect();
      let attack_output = attack_consumer.output(1.1).expect("second attack output");
      assert_rows_close(
        attack_output.smooth_db,
        &expected_attack,
        &format!("UI speed {speed} attack"),
      );
    }
  }

  fn output_for_tilt(tilt: f64) -> (Vec<f64>, Vec<f64>) {
    let mut consumer = SpectralConsumer::new(SR, 20.0, 20_000.0);
    consumer.set_display_controls(0.0, tilt, OctaveSmoothing::Off);
    consume_uniform_level(&mut consumer, 0.5, 1);
    let output = consumer.output(1.0).expect("tilt output");
    (output.centers_hz.to_vec(), output.smooth_db.to_vec())
  }

  fn assert_exhaustive_tilt_behavior(tilts: impl IntoIterator<Item = f64>) {
    let (centers, baseline) = output_for_tilt(0.0);
    for tilt in tilts {
      let (actual_centers, actual) = output_for_tilt(tilt);
      assert_eq!(actual_centers, centers);
      let expected: Vec<_> = baseline
        .iter()
        .zip(&centers)
        .map(|(&base, &frequency)| base + tilt * (frequency.log2() - SLOPE_PIVOT_HZ.log2()))
        .collect();
      assert_rows_close(&actual, &expected, &format!("UI tilt {tilt:.2}"));
    }
  }

  fn patterned_bins(fft_size: usize) -> Vec<Complex32> {
    (0..=fft_size / 2)
      .map(|index| {
        let magnitude = 0.05 + (index % 29) as f32 / 37.0;
        Complex32::new(magnitude, magnitude * 0.125)
      })
      .collect()
  }

  fn assert_exhaustive_smoothing_behavior(smoothings: impl IntoIterator<Item = OctaveSmoothing>) {
    let grid = SpectrumGrid::new(SR, 20.0, 20_000.0);
    let frame_bins = [
      patterned_bins(FFT_BIG),
      patterned_bins(FFT_MID),
      patterned_bins(FFT_SMALL),
    ];
    let psd: [Vec<f64>; 3] = std::array::from_fn(|index| {
      let fft_size = [FFT_BIG, FFT_MID, FFT_SMALL][index];
      let bin_width = SR / fft_size as f64;
      frame_bins[index]
        .iter()
        .map(|bin| {
          let magnitude = (bin.re * bin.re + bin.im * bin.im).sqrt() as f64;
          magnitude.powi(2) / bin_width
        })
        .collect()
    });
    let mut linear = Vec::new();
    grid.linear_row_into(&psd[0], &psd[1], &psd[2], &mut linear);

    for smoothing in smoothings {
      let mut consumer = SpectralConsumer::new(SR, 20.0, 20_000.0);
      consumer.set_display_controls(0.0, 0.0, smoothing);
      for (index, fft_size) in [FFT_BIG, FFT_MID, FFT_SMALL].into_iter().enumerate() {
        consume(
          &mut consumer,
          fft_size,
          (fft_size / overlap(fft_size)) as u64,
          &frame_bins[index],
        );
      }
      let expected_linear = if let Some(half) = smoothing.half_width_points() {
        let mut smoothed = Vec::new();
        box_average_into(&linear, half, &mut smoothed);
        smoothed
      } else {
        linear.clone()
      };
      let expected: Vec<_> = expected_linear
        .into_iter()
        .map(|power| 10.0 * power.max(1e-20).log10() + CAL_OFFSET_DB)
        .collect();
      let output = consumer.output(1.0).expect("smoothing output");
      assert_rows_close(
        output.smooth_db,
        &expected,
        &format!("UI smoothing {smoothing:?}"),
      );
    }
  }

  fn noise(samples: usize) -> Vec<f32> {
    let mut state = 0x1234_5678_u32;
    (0..samples)
      .map(|_| {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        ((state >> 8) as f32 / 8_388_608.0) - 1.0
      })
      .collect()
  }

  fn assert_rows_close(actual: &[f64], expected: &[f64], context: &str) {
    assert_eq!(actual.len(), expected.len(), "{context} length");
    for (i, (&actual, &expected)) in actual.iter().zip(expected).enumerate() {
      assert!(
        (actual - expected).abs() < 1e-9,
        "{context}[{i}]: actual={actual}, expected={expected}"
      );
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

  #[test]
  fn projection_power_preserves_complex_cross_terms_for_deterministic_pairs() {
    let cases = [
      (
        "in-phase equal",
        Complex32::new(1.0, 0.0),
        Complex32::new(1.0, 0.0),
        [1.0, 0.0],
      ),
      (
        "anti-phase equal",
        Complex32::new(1.0, 0.0),
        Complex32::new(-1.0, 0.0),
        [0.0, 1.0],
      ),
      (
        "unequal in-phase",
        Complex32::new(1.0, 0.0),
        Complex32::new(0.5, 0.0),
        [0.5625, 0.0625],
      ),
      (
        "hard-panned",
        Complex32::new(1.0, 0.0),
        Complex32::new(0.0, 0.0),
        [0.25, 0.25],
      ),
      (
        "quadrature",
        Complex32::new(1.0, 0.0),
        Complex32::new(0.0, 1.0),
        [0.5, 0.5],
      ),
    ];

    for (name, x, y, [mid, side]) in cases {
      for (label, actual, expected) in [
        (
          "first",
          projected_power(x, y, CurveProjection::First),
          x.norm_sqr() as f64,
        ),
        (
          "second",
          projected_power(x, y, CurveProjection::Second),
          y.norm_sqr() as f64,
        ),
        (
          "combined",
          projected_power(x, y, CurveProjection::Combined),
          mid,
        ),
        ("mid", projected_power(x, y, CurveProjection::Mid), mid),
        ("side", projected_power(x, y, CurveProjection::Side), side),
      ] {
        assert!(
          (actual - expected).abs() < 1e-7,
          "{name} {label}: actual={actual}, expected={expected}"
        );
      }
    }
  }

  #[test]
  fn projection_consumer_applies_half_scale_before_power_and_exposes_expected_curves() {
    let bin_width = SR / FFT_SMALL as f64;
    let x = bins(FFT_SMALL, 1.0);
    let y = bins(FFT_SMALL, -1.0);
    let clock = (FFT_SMALL / OVERLAP_SMALL) as u64;

    for (projection, primary, secondary) in [
      (SpectralProjection::Single, 1.0_f64, None),
      (SpectralProjection::Combined, 0.0_f64, None),
      (SpectralProjection::Lr, 1.0_f64, Some(1.0_f64)),
      (SpectralProjection::Ms, 0.0_f64, Some(1.0_f64)),
    ] {
      let mut consumer = SpectralConsumer::new_projected(SR, 20.0, 20_000.0, projection);
      assert!(consumer.consume_aligned(
        &frame(FFT_SMALL, clock, &x),
        Some(&frame(FFT_SMALL, clock, &y))
      ));
      assert_eq!(
        consumer.psd_for_test(FFT_SMALL, false)[0],
        primary.max(1e-24) / bin_width,
        "{projection:?} primary"
      );
      assert_eq!(
        consumer.psd_for_test(FFT_SMALL, true).first().copied(),
        secondary.map(|power| power / bin_width),
        "{projection:?} secondary"
      );
    }
  }

  #[test]
  fn projection_rejects_misaligned_frames_without_mutating_averages() {
    let mut consumer =
      SpectralConsumer::new_projected(SR, 20.0, 20_000.0, SpectralProjection::Combined);
    let x = bins(FFT_SMALL, 1.0);
    let y = bins(FFT_SMALL, 1.0);
    let clock = (FFT_SMALL / OVERLAP_SMALL) as u64;

    assert!(!consumer.consume_aligned(
      &frame(FFT_SMALL, clock, &x),
      Some(&frame(FFT_SMALL, clock + 1, &y))
    ));
    let unsupported_x = bins(8, 1.0);
    let unsupported_y = bins(8, 1.0);
    assert!(!consumer.consume_aligned(
      &frame(8, clock, &unsupported_x),
      Some(&frame(8, clock, &unsupported_y))
    ));
    assert!(consumer.psd_for_test(FFT_SMALL, false).is_empty());
  }

  #[test]
  fn projection_pair_curves_keep_independent_averages_and_envelopes() {
    let mut consumer = SpectralConsumer::new_projected(SR, 20.0, 20_000.0, SpectralProjection::Lr);
    consumer.set_display_controls(100.0, 0.0, OctaveSmoothing::Off);

    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let hop = fft_size / overlap(fft_size);
      let loud = bins(fft_size, 0.9);
      let quiet = bins(fft_size, 0.1);
      assert!(consumer.consume_aligned(
        &frame(fft_size, hop as u64, &loud),
        Some(&frame(fft_size, hop as u64, &quiet))
      ));
      assert!(consumer.consume_aligned(
        &frame(fft_size, (hop * 2) as u64, &quiet),
        Some(&frame(fft_size, (hop * 2) as u64, &loud))
      ));
    }

    assert!(
      consumer.psd_for_test(FFT_MID, false)[0] > consumer.psd_for_test(FFT_MID, true)[0],
      "each curve must retain its own EMA history"
    );
    let output = consumer.output(1.0).expect("pair output");
    let secondary = output.secondary.expect("L/R secondary");
    assert_ne!(output.smooth_db, secondary.smooth_db);
    assert_ne!(output.peak_db, secondary.peak_db);
  }

  #[test]
  fn projection_output_matches_legacy_time_domain_mixing() {
    use crate::dsp::{SpectrumChannelSel, SpectrumView};

    let samples = FFT_BIG * 6;
    let mut x_state = 0x1234_5678_u32;
    let mut y_state = 0x8765_4321_u32;
    let x: Vec<f32> = (0..samples)
      .map(|_| {
        x_state = x_state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        ((x_state >> 8) as f32 / 8_388_608.0) - 1.0
      })
      .collect();
    let y: Vec<f32> = (0..samples)
      .map(|_| {
        y_state = y_state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        ((y_state >> 8) as f32 / 8_388_608.0) - 1.0
      })
      .collect();
    let mut interleaved = Vec::with_capacity(samples * 2);
    for (&left, &right) in x.iter().zip(&y) {
      interleaved.extend_from_slice(&[left, right]);
    }

    for (projection, selection, view) in [
      (
        SpectralProjection::Single,
        SpectrumChannelSel::Single(0),
        SpectrumView::Combined,
      ),
      (
        SpectralProjection::Combined,
        SpectrumChannelSel::Pair(0, 1),
        SpectrumView::Combined,
      ),
      (
        SpectralProjection::Lr,
        SpectrumChannelSel::Pair(0, 1),
        SpectrumView::Lr,
      ),
      (
        SpectralProjection::Ms,
        SpectrumChannelSel::Pair(0, 1),
        SpectrumView::Ms,
      ),
    ] {
      let mut consumer = SpectralConsumer::new_projected(SR, 20.0, 20_000.0, projection);
      consumer.set_display_controls(0.0, 0.0, OctaveSmoothing::Off);
      let mut x_transforms = new_transforms();
      let mut y_transforms = new_transforms();
      for (&left, &right) in x.iter().zip(&y) {
        for resolution in 0..3 {
          let left_frame = x_transforms[resolution].push_sample(left);
          let right_frame = y_transforms[resolution].push_sample(right);
          match (left_frame, right_frame) {
            (Some(left_frame), Some(right_frame)) => {
              assert!(consumer.consume_aligned(&left_frame, Some(&right_frame)));
            }
            (None, None) => {}
            _ => panic!("aligned transforms emitted at different clocks"),
          }
        }
      }
      let output = consumer.output(1.0).expect("projected output");

      let mut legacy = SpectrumMeter::new(SR);
      legacy.set_display_controls(0.0, 0.0, OctaveSmoothing::Off);
      legacy.push_pair(&interleaved, 2, 1.0, selection, view);
      let (legacy_centers, legacy_smooth, legacy_peak) = legacy.last_output();
      assert_eq!(
        output.centers_hz.len(),
        legacy_centers.len(),
        "{projection:?} frequency grid length"
      );
      assert_eq!(
        output.smooth_db.len(),
        output.centers_hz.len(),
        "{projection:?} primary smooth/grid length"
      );
      assert_eq!(
        output.peak_db.len(),
        output.centers_hz.len(),
        "{projection:?} primary peak/grid length"
      );
      assert_eq!(
        output.smooth_db.len(),
        output.peak_db.len(),
        "{projection:?} primary smooth/peak length"
      );
      assert_eq!(
        legacy_smooth.len(),
        legacy_centers.len(),
        "{projection:?} legacy primary smooth/grid length"
      );
      assert_eq!(
        legacy_peak.len(),
        legacy_centers.len(),
        "{projection:?} legacy primary peak/grid length"
      );
      assert_eq!(
        legacy_smooth.len(),
        legacy_peak.len(),
        "{projection:?} legacy primary smooth/peak length"
      );
      assert_eq!(
        output.smooth_db.len(),
        legacy_smooth.len(),
        "{projection:?} primary smooth reference length"
      );
      assert_eq!(
        output.peak_db.len(),
        legacy_peak.len(),
        "{projection:?} primary peak reference length"
      );
      for (actual, expected) in output.smooth_db.iter().zip(legacy_smooth) {
        assert!(
          (actual - expected).abs() < 1e-5,
          "{projection:?} primary smooth: {actual} vs {expected}"
        );
      }
      for (actual, expected) in output.peak_db.iter().zip(legacy_peak) {
        assert!(
          (actual - expected).abs() < 1e-5,
          "{projection:?} primary peak: {actual} vs {expected}"
        );
      }

      let legacy_secondary = legacy.last_output_secondary();
      let expects_secondary = matches!(projection, SpectralProjection::Lr | SpectralProjection::Ms);
      assert_eq!(
        output.secondary.is_some(),
        expects_secondary,
        "{projection:?} projected secondary presence"
      );
      assert_eq!(
        legacy_secondary.is_some(),
        expects_secondary,
        "{projection:?} legacy secondary presence"
      );
      match (output.secondary, legacy_secondary) {
        (None, None) => {}
        (Some(actual), Some((legacy_smooth, legacy_peak))) => {
          assert_eq!(
            actual.smooth_db.len(),
            output.centers_hz.len(),
            "{projection:?} secondary smooth/grid length"
          );
          assert_eq!(
            actual.peak_db.len(),
            output.centers_hz.len(),
            "{projection:?} secondary peak/grid length"
          );
          assert_eq!(
            actual.smooth_db.len(),
            actual.peak_db.len(),
            "{projection:?} secondary smooth/peak length"
          );
          assert_eq!(
            legacy_smooth.len(),
            legacy_centers.len(),
            "{projection:?} legacy secondary smooth/grid length"
          );
          assert_eq!(
            legacy_peak.len(),
            legacy_centers.len(),
            "{projection:?} legacy secondary peak/grid length"
          );
          assert_eq!(
            legacy_smooth.len(),
            legacy_peak.len(),
            "{projection:?} legacy secondary smooth/peak length"
          );
          assert_eq!(
            actual.smooth_db.len(),
            legacy_smooth.len(),
            "{projection:?} secondary smooth reference length"
          );
          assert_eq!(
            actual.peak_db.len(),
            legacy_peak.len(),
            "{projection:?} secondary peak reference length"
          );
          for (actual, expected) in actual.smooth_db.iter().zip(legacy_smooth) {
            assert!(
              (actual - expected).abs() < 1e-5,
              "{projection:?} secondary smooth: {actual} vs {expected}"
            );
          }
          for (actual, expected) in actual.peak_db.iter().zip(legacy_peak) {
            assert!(
              (actual - expected).abs() < 1e-5,
              "{projection:?} secondary peak: {actual} vs {expected}"
            );
          }
        }
        _ => panic!("{projection:?} secondary semantics differ from legacy"),
      }
    }
  }

  #[test]
  fn first_frame_initializes_each_resolution_to_legacy_psd_exactly() {
    let mut consumer = SpectralConsumer::new(SR, 20.0, 20_000.0);

    for (fft_size, magnitude) in [
      (FFT_BIG, 0.125_f32),
      (FFT_MID, 0.25_f32),
      (FFT_SMALL, 0.5_f32),
    ] {
      let frame_bins = bins(fft_size, magnitude);
      consume(
        &mut consumer,
        fft_size,
        (fft_size / overlap(fft_size)) as u64,
        &frame_bins,
      );
      let expected = (magnitude as f64).powi(2) / (SR / fft_size as f64);
      assert!(
        consumer
          .psd_for_test(fft_size, false)
          .iter()
          .all(|&actual| actual == expected),
        "first {fft_size}-point frame must initialize directly to PSD"
      );
    }
  }

  #[test]
  fn zero_speed_uses_alpha_one_without_hidden_average() {
    let mut consumer = SpectralConsumer::new(SR, 20.0, 20_000.0);
    consumer.set_display_controls(0.0, 0.0, OctaveSmoothing::Off);

    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let hop = fft_size / overlap(fft_size);
      let first = bins(fft_size, 0.75);
      let second = bins(fft_size, 0.2);
      consume(&mut consumer, fft_size, hop as u64, &first);
      consume(&mut consumer, fft_size, (hop * 2) as u64, &second);
      let bin_width = SR / fft_size as f64;
      let first_psd = (0.75_f32 as f64).powi(2) / bin_width;
      let second_psd = (0.2_f32 as f64).powi(2) / bin_width;
      let expected = first_psd + (second_psd - first_psd);
      assert!(
        consumer
          .psd_for_test(fft_size, false)
          .iter()
          .all(|&actual| actual == expected),
        "zero speed retained a hidden {fft_size}-point average"
      );
    }
  }

  #[test]
  fn nonzero_speed_ema_uses_each_resolution_hop_duration() {
    let mut consumer = SpectralConsumer::new(SR, 20.0, 20_000.0);
    consumer.set_display_controls(50.0, 0.0, OctaveSmoothing::Off);
    let average_sec = 0.075;

    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let hop = fft_size / overlap(fft_size);
      let first = bins(fft_size, 0.8);
      let second = bins(fft_size, 0.1);
      consume(&mut consumer, fft_size, hop as u64, &first);
      consume(&mut consumer, fft_size, (hop * 2) as u64, &second);

      let bin_width = SR / fft_size as f64;
      let first_psd = (0.8_f32 as f64).powi(2) / bin_width;
      let second_psd = (0.1_f32 as f64).powi(2) / bin_width;
      let alpha = 1.0 - (-(hop as f64 / SR) / average_sec).exp();
      let expected = first_psd + (second_psd - first_psd) * alpha;
      for &actual in consumer.psd_for_test(fft_size, false) {
        assert!(
          (actual - expected).abs() < 1e-15,
          "{fft_size}-point EMA used the wrong hop alpha: actual={actual}, expected={expected}"
        );
      }
    }
  }

  #[test]
  fn single_curve_display_pipeline_matches_legacy_order() {
    let first = noise(FFT_BIG * 6);
    let silence = vec![0.0_f32; (SR * 0.500) as usize];

    let mut legacy = SpectrumMeter::new(SR);
    legacy.set_display_controls(50.0, 2.0, OctaveSmoothing::OneSixth);
    let first_legacy = legacy
      .push_mono_duplex(&first, 1.0)
      .expect("legacy first output");

    let mut consumer = SpectralConsumer::new(SR, 20.0, 20_000.0);
    consumer.set_display_controls(50.0, 2.0, OctaveSmoothing::OneSixth);
    let mut transforms = new_transforms();
    feed_transforms(&mut consumer, &mut transforms, &first);
    let first_output = consumer.output(1.0).expect("consumer first output");
    assert_rows_close(first_output.smooth_db, &first_legacy.0, "first smooth");
    assert_rows_close(first_output.peak_db, &first_legacy.1, "first peak");
    // The legacy envelope initializes its peak timer on the update after first output.
    let armed_legacy = legacy
      .push_mono_duplex(&[], 1.01)
      .expect("legacy hold-arm output");
    let armed_output = consumer.output(1.01).expect("consumer hold-arm output");
    assert_rows_close(armed_output.smooth_db, &armed_legacy.0, "hold-arm smooth");
    assert_rows_close(armed_output.peak_db, &armed_legacy.1, "hold-arm peak");
    let peak_index = armed_legacy
      .1
      .iter()
      .enumerate()
      .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
      .map(|(index, _)| index)
      .unwrap();
    let held_peak = armed_legacy.1[peak_index];
    let mut first_decayed_peak = None;
    for (step, (now_sec, still_held)) in [(1.5, true), (2.4, true), (2.6, false), (2.85, false)]
      .into_iter()
      .enumerate()
    {
      let legacy_output = legacy
        .push_mono_duplex(&silence, now_sec)
        .expect("legacy silence output");
      feed_transforms(&mut consumer, &mut transforms, &silence);
      let output = consumer.output(now_sec).expect("consumer silence output");
      assert_rows_close(
        output.smooth_db,
        &legacy_output.0,
        &format!("silence step {step} smooth"),
      );
      assert_rows_close(
        output.peak_db,
        &legacy_output.1,
        &format!("silence step {step} peak"),
      );

      let peak = output.peak_db[peak_index];
      if still_held {
        assert_eq!(peak, held_peak, "peak changed before hold expired");
      } else if let Some(previous) = first_decayed_peak {
        assert!(
          peak < previous - 1.0,
          "peak must keep decaying after hold: previous={previous}, current={peak}"
        );
      } else {
        assert!(
          peak < held_peak - 1.0,
          "peak must decay after 1.5-second hold: held={held_peak}, current={peak}"
        );
        first_decayed_peak = Some(peak);
      }
    }

    let mut a_weighted = SpectralConsumer::new(SR, 20.0, 20_000.0);
    a_weighted.set_display_controls(50.0, 2.0, OctaveSmoothing::OneSixth);
    a_weighted.set_weighting("a");
    let mut a_transforms = new_transforms();
    feed_transforms(&mut a_weighted, &mut a_transforms, &first);
    let weighted = a_weighted.output(1.0).expect("weighted output");
    for ((&frequency, &z), &a) in weighted
      .centers_hz
      .iter()
      .zip(first_legacy.0.iter())
      .zip(weighted.smooth_db.iter())
    {
      let f2 = frequency.max(10.0).powi(2);
      let numerator = 12194.0_f64.powi(2) * f2 * f2;
      let denominator = (f2 + 20.6_f64.powi(2))
        * ((f2 + 107.7_f64.powi(2)) * (f2 + 737.9_f64.powi(2))).sqrt()
        * (f2 + 12194.0_f64.powi(2));
      let expected_a = 2.0 + 20.0 * (numerator / denominator).log10();
      assert!(
        (a - (z + expected_a)).abs() < 1e-9,
        "weighting must follow calibrated/smoothed dB at {frequency} Hz"
      );
    }
  }

  #[test]
  fn consumers_keep_independent_averages_and_envelopes() {
    let mut fast = SpectralConsumer::new(SR, 20.0, 20_000.0);
    fast.set_display_controls(0.0, 0.0, OctaveSmoothing::Off);
    let mut slow = SpectralConsumer::new(SR, 20.0, 20_000.0);
    slow.set_display_controls(100.0, 0.0, OctaveSmoothing::Off);

    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let hop = fft_size / overlap(fft_size);
      let loud = bins(fft_size, 0.8);
      let loud_frame = ComplexSpectralFrame {
        fft_size,
        sample_clock: hop as u64,
        bins: &loud,
      };
      fast.consume(&loud_frame);
      slow.consume(&loud_frame);
    }
    let fast_initial = fast.output(1.0).expect("fast initial output");
    let fast_initial = fast_initial.smooth_db.to_vec();
    let slow_initial = slow.output(1.0).expect("slow initial output");
    assert_rows_close(slow_initial.smooth_db, &fast_initial, "initial envelopes");

    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let hop = fft_size / overlap(fft_size);
      let quiet = bins(fft_size, 0.1);
      let quiet_frame = ComplexSpectralFrame {
        fft_size,
        sample_clock: (hop * 2) as u64,
        bins: &quiet,
      };
      fast.consume(&quiet_frame);
      slow.consume(&quiet_frame);
    }

    assert!(
      slow.psd_for_test(FFT_MID, false)[0] > fast.psd_for_test(FFT_MID, false)[0],
      "slow consumer average must not be overwritten by fast consumer"
    );
    let fast_output = fast.output(1.1).expect("fast output");
    let fast_smooth = fast_output.smooth_db.to_vec();
    let slow_output = slow.output(1.1).expect("slow output");
    assert!(
      slow_output.smooth_db[slow_output.smooth_db.len() / 2] > fast_smooth[fast_smooth.len() / 2],
      "consumers must own independent display envelopes"
    );
  }

  #[test]
  fn every_ui_speed_step_affects_ema_and_envelope_output_as_legacy_formulas_define() {
    // `PanelSettingsContent.jsx`: min=0, max=100, step=1.
    assert_exhaustive_speed_behavior(0..=100);
  }

  #[test]
  fn every_ui_tilt_step_affects_an_actual_postprocessed_output_row() {
    // `PanelSettingsContent.jsx`: min=0, max=6, step=0.25.
    assert_exhaustive_tilt_behavior((0..=24).map(|step| step as f64 * 0.25));
  }

  #[test]
  fn every_ui_octave_smoothing_value_affects_an_actual_postprocessed_output_row() {
    // `panelControls.js` exposes exactly these four wire values.
    assert_exhaustive_smoothing_behavior([
      OctaveSmoothing::Off,
      OctaveSmoothing::OneTwelfth,
      OctaveSmoothing::OneSixth,
      OctaveSmoothing::OneThird,
    ]);
  }
}
