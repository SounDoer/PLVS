#![allow(dead_code, unused_imports)]

use std::collections::VecDeque;
use std::fmt::Write as _;
use std::hint::black_box;
use std::time::Duration;

use criterion::{criterion_group, criterion_main, BatchSize, Criterion};

mod meter {
  pub(crate) struct PcmContext<'a> {
    pub(crate) interleaved: &'a [f32],
    pub(crate) channels: u16,
    pub(crate) vectorscope_pair: (u16, u16),
  }

  pub(crate) trait Meter {
    fn push_pcm(&mut self, ctx: &PcmContext<'_>);
    fn reset(&mut self);
  }
}

#[path = "../src/dsp/vectorscope.rs"]
mod vectorscope;

use meter::{Meter, PcmContext};
use vectorscope::VectorscopeMeter;

const WINDOW_FRAMES: usize = 4096;
const CALLBACK_FRAMES: usize = 480;
const HISTORY_POINTS: usize = 100;
const LIVE_POINT_COUNT: usize = WINDOW_FRAMES.div_ceil(6);

fn deterministic_pcm(frames: usize) -> Vec<f32> {
  (0..frames)
    .flat_map(|frame| {
      let phase = frame as f32 * 0.031;
      [phase.sin() * 0.73, (phase * 1.013 + 0.41).sin() * 0.67]
    })
    .collect()
}

fn push(meter: &mut VectorscopeMeter, pcm: &[f32]) {
  meter.push_pcm(&PcmContext {
    interleaved: pcm,
    channels: 2,
    vectorscope_pair: (0, 1),
  });
}

fn filled_meter(window_pcm: &[f32]) -> VectorscopeMeter {
  let mut meter = VectorscopeMeter::new();
  push(&mut meter, window_pcm);
  meter
}

fn vectorscope_benchmark(c: &mut Criterion) {
  let window_pcm = deterministic_pcm(WINDOW_FRAMES);
  let callback_pcm = deterministic_pcm(CALLBACK_FRAMES);

  let left = window_pcm.iter().step_by(2).copied().collect::<Vec<_>>();
  let right = window_pcm
    .iter()
    .skip(1)
    .step_by(2)
    .copied()
    .collect::<Vec<_>>();
  let left_ring = left.iter().copied().collect::<VecDeque<_>>();
  let right_ring = right.iter().copied().collect::<VecDeque<_>>();
  let coordinates = (0..LIVE_POINT_COUNT)
    .map(|index| {
      let phase = index as f64 * 0.071;
      (130.0 + phase.sin() * 90.0, 130.0 - phase.cos() * 90.0)
    })
    .collect::<Vec<_>>();

  let mut output = c.benchmark_group("vectorscope_output");
  output.bench_function("svg_path_683_points", |b| {
    let mut meter = filled_meter(&window_pcm);
    b.iter(|| black_box(meter.get_output()));
  });
  output.bench_function("history_100_pairs", |b| {
    let mut meter = filled_meter(&window_pcm);
    b.iter(|| black_box(meter.get_history_pairs(HISTORY_POINTS)));
  });
  output.bench_function("clone_two_flat_vectors", |b| {
    b.iter(|| black_box((left.clone(), right.clone())));
  });
  output.bench_function("flatten_two_rings", |b| {
    let mut flat_left = Vec::with_capacity(WINDOW_FRAMES);
    let mut flat_right = Vec::with_capacity(WINDOW_FRAMES);
    b.iter(|| {
      flat_left.clear();
      flat_right.clear();
      flat_left.extend(left_ring.iter().copied());
      flat_right.extend(right_ring.iter().copied());
      black_box((&flat_left, &flat_right));
    });
  });
  output.bench_function("format_and_join_683_points", |b| {
    b.iter(|| {
      let points = coordinates
        .iter()
        .map(|(x, y)| format!("{x:.2} {y:.2}"))
        .collect::<Vec<_>>();
      black_box(format!("M {}", points.join(" L ")))
    });
  });
  output.bench_function("format_direct_683_points", |b| {
    b.iter(|| {
      let mut path = String::with_capacity(11_000);
      path.push_str("M ");
      for (index, (x, y)) in coordinates.iter().enumerate() {
        if index > 0 {
          path.push_str(" L ");
        }
        write!(&mut path, "{x:.2} {y:.2}").unwrap();
      }
      black_box(path)
    });
  });
  output.finish();

  let mut cadence = c.benchmark_group("vectorscope_frame_cadence");
  cadence.bench_function("one_key_live_frame", |b| {
    b.iter_batched(
      || filled_meter(&window_pcm),
      |mut meter| {
        push(&mut meter, black_box(&callback_pcm));
        black_box(meter.get_output());
      },
      BatchSize::SmallInput,
    );
  });
  cadence.bench_function("one_key_live_plus_history", |b| {
    b.iter_batched(
      || filled_meter(&window_pcm),
      |mut meter| {
        push(&mut meter, black_box(&callback_pcm));
        black_box(meter.get_output());
        black_box(meter.get_history_pairs(HISTORY_POINTS));
      },
      BatchSize::SmallInput,
    );
  });
  cadence.bench_function("four_keys_live_frame", |b| {
    b.iter_batched(
      || {
        (0..4)
          .map(|_| filled_meter(&window_pcm))
          .collect::<Vec<_>>()
      },
      |mut meters| {
        for meter in &mut meters {
          push(meter, black_box(&callback_pcm));
          black_box(meter.get_output());
        }
      },
      BatchSize::SmallInput,
    );
  });
  cadence.finish();
}

criterion_group! {
  name = benches;
  config = Criterion::default()
    .warm_up_time(Duration::from_secs(1))
    .measurement_time(Duration::from_secs(3))
    .sample_size(30);
  targets = vectorscope_benchmark
}
criterion_main!(benches);
