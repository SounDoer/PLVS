#![allow(dead_code, unused_imports)]

use std::hint::black_box;
use std::time::Duration;

use criterion::{criterion_group, criterion_main, Criterion};
use rustfft::num_complex::Complex32;

#[path = "../src/dsp/spectral_transform.rs"]
pub(crate) mod spectral_transform;
#[path = "../src/dsp/spectrum_bank.rs"]
pub(crate) mod spectrum_bank;
#[path = "../src/dsp/stereo_map.rs"]
mod stereo_map;

mod dsp {
  pub(crate) use crate::spectral_transform;
  pub(crate) use crate::spectrum_bank;

  pub(crate) mod shared_spectral_engine {
    pub(crate) mod allocation_counter {
      pub(crate) fn count_current_thread_allocations<T>(callback: impl FnOnce() -> T) -> usize {
        callback();
        0
      }
    }
  }
}

use spectral_transform::ComplexSpectralFrame;
use spectrum_bank::{OctaveSmoothing, FFT_BIG, FFT_MID, FFT_SMALL};
use stereo_map::StereoMapConsumer;

const SAMPLE_RATE: f64 = 48_000.0;

struct PairFixture {
  fft_size: usize,
  left: Vec<Complex32>,
  right: Vec<Complex32>,
}

fn fixture(fft_size: usize) -> PairFixture {
  let bins = fft_size / 2 + 1;
  PairFixture {
    fft_size,
    left: (0..bins)
      .map(|index| {
        let phase = index as f32 * 0.017;
        Complex32::new(phase.sin() * 0.7, phase.cos() * 0.3)
      })
      .collect(),
    right: (0..bins)
      .map(|index| {
        let phase = index as f32 * 0.019 + 0.4;
        Complex32::new(phase.sin() * 0.6, phase.cos() * 0.25)
      })
      .collect(),
  }
}

fn consume(consumer: &mut StereoMapConsumer, fixtures: &[PairFixture], clock: u64) {
  for fixture in fixtures {
    let left = ComplexSpectralFrame {
      fft_size: fixture.fft_size,
      sample_clock: clock,
      bins: &fixture.left,
    };
    let right = ComplexSpectralFrame {
      fft_size: fixture.fft_size,
      sample_clock: clock,
      bins: &fixture.right,
    };
    assert!(consumer.consume_aligned(&left, &right));
  }
}

fn warmed_consumer(fixtures: &[PairFixture], smoothing: OctaveSmoothing) -> StereoMapConsumer {
  let mut consumer = StereoMapConsumer::for_sample_rate(SAMPLE_RATE);
  consumer.set_display_controls(50.0, smoothing);
  consume(&mut consumer, fixtures, 1);
  black_box(consumer.output());
  consumer
}

fn stereo_map_benchmark(c: &mut Criterion) {
  let fixtures = [fixture(FFT_BIG), fixture(FFT_MID), fixture(FFT_SMALL)];
  let mut group = c.benchmark_group("stereo_map");

  group.bench_function("output_958_bands_no_smoothing", |b| {
    let mut consumer = warmed_consumer(&fixtures, OctaveSmoothing::Off);
    b.iter(|| black_box(consumer.output().map(|row| row.pl[0])));
  });
  group.bench_function("output_958_bands_one_twelfth_octave", |b| {
    let mut consumer = warmed_consumer(&fixtures, OctaveSmoothing::OneTwelfth);
    b.iter(|| black_box(consumer.output().map(|row| row.pl[0])));
  });
  group.bench_function("consume_three_resolutions_and_output", |b| {
    let mut consumer = warmed_consumer(&fixtures, OctaveSmoothing::OneTwelfth);
    let mut clock = 2_u64;
    b.iter(|| {
      consume(&mut consumer, black_box(&fixtures), clock);
      clock += 1;
      black_box(consumer.output().map(|row| row.pl[0]));
    });
  });
  group.finish();
}

criterion_group! {
  name = benches;
  config = Criterion::default()
    .warm_up_time(Duration::from_secs(1))
    .measurement_time(Duration::from_secs(3))
    .sample_size(30);
  targets = stereo_map_benchmark
}
criterion_main!(benches);
