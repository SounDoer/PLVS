#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};

use rustfft::num_complex::Complex32;

use super::spectral_transform::{ComplexSpectralFrame, SpectralTransform};
use super::spectral_waveform::{spectral_waveform_metric, SpectralWaveformMetric};
use super::spectrum_bank::OctaveSmoothing;
use super::spectrum_bank::{
  spectrum_frequency_bounds, FFT_BIG, FFT_MID, FFT_SMALL, OVERLAP_BIG, OVERLAP_MID, OVERLAP_SMALL,
};
use super::spectrum_consumer::{SpectralConsumer, SpectralProjection};
use super::stereo_map::{StereoMapConsumer, StereoMapPrimitiveRow};
use crate::engine::spectral_plan::{
  same_logical_consumer, ConsumerInput, ConsumerProjection, ProjectionKind,
  SpectralConsumerBinding, SpectralPlan, StereoMapConsumerBinding, TransformStreamId,
};

/// Monotonic time used only for spectrum display ballistics.
///
/// Keeping this distinct from media/checkpoint time prevents offline file positions from being
/// passed to peak-hold and envelope calculations during the shared-runtime cutover.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SpectralDspTime(f64);

impl SpectralDspTime {
  pub(crate) fn from_monotonic_seconds(seconds: f64) -> Self {
    debug_assert!(seconds.is_finite() && seconds >= 0.0);
    Self(seconds)
  }

  pub(crate) fn as_seconds(self) -> f64 {
    self.0
  }
}

/// Media timeline position used only to label file visual checkpoints.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SpectralCheckpointTime(u64);

impl SpectralCheckpointTime {
  pub(crate) fn from_media_millis(milliseconds: u64) -> Self {
    Self(milliseconds)
  }

  pub(crate) fn as_millis(self) -> u64 {
    self.0
  }
}

#[cfg(test)]
pub(crate) mod allocation_counter {
  use std::alloc::{GlobalAlloc, Layout, System};
  use std::cell::Cell;

  thread_local! {
    static ENABLED: Cell<bool> = const { Cell::new(false) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
  }

  pub(super) struct ThreadCountingAllocator;

  unsafe impl GlobalAlloc for ThreadCountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
      let pointer = unsafe { System.alloc(layout) };
      if !pointer.is_null() {
        record_allocation();
      }
      pointer
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
      let pointer = unsafe { System.alloc_zeroed(layout) };
      if !pointer.is_null() {
        record_allocation();
      }
      pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
      unsafe { System.dealloc(pointer, layout) };
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
      let new_pointer = unsafe { System.realloc(pointer, layout, new_size) };
      if !new_pointer.is_null() {
        record_allocation();
      }
      new_pointer
    }
  }

  fn record_allocation() {
    ENABLED.with(|enabled| {
      if enabled.get() {
        ALLOCATIONS.with(|allocations| allocations.set(allocations.get() + 1));
      }
    });
  }

  struct CountingGuard;

  impl Drop for CountingGuard {
    fn drop(&mut self) {
      ENABLED.with(|enabled| enabled.set(false));
    }
  }

  pub(crate) fn count_current_thread_allocations(run: impl FnOnce()) -> usize {
    ALLOCATIONS.with(|allocations| allocations.set(0));
    ENABLED.with(|enabled| enabled.set(true));
    let guard = CountingGuard;
    run();
    drop(guard);
    ALLOCATIONS.with(Cell::get)
  }
}

#[cfg(test)]
#[global_allocator]
static TEST_ALLOCATOR: allocation_counter::ThreadCountingAllocator =
  allocation_counter::ThreadCountingAllocator;

pub(crate) struct SharedSpectralFrame<'a> {
  pub stream_id: TransformStreamId,
  pub fft_size: usize,
  pub sample_clock: u64,
  pub all_three_ready: bool,
  pub bins: &'a [Complex32],
}

impl<'a> SharedSpectralFrame<'a> {
  pub(crate) fn as_complex(&self) -> ComplexSpectralFrame<'a> {
    ComplexSpectralFrame {
      fft_size: self.fft_size,
      sample_clock: self.sample_clock,
      bins: self.bins,
    }
  }
}

pub(crate) struct SharedSpectralFrameSet<'a> {
  sample_clock: u64,
  streams: &'a BTreeMap<TransformStreamId, StreamTransforms>,
}

impl SharedSpectralFrameSet<'_> {
  pub(crate) fn sample_clock(&self) -> u64 {
    self.sample_clock
  }

  pub(crate) fn frame(
    &self,
    stream_id: TransformStreamId,
    fft_size: usize,
  ) -> Option<SharedSpectralFrame<'_>> {
    self.frame_due(stream_id, fft_size)
  }

  fn frame_due(
    &self,
    stream_id: TransformStreamId,
    fft_size: usize,
  ) -> Option<SharedSpectralFrame<'_>> {
    let transforms = self.streams.get(&stream_id)?;
    let frame = match fft_size {
      FFT_BIG => transforms.big.as_ref()?.last_frame(),
      FFT_MID => transforms.mid.last_frame(),
      FFT_SMALL => transforms.small.as_ref()?.last_frame(),
      _ => None,
    }?;
    (frame.sample_clock == self.sample_clock).then_some(SharedSpectralFrame {
      stream_id,
      fft_size: frame.fft_size,
      sample_clock: frame.sample_clock,
      all_three_ready: transforms.all_three_ready(),
      bins: frame.bins,
    })
  }

  pub(crate) fn for_each_due(&self, mut visit: impl FnMut(SharedSpectralFrame<'_>)) {
    for stream_id in self.streams.keys().copied() {
      for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
        if let Some(frame) = self.frame(stream_id, fft_size) {
          visit(frame);
        }
      }
    }
  }

  fn has_due_frames(&self) -> bool {
    self.streams.keys().copied().any(|stream_id| {
      [FFT_BIG, FFT_MID, FFT_SMALL]
        .into_iter()
        .any(|fft_size| self.frame(stream_id, fft_size).is_some())
    })
  }
}

struct StreamTransforms {
  big: Option<SpectralTransform>,
  mid: SpectralTransform,
  small: Option<SpectralTransform>,
}

impl StreamTransforms {
  fn new(sample_clock: u64, full_resolution: bool) -> Self {
    Self {
      big: full_resolution.then(|| SpectralTransform::new(FFT_BIG, OVERLAP_BIG, sample_clock)),
      mid: SpectralTransform::new(FFT_MID, OVERLAP_MID, sample_clock),
      small: full_resolution
        .then(|| SpectralTransform::new(FFT_SMALL, OVERLAP_SMALL, sample_clock)),
    }
  }

  fn set_full_resolution(&mut self, enabled: bool, sample_clock: u64) {
    if enabled {
      self
        .big
        .get_or_insert_with(|| SpectralTransform::new(FFT_BIG, OVERLAP_BIG, sample_clock));
      self
        .small
        .get_or_insert_with(|| SpectralTransform::new(FFT_SMALL, OVERLAP_SMALL, sample_clock));
    } else {
      self.big = None;
      self.small = None;
    }
  }

  fn all_three_ready(&self) -> bool {
    self
      .big
      .as_ref()
      .is_some_and(|transform| transform.last_frame().is_some())
      && self.mid.last_frame().is_some()
      && self
        .small
        .as_ref()
        .is_some_and(|transform| transform.last_frame().is_some())
  }
}

pub(crate) struct SharedSpectralEngine {
  sample_clock: u64,
  streams: BTreeMap<TransformStreamId, StreamTransforms>,
  #[cfg(test)]
  fft_invocations: BTreeMap<(TransformStreamId, usize), u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SpectralFftTopology {
  pub(crate) stream_count: usize,
  transform_count_by_resolution: [usize; 3],
  pub(crate) total_transform_count: usize,
}

impl SpectralFftTopology {
  pub(crate) fn transform_count(&self, fft_size: usize) -> usize {
    match fft_size {
      FFT_BIG => self.transform_count_by_resolution[0],
      FFT_MID => self.transform_count_by_resolution[1],
      FFT_SMALL => self.transform_count_by_resolution[2],
      _ => 0,
    }
  }
}

impl SharedSpectralEngine {
  pub(crate) fn new() -> Self {
    Self {
      sample_clock: 0,
      streams: BTreeMap::new(),
      #[cfg(test)]
      fft_invocations: BTreeMap::new(),
    }
  }

  pub(crate) fn sample_clock(&self) -> u64 {
    self.sample_clock
  }

  pub(crate) fn fft_topology(&self) -> SpectralFftTopology {
    let stream_count = self.streams.len();
    let big_count = self
      .streams
      .values()
      .filter(|stream| stream.big.is_some())
      .count();
    let small_count = self
      .streams
      .values()
      .filter(|stream| stream.small.is_some())
      .count();
    SpectralFftTopology {
      stream_count,
      transform_count_by_resolution: [big_count, stream_count, small_count],
      total_transform_count: big_count + stream_count + small_count,
    }
  }

  pub(crate) fn update_streams(&mut self, desired: impl IntoIterator<Item = TransformStreamId>) {
    self.update_stream_needs(desired, []);
  }

  pub(crate) fn update_stream_needs(
    &mut self,
    full_resolution: impl IntoIterator<Item = TransformStreamId>,
    middle_resolution: impl IntoIterator<Item = TransformStreamId>,
  ) {
    let full_resolution: BTreeSet<_> = full_resolution.into_iter().collect();
    let desired: BTreeSet<_> = full_resolution
      .iter()
      .copied()
      .chain(middle_resolution)
      .collect();
    self
      .streams
      .retain(|stream_id, _| desired.contains(stream_id));
    for stream_id in desired {
      let transforms = self.streams.entry(stream_id).or_insert_with(|| {
        StreamTransforms::new(self.sample_clock, full_resolution.contains(&stream_id))
      });
      transforms.set_full_resolution(full_resolution.contains(&stream_id), self.sample_clock);
      #[cfg(test)]
      for fft_size in if full_resolution.contains(&stream_id) {
        [Some(FFT_BIG), Some(FFT_MID), Some(FFT_SMALL)]
      } else {
        [None, Some(FFT_MID), None]
      }
      .into_iter()
      .flatten()
      {
        self
          .fft_invocations
          .entry((stream_id, fft_size))
          .or_insert(0);
      }
    }
  }

  pub(crate) fn push_interleaved(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    mut visit: impl FnMut(SharedSpectralFrameSet<'_>),
  ) {
    let channels = channels.max(1) as usize;
    for pcm_frame in interleaved.chunks_exact(channels) {
      self.sample_clock = self.sample_clock.wrapping_add(1);

      for (stream_id, transforms) in &mut self.streams {
        let sample = match *stream_id {
          TransformStreamId::Physical(channel) => {
            pcm_frame.get(channel).copied().unwrap_or_default()
          }
          TransformStreamId::Projection {
            first,
            second,
            kind: ProjectionKind::Combined,
          } => {
            let first = pcm_frame.get(first).copied().unwrap_or_default();
            let second = pcm_frame.get(second).copied().unwrap_or_default();
            0.5 * (first + second)
          }
        };

        #[cfg(test)]
        {
          let emitted = [
            (
              FFT_BIG,
              transforms
                .big
                .as_mut()
                .is_some_and(|transform| transform.push_sample(sample).is_some()),
            ),
            (FFT_MID, transforms.mid.push_sample(sample).is_some()),
            (
              FFT_SMALL,
              transforms
                .small
                .as_mut()
                .is_some_and(|transform| transform.push_sample(sample).is_some()),
            ),
          ];
          for (fft_size, did_emit) in emitted {
            if did_emit {
              *self
                .fft_invocations
                .get_mut(&(*stream_id, fft_size))
                .expect("counter initialized with stream") += 1;
            }
          }
        }
        #[cfg(not(test))]
        {
          if let Some(transform) = transforms.big.as_mut() {
            let _ = transform.push_sample(sample);
          }
          let _ = transforms.mid.push_sample(sample);
          if let Some(transform) = transforms.small.as_mut() {
            let _ = transform.push_sample(sample);
          }
        }
      }

      let frames = SharedSpectralFrameSet {
        sample_clock: self.sample_clock,
        streams: &self.streams,
      };
      if frames.has_due_frames() {
        visit(frames);
      }
    }
  }

  #[cfg(test)]
  fn stream_count(&self) -> usize {
    self.streams.len()
  }

  #[cfg(test)]
  fn contains_stream(&self, stream_id: TransformStreamId) -> bool {
    self.streams.contains_key(&stream_id)
  }

  #[cfg(test)]
  fn fft_invocation_count(&self, stream_id: TransformStreamId, fft_size: usize) -> u64 {
    self
      .fft_invocations
      .get(&(stream_id, fft_size))
      .copied()
      .unwrap_or_default()
  }

  #[cfg(test)]
  fn total_fft_invocations(&self) -> u64 {
    self.fft_invocations.values().sum()
  }
}

struct RuntimeConsumer {
  binding: SpectralConsumerBinding,
  target: Option<SpectralConsumerBinding>,
  consumer: SpectralConsumer,
  identity: u64,
  consume_counts: [u64; 3],
  transition_generation: u64,
  last_switch_clock: Option<u64>,
}

impl RuntimeConsumer {
  fn new(binding: SpectralConsumerBinding, sample_rate: f64, identity: u64) -> Self {
    let (min_hz, max_hz) = spectrum_frequency_bounds(sample_rate);
    let mut consumer = SpectralConsumer::new_projected(
      sample_rate,
      min_hz,
      max_hz,
      spectral_projection(binding.projection),
    );
    apply_settings(&mut consumer, &binding);
    Self {
      binding,
      target: None,
      consumer,
      identity,
      consume_counts: [0; 3],
      transition_generation: 0,
      last_switch_clock: None,
    }
  }
}

fn spectral_projection(projection: ConsumerProjection) -> SpectralProjection {
  match projection {
    ConsumerProjection::Single => SpectralProjection::Single,
    ConsumerProjection::Combined => SpectralProjection::Combined,
    ConsumerProjection::Lr => SpectralProjection::Lr,
    ConsumerProjection::Ms => SpectralProjection::Ms,
  }
}

fn apply_settings(consumer: &mut SpectralConsumer, binding: &SpectralConsumerBinding) {
  consumer.set_display_controls(
    binding.settings.speed_percent,
    binding.settings.tilt_db_per_octave,
    octave_smoothing(&binding.settings.octave_smoothing),
  );
}

fn octave_smoothing(value: &str) -> OctaveSmoothing {
  match value {
    "1/12" => OctaveSmoothing::OneTwelfth,
    "1/6" => OctaveSmoothing::OneSixth,
    "1/3" => OctaveSmoothing::OneThird,
    _ => OctaveSmoothing::Off,
  }
}

struct RuntimeStereoMapConsumer {
  binding: StereoMapConsumerBinding,
  target: Option<StereoMapConsumerBinding>,
  consumer: StereoMapConsumer,
  ready: bool,
  consume_counts: [u64; 3],
}

impl RuntimeStereoMapConsumer {
  fn new(binding: StereoMapConsumerBinding, sample_rate: f64) -> Self {
    let mut consumer = StereoMapConsumer::for_sample_rate(sample_rate);
    consumer.set_display_controls(
      binding.speed_percent,
      octave_smoothing(&binding.octave_smoothing),
    );
    Self {
      binding,
      target: None,
      consumer,
      ready: false,
      consume_counts: [0; 3],
    }
  }
}

fn input_streams(input: ConsumerInput) -> impl Iterator<Item = TransformStreamId> {
  let streams = match input {
    ConsumerInput::Single(stream) => [Some(stream), None],
    ConsumerInput::Pair { first, second } => [Some(first), Some(second)],
  };
  streams.into_iter().flatten()
}

fn resolution_index(fft_size: usize) -> Option<usize> {
  match fft_size {
    FFT_BIG => Some(0),
    FFT_MID => Some(1),
    FFT_SMALL => Some(2),
    _ => None,
  }
}

fn input_is_ready(frames: &SharedSpectralFrameSet<'_>, input: ConsumerInput) -> bool {
  [FFT_BIG, FFT_MID, FFT_SMALL]
    .into_iter()
    .all(|fft_size| match input {
      ConsumerInput::Single(stream) => frames
        .frame(stream, fft_size)
        .is_some_and(|frame| frame.all_three_ready),
      ConsumerInput::Pair { first, second } => {
        let (Some(first), Some(second)) = (
          frames.frame(first, fft_size),
          frames.frame(second, fft_size),
        ) else {
          return false;
        };
        first.all_three_ready && second.all_three_ready && first.sample_clock == second.sample_clock
      }
    })
}

fn consume_input(
  state: &mut RuntimeConsumer,
  frames: &SharedSpectralFrameSet<'_>,
  input: ConsumerInput,
  fft_size: usize,
) {
  let consumed = match input {
    ConsumerInput::Single(stream) => frames.frame(stream, fft_size).is_some_and(|frame| {
      state.consumer.consume(&frame.as_complex());
      true
    }),
    ConsumerInput::Pair { first, second } => {
      let (Some(first), Some(second)) = (
        frames.frame(first, fft_size),
        frames.frame(second, fft_size),
      ) else {
        return;
      };
      state
        .consumer
        .consume_aligned(&first.as_complex(), Some(&second.as_complex()))
    }
  };
  if consumed {
    state.consume_counts[resolution_index(fft_size).expect("known resolution")] += 1;
  }
}

fn consume_stereo_map_input(
  state: &mut RuntimeStereoMapConsumer,
  frames: &SharedSpectralFrameSet<'_>,
  input: ConsumerInput,
  fft_size: usize,
) {
  let ConsumerInput::Pair { first, second } = input else {
    return;
  };
  let (Some(first), Some(second)) = (
    frames.frame(first, fft_size),
    frames.frame(second, fft_size),
  ) else {
    return;
  };
  let _ = state
    .consumer
    .consume_aligned(&first.as_complex(), &second.as_complex());
  state.consume_counts[resolution_index(fft_size).expect("known resolution")] += 1;
}

/// Owns request-keyed consumers and overlaps transform topologies until an atomic handoff.
pub(crate) struct SharedSpectralRuntime {
  sample_rate: f64,
  engine: SharedSpectralEngine,
  current_plan: SpectralPlan,
  desired_streams: Vec<TransformStreamId>,
  desired_waveform_streams: Vec<TransformStreamId>,
  consumers: BTreeMap<String, RuntimeConsumer>,
  stereo_map_consumers: BTreeMap<String, RuntimeStereoMapConsumer>,
  spectral_waveform_metrics: BTreeMap<usize, SpectralWaveformMetric>,
  next_identity: u64,
  #[cfg(test)]
  removed_consumer_counts: BTreeMap<String, [u64; 3]>,
}

impl SharedSpectralRuntime {
  pub(crate) fn new(sample_rate: f64) -> Self {
    Self {
      sample_rate,
      engine: SharedSpectralEngine::new(),
      current_plan: SpectralPlan {
        streams: Vec::new(),
        waveform_streams: Vec::new(),
        consumers: Vec::new(),
        stereo_map_consumers: Vec::new(),
      },
      desired_streams: Vec::new(),
      desired_waveform_streams: Vec::new(),
      consumers: BTreeMap::new(),
      stereo_map_consumers: BTreeMap::new(),
      spectral_waveform_metrics: BTreeMap::new(),
      next_identity: 1,
      #[cfg(test)]
      removed_consumer_counts: BTreeMap::new(),
    }
  }

  pub(crate) fn update_plan(&mut self, plan: SpectralPlan) {
    self.current_plan = plan.clone();
    let desired_keys: BTreeSet<_> = plan
      .consumers
      .iter()
      .map(|binding| binding.request_key.as_str())
      .collect();
    #[cfg(test)]
    for (key, state) in &self.consumers {
      if !desired_keys.contains(key.as_str()) {
        self
          .removed_consumer_counts
          .insert(key.clone(), state.consume_counts);
      }
    }
    self
      .consumers
      .retain(|key, _| desired_keys.contains(key.as_str()));

    for desired in plan.consumers {
      let key = desired.request_key.clone();
      match self.consumers.get_mut(&key) {
        Some(state)
          if {
            let mut identity_only = desired.clone();
            identity_only.settings = state.binding.settings.clone();
            same_logical_consumer(&state.binding, &identity_only)
          } =>
        {
          apply_settings(&mut state.consumer, &desired);
          let desired_source = (desired.input, desired.projection);
          let active_source = (state.binding.input, state.binding.projection);
          if desired_source == active_source {
            state.target = None;
            state.binding = desired;
          } else if state
            .target
            .as_ref()
            .is_none_or(|target| (target.input, target.projection) != desired_source)
          {
            state.target = Some(desired);
            state.transition_generation += 1;
          } else {
            state.target = Some(desired);
          }
        }
        Some(state) => {
          let identity = self.next_identity;
          self.next_identity += 1;
          *state = RuntimeConsumer::new(desired, self.sample_rate, identity);
        }
        None => {
          let identity = self.next_identity;
          self.next_identity += 1;
          self.consumers.insert(
            key,
            RuntimeConsumer::new(desired, self.sample_rate, identity),
          );
        }
      }
    }

    let desired_stereo_map_keys: BTreeSet<_> = plan
      .stereo_map_consumers
      .iter()
      .map(|binding| binding.request_key.as_str())
      .collect();
    self
      .stereo_map_consumers
      .retain(|key, _| desired_stereo_map_keys.contains(key.as_str()));
    for desired in plan.stereo_map_consumers {
      let key = desired.request_key.clone();
      match self.stereo_map_consumers.get_mut(&key) {
        Some(state) if state.binding.input == desired.input => {
          state.consumer.set_display_controls(
            desired.speed_percent,
            octave_smoothing(&desired.octave_smoothing),
          );
          state.target = None;
          state.binding = desired;
        }
        Some(state) => state.target = Some(desired),
        None => {
          self.stereo_map_consumers.insert(
            key,
            RuntimeStereoMapConsumer::new(desired, self.sample_rate),
          );
        }
      }
    }
    self.desired_streams = plan.streams;
    self.desired_waveform_streams = plan.waveform_streams;
    self.spectral_waveform_metrics.retain(|channel, _| {
      self
        .desired_streams
        .contains(&TransformStreamId::Physical(*channel))
    });
    self.refresh_engine_streams();
  }

  pub(crate) fn reset(&mut self) {
    self.rebuild(self.sample_rate);
  }

  pub(crate) fn fft_topology(&self) -> SpectralFftTopology {
    self.engine.fft_topology()
  }

  pub(crate) fn rebuild(&mut self, sample_rate: f64) {
    let plan = self.current_plan.clone();
    let next_identity = self.next_identity;
    *self = Self::new(sample_rate);
    self.next_identity = next_identity;
    self.update_plan(plan);
  }

  pub(crate) fn push_interleaved(&mut self, interleaved: &[f32], channels: u16) {
    let consumers = &mut self.consumers;
    let stereo_map_consumers = &mut self.stereo_map_consumers;
    let spectral_waveform_metrics = &mut self.spectral_waveform_metrics;
    let sample_rate = self.sample_rate;
    let mut switched = false;
    self
      .engine
      .push_interleaved(interleaved, channels, |frames| {
        frames.for_each_due(|frame| {
          if frame.fft_size != FFT_MID {
            return;
          }
          if let TransformStreamId::Physical(channel) = frame.stream_id {
            spectral_waveform_metrics.insert(
              channel,
              spectral_waveform_metric(frame.bins, frame.fft_size, sample_rate),
            );
          }
        });
        for state in consumers.values_mut() {
          if let Some(target) = state.target.as_ref() {
            if input_is_ready(&frames, target.input) {
              let target = state.target.take().expect("checked transition target");
              state
                .consumer
                .set_projection(spectral_projection(target.projection));
              for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
                consume_input(state, &frames, target.input, fft_size);
              }
              state.last_switch_clock = Some(frames.sample_clock());
              state.binding = target;
              switched = true;
              continue;
            }
          }
          for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
            consume_input(state, &frames, state.binding.input, fft_size);
          }
        }
        for state in stereo_map_consumers.values_mut() {
          if let Some(target) = state.target.as_ref() {
            if input_is_ready(&frames, target.input) {
              let target = state.target.take().expect("checked Stereo Map target");
              state.consumer.set_display_controls(
                target.speed_percent,
                octave_smoothing(&target.octave_smoothing),
              );
              for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
                consume_stereo_map_input(state, &frames, target.input, fft_size);
              }
              state.binding = target;
              state.ready = true;
              switched = true;
              continue;
            }
          }
          if !state.ready {
            if input_is_ready(&frames, state.binding.input) {
              for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
                consume_stereo_map_input(state, &frames, state.binding.input, fft_size);
              }
              state.ready = true;
            }
            continue;
          }
          for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
            consume_stereo_map_input(state, &frames, state.binding.input, fft_size);
          }
        }
      });
    if switched {
      self.refresh_engine_streams();
    }
  }

  fn refresh_engine_streams(&mut self) {
    let waveform_streams: BTreeSet<_> = self.desired_waveform_streams.iter().copied().collect();
    let mut full_resolution_streams: BTreeSet<_> = self
      .desired_streams
      .iter()
      .copied()
      .filter(|stream| !waveform_streams.contains(stream))
      .collect();
    for state in self.consumers.values() {
      full_resolution_streams.extend(input_streams(state.binding.input));
      if let Some(target) = &state.target {
        full_resolution_streams.extend(input_streams(target.input));
      }
    }
    for state in self.stereo_map_consumers.values() {
      full_resolution_streams.extend(input_streams(state.binding.input));
      if let Some(target) = &state.target {
        full_resolution_streams.extend(input_streams(target.input));
      }
    }
    self.engine.update_stream_needs(
      full_resolution_streams,
      self.desired_waveform_streams.iter().copied(),
    );
  }

  pub(crate) fn consumer_output_at_dsp_time(
    &mut self,
    key: &str,
    dsp_time: SpectralDspTime,
  ) -> Option<super::spectrum_consumer::SpectralOutput<'_>> {
    self
      .consumers
      .get_mut(key)?
      .consumer
      .output(dsp_time.as_seconds())
  }

  pub(crate) fn stereo_map_output(&mut self, key: &str) -> Option<&StereoMapPrimitiveRow> {
    self.stereo_map_consumers.get_mut(key)?.consumer.output()
  }

  pub(crate) fn spectral_waveform_metrics(
    &self,
    channel_count: usize,
  ) -> (Vec<f32>, Vec<f32>, Vec<f32>) {
    let mut dominant_frequency_hz = Vec::with_capacity(channel_count);
    let mut spectral_centroid_hz = Vec::with_capacity(channel_count);
    let mut tonality = Vec::with_capacity(channel_count);
    for channel in 0..channel_count {
      let metric = self
        .spectral_waveform_metrics
        .get(&channel)
        .copied()
        .unwrap_or_default();
      dominant_frequency_hz.push(metric.dominant_frequency_hz);
      spectral_centroid_hz.push(metric.spectral_centroid_hz);
      tonality.push(metric.tonality);
    }
    (dominant_frequency_hz, spectral_centroid_hz, tonality)
  }

  #[cfg(test)]
  pub(crate) fn stereo_map_active_input_for_test(&self, key: &str) -> Option<ConsumerInput> {
    self
      .stereo_map_consumers
      .get(key)
      .map(|state| state.binding.input)
  }

  #[cfg(test)]
  pub(crate) fn stereo_map_consume_counts_for_test(&self, key: &str) -> Option<[u64; 3]> {
    self
      .stereo_map_consumers
      .get(key)
      .map(|state| state.consume_counts)
  }

  #[cfg(test)]
  pub(crate) fn consumer_snapshot_for_test(
    &mut self,
    key: &str,
    now_sec: f64,
  ) -> Option<RuntimeConsumerSnapshot> {
    self
      .consumer_snapshot_at_dsp_time_for_test(key, SpectralDspTime::from_monotonic_seconds(now_sec))
  }

  #[cfg(test)]
  pub(crate) fn consumer_snapshot_at_dsp_time_for_test(
    &mut self,
    key: &str,
    dsp_time: SpectralDspTime,
  ) -> Option<RuntimeConsumerSnapshot> {
    let sample_rate = self.sample_rate;
    let state = self.consumers.get_mut(key)?;
    let output = state.consumer.output(dsp_time.as_seconds());
    let (centers_hz, smooth_db, peak_db) = output
      .map(|output| {
        (
          output.centers_hz.to_vec(),
          output.smooth_db.to_vec(),
          output.peak_db.to_vec(),
        )
      })
      .unwrap_or_default();
    let peak_max = peak_db.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    Some(RuntimeConsumerSnapshot {
      request_key: key.to_string(),
      identity: state.identity,
      sample_rate,
      active_input: state.binding.input,
      consume_counts: state.consume_counts,
      last_switch_clock: state.last_switch_clock,
      output_present: !centers_hz.is_empty(),
      centers_hz,
      smooth_db,
      peak_db,
      peak_max,
      state: state.consumer.state_snapshot_for_test(),
    })
  }

  #[cfg(test)]
  pub(crate) fn consumer_snapshot_after_output_for_test(
    &self,
    key: &str,
  ) -> Option<RuntimeConsumerSnapshot> {
    let state = self.consumers.get(key)?;
    let consumer_state = state.consumer.state_snapshot_for_test();
    let output_present =
      consumer_state.ema_initialized == [true; 3] && !consumer_state.primary.smooth_db.is_empty();
    let centers_hz = if output_present {
      state.consumer.centers_for_test().to_vec()
    } else {
      Vec::new()
    };
    let smooth_db = consumer_state.primary.smooth_db.clone();
    let peak_db = consumer_state.primary.peak_db.clone();
    let peak_max = peak_db.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    Some(RuntimeConsumerSnapshot {
      request_key: key.to_string(),
      identity: state.identity,
      sample_rate: self.sample_rate,
      active_input: state.binding.input,
      consume_counts: state.consume_counts,
      last_switch_clock: state.last_switch_clock,
      output_present,
      centers_hz,
      smooth_db,
      peak_db,
      peak_max,
      state: consumer_state,
    })
  }

  #[cfg(test)]
  pub(crate) fn consumer_active_input_for_test(&self, key: &str) -> Option<ConsumerInput> {
    self.consumers.get(key).map(|state| state.binding.input)
  }

  #[cfg(test)]
  pub(crate) fn consumer_identity_for_test(&self, key: &str) -> Option<u64> {
    self.consumers.get(key).map(|state| state.identity)
  }

  #[cfg(test)]
  pub(crate) fn consumer_counts_for_test(&self, key: &str) -> Option<[u64; 3]> {
    self.consumers.get(key).map(|state| state.consume_counts)
  }

  #[cfg(test)]
  pub(crate) fn removed_consumer_counts_for_test(&self, key: &str) -> Option<[u64; 3]> {
    self.removed_consumer_counts.get(key).copied()
  }

  #[cfg(test)]
  pub(crate) fn transition_generation_for_test(&self, key: &str) -> Option<u64> {
    self
      .consumers
      .get(key)
      .map(|state| state.transition_generation)
  }

  #[cfg(test)]
  pub(crate) fn streams_for_test(&self) -> Vec<TransformStreamId> {
    self.engine.streams.keys().copied().collect()
  }

  #[cfg(test)]
  pub(crate) fn contains_stream_for_test(&self, stream: TransformStreamId) -> bool {
    self.engine.streams.contains_key(&stream)
  }

  #[cfg(test)]
  pub(crate) fn stream_all_three_ready_for_test(&self, stream: TransformStreamId) -> Option<bool> {
    self
      .engine
      .streams
      .get(&stream)
      .map(StreamTransforms::all_three_ready)
  }

  #[cfg(test)]
  pub(crate) fn fft_count_for_test(&self, stream: TransformStreamId, fft_size: usize) -> u64 {
    self.engine.fft_invocation_count(stream, fft_size)
  }

  #[cfg(test)]
  pub(crate) fn fft_invocations_for_test(&self) -> BTreeMap<TransformStreamId, [u64; 3]> {
    self
      .engine
      .streams
      .keys()
      .copied()
      .map(|stream| {
        (
          stream,
          [FFT_BIG, FFT_MID, FFT_SMALL]
            .map(|fft_size| self.engine.fft_invocation_count(stream, fft_size)),
        )
      })
      .collect()
  }

  #[cfg(test)]
  pub(crate) fn sample_clock_for_test(&self) -> u64 {
    self.engine.sample_clock()
  }

  #[cfg(test)]
  pub(crate) fn lifecycle_snapshot_for_test(&self) -> RuntimeLifecycleSnapshot {
    RuntimeLifecycleSnapshot {
      sample_clock: self.engine.sample_clock(),
      total_fft_count: self.engine.total_fft_invocations(),
      transition_count: self
        .consumers
        .values()
        .filter(|consumer| consumer.target.is_some())
        .count(),
      streams: self
        .engine
        .streams
        .iter()
        .map(|(&stream_id, transforms)| RuntimeStreamSnapshot {
          stream_id,
          all_three_ready: transforms.all_three_ready(),
          fft_count: [FFT_BIG, FFT_MID, FFT_SMALL]
            .into_iter()
            .map(|fft_size| self.engine.fft_invocation_count(stream_id, fft_size))
            .sum(),
        })
        .collect(),
    }
  }
}

#[cfg(test)]
#[derive(Clone)]
pub(crate) struct RuntimeConsumerSnapshot {
  pub(crate) request_key: String,
  pub(crate) identity: u64,
  pub(crate) sample_rate: f64,
  pub(crate) active_input: ConsumerInput,
  pub(crate) consume_counts: [u64; 3],
  pub(crate) last_switch_clock: Option<u64>,
  pub(crate) output_present: bool,
  pub(crate) centers_hz: Vec<f64>,
  pub(crate) smooth_db: Vec<f64>,
  pub(crate) peak_db: Vec<f64>,
  pub(crate) peak_max: f64,
  pub(crate) state: super::spectrum_consumer::SpectralConsumerStateSnapshot,
}

#[cfg(test)]
pub(crate) struct RuntimeLifecycleSnapshot {
  pub(crate) sample_clock: u64,
  pub(crate) total_fft_count: u64,
  pub(crate) transition_count: usize,
  pub(crate) streams: Vec<RuntimeStreamSnapshot>,
}

#[cfg(test)]
pub(crate) struct RuntimeStreamSnapshot {
  pub(crate) stream_id: TransformStreamId,
  pub(crate) all_three_ready: bool,
  pub(crate) fft_count: u64,
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::dsp::spectral_transform::SpectralTransform;
  use crate::dsp::spectrum_bank::{
    FFT_BIG, FFT_MID, FFT_SMALL, OVERLAP_BIG, OVERLAP_MID, OVERLAP_SMALL,
  };
  use crate::dsp::spectrum_consumer::{SpectralConsumer, SpectralProjection};
  use crate::engine::spectral_plan::{
    plan_analysis_requests, plan_spectral_requests, FuturePairNeed, ProjectionKind,
    TransformStreamId,
  };
  use crate::ipc::types::{
    AnalysisRequests, SpectrumAnalysisChannel, SpectrumAnalysisRequest, StereoMapAnalysisPair,
    StereoMapAnalysisRequest,
  };
  use rustfft::num_complex::Complex32;

  fn physical(channel: usize) -> TransformStreamId {
    TransformStreamId::Physical(channel)
  }

  fn combined(first: usize, second: usize) -> TransformStreamId {
    TransformStreamId::Projection {
      first,
      second,
      kind: ProjectionKind::Combined,
    }
  }

  fn expected_invocations(samples: usize, fft_size: usize, overlap: usize) -> u64 {
    let hop = fft_size / overlap;
    (fft_size..=samples)
      .filter(|clock| clock.is_multiple_of(hop))
      .count() as u64
  }

  fn spectrum_request(
    key: &str,
    channel: SpectrumAnalysisChannel,
    view: &str,
    speed_percent: f64,
    octave_smoothing: &str,
  ) -> SpectrumAnalysisRequest {
    SpectrumAnalysisRequest {
      key: key.to_string(),
      channel,
      view: view.to_string(),
      speed_percent,
      tilt_db_per_octave: 4.5,
      octave_smoothing: octave_smoothing.to_string(),
    }
  }

  fn pair_request(
    key: &str,
    first: u16,
    second: u16,
    view: &str,
    speed_percent: f64,
    octave_smoothing: &str,
  ) -> SpectrumAnalysisRequest {
    spectrum_request(
      key,
      SpectrumAnalysisChannel::Pair {
        x: first,
        y: second,
      },
      view,
      speed_percent,
      octave_smoothing,
    )
  }

  fn runtime_for_requests(
    channels: u16,
    requests: &[SpectrumAnalysisRequest],
    future_pair_needs: &[FuturePairNeed],
  ) -> (
    crate::engine::spectral_plan::SpectralPlan,
    SharedSpectralRuntime,
  ) {
    let plan = plan_spectral_requests(channels, requests, future_pair_needs);
    let mut runtime = SharedSpectralRuntime::new(48_000.0);
    runtime.update_plan(plan.clone());
    (plan, runtime)
  }

  fn push_silence(runtime: &mut SharedSpectralRuntime, channels: u16, frames: usize) {
    runtime.push_interleaved(&vec![0.0; frames * channels as usize], channels);
  }

  fn assert_fft_invocations(
    runtime: &SharedSpectralRuntime,
    expected_streams: &[TransformStreamId],
    sample_clock: usize,
  ) {
    let expected_counts = [
      expected_invocations(sample_clock, FFT_BIG, OVERLAP_BIG),
      expected_invocations(sample_clock, FFT_MID, OVERLAP_MID),
      expected_invocations(sample_clock, FFT_SMALL, OVERLAP_SMALL),
    ];
    let expected: BTreeMap<_, _> = expected_streams
      .iter()
      .copied()
      .map(|stream| (stream, expected_counts))
      .collect();
    assert_eq!(runtime.fft_invocations_for_test(), expected);
  }

  fn assert_bins_close(actual: &[Complex32], expected: &[Complex32]) {
    assert_eq!(actual.len(), expected.len());
    for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
      assert!(
        (*actual - *expected).norm() < 1e-6,
        "bin {index} differs: actual={actual:?}, expected={expected:?}"
      );
    }
  }

  #[test]
  fn fft_count_lone_combined_uses_one_stream_per_fft_size() {
    let requests = [pair_request("combined", 0, 1, "combined", 50.0, "off")];
    let expected_streams = vec![combined(0, 1)];
    let (plan, mut runtime) = runtime_for_requests(2, &requests, &[]);

    assert_eq!(plan.streams, expected_streams);
    assert_eq!(runtime.streams_for_test(), expected_streams);

    push_silence(&mut runtime, 2, FFT_BIG - 1);
    assert_fft_invocations(&runtime, &expected_streams, FFT_BIG - 1);
    push_silence(&mut runtime, 2, 1);
    assert_fft_invocations(&runtime, &expected_streams, FFT_BIG);
    push_silence(&mut runtime, 2, FFT_BIG / OVERLAP_BIG);
    assert_fft_invocations(&runtime, &expected_streams, FFT_BIG + FFT_BIG / OVERLAP_BIG);
  }

  #[test]
  fn fft_count_duplicate_combined_requests_do_not_add_transforms() {
    let requests = [
      pair_request("combined-a", 0, 1, "combined", 50.0, "off"),
      pair_request("combined-b", 0, 1, "combined", 50.0, "off"),
    ];
    let expected_streams = vec![combined(0, 1)];
    let (plan, mut runtime) = runtime_for_requests(2, &requests, &[]);

    assert_eq!(plan.streams, expected_streams);
    assert_eq!(runtime.streams_for_test(), expected_streams);
    let frames = FFT_BIG + FFT_BIG / OVERLAP_BIG;
    push_silence(&mut runtime, 2, frames);
    assert_fft_invocations(&runtime, &expected_streams, frames);
  }

  #[test]
  fn fft_count_speed_and_smoothing_variants_reuse_transforms() {
    let requests = [
      pair_request("combined-fast", 0, 1, "combined", 10.0, "off"),
      pair_request("combined-slow", 0, 1, "combined", 90.0, "1/3"),
    ];
    let expected_streams = vec![combined(0, 1)];
    let (plan, mut runtime) = runtime_for_requests(2, &requests, &[]);

    assert_eq!(plan.streams, expected_streams);
    assert_eq!(runtime.streams_for_test(), expected_streams);
    let frames = FFT_BIG + FFT_BIG / OVERLAP_BIG;
    push_silence(&mut runtime, 2, frames);
    assert_fft_invocations(&runtime, &expected_streams, frames);
  }

  #[test]
  fn fft_count_duplicate_pair_consumers_use_two_physical_streams() {
    let requests = [
      pair_request("lr", 0, 1, "lr", 25.0, "off"),
      pair_request("ms", 0, 1, "ms", 75.0, "1/6"),
    ];
    let expected_streams = vec![physical(0), physical(1)];
    let (plan, mut runtime) = runtime_for_requests(2, &requests, &[]);

    assert_eq!(plan.streams, expected_streams);
    assert_eq!(runtime.streams_for_test(), expected_streams);
    let frames = FFT_BIG + FFT_BIG / OVERLAP_BIG;
    push_silence(&mut runtime, 2, frames);
    assert_fft_invocations(&runtime, &expected_streams, frames);
  }

  #[test]
  fn fft_count_mixed_spectrum_and_future_pairs_tracks_unique_streams() {
    let requests = [
      pair_request("combined-01", 0, 1, "combined", 20.0, "off"),
      pair_request("combined-01-alt", 0, 1, "combined", 80.0, "1/3"),
      spectrum_request(
        "single-2",
        SpectrumAnalysisChannel::Single { ch: 2 },
        "combined",
        50.0,
        "1/6",
      ),
      pair_request("combined-45", 4, 5, "combined", 50.0, "off"),
    ];
    let future_pairs = [
      FuturePairNeed::new(0, 1),
      FuturePairNeed::new(1, 2),
      FuturePairNeed::new(2, 3),
      FuturePairNeed::new(6, 7),
    ];
    let expected_streams = vec![
      physical(0),
      physical(1),
      physical(2),
      physical(3),
      physical(6),
      physical(7),
      combined(4, 5),
    ];
    let (plan, mut runtime) = runtime_for_requests(8, &requests, &future_pairs);

    // Pair needs imply physical streams {0, 1, 2, 3, 6, 7}; pair 4/5 remains one direct
    // Combined projection because no pair consumer needs its physical channels.
    assert_eq!(plan.streams, expected_streams);
    assert_eq!(runtime.streams_for_test(), expected_streams);
    let frames = FFT_BIG + FFT_BIG / OVERLAP_BIG;
    push_silence(&mut runtime, 8, frames);
    assert_fft_invocations(&runtime, &expected_streams, frames);
  }

  #[test]
  fn empty_plan_advances_one_global_clock_without_fft_work() {
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams([]);
    engine.push_interleaved(&[0.0; 12], 2, |_| panic!("empty plan emitted a frame"));

    assert_eq!(engine.sample_clock(), 6);
    assert_eq!(engine.stream_count(), 0);
    assert_eq!(engine.total_fft_invocations(), 0);
  }

  #[test]
  fn physical_and_projection_streams_use_exact_time_domain_samples() {
    let streams = [physical(0), physical(1), combined(0, 1)];
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams(streams);
    let left: Vec<f32> = (0..FFT_BIG).map(|i| (i as f32 * 0.13).sin()).collect();
    let right: Vec<f32> = (0..FFT_BIG)
      .map(|i| (i as f32 * 0.07).cos() * 0.25 + 0.1)
      .collect();
    let projection: Vec<f32> = left
      .iter()
      .zip(&right)
      .map(|(left, right)| 0.5 * (left + right))
      .collect();
    let pcm: Vec<f32> = left
      .iter()
      .zip(&right)
      .flat_map(|(&left, &right)| [left, right])
      .collect();

    let expected = |samples: &[f32]| {
      let mut transform = SpectralTransform::new(FFT_SMALL, OVERLAP_SMALL, 0);
      let mut bins = None;
      for &sample in samples {
        if let Some(frame) = transform.push_sample(sample) {
          bins = Some(frame.bins.to_vec());
        }
      }
      bins.expect("independent transform frame")
    };
    let expected_left = expected(&left);
    let expected_right = expected(&right);
    let expected_projection = expected(&projection);
    let mut small = Vec::<(TransformStreamId, Vec<Complex32>)>::new();

    engine.push_interleaved(&pcm, 2, |frames| {
      frames.for_each_due(|frame| {
        if frame.fft_size == FFT_SMALL && frame.sample_clock == FFT_BIG as u64 {
          small.push((frame.stream_id, frame.bins.to_vec()));
        }
      });
    });

    assert_eq!(small.len(), 3);
    let bins = |id| {
      &small
        .iter()
        .find(|(stream_id, _)| *stream_id == id)
        .expect("small frame")
        .1
    };
    assert_bins_close(bins(physical(0)), &expected_left);
    assert_bins_close(bins(physical(1)), &expected_right);
    assert_bins_close(bins(combined(0, 1)), &expected_projection);
    assert!(
      bins(physical(0))
        .iter()
        .zip(&expected_right)
        .any(|(actual, swapped)| (*actual - *swapped).norm() > 1e-3),
      "distinct channels must make a physical-channel swap observable"
    );
  }

  #[test]
  fn physical_pair_frames_are_aligned_at_every_resolution() {
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams([physical(0), physical(1)]);
    let pcm = vec![0.0; FFT_BIG * 2];
    let mut events = Vec::new();

    engine.push_interleaved(&pcm, 2, |frames| {
      frames.for_each_due(|frame| {
        events.push((
          frame.stream_id,
          frame.fft_size,
          frame.sample_clock,
          frame.all_three_ready,
        ));
      });
    });

    for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
      let left: Vec<_> = events
        .iter()
        .filter(|event| event.0 == physical(0) && event.1 == fft_size)
        .map(|event| event.2)
        .collect();
      let right: Vec<_> = events
        .iter()
        .filter(|event| event.0 == physical(1) && event.1 == fft_size)
        .map(|event| event.2)
        .collect();
      assert_eq!(left, right);
      assert!(!left.is_empty());
    }
    assert!(events
      .iter()
      .filter(|event| event.2 >= FFT_BIG as u64)
      .all(|event| event.3));
  }

  #[test]
  fn one_frame_set_borrows_aligned_pair_into_existing_consumer() {
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams([physical(0), physical(1)]);
    let pcm = vec![0.0; FFT_BIG * 2];
    let mut consumer =
      SpectralConsumer::new_projected(48_000.0, 20.0, 20_000.0, SpectralProjection::Lr);
    let mut consumed = 0;

    engine.push_interleaved(&pcm, 2, |frames| {
      if frames.sample_clock() != FFT_BIG as u64 {
        return;
      }
      assert_eq!(frames.sample_clock(), FFT_BIG as u64);
      for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
        let (Some(left), Some(right)) = (
          frames.frame(physical(0), fft_size),
          frames.frame(physical(1), fft_size),
        ) else {
          continue;
        };
        let left = left.as_complex();
        let right = right.as_complex();
        assert!(consumer.consume_aligned(&left, Some(&right)));
        consumed += 1;
      }
    });

    assert_eq!(consumed, 3);
    assert!(consumer.output(1.0).is_some());
  }

  #[test]
  fn late_stream_inherits_hop_phase_and_warms_each_resolution_independently() {
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams([physical(0)]);
    engine.push_interleaved(&vec![0.0; 777], 1, |_| {});
    engine.update_streams([physical(0), physical(1)]);
    let added_at = engine.sample_clock();
    let pcm = vec![0.0; (FFT_BIG + FFT_BIG / OVERLAP_BIG) * 2];
    let mut late = Vec::new();

    engine.push_interleaved(&pcm, 2, |frames| {
      frames.for_each_due(|frame| {
        if frame.stream_id == physical(1) {
          late.push((frame.fft_size, frame.sample_clock, frame.all_three_ready));
        }
      });
    });

    for (fft_size, overlap) in [
      (FFT_SMALL, OVERLAP_SMALL),
      (FFT_MID, OVERLAP_MID),
      (FFT_BIG, OVERLAP_BIG),
    ] {
      let first = late
        .iter()
        .find(|event| event.0 == fft_size)
        .expect("late resolution frame");
      assert!(first.1 >= added_at + fft_size as u64);
      assert!(first.1.is_multiple_of((fft_size / overlap) as u64));
      assert_eq!(first.2, fft_size == FFT_BIG);
    }
    assert!(late.iter().any(|event| event.0 == FFT_SMALL && !event.2));
    assert!(late.iter().any(|event| event.0 == FFT_MID && !event.2));
    let publication_clock = late
      .iter()
      .find(|event| event.0 == FFT_BIG)
      .expect("late big frame")
      .1;
    assert!(late
      .iter()
      .filter(|event| event.1 < publication_clock)
      .all(|event| !event.2));
    assert!(late
      .iter()
      .filter(|event| event.1 >= publication_clock)
      .all(|event| event.2));
  }

  #[test]
  fn consumer_accumulates_internal_warmup_without_becoming_publishable() {
    let stream = physical(0);
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams([stream]);
    let mut consumer = SpectralConsumer::new(48_000.0, 20.0, 20_000.0);
    let mut warmup_frames = Vec::new();
    let mut publishable = false;

    engine.push_interleaved(&vec![0.25; FFT_BIG - 1], 1, |frames| {
      frames.for_each_due(|frame| {
        warmup_frames.push((frame.fft_size, frame.sample_clock));
        publishable |= frame.all_three_ready;
        consumer.consume(&frame.as_complex());
      });
    });

    assert!(warmup_frames.iter().any(|frame| frame.0 == FFT_SMALL));
    assert!(warmup_frames.iter().any(|frame| frame.0 == FFT_MID));
    assert!(!warmup_frames.iter().any(|frame| frame.0 == FFT_BIG));
    assert!(!publishable);
    assert!(consumer.output(1.0).is_none());

    engine.push_interleaved(&[0.25], 1, |frames| {
      frames.for_each_due(|frame| {
        publishable |= frame.all_three_ready;
        consumer.consume(&frame.as_complex());
      });
    });
    assert!(publishable);
    assert!(consumer.output(1.1).is_some());
  }

  #[test]
  fn warmed_stream_keeps_emitting_while_new_stream_is_gated() {
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams([physical(0)]);
    engine.push_interleaved(&vec![0.0; FFT_BIG], 1, |_| {});
    engine.update_streams([physical(0), physical(1)]);
    let pcm = vec![0.0; (FFT_BIG / OVERLAP_BIG) * 2];
    let mut old_frames = 0;
    let mut new_internal_frames = 0;
    let mut new_publishable_frames = 0;

    engine.push_interleaved(&pcm, 2, |frames| {
      frames.for_each_due(|frame| {
        if frame.stream_id == physical(0) {
          assert!(frame.all_three_ready);
          old_frames += 1;
        } else if frame.stream_id == physical(1) {
          new_internal_frames += 1;
          new_publishable_frames += usize::from(frame.all_three_ready);
        }
      });
    });

    assert!(old_frames > 0);
    assert!(new_internal_frames > 0);
    assert_eq!(new_publishable_frames, 0);
  }

  #[test]
  fn plan_updates_preserve_unchanged_history_and_remove_only_obsolete_streams() {
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams([physical(0), physical(1)]);
    let prefill = vec![0.0; (FFT_BIG - 1) * 2];
    engine.push_interleaved(&prefill, 2, |_| {});
    engine.update_streams([physical(0), physical(2)]);
    let mut emitted = Vec::new();

    engine.push_interleaved(&[0.0, 0.0, 0.0], 3, |frames| {
      frames.for_each_due(|frame| {
        emitted.push((frame.stream_id, frame.fft_size, frame.sample_clock));
      });
    });

    assert!(engine.contains_stream(physical(0)));
    assert!(!engine.contains_stream(physical(1)));
    assert!(engine.contains_stream(physical(2)));
    let unchanged_sizes: Vec<_> = emitted
      .iter()
      .filter(|event| event.0 == physical(0))
      .map(|event| event.1)
      .collect();
    assert_eq!(unchanged_sizes, vec![FFT_BIG, FFT_MID, FFT_SMALL]);
    assert!(emitted
      .iter()
      .filter(|event| event.0 == physical(0))
      .all(|event| event.2 == FFT_BIG as u64));
    assert!(!emitted.iter().any(|event| event.0 == physical(2)));
  }

  #[test]
  fn warmed_steady_state_push_performs_zero_heap_allocations() {
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams([physical(0), physical(1), combined(0, 1)]);
    let warmup = vec![0.0; FFT_BIG * 2];
    engine.push_interleaved(&warmup, 2, |_| {});
    let steady_pcm = vec![0.0; (FFT_BIG / OVERLAP_BIG) * 2];

    let allocations = allocation_counter::count_current_thread_allocations(|| {
      engine.push_interleaved(&steady_pcm, 2, |_| {});
    });

    assert_eq!(allocations, 0, "steady-state push allocated");
  }

  #[test]
  fn removed_streams_stop_fft_work_and_due_hops_execute_at_most_once() {
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams([physical(0), physical(1)]);
    let first_samples = FFT_BIG + 333;
    engine.push_interleaved(&vec![0.0; first_samples * 2], 2, |_| {});
    let removed_counts =
      [FFT_BIG, FFT_MID, FFT_SMALL].map(|size| engine.fft_invocation_count(physical(1), size));

    engine.update_streams([physical(0)]);
    engine.push_interleaved(&vec![0.0; FFT_BIG * 2], 2, |_| {});

    for (index, size) in [FFT_BIG, FFT_MID, FFT_SMALL].into_iter().enumerate() {
      assert_eq!(
        engine.fft_invocation_count(physical(1), size),
        removed_counts[index]
      );
    }
    for (size, overlap) in [
      (FFT_BIG, OVERLAP_BIG),
      (FFT_MID, OVERLAP_MID),
      (FFT_SMALL, OVERLAP_SMALL),
    ] {
      assert_eq!(
        engine.fft_invocation_count(physical(0), size),
        expected_invocations(first_samples + FFT_BIG, size, overlap)
      );
    }
  }

  fn stereo_map_request(
    key: &str,
    speed_percent: f64,
    octave_smoothing: &str,
  ) -> StereoMapAnalysisRequest {
    stereo_map_pair_request(key, 0, 1, speed_percent, octave_smoothing)
  }

  fn stereo_map_pair_request(
    key: &str,
    first: u16,
    second: u16,
    speed_percent: f64,
    octave_smoothing: &str,
  ) -> StereoMapAnalysisRequest {
    StereoMapAnalysisRequest {
      key: key.to_string(),
      pair: StereoMapAnalysisPair { first, second },
      speed_percent,
      octave_smoothing: octave_smoothing.to_string(),
    }
  }

  #[test]
  fn stereo_map_consumers_share_spectrum_transforms_and_publish_after_all_three_ready() {
    let requests = AnalysisRequests {
      spectral_waveform: false,
      spectrum: vec![pair_request("combined", 0, 1, "combined", 50.0, "off")],
      vectorscope: vec![],
      stereo_map: vec![
        stereo_map_request("map-a", 25.0, "off"),
        stereo_map_request("map-b", 75.0, "1/6"),
      ],
    };
    let plan = plan_analysis_requests(2, &requests);
    let mut runtime = SharedSpectralRuntime::new(48_000.0);
    runtime.update_plan(plan);

    assert_eq!(runtime.streams_for_test(), vec![physical(0), physical(1)]);
    runtime.push_interleaved(&vec![0.25; (FFT_BIG - 1) * 2], 2);
    assert!(runtime.stereo_map_output("map-a").is_none());
    runtime.push_interleaved(&[0.25, 0.25], 2);
    let output = runtime.stereo_map_output("map-a").expect("map output");
    assert!(!output.band_centers_hz.is_empty());
    assert!(output.pl.iter().all(|value| value.is_finite()));
    assert!(output.pr.iter().all(|value| value.is_finite()));
    assert!(output.c.iter().all(|value| value.is_finite()));
    assert_fft_invocations(&runtime, &[physical(0), physical(1)], FFT_BIG);
  }

  #[test]
  fn stereo_map_request_keys_keep_independent_speed_ema_state() {
    let requests = AnalysisRequests {
      spectral_waveform: false,
      spectrum: vec![],
      vectorscope: vec![],
      stereo_map: vec![
        stereo_map_request("fast", 0.0, "off"),
        stereo_map_request("slow", 100.0, "off"),
      ],
    };
    let mut runtime = SharedSpectralRuntime::new(48_000.0);
    runtime.update_plan(plan_analysis_requests(2, &requests));
    runtime.push_interleaved(&vec![1.0; FFT_BIG * 2], 2);

    let changed = vec![0.0; (FFT_BIG / OVERLAP_BIG) * 2];
    runtime.push_interleaved(&changed, 2);
    let fast = runtime.stereo_map_output("fast").expect("fast output");
    let fast_pl = fast.pl[0];
    let slow = runtime.stereo_map_output("slow").expect("slow output");
    let slow_pl = slow.pl[0];
    assert!(
      (slow_pl - fast_pl).abs() > 1e-8,
      "request-keyed EMA states collapsed: slow={slow_pl}, fast={fast_pl}"
    );
  }

  #[test]
  fn stereo_map_pair_change_uses_distinct_keys_and_explicit_overlap_until_new_pair_is_ready() {
    let old_request = stereo_map_pair_request("map-01", 0, 1, 25.0, "off");
    let new_request = stereo_map_pair_request("map-23", 2, 3, 25.0, "off");
    let mut runtime = SharedSpectralRuntime::new(48_000.0);
    runtime.update_plan(plan_analysis_requests(
      4,
      &AnalysisRequests {
        spectral_waveform: false,
        stereo_map: vec![old_request.clone()],
        ..AnalysisRequests::default()
      },
    ));
    let old_pcm: Vec<f32> = (0..FFT_BIG).flat_map(|_| [0.5, 0.5, 0.0, 0.0]).collect();
    runtime.push_interleaved(&old_pcm, 4);
    assert!(runtime.stereo_map_output("map-01").is_some());
    assert_eq!(
      runtime.stereo_map_active_input_for_test("map-01"),
      Some(ConsumerInput::Pair {
        first: physical(0),
        second: physical(1),
      })
    );

    runtime.update_plan(plan_analysis_requests(
      4,
      &AnalysisRequests {
        spectral_waveform: false,
        stereo_map: vec![old_request, new_request],
        ..AnalysisRequests::default()
      },
    ));
    assert_eq!(
      runtime.streams_for_test(),
      vec![physical(0), physical(1), physical(2), physical(3)]
    );
    let transition_pcm: Vec<f32> = (0..FFT_BIG - 1)
      .flat_map(|_| [0.5, 0.5, 0.75, -0.75])
      .collect();
    runtime.push_interleaved(&transition_pcm, 4);
    assert!(runtime.stereo_map_output("map-01").is_some());
    assert!(runtime.stereo_map_output("map-23").is_none());
    assert_eq!(
      runtime.stereo_map_consume_counts_for_test("map-23"),
      Some([0, 0, 0]),
      "new pair must not consume partial-resolution warmup"
    );

    runtime.push_interleaved(&[0.5, 0.5, 0.75, -0.75], 4);
    assert_eq!(
      runtime.stereo_map_consume_counts_for_test("map-23"),
      Some([1, 1, 1]),
      "first consume must borrow all three aligned pair frames"
    );
    let old_c = runtime.stereo_map_output("map-01").expect("old output").c[0];
    let new_c = runtime.stereo_map_output("map-23").expect("new output").c[0];
    assert!(old_c > 0.0, "old L/R pair lost continuity: {old_c}");
    assert!(
      new_c < 0.0,
      "new pair mixed channels or reversed C: {new_c}"
    );

    runtime.update_plan(plan_analysis_requests(
      4,
      &AnalysisRequests {
        spectral_waveform: false,
        stereo_map: vec![stereo_map_pair_request("map-23", 2, 3, 25.0, "off")],
        ..AnalysisRequests::default()
      },
    ));
    assert!(runtime.stereo_map_output("map-01").is_none());
    assert_eq!(runtime.streams_for_test(), vec![physical(2), physical(3)]);
  }

  #[test]
  fn spectral_waveform_metrics_reuse_planned_physical_transforms() {
    let requests = AnalysisRequests {
      spectral_waveform: true,
      ..AnalysisRequests::default()
    };
    let mut runtime = SharedSpectralRuntime::new(48_000.0);
    runtime.update_plan(plan_analysis_requests(2, &requests));
    let topology = runtime.fft_topology();
    assert_eq!(topology.transform_count(FFT_BIG), 0);
    assert_eq!(topology.transform_count(FFT_MID), 2);
    assert_eq!(topology.transform_count(FFT_SMALL), 0);
    assert_eq!(topology.total_transform_count, 2);
    let pcm: Vec<f32> = (0..FFT_MID)
      .flat_map(|sample| {
        let time = sample as f64 / 48_000.0;
        [
          (0.5 * (std::f64::consts::TAU * 1_000.0 * time).sin()) as f32,
          (0.5 * (std::f64::consts::TAU * 4_000.0 * time).sin()) as f32,
        ]
      })
      .collect();

    runtime.push_interleaved(&pcm, 2);
    let (dominant, centroid, tonality) = runtime.spectral_waveform_metrics(2);
    assert!((dominant[0] - 1_000.0).abs() < 20.0);
    assert!((dominant[1] - 4_000.0).abs() < 20.0);
    assert!((centroid[0] - 1_000.0).abs() < 50.0);
    assert!((centroid[1] - 4_000.0).abs() < 50.0);
    assert!(tonality.iter().all(|value| *value > 0.5));
    assert_eq!(runtime.streams_for_test(), vec![physical(0), physical(1)]);
  }
}
