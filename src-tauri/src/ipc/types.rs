//! Payload shapes for Channel / Event streams (`docs/architecture.md` §7).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SpectrumAnalysisChannel {
  Pair { x: u16, y: u16 },
  Single { ch: u16 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumAnalysisRequest {
  pub key: String,
  pub channel: SpectrumAnalysisChannel,
  pub view: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorscopeAnalysisRequest {
  pub key: String,
  pub x: u16,
  pub y: u16,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRequests {
  pub spectrum: Vec<SpectrumAnalysisRequest>,
  pub vectorscope: Vec<VectorscopeAnalysisRequest>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumFrameResult {
  pub path: String,
  pub peak_path: String,
  pub path_b: String,
  pub peak_path_b: String,
  pub band_centers_hz: Vec<f64>,
  pub smooth_db: Vec<f64>,
  pub smooth_db_b: Vec<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorscopeFrameResult {
  pub path: String,
  pub correlation: f64,
  pub pair_x: u16,
  pub pair_y: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStateChanged {
  pub state: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

/// Backpressure / drop signal for user-visible meter health (low-frequency).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineBackpressurePayload {
  pub dropped_chunks: u64,
}

/// Resolved device name and format for UI (e.g. before `audio_start` with `deviceId: "default"`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevicePreview {
  pub label: String,
  pub sample_rate_hz: u32,
  pub channels: u16,
}

/// One aligned history row (~10 Hz): loudness chart + snapshot tracks + fields for `audioSnapRef` replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterHistoryEntry {
  pub timestamp_ms: u64,
  pub lufs_momentary: f64,
  pub lufs_short_term: f64,
  pub lufs_m_max: f64,
  pub lufs_st_max: f64,
  pub integrated: f64,
  pub lra: f64,
  /// Dialogue-gated integrated loudness (LUFS) as of this tick; `NEG_INFINITY` when gating off.
  pub dialogue_integrated: f64,
  /// Percentage of audible program classified as dialogue as of this tick; `0.0` when gating off.
  pub dialogue_percent: f64,
  /// Dialogue-gated loudness range (LU) as of this tick; `0.0` when gating off.
  pub dialogue_lra: f64,
  pub true_peak_l: f64,
  pub true_peak_r: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_l_db: f64,
  pub sample_r_db: f64,
  pub sample_peak_max_l: f64,
  pub sample_peak_max_r: f64,
  pub correlation: f64,
  pub vectorscope_pair_x: u16,
  pub vectorscope_pair_y: u16,
  pub spectrum_band_centers_hz: Vec<f64>,
  pub spectrum_smooth_db: Vec<f64>,
  /// Secondary smoothed per-band dB for snapshot overlay (empty unless view is lr/ms).
  pub spectrum_smooth_db_b: Vec<f64>,
  /// Loudness layout semantics for this entry (e.g. `stereo`, `5.1`, `unknown`).
  pub loudness_layout: String,
  /// Whether the loudness layout is known/correct for the input stream.
  pub loudness_layout_known: bool,
  /// Per-channel linear amplitude minimum over this ~100ms history window. Length == channel count.
  pub waveform_min: Vec<f32>,
  /// Per-channel linear amplitude maximum over this ~100ms history window. Length == channel count.
  pub waveform_max: Vec<f32>,
  /// Per-channel sub-block (min, max) pairs over this ~100ms window, flat row-major:
  /// [min_ch0, max_ch0, min_ch1, max_ch1, ...] per sub-block. Stride = 2 * channel_count.
  pub waveform_sub_pairs: Vec<f32>,
  /// Number of sub-blocks in this tick. Equals waveform_sub_pairs.len() / (2 * channel_count).
  pub waveform_sub_count: u32,
}

/// Per-request-key spectrum sample for one visual history tick.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumVisualEntry {
  pub band_centers_hz: Vec<f64>,
  pub smooth_db: Vec<f64>,
  /// Secondary smoothed per-band dB (empty unless view is lr/ms).
  pub smooth_db_b: Vec<f64>,
}

/// Per-request-key vectorscope sample for one visual history tick.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorscopeVisualEntry {
  /// Lissajous pairs: interleaved [x0,y0, x1,y1, …] for the subsampled points.
  pub pairs: Vec<f32>,
  pub correlation: f64,
}

/// Visual history snapshot at ~25 Hz, independent of loudness tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualHistEntry {
  pub timestamp_ms: u64,
  /// Per-channel linear amplitude minimum over this ~40ms window.
  pub waveform_min: Vec<f32>,
  /// Per-channel linear amplitude maximum over this ~40ms window.
  pub waveform_max: Vec<f32>,
  /// Smoothed per-band dB values for Spectrum/Spectrogram display.
  pub spectrum_smooth_db: Vec<f64>,
  /// Secondary smoothed per-band dB for snapshot overlay (empty unless view is lr/ms).
  pub spectrum_smooth_db_b: Vec<f64>,
  /// Vectorscope Lissajous: interleaved [L0,R0, L1,R1, …] for 200 subsampled points.
  pub vectorscope_pairs: Vec<f32>,
  /// Pearson correlation coefficient [-1, 1].
  pub correlation: f64,
  /// Request-keyed spectrum samples for snapshot history. Only active request keys appear in a
  /// given tick; the frontend retains per-key history rings so inactive requests stay scrubbable.
  pub spectrum_by_key: HashMap<String, SpectrumVisualEntry>,
  /// Request-keyed vectorscope samples for snapshot history (same lifecycle as `spectrum_by_key`).
  pub vectorscope_by_key: HashMap<String, VectorscopeVisualEntry>,
}

/// High-rate meter frame (~60 Hz) on Tauri Channel `audio-frame`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFramePayload {
  pub peak_db: Vec<f64>,
  pub peak_hold_db: Vec<f64>,
  pub true_peak_max_dbtp: f64,
  pub lufs_momentary: f64,
  pub lufs_short_term: f64,
  pub lufs_m_max: f64,
  pub lufs_st_max: f64,
  pub integrated: f64,
  pub lra: f64,
  pub true_peak_l: f64,
  pub true_peak_r: f64,
  pub sample_l_db: f64,
  pub sample_r_db: f64,
  pub correlation: f64,
  pub vectorscope_path: String,
  pub vectorscope_pair_x: u16,
  pub vectorscope_pair_y: u16,
  pub spectrum_path: String,
  pub spectrum_peak_path: String,
  pub spectrum_band_centers_hz: Vec<f64>,
  pub spectrum_smooth_db: Vec<f64>,
  /// Secondary spectrum SVG path (empty unless view is lr/ms).
  pub spectrum_path_b: String,
  /// Secondary peak-hold SVG path (empty unless view is lr/ms). Live-only; not stored in history.
  pub spectrum_peak_path_b: String,
  /// Secondary smoothed per-band dB (empty unless view is lr/ms).
  pub spectrum_smooth_db_b: Vec<f64>,
  /// Request-keyed Spectrum/Spectrogram live results. Legacy single-result fields remain populated
  /// from the first active spectrum request during the transition.
  pub spectrum_results_by_key: HashMap<String, SpectrumFrameResult>,
  /// Request-keyed Vectorscope live results. Legacy single-result fields remain populated from the
  /// first active vectorscope request during the transition.
  pub vectorscope_results_by_key: HashMap<String, VectorscopeFrameResult>,
  /// Loudness layout semantics for this frame (e.g. `stereo`, `5.1`, `unknown`).
  pub loudness_layout: String,
  /// Whether the loudness layout is known/correct for the input stream.
  pub loudness_layout_known: bool,
  pub timestamp_ms: u64,
  /// Monotonic per-session sequence number, assigned by the capture bridge as each frame is sent.
  /// The UI echoes the latest value back via `ack_frames` so the bridge can bound its send backlog.
  pub seq: u64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub loudness_hist_tick: Option<MeterHistoryEntry>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub visual_hist_tick: Option<VisualHistEntry>,
  /// Dialogue-gated integrated loudness (LUFS); `NEG_INFINITY` when gating off or no speech.
  pub dialogue_integrated: f64,
  /// Percentage of audible program classified as dialogue; `0.0` when gating off.
  pub dialogue_percent: f64,
  /// Dialogue-gated loudness range (LU); `0.0` when gating off or insufficient speech.
  pub dialogue_lra: f64,
  /// Whether the current 100ms block was classified as active speech.
  pub dialogue_active_now: bool,
}

/// Channel holder for the primary UI's ~60Hz [`AudioFramePayload`] stream.
pub type FrameSubscribers = Arc<Mutex<HashMap<String, Channel<AudioFramePayload>>>>;
