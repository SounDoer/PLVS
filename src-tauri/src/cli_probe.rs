use serde::Serialize;

use crate::file_analysis::probe::probe_media_file;
use crate::file_analysis::types::{FileAnalysisMediaProbeResult, FileAudioTrackMetadata};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliProbeStatus {
  Ok,
  Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum CliProbeReport {
  Success(Box<CliProbeSuccessReport>),
  Error(Box<CliProbeErrorReport>),
}

impl CliProbeReport {
  pub fn status(&self) -> CliProbeStatus {
    match self {
      Self::Success(_) => CliProbeStatus::Ok,
      Self::Error(_) => CliProbeStatus::Error,
    }
  }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeSuccessReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliProbeStatus,
  pub app: CliProbeApp,
  pub source: CliProbeSource,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeErrorReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliProbeStatus,
  pub app: CliProbeApp,
  pub source: CliProbeErrorSource,
  pub error: CliProbeError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeApp {
  pub name: String,
  pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeSource {
  pub path: String,
  pub file_name: String,
  pub container: Option<String>,
  pub duration_ms: Option<u64>,
  pub audio_tracks: Vec<FileAudioTrackMetadata>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeErrorSource {
  pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeError {
  pub message: String,
}

pub fn run_probe(path: &str) -> CliProbeReport {
  match probe_media_file(path) {
    Ok(probe) => CliProbeReport::Success(Box::new(success_report(probe))),
    Err(message) => CliProbeReport::Error(Box::new(error_report(path, message))),
  }
}

fn success_report(probe: FileAnalysisMediaProbeResult) -> CliProbeSuccessReport {
  CliProbeSuccessReport {
    schema_version: 1,
    command: "probe".to_string(),
    status: CliProbeStatus::Ok,
    app: app_info(),
    source: CliProbeSource {
      path: probe.path,
      file_name: probe.file_name,
      container: probe.container,
      duration_ms: probe.duration_ms,
      audio_tracks: probe.audio_tracks,
    },
  }
}

fn error_report(path: &str, message: String) -> CliProbeErrorReport {
  CliProbeErrorReport {
    schema_version: 1,
    command: "probe".to_string(),
    status: CliProbeStatus::Error,
    app: app_info(),
    source: CliProbeErrorSource {
      path: path.to_string(),
    },
    error: CliProbeError { message },
  }
}

fn app_info() -> CliProbeApp {
  CliProbeApp {
    name: "PLVS".to_string(),
    version: env!("CARGO_PKG_VERSION").to_string(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn probe_error_uses_stable_envelope() {
    let report = CliProbeReport::Error(Box::new(error_report(
      "missing.wav",
      "unreadable".to_string(),
    )));
    let json = serde_json::to_value(report).expect("serialize");

    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["command"], "probe");
    assert_eq!(json["status"], "error");
    assert_eq!(json["source"]["path"], "missing.wav");
  }
}
