use serde::Serialize;

use crate::audio::capture_summary::{capture_device_to_summary, CaptureRun, CaptureSample};
use crate::audio::device_enum::resolve_device_id_by_substring;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliCaptureStatus {
  Ok,
  Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum CliCaptureReport {
  Success(Box<CliCaptureSuccessReport>),
  Error(Box<CliCaptureErrorReport>),
}

impl CliCaptureReport {
  pub fn status(&self) -> CliCaptureStatus {
    match self {
      CliCaptureReport::Success(_) => CliCaptureStatus::Ok,
      CliCaptureReport::Error(_) => CliCaptureStatus::Error,
    }
  }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureSuccessReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliCaptureStatus,
  pub app: CliCaptureApp,
  pub source: CliCaptureSource,
  pub summary: CliCaptureSummary,
  pub health: CliCaptureHealth,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureErrorReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliCaptureStatus,
  pub app: CliCaptureApp,
  pub source: CliCaptureErrorSource,
  pub error: CliCaptureError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureApp {
  pub name: String,
  pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureSource {
  pub device_name: String,
  pub device_id: String,
  pub sample_rate_hz: u32,
  pub channel_count: u16,
  pub captured_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureErrorSource {
  pub device_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureSummary {
  pub integrated_lufs: Option<f64>,
  pub sample_peak_max_l_db: Option<f64>,
  pub sample_peak_max_r_db: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureHealth {
  pub dropped_chunks: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureError {
  pub message: String,
}

/// One periodic JSONL line. Distinguishable from the final report by `t`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureSampleLine {
  pub t: u64,
  pub integrated_lufs: Option<f64>,
  pub dropped_chunks: u64,
}

fn app_info() -> CliCaptureApp {
  CliCaptureApp {
    name: "PLVS".to_string(),
    version: env!("CARGO_PKG_VERSION").to_string(),
  }
}

/// Non-finite metrics become `null`, matching `analyze`.
fn finite_or_none(value: f64) -> Option<f64> {
  if value.is_finite() {
    Some(value)
  } else {
    None
  }
}

pub fn sample_line(sample: &CaptureSample) -> CliCaptureSampleLine {
  CliCaptureSampleLine {
    t: sample.t_seconds,
    integrated_lufs: finite_or_none(sample.integrated_lufs),
    dropped_chunks: sample.dropped_chunks,
  }
}

pub fn success_report(run: CaptureRun) -> CliCaptureReport {
  CliCaptureReport::Success(Box::new(CliCaptureSuccessReport {
    schema_version: 1,
    command: "capture".to_string(),
    status: CliCaptureStatus::Ok,
    app: app_info(),
    source: CliCaptureSource {
      device_name: run.device_label,
      device_id: run.device_id,
      sample_rate_hz: run.sample_rate_hz,
      channel_count: run.channel_count,
      captured_ms: run.captured_ms,
    },
    summary: CliCaptureSummary {
      integrated_lufs: finite_or_none(run.integrated_lufs),
      sample_peak_max_l_db: finite_or_none(run.sample_peak_max_l_db),
      sample_peak_max_r_db: finite_or_none(run.sample_peak_max_r_db),
    },
    health: CliCaptureHealth {
      dropped_chunks: run.dropped_chunks,
    },
  }))
}

pub fn error_report(device_id: &str, message: String) -> CliCaptureReport {
  CliCaptureReport::Error(Box::new(CliCaptureErrorReport {
    schema_version: 1,
    command: "capture".to_string(),
    status: CliCaptureStatus::Error,
    app: app_info(),
    source: CliCaptureErrorSource {
      device_id: device_id.to_string(),
    },
    error: CliCaptureError { message },
  }))
}

/// Resolve the device, run the capture, and emit sample lines through `on_sample`.
/// Substring resolution failures are usage errors and surface as `Err` (exit 2);
/// a capture that starts and then fails yields an error *report* (exit 1).
pub fn run_capture(
  device_substring: Option<&str>,
  seconds: u64,
  every: Option<u64>,
  on_sample: impl FnMut(CaptureSample),
) -> Result<CliCaptureReport, String> {
  let device_id = match device_substring {
    Some(needle) => resolve_device_id_by_substring(needle)?,
    None => "default".to_string(),
  };

  match capture_device_to_summary(&device_id, seconds, every, on_sample) {
    Ok(run) => Ok(success_report(run)),
    Err(message) => Ok(error_report(&device_id, message)),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::audio::capture_summary::CaptureRun;

  fn run() -> CaptureRun {
    CaptureRun {
      device_label: "CABLE Output (VB-Audio Virtual Cable)".to_string(),
      device_id: "cap-2".to_string(),
      sample_rate_hz: 48000,
      channel_count: 2,
      captured_ms: 10000,
      integrated_lufs: -20.02,
      sample_peak_max_l_db: -20.01,
      sample_peak_max_r_db: -26.03,
      dropped_chunks: 0,
    }
  }

  #[test]
  fn success_report_uses_the_analyze_envelope() {
    let report = success_report(run());
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["command"], "capture");
    assert_eq!(json["status"], "ok");
    assert_eq!(json["app"]["name"], "PLVS");
    assert_eq!(json["source"]["deviceId"], "cap-2");
    assert_eq!(json["source"]["sampleRateHz"], 48000);
    assert_eq!(json["summary"]["integratedLufs"], -20.02);
    assert_eq!(json["health"]["droppedChunks"], 0);
  }

  #[test]
  fn non_finite_metrics_serialize_as_null() {
    let mut r = run();
    r.integrated_lufs = f64::NEG_INFINITY;
    let json = serde_json::to_value(success_report(r)).unwrap();
    assert!(json["summary"]["integratedLufs"].is_null());
  }

  #[test]
  fn error_report_keeps_the_envelope_and_reports_the_message() {
    let report = error_report("cap-2", "device vanished".to_string());
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["command"], "capture");
    assert_eq!(json["status"], "error");
    assert_eq!(json["error"]["message"], "device vanished");
  }
}
