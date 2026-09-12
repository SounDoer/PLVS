use crate::cli_analyze::{CliAnalyzeReport, CliQualityControlCheckStatus, CliQualityControlStatus};
use crate::doctor::{DoctorReport, DoctorStatus};

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

fn format_dbtp(value: Option<f64>) -> String {
  format_number(value, 1, " dBTP")
}

fn format_dbfs(value: Option<f64>) -> String {
  format_number(value, 1, " dBFS")
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
