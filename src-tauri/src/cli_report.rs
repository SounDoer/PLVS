use serde_json::Value;

use crate::cli_analyze::{CliAnalyzeReport, CliQualityControlCheckStatus, CliQualityControlStatus};
use crate::doctor::{DoctorReport, DoctorStatus};

#[derive(Debug, Clone, PartialEq)]
struct ReportItem {
  file: String,
  status: String,
  error: Option<String>,
  duration_ms: Option<u64>,
  integrated_lufs: Option<f64>,
  lra: Option<f64>,
  true_peak_max_dbtp: Option<f64>,
  sample_peak_max_db: Option<f64>,
  sample_rate_hz: Option<u64>,
  channel_count: Option<u64>,
}

pub fn render_markdown_report(input: &str) -> Result<String, String> {
  let value: Value =
    serde_json::from_str(input).map_err(|err| format!("Unable to parse analysis JSON: {err}"))?;
  let items = normalize_report_items(&value)?;
  Ok(render_items_markdown(&items))
}

pub fn render_doctor_text(report: &DoctorReport) -> String {
  let mut output = format!(
    "PLVS {} doctor: {}\nPlatform: {} {}\nChecks: {} ok, {} warning, {} error, {} skipped\n",
    report.app.version,
    doctor_status_label(report.status),
    report.platform.os,
    report.platform.arch,
    report.summary.ok,
    report.summary.warning,
    report.summary.error,
    report.summary.skipped,
  );
  for check in &report.checks {
    output.push_str(&format!(
      "- [{}] {}\n",
      doctor_status_label(check.status),
      check.title
    ));
  }
  output
}

pub fn render_analyze_text(report: &CliAnalyzeReport) -> String {
  match report {
    CliAnalyzeReport::Error(report) => {
      format!(
        "PLVS analysis error\nFile: {}\n{}\n",
        report.source.path, report.error.message
      )
    }
    CliAnalyzeReport::Success(report) => {
      let summary = &report.summary;
      let mut output = format!(
        "PLVS analysis\nFile: {}\nTrack: {} ({}, {} Hz, {} ch)\nIntegrated: {}\nLRA: {}\nTrue peak max: {}\nSample peak max: {}\n",
        report.source.file_name,
        report.source.selected_track.index,
        report.source.selected_track.codec,
        format_optional_integer(report.source.selected_track.sample_rate_hz.map(u64::from)),
        format_optional_integer(report.source.selected_track.channels.map(u64::from)),
        format_number(summary.integrated_lufs, 1, " LUFS"),
        format_number(summary.lra, 1, " LU"),
        format_dbtp(summary.true_peak_max_dbtp),
        format_dbfs(summary.sample_peak_max_db),
      );
      if report.analysis.dialogue.enabled {
        output.push_str(&format!(
          "Dialogue ({}) integrated: {}\nDialogue LRA: {}\n",
          report
            .analysis
            .dialogue
            .engine
            .as_deref()
            .unwrap_or("unknown"),
          format_number(summary.dialogue_integrated_lufs, 1, " LUFS"),
          format_number(summary.dialogue_lra, 1, " LU"),
        ));
        if let Some(reference) = report.analysis.reference_lufs {
          output.push_str(&format!(
            "Dialogue vs reference ({:.1} LUFS): {}\n",
            reference,
            format_number(summary.dialogue_offset_from_reference_lu, 1, " LU"),
          ));
        }
      }
      if report.quality_control.status != CliQualityControlStatus::NotEvaluated {
        output.push_str(&format!(
          "QC: {}\n",
          match report.quality_control.status {
            CliQualityControlStatus::Pass => "pass",
            CliQualityControlStatus::Fail => "fail",
            CliQualityControlStatus::NotEvaluated => "not evaluated",
          }
        ));
        if let Some(check) = &report.quality_control.integrated_lufs {
          output.push_str(&format!(
            "- Integrated: {} (target {:.1} ± {:.1} LU, measured {})\n",
            qc_check_status_label(check.status),
            check.target,
            check.tolerance.unwrap_or(0.0),
            format_number(check.measured, 1, " LUFS"),
          ));
        }
        if let Some(check) = &report.quality_control.true_peak_max_dbtp {
          output.push_str(&format!(
            "- True peak max: {} (ceiling {:.1} dBTP, measured {})\n",
            qc_check_status_label(check.status),
            check.target,
            format_dbtp(check.measured),
          ));
        }
      }
      output
    }
  }
}

fn doctor_status_label(status: DoctorStatus) -> &'static str {
  match status {
    DoctorStatus::Ok => "ok",
    DoctorStatus::Warning => "warning",
    DoctorStatus::Error => "error",
    DoctorStatus::Skipped => "skipped",
  }
}

fn qc_check_status_label(status: CliQualityControlCheckStatus) -> &'static str {
  match status {
    CliQualityControlCheckStatus::Pass => "pass",
    CliQualityControlCheckStatus::Fail => "fail",
    CliQualityControlCheckStatus::Unavailable => "unavailable",
  }
}

fn normalize_report_items(value: &Value) -> Result<Vec<ReportItem>, String> {
  if value.get("command").and_then(Value::as_str) == Some("analyze-batch") {
    let results = value
      .get("results")
      .and_then(Value::as_array)
      .ok_or_else(|| "Analyze-batch JSON is missing results.".to_string())?;
    return results
      .iter()
      .map(|result| {
        let fallback_path = result.get("path").and_then(Value::as_str);
        let report = result
          .get("report")
          .ok_or_else(|| "Analyze-batch result is missing report.".to_string())?;
        item_from_analyze_report(report, fallback_path)
      })
      .collect();
  }

  if value.get("command").and_then(Value::as_str) == Some("analyze") {
    return Ok(vec![item_from_analyze_report(value, None)?]);
  }

  if value.get("command").and_then(Value::as_str) == Some("capture") {
    return Ok(vec![item_from_capture_report(value)?]);
  }

  Err("Unsupported report input. Expected analyze, analyze-batch, or capture JSON.".to_string())
}

fn item_from_analyze_report(
  value: &Value,
  fallback_path: Option<&str>,
) -> Result<ReportItem, String> {
  let status = value
    .get("status")
    .and_then(Value::as_str)
    .ok_or_else(|| "Analyze JSON is missing status.".to_string())?;
  let file = display_file_name(value, fallback_path);

  if status == "error" {
    return Ok(ReportItem {
      file,
      status: "error".to_string(),
      error: value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string),
      duration_ms: None,
      integrated_lufs: None,
      lra: None,
      true_peak_max_dbtp: None,
      sample_peak_max_db: None,
      sample_rate_hz: None,
      channel_count: None,
    });
  }

  let summary = value
    .get("summary")
    .ok_or_else(|| "Analyze JSON is missing summary.".to_string())?;

  Ok(ReportItem {
    file,
    status: status.to_string(),
    error: None,
    duration_ms: summary.get("durationMs").and_then(Value::as_u64),
    integrated_lufs: summary.get("integratedLufs").and_then(Value::as_f64),
    lra: summary.get("lra").and_then(Value::as_f64),
    true_peak_max_dbtp: summary.get("truePeakMaxDbtp").and_then(Value::as_f64),
    sample_peak_max_db: summary.get("samplePeakMaxDb").and_then(Value::as_f64),
    sample_rate_hz: summary.get("sampleRateHz").and_then(Value::as_u64),
    channel_count: summary.get("channelCount").and_then(Value::as_u64),
  })
}

fn item_from_capture_report(value: &Value) -> Result<ReportItem, String> {
  let status = value
    .get("status")
    .and_then(Value::as_str)
    .ok_or_else(|| "Capture JSON is missing status.".to_string())?;
  let source = value.get("source");
  let file = source
    .and_then(|source| source.get("deviceName"))
    .and_then(Value::as_str)
    .or_else(|| {
      source
        .and_then(|source| source.get("deviceId"))
        .and_then(Value::as_str)
    })
    .unwrap_or("Unknown device")
    .to_string();
  if status == "error" {
    return Ok(ReportItem {
      file,
      status: "error".to_string(),
      error: value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string),
      duration_ms: None,
      integrated_lufs: None,
      lra: None,
      true_peak_max_dbtp: None,
      sample_peak_max_db: None,
      sample_rate_hz: None,
      channel_count: None,
    });
  }
  let summary = value
    .get("summary")
    .ok_or_else(|| "Capture JSON is missing summary.".to_string())?;
  Ok(ReportItem {
    file,
    status: status.to_string(),
    error: None,
    duration_ms: source
      .and_then(|source| source.get("capturedMs"))
      .and_then(Value::as_u64),
    integrated_lufs: summary.get("integratedLufs").and_then(Value::as_f64),
    lra: summary.get("lra").and_then(Value::as_f64),
    true_peak_max_dbtp: summary.get("truePeakMaxDbtp").and_then(Value::as_f64),
    sample_peak_max_db: summary.get("samplePeakMaxDb").and_then(Value::as_f64),
    sample_rate_hz: source
      .and_then(|source| source.get("sampleRateHz"))
      .and_then(Value::as_u64),
    channel_count: source
      .and_then(|source| source.get("channelCount"))
      .and_then(Value::as_u64),
  })
}

fn display_file_name(value: &Value, fallback_path: Option<&str>) -> String {
  let source = value.get("source");
  source
    .and_then(|source| source.get("fileName"))
    .and_then(Value::as_str)
    .or_else(|| {
      source
        .and_then(|source| source.get("path"))
        .and_then(Value::as_str)
    })
    .or(fallback_path)
    .map(file_name_from_path)
    .filter(|name| !name.is_empty())
    .unwrap_or_else(|| "Unknown file".to_string())
}

fn file_name_from_path(path: &str) -> String {
  path
    .replace('\\', "/")
    .rsplit('/')
    .next()
    .unwrap_or(path)
    .to_string()
}

fn render_items_markdown(items: &[ReportItem]) -> String {
  let mut output = String::from("# PLVS Analysis Report\n\n");
  output.push_str(&format!(
    "{} file{}\n\n",
    items.len(),
    if items.len() == 1 { "" } else { "s" }
  ));
  output.push_str("| File | Duration | LUFS-I | LRA | TP Max | Sample Peak | SR | Ch | Status |\n");
  output.push_str("|---|---:|---:|---:|---:|---:|---:|---:|---|\n");

  for item in items {
    output.push_str(&format!(
      "| {} | {} | {} | {} | {} | {} | {} | {} | {} |\n",
      escape_markdown_cell(&item.file),
      format_duration(item.duration_ms),
      format_lufs(item.integrated_lufs),
      format_lu(item.lra),
      format_dbtp(item.true_peak_max_dbtp),
      format_dbfs(item.sample_peak_max_db),
      format_sample_rate(item.sample_rate_hz),
      format_count(item.channel_count),
      escape_markdown_cell(&format_status(item)),
    ));
  }

  output
}

fn format_status(item: &ReportItem) -> String {
  match (&item.status[..], item.error.as_deref()) {
    ("error", Some(error)) => format!("error: {error}"),
    ("error", None) => "error".to_string(),
    _ => item.status.clone(),
  }
}

fn format_duration(value: Option<u64>) -> String {
  let Some(ms) = value else {
    return "-".to_string();
  };
  let total_seconds = ms as f64 / 1000.0;
  let minutes = (total_seconds / 60.0).floor() as u64;
  let seconds = total_seconds - (minutes * 60) as f64;
  format!("{minutes}:{seconds:04.1}")
}

fn format_lufs(value: Option<f64>) -> String {
  format_number(value, 1, "")
}

fn format_lu(value: Option<f64>) -> String {
  format_number(value, 1, "")
}

fn format_dbtp(value: Option<f64>) -> String {
  format_number(value, 1, " dBTP")
}

fn format_dbfs(value: Option<f64>) -> String {
  format_number(value, 1, " dBFS")
}

fn format_sample_rate(value: Option<u64>) -> String {
  match value {
    Some(value) if value % 1000 == 0 => format!("{} kHz", value / 1000),
    Some(value) => format!("{:.1} kHz", value as f64 / 1000.0),
    None => "-".to_string(),
  }
}

fn format_count(value: Option<u64>) -> String {
  value.map_or_else(|| "-".to_string(), |value| value.to_string())
}

fn format_optional_integer(value: Option<u64>) -> String {
  value.map_or_else(|| "-".to_string(), |value| value.to_string())
}

fn format_number(value: Option<f64>, precision: usize, suffix: &str) -> String {
  match value {
    Some(value) if value.is_finite() => format!("{value:.precision$}{suffix}"),
    _ => "-".to_string(),
  }
}

fn escape_markdown_cell(value: &str) -> String {
  value.replace('|', "\\|").replace('\n', " ")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn renders_single_analyze_markdown() {
    let input = r#"{
      "schemaVersion": 1,
      "command": "analyze",
      "status": "ok",
      "source": { "path": "C:\\mixes\\mix.wav", "fileName": "mix.wav" },
      "summary": {
        "durationMs": 192400,
        "sampleRateHz": 48000,
        "channelCount": 2,
        "integratedLufs": -16.12,
        "lra": 4.23,
        "truePeakMaxDbtp": -1.06,
        "samplePeakMaxDb": -1.41
      }
    }"#;

    let markdown = render_markdown_report(input).expect("report");

    assert!(markdown.contains("# PLVS Analysis Report"));
    assert!(markdown
      .contains("| mix.wav | 3:12.4 | -16.1 | 4.2 | -1.1 dBTP | -1.4 dBFS | 48 kHz | 2 | ok |"));
  }

  #[test]
  fn renders_batch_errors() {
    let input = r#"{
      "schemaVersion": 1,
      "command": "analyze-batch",
      "status": "warning",
      "results": [
        {
          "path": "a.wav",
          "status": "error",
          "report": {
            "schemaVersion": 1,
            "command": "analyze",
            "status": "error",
            "source": { "path": "a.wav" },
            "error": { "message": "ffmpeg failed" }
          }
        }
      ]
    }"#;

    let markdown = render_markdown_report(input).expect("report");

    assert!(markdown.contains("| a.wav | - | - | - | - | - | - | - | error: ffmpeg failed |"));
  }

  #[test]
  fn rejects_unsupported_json() {
    let err = render_markdown_report(r#"{"command":"doctor"}"#).expect_err("unsupported");

    assert!(err.contains("Unsupported report input"));
  }

  #[test]
  fn renders_capture_markdown() {
    let input = r#"{
      "schemaVersion": 1,
      "command": "capture",
      "status": "ok",
      "source": {
        "deviceName": "CABLE Output",
        "capturedMs": 10000,
        "sampleRateHz": 48000,
        "channelCount": 2
      },
      "summary": {
        "integratedLufs": -20.02,
        "lra": 2.5,
        "truePeakMaxDbtp": -0.8,
        "samplePeakMaxDb": -3.1
      }
    }"#;

    let markdown = render_markdown_report(input).expect("report");

    assert!(markdown.contains(
      "| CABLE Output | 0:10.0 | -20.0 | 2.5 | -0.8 dBTP | -3.1 dBFS | 48 kHz | 2 | ok |"
    ));
  }
}
