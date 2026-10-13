//! Repository-only programme-dialogue evaluation harness.
//!
//! The harness deliberately calls the same detector and loudness primitives as production. It is
//! feature-gated with `capture-harness`; no benchmark corpus is shipped in the app.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::dsp::dialogue::DialogueIntegrator;
use crate::dsp::filters::KWeightMono;
use crate::dsp::gating::IntegratedAccumulator;
use crate::dsp::speech::{fuse_center_priority, SpeechDetector, VadEngineKind};

const BLOCK_MS: usize = 100;
const SILERO_V6_2_SHA256: &str = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";
const FIRERED_MODEL_SHA256: &str =
  "b3c97836130dc34fc32d56fab551e88cf9454511de2b3c250a5e6578dee74b93";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusManifest {
  schema_version: u32,
  corpus_id: String,
  sample_rate_hz: u32,
  manifest_sha256: String,
  cases: Vec<CorpusCase>,
  outputs: Vec<CorpusOutput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusCase {
  id: String,
  duration_ms: usize,
  channel_labels: Vec<String>,
  valid_spans_ms: Vec<[usize; 2]>,
  dialogue_spans: Vec<DialogueSpan>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogueSpan {
  start_ms: usize,
  end_ms: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusOutput {
  id: String,
  path: String,
  sha256: String,
}

#[derive(Clone, Copy)]
enum EngineSpec {
  FireRed,
  SileroV6,
}

impl EngineSpec {
  fn id(self) -> &'static str {
    match self {
      Self::FireRed => "firered-0.1.0",
      Self::SileroV6 => "silero-v6.2",
    }
  }

  fn model_sha256(self) -> &'static str {
    match self {
      Self::FireRed => FIRERED_MODEL_SHA256,
      Self::SileroV6 => SILERO_V6_2_SHA256,
    }
  }

  fn detector(self, sample_rate: f64) -> Result<SpeechDetector, String> {
    match self {
      Self::FireRed => SpeechDetector::new_with_engine(sample_rate, VadEngineKind::FireRed),
      Self::SileroV6 => SpeechDetector::new_with_engine(sample_rate, VadEngineKind::Silero),
    }
    .ok_or_else(|| format!("Unable to initialize {}", self.id()))
  }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum FusionPolicy {
  AverageAllChannelsV1,
  NonLfeEnergyWeightedV1,
  IndependentNonLfeMaxV1,
  CenterPriorityFallbackV1,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkReport {
  schema_version: u32,
  corpus_id: String,
  corpus_manifest_sha256: String,
  block_duration_ms: usize,
  runtime: RuntimeIdentity,
  engines: Vec<EngineIdentity>,
  runs: Vec<BenchmarkRun>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeIdentity {
  plvs_version: &'static str,
  ort_crate_version: &'static str,
  operating_system: &'static str,
  architecture: &'static str,
  available_parallelism: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineIdentity {
  id: &'static str,
  model_sha256: &'static str,
  threshold: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkRun {
  case_id: String,
  engine: &'static str,
  fusion: FusionPolicy,
  audio_duration_ms: usize,
  evaluated_duration_ms: usize,
  readiness_excluded_ms: usize,
  confusion: Confusion,
  precision: Option<f64>,
  recall: Option<f64>,
  f1: Option<f64>,
  false_positive_duration_ms: usize,
  false_negative_duration_ms: usize,
  mean_boundary_error_ms: Option<f64>,
  metrics: MetricComparison,
  elapsed_ms: f64,
  realtime_factor: f64,
  peak_memory_bytes: Option<u64>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Confusion {
  true_positive_blocks: usize,
  false_positive_blocks: usize,
  false_negative_blocks: usize,
  true_negative_blocks: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricComparison {
  reference: DialogueMetrics,
  measured: DialogueMetrics,
  dialogue_loudness_error_lu: Option<f64>,
  loudness_to_dialogue_ratio_error_lu: Option<f64>,
  dialogue_coverage_error_percentage_points: Option<f64>,
  dialogue_range_error_lu: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DialogueMetrics {
  programme_loudness_lufs: Option<f64>,
  dialogue_loudness_lufs: Option<f64>,
  loudness_to_dialogue_ratio_lu: Option<f64>,
  dialogue_coverage_percent: Option<f64>,
  dialogue_range_lu: Option<f64>,
}

struct WavPcm {
  sample_rate: u32,
  channels: usize,
  interleaved: Vec<f32>,
}

fn read_float_wav(path: &Path) -> Result<WavPcm, String> {
  let mut reader = hound::WavReader::open(path)
    .map_err(|error| format!("Unable to open {}: {error}", path.display()))?;
  let spec = reader.spec();
  if spec.sample_format != hound::SampleFormat::Float || spec.bits_per_sample != 32 {
    return Err(format!("{} must be 32-bit Float WAV", path.display()));
  }
  let interleaved = reader
    .samples::<f32>()
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
  Ok(WavPcm {
    sample_rate: spec.sample_rate,
    channels: spec.channels as usize,
    interleaved,
  })
}

fn file_sha256(path: &Path) -> Result<String, String> {
  let bytes =
    fs::read(path).map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
  Ok(sha256_hex(&bytes))
}

fn sha256_hex(bytes: &[u8]) -> String {
  Sha256::digest(bytes)
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect()
}

fn is_lfe(label: &str) -> bool {
  label.eq_ignore_ascii_case("lfe")
}

fn centre_index(labels: &[String]) -> Option<usize> {
  labels
    .iter()
    .position(|label| label.eq_ignore_ascii_case("c"))
}

fn non_lfe_indices(labels: &[String]) -> Vec<usize> {
  labels
    .iter()
    .enumerate()
    .filter_map(|(index, label)| (!is_lfe(label)).then_some(index))
    .collect()
}

fn block_channel(pcm: &WavPcm, start: usize, frames: usize, channel: usize) -> Vec<f32> {
  (start..start + frames)
    .map(|frame| pcm.interleaved[frame * pcm.channels + channel])
    .collect()
}

fn channel_energy(pcm: &WavPcm, start: usize, frames: usize, channel: usize) -> f64 {
  let sum = (start..start + frames)
    .map(|frame| {
      let value = pcm.interleaved[frame * pcm.channels + channel] as f64;
      value * value
    })
    .sum::<f64>();
  sum / frames as f64
}

fn mix_average(pcm: &WavPcm, start: usize, frames: usize, channels: &[usize]) -> Vec<f32> {
  (start..start + frames)
    .map(|frame| {
      channels
        .iter()
        .map(|channel| pcm.interleaved[frame * pcm.channels + channel])
        .sum::<f32>()
        / channels.len() as f32
    })
    .collect()
}

fn mix_energy_weighted(pcm: &WavPcm, start: usize, frames: usize, channels: &[usize]) -> Vec<f32> {
  let roots: Vec<f64> = channels
    .iter()
    .map(|channel| channel_energy(pcm, start, frames, *channel).sqrt())
    .collect();
  let total = roots.iter().sum::<f64>();
  if total <= f64::EPSILON {
    return vec![0.0; frames];
  }
  (start..start + frames)
    .map(|frame| {
      channels
        .iter()
        .zip(&roots)
        .map(|(channel, weight)| {
          pcm.interleaved[frame * pcm.channels + channel] as f64 * weight / total
        })
        .sum::<f64>() as f32
    })
    .collect()
}

fn detectors_for(
  engine: EngineSpec,
  fusion: FusionPolicy,
  sample_rate: f64,
  non_lfe_count: usize,
) -> Result<Vec<SpeechDetector>, String> {
  let count = match fusion {
    FusionPolicy::AverageAllChannelsV1 | FusionPolicy::NonLfeEnergyWeightedV1 => 1,
    FusionPolicy::IndependentNonLfeMaxV1 | FusionPolicy::CenterPriorityFallbackV1 => non_lfe_count,
  };
  (0..count).map(|_| engine.detector(sample_rate)).collect()
}

fn detect_blocks(
  pcm: &WavPcm,
  labels: &[String],
  engine: EngineSpec,
  fusion: FusionPolicy,
) -> Result<Vec<Option<bool>>, String> {
  let block_frames = pcm.sample_rate as usize * BLOCK_MS / 1000;
  let block_count = pcm.interleaved.len() / pcm.channels / block_frames;
  let non_lfe = non_lfe_indices(labels);
  let centre =
    centre_index(labels).and_then(|index| non_lfe.iter().position(|item| *item == index));
  let mut detectors = detectors_for(engine, fusion, pcm.sample_rate as f64, non_lfe.len())?;
  let mut output = Vec::with_capacity(block_count);

  for block in 0..block_count {
    let start = block * block_frames;
    let decision = match fusion {
      FusionPolicy::AverageAllChannelsV1 => {
        let channels: Vec<usize> = (0..pcm.channels).collect();
        detectors[0].push_mono(&mix_average(pcm, start, block_frames, &channels));
        detectors[0].take_block_decision()
      }
      FusionPolicy::NonLfeEnergyWeightedV1 => {
        detectors[0].push_mono(&mix_energy_weighted(pcm, start, block_frames, &non_lfe));
        detectors[0].take_block_decision()
      }
      FusionPolicy::IndependentNonLfeMaxV1 | FusionPolicy::CenterPriorityFallbackV1 => {
        let energies: Vec<f64> = non_lfe
          .iter()
          .map(|channel| channel_energy(pcm, start, block_frames, *channel))
          .collect();
        let decisions: Vec<Option<bool>> = non_lfe
          .iter()
          .zip(&mut detectors)
          .map(|(channel, detector)| {
            detector.push_mono(&block_channel(pcm, start, block_frames, *channel));
            detector.take_block_decision()
          })
          .collect();
        match fusion {
          FusionPolicy::IndependentNonLfeMaxV1 => decisions
            .iter()
            .all(Option::is_some)
            .then(|| decisions.contains(&Some(true))),
          FusionPolicy::CenterPriorityFallbackV1 => {
            fuse_center_priority(&decisions, &energies, centre)
          }
          _ => unreachable!("handled by the outer fusion match"),
        }
      }
    };
    output.push(decision);
  }
  Ok(output)
}

fn role_weight(label: &str, channels: usize) -> f64 {
  if is_lfe(label) {
    0.0
  } else if matches!(label.to_ascii_lowercase().as_str(), "ls" | "rs") {
    10_f64.powf(1.5 / 10.0)
  } else if channels == 1 {
    // Mirror the production mono-duplex path.
    2.0
  } else {
    1.0
  }
}

fn programme_energy_blocks(pcm: &WavPcm, labels: &[String]) -> Vec<[f64; 2]> {
  let block_frames = pcm.sample_rate as usize * BLOCK_MS / 1000;
  let block_count = pcm.interleaved.len() / pcm.channels / block_frames;
  let mut filters: Vec<KWeightMono> = (0..pcm.channels)
    .map(|_| KWeightMono::new(pcm.sample_rate as f64))
    .collect();
  let weights: Vec<f64> = labels
    .iter()
    .map(|label| role_weight(label, pcm.channels))
    .collect();
  let mut output = Vec::with_capacity(block_count);
  for block in 0..block_count {
    let mut sum = 0.0_f64;
    for frame in block * block_frames..(block + 1) * block_frames {
      for channel in 0..pcm.channels {
        if weights[channel] == 0.0 {
          continue;
        }
        let filtered =
          filters[channel].tick(pcm.interleaved[frame * pcm.channels + channel] as f64);
        sum += weights[channel] * filtered * filtered;
      }
    }
    output.push([sum / block_frames as f64, 0.0]);
  }
  output
}

fn span_contains(spans: &[[usize; 2]], midpoint_ms: usize) -> bool {
  spans
    .iter()
    .any(|span| midpoint_ms >= span[0] && midpoint_ms < span[1])
}

fn dialogue_at(spans: &[DialogueSpan], midpoint_ms: usize) -> bool {
  spans
    .iter()
    .any(|span| midpoint_ms >= span.start_ms && midpoint_ms < span.end_ms)
}

fn finite(value: f64) -> Option<f64> {
  value.is_finite().then_some(value)
}

fn metrics_from_masks(
  energy: &[[f64; 2]],
  valid: &[bool],
  truth: &[bool],
  predicted: &[Option<bool>],
) -> (DialogueMetrics, DialogueMetrics, Confusion, usize) {
  let mut programme = IntegratedAccumulator::new();
  let mut reference = DialogueIntegrator::new();
  let mut measured = DialogueIntegrator::new();
  let mut confusion = Confusion::default();
  let mut readiness = 0;
  for index in 0..energy.len() {
    if !valid[index] {
      continue;
    }
    let Some(predicted) = predicted[index] else {
      readiness += 1;
      continue;
    };
    programme.push(energy[index]);
    reference.push_block(energy[index], truth[index]);
    measured.push_block(energy[index], predicted);
    match (truth[index], predicted) {
      (true, true) => confusion.true_positive_blocks += 1,
      (false, true) => confusion.false_positive_blocks += 1,
      (true, false) => confusion.false_negative_blocks += 1,
      (false, false) => confusion.true_negative_blocks += 1,
    }
  }
  let programme_loudness = programme.value();
  let to_metrics = |integrator: &DialogueIntegrator| {
    let dialogue_loudness = integrator.integrated();
    DialogueMetrics {
      programme_loudness_lufs: finite(programme_loudness),
      dialogue_loudness_lufs: finite(dialogue_loudness),
      loudness_to_dialogue_ratio_lu: finite(programme_loudness - dialogue_loudness),
      dialogue_coverage_percent: finite(integrator.percent()),
      dialogue_range_lu: finite(integrator.lra()),
    }
  };
  (
    to_metrics(&reference),
    to_metrics(&measured),
    confusion,
    readiness,
  )
}

fn subtract(left: Option<f64>, right: Option<f64>) -> Option<f64> {
  left.zip(right).map(|(left, right)| left - right)
}

fn transition_times(values: &[bool], valid: &[bool], rising: bool) -> Vec<usize> {
  let mut transitions = Vec::new();
  let mut previous = None;
  for (index, value) in values.iter().copied().enumerate() {
    if !valid[index] {
      previous = None;
      continue;
    }
    if let Some(before) = previous {
      if before != value && value == rising {
        transitions.push(index * BLOCK_MS);
      }
    }
    previous = Some(value);
  }
  transitions
}

fn mean_boundary_error(truth: &[bool], predicted: &[Option<bool>], valid: &[bool]) -> Option<f64> {
  let evaluated: Vec<bool> = predicted
    .iter()
    .map(|value| value.unwrap_or(false))
    .collect();
  let evaluated_valid: Vec<bool> = valid
    .iter()
    .zip(predicted)
    .map(|(valid, predicted)| *valid && predicted.is_some())
    .collect();
  let mut errors = Vec::new();
  for rising in [true, false] {
    let expected = transition_times(truth, &evaluated_valid, rising);
    let actual = transition_times(&evaluated, &evaluated_valid, rising);
    for boundary in expected {
      if let Some(nearest) = actual.iter().map(|value| value.abs_diff(boundary)).min() {
        errors.push(nearest as f64);
      }
    }
  }
  (!errors.is_empty()).then(|| errors.iter().sum::<f64>() / errors.len() as f64)
}

fn safe_ratio(numerator: usize, denominator: usize) -> Option<f64> {
  (denominator > 0).then_some(numerator as f64 / denominator as f64)
}

fn evaluate_run(
  fixture: &CorpusCase,
  pcm: &WavPcm,
  engine: EngineSpec,
  fusion: FusionPolicy,
) -> Result<BenchmarkRun, String> {
  let started = Instant::now();
  let predicted = detect_blocks(pcm, &fixture.channel_labels, engine, fusion)?;
  let elapsed = started.elapsed().as_secs_f64();
  let energy = programme_energy_blocks(pcm, &fixture.channel_labels);
  let valid: Vec<bool> = (0..energy.len())
    .map(|index| span_contains(&fixture.valid_spans_ms, index * BLOCK_MS + BLOCK_MS / 2))
    .collect();
  let truth: Vec<bool> = (0..energy.len())
    .map(|index| dialogue_at(&fixture.dialogue_spans, index * BLOCK_MS + BLOCK_MS / 2))
    .collect();
  let boundary = mean_boundary_error(&truth, &predicted, &valid);
  let (reference, measured, confusion, readiness) =
    metrics_from_masks(&energy, &valid, &truth, &predicted);
  let precision = safe_ratio(
    confusion.true_positive_blocks,
    confusion.true_positive_blocks + confusion.false_positive_blocks,
  );
  let recall = safe_ratio(
    confusion.true_positive_blocks,
    confusion.true_positive_blocks + confusion.false_negative_blocks,
  );
  let f1 = precision.zip(recall).and_then(|(precision, recall)| {
    (precision + recall > 0.0).then_some(2.0 * precision * recall / (precision + recall))
  });
  let evaluated_blocks = confusion.true_positive_blocks
    + confusion.false_positive_blocks
    + confusion.false_negative_blocks
    + confusion.true_negative_blocks;
  let metric_comparison = MetricComparison {
    dialogue_loudness_error_lu: subtract(
      measured.dialogue_loudness_lufs,
      reference.dialogue_loudness_lufs,
    ),
    loudness_to_dialogue_ratio_error_lu: subtract(
      measured.loudness_to_dialogue_ratio_lu,
      reference.loudness_to_dialogue_ratio_lu,
    ),
    dialogue_coverage_error_percentage_points: subtract(
      measured.dialogue_coverage_percent,
      reference.dialogue_coverage_percent,
    ),
    dialogue_range_error_lu: subtract(measured.dialogue_range_lu, reference.dialogue_range_lu),
    reference,
    measured,
  };
  let false_positive_duration_ms = confusion.false_positive_blocks * BLOCK_MS;
  let false_negative_duration_ms = confusion.false_negative_blocks * BLOCK_MS;
  Ok(BenchmarkRun {
    case_id: fixture.id.clone(),
    engine: engine.id(),
    fusion,
    audio_duration_ms: fixture.duration_ms,
    evaluated_duration_ms: evaluated_blocks * BLOCK_MS,
    readiness_excluded_ms: readiness * BLOCK_MS,
    confusion,
    precision,
    recall,
    f1,
    false_positive_duration_ms,
    false_negative_duration_ms,
    mean_boundary_error_ms: boundary,
    metrics: metric_comparison,
    elapsed_ms: elapsed * 1000.0,
    realtime_factor: elapsed / (fixture.duration_ms as f64 / 1000.0),
    peak_memory_bytes: None,
  })
}

pub fn run(manifest_path: &Path, output_path: &Path) -> Result<(), String> {
  let manifest_bytes = fs::read(manifest_path)
    .map_err(|error| format!("Unable to read {}: {error}", manifest_path.display()))?;
  let manifest: CorpusManifest = serde_json::from_slice(&manifest_bytes)
    .map_err(|error| format!("Invalid corpus manifest: {error}"))?;
  if manifest.schema_version != 1 {
    return Err(format!(
      "Unsupported corpus schema {}",
      manifest.schema_version
    ));
  }
  let root = manifest_path.parent().unwrap_or_else(|| Path::new("."));
  let engines = [EngineSpec::FireRed, EngineSpec::SileroV6];
  let fusions = [
    FusionPolicy::AverageAllChannelsV1,
    FusionPolicy::NonLfeEnergyWeightedV1,
    FusionPolicy::IndependentNonLfeMaxV1,
    FusionPolicy::CenterPriorityFallbackV1,
  ];
  let mut runs = Vec::new();
  for fixture in &manifest.cases {
    let output = manifest
      .outputs
      .iter()
      .find(|output| output.id == fixture.id)
      .ok_or_else(|| format!("No generated output for {}", fixture.id))?;
    let path = root.join(&output.path);
    let actual_hash = file_sha256(&path)?;
    if actual_hash != output.sha256 {
      return Err(format!(
        "{} hash does not match the resolved manifest",
        path.display()
      ));
    }
    let pcm = read_float_wav(&path)?;
    if pcm.sample_rate != manifest.sample_rate_hz || pcm.channels != fixture.channel_labels.len() {
      return Err(format!(
        "{} audio shape does not match its annotation",
        fixture.id
      ));
    }
    for engine in engines {
      for fusion in fusions {
        runs.push(evaluate_run(fixture, &pcm, engine, fusion)?);
      }
    }
  }
  let report = BenchmarkReport {
    schema_version: 1,
    corpus_id: manifest.corpus_id,
    corpus_manifest_sha256: manifest.manifest_sha256,
    block_duration_ms: BLOCK_MS,
    runtime: RuntimeIdentity {
      plvs_version: env!("CARGO_PKG_VERSION"),
      ort_crate_version: "2.0.0-rc.12",
      operating_system: std::env::consts::OS,
      architecture: std::env::consts::ARCH,
      available_parallelism: std::thread::available_parallelism().map_or(1, |value| value.get()),
    },
    engines: engines
      .iter()
      .map(|engine| EngineIdentity {
        id: engine.id(),
        model_sha256: engine.model_sha256(),
        threshold: 0.5,
      })
      .collect(),
    runs,
  };
  if let Some(parent) = output_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Unable to create {}: {error}", parent.display()))?;
  }
  let json = serde_json::to_string_pretty(&report)
    .map_err(|error| format!("Unable to serialize benchmark: {error}"))?;
  fs::write(output_path, format!("{json}\n"))
    .map_err(|error| format!("Unable to write {}: {error}", output_path.display()))
}

pub fn parse_and_run(args: &[String]) -> Result<(), String> {
  let mut manifest = None;
  let mut output = None;
  let mut index = 0;
  while index < args.len() {
    let slot = match args[index].as_str() {
      "--manifest" => &mut manifest,
      "--out" => &mut output,
      value => return Err(format!("Unknown dialogue-benchmark option: {value}")),
    };
    *slot = Some(PathBuf::from(
      args
        .get(index + 1)
        .ok_or_else(|| format!("{} requires a path", args[index]))?,
    ));
    index += 2;
  }
  run(
    manifest
      .as_deref()
      .ok_or_else(|| "--manifest is required".to_string())?,
    output
      .as_deref()
      .ok_or_else(|| "--out is required".to_string())?,
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn lfe_is_excluded_and_surrounds_receive_bs1770_weight() {
    assert_eq!(role_weight("LFE", 6), 0.0);
    assert!((role_weight("Ls", 6) - 1.412_537_544_622_754_4).abs() < 1e-12);
    assert_eq!(role_weight("C", 6), 1.0);
  }

  #[test]
  fn boundary_matching_reports_exact_alignment_as_zero() {
    let truth = [false, true, true, false];
    let predicted = [Some(false), Some(true), Some(true), Some(false)];
    assert_eq!(
      mean_boundary_error(&truth, &predicted, &[true; 4]),
      Some(0.0)
    );
  }

  #[test]
  fn manifest_cli_requires_every_path() {
    assert!(parse_and_run(&[]).unwrap_err().contains("--manifest"));
  }
}
