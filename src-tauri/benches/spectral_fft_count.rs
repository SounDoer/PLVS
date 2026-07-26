#![allow(dead_code, unused_imports)]

use std::hint::black_box;
use std::mem::size_of;

use criterion::{criterion_group, criterion_main, BatchSize, BenchmarkId, Criterion, Throughput};
use rustfft::num_complex::Complex32;

mod ipc {
  pub(crate) mod types {
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) enum SpectrumAnalysisChannel {
      Pair { x: u16, y: u16 },
      Single { ch: u16 },
    }

    #[derive(Debug, Clone, PartialEq)]
    pub(crate) struct SpectrumAnalysisRequest {
      pub(crate) key: String,
      pub(crate) channel: SpectrumAnalysisChannel,
      pub(crate) view: String,
      pub(crate) speed_percent: f64,
      pub(crate) tilt_db_per_octave: f64,
      pub(crate) octave_smoothing: String,
    }
  }
}

#[path = "../src/dsp/channel_sel.rs"]
pub(crate) mod channel_sel;
#[path = "../src/dsp/shared_spectral_engine.rs"]
pub(crate) mod shared_spectral_engine;
#[path = "../src/engine/spectral_plan.rs"]
pub(crate) mod spectral_plan;
#[path = "../src/dsp/spectral_transform.rs"]
pub(crate) mod spectral_transform;
#[path = "../src/dsp/spectrum.rs"]
pub(crate) mod spectrum;
#[path = "../src/dsp/spectrum_bank.rs"]
pub(crate) mod spectrum_bank;
#[path = "../src/dsp/spectrum_consumer.rs"]
pub(crate) mod spectrum_consumer;

mod meter {
  use crate::channel_sel::{SpectrumChannelSel, SpectrumView};

  pub(crate) struct PcmContext<'a> {
    pub(crate) interleaved: &'a [f32],
    pub(crate) channels: u16,
    pub(crate) now_sec: f64,
    pub(crate) spectrum_channel: SpectrumChannelSel,
    pub(crate) spectrum_view: SpectrumView,
  }

  pub(crate) trait Meter {
    fn push_pcm(&mut self, ctx: &PcmContext<'_>);
    fn reset(&mut self);
  }
}

mod dsp {
  pub(crate) use crate::channel_sel::{SpectrumChannelSel, SpectrumView};
  pub(crate) use crate::{
    meter, shared_spectral_engine, spectral_transform, spectrum, spectrum_bank, spectrum_consumer,
  };
}

mod engine {
  pub(crate) use crate::spectral_plan;
}

use ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};
use shared_spectral_engine::{SharedSpectralEngine, SharedSpectralRuntime, SpectralDspTime};
use spectral_plan::{
  plan_spectral_requests, ConsumerProjection, FuturePairNeed, SpectralConsumerBinding,
  SpectralPlan, TransformStreamId,
};
use spectrum::SpectrumMeter;
use spectrum_bank::{
  spectrum_frequency_bounds, BinTap, OctaveSmoothing, SpectrumGrid, FFT_BIG, FFT_MID, FFT_SMALL,
  OVERLAP_BIG,
};

const SAMPLE_RATE: usize = 48_000;
const AUDIO_FRAMES: usize = FFT_BIG + 4 * (FFT_BIG / OVERLAP_BIG);
// Live capture requests `cpal::BufferSize::Default`, so callback blocks are device-variable.
// 480 frames is the representative Windows/WASAPI default period: 10 ms at this 48 kHz benchmark
// rate. The capture pool's 100 ms capacity is only headroom; callbacks are forwarded unaggregated.
const PRODUCTION_BLOCK_FRAMES: usize = 480;

fn request(
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
  request(
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

fn lone_combined_plan() -> SpectralPlan {
  plan_spectral_requests(
    2,
    &[pair_request("combined", 0, 1, "combined", 50.0, "off")],
    &[],
  )
}

fn duplicate_combined_plan() -> SpectralPlan {
  plan_spectral_requests(
    2,
    &[
      pair_request("combined-fast", 0, 1, "combined", 10.0, "off"),
      pair_request("combined-slow", 0, 1, "combined", 90.0, "1/3"),
    ],
    &[],
  )
}

fn mixed_plan() -> SpectralPlan {
  let requests = [
    pair_request("combined-01", 0, 1, "combined", 20.0, "off"),
    pair_request("combined-01-alt", 0, 1, "combined", 80.0, "1/3"),
    request(
      "single-2",
      SpectrumAnalysisChannel::Single { ch: 2 },
      "combined",
      50.0,
      "1/6",
    ),
    pair_request("combined-45", 4, 5, "combined", 50.0, "off"),
  ];
  let pair_consumers = [
    FuturePairNeed::new(0, 1),
    FuturePairNeed::new(1, 2),
    FuturePairNeed::new(2, 3),
    FuturePairNeed::new(6, 7),
  ];
  plan_spectral_requests(8, &requests, &pair_consumers)
}

fn deterministic_pcm(frames: usize, channels: u16) -> Vec<f32> {
  let channels = channels as usize;
  (0..frames)
    .flat_map(|frame| {
      (0..channels).map(move |channel| {
        let phase = (frame * (channel + 1)) as f32 * 0.013;
        phase.sin() * (0.5 / (channel + 1) as f32)
      })
    })
    .collect()
}

fn for_each_production_block(pcm: &[f32], channels: u16, mut visit: impl FnMut(&[f32], usize)) {
  let channels = channels.max(1) as usize;
  let block_samples = PRODUCTION_BLOCK_FRAMES * channels;
  let mut processed_frames = 0;
  for block in pcm.chunks(block_samples) {
    let block_frames = block.len() / channels;
    processed_frames += block_frames;
    visit(block, processed_frames);
  }
}

fn shared_invocations(plan: &SpectralPlan, pcm: &[f32], channels: u16) -> u64 {
  let mut engine = SharedSpectralEngine::new();
  engine.update_streams(plan.streams.iter().copied());
  let topology = engine.fft_topology();
  assert_eq!(topology.stream_count, plan.streams.len());
  assert_eq!(topology.total_transform_count, plan.streams.len() * 3);
  for fft_size in [FFT_BIG, FFT_MID, FFT_SMALL] {
    assert_eq!(topology.transform_count(fft_size), plan.streams.len());
  }

  let mut invocations = 0_u64;
  for_each_production_block(pcm, channels, |block, _| {
    engine.push_interleaved(block, channels, |frames| {
      frames.for_each_due(|_| invocations += 1);
    });
  });
  invocations
}

struct SpectralMemoryEstimates {
  scratch_estimate_bytes: usize,
  persistent_transform_buffer_estimate_bytes: usize,
  consumer_grid_array_lower_bound_bytes: usize,
  consumer_curve_array_lower_bound_bytes: usize,
  consumer_persistent_array_lower_bound_bytes: usize,
}

fn spectral_memory_estimates(plan: &SpectralPlan) -> SpectralMemoryEstimates {
  let fft_sizes = [FFT_BIG, FFT_MID, FFT_SMALL];
  let persistent_per_stream = fft_sizes
    .iter()
    .map(|&size| 2 * size * size_of::<f32>() + (size / 2 + 1) * size_of::<Complex32>())
    .sum::<usize>();
  // Conservative scratch estimate: real input plus up to one complex value per FFT sample.
  // FFT plan allocations are intentionally excluded because realfft does not expose their size.
  let scratch_per_stream = fft_sizes
    .iter()
    .map(|&size| size * size_of::<f32>() + size * size_of::<Complex32>())
    .sum::<usize>();

  let (min_hz, max_hz) = spectrum_frequency_bounds(SAMPLE_RATE as f64);
  let grid_points = SpectrumGrid::new(SAMPLE_RATE as f64, min_hz, max_hz)
    .freqs()
    .len();
  let grid_tap_payload_bytes = 3 * size_of::<BinTap>() + 2 * size_of::<f64>();
  let grid_array_bytes = grid_points * (size_of::<f64>() + grid_tap_payload_bytes);
  let resolution_psd_bytes = fft_sizes
    .iter()
    .map(|&size| (size / 2 + 1) * size_of::<f64>())
    .sum::<usize>();
  let consumer_grid_array_lower_bound_bytes = plan.consumers.len() * grid_array_bytes;
  let consumer_curve_array_lower_bound_bytes = plan
    .consumers
    .iter()
    .map(|binding| {
      let curve_count = if matches!(
        binding.projection,
        ConsumerProjection::Lr | ConsumerProjection::Ms
      ) {
        2
      } else {
        1
      };
      let display_row_count = 5 + usize::from(binding.settings.octave_smoothing != "off");
      let curve_array_bytes =
        resolution_psd_bytes + display_row_count * grid_points * size_of::<f64>();
      curve_count * curve_array_bytes
    })
    .sum();
  let consumer_persistent_array_lower_bound_bytes =
    consumer_grid_array_lower_bound_bytes + consumer_curve_array_lower_bound_bytes;

  SpectralMemoryEstimates {
    scratch_estimate_bytes: scratch_per_stream * plan.streams.len(),
    persistent_transform_buffer_estimate_bytes: persistent_per_stream * plan.streams.len(),
    consumer_grid_array_lower_bound_bytes,
    consumer_curve_array_lower_bound_bytes,
    consumer_persistent_array_lower_bound_bytes,
  }
}

fn report_scenario(name: &str, plan: &SpectralPlan, channels: u16) -> u64 {
  let pcm = deterministic_pcm(AUDIO_FRAMES, channels);
  let invocations = shared_invocations(plan, &pcm, channels);
  let memory = spectral_memory_estimates(plan);
  eprintln!(
    "{name}: streams={}, transforms={}, consumers={}, fft_invocations={}, audio_seconds={:.3}, \
     scratch_estimate_bytes={}, persistent_transform_buffer_estimate_bytes={}, \
     consumer_grid_array_lower_bound_bytes={}, consumer_curve_array_lower_bound_bytes={}, \
     consumer_persistent_array_lower_bound_bytes={}",
    plan.streams.len(),
    plan.streams.len() * 3,
    plan.consumers.len(),
    invocations,
    AUDIO_FRAMES as f64 / SAMPLE_RATE as f64,
    memory.scratch_estimate_bytes,
    memory.persistent_transform_buffer_estimate_bytes,
    memory.consumer_grid_array_lower_bound_bytes,
    memory.consumer_curve_array_lower_bound_bytes,
    memory.consumer_persistent_array_lower_bound_bytes
  );
  invocations
}

fn shared_runtime(plan: &SpectralPlan) -> SharedSpectralRuntime {
  let mut runtime = SharedSpectralRuntime::new(SAMPLE_RATE as f64);
  runtime.update_plan(plan.clone());
  runtime
}

fn legacy_meter(binding: &SpectralConsumerBinding) -> SpectrumMeter {
  let smoothing = match binding.settings.octave_smoothing.as_str() {
    "1/12" => OctaveSmoothing::OneTwelfth,
    "1/6" => OctaveSmoothing::OneSixth,
    "1/3" => OctaveSmoothing::OneThird,
    _ => OctaveSmoothing::Off,
  };
  let mut meter = SpectrumMeter::new(SAMPLE_RATE as f64);
  meter.set_display_controls(
    binding.settings.speed_percent,
    binding.settings.tilt_db_per_octave,
    smoothing,
  );
  meter
}

fn push_shared_in_production_blocks(
  runtime: &mut SharedSpectralRuntime,
  plan: &SpectralPlan,
  pcm: &[f32],
  channels: u16,
) {
  for_each_production_block(pcm, channels, |block, processed_frames| {
    runtime.push_interleaved(block, channels);
    let dsp_time =
      SpectralDspTime::from_monotonic_seconds(processed_frames as f64 / SAMPLE_RATE as f64);
    for binding in &plan.consumers {
      black_box(runtime.consumer_output_at_dsp_time(&binding.request_key, dsp_time));
    }
  });
}

fn push_legacy_in_production_blocks(meters: &mut [SpectrumMeter], pcm: &[f32], channels: u16) {
  for_each_production_block(pcm, channels, |block, processed_frames| {
    let now_sec = processed_frames as f64 / SAMPLE_RATE as f64;
    for meter in &mut *meters {
      black_box(meter.push_selected(
        block,
        channels,
        now_sec,
        channel_sel::SpectrumChannelSel::Pair(0, 1),
      ));
    }
  });
}

fn spectral_fft_count(c: &mut Criterion) {
  let lone = lone_combined_plan();
  let duplicate = duplicate_combined_plan();
  let mixed = mixed_plan();
  assert_eq!(lone.streams.len(), 1);
  assert_eq!(duplicate.streams.len(), 1);
  assert_eq!(
    duplicate.streams, lone.streams,
    "duplicate consumers must reuse the lone Combined projection"
  );
  assert_eq!(
    mixed.streams,
    vec![
      TransformStreamId::Physical(0),
      TransformStreamId::Physical(1),
      TransformStreamId::Physical(2),
      TransformStreamId::Physical(3),
      TransformStreamId::Physical(6),
      TransformStreamId::Physical(7),
      TransformStreamId::Projection {
        first: 4,
        second: 5,
        kind: spectral_plan::ProjectionKind::Combined,
      },
    ]
  );

  let lone_invocations = report_scenario("lone_combined", &lone, 2);
  let duplicate_invocations = report_scenario("duplicate_combined", &duplicate, 2);
  let mixed_invocations = report_scenario("four_spectrum_plus_four_pair_consumers", &mixed, 8);
  assert_eq!(duplicate_invocations, lone_invocations);
  assert_eq!(mixed_invocations, lone_invocations * 7);
  eprintln!(
    "duplicate-channel reduction: shared={} versus per-key banks={} FFT invocations (50%)",
    duplicate_invocations,
    duplicate_invocations * 2
  );
  eprintln!(
    "Criterion throughput unit: one element is one microsecond of audio; 1.0 Melem/s = 1.0x realtime"
  );
  eprintln!(
    "production block cadence: {} frames ({:.1} ms at {} Hz), {} blocks including a {}-frame tail; \
     basis=cpal BufferSize::Default with representative Windows/WASAPI 10 ms period",
    PRODUCTION_BLOCK_FRAMES,
    PRODUCTION_BLOCK_FRAMES as f64 * 1000.0 / SAMPLE_RATE as f64,
    SAMPLE_RATE,
    AUDIO_FRAMES.div_ceil(PRODUCTION_BLOCK_FRAMES),
    AUDIO_FRAMES % PRODUCTION_BLOCK_FRAMES
  );
  eprintln!(
    "memory exclusions (unmeasured): realfft plan allocations, allocator/container overhead, \
     BTreeMap nodes, String capacity, and non-array runtime metadata"
  );

  let audio_microseconds = (AUDIO_FRAMES as u64 * 1_000_000).div_ceil(SAMPLE_RATE as u64);
  let stereo_pcm = deterministic_pcm(AUDIO_FRAMES, 2);
  let mixed_pcm = deterministic_pcm(AUDIO_FRAMES, 8);

  let mut migration = c.benchmark_group("lone_combined_migration_overhead");
  migration.throughput(Throughput::Elements(audio_microseconds));
  migration.bench_function("legacy_spectrum_meter", |b| {
    b.iter_batched(
      || vec![legacy_meter(&lone.consumers[0])],
      |mut meters| {
        push_legacy_in_production_blocks(&mut meters, black_box(&stereo_pcm), 2);
      },
      BatchSize::SmallInput,
    );
  });
  migration.bench_function("shared_runtime", |b| {
    b.iter_batched(
      || shared_runtime(&lone),
      |mut runtime| {
        push_shared_in_production_blocks(&mut runtime, &lone, black_box(&stereo_pcm), 2);
        black_box(runtime);
      },
      BatchSize::SmallInput,
    );
  });
  migration.finish();

  let mut duplicate_group = c.benchmark_group("duplicate_channel_reduction");
  duplicate_group.throughput(Throughput::Elements(audio_microseconds));
  duplicate_group.bench_function("two_per_key_spectrum_meters", |b| {
    b.iter_batched(
      || {
        duplicate
          .consumers
          .iter()
          .map(legacy_meter)
          .collect::<Vec<_>>()
      },
      |mut meters| {
        push_legacy_in_production_blocks(&mut meters, black_box(&stereo_pcm), 2);
      },
      BatchSize::SmallInput,
    );
  });
  duplicate_group.bench_function("one_shared_stream_two_consumers", |b| {
    b.iter_batched(
      || shared_runtime(&duplicate),
      |mut runtime| {
        push_shared_in_production_blocks(&mut runtime, &duplicate, black_box(&stereo_pcm), 2);
        black_box(runtime);
      },
      BatchSize::SmallInput,
    );
  });
  duplicate_group.finish();

  let mut mixed_group = c.benchmark_group("planned_topologies");
  mixed_group.throughput(Throughput::Elements(audio_microseconds));
  mixed_group.bench_with_input(
    BenchmarkId::new("four_spectrum_four_pair_consumers", mixed.streams.len()),
    &mixed,
    |b, plan| {
      b.iter_batched(
        || shared_runtime(plan),
        |mut runtime| {
          push_shared_in_production_blocks(&mut runtime, plan, black_box(&mixed_pcm), 8);
          black_box(runtime);
        },
        BatchSize::SmallInput,
      );
    },
  );
  mixed_group.finish();
}

criterion_group!(benches, spectral_fft_count);
criterion_main!(benches);
