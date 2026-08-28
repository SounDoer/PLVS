use std::collections::BTreeMap;

use super::shared_spectral_engine::SharedSpectralEngine;
use super::spectrum::SpectrumMeter;
use super::spectrum_bank::OctaveSmoothing;
use super::spectrum_consumer::{SpectralConsumer, SpectralProjection};
use super::spectrum_fixtures::{
  chunk_ranges, fixture, Chunking, FixtureKind, StereoFixture, ALL_CHUNKINGS, ALL_FIXTURES,
  SAMPLE_RATES,
};
use crate::dsp::{SpectrumChannelSel, SpectrumView};
use crate::engine::spectral_plan::{
  plan_spectral_requests, ConsumerInput, ConsumerProjection, FuturePairNeed,
  SpectralConsumerBinding,
};
use crate::ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};

// No raw value is skipped: finite checks and a delta assertion apply on both sides of the UI's
// -120 dB analysis floor.
const NUMERICAL_FLOOR_DB: f64 = -120.0;
const DIRECT_SMOOTH_TOLERANCE_DB: f64 = 0.0;
const DIRECT_PEAK_TOLERANCE_DB: f64 = 0.0;
const DIRECT_LOW_FLOOR_SMOOTH_TOLERANCE_DB: f64 = 0.0;
const DIRECT_LOW_FLOOR_PEAK_TOLERANCE_DB: f64 = 0.0;
// Physical M/S and physical-pair Combined combine already-rounded f32 bins, while legacy combines
// f32 PCM before FFT. The exhaustive cancellation matrix measured 0.022409178746 dB above the
// -120 dB analysis floor; 0.0225 dB is the smallest rounded route-specific bound. Smooth and peak
// share it because peak initializes from, and subsequently envelopes, the same projected row.
const COMPLEX_SMOOTH_TOLERANCE_DB: f64 = 0.0225;
const COMPLEX_PEAK_TOLERANCE_DB: f64 = 0.0225;
// The exhaustive matrix measured 15.746407002962 dB in the explicitly named,
// cancellation-dominated low-floor bands selected by `is_named_cancellation_output`. 15.75 dB is
// the smallest rounded bound for those bands only.
const CANCELLATION_LOW_FLOOR_SMOOTH_TOLERANCE_DB: f64 = 15.75;
const CANCELLATION_LOW_FLOOR_PEAK_TOLERANCE_DB: f64 = 15.75;

#[derive(Debug, Clone, Copy)]
enum NumericRoute {
  Direct,
  PhysicalComplexCombination,
}

#[derive(Debug, Clone, Copy)]
enum RowKind {
  Smooth,
  Peak,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CurveKind {
  Primary,
  Secondary,
}

#[derive(Debug, Clone, Copy)]
struct ComparisonContext {
  fixture: FixtureKind,
  view: SpectrumView,
  curve: CurveKind,
  route: NumericRoute,
}

impl ComparisonContext {
  fn with_curve(self, curve: CurveKind) -> Self {
    Self { curve, ..self }
  }
}

#[derive(Debug, Clone, Copy)]
enum NumericRegion {
  Regular,
  LowFloor,
}

#[derive(Debug, Clone, Copy, Default)]
struct RowMaxima {
  regular: f64,
  low_floor: f64,
}

impl RowMaxima {
  fn merge(&mut self, other: Self) {
    self.regular = self.regular.max(other.regular);
    self.low_floor = self.low_floor.max(other.low_floor);
  }
}

#[derive(Debug, Clone, Copy, Default)]
struct ComparisonMaxima {
  smooth: RowMaxima,
  peak: RowMaxima,
}

impl ComparisonMaxima {
  fn merge(&mut self, other: Self) {
    self.smooth.merge(other.smooth);
    self.peak.merge(other.peak);
  }
}

#[derive(Debug, Clone, Copy)]
struct Case {
  selection: SpectrumChannelSel,
  view: SpectrumView,
  speed: f64,
  smoothing: OctaveSmoothing,
  force_physical_pair: bool,
}

impl Case {
  fn combined() -> Self {
    Self {
      selection: SpectrumChannelSel::Pair(0, 1),
      view: SpectrumView::Combined,
      speed: 25.0,
      smoothing: OctaveSmoothing::Off,
      force_physical_pair: false,
    }
  }

  fn numeric_route(self) -> NumericRoute {
    if self.view == SpectrumView::Ms
      || (self.view == SpectrumView::Combined && self.force_physical_pair)
    {
      NumericRoute::PhysicalComplexCombination
    } else {
      NumericRoute::Direct
    }
  }
}

#[derive(Debug, Clone, PartialEq)]
struct Snapshot {
  centers: Vec<f64>,
  smooth: Vec<f64>,
  peak: Vec<f64>,
  secondary: Option<(Vec<f64>, Vec<f64>)>,
}

struct LegacyRunner {
  meter: SpectrumMeter,
  case: Case,
}

impl LegacyRunner {
  fn new(sample_rate: f64, case: Case) -> Self {
    let mut meter = SpectrumMeter::new(sample_rate);
    meter.set_display_controls(case.speed, case.smoothing);
    Self { meter, case }
  }

  fn push(&mut self, interleaved: &[f32], now_sec: f64) -> Option<Snapshot> {
    self
      .meter
      .push_pair(interleaved, 2, now_sec, self.case.selection, self.case.view);
    snapshot_legacy(&self.meter)
  }

  fn reset(&mut self, sample_rate: f64) {
    *self = Self::new(sample_rate, self.case);
  }
}

struct SharedRunner {
  sample_rate: f64,
  case: Case,
  request_key: String,
  bindings: Vec<SpectralConsumerBinding>,
  engine: SharedSpectralEngine,
  consumers: BTreeMap<String, SpectralConsumer>,
  publishable: BTreeMap<String, bool>,
}

impl SharedRunner {
  fn new(sample_rate: f64, case: Case) -> Self {
    let request_key = "differential".to_string();
    let channel = match case.selection {
      SpectrumChannelSel::Single(ch) => SpectrumAnalysisChannel::Single { ch },
      SpectrumChannelSel::Pair(x, y) => SpectrumAnalysisChannel::Pair { x, y },
    };
    let view = match case.view {
      SpectrumView::Combined => "combined",
      SpectrumView::Lr => "lr",
      SpectrumView::Ms => "ms",
    };
    let request = SpectrumAnalysisRequest {
      key: request_key.clone(),
      channel,
      view: view.to_string(),
      speed_percent: case.speed,
      octave_smoothing: smoothing_token(case.smoothing).to_string(),
    };
    let future_pair_needs = if case.force_physical_pair {
      match case.selection {
        SpectrumChannelSel::Pair(x, y) => vec![FuturePairNeed::new(x, y)],
        SpectrumChannelSel::Single(_) => Vec::new(),
      }
    } else {
      Vec::new()
    };
    let plan = plan_spectral_requests(2, &[request], &future_pair_needs);
    let mut engine = SharedSpectralEngine::new();
    engine.update_streams(plan.streams.iter().copied());
    let consumers = plan
      .consumers
      .iter()
      .map(|binding| {
        let projection = match binding.projection {
          ConsumerProjection::Single => SpectralProjection::Single,
          ConsumerProjection::Combined => SpectralProjection::Combined,
          ConsumerProjection::Lr => SpectralProjection::Lr,
          ConsumerProjection::Ms => SpectralProjection::Ms,
        };
        let mut consumer = SpectralConsumer::new_projected(
          sample_rate,
          20.0,
          (sample_rate * 0.499).min(20_000.0),
          projection,
        );
        consumer.set_display_controls(
          binding.settings.speed_percent,
          parse_smoothing(&binding.settings.octave_smoothing),
        );
        (binding.request_key.clone(), consumer)
      })
      .collect();
    let publishable = plan
      .consumers
      .iter()
      .map(|binding| (binding.request_key.clone(), false))
      .collect();
    Self {
      sample_rate,
      case,
      request_key,
      bindings: plan.consumers,
      engine,
      consumers,
      publishable,
    }
  }

  fn push_pcm(&mut self, interleaved: &[f32]) {
    let bindings = &self.bindings;
    let consumers = &mut self.consumers;
    let publishable = &mut self.publishable;
    self.engine.push_interleaved(interleaved, 2, |frames| {
      for binding in bindings {
        let consumer = consumers
          .get_mut(&binding.request_key)
          .expect("request-keyed consumer");
        match binding.input {
          ConsumerInput::Single(stream) => {
            frames.for_each_due(|frame| {
              if frame.stream_id == stream {
                if frame.all_three_ready {
                  publishable.insert(binding.request_key.clone(), true);
                }
                consumer.consume(&frame.as_complex());
              }
            });
          }
          ConsumerInput::Pair { first, second } => {
            for fft_size in [
              super::spectrum_bank::FFT_BIG,
              super::spectrum_bank::FFT_MID,
              super::spectrum_bank::FFT_SMALL,
            ] {
              if let (Some(first), Some(second)) = (
                frames.frame(first, fft_size),
                frames.frame(second, fft_size),
              ) {
                if first.all_three_ready && second.all_three_ready {
                  publishable.insert(binding.request_key.clone(), true);
                }
                assert!(consumer.consume_aligned(&first.as_complex(), Some(&second.as_complex())));
              }
            }
          }
        }
      }
    });
  }

  fn output(&mut self, now_sec: f64) -> Option<Snapshot> {
    if !self
      .publishable
      .get(&self.request_key)
      .copied()
      .unwrap_or(false)
    {
      return None;
    }
    let output = self
      .consumers
      .get_mut(&self.request_key)
      .expect("differential consumer")
      .output(now_sec)?;
    Some(Snapshot {
      centers: output.centers_hz.to_vec(),
      smooth: output.smooth_db.to_vec(),
      peak: output.peak_db.to_vec(),
      secondary: output
        .secondary
        .map(|curve| (curve.smooth_db.to_vec(), curve.peak_db.to_vec())),
    })
  }

  fn reset(&mut self) {
    *self = Self::new(self.sample_rate, self.case);
  }
}

fn smoothing_token(smoothing: OctaveSmoothing) -> &'static str {
  match smoothing {
    OctaveSmoothing::Off => "off",
    OctaveSmoothing::OneTwelfth => "1/12",
    OctaveSmoothing::OneSixth => "1/6",
    OctaveSmoothing::OneThird => "1/3",
  }
}

fn parse_smoothing(value: &str) -> OctaveSmoothing {
  match value {
    "1/12" => OctaveSmoothing::OneTwelfth,
    "1/6" => OctaveSmoothing::OneSixth,
    "1/3" => OctaveSmoothing::OneThird,
    _ => OctaveSmoothing::Off,
  }
}

fn snapshot_legacy(meter: &SpectrumMeter) -> Option<Snapshot> {
  let (centers, smooth, peak) = meter.last_output();
  if centers.is_empty() {
    return None;
  }
  Some(Snapshot {
    centers: centers.to_vec(),
    smooth: smooth.to_vec(),
    peak: peak.to_vec(),
    secondary: meter
      .last_output_secondary()
      .map(|(smooth, peak)| (smooth.to_vec(), peak.to_vec())),
  })
}

fn is_named_cancellation_output(context: ComparisonContext) -> bool {
  if !matches!(context.route, NumericRoute::PhysicalComplexCombination) {
    return false;
  }

  // UnequalInPhase and Quadrature are deterministic pure tones. In only the named physical
  // sum/difference outputs, rows below -120 dB are cancellation-dominated off-tone bands: the
  // linear terms are mathematically at/near zero although the output curve has nonzero tone bands.
  // Legacy projects f32 PCM before its FFT; shared projects already-rounded f32 complex bins.
  // Their tiny residual powers therefore have a large relative ratio, making dB ill-conditioned.
  // EqualInPhase Side and AntiPhase Mid/Combined cancel exactly in both paths and measured zero,
  // so they deliberately do not receive this exception. The region check ensures that even the
  // named curves use the normal 0.0225 dB bound outside their low-floor bands.
  matches!(
    (context.fixture, context.view, context.curve),
    (
      FixtureKind::UnequalInPhase,
      SpectrumView::Ms,
      CurveKind::Primary | CurveKind::Secondary
    ) | (
      FixtureKind::Quadrature,
      SpectrumView::Ms,
      CurveKind::Primary | CurveKind::Secondary
    ) | (
      FixtureKind::Quadrature,
      SpectrumView::Combined,
      CurveKind::Primary
    )
  )
}

fn row_tolerance(context: ComparisonContext, region: NumericRegion, kind: RowKind) -> f64 {
  match (context.route, region, kind) {
    (NumericRoute::Direct, NumericRegion::Regular, RowKind::Smooth) => DIRECT_SMOOTH_TOLERANCE_DB,
    (NumericRoute::Direct, NumericRegion::Regular, RowKind::Peak) => DIRECT_PEAK_TOLERANCE_DB,
    (NumericRoute::Direct, NumericRegion::LowFloor, RowKind::Smooth) => {
      DIRECT_LOW_FLOOR_SMOOTH_TOLERANCE_DB
    }
    (NumericRoute::Direct, NumericRegion::LowFloor, RowKind::Peak) => {
      DIRECT_LOW_FLOOR_PEAK_TOLERANCE_DB
    }
    (NumericRoute::PhysicalComplexCombination, NumericRegion::Regular, RowKind::Smooth) => {
      COMPLEX_SMOOTH_TOLERANCE_DB
    }
    (NumericRoute::PhysicalComplexCombination, NumericRegion::Regular, RowKind::Peak) => {
      COMPLEX_PEAK_TOLERANCE_DB
    }
    (NumericRoute::PhysicalComplexCombination, NumericRegion::LowFloor, RowKind::Smooth) => {
      if is_named_cancellation_output(context) {
        CANCELLATION_LOW_FLOOR_SMOOTH_TOLERANCE_DB
      } else {
        COMPLEX_SMOOTH_TOLERANCE_DB
      }
    }
    (NumericRoute::PhysicalComplexCombination, NumericRegion::LowFloor, RowKind::Peak) => {
      if is_named_cancellation_output(context) {
        CANCELLATION_LOW_FLOOR_PEAK_TOLERANCE_DB
      } else {
        COMPLEX_PEAK_TOLERANCE_DB
      }
    }
  }
}

fn assert_rows_equal_with_context(
  actual: &[f64],
  expected: &[f64],
  context: ComparisonContext,
  kind: RowKind,
  label: &str,
) -> RowMaxima {
  assert_eq!(actual.len(), expected.len(), "{label} length");
  let mut regular_maximum = None::<(usize, f64)>;
  let mut low_floor_maximum = None::<(usize, f64)>;
  for (index, (&actual, &expected)) in actual.iter().zip(expected).enumerate() {
    assert!(actual.is_finite(), "{label}[{index}] actual is {actual}");
    assert!(
      expected.is_finite(),
      "{label}[{index}] expected is {expected}"
    );
    let delta = (actual - expected).abs();
    let maximum = if actual <= NUMERICAL_FLOOR_DB && expected <= NUMERICAL_FLOOR_DB {
      &mut low_floor_maximum
    } else {
      &mut regular_maximum
    };
    if maximum.is_none_or(|(_, current)| delta > current) {
      *maximum = Some((index, delta));
    }
  }
  let assert_region = |maximum: Option<(usize, f64)>, region| {
    let Some((max_index, max_delta)) = maximum else {
      return 0.0;
    };
    let tolerance = row_tolerance(context, region, kind);
    assert!(
      max_delta <= tolerance,
      "{label} {context:?} {region:?} {kind:?}: max delta {max_delta:.17e} dB at row {max_index}, tolerance {tolerance:.17e}; actual={:.17e}, expected={:.17e}",
      actual[max_index],
      expected[max_index],
    );
    max_delta
  };
  RowMaxima {
    regular: assert_region(regular_maximum, NumericRegion::Regular),
    low_floor: assert_region(low_floor_maximum, NumericRegion::LowFloor),
  }
}

fn assert_snapshots_equal(
  actual: &Option<Snapshot>,
  expected: &Option<Snapshot>,
  context: ComparisonContext,
  label: &str,
) -> ComparisonMaxima {
  assert_eq!(
    actual.is_some(),
    expected.is_some(),
    "{label} readiness/first-output timing"
  );
  let (Some(actual), Some(expected)) = (actual, expected) else {
    return ComparisonMaxima::default();
  };
  assert_eq!(actual.centers, expected.centers, "{label} centers");
  assert_eq!(
    actual.secondary.is_some(),
    expected.secondary.is_some(),
    "{label} secondary presence"
  );
  let mut maxima = ComparisonMaxima {
    smooth: assert_rows_equal_with_context(
      &actual.smooth,
      &expected.smooth,
      context.with_curve(CurveKind::Primary),
      RowKind::Smooth,
      &format!("{label} smooth"),
    ),
    peak: assert_rows_equal_with_context(
      &actual.peak,
      &expected.peak,
      context.with_curve(CurveKind::Primary),
      RowKind::Peak,
      &format!("{label} peak"),
    ),
  };
  if let (Some(actual), Some(expected)) = (&actual.secondary, &expected.secondary) {
    maxima.smooth.merge(assert_rows_equal_with_context(
      &actual.0,
      &expected.0,
      context.with_curve(CurveKind::Secondary),
      RowKind::Smooth,
      &format!("{label} secondary smooth"),
    ));
    maxima.peak.merge(assert_rows_equal_with_context(
      &actual.1,
      &expected.1,
      context.with_curve(CurveKind::Secondary),
      RowKind::Peak,
      &format!("{label} secondary peak"),
    ));
  }
  maxima
}

struct RunResult {
  snapshots: Vec<Option<Snapshot>>,
  maxima: ComparisonMaxima,
}

fn comparison_context(pcm: &StereoFixture, case: Case) -> ComparisonContext {
  ComparisonContext {
    fixture: pcm.kind,
    view: case.view,
    curve: CurveKind::Primary,
    route: case.numeric_route(),
  }
}

fn run_case(pcm: &StereoFixture, chunking: Chunking, case: Case) -> RunResult {
  let mut legacy = LegacyRunner::new(pcm.sample_rate, case);
  let mut shared = SharedRunner::new(pcm.sample_rate, case);
  let total_frames = pcm.interleaved.len() / 2;
  let mut snapshots = Vec::new();
  let mut maxima = ComparisonMaxima::default();

  for (start, end) in chunk_ranges(total_frames, chunking) {
    let chunk = &pcm.interleaved[start * 2..end * 2];
    let now_sec = end as f64 / pcm.sample_rate;
    let expected = legacy.push(chunk, now_sec);
    shared.push_pcm(chunk);
    let actual = shared.output(now_sec);
    maxima.merge(assert_snapshots_equal(
      &actual,
      &expected,
      comparison_context(pcm, case),
      &format!(
        "{} {:?} {} {} frame {}",
        pcm.name,
        case.view,
        if case.force_physical_pair {
          "physical-pair"
        } else {
          "direct"
        },
        chunking.name(),
        end
      ),
    ));
    snapshots.push(actual);
  }
  RunResult { snapshots, maxima }
}

fn compare_case(pcm: &StereoFixture, chunking: Chunking, case: Case) -> ComparisonMaxima {
  let result = run_case(pcm, chunking, case);
  assert!(
    result.snapshots.iter().any(Option::is_some),
    "{} {:?} {} produced no comparable output",
    pcm.name,
    case.view,
    chunking.name()
  );
  result.maxima
}

fn compare_chunkings(pcm: &StereoFixture, case: Case, chunkings: [Chunking; 3]) {
  for chunking in chunkings {
    let result = run_case(pcm, chunking, case);
    assert_eq!(
      result.snapshots.len(),
      chunk_ranges(pcm.interleaved.len() / 2, chunking).len(),
      "{} {:?}: {} did not compare every chunk",
      pcm.name,
      case.view,
      chunking.name()
    );
  }
}

fn compare_reset_timing(pcm: &StereoFixture, case: Case) {
  let mut legacy = LegacyRunner::new(pcm.sample_rate, case);
  let mut shared = SharedRunner::new(pcm.sample_rate, case);
  let reset_block_frames = super::spectrum_bank::FFT_BIG / 8;
  let warm_frames = super::spectrum_bank::FFT_BIG + reset_block_frames;
  let warm_pcm = &pcm.interleaved[..warm_frames * 2];
  let expected = legacy.push(warm_pcm, warm_frames as f64 / pcm.sample_rate);
  shared.push_pcm(warm_pcm);
  let actual = shared.output(warm_frames as f64 / pcm.sample_rate);
  assert_snapshots_equal(
    &actual,
    &expected,
    comparison_context(pcm, case),
    "pre-reset",
  );
  assert!(actual.is_some(), "pre-reset must be ready");

  legacy.reset(pcm.sample_rate);
  shared.reset();
  for logical_start in (0..warm_frames).step_by(reset_block_frames) {
    let logical_end = (logical_start + reset_block_frames).min(warm_frames);
    let block = &pcm.interleaved[logical_start * 2..logical_end * 2];
    let now_sec = 10.0 + logical_end as f64 / pcm.sample_rate;
    let expected = legacy.push(block, now_sec);
    shared.push_pcm(block);
    let actual = shared.output(now_sec);
    assert_snapshots_equal(
      &actual,
      &expected,
      comparison_context(pcm, case),
      &format!("post-reset {:?} frame {logical_end}", case.view),
    );
  }
}

fn compare_all_ui_controls_by_route() -> usize {
  // PanelSettingsContent.jsx defines Speed 0..=100 step 1 and Tilt 0..=6 step 0.25;
  // panelControls.js defines the four smoothing values. Each axis is exhaustively crossed with
  // every projection route while the other two controls stay at representative non-edge values.
  let mut pcm = fixture(FixtureKind::IndependentNoise, 48_000.0);
  pcm.interleaved.truncate(super::spectrum_bank::FFT_BIG * 2);
  let mut cases = 0;
  for route in projections() {
    for speed in 0..=100 {
      compare_case(
        &pcm,
        Chunking::CaptureLike,
        Case {
          speed: speed as f64,
          smoothing: OctaveSmoothing::OneSixth,
          ..route
        },
      );
      cases += 1;
    }
    for smoothing in [
      OctaveSmoothing::Off,
      OctaveSmoothing::OneTwelfth,
      OctaveSmoothing::OneSixth,
      OctaveSmoothing::OneThird,
    ] {
      compare_case(
        &pcm,
        Chunking::CaptureLike,
        Case {
          speed: 50.0,
          smoothing,
          ..route
        },
      );
      cases += 1;
    }
  }
  cases
}

fn projections() -> [Case; 4] {
  [
    Case {
      selection: SpectrumChannelSel::Single(0),
      ..Case::combined()
    },
    Case::combined(),
    Case {
      view: SpectrumView::Lr,
      force_physical_pair: true,
      ..Case::combined()
    },
    Case {
      view: SpectrumView::Ms,
      force_physical_pair: true,
      ..Case::combined()
    },
  ]
}

#[test]
fn all_pcm_fixtures_rates_chunkings_and_views_match_legacy() {
  // Exhaustive scalar controls live in spectrum_consumer: synthetic frames make all 101 speed
  // steps and four smoothing modes cheap. This expensive PCM matrix instead
  // crosses every signal family, supported rate, chunking, and projection at the UI defaults.
  // One full FFT window preserves every fixture's spectral content and readiness boundary while
  // avoiding thousands of redundant post-ready one-sample envelope updates per case; reset and
  // representative-control tests below cover post-ready dynamics with the full fixture length.
  let mut direct_maxima = ComparisonMaxima::default();
  let mut complex_maxima = ComparisonMaxima::default();
  for sample_rate in SAMPLE_RATES {
    for kind in ALL_FIXTURES {
      let mut pcm = fixture(kind, sample_rate);
      pcm.interleaved.truncate(super::spectrum_bank::FFT_BIG * 2);
      for chunking in ALL_CHUNKINGS {
        for case in projections() {
          let maxima = compare_case(&pcm, chunking, case);
          match case.numeric_route() {
            NumericRoute::Direct => direct_maxima.merge(maxima),
            NumericRoute::PhysicalComplexCombination => complex_maxima.merge(maxima),
          }
        }
      }
    }
  }
  eprintln!(
    "route maxima: direct regular smooth={:.17e}, peak={:.17e}; direct low-floor smooth={:.17e}, peak={:.17e}; \
complex regular smooth={:.17e}, peak={:.17e}; complex low-floor smooth={:.17e}, peak={:.17e}",
    direct_maxima.smooth.regular,
    direct_maxima.peak.regular,
    direct_maxima.smooth.low_floor,
    direct_maxima.peak.low_floor,
    complex_maxima.smooth.regular,
    complex_maxima.peak.regular,
    complex_maxima.smooth.low_floor,
    complex_maxima.peak.low_floor,
  );
}

#[test]
fn representative_control_profiles_span_every_projection_route() {
  let pcm = fixture(FixtureKind::IndependentNoise, 48_000.0);
  // Compact three-factor pairings complement the exhaustive one-axis matrix without paying for
  // its 101 × 4 Cartesian product. Every row is non-default and every smoothing mode appears.
  let profiles = [
    (17.0, OctaveSmoothing::Off),
    (43.0, OctaveSmoothing::OneTwelfth),
    (71.0, OctaveSmoothing::OneSixth),
    (93.0, OctaveSmoothing::OneThird),
  ];
  for case in projections() {
    for (speed, smoothing) in profiles {
      compare_case(
        &pcm,
        Chunking::CaptureLike,
        Case {
          speed,
          smoothing,
          ..case
        },
      );
    }
  }
}

#[test]
fn every_ui_control_value_is_differentially_compared_on_every_projection_route() {
  assert_eq!(compare_all_ui_controls_by_route(), 4 * (101 + 4));
}

#[test]
fn direct_combined_and_physical_pair_combined_match_legacy() {
  let pcm = fixture(FixtureKind::Quadrature, 48_000.0);
  compare_case(&pcm, Chunking::Irregular, Case::combined());
  compare_case(
    &pcm,
    Chunking::Irregular,
    Case {
      force_physical_pair: true,
      ..Case::combined()
    },
  );
}

#[test]
fn every_pcm_chunking_compares_each_boundary_on_both_paths() {
  let pcm = fixture(FixtureKind::IndependentNoise, 48_000.0);
  for case in projections() {
    compare_chunkings(&pcm, case, ALL_CHUNKINGS);
  }
}

#[test]
fn reset_restarts_readiness_and_envelope_timing_together() {
  let pcm = fixture(FixtureKind::UnequalInPhase, 48_000.0);
  for case in projections() {
    compare_reset_timing(&pcm, case);
  }
}

#[test]
fn direct_route_mutation_above_its_tight_tolerance_is_rejected() {
  let result = std::panic::catch_unwind(|| {
    assert_rows_equal_with_context(
      &[0.000_001],
      &[0.0],
      ComparisonContext {
        fixture: FixtureKind::IndependentNoise,
        view: SpectrumView::Lr,
        curve: CurveKind::Primary,
        route: NumericRoute::Direct,
      },
      RowKind::Smooth,
      "direct mutation",
    );
  });
  assert!(result.is_err());
}

#[test]
fn non_finite_payload_mutations_are_rejected_before_delta_arithmetic() {
  for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
    for (actual, expected) in [(value, 0.0), (0.0, value)] {
      let result = std::panic::catch_unwind(|| {
        assert_rows_equal_with_context(
          &[actual],
          &[expected],
          ComparisonContext {
            fixture: FixtureKind::IndependentNoise,
            view: SpectrumView::Lr,
            curve: CurveKind::Primary,
            route: NumericRoute::Direct,
          },
          RowKind::Peak,
          "non-finite mutation",
        );
      });
      assert!(result.is_err());
    }
  }
}

#[test]
fn one_sample_chunking_compares_every_chunk_on_both_paths() {
  let pcm = fixture(FixtureKind::Silence, 48_000.0);
  let result = run_case(&pcm, Chunking::OneSample, Case::combined());
  assert_eq!(result.snapshots.len(), pcm.interleaved.len() / 2);
}

#[test]
fn a_one_chunk_readiness_lead_or_lag_is_rejected() {
  let ready = Some(Snapshot {
    centers: vec![20.0],
    smooth: vec![-60.0],
    peak: vec![-60.0],
    secondary: None,
  });
  for (actual, expected) in [(&ready, &None), (&None, &ready)] {
    let result = std::panic::catch_unwind(|| {
      assert_snapshots_equal(
        actual,
        expected,
        ComparisonContext {
          fixture: FixtureKind::Silence,
          view: SpectrumView::Combined,
          curve: CurveKind::Primary,
          route: NumericRoute::Direct,
        },
        "mutated readiness step",
      );
    });
    assert!(result.is_err());
  }
}

#[test]
fn below_floor_difference_beyond_the_low_floor_bound_is_rejected() {
  let result = std::panic::catch_unwind(|| {
    assert_rows_equal_with_context(
      &[-121.0],
      &[-1000.0],
      ComparisonContext {
        fixture: FixtureKind::AntiPhase,
        view: SpectrumView::Combined,
        curve: CurveKind::Primary,
        route: NumericRoute::PhysicalComplexCombination,
      },
      RowKind::Smooth,
      "low-floor mutation",
    );
  });
  assert!(result.is_err());
}

#[test]
fn named_cancellation_accepts_only_its_measured_low_floor_bound() {
  let context = ComparisonContext {
    fixture: FixtureKind::UnequalInPhase,
    view: SpectrumView::Ms,
    curve: CurveKind::Primary,
    route: NumericRoute::PhysicalComplexCombination,
  };
  assert_rows_equal_with_context(
    &[-130.0],
    &[-130.0 - 15.746_407_002_962],
    context,
    RowKind::Smooth,
    "measured cancellation low-floor delta",
  );
  let beyond_bound = std::panic::catch_unwind(|| {
    assert_rows_equal_with_context(
      &[-130.0],
      &[-130.0 - 15.750_001],
      context,
      RowKind::Smooth,
      "beyond cancellation low-floor bound",
    );
  });
  assert!(beyond_bound.is_err());
}

#[test]
fn ordinary_complex_low_floor_one_db_difference_is_rejected() {
  let result = std::panic::catch_unwind(|| {
    assert_rows_equal_with_context(
      &[-130.0],
      &[-131.0],
      ComparisonContext {
        fixture: FixtureKind::IndependentNoise,
        view: SpectrumView::Ms,
        curve: CurveKind::Primary,
        route: NumericRoute::PhysicalComplexCombination,
      },
      RowKind::Smooth,
      "ordinary complex low-floor mutation",
    );
  });
  assert!(result.is_err());
}

#[test]
fn direct_low_floor_remains_exact() {
  let result = std::panic::catch_unwind(|| {
    assert_rows_equal_with_context(
      &[-130.0],
      &[-130.000_001],
      ComparisonContext {
        fixture: FixtureKind::IndependentNoise,
        view: SpectrumView::Lr,
        curve: CurveKind::Primary,
        route: NumericRoute::Direct,
      },
      RowKind::Peak,
      "direct low-floor mutation",
    );
  });
  assert!(result.is_err());
}
