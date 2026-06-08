//! Payload shapes for Channel / Event streams (`docs/architecture.md` §7).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;

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
  pub integrated: f64,
  pub lra: f64,
  pub true_peak_l: f64,
  pub true_peak_r: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_l_db: f64,
  pub sample_r_db: f64,
  pub sample_peak_max_l: f64,
  pub sample_peak_max_r: f64,
  pub correlation: f64,
  pub vectorscope_path: String,
  pub vectorscope_pair_x: u16,
  pub vectorscope_pair_y: u16,
  pub spectrum_path: String,
  pub spectrum_peak_path: String,
  pub spectrum_band_centers_hz: Vec<f64>,
  pub spectrum_smooth_db: Vec<f64>,
  /// Loudness layout semantics for this entry (e.g. `stereo`, `5.1`, `unknown`).
  pub loudness_layout: String,
  /// Whether the loudness layout is known/correct for the input stream.
  pub loudness_layout_known: bool,
  /// Per-channel linear amplitude minimum over this ~100ms history window. Length == channel count.
  pub waveform_min: Vec<f32>,
  /// Per-channel linear amplitude maximum over this ~100ms history window. Length == channel count.
  pub waveform_max: Vec<f32>,
}

pub type MeterHistoryBuf = Arc<Mutex<VecDeque<MeterHistoryEntry>>>;

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
  /// Vectorscope Lissajous: interleaved [L0,R0, L1,R1, …] for 200 subsampled points.
  pub vectorscope_pairs: Vec<f32>,
  /// Pearson correlation coefficient [-1, 1].
  pub correlation: f64,
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
  /// Loudness layout semantics for this frame (e.g. `stereo`, `5.1`, `unknown`).
  pub loudness_layout: String,
  /// Whether the loudness layout is known/correct for the input stream.
  pub loudness_layout_known: bool,
  pub timestamp_ms: u64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub loudness_hist_tick: Option<MeterHistoryEntry>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub visual_hist_tick: Option<VisualHistEntry>,
}

/// Channel holder for the primary UI's ~60Hz [`AudioFramePayload`] stream.
pub type FrameSubscribers = Arc<Mutex<HashMap<String, Channel<AudioFramePayload>>>>;

/// ~2 Hz broadcast on Event `loudness-slow`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessSlowPayload {
  pub lufs_integrated: Option<f64>,
  pub lufs_m_max: f64,
  pub lufs_st_max: f64,
  pub lra: f64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub psr: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub plr: Option<f64>,
}
