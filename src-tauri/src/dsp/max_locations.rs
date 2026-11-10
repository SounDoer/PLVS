//! Opt-in file metadata. Never enabled by live capture constructors.
//! Does not change the arithmetic, padding or flushing of the underlying meters.

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricLocation {
  /// Source-relative frame coordinate; fractional (or negative) for FIR interpolation.
  /// M/S use the exclusive window end, not the index of its last sample.
  pub frame_position: f64,
  pub time_seconds: f64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPeakLocation {
  pub channel_index: u16,
  #[serde(flatten)]
  pub location: MetricLocation,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaximaLocations {
  pub sample_peak_max: Option<ChannelPeakLocation>,
  pub true_peak_max: Option<ChannelPeakLocation>,
  pub m_max_window_end: Option<MetricLocation>,
  pub st_max_window_end: Option<MetricLocation>,
}

impl MetricLocation {
  pub(crate) fn from_frame(frame_position: f64, sample_rate: f64) -> Self {
    Self {
      frame_position,
      time_seconds: frame_position / sample_rate,
    }
  }
}

#[derive(Clone, Copy, Default)]
struct LocatedPeak {
  value: f64,
  // Eighth-frame ticks exactly express the 4x FIR's half-output-sample group delay.
  ticks: Option<i128>,
}

impl LocatedPeak {
  fn observe(&mut self, value: f64, ticks: i128) {
    if value > self.value
      || (value > 0.0 && value == self.value && self.ticks.is_some_and(|old| ticks < old))
    {
      self.value = value;
      self.ticks = Some(ticks);
    }
  }

  fn location(self, sample_rate: f64) -> Option<MetricLocation> {
    self
      .ticks
      .filter(|_| self.value.is_finite())
      .map(|ticks| MetricLocation::from_frame(ticks as f64 / 8.0, sample_rate))
  }
}

/// Allocated once at file initialization. Constant memory per channel, no sample-loop allocation.
pub(crate) struct PeakLocationTracker {
  frames: u64,
  sample: Vec<LocatedPeak>,
  true_peak: Vec<LocatedPeak>,
}

impl PeakLocationTracker {
  pub(crate) fn new(channels: u16) -> Self {
    Self {
      frames: 0,
      sample: vec![LocatedPeak::default(); usize::from(channels.max(1))],
      true_peak: vec![LocatedPeak::default(); usize::from(channels.max(1))],
    }
  }

  pub(crate) fn sample(&mut self, channel: usize, value: f64) {
    if channel >= self.sample.len() {
      return;
    } // Mono's internal duplex channel is not a source channel.
    let ticks = i128::from(self.frames) * 8;
    self.sample[channel].observe(value.abs(), ticks);
    self.true_peak[channel].observe(value.abs(), ticks);
  }

  pub(crate) fn interpolated(
    &mut self,
    channel: usize,
    value: f64,
    phase: usize,
    taps: usize,
    phases: usize,
  ) {
    if channel >= self.true_peak.len() {
      return;
    }
    // y_phase[n] = sum h[phase + phases*k] x[n-k]. The prototype has group delay
    // (phases*taps - 1)/2 output samples: source coordinate n + phase/P - (P*T-1)/(2P).
    debug_assert_eq!(phases, 4);
    let ticks = i128::from(self.frames) * 8 + (phase * 2) as i128 - (phases * taps - 1) as i128;
    self.true_peak[channel].observe(value.abs(), ticks);
  }

  pub(crate) fn channels(&self) -> u16 {
    self.sample.len() as u16
  }

  pub(crate) fn end_frame(&mut self) {
    self.frames += 1;
  }

  pub(crate) fn annotate(
    &self,
    peaks: &mut [super::summary_meter::ChannelPeakMax],
    sample_rate: f64,
  ) {
    for (index, peak) in peaks.iter_mut().enumerate() {
      peak.sample_peak_max_location = self.sample[index].location(sample_rate);
      peak.true_peak_max_location = self.true_peak[index].location(sample_rate);
    }
  }

  pub(crate) fn maxima(
    &self,
    sample_rate: f64,
    windows: (Option<u64>, Option<u64>),
  ) -> MaximaLocations {
    let global = |peaks: &[LocatedPeak]| {
      peaks
        .iter()
        .enumerate()
        .filter(|(_, peak)| peak.value > 0.0)
        .min_by(|(ai, a), (bi, b)| {
          b.value
            .total_cmp(&a.value)
            .then_with(|| a.ticks.cmp(&b.ticks))
            .then_with(|| ai.cmp(bi))
        })
        .and_then(|(index, peak)| {
          peak
            .location(sample_rate)
            .map(|location| ChannelPeakLocation {
              channel_index: index as u16,
              location,
            })
        })
    };
    MaximaLocations {
      sample_peak_max: global(&self.sample),
      true_peak_max: global(&self.true_peak),
      m_max_window_end: windows
        .0
        .map(|frame| MetricLocation::from_frame(frame as f64, sample_rate)),
      st_max_window_end: windows
        .1
        .map(|frame| MetricLocation::from_frame(frame as f64, sample_rate)),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn position_tracking_uses_constant_preallocated_storage_and_no_sample_loop_allocations() {
    use crate::dsp::shared_spectral_engine::allocation_counter::count_current_thread_allocations;
    let mut peaks = PeakLocationTracker::new(10);
    let mut windows = crate::dsp::sliding_window::SlidingWindowMax::new(4_800);
    windows.enable_locations();
    let allocations = count_current_thread_allocations(|| {
      for frame in 0..1_003 {
        for channel in 0..10 {
          peaks.sample(channel, frame as f64 / 1_003.0);
          for phase in 1..4 {
            peaks.interpolated(channel, 0.75, phase, 32, 4);
          }
        }
        peaks.end_frame();
        windows.push_mode::<true>(0.5);
      }
    });
    assert_eq!(allocations, 0);
    assert_eq!(peaks.sample.len(), 10);
    assert_eq!(peaks.true_peak.len(), 10);
  }

  #[test]
  fn a_non_finite_global_maximum_does_not_borrow_a_finite_channels_location() {
    let mut tracker = PeakLocationTracker::new(2);
    tracker.sample(0, f64::INFINITY);
    tracker.sample(1, 0.5);
    let maxima = tracker.maxima(48_000.0, (None, None));
    assert_eq!(maxima.sample_peak_max, None);
    assert_eq!(maxima.true_peak_max, None);
  }

  #[test]
  fn sample_ties_use_earliest_source_frame_then_channel() {
    let mut tracker = PeakLocationTracker::new(3);
    tracker.sample(2, -0.5);
    tracker.end_frame();
    tracker.sample(0, 0.5);
    tracker.sample(2, 0.5);
    let result = tracker.maxima(48_000.0, (None, None));
    let peak = result.sample_peak_max.unwrap();
    assert_eq!(peak.channel_index, 2);
    assert_eq!(peak.location.frame_position, 0.0);
    tracker = PeakLocationTracker::new(3);
    tracker.sample(2, 0.5);
    tracker.sample(0, 0.5);
    assert_eq!(
      tracker
        .maxima(48_000.0, (None, None))
        .sample_peak_max
        .unwrap()
        .channel_index,
      0
    );
  }

  #[test]
  fn fir_phase_and_group_delay_map_to_source_coordinates() {
    for phase in 1..4 {
      let mut tracker = PeakLocationTracker::new(1);
      for _ in 0..20 {
        tracker.end_frame();
      }
      tracker.interpolated(0, 0.75, phase, 32, 4);
      let peak = tracker
        .maxima(48_000.0, (None, None))
        .true_peak_max
        .unwrap();
      assert_eq!(
        peak.location.frame_position,
        20.0 + phase as f64 / 4.0 - 15.875
      );
      assert_eq!(
        peak.location.time_seconds,
        peak.location.frame_position / 48_000.0
      );
    }
  }

  #[test]
  fn delayed_equal_peak_can_precede_an_already_observed_direct_sample() {
    let mut tracker = PeakLocationTracker::new(1);
    for _ in 0..16 {
      tracker.end_frame();
    }
    tracker.sample(0, 0.75); // Source frame 16 is seen first by the processor.
    tracker.interpolated(0, -0.75, 1, 32, 4); // Source frame 0.375 is earlier.
    tracker.interpolated(0, 0.75, 2, 32, 4);
    assert_eq!(
      tracker
        .maxima(48_000.0, (None, None))
        .true_peak_max
        .unwrap()
        .location
        .frame_position,
      0.375
    );
  }

  #[test]
  fn startup_padding_remains_signed_and_silence_has_no_location() {
    let mut tracker = PeakLocationTracker::new(1);
    tracker.sample(0, 0.0);
    assert_eq!(tracker.maxima(48_000.0, (None, None)).true_peak_max, None);
    for _ in 0..15 {
      tracker.end_frame();
    }
    tracker.interpolated(0, 1.25, 3, 32, 4);
    assert_eq!(
      tracker
        .maxima(48_000.0, (None, None))
        .true_peak_max
        .unwrap()
        .location
        .frame_position,
      -0.125
    );
  }
}
