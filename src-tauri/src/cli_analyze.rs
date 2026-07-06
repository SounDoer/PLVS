use serde::Serialize;

use crate::file_analysis::summary::{analyze_file_to_summary, FileAnalysisSummaryRun};
use crate::file_analysis::types::{
  FileAnalysisProbeResult, FileAnalysisSummaryMetrics, FileAudioTrackMetadata,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliAnalyzeStatus {
  Ok,
  Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum CliAnalyzeReport {
  Success(Box<CliAnalyzeSuccessReport>),
  Error(Box<CliAnalyzeErrorReport>),
}

impl CliAnalyzeReport {
  pub fn status(&self) -> CliAnalyzeStatus {
    match self {
      CliAnalyzeReport::Success(_) => CliAnalyzeStatus::Ok,
      CliAnalyzeReport::Error(_) => CliAnalyzeStatus::Error,
    }
  }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeSuccessReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliAnalyzeStatus,
  pub app: CliAnalyzeApp,
  pub source: CliAnalyzeSource,
  pub analysis: CliAnalyzeMetadata,
  pub summary: CliAnalyzeSummary,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeErrorReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliAnalyzeStatus,
  pub app: CliAnalyzeApp,
  pub source: CliAnalyzeErrorSource,
  pub error: CliAnalyzeError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeApp {
  pub name: String,
  pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeSource {
  pub path: String,
  pub file_name: String,
  pub container: Option<String>,
  pub duration_ms: Option<u64>,
  pub selected_track: CliAnalyzeTrack,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeErrorSource {
  pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeTrack {
  pub index: u32,
  pub codec: String,
  pub sample_rate_hz: Option<u32>,
  pub channels: Option<u16>,
  pub language: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeMetadata {
  pub decoded_frames: u64,
  pub dialogue: CliAnalyzeDialogue,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeDialogue {
  pub enabled: bool,
  pub engine: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeSummary {
  pub duration_ms: Option<u64>,
  pub sample_rate_hz: u32,
  pub channel_count: u16,
  pub integrated_lufs: Option<f64>,
  pub lra: Option<f64>,
  pub m_max_lufs: Option<f64>,
  pub st_max_lufs: Option<f64>,
  pub true_peak_max_dbtp: Option<f64>,
  pub sample_peak_max_l_db: Option<f64>,
  pub sample_peak_max_r_db: Option<f64>,
  pub sample_peak_max_db: Option<f64>,
  pub dialogue_integrated_lufs: Option<f64>,
  pub dialogue_lra: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeError {
  pub message: String,
}

pub fn run_analyze(path: &str) -> CliAnalyzeReport {
  match analyze_file_to_summary(path) {
    Ok(result) => CliAnalyzeReport::Success(Box::new(success_report(result))),
    Err(message) => CliAnalyzeReport::Error(Box::new(error_report(path, message))),
  }
}

fn success_report(result: FileAnalysisSummaryRun) -> CliAnalyzeSuccessReport {
  CliAnalyzeSuccessReport {
    schema_version: 1,
    command: "analyze".to_string(),
    status: CliAnalyzeStatus::Ok,
    app: app_info(),
    source: source_from_probe(result.probe),
    analysis: CliAnalyzeMetadata {
      decoded_frames: result.decoded_frames,
      dialogue: CliAnalyzeDialogue {
        enabled: false,
        engine: None,
      },
    },
    summary: summary_from_metrics(result.summary),
  }
}

fn error_report(path: &str, message: String) -> CliAnalyzeErrorReport {
  CliAnalyzeErrorReport {
    schema_version: 1,
    command: "analyze".to_string(),
    status: CliAnalyzeStatus::Error,
    app: app_info(),
    source: CliAnalyzeErrorSource {
      path: path.to_string(),
    },
    error: CliAnalyzeError { message },
  }
}

fn app_info() -> CliAnalyzeApp {
  CliAnalyzeApp {
    name: "PLVS".to_string(),
    version: env!("CARGO_PKG_VERSION").to_string(),
  }
}

fn source_from_probe(probe: FileAnalysisProbeResult) -> CliAnalyzeSource {
  CliAnalyzeSource {
    path: probe.path,
    file_name: probe.file_name,
    container: probe.container,
    duration_ms: probe.duration_ms,
    selected_track: track_from_metadata(probe.selected_track),
  }
}

fn track_from_metadata(track: FileAudioTrackMetadata) -> CliAnalyzeTrack {
  CliAnalyzeTrack {
    index: track.index,
    codec: track.codec,
    sample_rate_hz: track.sample_rate_hz,
    channels: track.channels,
    language: track.language,
  }
}

fn summary_from_metrics(summary: FileAnalysisSummaryMetrics) -> CliAnalyzeSummary {
  let sample_peak_max_l_db = finite_or_none(summary.sample_peak_max_l_db);
  let sample_peak_max_r_db = finite_or_none(summary.sample_peak_max_r_db);
  CliAnalyzeSummary {
    duration_ms: summary.duration_ms,
    sample_rate_hz: summary.sample_rate_hz,
    channel_count: summary.channels,
    integrated_lufs: finite_or_none(summary.integrated_lufs),
    lra: finite_or_none(summary.lra),
    m_max_lufs: finite_or_none(summary.m_max_lufs),
    st_max_lufs: finite_or_none(summary.st_max_lufs),
    true_peak_max_dbtp: finite_or_none(summary.true_peak_max_dbtp),
    sample_peak_max_l_db,
    sample_peak_max_r_db,
    sample_peak_max_db: max_optional(sample_peak_max_l_db, sample_peak_max_r_db),
    dialogue_integrated_lufs: None,
    dialogue_lra: None,
  }
}

fn finite_or_none(value: f64) -> Option<f64> {
  if value.is_finite() {
    Some(value)
  } else {
    None
  }
}

fn max_optional(a: Option<f64>, b: Option<f64>) -> Option<f64> {
  match (a, b) {
    (Some(a), Some(b)) => Some(a.max(b)),
    (Some(a), None) => Some(a),
    (None, Some(b)) => Some(b),
    (None, None) => None,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn summary_with_peaks(left: f64, right: f64) -> FileAnalysisSummaryMetrics {
    FileAnalysisSummaryMetrics {
      duration_ms: Some(1000),
      sample_rate_hz: 48_000,
      channels: 2,
      integrated_lufs: -16.0,
      lra: 3.0,
      m_max_lufs: -15.0,
      st_max_lufs: -14.0,
      true_peak_max_dbtp: f64::NEG_INFINITY,
      sample_peak_max_l_db: left,
      sample_peak_max_r_db: right,
      dialogue_integrated: f64::NEG_INFINITY,
      dialogue_lra: 0.0,
    }
  }

  #[test]
  fn summary_sanitizes_non_finite_values() {
    let summary = summary_from_metrics(summary_with_peaks(-3.0, f64::NEG_INFINITY));

    assert_eq!(summary.true_peak_max_dbtp, None);
    assert_eq!(summary.sample_peak_max_l_db, Some(-3.0));
    assert_eq!(summary.sample_peak_max_r_db, None);
    assert_eq!(summary.sample_peak_max_db, Some(-3.0));
    assert_eq!(summary.dialogue_integrated_lufs, None);
    assert_eq!(summary.dialogue_lra, None);
  }

  #[test]
  fn error_report_uses_error_status() {
    let report = CliAnalyzeReport::Error(Box::new(error_report("missing.wav", "nope".to_string())));

    assert_eq!(report.status(), CliAnalyzeStatus::Error);
    let json = serde_json::to_value(report).expect("serialize");
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["command"], "analyze");
    assert_eq!(json["status"], "error");
    assert_eq!(json["source"]["path"], "missing.wav");
    assert_eq!(json["error"]["message"], "nope");
  }
}
