use serde::Serialize;

use crate::dsp::speech::VadEngineKind;
use crate::file_analysis::session::analyze_file_track_with_dialogue;
use crate::file_analysis::summary::{
  analyze_file_to_summary, analyze_file_track_to_summary, FileAnalysisSummaryRun,
};
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

  pub fn quality_control_failed(&self) -> bool {
    matches!(
      self,
      CliAnalyzeReport::Success(report)
        if report.quality_control.status == CliQualityControlStatus::Fail
    )
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CliAnalyzeOptions {
  pub track_index: Option<u32>,
  pub quality_control: CliQualityControlOptions,
  pub dialogue: CliDialogueOptions,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CliQualityControlOptions {
  pub target_lufs: Option<f64>,
  pub lufs_tolerance: Option<f64>,
  pub max_true_peak_dbtp: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CliDialogueOptions {
  pub enabled: bool,
  pub vad: Option<VadEngineKind>,
  pub reference_lufs: Option<f64>,
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
  pub quality_control: CliAnalyzeQualityControl,
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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeMetadata {
  pub decoded_frames: u64,
  pub dialogue: CliAnalyzeDialogue,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub reference_lufs: Option<f64>,
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
  #[serde(skip_serializing_if = "Option::is_none")]
  pub dialogue_offset_from_reference_lu: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CliQualityControlStatus {
  NotEvaluated,
  Pass,
  Fail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliQualityControlCheckStatus {
  Pass,
  Fail,
  Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeQualityControl {
  pub status: CliQualityControlStatus,
  pub integrated_lufs: Option<CliQualityControlCheck>,
  pub true_peak_max_dbtp: Option<CliQualityControlCheck>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliQualityControlCheck {
  pub status: CliQualityControlCheckStatus,
  pub measured: Option<f64>,
  pub target: f64,
  pub tolerance: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeError {
  pub message: String,
}

pub fn run_analyze(path: &str) -> CliAnalyzeReport {
  run_analyze_with_options(path, CliAnalyzeOptions::default())
}

pub fn run_analyze_with_options(path: &str, options: CliAnalyzeOptions) -> CliAnalyzeReport {
  let result = if options.dialogue.enabled {
    let vad = options.dialogue.vad.unwrap_or_default();
    analyze_file_track_with_dialogue(path, options.track_index, vad)
  } else if options.track_index.is_none() {
    analyze_file_to_summary(path)
  } else {
    analyze_file_track_to_summary(path, options.track_index)
  };
  match result {
    Ok(result) => CliAnalyzeReport::Success(Box::new(success_report(result, options))),
    Err(message) => CliAnalyzeReport::Error(Box::new(error_report(path, message))),
  }
}

fn success_report(
  result: FileAnalysisSummaryRun,
  options: CliAnalyzeOptions,
) -> CliAnalyzeSuccessReport {
  let dialogue_enabled = options.dialogue.enabled;
  let dialogue_engine = if dialogue_enabled {
    Some(
      options
        .dialogue
        .vad
        .unwrap_or_default()
        .as_key()
        .to_string(),
    )
  } else {
    None
  };
  let mut summary = summary_from_metrics(result.summary, dialogue_enabled);
  if let (Some(dialogue), Some(reference)) = (
    summary.dialogue_integrated_lufs,
    options.dialogue.reference_lufs,
  ) {
    summary.dialogue_offset_from_reference_lu = Some(dialogue - reference);
  }
  let quality_control = evaluate_quality_control(&summary, options.quality_control);
  CliAnalyzeSuccessReport {
    schema_version: 1,
    command: "analyze".to_string(),
    status: CliAnalyzeStatus::Ok,
    app: app_info(),
    source: source_from_probe(result.probe),
    analysis: CliAnalyzeMetadata {
      decoded_frames: result.decoded_frames,
      dialogue: CliAnalyzeDialogue {
        enabled: dialogue_enabled,
        engine: dialogue_engine,
      },
      reference_lufs: options.dialogue.reference_lufs,
    },
    summary,
    quality_control,
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

fn summary_from_metrics(
  summary: FileAnalysisSummaryMetrics,
  dialogue_enabled: bool,
) -> CliAnalyzeSummary {
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
    dialogue_integrated_lufs: if dialogue_enabled {
      finite_or_none(summary.dialogue_integrated)
    } else {
      None
    },
    dialogue_lra: if dialogue_enabled {
      finite_or_none(summary.dialogue_lra)
    } else {
      None
    },
    dialogue_offset_from_reference_lu: None,
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

fn evaluate_quality_control(
  summary: &CliAnalyzeSummary,
  options: CliQualityControlOptions,
) -> CliAnalyzeQualityControl {
  let integrated_lufs = options.target_lufs.map(|target| {
    let tolerance = options.lufs_tolerance.unwrap_or(0.0);
    let measured = summary.integrated_lufs;
    let status = match measured {
      Some(measured) if (measured - target).abs() <= tolerance => {
        CliQualityControlCheckStatus::Pass
      }
      Some(_) => CliQualityControlCheckStatus::Fail,
      None => CliQualityControlCheckStatus::Unavailable,
    };
    CliQualityControlCheck {
      status,
      measured,
      target,
      tolerance: Some(tolerance),
    }
  });
  let true_peak_max_dbtp = options.max_true_peak_dbtp.map(|target| {
    let measured = summary.true_peak_max_dbtp;
    let status = match measured {
      Some(measured) if measured <= target => CliQualityControlCheckStatus::Pass,
      Some(_) => CliQualityControlCheckStatus::Fail,
      None => CliQualityControlCheckStatus::Unavailable,
    };
    CliQualityControlCheck {
      status,
      measured,
      target,
      tolerance: None,
    }
  });

  let requested = integrated_lufs.is_some() || true_peak_max_dbtp.is_some();
  let failed = [&integrated_lufs, &true_peak_max_dbtp]
    .into_iter()
    .flatten()
    .any(|check| check.status != CliQualityControlCheckStatus::Pass);
  let status = if !requested {
    CliQualityControlStatus::NotEvaluated
  } else if failed {
    CliQualityControlStatus::Fail
  } else {
    CliQualityControlStatus::Pass
  };

  CliAnalyzeQualityControl {
    status,
    integrated_lufs,
    true_peak_max_dbtp,
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
    let summary = summary_from_metrics(summary_with_peaks(-3.0, f64::NEG_INFINITY), false);

    assert_eq!(summary.true_peak_max_dbtp, None);
    assert_eq!(summary.sample_peak_max_l_db, Some(-3.0));
    assert_eq!(summary.sample_peak_max_r_db, None);
    assert_eq!(summary.sample_peak_max_db, Some(-3.0));
    assert_eq!(summary.dialogue_integrated_lufs, None);
    assert_eq!(summary.dialogue_lra, None);
  }

  #[test]
  fn summary_exposes_dialogue_metrics_when_enabled() {
    let mut metrics = summary_with_peaks(-3.0, -4.0);
    metrics.dialogue_integrated = -20.5;
    metrics.dialogue_lra = 2.25;
    let summary = summary_from_metrics(metrics, true);

    assert_eq!(summary.dialogue_integrated_lufs, Some(-20.5));
    assert_eq!(summary.dialogue_lra, Some(2.25));
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

  #[test]
  fn quality_control_is_not_evaluated_without_user_thresholds() {
    let summary = summary_from_metrics(summary_with_peaks(-3.0, -4.0), false);
    let qc = evaluate_quality_control(&summary, CliQualityControlOptions::default());

    assert_eq!(qc.status, CliQualityControlStatus::NotEvaluated);
  }

  #[test]
  fn quality_control_uses_custom_loudness_and_true_peak_thresholds() {
    let summary = summary_from_metrics(summary_with_peaks(-3.0, -4.0), false);
    let qc = evaluate_quality_control(
      &summary,
      CliQualityControlOptions {
        target_lufs: Some(-16.5),
        lufs_tolerance: Some(1.0),
        max_true_peak_dbtp: Some(-1.0),
      },
    );

    assert_eq!(qc.status, CliQualityControlStatus::Fail);
    assert_eq!(
      qc.integrated_lufs.as_ref().map(|check| check.status),
      Some(CliQualityControlCheckStatus::Pass)
    );
    assert_eq!(
      qc.true_peak_max_dbtp.as_ref().map(|check| check.status),
      Some(CliQualityControlCheckStatus::Unavailable)
    );
  }

  #[test]
  fn success_report_keeps_ok_status_when_quality_control_fails() {
    let result = FileAnalysisSummaryRun {
      probe: FileAnalysisProbeResult {
        path: "mix.wav".to_string(),
        file_name: "mix.wav".to_string(),
        container: Some("wav".to_string()),
        duration_ms: Some(1000),
        selected_track: FileAudioTrackMetadata {
          index: 0,
          codec: "pcm_f32le".to_string(),
          sample_rate_hz: Some(48_000),
          channels: Some(2),
          language: None,
        },
      },
      decoded_frames: 48_000,
      summary: summary_with_peaks(-3.0, -4.0),
    };
    let report = CliAnalyzeReport::Success(Box::new(success_report(
      result,
      CliAnalyzeOptions {
        quality_control: CliQualityControlOptions {
          target_lufs: Some(-14.0),
          lufs_tolerance: Some(0.5),
          max_true_peak_dbtp: None,
        },
        ..CliAnalyzeOptions::default()
      },
    )));
    let json = serde_json::to_value(&report).expect("serialize");

    assert_eq!(json["status"], "ok");
    assert_eq!(json["qualityControl"]["status"], "fail");
    assert!(report.quality_control_failed());
  }

  #[test]
  fn success_report_computes_dialogue_offset_from_reference() {
    let mut summary = summary_with_peaks(-3.0, -4.0);
    summary.integrated_lufs = -16.0;
    summary.dialogue_integrated = -18.0;
    summary.dialogue_lra = 1.5;
    let result = FileAnalysisSummaryRun {
      probe: FileAnalysisProbeResult {
        path: "mix.wav".to_string(),
        file_name: "mix.wav".to_string(),
        container: Some("wav".to_string()),
        duration_ms: Some(1000),
        selected_track: FileAudioTrackMetadata {
          index: 0,
          codec: "pcm_f32le".to_string(),
          sample_rate_hz: Some(48_000),
          channels: Some(2),
          language: None,
        },
      },
      decoded_frames: 48_000,
      summary,
    };
    let report = success_report(
      result,
      CliAnalyzeOptions {
        dialogue: CliDialogueOptions {
          enabled: true,
          vad: Some(VadEngineKind::FireRed),
          reference_lufs: Some(-16.0),
        },
        ..CliAnalyzeOptions::default()
      },
    );
    let json = serde_json::to_value(&report).expect("serialize");

    assert_eq!(json["analysis"]["dialogue"]["enabled"], true);
    assert_eq!(json["analysis"]["dialogue"]["engine"], "firered");
    assert_eq!(json["analysis"]["referenceLufs"], -16.0);
    assert_eq!(json["summary"]["dialogueIntegratedLufs"], -18.0);
    assert_eq!(json["summary"]["dialogueOffsetFromReferenceLu"], -2.0);
  }
}
