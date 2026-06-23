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

/// One audio track discovered in a local media file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAudioTrackMetadata {
  pub index: u32,
  pub codec: String,
  pub sample_rate_hz: Option<u32>,
  pub channels: Option<u16>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub language: Option<String>,
}

/// Metadata returned before starting full offline analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysisProbeResult {
  pub path: String,
  pub file_name: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub container: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub duration_ms: Option<u64>,
  pub selected_track: FileAudioTrackMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysisProgressPayload {
  pub path: String,
  pub decoded_frames: u64,
  /// Total decodable frames for the selected track, when known from the container.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub total_frames: Option<u64>,
  /// Real progress fraction in `0.0..=1.0`, `None` only when total frames are unknown.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub progress: Option<f64>,
}

/// Authoritative whole-file delivery metrics, read from the final pipeline state on completion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysisSummaryMetrics {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub duration_ms: Option<u64>,
  pub sample_rate_hz: u32,
  pub channels: u16,
  pub integrated_lufs: f64,
  pub lra: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_peak_max_l_db: f64,
  pub sample_peak_max_r_db: f64,
  /// Dialogue-gated integrated loudness; `NEG_INFINITY` when gating was off.
  pub dialogue_integrated: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysisCompletedPayload {
  pub path: String,
  pub decoded_frames: u64,
  pub summary: FileAnalysisSummaryMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysisErrorPayload {
  pub path: String,
  pub message: String,
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
  pub vectorscope_pair_x: u16,
  pub vectorscope_pair_y: u16,
  /// Request-keyed Spectrum/Spectrogram live results, one entry per active analysis request key.
  pub spectrum_results_by_key: HashMap<String, SpectrumFrameResult>,
  /// Request-keyed Vectorscope live results, one entry per active analysis request key.
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
  /// File-mode batch of loudness history ticks accumulated since the previous emitted frame.
  /// Empty in live mode (which uses `loudness_hist_tick`).
  #[serde(default, skip_serializing_if = "Vec::is_empty")]
  pub loudness_hist_batch: Vec<MeterHistoryEntry>,
  /// File-mode batch of visual history ticks accumulated since the previous emitted frame.
  /// Empty in live mode (which uses `visual_hist_tick`).
  #[serde(default, skip_serializing_if = "Vec::is_empty")]
  pub visual_hist_batch: Vec<VisualHistEntry>,
}

/// Channel holder for the primary UI's ~60Hz [`AudioFramePayload`] stream.
pub type FrameSubscribers = Arc<Mutex<HashMap<String, Channel<AudioFramePayload>>>>;
