use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::dsp::speech::VadEngineKind;
use crate::file_analysis::probe::probe_file;
use crate::file_analysis::session::{analyze_file_core, WorkerConfig};
use crate::ipc::types::{
  AnalysisRequests, AudioFramePayload, SpectrumAnalysisChannel, SpectrumAnalysisRequest,
  StereoMapAnalysisPair, StereoMapAnalysisRequest, VectorscopeAnalysisRequest, VisualHistEntry,
};

const SOURCE_SHA256: &str = "8cff42b901afc810d101298b0424b3bbde472f4f6551bcc8732de0d57984d988";
const WINDOW_START_MS: u64 = 63_000;
const WINDOW_END_MS: u64 = 78_000;
const SPECTRUM_KEY: &str = "spectrum:pair:0:1:combined:sp50:sm12";
const VECTORSCOPE_KEY: &str = "vectorscope:pair:0:1";
const STEREO_MAP_KEY: &str = "stereoMap:pair:0:1:sp50:sm12";
const FREQUENCY_BIN_STRIDE: usize = 4;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityPreviewFixture {
  id: &'static str,
  version: u32,
  source: FixtureSource,
  clock: FixtureClock,
  audio: FixtureAudio,
  measurement_frame: MeasurementFrame,
  loudness_history: Vec<LoudnessRow>,
  visuals: FixtureVisuals,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureSource {
  file_name: &'static str,
  sha256: &'static str,
  title: &'static str,
  artist: &'static str,
  license: &'static str,
  window_start_ms: u64,
  window_end_ms: u64,
  analyzer: &'static str,
  frequency_bin_stride: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureClock {
  start_ms: u64,
  duration_ms: u64,
  frame_interval_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureAudio {
  sample_rate_hz: u32,
  channel_labels: [&'static str; 2],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MeasurementFrame {
  sequence: u64,
  elapsed_ms: u64,
  channel_count: usize,
  sample_rate_hz: u32,
  peaks_dbfs: Vec<f64>,
  rms_dbfs: Vec<f64>,
  loudness: FixtureLoudness,
  correlation: f64,
  side_to_mid_db: f64,
  m_max_lufs: f64,
  st_max_lufs: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureLoudness {
  momentary_lufs: f64,
  short_term_lufs: f64,
  integrated_lufs: f64,
  range_lu: f64,
  true_peak_dbtp: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoudnessRow {
  at_ms: u64,
  momentary_lufs: f64,
  short_term_lufs: f64,
  waveform_min: Vec<f32>,
  waveform_max: Vec<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureVisuals {
  spectrum: FixtureSpectrum,
  vectorscope: FixtureVectorscope,
  stereo_map: FixtureStereoMap,
  waveform: Vec<FixtureWaveformRow>,
  spectrogram: Vec<FixtureSpectrogramRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureSpectrum {
  band_centers_hz: Vec<f64>,
  smooth_db: Vec<f32>,
  peak_db: Vec<f32>,
  smooth_db_b: Vec<f32>,
  peak_db_b: Vec<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureVectorscope {
  path: String,
  correlation: f64,
  side_to_mid_db: f64,
  pair_x: u16,
  pair_y: u16,
  history: Vec<FixtureVectorscopeRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureVectorscopeRow {
  at_ms: u64,
  pairs: Vec<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureStereoMap {
  band_centers_hz: Vec<f64>,
  pl: Vec<f32>,
  pr: Vec<f32>,
  c: Vec<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureWaveformRow {
  at_ms: u64,
  min: Vec<f32>,
  max: Vec<f32>,
  dominant_frequency_hz: Vec<f32>,
  spectral_centroid_hz: Vec<f32>,
  tonality: Vec<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureSpectrogramRow {
  at_ms: u64,
  db: Vec<f32>,
}

fn requests() -> AnalysisRequests {
  AnalysisRequests {
    spectrum: vec![SpectrumAnalysisRequest {
      key: SPECTRUM_KEY.to_string(),
      channel: SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
      view: "combined".to_string(),
      speed_percent: 50.0,
      octave_smoothing: "1/12".to_string(),
    }],
    vectorscope: vec![VectorscopeAnalysisRequest {
      key: VECTORSCOPE_KEY.to_string(),
      x: 0,
      y: 1,
    }],
    stereo_map: vec![StereoMapAnalysisRequest {
      key: STEREO_MAP_KEY.to_string(),
      pair: StereoMapAnalysisPair {
        first: 0,
        second: 1,
      },
      speed_percent: 50.0,
      octave_smoothing: "1/12".to_string(),
    }],
    spectral_waveform: true,
  }
}

fn sha256(path: &Path) -> Result<String, String> {
  let bytes = std::fs::read(path)
    .map_err(|error| format!("Unable to read preview audio {}: {error}", path.display()))?;
  Ok(
    Sha256::digest(bytes)
      .iter()
      .map(|byte| format!("{byte:02x}"))
      .collect(),
  )
}

fn relative_time(timestamp_ms: u64) -> u64 {
  timestamp_ms.saturating_sub(WINDOW_START_MS)
}

fn finite(value: f64, label: &str) -> Result<f64, String> {
  if value.is_finite() {
    Ok(value)
  } else {
    Err(format!("Preview fixture contains a non-finite {label}"))
  }
}

fn selected_visual_rows(frames: &[AudioFramePayload]) -> Vec<VisualHistEntry> {
  frames
    .iter()
    .flat_map(|frame| frame.visual_hist_batch.iter())
    .filter(|row| (WINDOW_START_MS..=WINDOW_END_MS).contains(&row.timestamp_ms))
    .cloned()
    .collect()
}

fn frequency_indices(length: usize) -> Vec<usize> {
  let mut indices: Vec<usize> = (0..length).step_by(FREQUENCY_BIN_STRIDE).collect();
  if length > 0 && indices.last().copied() != Some(length - 1) {
    indices.push(length - 1);
  }
  indices
}

fn select_frequency_values<T: Copy>(values: &[T], indices: &[usize]) -> Vec<T> {
  indices
    .iter()
    .filter_map(|index| values.get(*index).copied())
    .collect()
}

pub fn generate_community_preview_fixture(
  audio_path: &Path,
) -> Result<CommunityPreviewFixture, String> {
  let actual_hash = sha256(audio_path)?;
  if actual_hash != SOURCE_SHA256 {
    return Err(format!(
      "Preview audio hash mismatch: expected {SOURCE_SHA256}, got {actual_hash}"
    ));
  }
  let path = audio_path
    .to_str()
    .ok_or_else(|| "Preview audio path is not valid UTF-8".to_string())?;
  let probe = probe_file(audio_path)?;
  if probe.selected_track.channels != Some(2) {
    return Err("Community preview audio must be stereo".to_string());
  }
  let sample_rate_hz = probe
    .selected_track
    .sample_rate_hz
    .ok_or_else(|| "Community preview audio has no sample rate".to_string())?;
  let config = WorkerConfig {
    requests: requests(),
    channel_selection: None,
    dialogue_gating: false,
    dialogue_vad_engine: VadEngineKind::default(),
    deterministic_spectral_time: true,
  };
  let mut frames = Vec::new();
  let outcome = analyze_file_core(
    path,
    Some(&probe),
    &config,
    |frame| {
      if frame.timestamp_ms <= WINDOW_END_MS || !frame.loudness_hist_batch.is_empty() {
        frames.push(frame);
      }
      Ok(())
    },
    |_| {},
    || false,
  )?;
  if outcome.is_none() {
    return Err("Community preview analysis was cancelled".to_string());
  }
  let frame = frames
    .iter()
    .filter(|frame| frame.timestamp_ms <= WINDOW_END_MS)
    .max_by_key(|frame| frame.timestamp_ms)
    .ok_or_else(|| "Community preview analysis produced no selected frame".to_string())?;
  let band_centers_hz = frames
    .iter()
    .filter(|frame| frame.timestamp_ms <= WINDOW_END_MS)
    .rev()
    .find_map(|frame| {
      (!frame.band_grid_centers_hz.is_empty()).then(|| frame.band_grid_centers_hz.clone())
    })
    .ok_or_else(|| "Community preview analysis produced no frequency grid".to_string())?;
  let spectrum = frame
    .spectrum_results_by_key
    .get(SPECTRUM_KEY)
    .ok_or_else(|| "Community preview analysis produced no Spectrum result".to_string())?;
  let vectorscope = frame
    .vectorscope_results_by_key
    .get(VECTORSCOPE_KEY)
    .ok_or_else(|| "Community preview analysis produced no Vectorscope result".to_string())?;
  let stereo_map = frame
    .stereo_map_results_by_key
    .get(STEREO_MAP_KEY)
    .ok_or_else(|| "Community preview analysis produced no Stereo Map result".to_string())?;
  let frequency_indices = frequency_indices(band_centers_hz.len());
  let loudness_history = frames
    .iter()
    .flat_map(|frame| frame.loudness_hist_batch.iter())
    .filter(|row| (WINDOW_START_MS..=WINDOW_END_MS).contains(&row.timestamp_ms))
    .map(|row| {
      Ok(LoudnessRow {
        at_ms: relative_time(row.timestamp_ms),
        momentary_lufs: finite(row.lufs_momentary, "momentary loudness")?,
        short_term_lufs: finite(row.lufs_short_term, "short-term loudness")?,
        waveform_min: row.waveform_min.clone(),
        waveform_max: row.waveform_max.clone(),
      })
    })
    .collect::<Result<Vec<_>, String>>()?;
  let visual_rows = selected_visual_rows(&frames);
  let waveform = visual_rows
    .iter()
    .map(|row| FixtureWaveformRow {
      at_ms: relative_time(row.timestamp_ms),
      min: row.waveform_min.clone(),
      max: row.waveform_max.clone(),
      dominant_frequency_hz: row.dominant_frequency_hz.clone(),
      spectral_centroid_hz: row.spectral_centroid_hz.clone(),
      tonality: row.tonality.clone(),
    })
    .collect();
  let spectrogram = visual_rows
    .iter()
    .filter(|row| relative_time(row.timestamp_ms).is_multiple_of(500))
    .filter_map(|row| {
      row
        .spectrum_by_key
        .get(SPECTRUM_KEY)
        .map(|entry| FixtureSpectrogramRow {
          at_ms: relative_time(row.timestamp_ms),
          db: select_frequency_values(&entry.smooth_db, &frequency_indices),
        })
    })
    .collect();
  let vectorscope_history = visual_rows
    .iter()
    .filter(|row| row.timestamp_ms + 500 >= WINDOW_END_MS)
    .filter_map(|row| {
      row
        .vectorscope_by_key
        .get(VECTORSCOPE_KEY)
        .map(|entry| FixtureVectorscopeRow {
          at_ms: relative_time(row.timestamp_ms),
          pairs: entry.pairs.clone(),
        })
    })
    .collect();
  let duration_ms = WINDOW_END_MS - WINDOW_START_MS;
  Ok(CommunityPreviewFixture {
    id: "plvs-community-discovery-v3",
    version: 3,
    source: FixtureSource {
      file_name: "discovery-hero.wav",
      sha256: SOURCE_SHA256,
      title: "Discovery",
      artist: "Scott Buckley",
      license: "CC BY 4.0",
      window_start_ms: WINDOW_START_MS,
      window_end_ms: WINDOW_END_MS,
      analyzer: "plvs-meter-pipeline-v1",
      frequency_bin_stride: FREQUENCY_BIN_STRIDE,
    },
    clock: FixtureClock {
      start_ms: 0,
      duration_ms,
      frame_interval_ms: 100,
    },
    audio: FixtureAudio {
      sample_rate_hz,
      channel_labels: ["L", "R"],
    },
    measurement_frame: MeasurementFrame {
      sequence: duration_ms / 100,
      elapsed_ms: duration_ms,
      channel_count: frame.peak_db.len(),
      sample_rate_hz,
      peaks_dbfs: frame.peak_db.clone(),
      rms_dbfs: frame.rms_db.clone(),
      loudness: FixtureLoudness {
        momentary_lufs: finite(frame.lufs_momentary, "frame momentary loudness")?,
        short_term_lufs: finite(frame.lufs_short_term, "frame short-term loudness")?,
        integrated_lufs: finite(frame.integrated, "integrated loudness")?,
        range_lu: finite(frame.lra, "loudness range")?,
        true_peak_dbtp: finite(frame.true_peak_max_dbtp, "true peak")?,
      },
      correlation: finite(frame.correlation, "correlation")?,
      side_to_mid_db: finite(frame.side_to_mid_db, "side-to-mid ratio")?,
      m_max_lufs: finite(frame.lufs_m_max, "maximum momentary loudness")?,
      st_max_lufs: finite(frame.lufs_st_max, "maximum short-term loudness")?,
    },
    loudness_history,
    visuals: FixtureVisuals {
      spectrum: FixtureSpectrum {
        band_centers_hz: select_frequency_values(&band_centers_hz, &frequency_indices),
        smooth_db: select_frequency_values(&spectrum.smooth_db, &frequency_indices),
        peak_db: select_frequency_values(&spectrum.peak_db, &frequency_indices),
        smooth_db_b: select_frequency_values(&spectrum.smooth_db_b, &frequency_indices),
        peak_db_b: select_frequency_values(&spectrum.peak_db_b, &frequency_indices),
      },
      vectorscope: FixtureVectorscope {
        path: vectorscope.path.clone(),
        correlation: finite(vectorscope.correlation, "Vectorscope correlation")?,
        side_to_mid_db: finite(vectorscope.side_to_mid_db, "Vectorscope side-to-mid ratio")?,
        pair_x: vectorscope.pair_x,
        pair_y: vectorscope.pair_y,
        history: vectorscope_history,
      },
      stereo_map: FixtureStereoMap {
        band_centers_hz: select_frequency_values(&band_centers_hz, &frequency_indices),
        pl: select_frequency_values(&stereo_map.pl, &frequency_indices),
        pr: select_frequency_values(&stereo_map.pr, &frequency_indices),
        c: select_frequency_values(&stereo_map.c, &frequency_indices),
      },
      waveform,
      spectrogram,
    },
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::engine::MeterPipeline;

  #[test]
  fn preview_requests_are_explicit_and_stable() {
    let requests = requests();
    assert_eq!(requests.spectrum[0].key, SPECTRUM_KEY);
    assert_eq!(requests.vectorscope[0].key, VECTORSCOPE_KEY);
    assert_eq!(requests.stereo_map[0].key, STEREO_MAP_KEY);
    assert!(requests.spectral_waveform);
  }

  #[test]
  fn selected_window_is_fifteen_seconds_ending_at_the_hero_frame() {
    assert_eq!(WINDOW_START_MS, 63_000);
    assert_eq!(WINDOW_END_MS - WINDOW_START_MS, 15_000);
  }

  #[test]
  fn fixture_spectral_output_is_independent_of_decode_speed() {
    fn analyze() -> Vec<f32> {
      let sample_rate = 48_000_u32;
      let mut pipeline = MeterPipeline::new_for_deterministic_file_fixture(sample_rate, 2);
      let pcm: Vec<f32> = (0..sample_rate)
        .flat_map(|sample| {
          let value =
            (2.0 * std::f32::consts::PI * 440.0 * sample as f32 / sample_rate as f32).sin() * 0.25;
          [value, value * 0.8]
        })
        .collect();
      let mut last = Vec::new();
      for (index, chunk) in pcm.chunks(9_600).enumerate() {
        if let Some(frame) = pipeline.push_pcm_f32_with_requests_at_media_time(
          chunk,
          &requests(),
          None,
          false,
          VadEngineKind::default(),
          (index as u64 + 1) * 100,
        ) {
          if let Some(result) = frame.spectrum_results_by_key.get(SPECTRUM_KEY) {
            last.clone_from(&result.smooth_db);
          }
        }
      }
      last
    }

    let first = analyze();
    let second = analyze();
    assert!(!first.is_empty());
    assert_eq!(second, first);
  }
}
