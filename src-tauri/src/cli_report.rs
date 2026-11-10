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
      let locations = summary.maxima_locations.as_ref();
      output.push_str(&format!("Sample Peak Max Location: {}\nTrue Peak Max Location: {}\nMomentary Max Window End: {}\nShort-term Max Window End: {}\n",
        format_channel_location(locations.and_then(|l| l.sample_peak_max.as_ref())),
        format_channel_location(locations.and_then(|l| l.true_peak_max.as_ref())),
        format_location(locations.and_then(|l| l.m_max_window_end.as_ref())),
        format_location(locations.and_then(|l| l.st_max_window_end.as_ref())),
      ));
      for peak in &summary.channel_peaks {
        output.push_str(&format!(
          "Ch{}: Sample Peak Max {}, True Peak Max {}\n",
          peak.channel_index + 1,
          format_dbfs(peak.sample_peak_max_db),
          format_dbtp(peak.true_peak_max_dbtp)
        ));
      }
      for peak in &summary.channel_peaks {
        output.push_str(&format!(
          "Ch{} Sample Peak Max Location: {}\nCh{} True Peak Max Location: {}\n",
          peak.channel_index + 1,
          format_location(peak.sample_peak_max_location.as_ref()),
          peak.channel_index + 1,
          format_location(peak.true_peak_max_location.as_ref()),
        ));
      }
      if report.analysis.dialogue.enabled {
        output.push_str(&format!(
          "Dialogue Loudness ({}): {}\nLDR: {}\nDialogue Coverage: {}\nDialogue Range: {}\n",
          report
            .analysis
            .dialogue
            .engine
            .as_deref()
            .unwrap_or("unknown"),
          format_number(summary.dialogue_loudness_lufs, 1, " LUFS"),
          format_number(summary.loudness_to_dialogue_ratio_lu, 1, " LU"),
          format_number(summary.dialogue_coverage_percent, 0, "%"),
          format_number(summary.dialogue_range_lu, 1, " LU"),
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

fn format_location(location: Option<&crate::dsp::max_locations::MetricLocation>) -> String {
  match location {
    Some(location) => format!(
      "{:.9} s (Frame {}{})",
      location.time_seconds,
      location.frame_position,
      if location.frame_position < 0.0 {
        "; Before Start"
      } else {
        ""
      }
    ),
    None => "-".to_string(),
  }
}

fn format_channel_location(
  location: Option<&crate::dsp::max_locations::ChannelPeakLocation>,
) -> String {
  location.map_or_else(
    || "-".to_string(),
    |location| {
      format!(
        "Ch{} · {}",
        location.channel_index + 1,
        format_location(Some(&location.location))
      )
    },
  )
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

#[cfg(test)]
mod tests {
  use super::*;
  use crate::cli_analyze::{CliAnalyzeSuccessReport, CliAnalyzeSummary, CliAnalyzeTrack};
  use crate::doctor::{DoctorAppInfo, DoctorCheck, DoctorPaths, DoctorPlatformInfo, DoctorSummary};
  use serde_json::json;

  fn doctor_check(id: &str, status: DoctorStatus, title: &str) -> DoctorCheck {
    DoctorCheck {
      id: id.to_string(),
      status,
      severity: status,
      title: title.to_string(),
      details: json!({}),
    }
  }

  fn sample_doctor_report() -> DoctorReport {
    DoctorReport {
      status: DoctorStatus::Warning,
      summary: DoctorSummary {
        ok: 1,
        warning: 1,
        error: 2,
        skipped: 3,
      },
      app: DoctorAppInfo {
        name: "PLVS".to_string(),
        version: "1.2.3".to_string(),
        executable_path: None,
      },
      platform: DoctorPlatformInfo {
        os: "windows".to_string(),
        arch: "x86_64".to_string(),
      },
      paths: DoctorPaths {
        config_dir: None,
        data_dir: None,
      },
      checks: vec![
        doctor_check(
          "app-info",
          DoctorStatus::Ok,
          "Application information was collected",
        ),
        doctor_check(
          "device-enumeration",
          DoctorStatus::Warning,
          "No audio devices were enumerated",
        ),
      ],
    }
  }

  #[test]
  fn doctor_text_header_carries_version_status_platform_and_counts() {
    let output = render_doctor_text(&sample_doctor_report());

    assert!(output.contains("PLVS 1.2.3 doctor: warning"));
    assert!(output.contains("Platform: windows x86_64"));
    assert!(output.contains("Checks: 1 ok, 1 warning, 2 error, 3 skipped"));
  }

  #[test]
  fn doctor_text_lists_each_check_with_its_status_label() {
    let output = render_doctor_text(&sample_doctor_report());

    assert!(output.contains("- [ok] Application information was collected"));
    assert!(output.contains("- [warning] No audio devices were enumerated"));
  }

  #[test]
  fn doctor_status_labels_cover_all_variants() {
    assert_eq!(doctor_status_label(DoctorStatus::Ok), "ok");
    assert_eq!(doctor_status_label(DoctorStatus::Warning), "warning");
    assert_eq!(doctor_status_label(DoctorStatus::Error), "error");
    assert_eq!(doctor_status_label(DoctorStatus::Skipped), "skipped");
  }

  fn sample_track() -> CliAnalyzeTrack {
    CliAnalyzeTrack {
      index: 0,
      codec: "pcm_s16le".to_string(),
      sample_rate_hz: Some(48_000),
      channels: Some(2),
      language: None,
    }
  }

  fn sample_summary() -> CliAnalyzeSummary {
    CliAnalyzeSummary {
      duration_ms: Some(1000),
      sample_rate_hz: 48_000,
      channel_count: 2,
      loudness_layout: "stereo".to_string(),
      loudness_layout_known: true,
      integrated_lufs: Some(-16.0),
      lra: Some(3.0),
      m_max_lufs: Some(-15.0),
      st_max_lufs: Some(-14.0),
      true_peak_max_dbtp: Some(-1.5),
      sample_peak_max_l_db: Some(-3.0),
      sample_peak_max_r_db: Some(-4.0),
      sample_peak_max_db: Some(-3.0),
      channel_peaks: vec![],
      maxima_locations: None,
      dialogue_loudness_lufs: None,
      loudness_to_dialogue_ratio_lu: None,
      dialogue_coverage_percent: None,
      dialogue_range_lu: None,
      dialogue_offset_from_reference_lu: None,
    }
  }

  fn sample_success_report() -> CliAnalyzeSuccessReport {
    CliAnalyzeSuccessReport {
      schema_version: 2,
      command: "analyze".to_string(),
      status: crate::cli_analyze::CliAnalyzeStatus::Ok,
      app: crate::cli_analyze::CliAnalyzeApp {
        name: "PLVS".to_string(),
        version: "1.2.3".to_string(),
      },
      source: crate::cli_analyze::CliAnalyzeSource {
        path: "mix.wav".to_string(),
        file_name: "mix.wav".to_string(),
        container: Some("wav".to_string()),
        duration_ms: Some(1000),
        selected_track: sample_track(),
      },
      analysis: crate::cli_analyze::CliAnalyzeMetadata {
        decoded_frames: 48_000,
        dialogue: crate::cli_analyze::CliAnalyzeDialogue {
          enabled: false,
          engine: None,
          metric_algorithm_version: None,
          engine_configuration: None,
          multichannel_fusion: None,
          error: None,
        },
        reference_lufs: None,
      },
      summary: sample_summary(),
      quality_control: crate::cli_analyze::CliAnalyzeQualityControl {
        status: CliQualityControlStatus::NotEvaluated,
        integrated_lufs: None,
        true_peak_max_dbtp: None,
      },
    }
  }

  #[test]
  fn analyze_text_renders_channel_identity_and_unavailable_values() {
    let mut report = sample_success_report();
    report.summary.channel_peaks = vec![crate::dsp::summary_meter::ChannelPeakMax {
      channel_index: 2,
      sample_peak_max_location: None,
      true_peak_max_location: None,
      sample_peak_max_db: None,
      true_peak_max_dbtp: Some(-0.5),
    }];
    let text = render_analyze_text(&CliAnalyzeReport::Success(Box::new(report)));
    assert!(text.contains("Ch3: Sample Peak Max -, True Peak Max -0.5 dBTP"));
  }

  #[test]
  fn analyze_text_preserves_exact_locations_and_marks_padding_and_missing_values() {
    use crate::dsp::max_locations::{ChannelPeakLocation, MaximaLocations, MetricLocation};
    let mut report = sample_success_report();
    report.summary.maxima_locations = Some(MaximaLocations {
      sample_peak_max: Some(ChannelPeakLocation {
        channel_index: 2,
        location: MetricLocation::from_frame(48_000.0, 48_000.0),
      }),
      true_peak_max: Some(ChannelPeakLocation {
        channel_index: 2,
        location: MetricLocation::from_frame(-0.125, 48_000.0),
      }),
      m_max_window_end: Some(MetricLocation::from_frame(48_001.0, 48_000.0)),
      st_max_window_end: None,
    });
    let text = render_analyze_text(&CliAnalyzeReport::Success(Box::new(report)));
    assert!(text.contains("Sample Peak Max Location: Ch3 · 1.000000000 s (Frame 48000)"));
    assert!(
      text.contains("True Peak Max Location: Ch3 · -0.000002604 s (Frame -0.125; Before Start)")
    );
    assert!(text.contains("Momentary Max Window End: 1.000020833 s (Frame 48001)"));
    assert!(text.contains("Short-term Max Window End: -"));
  }

  #[test]
  fn analyze_text_error_report_renders_path_and_message() {
    let report = CliAnalyzeReport::Error(Box::new(crate::cli_analyze::CliAnalyzeErrorReport {
      schema_version: 2,
      command: "analyze".to_string(),
      status: crate::cli_analyze::CliAnalyzeStatus::Error,
      app: crate::cli_analyze::CliAnalyzeApp {
        name: "PLVS".to_string(),
        version: "1.2.3".to_string(),
      },
      source: crate::cli_analyze::CliAnalyzeErrorSource {
        path: "missing.wav".to_string(),
      },
      error: crate::cli_analyze::CliAnalyzeError {
        message: "no such file".to_string(),
      },
    }));

    let output = render_analyze_text(&report);

    assert!(output.contains("File: missing.wav"));
    assert!(output.contains("no such file"));
  }

  #[test]
  fn analyze_text_success_renders_file_track_and_measurements() {
    let report = CliAnalyzeReport::Success(Box::new(sample_success_report()));

    let output = render_analyze_text(&report);

    assert!(output.contains("File: mix.wav"));
    assert!(output.contains("Track: 0 (pcm_s16le, 48000 Hz, 2 ch)"));
    assert!(output.contains("Integrated: -16.0 LUFS"));
    assert!(output.contains("LRA: 3.0 LU"));
    assert!(output.contains("True peak max: -1.5 dBTP"));
    assert!(output.contains("Sample peak max: -3.0 dBFS"));
  }

  #[test]
  fn analyze_text_success_renders_dash_for_missing_or_non_finite_values() {
    let mut success = sample_success_report();
    success.summary.integrated_lufs = None;
    success.source.selected_track.sample_rate_hz = None;

    let report = CliAnalyzeReport::Success(Box::new(success));
    let output = render_analyze_text(&report);

    assert!(output.contains("Integrated: -\n"));
    assert!(output.contains("Track: 0 (pcm_s16le, - Hz, 2 ch)"));
  }

  #[test]
  fn analyze_text_omits_dialogue_lines_when_disabled() {
    let report = CliAnalyzeReport::Success(Box::new(sample_success_report()));
    let output = render_analyze_text(&report);

    assert!(!output.contains("Dialogue"));
  }

  #[test]
  fn analyze_text_shows_dialogue_lines_but_not_reference_when_absent() {
    let mut success = sample_success_report();
    success.analysis.dialogue.enabled = true;
    success.analysis.dialogue.engine = Some("silero".to_string());
    success.summary.dialogue_loudness_lufs = Some(-20.5);
    success.summary.loudness_to_dialogue_ratio_lu = Some(4.5);
    success.summary.dialogue_coverage_percent = Some(63.0);
    success.summary.dialogue_range_lu = Some(2.3);

    let report = CliAnalyzeReport::Success(Box::new(success));
    let output = render_analyze_text(&report);

    assert!(output.contains("Dialogue Loudness (silero): -20.5 LUFS"));
    assert!(output.contains("LDR: 4.5 LU"));
    assert!(output.contains("Dialogue Coverage: 63%"));
    assert!(output.contains("Dialogue Range: 2.3 LU"));
    assert!(!output.contains("Dialogue vs reference"));
  }

  #[test]
  fn analyze_text_shows_reference_line_when_reference_lufs_present() {
    let mut success = sample_success_report();
    success.analysis.dialogue.enabled = true;
    success.analysis.dialogue.engine = Some("firered".to_string());
    success.analysis.reference_lufs = Some(-23.0);
    success.summary.dialogue_loudness_lufs = Some(-20.5);
    success.summary.dialogue_range_lu = Some(2.25);
    success.summary.dialogue_offset_from_reference_lu = Some(2.5);

    let report = CliAnalyzeReport::Success(Box::new(success));
    let output = render_analyze_text(&report);

    assert!(output.contains("Dialogue vs reference (-23.0 LUFS): 2.5 LU"));
  }

  #[test]
  fn analyze_text_omits_qc_section_when_not_evaluated() {
    let report = CliAnalyzeReport::Success(Box::new(sample_success_report()));
    let output = render_analyze_text(&report);

    assert!(!output.contains("QC:"));
  }

  #[test]
  fn analyze_text_qc_section_reports_pass_and_fail_checks() {
    let mut success = sample_success_report();
    success.quality_control = crate::cli_analyze::CliAnalyzeQualityControl {
      status: CliQualityControlStatus::Fail,
      integrated_lufs: Some(crate::cli_analyze::CliQualityControlCheck {
        status: CliQualityControlCheckStatus::Pass,
        measured: Some(-16.0),
        target: -16.5,
        tolerance: Some(1.0),
      }),
      true_peak_max_dbtp: Some(crate::cli_analyze::CliQualityControlCheck {
        status: CliQualityControlCheckStatus::Fail,
        measured: Some(-0.5),
        target: -1.0,
        tolerance: None,
      }),
    };

    let report = CliAnalyzeReport::Success(Box::new(success));
    let output = render_analyze_text(&report);

    assert!(output.contains("QC: fail"));
    assert!(output.contains("- Integrated: pass (target -16.5 ± 1.0 LU, measured -16.0 LUFS)"));
    assert!(output.contains("- True peak max: fail (ceiling -1.0 dBTP, measured -0.5 dBTP)"));
  }

  #[test]
  fn analyze_text_qc_check_reports_unavailable_when_measurement_missing() {
    let mut success = sample_success_report();
    success.quality_control = crate::cli_analyze::CliAnalyzeQualityControl {
      status: CliQualityControlStatus::Fail,
      integrated_lufs: Some(crate::cli_analyze::CliQualityControlCheck {
        status: CliQualityControlCheckStatus::Unavailable,
        measured: None,
        target: -16.5,
        tolerance: Some(1.0),
      }),
      true_peak_max_dbtp: None,
    };

    let report = CliAnalyzeReport::Success(Box::new(success));
    let output = render_analyze_text(&report);

    assert!(output.contains("- Integrated: unavailable (target -16.5 ± 1.0 LU, measured -)"));
  }
}
