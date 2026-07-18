//! CLI command implementation, hosted inside the main `plvs` binary behind the
//! internal `--cli` flag. The shipped `plvs-cli` executable is a thin forwarder
//! (see `bin/plvs-cli.rs`) so the engine (ONNX runtime, VAD models, DSP) is
//! linked into the installer only once.

use std::fs;
use std::process::ExitCode;

use crate::audio::capture_summary::CaptureSample;
use crate::cli_analyze::{
  run_analyze_with_options, CliAnalyzeOptions, CliAnalyzeStatus, CliQualityControlOptions,
};
use crate::cli_analyze_batch::{
  read_manifest, run_analyze_batch, CliAnalyzeBatchStatus, DEFAULT_BATCH_CONCURRENCY,
  MAX_BATCH_CONCURRENCY,
};
use crate::cli_capture::{run_capture, sample_line, CliCaptureStatus};
use crate::cli_probe::{run_probe, CliProbeStatus};
use crate::cli_report::{render_analyze_text, render_doctor_text, render_markdown_report};
use crate::doctor::{run_doctor, DoctorStatus};

#[derive(Debug, Clone, PartialEq)]
enum CliCommand {
  Help(HelpTopic),
  Version,
  Doctor {
    json: bool,
    out: Option<String>,
  },
  ProbeJson {
    path: String,
    out: Option<String>,
  },
  Analyze {
    path: String,
    json: bool,
    options: CliAnalyzeOptions,
    out: Option<String>,
  },
  AnalyzeBatchJson {
    paths: Vec<String>,
    manifest: Option<String>,
    concurrency: usize,
    out: Option<String>,
  },
  CaptureJson {
    device: Option<String>,
    seconds: u64,
    every: Option<u64>,
    out: Option<String>,
  },
  ReportMarkdown {
    input: String,
    out: Option<String>,
  },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HelpTopic {
  Root,
  Doctor,
  Probe,
  Analyze,
  AnalyzeBatch,
  Capture,
  Report,
}

fn parse_args(args: &[String]) -> Result<CliCommand, String> {
  match args {
    [flag] if flag == "--help" || flag == "-h" || flag == "help" => {
      Ok(CliCommand::Help(HelpTopic::Root))
    }
    [command, rest @ ..] if command == "doctor" => parse_doctor_args(rest),
    [command, rest @ ..] if command == "probe" => parse_probe_args(rest),
    [command, rest @ ..] if command == "analyze" => parse_analyze_args(rest),
    [command, rest @ ..] if command == "analyze-batch" => parse_analyze_batch_args(rest),
    [command, rest @ ..] if command == "capture" => parse_capture_args(rest),
    [command, rest @ ..] if command == "report" => parse_report_args(rest),
    [command, topic] if command == "help" => parse_help_topic(topic),
    [command, ..] if command == "help" => {
      Err("Usage: plvs-cli help [doctor|probe|analyze|analyze-batch|capture|report]".to_string())
    }
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

fn parse_probe_args(args: &[String]) -> Result<CliCommand, String> {
  if args.iter().any(|arg| is_help_flag(arg)) {
    return Ok(CliCommand::Help(HelpTopic::Probe));
  }
  let options = parse_json_output_options(args)?;
  if !options.has_json {
    return Err("The probe command currently requires --json.".to_string());
  }
  match options.positionals.as_slice() {
    [path] if !path.starts_with("--") => Ok(CliCommand::ProbeJson {
      path: path.clone(),
      out: options.out,
    }),
    _ => Err("Usage: plvs-cli probe <path> --json [--out <file>]".to_string()),
  }
}

fn parse_analyze_args(args: &[String]) -> Result<CliCommand, String> {
  if args.iter().any(|arg| is_help_flag(arg)) {
    return Ok(CliCommand::Help(HelpTopic::Analyze));
  }

  let mut path = None;
  let mut json = false;
  let mut out = None;
  let mut track_index = None;
  let mut target_lufs = None;
  let mut lufs_tolerance = None;
  let mut max_true_peak_dbtp = None;
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
      "--track" => {
        let value = take_value(args, index, "--track")?;
        track_index = Some(
          value
            .parse::<u32>()
            .map_err(|_| "The --track value must be a non-negative integer".to_string())?,
        );
        index += 2;
      }
      "--target-lufs" => {
        target_lufs = Some(parse_finite_number(
          &take_value(args, index, "--target-lufs")?,
          "--target-lufs",
        )?);
        index += 2;
      }
      "--lufs-tolerance" => {
        let value = parse_finite_number(
          &take_value(args, index, "--lufs-tolerance")?,
          "--lufs-tolerance",
        )?;
        if value < 0.0 {
          return Err("The --lufs-tolerance value must not be negative".to_string());
        }
        lufs_tolerance = Some(value);
        index += 2;
      }
      "--max-true-peak" => {
        max_true_peak_dbtp = Some(parse_finite_number(
          &take_value(args, index, "--max-true-peak")?,
          "--max-true-peak",
        )?);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value if path.is_none() => {
        path = Some(value.to_string());
        index += 1;
      }
      value => return Err(format!("Unexpected argument: {value}")),
    }
  }
  if target_lufs.is_some() != lufs_tolerance.is_some() {
    return Err("--target-lufs and --lufs-tolerance must be provided together".to_string());
  }
  let path = path.ok_or_else(|| {
    "Usage: plvs-cli analyze <path> [--json] [--track <index>] [QC options] [--out <file>]"
      .to_string()
  })?;
  Ok(CliCommand::Analyze {
    path,
    json,
    options: CliAnalyzeOptions {
      track_index,
      quality_control: CliQualityControlOptions {
        target_lufs,
        lufs_tolerance,
        max_true_peak_dbtp,
      },
    },
    out,
  })
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

fn parse_finite_number(value: &str, flag: &str) -> Result<f64, String> {
  let parsed = value
    .parse::<f64>()
    .map_err(|_| format!("The {flag} value must be a finite number"))?;
  if !parsed.is_finite() {
    return Err(format!("The {flag} value must be a finite number"));
  }
  Ok(parsed)
}

fn parse_help_topic(topic: &str) -> Result<CliCommand, String> {
  match topic {
    "doctor" => Ok(CliCommand::Help(HelpTopic::Doctor)),
    "probe" => Ok(CliCommand::Help(HelpTopic::Probe)),
    "analyze" => Ok(CliCommand::Help(HelpTopic::Analyze)),
    "analyze-batch" => Ok(CliCommand::Help(HelpTopic::AnalyzeBatch)),
    "capture" => Ok(CliCommand::Help(HelpTopic::Capture)),
    "report" => Ok(CliCommand::Help(HelpTopic::Report)),
    _ => Err(format!("Unknown help topic: {topic}")),
  }
}

fn parse_analyze_batch_args(args: &[String]) -> Result<CliCommand, String> {
  if args.iter().any(|arg| is_help_flag(arg)) {
    return Ok(CliCommand::Help(HelpTopic::AnalyzeBatch));
  }

  let mut paths = Vec::new();
  let mut manifest = None;
  let mut has_json = false;
  let mut out = None;
  let mut concurrency = DEFAULT_BATCH_CONCURRENCY;
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
      "--manifest" => {
        let Some(path) = args.get(index + 1) else {
          return Err("Missing value for --manifest".to_string());
        };
        if path.starts_with("--") {
          return Err("Missing value for --manifest".to_string());
        }
        manifest = Some(path.clone());
        index += 2;
      }
      "--concurrency" => {
        let Some(value) = args.get(index + 1) else {
          return Err("Missing value for --concurrency".to_string());
        };
        concurrency = value
          .parse::<usize>()
          .map_err(|_| "The --concurrency value must be a positive integer".to_string())?;
        if concurrency == 0 || concurrency > MAX_BATCH_CONCURRENCY {
          return Err(format!(
            "The --concurrency value must be between 1 and {MAX_BATCH_CONCURRENCY}"
          ));
        }
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => {
        paths.push(value.to_string());
        index += 1;
      }
    }
  }

  if !has_json {
    return Err("The analyze-batch command currently requires --json.".to_string());
  }
  if manifest.is_some() && !paths.is_empty() {
    return Err("Do not mix positional paths with --manifest.".to_string());
  }
  if manifest.is_none() && paths.is_empty() {
    return Err("Usage: plvs-cli analyze-batch <paths...> --json [--out <file>]".to_string());
  }

  Ok(CliCommand::AnalyzeBatchJson {
    paths,
    manifest,
    concurrency,
    out,
  })
}

const CAPTURE_USAGE: &str =
  "Usage: plvs-cli capture [--device <substring>] --seconds <n> [--every <n>] --json [--out <file>]";

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

fn take_value(args: &[String], index: usize, flag: &str) -> Result<String, String> {
  match args.get(index + 1) {
    Some(value) if !value.starts_with("--") => Ok(value.clone()),
    _ => Err(format!("Missing value for {flag}")),
  }
}

fn parse_positive_duration(value: &str, flag: &str) -> Result<u64, String> {
  let parsed = value
    .parse::<u64>()
    .map_err(|_| format!("The {flag} value must be a positive integer"))?;
  if parsed == 0 {
    return Err(format!("The {flag} value must be greater than zero"));
  }
  Ok(parsed)
}

fn parse_report_args(args: &[String]) -> Result<CliCommand, String> {
  if args.iter().any(|arg| is_help_flag(arg)) {
    return Ok(CliCommand::Help(HelpTopic::Report));
  }

  let mut format = None;
  let mut out = None;
  let mut positionals = Vec::new();
  let mut index = 0;

  while index < args.len() {
    match args[index].as_str() {
      "--format" => {
        let Some(value) = args.get(index + 1) else {
          return Err("Missing value for --format".to_string());
        };
        if value.starts_with("--") {
          return Err("Missing value for --format".to_string());
        }
        format = Some(value.clone());
        index += 2;
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

  if format.as_deref() != Some("markdown") {
    return Err(
      "Usage: plvs-cli report <analysis.json> --format markdown [--out <file>]".to_string(),
    );
  }
  match positionals.as_slice() {
    [input] => Ok(CliCommand::ReportMarkdown {
      input: input.clone(),
      out,
    }),
    _ => Err("Usage: plvs-cli report <analysis.json> --format markdown [--out <file>]".to_string()),
  }
}

fn emit_json(json: &str, out: Option<&str>, command: &str) -> Result<(), String> {
  if let Some(path) = out {
    fs::write(path, format!("{json}\n"))
      .map_err(|err| format!("Failed to write {command} output: {err}"))?;
  }
  println!("{json}");
  Ok(())
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
      "PLVS CLI\n\nUsage:\n  plvs-cli doctor [--json] [--out <file>]\n  plvs-cli probe <path> --json [--out <file>]\n  plvs-cli analyze <path> [--json] [--track <index>] [--target-lufs <n> --lufs-tolerance <n>] [--max-true-peak <n>] [--out <file>]\n  plvs-cli analyze-batch <paths...> --json [--concurrency <n>] [--out <file>]\n  plvs-cli analyze-batch --manifest <file.json> --json [--concurrency <n>] [--out <file>]\n  plvs-cli capture [--device <substring>] --seconds <n> [--every <n>] --json [--out <file>]\n  plvs-cli report <analysis.json> --format markdown [--out <file>]\n\nAgent usage:\n  Add --json to doctor and analyze for stable machine-readable output.\n  Use probe before analyze to discover absolute audio track indices.\n  Use analyze for exactly one file.\n  Use analyze-batch for two or more files.\n  Use capture to measure live audio from a capture device instead of a file.\n  Use report --format markdown when the user asks for a human-readable report, summary, table, or Markdown output.\n  Use --manifest when paths are numerous, generated programmatically, or need reproducibility.\n  Use --out to save the same output that is written to stdout.\n\nHelp:\n  plvs-cli --help\n  plvs-cli help\n  plvs-cli <command> --help\n\nExit codes:\n  0  success\n  1  command completed with errors or a requested QC check failed\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::Doctor => {
      "PLVS CLI - doctor\n\nUsage:\n  plvs-cli doctor [--json] [--out <file>]\n\nRuns installed-runtime health checks without launching the desktop UI.\nThe default output is human-readable. Add --json for the stable machine-readable report.\nWith --out, the same output is also written to a file.\n\nExit codes:\n  0  report status is ok or warning\n  1  report status is error\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::Probe => {
      "PLVS CLI - probe\n\nUsage:\n  plvs-cli probe <path> --json [--out <file>]\n\nReads media metadata without decoding the full file. The audioTracks array contains\nabsolute ffprobe stream indices accepted by analyze --track.\n\nExit codes:\n  0  media metadata was read successfully\n  1  probing completed with an error report\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::Analyze => {
      "PLVS CLI - analyze\n\nUsage:\n  plvs-cli analyze <path> [--json] [--track <index>] [--target-lufs <n> --lufs-tolerance <n>] [--max-true-peak <n>] [--out <file>]\n\nAnalyzes exactly one local media file without launching the desktop UI.\nThe default output is human-readable. Add --json for the stable machine-readable report.\n--track selects an absolute stream index reported by probe.\nQC is opt-in and user-defined: loudness target and tolerance must be supplied together;\n--max-true-peak is an independent dBTP ceiling. Without these options no pass/fail is produced.\nFor multiple files, use analyze-batch.\n\nExit codes:\n  0  file analyzed successfully and requested QC checks passed\n  1  analysis error or requested QC check failed/unavailable\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::AnalyzeBatch => {
      "PLVS CLI - analyze-batch\n\nUsage:\n  plvs-cli analyze-batch <paths...> --json [--concurrency <n>] [--out <file>]\n  plvs-cli analyze-batch --manifest <file.json> --json [--concurrency <n>] [--out <file>]\n\nManifest format:\n  {\"files\":[\"C:\\\\media\\\\a.wav\",\"C:\\\\media\\\\b.wav\"]}\n\nRules:\n  Do not mix positional paths with --manifest.\n  Results preserve input order.\n  JSON is written to stdout. With --out, the same JSON is also written to a file.\n  --concurrency defaults to 2 and may be 1 through 8.\n\nExit codes:\n  0  all files analyzed successfully\n  1  at least one file produced an error report\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::Capture => {
      "PLVS CLI - capture\n\nUsage:\n  plvs-cli capture [--device <substring>] --seconds <n> [--every <n>] --json [--out <file>]\n\nCaptures live audio from a device without launching the desktop UI and reports\ndelivery metrics. JSON is written to stdout. With --out, the same output is also\nwritten to a file.\n\n--device matches a case-insensitive substring of the device label; it must match\nexactly one device. Omit it to use the default device. With no match, the error\nlists the available devices.\n\n--every <n> emits one JSON line every n seconds (JSONL) instead of a single\nreport; the final line is the same report the non-streaming mode prints.\n\nExit codes:\n  0  capture completed successfully\n  1  capture completed with an error report\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::Report => {
      "PLVS CLI - report\n\nUsage:\n  plvs-cli report <analysis.json> --format markdown [--out <file>]\n\nReads JSON produced by analyze, analyze-batch, or capture and renders a human-readable Markdown table.\nMarkdown is written to stdout. With --out, the same Markdown is also written to a file.\n\nExit codes:\n  0  report rendered successfully\n  2  invalid usage, unreadable input, unsupported JSON, or output write failure"
    }
  }
}

pub fn run(args: &[String]) -> ExitCode {
  let command = match parse_args(args) {
    Ok(command) => command,
    Err(err) => {
      eprintln!("{err}");
      return ExitCode::from(2);
    }
  };

  match command {
    CliCommand::Help(topic) => {
      println!("{}", help_text(topic));
      ExitCode::SUCCESS
    }
    CliCommand::Version => {
      println!("PLVS {}", env!("CARGO_PKG_VERSION"));
      ExitCode::SUCCESS
    }
    CliCommand::Doctor { json, out } => {
      let report = run_doctor();
      if json {
        match serde_json::to_string(&report) {
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

      match report.status {
        DoctorStatus::Error => ExitCode::from(1),
        DoctorStatus::Ok | DoctorStatus::Warning | DoctorStatus::Skipped => ExitCode::SUCCESS,
      }
    }
    CliCommand::ProbeJson { path, out } => {
      let report = run_probe(&path);
      let status = report.status();
      match serde_json::to_string(&report) {
        Ok(json) => {
          if let Err(err) = emit_json(&json, out.as_deref(), "probe") {
            eprintln!("{err}");
            return ExitCode::from(2);
          }
        }
        Err(err) => {
          eprintln!("Failed to serialize probe report: {err}");
          return ExitCode::from(2);
        }
      }
      match status {
        CliProbeStatus::Ok => ExitCode::SUCCESS,
        CliProbeStatus::Error => ExitCode::from(1),
      }
    }
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
    CliCommand::AnalyzeBatchJson {
      paths,
      manifest,
      concurrency,
      out,
    } => {
      let paths = match manifest {
        Some(path) => match read_manifest(std::path::Path::new(&path)) {
          Ok(paths) if !paths.is_empty() => paths,
          Ok(_) => {
            eprintln!("The analyze-batch manifest must include at least one file.");
            return ExitCode::from(2);
          }
          Err(err) => {
            eprintln!("{err}");
            return ExitCode::from(2);
          }
        },
        None => paths,
      };
      let report = run_analyze_batch(paths, concurrency);
      let status = report.status;
      match serde_json::to_string(&report) {
        Ok(json) => {
          if let Err(err) = emit_json(&json, out.as_deref(), "analyze-batch") {
            eprintln!("{err}");
            return ExitCode::from(2);
          }
        }
        Err(err) => {
          eprintln!("Failed to serialize analyze-batch report: {err}");
          return ExitCode::from(2);
        }
      }

      match status {
        CliAnalyzeBatchStatus::Ok => ExitCode::SUCCESS,
        CliAnalyzeBatchStatus::Warning | CliAnalyzeBatchStatus::Error => ExitCode::from(1),
      }
    }
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
    CliCommand::ReportMarkdown { input, out } => {
      let contents = match fs::read_to_string(&input) {
        Ok(contents) => contents,
        Err(err) => {
          eprintln!("Failed to read report input: {err}");
          return ExitCode::from(2);
        }
      };
      let markdown = match render_markdown_report(&contents) {
        Ok(markdown) => markdown,
        Err(err) => {
          eprintln!("{err}");
          return ExitCode::from(2);
        }
      };
      if let Err(err) = emit_text(&markdown, out.as_deref(), "report") {
        eprintln!("{err}");
        return ExitCode::from(2);
      }
      ExitCode::SUCCESS
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
  fn parses_version() {
    assert_eq!(parse_args(&args(&["--version"])), Ok(CliCommand::Version));
  }

  #[test]
  fn parses_command_help() {
    assert_eq!(
      parse_args(&args(&["doctor", "--help"])),
      Ok(CliCommand::Help(HelpTopic::Doctor))
    );
    assert_eq!(
      parse_args(&args(&["analyze", "--help"])),
      Ok(CliCommand::Help(HelpTopic::Analyze))
    );
    assert_eq!(
      parse_args(&args(&["analyze-batch", "--help"])),
      Ok(CliCommand::Help(HelpTopic::AnalyzeBatch))
    );
    assert_eq!(
      parse_args(&args(&["capture", "--help"])),
      Ok(CliCommand::Help(HelpTopic::Capture))
    );
    assert_eq!(
      parse_args(&args(&["report", "--help"])),
      Ok(CliCommand::Help(HelpTopic::Report))
    );
    assert_eq!(
      parse_args(&args(&["help", "capture"])),
      Ok(CliCommand::Help(HelpTopic::Capture))
    );
  }

  #[test]
  fn parses_analyze_json() {
    assert_eq!(
      parse_args(&args(&["analyze", "mix.wav", "--json"])),
      Ok(CliCommand::Analyze {
        path: "mix.wav".to_string(),
        json: true,
        options: CliAnalyzeOptions::default(),
        out: None
      })
    );
  }

  #[test]
  fn parses_analyze_out() {
    assert_eq!(
      parse_args(&args(&[
        "analyze", "mix.wav", "--json", "--out", "mix.json",
      ])),
      Ok(CliCommand::Analyze {
        path: "mix.wav".to_string(),
        json: true,
        options: CliAnalyzeOptions::default(),
        out: Some("mix.json".to_string())
      })
    );
  }

  #[test]
  fn parses_human_readable_analyze_without_json() {
    assert_eq!(
      parse_args(&args(&["analyze", "mix.wav"])),
      Ok(CliCommand::Analyze {
        path: "mix.wav".to_string(),
        json: false,
        options: CliAnalyzeOptions::default(),
        out: None,
      })
    );
  }

  #[test]
  fn rejects_analyze_with_flag_like_path() {
    assert!(parse_args(&args(&["analyze", "--bogus", "--json"])).is_err());
  }

  #[test]
  fn rejects_analyze_with_extra_args() {
    assert!(parse_args(&args(&["analyze", "mix.wav", "--json", "--extra"])).is_err());
  }

  #[test]
  fn parses_probe_json() {
    assert_eq!(
      parse_args(&args(&["probe", "movie.mkv", "--json"])),
      Ok(CliCommand::ProbeJson {
        path: "movie.mkv".to_string(),
        out: None,
      })
    );
  }

  #[test]
  fn parses_analyze_track_and_custom_quality_control() {
    assert_eq!(
      parse_args(&args(&[
        "analyze",
        "movie.mkv",
        "--track",
        "3",
        "--target-lufs",
        "-14",
        "--lufs-tolerance",
        "1",
        "--max-true-peak",
        "-1",
        "--json",
      ])),
      Ok(CliCommand::Analyze {
        path: "movie.mkv".to_string(),
        json: true,
        options: CliAnalyzeOptions {
          track_index: Some(3),
          quality_control: CliQualityControlOptions {
            target_lufs: Some(-14.0),
            lufs_tolerance: Some(1.0),
            max_true_peak_dbtp: Some(-1.0),
          },
        },
        out: None,
      })
    );
  }

  #[test]
  fn rejects_incomplete_or_invalid_quality_control() {
    assert!(parse_args(&args(&["analyze", "mix.wav", "--target-lufs", "-14",])).is_err());
    assert!(parse_args(&args(&[
      "analyze",
      "mix.wav",
      "--target-lufs",
      "-14",
      "--lufs-tolerance",
      "-1",
    ]))
    .is_err());
  }

  #[test]
  fn parses_analyze_batch_paths() {
    assert_eq!(
      parse_args(&args(&[
        "analyze-batch",
        "a.wav",
        "b.wav",
        "--json",
        "--concurrency",
        "4",
      ])),
      Ok(CliCommand::AnalyzeBatchJson {
        paths: vec!["a.wav".to_string(), "b.wav".to_string()],
        manifest: None,
        concurrency: 4,
        out: None,
      })
    );
  }

  #[test]
  fn parses_analyze_batch_out() {
    assert_eq!(
      parse_args(&args(&[
        "analyze-batch",
        "a.wav",
        "b.wav",
        "--json",
        "--out",
        "batch.json",
      ])),
      Ok(CliCommand::AnalyzeBatchJson {
        paths: vec!["a.wav".to_string(), "b.wav".to_string()],
        manifest: None,
        concurrency: DEFAULT_BATCH_CONCURRENCY,
        out: Some("batch.json".to_string()),
      })
    );
  }

  #[test]
  fn parses_analyze_batch_manifest() {
    assert_eq!(
      parse_args(&args(&[
        "analyze-batch",
        "--manifest",
        "files.json",
        "--json",
      ])),
      Ok(CliCommand::AnalyzeBatchJson {
        paths: vec![],
        manifest: Some("files.json".to_string()),
        concurrency: DEFAULT_BATCH_CONCURRENCY,
        out: None,
      })
    );
  }

  #[test]
  fn rejects_analyze_batch_without_json() {
    assert!(parse_args(&args(&["analyze-batch", "a.wav"])).is_err());
  }

  #[test]
  fn rejects_analyze_batch_mixed_inputs() {
    assert!(parse_args(&args(&[
      "analyze-batch",
      "a.wav",
      "--manifest",
      "files.json",
      "--json",
    ]))
    .is_err());
  }

  #[test]
  fn rejects_analyze_batch_bad_concurrency() {
    assert!(parse_args(&args(&[
      "analyze-batch",
      "a.wav",
      "--json",
      "--concurrency",
      "0",
    ]))
    .is_err());
    assert!(parse_args(&args(&[
      "analyze-batch",
      "a.wav",
      "--json",
      "--concurrency",
      "nope",
    ]))
    .is_err());
  }

  #[test]
  fn parses_capture_with_device_and_seconds() {
    assert_eq!(
      parse_args(&args(&[
        "capture",
        "--device",
        "CABLE Output",
        "--seconds",
        "10",
        "--json",
      ])),
      Ok(CliCommand::CaptureJson {
        device: Some("CABLE Output".to_string()),
        seconds: 10,
        every: None,
        out: None,
      })
    );
  }

  #[test]
  fn parses_capture_with_every_and_out() {
    assert_eq!(
      parse_args(&args(&[
        "capture",
        "--seconds",
        "14400",
        "--every",
        "10",
        "--json",
        "--out",
        "soak.jsonl",
      ])),
      Ok(CliCommand::CaptureJson {
        device: None,
        seconds: 14400,
        every: Some(10),
        out: Some("soak.jsonl".to_string()),
      })
    );
  }

  #[test]
  fn capture_requires_json_and_seconds() {
    assert!(parse_args(&args(&["capture", "--seconds", "10"])).is_err());
    assert!(parse_args(&args(&["capture", "--json"])).is_err());
  }

  #[test]
  fn capture_rejects_zero_and_unparsable_durations() {
    assert!(parse_args(&args(&["capture", "--seconds", "0", "--json"])).is_err());
    assert!(parse_args(&args(&["capture", "--seconds", "ten", "--json"])).is_err());
    assert!(parse_args(&args(&[
      "capture",
      "--seconds",
      "10",
      "--every",
      "0",
      "--json",
    ]))
    .is_err());
  }

  #[test]
  fn parses_report_markdown() {
    assert_eq!(
      parse_args(&args(&[
        "report",
        "results.json",
        "--format",
        "markdown",
        "--out",
        "report.md",
      ])),
      Ok(CliCommand::ReportMarkdown {
        input: "results.json".to_string(),
        out: Some("report.md".to_string()),
      })
    );
  }

  #[test]
  fn rejects_report_without_markdown_format() {
    assert!(parse_args(&args(&["report", "results.json"])).is_err());
    assert!(parse_args(&args(&["report", "results.json", "--format", "json"])).is_err());
  }
}
