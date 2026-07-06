use serde::{Deserialize, Serialize};

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
  pub m_max_lufs: f64,
  pub st_max_lufs: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_peak_max_l_db: f64,
  pub sample_peak_max_r_db: f64,
  /// Dialogue-gated integrated loudness; `NEG_INFINITY` when gating was off.
  pub dialogue_integrated: f64,
  /// Dialogue-gated loudness range; `0.0` when gating was off or insufficient speech.
  pub dialogue_lra: f64,
}
