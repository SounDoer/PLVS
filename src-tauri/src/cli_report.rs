use serde_json::Value;

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

  Err("Unsupported report input. Expected analyze or analyze-batch JSON.".to_string())
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
}
