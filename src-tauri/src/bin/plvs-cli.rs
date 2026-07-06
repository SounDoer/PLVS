use std::process::ExitCode;

use app_lib::cli_analyze::{run_analyze, CliAnalyzeStatus};
use app_lib::cli_analyze_batch::{
  read_manifest, run_analyze_batch, CliAnalyzeBatchStatus, DEFAULT_BATCH_CONCURRENCY,
  MAX_BATCH_CONCURRENCY,
};
use app_lib::doctor::{run_doctor, DoctorStatus};

#[derive(Debug, Clone, PartialEq, Eq)]
enum CliCommand {
  Help(HelpTopic),
  Version,
  DoctorJson,
  AnalyzeJson {
    path: String,
  },
  AnalyzeBatchJson {
    paths: Vec<String>,
    manifest: Option<String>,
    concurrency: usize,
  },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HelpTopic {
  Root,
  Doctor,
  Analyze,
  AnalyzeBatch,
}

fn parse_args(args: &[String]) -> Result<CliCommand, String> {
  match args {
    [flag] if flag == "--help" || flag == "-h" || flag == "help" => Ok(CliCommand::Help(HelpTopic::Root)),
    [command, flag] if command == "doctor" && flag == "--json" => Ok(CliCommand::DoctorJson),
    [command, flag] if command == "doctor" && is_help_flag(flag) => Ok(CliCommand::Help(HelpTopic::Doctor)),
    [command, ..] if command == "doctor" => {
      Err("The doctor command currently requires --json.".to_string())
    }
    [command, path, flag]
      if command == "analyze" && flag == "--json" && !path.starts_with("--") =>
    {
      Ok(CliCommand::AnalyzeJson { path: path.clone() })
    }
    [command, flag] if command == "analyze" && is_help_flag(flag) => {
      Ok(CliCommand::Help(HelpTopic::Analyze))
    }
    [command, ..] if command == "analyze" => {
      Err(
        "Usage: plvs-cli analyze <path> --json\nFor multiple files, use: plvs-cli analyze-batch <paths...> --json"
          .to_string(),
      )
    }
    [command, rest @ ..] if command == "analyze-batch" => parse_analyze_batch_args(rest),
    [command, topic] if command == "help" => parse_help_topic(topic),
    [command, ..] if command == "help" => Err("Usage: plvs-cli help [doctor|analyze|analyze-batch]".to_string()),
    [command, ..] if is_help_flag(command) => Ok(CliCommand::Help(HelpTopic::Root)),
    [command] if command == "--version" || command == "-V" => Ok(CliCommand::Version),
    [command, ..] => Err(format!("Unknown command: {command}")),
    [] => Err("Missing command. Try: plvs-cli --help".to_string()),
  }
}

fn is_help_flag(value: &str) -> bool {
  value == "--help" || value == "-h"
}

fn parse_help_topic(topic: &str) -> Result<CliCommand, String> {
  match topic {
    "doctor" => Ok(CliCommand::Help(HelpTopic::Doctor)),
    "analyze" => Ok(CliCommand::Help(HelpTopic::Analyze)),
    "analyze-batch" => Ok(CliCommand::Help(HelpTopic::AnalyzeBatch)),
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
  let mut concurrency = DEFAULT_BATCH_CONCURRENCY;
  let mut index = 0;

  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        has_json = true;
        index += 1;
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
    return Err("Usage: plvs-cli analyze-batch <paths...> --json".to_string());
  }

  Ok(CliCommand::AnalyzeBatchJson {
    paths,
    manifest,
    concurrency,
  })
}

fn help_text(topic: HelpTopic) -> &'static str {
  match topic {
    HelpTopic::Root => {
      "PLVS CLI\n\nUsage:\n  plvs-cli doctor --json\n  plvs-cli analyze <path> --json\n  plvs-cli analyze-batch <paths...> --json [--concurrency <n>]\n  plvs-cli analyze-batch --manifest <file.json> --json [--concurrency <n>]\n\nAgent usage:\n  Use analyze for exactly one file.\n  Use analyze-batch for two or more files.\n  Use --manifest when paths are numerous, generated programmatically, or need reproducibility.\n\nHelp:\n  plvs-cli --help\n  plvs-cli help\n  plvs-cli <command> --help\n\nExit codes:\n  0  success\n  1  command completed with analysis/report errors\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::Doctor => {
      "PLVS CLI - doctor\n\nUsage:\n  plvs-cli doctor --json\n\nRuns installed-runtime health checks without launching the desktop UI.\nJSON is written to stdout.\n\nExit codes:\n  0  report status is ok or warning\n  1  report status is error\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::Analyze => {
      "PLVS CLI - analyze\n\nUsage:\n  plvs-cli analyze <path> --json\n\nAnalyzes exactly one local media file without launching the desktop UI.\nJSON is written to stdout.\nFor multiple files, use analyze-batch.\n\nExit codes:\n  0  file analyzed successfully\n  1  analysis completed with an error report\n  2  invalid usage or CLI failure before a valid report"
    }
    HelpTopic::AnalyzeBatch => {
      "PLVS CLI - analyze-batch\n\nUsage:\n  plvs-cli analyze-batch <paths...> --json [--concurrency <n>]\n  plvs-cli analyze-batch --manifest <file.json> --json [--concurrency <n>]\n\nManifest format:\n  {\"files\":[\"C:\\\\media\\\\a.wav\",\"C:\\\\media\\\\b.wav\"]}\n\nRules:\n  Do not mix positional paths with --manifest.\n  Results preserve input order.\n  JSON is written to stdout.\n  --concurrency defaults to 2 and may be 1 through 8.\n\nExit codes:\n  0  all files analyzed successfully\n  1  at least one file produced an error report\n  2  invalid usage or CLI failure before a valid report"
    }
  }
}

fn main() -> ExitCode {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let command = match parse_args(&args) {
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
    CliCommand::DoctorJson => {
      let report = run_doctor();
      match serde_json::to_string(&report) {
        Ok(json) => println!("{json}"),
        Err(err) => {
          eprintln!("Failed to serialize doctor report: {err}");
          return ExitCode::from(2);
        }
      }

      match report.status {
        DoctorStatus::Error => ExitCode::from(1),
        DoctorStatus::Ok | DoctorStatus::Warning | DoctorStatus::Skipped => ExitCode::SUCCESS,
      }
    }
    CliCommand::AnalyzeJson { path } => {
      let report = run_analyze(&path);
      let status = report.status();
      match serde_json::to_string(&report) {
        Ok(json) => println!("{json}"),
        Err(err) => {
          eprintln!("Failed to serialize analyze report: {err}");
          return ExitCode::from(2);
        }
      }

      match status {
        CliAnalyzeStatus::Ok => ExitCode::SUCCESS,
        CliAnalyzeStatus::Error => ExitCode::from(1),
      }
    }
    CliCommand::AnalyzeBatchJson {
      paths,
      manifest,
      concurrency,
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
        Ok(json) => println!("{json}"),
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
      Ok(CliCommand::DoctorJson)
    );
  }

  #[test]
  fn rejects_doctor_without_json() {
    assert!(parse_args(&args(&["doctor"])).is_err());
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
  }

  #[test]
  fn parses_analyze_json() {
    assert_eq!(
      parse_args(&args(&["analyze", "mix.wav", "--json"])),
      Ok(CliCommand::AnalyzeJson {
        path: "mix.wav".to_string()
      })
    );
  }

  #[test]
  fn rejects_analyze_without_json() {
    assert!(parse_args(&args(&["analyze", "mix.wav"])).is_err());
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
}
