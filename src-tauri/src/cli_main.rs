//! CLI command implementation, hosted inside the main `plvs` binary behind the
//! internal `--cli` flag. The shipped `plvs-cli` executable is a thin forwarder
//! (see `bin/plvs-cli.rs`) so the engine (ONNX runtime, VAD models, DSP) is
//! linked into the installer only once.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{self, Write};
use std::process::ExitCode;

use serde::Serialize;

#[cfg(any(feature = "capture-harness", test))]
use crate::audio::capture_summary::CaptureSample;
#[cfg(any(feature = "capture-harness", test))]
use crate::cli_analyze::{
  run_analyze_with_options, CliAnalyzeOptions, CliAnalyzeStatus, CliDialogueOptions,
  CliQualityControlOptions,
};
#[cfg(any(feature = "capture-harness", test))]
use crate::cli_capture::{run_capture, sample_line, CliCaptureStatus};
use crate::cli_contract::CLI_SCHEMA_VERSION;
use crate::cli_control::{self, ControlCommand};
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
  Control(ControlCommand),
  Doctor {
    json: bool,
    out: Option<String>,
  },
  SchemaList,
  SchemaGet(String),
  Completion(String),
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
  Schema,
  Completion,
  #[cfg(any(feature = "capture-harness", test))]
  Analyze,
  #[cfg(any(feature = "capture-harness", test))]
  Capture,
}

fn parse_args(args: &[String]) -> Result<CliCommand, String> {
  match args {
    [flag] if flag == "--help" || flag == "-h" || flag == "help" => {
      Ok(CliCommand::Help(HelpTopic::Root))
    }
    [command, rest @ ..] if command == "doctor" => parse_doctor_args(rest),
    [command, rest @ ..] if command == "schema" => parse_schema_args(rest),
    [command, flag] if command == "completion" && is_help_flag(flag) => {
      Ok(CliCommand::Help(HelpTopic::Completion))
    }
    [command, shell]
      if command == "completion" && matches!(shell.as_str(), "powershell" | "bash" | "zsh") =>
    {
      Ok(CliCommand::Completion(shell.clone()))
    }
    [command, ..] if command == "completion" => {
      Err("Usage: plvs-cli completion <powershell|bash|zsh>".to_string())
    }
    [command, ..] if cli_control::is_command(command) => {
      cli_control::parse_control_args(args).map(CliCommand::Control)
    }
    [command, topic] if command == "help" => parse_help_topic(topic),
    [command, ..] if command == "help" => {
      Err("Usage: plvs-cli help [doctor|schema|completion|<control-command>]".to_string())
    }
    [command, ..] if is_help_flag(command) => Ok(CliCommand::Help(HelpTopic::Root)),
    [command] if command == "--version" || command == "-V" => Ok(CliCommand::Version),
    [command, ..] => Err(format!("Unknown command: {command}")),
    [] => Err("Missing command. Try: plvs-cli --help".to_string()),
  }
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

fn parse_schema_args(args: &[String]) -> Result<CliCommand, String> {
  if args.iter().any(|arg| is_help_flag(arg)) {
    return Ok(CliCommand::Help(HelpTopic::Schema));
  }
  match args {
    [command, json] if command == "list" && json == "--json" => Ok(CliCommand::SchemaList),
    [command, id, json] if command == "get" && !id.starts_with("--") && json == "--json" => {
      Ok(CliCommand::SchemaGet(id.clone()))
    }
    _ => Err("Usage: plvs-cli schema <list --json|get <command-id> --json>".to_string()),
  }
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

fn parse_help_topic(topic: &str) -> Result<CliCommand, String> {
  match topic {
    "doctor" => Ok(CliCommand::Help(HelpTopic::Doctor)),
    "schema" => Ok(CliCommand::Help(HelpTopic::Schema)),
    "completion" => Ok(CliCommand::Help(HelpTopic::Completion)),
    topic if cli_control::is_command(topic) => Ok(CliCommand::Control(ControlCommand::FamilyHelp(
      topic.to_string(),
    ))),
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

fn serialize_schema_list() -> Result<String, String> {
  let manifest = crate::cli_manifest::command_manifest().map_err(str::to_string)?;
  serde_json::to_string(&SuccessEnvelope {
    schema_version: CLI_SCHEMA_VERSION,
    ok: true,
    result: crate::cli_manifest::schema_list_result(manifest),
  })
  .map_err(|error| format!("Failed to serialize command schema list: {error}"))
}

fn serialize_schema_get(id: &str) -> Result<Option<String>, String> {
  let manifest = crate::cli_manifest::command_manifest().map_err(str::to_string)?;
  crate::cli_manifest::schema_get_result(manifest, id)
    .map(|result| {
      serde_json::to_string(&SuccessEnvelope {
        schema_version: CLI_SCHEMA_VERSION,
        ok: true,
        result,
      })
      .map_err(|error| format!("Failed to serialize command schema {id}: {error}"))
    })
    .transpose()
}

fn write_json_line(writer: &mut impl Write, json: &str) -> Result<(), String> {
  writeln!(writer, "{json}").map_err(|error| format!("Failed to write schema output: {error}"))
}

fn emit_schema_json(json: &str) -> Result<(), String> {
  write_json_line(&mut io::stdout().lock(), json)
}

fn completion_contexts() -> Result<BTreeMap<String, BTreeSet<String>>, String> {
  let manifest = crate::cli_manifest::command_manifest().map_err(str::to_string)?;
  let mut contexts = BTreeMap::<String, BTreeSet<String>>::new();
  for command in &manifest.commands {
    for index in 0..command.path.len() {
      contexts
        .entry(command.path[..index].join(" "))
        .or_default()
        .insert(command.path[index].clone());
    }
    let path = command.path.join(" ");
    if let Some(position) = command.positionals.first() {
      if let Some(values) = &position.value.enum_values {
        for value in values.iter().filter_map(serde_json::Value::as_str) {
          contexts
            .entry(path.clone())
            .or_default()
            .insert(value.to_string());
        }
      }
    }
    for option in &command.options {
      contexts
        .entry(path.clone())
        .or_default()
        .insert(option.name.clone());
      if let Some(values) = &option.value.enum_values {
        let option_context = contexts
          .entry(format!("{path} {}", option.name))
          .or_default();
        for value in values.iter().filter_map(serde_json::Value::as_str) {
          option_context.insert(value.to_string());
        }
      }
    }
  }
  Ok(contexts)
}

fn render_completion(shell: &str) -> Result<String, String> {
  let contexts = completion_contexts()?;
  let cases = contexts
    .iter()
    .map(|(context, candidates)| {
      let candidates = candidates.iter().cloned().collect::<Vec<_>>().join(" ");
      (context, candidates)
    })
    .collect::<Vec<_>>();
  match shell {
    "bash" => {
      let arms = cases
        .iter()
        .map(|(context, candidates)| format!("    \"{context}\") candidates=\"{candidates}\" ;;"))
        .collect::<Vec<_>>()
        .join("\n");
      Ok(format!(
        "_plvs_cli() {{\n  local context candidates\n  context=\"${{COMP_WORDS[*]:1:$((COMP_CWORD-1))}}\"\n  while true; do\n    candidates=\"\"\n    case \"$context\" in\n{arms}\n      *) candidates=\"\" ;;\n    esac\n    [[ -n \"$candidates\" || -z \"$context\" ]] && break\n    [[ \"$context\" == *\" \"* ]] && context=\"${{context% *}}\" || context=\"\"\n  done\n  COMPREPLY=( $(compgen -W \"$candidates\" -- \"${{COMP_WORDS[COMP_CWORD]}}\") )\n}}\ncomplete -F _plvs_cli plvs-cli\n"
      ))
    }
    "zsh" => {
      let arms = cases
        .iter()
        .map(|(context, candidates)| format!("    \"{context}\") candidates=({candidates}) ;;"))
        .collect::<Vec<_>>()
        .join("\n");
      Ok(format!(
        "#compdef plvs-cli\n_plvs_cli() {{\n  local context\n  local -a candidates\n  context=\"${{(j: :)words[2,$((CURRENT-1))]}}\"\n  while true; do\n    candidates=()\n    case \"$context\" in\n{arms}\n      *) candidates=() ;;\n    esac\n    if (( ${{#candidates}} > 0 )) || [[ -z \"$context\" ]]; then break; fi\n    [[ \"$context\" == *\" \"* ]] && context=\"${{context% *}}\" || context=\"\"\n  done\n  _describe 'PLVS command' candidates\n}}\ncompdef _plvs_cli plvs-cli\n"
      ))
    }
    "powershell" => {
      let arms = cases
        .iter()
        .map(|(context, candidates)| format!("    '{context}' {{ $candidates = '{candidates}' }}"))
        .collect::<Vec<_>>()
        .join("\n");
      Ok(format!(
        "Register-ArgumentCompleter -Native -CommandName plvs-cli -ScriptBlock {{\n  param($wordToComplete, $commandAst, $cursorPosition)\n  $elements = @($commandAst.CommandElements | ForEach-Object {{ $_.Extent.Text }})\n  $tokens = @($elements | Select-Object -Skip 1)\n  if ($wordToComplete -and $tokens.Count -gt 0) {{ $tokens = @($tokens | Select-Object -SkipLast 1) }}\n  $context = $tokens -join ' '\n  do {{\n    $candidates = ''\n    switch ($context) {{\n{arms}\n    }}\n    if ($candidates -or -not $context) {{ break }}\n    $separator = $context.LastIndexOf(' ')\n    $context = if ($separator -lt 0) {{ '' }} else {{ $context.Substring(0, $separator) }}\n  }} while ($true)\n  $candidates -split ' ' | Where-Object {{ $_ -like \"$wordToComplete*\" }} | ForEach-Object {{\n    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)\n  }}\n}}\n"
      ))
    }
    _ => Err(format!("Unsupported completion shell: {shell}")),
  }
}

fn doctor_exit_code(status: DoctorStatus) -> u8 {
  match status {
    DoctorStatus::Error => 1,
    DoctorStatus::Ok | DoctorStatus::Warning | DoctorStatus::Skipped => 0,
  }
}

fn serialize_cli_failure(code: &str, message: &str, exit_code: u8) -> (String, u8) {
  let encoded = serde_json::to_string(&ErrorEnvelope {
    schema_version: CLI_SCHEMA_VERSION,
    ok: false,
    error: ErrorBody { code, message },
  })
  .expect("the CLI error envelope contains only strings and integers");
  (encoded, exit_code)
}

fn host_identity_mismatch_message(expected_identifier: &str) -> &'static str {
  if expected_identifier.ends_with(".dev") {
    "The development CLI found a PLVS host built for another app identity. Start PLVS Dev with `npm run desktop` and retry."
  } else {
    "The PLVS CLI and its adjacent application binary were built for different app identities. Reinstall the matching PLVS build and retry."
  }
}

fn serialize_host_identity_mismatch(
  expected_identifier: &str,
  host_identifier: &str,
) -> (String, u8) {
  let message = host_identity_mismatch_message(expected_identifier);
  let encoded = serde_json::to_string(&serde_json::json!({
    "schemaVersion": CLI_SCHEMA_VERSION,
    "ok": false,
    "error": {
      "code": "cliHostIdentityMismatch",
      "message": message,
      "details": {
        "expectedIdentifier": expected_identifier,
        "hostIdentifier": host_identifier,
      }
    }
  }))
  .expect("the CLI host identity error contains only strings and integers");
  (encoded, 2)
}

fn serialize_parse_error(message: &str) -> (String, u8) {
  let code = if message.starts_with("Unknown command:")
    || message.starts_with("Unknown control command:")
    || message.starts_with("Unknown help topic:")
  {
    "unknownCommand"
  } else {
    "invalidArguments"
  };
  serialize_cli_failure(code, message, 3)
}

fn emit_cli_failure(code: &str, message: &str, json: bool, exit_code: u8) -> ExitCode {
  if json {
    let (encoded, _) = serialize_cli_failure(code, message, exit_code);
    println!("{encoded}");
  } else {
    eprintln!("{message}");
  }
  ExitCode::from(exit_code)
}

fn emit_text(text: &str, out: Option<&str>, command: &str) -> Result<(), String> {
  if let Some(path) = out {
    fs::write(path, text).map_err(|err| format!("Failed to write {command} output: {err}"))?;
  }
  print!("{text}");
  Ok(())
}

fn root_help_text() -> String {
  let offline = crate::cli_manifest::command_manifest()
    .map(|manifest| {
      manifest
        .commands
        .iter()
        .filter(|entry| entry.execution == "offline")
        .map(|entry| format!("  {}", entry.usage))
        .collect::<Vec<_>>()
        .join("\n")
    })
    .unwrap_or_default();
  let running = crate::cli_manifest::command_families("runningApp")
    .into_iter()
    .map(|family| {
      crate::cli_manifest::command_manifest()
        .ok()
        .and_then(|manifest| {
          manifest
            .commands
            .iter()
            .find(|entry| entry.execution == "runningApp" && entry.family == family)
        })
        .filter(|entry| entry.path.len() == 1)
        .map_or_else(
          || format!("  plvs-cli {family} ..."),
          |entry| format!("  {}", entry.usage),
        )
    })
    .collect::<Vec<_>>()
    .join("\n");
  format!(
    "PLVS CLI\n\nDiagnostics and setup:\n{offline}\n\nRunning app:\n{running}\n\nAgent usage:\n  Use --json for stable machine-readable output. Read-only running-app commands also accept --format text.\n  Running-app commands require Agent Control to be enabled and never launch PLVS.\n\nHelp:\n  plvs-cli --help\n  plvs-cli help\n  plvs-cli <command> --help\n\nExit codes:\n  0  success\n  1  runtime or system failure\n  2  app unavailable for control\n  3  invalid command input\n  4  current state refuses the operation\n  5  wait did not complete"
  )
}

fn help_text(topic: HelpTopic) -> String {
  match topic {
    HelpTopic::Root => root_help_text(),
    HelpTopic::Doctor => {
      let usage = crate::cli_manifest::command_by_id("doctor")
        .map(|entry| entry.usage.as_str())
        .unwrap_or("plvs-cli doctor [--json] [--out <file>]");
      format!("PLVS CLI - doctor\n\nUsage:\n  {usage}\n\nRuns installed-runtime health checks without launching the desktop UI.\nThe default output is human-readable. Add --json for the stable machine-readable report.\nWith --out, the same output is also written to a file.\n\nExit codes:\n  0  report status is ok or warning\n  1  report status is error, or output failed\n  3  invalid command input")
    }
    HelpTopic::Schema => {
      let usage = crate::cli_manifest::command_manifest()
        .map(|manifest| {
          manifest
            .commands
            .iter()
            .filter(|entry| entry.family == "schema")
            .map(|entry| format!("  {}", entry.usage))
            .collect::<Vec<_>>()
            .join("\n")
        })
        .unwrap_or_default();
      format!("PLVS CLI - schema\n\nUsage:\n{usage}\n\nReads the installed CLI command catalog without contacting PLVS.\n\nExit codes:\n  0  success\n  1  runtime or system failure\n  3  invalid command input")
    }
    HelpTopic::Completion => {
      "PLVS CLI - completion\n\nUsage:\n  plvs-cli completion <powershell|bash|zsh>\n\nPrints a shell completion script generated from the installed command catalog.\nLoad the output from your shell profile or write it to the shell's completion directory.\n\nExit codes:\n  0  success\n  1  runtime or system failure\n  3  invalid command input".to_string()
    }
    #[cfg(any(feature = "capture-harness", test))]
    HelpTopic::Analyze => {
      "PLVS internal capture harness - analyze\n\nUsage:\n  plvs --harness analyze <path> --json [--track <index>] [--dialogue] [--vad silero|firered|ten] [--reference-lufs <n>] [--target-lufs <n> --lufs-tolerance <n>] [--max-true-peak <n>] [--out <file>]\n\nRepository-owned ground-truth analysis for capture verification. This is not a public CLI command.".to_string()
    }
    #[cfg(any(feature = "capture-harness", test))]
    HelpTopic::Capture => {
      "PLVS internal capture harness - capture\n\nUsage:\n  plvs --harness capture [--device <substring|stable-id>] --seconds <n> [--every <n>] --json [--out <file>]\n\nRepository-owned live capture for smoke and soak verification. This is not a public CLI command.".to_string()
    }
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

/// Run a command forwarded by the companion `plvs-cli` binary.
///
/// The thin forwarder and the host are built independently into the same directory. Checking both
/// compiled identities here prevents a stale host artifact from discovering and controlling the
/// other PLVS identity before the public command is parsed or executed.
pub fn run_forwarded(expected_app_identifier: &str, args: &[String]) -> ExitCode {
  let host_app_identifier = env!("PLVS_APP_ID");
  if expected_app_identifier != host_app_identifier {
    let (encoded, exit_code) =
      serialize_host_identity_mismatch(expected_app_identifier, host_app_identifier);
    if args.iter().any(|arg| arg == "--json") {
      println!("{encoded}");
    } else {
      eprintln!(
        "{}",
        host_identity_mismatch_message(expected_app_identifier)
      );
    }
    return ExitCode::from(exit_code);
  }
  run(args)
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
    CliCommand::Control(command) => cli_control::run(command),
    CliCommand::SchemaList => {
      match serialize_schema_list().and_then(|json| emit_schema_json(&json)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => emit_cli_failure("internalError", &error, true, 1),
      }
    }
    CliCommand::SchemaGet(id) => match serialize_schema_get(&id) {
      Ok(Some(json)) => match emit_schema_json(&json) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => emit_cli_failure("internalError", &error, true, 1),
      },
      Ok(None) => emit_cli_failure(
        "invalidArguments",
        &format!("Unknown command schema ID: {id}."),
        true,
        3,
      ),
      Err(error) => emit_cli_failure("internalError", &error, true, 1),
    },
    CliCommand::Completion(shell) => match render_completion(&shell) {
      Ok(script) => {
        print!("{script}");
        ExitCode::SUCCESS
      }
      Err(error) => emit_cli_failure("internalError", &error, false, 1),
    },
    CliCommand::Doctor { json, out } => {
      let report = run_doctor();
      if json {
        match serialize_doctor_json(&report) {
          Ok(json) => {
            if let Err(err) = emit_json(&json, out.as_deref(), "doctor") {
              return emit_cli_failure("outputWriteFailed", &err, true, 1);
            }
          }
          Err(err) => {
            return emit_cli_failure(
              "internalError",
              &format!("Failed to serialize doctor report: {err}"),
              true,
              1,
            );
          }
        }
      } else {
        let text = render_doctor_text(&report);
        if let Err(err) = emit_text(&text, out.as_deref(), "doctor") {
          return emit_cli_failure("outputWriteFailed", &err, false, 1);
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

  struct BrokenWriter;

  impl Write for BrokenWriter {
    fn write(&mut self, _buffer: &[u8]) -> io::Result<usize> {
      Err(io::Error::new(io::ErrorKind::BrokenPipe, "closed"))
    }

    fn flush(&mut self) -> io::Result<()> {
      Ok(())
    }
  }

  fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
  }

  #[test]
  fn forwarded_cli_rejects_a_host_built_for_another_app_identity() {
    let (encoded, exit_code) =
      serialize_host_identity_mismatch("com.soundoer.plvs.dev", "com.soundoer.plvs");
    let json: serde_json::Value = serde_json::from_str(&encoded).unwrap();

    assert_eq!(exit_code, 2);
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["ok"], false);
    assert_eq!(json["error"]["code"], "cliHostIdentityMismatch");
    assert_eq!(
      json["error"]["details"]["expectedIdentifier"],
      "com.soundoer.plvs.dev"
    );
    assert_eq!(
      json["error"]["details"]["hostIdentifier"],
      "com.soundoer.plvs"
    );
    assert!(json.get("result").is_none());
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
  fn parses_only_the_public_schema_forms_and_scoped_help() {
    assert_eq!(
      parse_args(&args(&["schema", "list", "--json"])),
      Ok(CliCommand::SchemaList)
    );
    assert_eq!(
      parse_args(&args(&[
        "schema",
        "get",
        "visual.recording.start",
        "--json"
      ])),
      Ok(CliCommand::SchemaGet("visual.recording.start".to_string()))
    );
    for invocation in [
      vec!["schema", "list"],
      vec!["schema", "list", "--out", "schema.json", "--json"],
      vec!["schema", "get", "--json"],
      vec!["schema", "get", "app.inspect", "--dry-run", "--json"],
      vec![
        "schema",
        "get",
        "app.inspect",
        "--expected-revision",
        "0",
        "--json",
      ],
    ] {
      assert!(
        parse_args(&args(&invocation)).is_err(),
        "accepted {invocation:?}"
      );
    }
    assert_eq!(
      parse_args(&args(&["schema", "--help"])),
      Ok(CliCommand::Help(HelpTopic::Schema))
    );
    assert_eq!(
      parse_args(&args(&["help", "schema"])),
      Ok(CliCommand::Help(HelpTopic::Schema))
    );
    let help = help_text(HelpTopic::Schema);
    assert!(help.contains("plvs-cli schema list --json"));
    assert!(help.contains("plvs-cli schema get <command-id> --json"));
  }

  #[test]
  fn parses_completion_commands_and_scoped_help() {
    for shell in ["powershell", "bash", "zsh"] {
      assert_eq!(
        parse_args(&args(&["completion", shell])),
        Ok(CliCommand::Completion(shell.to_string()))
      );
    }
    for invocation in [
      vec!["completion"],
      vec!["completion", "fish"],
      vec!["completion", "bash", "--json"],
    ] {
      assert!(parse_args(&args(&invocation)).is_err());
    }
    assert_eq!(
      parse_args(&args(&["completion", "--help"])),
      Ok(CliCommand::Help(HelpTopic::Completion))
    );
    assert_eq!(
      parse_args(&args(&["help", "completion"])),
      Ok(CliCommand::Help(HelpTopic::Completion))
    );
    assert!(help_text(HelpTopic::Completion).contains("completion <powershell|bash|zsh>"));
  }

  #[test]
  fn completions_are_generated_from_manifest_paths_options_and_enums() {
    for shell in ["powershell", "bash", "zsh"] {
      let script = render_completion(shell).unwrap();
      assert!(
        script.contains("measurement wait"),
        "missing path in {shell}"
      );
      assert!(
        script.contains("--after-generation"),
        "missing option in {shell}"
      );
      assert!(
        script.contains("--format"),
        "missing text format in {shell}"
      );
      for value in ["powershell", "bash", "zsh"] {
        assert!(script.contains(value), "missing enum {value} in {shell}");
      }
    }
    assert!(render_completion("fish").is_err());
  }

  #[test]
  fn schema_list_is_compact_ordered_and_omits_inapplicable_fields() {
    let encoded = serialize_schema_list().unwrap();
    let json: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["ok"], true);
    assert_eq!(json["result"]["manifestVersion"], 1);
    let commands = json["result"]["commands"].as_array().unwrap();
    assert_eq!(commands.len(), 95);
    assert_eq!(commands[0]["id"], "app.capabilities");
    let doctor = commands
      .iter()
      .find(|entry| entry["id"] == "doctor")
      .unwrap();
    assert!(doctor.get("wireMethod").is_none());
    assert!(doctor.get("featureGate").is_none());
    assert!(doctor.get("usage").is_none());
  }

  #[test]
  fn schema_get_returns_the_full_public_projection_and_unknown_ids_are_local() {
    let encoded = serialize_schema_get("visual.recording.start")
      .unwrap()
      .unwrap();
    let json: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(json["result"]["manifestVersion"], 1);
    assert_eq!(json["result"]["command"]["id"], "visual.recording.start");
    assert_eq!(json["result"]["command"]["wireParams"]["type"], "object");
    assert!(json["result"]["command"]["options"].is_array());
    assert!(serialize_schema_get("missing.command").unwrap().is_none());
    let (error, exit_code) = serialize_cli_failure(
      "invalidArguments",
      "Unknown command schema ID: missing.command.",
      3,
    );
    assert_eq!(exit_code, 3);
    assert_eq!(
      serde_json::from_str::<serde_json::Value>(&error).unwrap()["error"]["code"],
      "invalidArguments"
    );
  }

  #[test]
  fn broken_schema_output_is_a_local_system_failure() {
    assert!(write_json_line(&mut BrokenWriter, "{}")
      .unwrap_err()
      .contains("closed"));
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
    let (warning, error) = match status {
      DoctorStatus::Warning => (1, 0),
      DoctorStatus::Error => (0, 1),
      _ => (0, 0),
    };
    crate::doctor::DoctorReport {
      status,
      summary: crate::doctor::DoctorSummary {
        ok: 1,
        warning,
        error,
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

    assert_eq!(
      json,
      crate::cli_contract::golden_fixture("doctor.warning")["envelope"]
    );
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["ok"], true);
    assert_eq!(json["result"]["report"]["status"], "warning");
    assert!(json["result"]["report"].get("schemaVersion").is_none());
    assert!(json.get("error").is_none());
  }

  #[test]
  fn doctor_errors_keep_a_success_envelope_but_exit_one() {
    let encoded = serialize_doctor_json(&doctor_report(DoctorStatus::Error)).unwrap();
    let json: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(
      json,
      crate::cli_contract::golden_fixture("doctor.error")["envelope"]
    );
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
  fn parses_flat_control_commands_and_help_topics() {
    assert_eq!(
      parse_args(&args(&["inspect", "--json"])),
      Ok(CliCommand::Control(ControlCommand::Inspect))
    );
    assert_eq!(
      parse_args(&args(&["panel", "--help"])),
      Ok(CliCommand::Control(ControlCommand::FamilyHelp(
        "panel".to_string()
      )))
    );
    assert_eq!(
      parse_args(&args(&["help", "panel"])),
      Ok(CliCommand::Control(ControlCommand::FamilyHelp(
        "panel".to_string()
      )))
    );
  }

  #[test]
  fn control_family_help_is_scoped_to_that_family() {
    let panel = cli_control::family_help_text("panel");
    assert!(panel.contains("plvs-cli panel describe"));
    assert!(panel.contains("plvs-cli panel update"));
    assert!(!panel.contains("plvs-cli theme export"));

    let theme = cli_control::family_help_text("theme");
    assert!(theme.contains("plvs-cli theme export"));
    assert!(!theme.contains("plvs-cli panel update"));
  }

  #[test]
  fn removes_the_app_command_family_without_an_alias() {
    assert_eq!(
      parse_args(&args(&["app", "inspect", "--json"])),
      Err("Unknown command: app".to_string())
    );
    assert_eq!(
      parse_args(&args(&["help", "app"])),
      Err("Unknown help topic: app".to_string())
    );
  }

  #[test]
  fn root_help_exposes_flat_control_families() {
    let text = help_text(HelpTopic::Root);
    let manifest = crate::cli_manifest::command_manifest().unwrap();
    for entry in manifest
      .commands
      .iter()
      .filter(|entry| entry.execution == "offline")
    {
      assert_eq!(
        text.matches(&entry.usage).count(),
        1,
        "wrong root count for {}",
        entry.id
      );
    }
    for family in crate::cli_manifest::command_families("runningApp") {
      let first = manifest
        .commands
        .iter()
        .find(|entry| entry.execution == "runningApp" && entry.family == family)
        .unwrap();
      let line = if first.path.len() == 1 {
        format!("  {}", first.usage)
      } else {
        format!("  plvs-cli {family} ...")
      };
      assert_eq!(
        text.lines().filter(|candidate| *candidate == line).count(),
        1,
        "wrong root count for {family}"
      );
    }
    assert!(!text.contains("plvs-cli app"));
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
  fn root_help_lists_every_v1_exit_class() {
    let text = help_text(HelpTopic::Root);
    for code in 0..=5 {
      assert!(
        text.contains(&format!("  {code}  ")),
        "missing exit code {code}"
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
    assert_eq!(
      json,
      crate::cli_contract::golden_fixture("error.unknownCommand")["envelope"]
    );
  }

  #[test]
  fn invalid_root_arguments_use_the_v1_public_code_and_exit_three() {
    let error = parse_args(&args(&["doctor", "extra", "--json"])).unwrap_err();
    let (encoded, exit_code) = serialize_parse_error(&error);
    let json: serde_json::Value = serde_json::from_str(&encoded).unwrap();

    assert_eq!(exit_code, 3);
    assert_eq!(json["error"]["code"], "invalidArguments");
  }

  #[test]
  fn public_unknown_subcommands_and_help_topics_use_unknown_command() {
    for invocation in [vec!["app", "inspect", "--json"], vec!["help", "nonsense"]] {
      let error = parse_args(&args(&invocation)).unwrap_err();
      let (encoded, exit_code) = serialize_parse_error(&error);
      let json: serde_json::Value = serde_json::from_str(&encoded).unwrap();

      assert_eq!(exit_code, 3, "wrong exit for {invocation:?}");
      assert_eq!(
        json["error"]["code"], "unknownCommand",
        "wrong code for {invocation:?}: {error}"
      );
    }
  }

  #[test]
  fn output_write_failures_use_the_v1_error_envelope_and_exit_one() {
    let (encoded, exit_code) =
      serialize_cli_failure("outputWriteFailed", "Unable to write doctor output.", 1);
    let json: serde_json::Value = serde_json::from_str(&encoded).unwrap();

    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["ok"], false);
    assert_eq!(json["error"]["code"], "outputWriteFailed");
    assert_eq!(exit_code, 1);
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
