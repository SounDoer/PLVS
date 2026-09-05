//! CLI command implementation, hosted inside the main `plvs` binary behind the
//! internal `--cli` flag. The shipped `plvs-cli` executable is a thin forwarder
//! (see `bin/plvs-cli.rs`) so the engine (ONNX runtime, VAD models, DSP) is
//! linked into the installer only once.

use std::fs;
use std::process::ExitCode;

use serde::Serialize;

#[cfg(any(feature = "capture-harness", test))]
use crate::audio::capture_summary::CaptureSample;
#[cfg(any(feature = "capture-harness", test))]
use crate::cli_analyze::{
  run_analyze_with_options, CliAnalyzeOptions, CliAnalyzeStatus, CliDialogueOptions,
  CliQualityControlOptions,
};
use crate::cli_app::{self, CliAppCommand};
#[cfg(any(feature = "capture-harness", test))]
use crate::cli_capture::{run_capture, sample_line, CliCaptureStatus};
use crate::cli_contract::CLI_SCHEMA_VERSION;
#[cfg(any(feature = "capture-harness", test))]
use crate::cli_report::render_analyze_text;
use crate::cli_report::render_doctor_text;
use crate::doctor::{run_doctor, DoctorReport, DoctorStatus};
#[cfg(any(feature = "capture-harness", test))]
use crate::dsp::speech::VadEngineKind;

#[derive(Debug, Clone, PartialEq)]
enum CliCommand {
  Help(HelpTopic),
  Version,
  App(CliAppCommand),
  Doctor {
    json: bool,
    out: Option<String>,
  },
  #[cfg(any(feature = "capture-harness", test))]
  Analyze {
    path: String,
    json: bool,
    options: CliAnalyzeOptions,
    out: Option<String>,
  },
  #[cfg(any(feature = "capture-harness", test))]
  CaptureJson {
    device: Option<String>,
    seconds: u64,
    every: Option<u64>,
    out: Option<String>,
  },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HelpTopic {
  Root,
  Doctor,
  #[cfg(any(feature = "capture-harness", test))]
  Analyze,
  #[cfg(any(feature = "capture-harness", test))]
  Capture,
  App,
}

fn parse_args(args: &[String]) -> Result<CliCommand, String> {
  parse_args_with_app(args, true)
}

#[cfg(any(feature = "capture-harness", test))]
fn parse_harness_args(args: &[String]) -> Result<CliCommand, String> {
  match args {
    [command, rest @ ..] if command == "analyze" => parse_analyze_args(rest),
    [command, rest @ ..] if command == "capture" => parse_capture_args(rest),
    [command, ..] => Err(format!("Unknown harness command: {command}")),
    [] => Err("Missing harness command.".to_string()),
  }
}

fn parse_args_with_app(args: &[String], app_available: bool) -> Result<CliCommand, String> {
  match args {
    [flag] if flag == "--help" || flag == "-h" || flag == "help" => {
      Ok(CliCommand::Help(HelpTopic::Root))
    }
    [command, rest @ ..] if command == "doctor" => parse_doctor_args(rest),
    [command, rest @ ..] if command == "app" && app_available => {
      cli_app::parse_app_args(rest).map(CliCommand::App)
    }
    [command, topic] if command == "help" => parse_help_topic(topic, app_available),
    [command, ..] if command == "help" => Err("Usage: plvs-cli help [doctor|app]".to_string()),
    [command, ..] if is_help_flag(command) => Ok(CliCommand::Help(HelpTopic::Root)),
    [command] if command == "--version" || command == "-V" => Ok(CliCommand::Version),
    [command, ..] => Err(format!("Unknown command: {command}")),
    [] => Err("Missing command. Try: plvs-cli --help".to_string()),
  }
}

fn parse_doctor_args(args: &[String]) -> Result<CliCommand, String> {
  if args.iter().any(|arg| is_help_flag(arg)) {
    return Ok(CliCommand::Help(HelpTopic::Doctor));
  }

  let options = parse_json_output_options(args)?;
  if !options.positionals.is_empty() {
    return Err("Usage: plvs-cli doctor [--json] [--out <file>]".to_string());
  }

  Ok(CliCommand::Doctor {
    json: options.has_json,
    out: options.out,
  })
}

#[cfg(any(feature = "capture-harness", test))]
fn parse_analyze_args(args: &[String]) -> Result<CliCommand, String> {
  if args.iter().any(|arg| is_help_flag(arg)) {
    return Ok(CliCommand::Help(HelpTopic::Analyze));
  }

  let mut path = None;
  let mut json = false;
  let mut out = None;
  let mut options = ParsedAnalyzeOptions::default();
  let mut index = 0;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--out" => {
        out = Some(take_value(args, index, "--out")?);
        index += 2;
      }
      flag if parse_analyze_option_flag(args, &mut index, flag, &mut options)? => {}
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value if path.is_none() => {
        path = Some(value.to_string());
        index += 1;
      }
      value => return Err(format!("Unexpected argument: {value}")),
    }
  }
  let options = options.finish()?;
  let path = path.ok_or_else(|| {
    "Usage: plvs --harness analyze <path> [--json] [--track <index>] [--dialogue] [--vad <engine>] [--reference-lufs <n>] [QC options] [--out <file>]"
      .to_string()
  })?;
  Ok(CliCommand::Analyze {
    path,
    json,
    options,
    out,
  })
}

#[cfg(any(feature = "capture-harness", test))]
#[derive(Debug, Clone, Copy, PartialEq, Default)]
struct ParsedAnalyzeOptions {
  track_index: Option<u32>,
  target_lufs: Option<f64>,
  lufs_tolerance: Option<f64>,
  max_true_peak_dbtp: Option<f64>,
  dialogue: bool,
  vad: Option<VadEngineKind>,
  reference_lufs: Option<f64>,
}

#[cfg(any(feature = "capture-harness", test))]
impl ParsedAnalyzeOptions {
  fn finish(self) -> Result<CliAnalyzeOptions, String> {
    if self.target_lufs.is_some() != self.lufs_tolerance.is_some() {
      return Err("--target-lufs and --lufs-tolerance must be provided together".to_string());
    }
    if self.vad.is_some() && !self.dialogue {
      return Err("--vad requires --dialogue".to_string());
    }
    Ok(CliAnalyzeOptions {
      track_index: self.track_index,
      quality_control: CliQualityControlOptions {
        target_lufs: self.target_lufs,
        lufs_tolerance: self.lufs_tolerance,
        max_true_peak_dbtp: self.max_true_peak_dbtp,
      },
      dialogue: CliDialogueOptions {
        enabled: self.dialogue,
        vad: self.vad,
        reference_lufs: self.reference_lufs,
      },
    })
  }
}

/// Returns `Ok(true)` when `flag` was an analyze option and `index` was advanced.
#[cfg(any(feature = "capture-harness", test))]
fn parse_analyze_option_flag(
  args: &[String],
  index: &mut usize,
  flag: &str,
  options: &mut ParsedAnalyzeOptions,
) -> Result<bool, String> {
  match flag {
    "--track" => {
      let value = take_value(args, *index, "--track")?;
      options.track_index = Some(
        value
          .parse::<u32>()
          .map_err(|_| "The --track value must be a non-negative integer".to_string())?,
      );
      *index += 2;
      Ok(true)
    }
    "--target-lufs" => {
      options.target_lufs = Some(parse_finite_number(
        &take_value(args, *index, "--target-lufs")?,
        "--target-lufs",
      )?);
      *index += 2;
      Ok(true)
    }
    "--lufs-tolerance" => {
      let value = parse_finite_number(
        &take_value(args, *index, "--lufs-tolerance")?,
        "--lufs-tolerance",
      )?;
      if value < 0.0 {
        return Err("The --lufs-tolerance value must not be negative".to_string());
      }
      options.lufs_tolerance = Some(value);
      *index += 2;
      Ok(true)
    }
    "--max-true-peak" => {
      options.max_true_peak_dbtp = Some(parse_finite_number(
        &take_value(args, *index, "--max-true-peak")?,
        "--max-true-peak",
      )?);
      *index += 2;
      Ok(true)
    }
    "--dialogue" => {
      options.dialogue = true;
      *index += 1;
      Ok(true)
    }
    "--vad" => {
      let value = take_value(args, *index, "--vad")?;
      options.vad = Some(
        VadEngineKind::from_key(&value)
          .ok_or_else(|| "The --vad value must be one of: silero, firered, ten".to_string())?,
      );
      *index += 2;
      Ok(true)
    }
    "--reference-lufs" => {
      options.reference_lufs = Some(parse_finite_number(
        &take_value(args, *index, "--reference-lufs")?,
        "--reference-lufs",
      )?);
      *index += 2;
      Ok(true)
    }
    _ => Ok(false),
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct JsonOutputOptions {
  has_json: bool,
  out: Option<String>,
  positionals: Vec<String>,
}

fn parse_json_output_options(args: &[String]) -> Result<JsonOutputOptions, String> {
  let mut has_json = false;
  let mut out = None;
  let mut positionals = Vec::new();
  let mut index = 0;

  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        has_json = true;
        index += 1;
      }
      "--out" => {
        let Some(path) = args.get(index + 1) else {
          return Err("Missing value for --out".to_string());
        };
        if path.starts_with("--") {
          return Err("Missing value for --out".to_string());
        }
        out = Some(path.clone());
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => {
        positionals.push(value.to_string());
        index += 1;
      }
    }
  }

  Ok(JsonOutputOptions {
    has_json,
    out,
    positionals,
  })
}

fn is_help_flag(value: &str) -> bool {
  value == "--help" || value == "-h"
}

#[cfg(any(feature = "capture-harness", test))]
fn parse_finite_number(value: &str, flag: &str) -> Result<f64, String> {
  let parsed = value
    .parse::<f64>()
    .map_err(|_| format!("The {flag} value must be a finite number"))?;
  if !parsed.is_finite() {
    return Err(format!("The {flag} value must be a finite number"));
  }
  Ok(parsed)
}

fn parse_help_topic(topic: &str, app_available: bool) -> Result<CliCommand, String> {
  match topic {
    "doctor" => Ok(CliCommand::Help(HelpTopic::Doctor)),
    "app" if app_available => Ok(CliCommand::Help(HelpTopic::App)),
    _ => Err(format!("Unknown help topic: {topic}")),
  }
}

#[cfg(any(feature = "capture-harness", test))]
const CAPTURE_USAGE: &str =
  "Usage: plvs --harness capture [--device <substring|stable-id>] --seconds <n> [--every <n>] --json [--out <file>]";

#[cfg(any(feature = "capture-harness", test))]
fn parse_capture_args(args: &[String]) -> Result<CliCommand, String> {
  if args.iter().any(|arg| is_help_flag(arg)) {
    return Ok(CliCommand::Help(HelpTopic::Capture));
  }

  let mut device = None;
  let mut seconds = None;
  let mut every = None;
  let mut out = None;
  let mut has_json = false;
  let mut index = 0;

  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        has_json = true;
        index += 1;
      }
      "--device" => {
        device = Some(take_value(args, index, "--device")?);
        index += 2;
      }
      "--seconds" => {
        seconds = Some(parse_positive_duration(
          &take_value(args, index, "--seconds")?,
          "--seconds",
        )?);
        index += 2;
      }
      "--every" => {
        every = Some(parse_positive_duration(
          &take_value(args, index, "--every")?,
          "--every",
        )?);
        index += 2;
      }
      "--out" => {
        out = Some(take_value(args, index, "--out")?);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => return Err(format!("Unexpected argument: {value}\n{CAPTURE_USAGE}")),
    }
  }

  if !has_json {
    return Err("The capture command currently requires --json.".to_string());
  }
  let Some(seconds) = seconds else {
    return Err(CAPTURE_USAGE.to_string());
  };
  if every.is_some_and(|interval| interval > seconds) {
    return Err("The --every value must not exceed --seconds".to_string());
  }

  Ok(CliCommand::CaptureJson {
    device,
    seconds,
    every,
    out,
  })
}

#[cfg(any(feature = "capture-harness", test))]
fn take_value(args: &[String], index: usize, flag: &str) -> Result<String, String> {
  match args.get(index + 1) {
    Some(value) if !value.starts_with("--") => Ok(value.clone()),
    _ => Err(format!("Missing value for {flag}")),
  }
}

#[cfg(any(feature = "capture-harness", test))]
fn parse_positive_duration(value: &str, flag: &str) -> Result<u64, String> {
  let parsed = value
    .parse::<u64>()
    .map_err(|_| format!("The {flag} value must be a positive integer"))?;
  if parsed == 0 {
    return Err(format!("The {flag} value must be greater than zero"));
  }
  Ok(parsed)
}

fn emit_json(json: &str, out: Option<&str>, command: &str) -> Result<(), String> {
  if let Some(path) = out {
    fs::write(path, format!("{json}\n"))
      .map_err(|err| format!("Failed to write {command} output: {err}"))?;
  }
  println!("{json}");
  Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SuccessEnvelope<T> {
  schema_version: u32,
  ok: bool,
  result: T,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEnvelope<'a> {
  schema_version: u32,
  ok: bool,
  error: ErrorBody<'a>,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
  code: &'a str,
  message: &'a str,
}

#[derive(Serialize)]
struct DoctorResult<'a> {
  report: &'a DoctorReport,
}

fn serialize_doctor_json(report: &DoctorReport) -> Result<String, serde_json::Error> {
  serde_json::to_string(&SuccessEnvelope {
    schema_version: CLI_SCHEMA_VERSION,
    ok: true,
    result: DoctorResult { report },
  })
}

fn doctor_exit_code(status: DoctorStatus) -> u8 {
  match status {
    DoctorStatus::Error => 1,
    DoctorStatus::Ok | DoctorStatus::Warning | DoctorStatus::Skipped => 0,
  }
}

fn serialize_parse_error(message: &str) -> (String, u8) {
  let code =
    if message.starts_with("Unknown command:") || message.starts_with("Unknown help topic:") {
      "unknownCommand"
    } else {
      "invalidInput"
    };
  let encoded = serde_json::to_string(&ErrorEnvelope {
    schema_version: CLI_SCHEMA_VERSION,
    ok: false,
    error: ErrorBody { code, message },
  })
  .expect("the CLI error envelope contains only strings and integers");
  (encoded, 3)
}

fn emit_text(text: &str, out: Option<&str>, command: &str) -> Result<(), String> {
  if let Some(path) = out {
    fs::write(path, text).map_err(|err| format!("Failed to write {command} output: {err}"))?;
  }
  print!("{text}");
  Ok(())
}

fn help_text(topic: HelpTopic) -> &'static str {
  match topic {
    HelpTopic::Root => {
      "PLVS CLI\n\nUsage:\n  plvs-cli doctor [--json] [--out <file>]\n  plvs-cli app <command> [options]\n\nAgent usage:\n  Add --json to doctor for stable machine-readable output.\n  Use --out to save the same output that is written to stdout.\n  Use app to inspect or control a running PLVS window; see plvs-cli app --help.\n\nHelp:\n  plvs-cli --help\n  plvs-cli help\n  plvs-cli <command> --help\n\nExit codes:\n  0  success\n  1  command completed with errors\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::Doctor => {
      "PLVS CLI - doctor\n\nUsage:\n  plvs-cli doctor [--json] [--out <file>]\n\nRuns installed-runtime health checks without launching the desktop UI.\nThe default output is human-readable. Add --json for the stable machine-readable report.\nWith --out, the same output is also written to a file.\n\nExit codes:\n  0  report status is ok or warning\n  1  report status is error\n  2  invalid usage or CLI failure before a valid report"
    }
    #[cfg(any(feature = "capture-harness", test))]
    HelpTopic::Analyze => {
      "PLVS internal capture harness - analyze\n\nUsage:\n  plvs --harness analyze <path> --json [--track <index>] [--dialogue] [--vad silero|firered|ten] [--reference-lufs <n>] [--target-lufs <n> --lufs-tolerance <n>] [--max-true-peak <n>] [--out <file>]\n\nRepository-owned ground-truth analysis for capture verification. This is not a public CLI command."
    }
    #[cfg(any(feature = "capture-harness", test))]
    HelpTopic::Capture => {
      "PLVS internal capture harness - capture\n\nUsage:\n  plvs --harness capture [--device <substring|stable-id>] --seconds <n> [--every <n>] --json [--out <file>]\n\nRepository-owned live capture for smoke and soak verification. This is not a public CLI command."
    }
    HelpTopic::App => cli_app::help_text(),
  }
}

pub fn run(args: &[String]) -> ExitCode {
  let command = match parse_args(args) {
    Ok(command) => command,
    Err(err) => {
      let (encoded, exit_code) = serialize_parse_error(&err);
      if args.iter().any(|arg| arg == "--json") {
        println!("{encoded}");
      } else {
        eprintln!("{err}");
      }
      return ExitCode::from(exit_code);
    }
  };
  execute(command)
}

#[cfg(feature = "capture-harness")]
pub(crate) fn run_harness(args: &[String]) -> ExitCode {
  let command = match parse_harness_args(args) {
    Ok(command) => command,
    Err(err) => {
      eprintln!("{err}");
      return ExitCode::from(2);
    }
  };
  execute(command)
}

fn execute(command: CliCommand) -> ExitCode {
  match command {
    CliCommand::Help(topic) => {
      println!("{}", help_text(topic));
      ExitCode::SUCCESS
    }
    CliCommand::Version => {
      println!("PLVS {}", env!("CARGO_PKG_VERSION"));
      ExitCode::SUCCESS
    }
    CliCommand::App(command) => cli_app::run(command),
    CliCommand::Doctor { json, out } => {
      let report = run_doctor();
      if json {
        match serialize_doctor_json(&report) {
          Ok(json) => {
            if let Err(err) = emit_json(&json, out.as_deref(), "doctor") {
              eprintln!("{err}");
              return ExitCode::from(2);
            }
          }
          Err(err) => {
            eprintln!("Failed to serialize doctor report: {err}");
            return ExitCode::from(2);
          }
        }
      } else {
        let text = render_doctor_text(&report);
        if let Err(err) = emit_text(&text, out.as_deref(), "doctor") {
          eprintln!("{err}");
          return ExitCode::from(2);
        }
      }

      ExitCode::from(doctor_exit_code(report.status))
    }
    #[cfg(any(feature = "capture-harness", test))]
    CliCommand::Analyze {
      path,
      json,
      options,
      out,
    } => {
      let report = run_analyze_with_options(&path, options);
      let status = report.status();
      let qc_failed = report.quality_control_failed();
      if json {
        match serde_json::to_string(&report) {
          Ok(json) => {
            if let Err(err) = emit_json(&json, out.as_deref(), "analyze") {
              eprintln!("{err}");
              return ExitCode::from(2);
            }
          }
          Err(err) => {
            eprintln!("Failed to serialize analyze report: {err}");
            return ExitCode::from(2);
          }
        }
      } else {
        let text = render_analyze_text(&report);
        if let Err(err) = emit_text(&text, out.as_deref(), "analyze") {
          eprintln!("{err}");
          return ExitCode::from(2);
        }
      }

      match status {
        CliAnalyzeStatus::Ok if !qc_failed => ExitCode::SUCCESS,
        CliAnalyzeStatus::Ok | CliAnalyzeStatus::Error => ExitCode::from(1),
      }
    }
    #[cfg(any(feature = "capture-harness", test))]
    CliCommand::CaptureJson {
      device,
      seconds,
      every,
      out,
    } => {
      // With --every, stdout is a JSONL stream and --out must capture all of it,
      // so the lines are echoed as they arrive and retained for the file write.
      let streaming = every.is_some();
      let mut lines: Vec<String> = Vec::new();
      let on_sample = |sample: CaptureSample| {
        if let Ok(line) = serde_json::to_string(&sample_line(&sample)) {
          println!("{line}");
          lines.push(line);
        }
      };
      let report = match run_capture(device.as_deref(), seconds, every, on_sample) {
        Ok(report) => report,
        Err(err) => {
          eprintln!("{err}");
          return ExitCode::from(2);
        }
      };

      let status = report.status();
      let json = match serde_json::to_string(&report) {
        Ok(json) => json,
        Err(err) => {
          eprintln!("Failed to serialize capture report: {err}");
          return ExitCode::from(2);
        }
      };

      if streaming {
        println!("{json}");
        lines.push(json);
        if let Some(path) = out.as_deref() {
          if let Err(err) = fs::write(path, format!("{}\n", lines.join("\n"))) {
            eprintln!("Failed to write capture output: {err}");
            return ExitCode::from(2);
          }
        }
      } else if let Err(err) = emit_json(&json, out.as_deref(), "capture") {
        eprintln!("{err}");
        return ExitCode::from(2);
      }

      match status {
        CliCaptureStatus::Ok => ExitCode::SUCCESS,
        CliCaptureStatus::Error => ExitCode::from(1),
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
  }

  #[test]
  fn parses_doctor_json() {
    assert_eq!(
      parse_args(&args(&["doctor", "--json"])),
      Ok(CliCommand::Doctor {
        json: true,
        out: None,
      })
    );
  }

  #[test]
  fn parses_doctor_out() {
    assert_eq!(
      parse_args(&args(&["doctor", "--json", "--out", "doctor.json"])),
      Ok(CliCommand::Doctor {
        json: true,
        out: Some("doctor.json".to_string())
      })
    );
  }

  #[test]
  fn parses_human_readable_doctor_without_json() {
    assert_eq!(
      parse_args(&args(&["doctor"])),
      Ok(CliCommand::Doctor {
        json: false,
        out: None,
      })
    );
  }

  #[test]
  fn internal_harness_accepts_only_analyze_and_capture() {
    assert!(matches!(
      parse_harness_args(&args(&["analyze", "mix.wav", "--json"])),
      Ok(CliCommand::Analyze { .. })
    ));
    assert!(matches!(
      parse_harness_args(&args(&["capture", "--seconds", "10", "--json"])),
      Ok(CliCommand::CaptureJson { .. })
    ));
    for command in ["doctor", "app", "probe", "devices", "profile", "report"] {
      assert!(parse_harness_args(&args(&[command])).is_err());
    }
  }

  fn doctor_report(status: DoctorStatus) -> crate::doctor::DoctorReport {
    crate::doctor::DoctorReport {
      status,
      summary: crate::doctor::DoctorSummary {
        ok: 1,
        warning: 0,
        error: 0,
        skipped: 0,
      },
      app: crate::doctor::DoctorAppInfo {
        name: "PLVS".to_string(),
        version: "0.14.6".to_string(),
        executable_path: None,
      },
      platform: crate::doctor::DoctorPlatformInfo {
        os: "windows".to_string(),
        arch: "x86_64".to_string(),
      },
      paths: crate::doctor::DoctorPaths {
        config_dir: None,
        data_dir: None,
      },
      checks: Vec::new(),
    }
  }

  #[test]
  fn wraps_doctor_json_in_the_v1_success_envelope() {
    let encoded = serialize_doctor_json(&doctor_report(DoctorStatus::Warning)).unwrap();
    let json: serde_json::Value = serde_json::from_str(&encoded).unwrap();

    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["ok"], true);
    assert_eq!(json["result"]["report"]["status"], "warning");
    assert!(json["result"]["report"].get("schemaVersion").is_none());
    assert!(json.get("error").is_none());
  }

  #[test]
  fn doctor_errors_keep_a_success_envelope_but_exit_one() {
    assert_eq!(doctor_exit_code(DoctorStatus::Error), 1);
    assert_eq!(doctor_exit_code(DoctorStatus::Warning), 0);
  }

  #[test]
  fn rejects_unknown_command() {
    assert!(parse_args(&args(&["render", "mix.wav", "--json"])).is_err());
  }

  #[test]
  fn parses_root_help() {
    assert_eq!(
      parse_args(&args(&["--help"])),
      Ok(CliCommand::Help(HelpTopic::Root))
    );
    assert_eq!(
      parse_args(&args(&["help"])),
      Ok(CliCommand::Help(HelpTopic::Root))
    );
  }

  #[test]
  fn gates_the_app_command_family_on_explicit_availability() {
    assert_eq!(
      parse_args_with_app(&args(&["app", "inspect", "--json"]), true),
      Ok(CliCommand::App(CliAppCommand::Inspect))
    );
    assert_eq!(
      parse_args_with_app(&args(&["app", "--help"]), true),
      Ok(CliCommand::App(CliAppCommand::Help))
    );
    assert_eq!(
      parse_args_with_app(&args(&["help", "app"]), true),
      Ok(CliCommand::Help(HelpTopic::App))
    );
    assert_eq!(
      parse_args_with_app(&args(&["app", "inspect", "--json"]), false),
      Err("Unknown command: app".to_string())
    );
    assert_eq!(
      parse_args_with_app(&args(&["help", "app"]), false),
      Err("Unknown help topic: app".to_string())
    );
  }

  #[test]
  fn exposes_the_app_command_family_in_every_build() {
    assert!(parse_args(&args(&["app", "inspect", "--json"])).is_ok());
    assert_eq!(
      parse_args(&args(&["help", "app"])),
      Ok(CliCommand::Help(HelpTopic::App))
    );
  }

  #[test]
  fn root_help_points_at_the_app_family() {
    assert!(help_text(HelpTopic::Root).contains("plvs-cli app"));
  }

  #[test]
  fn root_help_exposes_only_doctor_and_app() {
    let text = help_text(HelpTopic::Root);
    for command in ["plvs-cli doctor", "plvs-cli app"] {
      assert!(text.contains(command), "missing public command: {command}");
    }
    for command in [
      "plvs-cli probe",
      "plvs-cli analyze",
      "plvs-cli analyze-batch",
      "plvs-cli capture",
      "plvs-cli devices",
      "plvs-cli profile",
      "plvs-cli report",
    ] {
      assert!(
        !text.contains(command),
        "advertised removed command: {command}"
      );
    }
  }

  #[test]
  fn removed_top_level_commands_and_help_topics_are_unreachable() {
    for invocation in [
      vec!["probe", "mix.wav", "--json"],
      vec!["analyze", "mix.wav", "--json"],
      vec!["analyze-batch", "a.wav", "b.wav", "--json"],
      vec!["capture", "--seconds", "10", "--json"],
      vec!["devices", "--json"],
      vec!["profile", "export"],
      vec!["report", "analysis.json", "--format", "markdown"],
    ] {
      let command = invocation[0];
      assert!(
        parse_args(&args(&invocation)).is_err(),
        "parsed removed command: {command}"
      );
      assert!(
        parse_args(&args(&["help", command])).is_err(),
        "parsed removed help topic: {command}"
      );
    }
  }

  #[test]
  fn removed_json_commands_map_to_unknown_command_exit_three() {
    let error = parse_args(&args(&["capture", "--seconds", "10", "--json"])).unwrap_err();
    let (encoded, exit_code) = serialize_parse_error(&error);
    let json: serde_json::Value = serde_json::from_str(&encoded).unwrap();

    assert_eq!(exit_code, 3);
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["ok"], false);
    assert_eq!(json["error"]["code"], "unknownCommand");
    assert!(json.get("result").is_none());
  }

  #[test]
  fn parses_version() {
    assert_eq!(parse_args(&args(&["--version"])), Ok(CliCommand::Version));
  }

  #[test]
  fn parses_command_help() {
    assert_eq!(
      parse_args(&args(&["doctor", "--help"])),
      Ok(CliCommand::Help(HelpTopic::Doctor))
    );
  }
}
