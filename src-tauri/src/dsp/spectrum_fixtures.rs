use std::f64::consts::TAU;

use super::spectrum_bank::{FFT_BIG, OVERLAP_BIG};

pub(crate) const SAMPLE_RATES: [f64; 3] = [44_100.0, 48_000.0, 96_000.0];
pub(crate) const FIXTURE_FRAMES: usize = FFT_BIG + FFT_BIG / OVERLAP_BIG * 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FixtureKind {
  Silence,
  Impulse,
  BinAlignedTone,
  NonAlignedTone,
  WhiteNoise,
  IndependentNoise,
  HardLeft,
  HardRight,
  EqualInPhase,
  UnequalInPhase,
  AntiPhase,
  Quadrature,
}

pub(crate) const ALL_FIXTURES: [FixtureKind; 12] = [
  FixtureKind::Silence,
  FixtureKind::Impulse,
  FixtureKind::BinAlignedTone,
  FixtureKind::NonAlignedTone,
  FixtureKind::WhiteNoise,
  FixtureKind::IndependentNoise,
  FixtureKind::HardLeft,
  FixtureKind::HardRight,
  FixtureKind::EqualInPhase,
  FixtureKind::UnequalInPhase,
  FixtureKind::AntiPhase,
  FixtureKind::Quadrature,
];

impl FixtureKind {
  pub(crate) fn name(self) -> &'static str {
    match self {
      Self::Silence => "silence",
      Self::Impulse => "impulse",
      Self::BinAlignedTone => "bin-aligned tone",
      Self::NonAlignedTone => "non-aligned tone",
      Self::WhiteNoise => "seeded white noise",
      Self::IndependentNoise => "independent L/R noise",
      Self::HardLeft => "hard-left",
      Self::HardRight => "hard-right",
      Self::EqualInPhase => "equal in-phase",
      Self::UnequalInPhase => "unequal in-phase",
      Self::AntiPhase => "anti-phase",
      Self::Quadrature => "90-degree pair",
    }
  }
}

pub(crate) struct StereoFixture {
  pub kind: FixtureKind,
  pub name: &'static str,
  pub sample_rate: f64,
  pub interleaved: Vec<f32>,
}

fn next_noise(state: &mut u32) -> f32 {
  *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
  ((*state >> 8) as f32 / 8_388_608.0) - 1.0
}

pub(crate) fn fixture(kind: FixtureKind, sample_rate: f64) -> StereoFixture {
  let aligned_hz = sample_rate * 341.0 / FFT_BIG as f64;
  let non_aligned_hz = 997.3;
  let mut common_noise = 0xC0FF_EE11_u32;
  let mut left_noise = 0x1234_5678_u32;
  let mut right_noise = 0x8765_4321_u32;
  let mut interleaved = Vec::with_capacity(FIXTURE_FRAMES * 2);

  for frame in 0..FIXTURE_FRAMES {
    let phase = TAU * aligned_hz * frame as f64 / sample_rate;
    let non_aligned_phase = TAU * non_aligned_hz * frame as f64 / sample_rate;
    let tone = (0.8 * phase.sin()) as f32;
    let non_aligned = (0.8 * non_aligned_phase.sin()) as f32;
    let (left, right) = match kind {
      FixtureKind::Silence => (0.0, 0.0),
      FixtureKind::Impulse => {
        let value = if frame == FFT_BIG / 2 { 1.0 } else { 0.0 };
        (value, value)
      }
      FixtureKind::BinAlignedTone => (tone, tone),
      FixtureKind::NonAlignedTone => (non_aligned, non_aligned),
      FixtureKind::WhiteNoise => {
        let value = next_noise(&mut common_noise) * 0.5;
        (value, value)
      }
      FixtureKind::IndependentNoise => (
        next_noise(&mut left_noise) * 0.5,
        next_noise(&mut right_noise) * 0.5,
      ),
      FixtureKind::HardLeft => (tone, 0.0),
      FixtureKind::HardRight => (0.0, tone),
      FixtureKind::EqualInPhase => (tone, tone),
      FixtureKind::UnequalInPhase => (tone, tone * 0.35),
      FixtureKind::AntiPhase => (tone, -tone),
      FixtureKind::Quadrature => (tone, (0.8 * phase.cos()) as f32),
    };
    interleaved.extend_from_slice(&[left, right]);
  }

  StereoFixture {
    kind,
    name: kind.name(),
    sample_rate,
    interleaved,
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Chunking {
  OneSample,
  Irregular,
  CaptureLike,
}

pub(crate) const ALL_CHUNKINGS: [Chunking; 3] = [
  Chunking::OneSample,
  Chunking::Irregular,
  Chunking::CaptureLike,
];

impl Chunking {
  pub(crate) fn name(self) -> &'static str {
    match self {
      Self::OneSample => "one-sample",
      Self::Irregular => "irregular",
      Self::CaptureLike => "capture-like",
    }
  }

  fn pattern(self) -> &'static [usize] {
    match self {
      Self::OneSample => &[1],
      Self::Irregular => &[7, 511, 3, 2_047, 89, 1_025, 13, 333],
      Self::CaptureLike => &[256, 480, 512, 960, 1_024],
    }
  }
}

pub(crate) fn chunk_ranges(total_frames: usize, chunking: Chunking) -> Vec<(usize, usize)> {
  let pattern = chunking.pattern();
  let mut ranges = Vec::new();
  let mut start = 0;
  let mut index = 0;
  while start < total_frames {
    let end = (start + pattern[index % pattern.len()]).min(total_frames);
    ranges.push((start, end));
    start = end;
    index += 1;
  }
  ranges
}

#[test]
fn deterministic_fixture_catalog_covers_required_signals_rates_and_chunkings() {
  assert_eq!(SAMPLE_RATES, [44_100.0, 48_000.0, 96_000.0]);
  assert_eq!(ALL_FIXTURES.len(), 12);
  assert_eq!(ALL_CHUNKINGS.len(), 3);

  for kind in ALL_FIXTURES {
    let first = fixture(kind, 48_000.0);
    let second = fixture(kind, 48_000.0);
    assert_eq!(first.interleaved, second.interleaved, "{}", kind.name());
    assert_eq!(first.interleaved.len(), FIXTURE_FRAMES * 2);
  }
  let impulse = fixture(FixtureKind::Impulse, 48_000.0);
  assert_eq!(impulse.interleaved[FFT_BIG], 1.0);
  assert_eq!(impulse.interleaved[FFT_BIG + 1], 1.0);

  for chunking in ALL_CHUNKINGS {
    let ranges = chunk_ranges(FIXTURE_FRAMES, chunking);
    assert_eq!(ranges.first().map(|range| range.0), Some(0));
    assert_eq!(ranges.last().map(|range| range.1), Some(FIXTURE_FRAMES));
    assert!(ranges.windows(2).all(|pair| pair[0].1 == pair[1].0));
  }
}
