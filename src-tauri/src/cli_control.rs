use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{self, Read};
use std::path::Path;
use std::process::ExitCode;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::agent_control::discovery::{
  descriptor_path, is_process_alive, read_descriptor_at, AgentControlDescriptor, DescriptorApp,
  DiscoveryError, DiscoveryErrorKind,
};
use crate::agent_control::protocol::JsonRpcRequest;
use crate::cli_contract::CLI_SCHEMA_VERSION;

const MAX_SAFE_REVISION: u64 = 9_007_199_254_740_991;
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub const COMMAND_NAMES: &[&str] = &[
  "capabilities",
  "inspect",
  "measurement",
  "wait",
  "workspace",
  "panel",
  "axis",
  "preset",
  "theme",
  "loudness-profile",
  "config",
  "settings",
  "transport",
  "device",
  "dock",
];

pub fn is_command(command: &str) -> bool {
  COMMAND_NAMES.contains(&command)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlCommand {
  Help,
  FamilyHelp(String),
  Capabilities,
  Inspect,
  MeasurementRead {
    method: String,
  },
  PanelDescribe {
    panel_id: String,
  },
  WorkspaceApply {
    input: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  PanelUpdate {
    panel_id: String,
    input: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  PanelReset {
    panel_id: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  AxisDescribe,
  AxisInspect,
  AxisSharedUpdate {
    kind: String,
    input: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  AxisSharedReset {
    kind: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  AxisPanelUpdate {
    panel_id: String,
    kind: String,
    input: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  AxisPanelReset {
    panel_id: String,
    kind: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  PresetList,
  PresetDescribe {
    preset_id: String,
  },
  PresetSave {
    name: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  PresetUpdate {
    preset_id: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  PresetApply {
    preset_id: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  PresetRename {
    preset_id: String,
    name: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  PresetDelete {
    preset_id: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  PresetReorder {
    input: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  LibraryList {
    family: String,
  },
  LibraryExport {
    family: String,
    /// None exports the whole library.
    ids: Option<Vec<String>>,
    out: Option<String>,
  },
  LibraryImport {
    family: String,
    input: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  ThemeRead {
    method: String,
    theme_id: Option<String>,
  },
  ThemeMutation {
    method: String,
    theme_id: Option<String>,
    name: Option<String>,
    input: Option<String>,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  LoudnessProfileDescribe {
    profile_id: String,
  },
  LoudnessProfileMutation {
    method: String,
    profile_id: Option<String>,
    name: Option<String>,
    input: Option<String>,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  ConfigExport {
    out: Option<String>,
  },
  ConfigImport {
    input: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  SettingsDescribe,
  SettingsInspect,
  DeviceRead {
    method: String,
  },
  DeviceSelect {
    device_id: String,
    expected_revision: Option<u64>,
    expected_generation: Option<u64>,
    allow_measurement_restart: bool,
    dry_run: bool,
  },
  TransportInspect,
  TransportMutation {
    method: String,
    target_key: Option<String>,
    target: Option<String>,
    expected_revision: Option<u64>,
    allow_stop_file_analysis: bool,
    dry_run: bool,
  },
  DockRead {
    method: String,
  },
  DockCommand {
    method: String,
    panel_id: Option<String>,
    input: Option<String>,
    edge: Option<String>,
    monitor: Option<String>,
    reserve_space: Option<bool>,
    height: Option<u64>,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
  SettingsUpdate {
    input: String,
    expected_revision: Option<u64>,
    allow_measurement_restart: bool,
    dry_run: bool,
  },
  Wait {
    after_revision: u64,
    timeout_ms: u64,
  },
}

pub fn parse_control_args(args: &[String]) -> Result<ControlCommand, String> {
  match args {
    [flag] if is_help(flag) => return Ok(ControlCommand::Help),
    [command, rest @ ..]
      if is_command(command) && rest.iter().any(|argument| is_help(argument)) =>
    {
      return Ok(ControlCommand::FamilyHelp(command.clone()));
    }
    [command, flag] if (command == "capabilities" || command == "inspect") && flag == "--json" => {
      return Ok(if command == "capabilities" {
        ControlCommand::Capabilities
      } else {
        ControlCommand::Inspect
      });
    }
    [command, ..] if command == "capabilities" || command == "inspect" => {
      return Err(format!("The {command} command requires --json."));
    }
    [command, rest @ ..] if command == "workspace" => return parse_workspace_args(rest),
    [command, rest @ ..] if command == "measurement" => return parse_measurement_args(rest),
    [command, rest @ ..] if command == "panel" => return parse_panel_args(rest),
    [command, rest @ ..] if command == "axis" => return parse_axis_args(rest),
    [command, rest @ ..] if command == "preset" => return parse_preset_args(rest),
    [command, rest @ ..] if command == "theme" => return parse_theme_args(rest),
    [command, rest @ ..] if command == "loudness-profile" => {
      return parse_loudness_profile_args(rest)
    }
    [command, rest @ ..] if command == "config" => return parse_config_args(rest),
    [command, rest @ ..] if command == "settings" => return parse_settings_args(rest),
    [command, rest @ ..] if command == "transport" => return parse_transport_args(rest),
    [command, rest @ ..] if command == "device" => return parse_device_args(rest),
    [command, rest @ ..] if command == "dock" => return parse_dock_args(rest),
    [command, rest @ ..] if command == "wait" => return parse_wait_args(rest),
    [command, ..] => return Err(format!("Unknown control command: {command}")),
    [] => {}
  }
  Err("Usage: plvs-cli <capabilities|inspect|measurement|wait|workspace|panel|axis|preset|theme|loudness-profile|config|settings|transport|device|dock> ...".to_string())
}

fn parse_measurement_args(args: &[String]) -> Result<ControlCommand, String> {
  if let [action, flag] = args {
    if matches!(action.as_str(), "describe" | "inspect") && flag == "--json" {
      return Ok(ControlCommand::MeasurementRead {
        method: format!("measurement.{action}"),
      });
    }
  }
  Err("Usage: plvs-cli measurement <describe|inspect> --json".to_string())
}

fn parse_device_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|argument| is_help(argument)) {
    return Ok(ControlCommand::FamilyHelp("device".to_string()));
  }
  if let [action, flag] = args {
    if matches!(action.as_str(), "list" | "inspect") && flag == "--json" {
      return Ok(ControlCommand::DeviceRead {
        method: format!("device.{action}"),
      });
    }
  }

  let [action, device_id, rest @ ..] = args else {
    return Err("Usage: plvs-cli device <list|inspect|select> ... --json".to_string());
  };
  if action != "select" {
    return Err("Usage: plvs-cli device <list|inspect|select> ... --json".to_string());
  }
  if !is_device_id(device_id) {
    return Err(
      "The device ID must be default or an exact lb-<32 lowercase hex> / cap-<32 lowercase hex> ID returned by device list."
        .to_string(),
    );
  }

  let mut expected_revision = None;
  let mut expected_generation = None;
  let mut allow_measurement_restart = false;
  let mut dry_run = false;
  let mut json = false;
  let mut index = 0;
  while index < rest.len() {
    match rest[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--allow-measurement-restart" => {
        allow_measurement_restart = true;
        index += 1;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      "--expected-revision" | "--expected-generation" => {
        let option = rest[index].clone();
        let raw = rest
          .get(index + 1)
          .ok_or_else(|| format!("Missing value for {option}."))?;
        let parsed = raw
          .parse::<u64>()
          .map_err(|_| format!("The {option} value must be a non-negative safe integer."))?;
        if parsed > MAX_SAFE_REVISION {
          return Err(format!(
            "The {option} value must be a non-negative safe integer."
          ));
        }
        if option == "--expected-revision" {
          expected_revision = Some(parsed);
        } else {
          expected_generation = Some(parsed);
        }
        index += 2;
      }
      value => return Err(format!("Unexpected device argument: {value}")),
    }
  }
  if !json {
    return Err("The device command requires --json.".to_string());
  }
  if expected_revision.is_none() {
    return Err("The device.select command requires --expected-revision.".to_string());
  }
  if expected_generation.is_none() {
    return Err("The device.select command requires --expected-generation.".to_string());
  }
  Ok(ControlCommand::DeviceSelect {
    device_id: device_id.clone(),
    expected_revision,
    expected_generation,
    allow_measurement_restart,
    dry_run,
  })
}

fn is_device_id(value: &str) -> bool {
  if value == "default" {
    return true;
  }
  let Some(hex) = value
    .strip_prefix("lb-")
    .or_else(|| value.strip_prefix("cap-"))
  else {
    return false;
  };
  hex.len() == 32
    && hex
      .bytes()
      .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn parse_config_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|argument| is_help(argument)) {
    return Ok(ControlCommand::FamilyHelp("config".to_string()));
  }
  let [action, rest @ ..] = args else {
    return Err("Usage: plvs-cli config <export|import> ... --json".to_string());
  };
  if action == "import" {
    let Some(input) = rest.first() else {
      return Err(
        "Usage: plvs-cli config import <file|-> --expected-revision <n> --json [--dry-run]"
          .to_string(),
      );
    };
    let (expected_revision, dry_run, json) = parse_mutation_flags(&rest[1..], "config import")?;
    if !json {
      return Err("The config import command requires --json.".to_string());
    }
    return Ok(ControlCommand::ConfigImport {
      input: input.clone(),
      expected_revision,
      dry_run,
    });
  }
  if action != "export" {
    return Err(format!("Unknown config subcommand: {action}"));
  }
  let mut json = false;
  let mut out = None;
  let mut index = 0;
  while index < rest.len() {
    match rest[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--out" => {
        let value = rest
          .get(index + 1)
          .ok_or_else(|| "Missing value for --out.".to_string())?;
        if value.starts_with("--") || value.is_empty() {
          return Err("Missing value for --out.".to_string());
        }
        out = Some(value.clone());
        index += 2;
      }
      value => return Err(format!("Unexpected config export argument: {value}")),
    }
  }
  if !json {
    return Err("The config export command requires --json.".to_string());
  }
  Ok(ControlCommand::ConfigExport { out })
}

fn parse_mutation_flags(
  args: &[String],
  command: &str,
) -> Result<(Option<u64>, bool, bool), String> {
  let mut expected_revision = None;
  let mut dry_run = false;
  let mut json = false;
  let mut index = 0;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      "--expected-revision" => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let parsed = value.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if parsed > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(parsed);
        index += 2;
      }
      value => return Err(format!("Unexpected {command} argument: {value}")),
    }
  }
  if expected_revision.is_none() {
    return Err(format!(
      "The {command} command requires --expected-revision."
    ));
  }
  Ok((expected_revision, dry_run, json))
}

fn parse_dock_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  if let [action, json] = args {
    if matches!(action.as_str(), "describe" | "inspect") && json == "--json" {
      return Ok(ControlCommand::DockRead {
        method: format!("dock.{action}"),
      });
    }
  }
  let (method, panel_id, input, consumed) = match args {
    [action, ..] if matches!(action.as_str(), "enter" | "exit") => {
      (format!("dock.{action}"), None, None, 1)
    }
    [scope, action, value, ..] if scope == "layout" && action == "apply" => {
      ("dock.layout.apply".to_string(), None, Some(value.clone()), 3)
    }
    [scope, action, panel_id, ..]
      if scope == "panel" && matches!(action.as_str(), "describe" | "reset") =>
    {
      (format!("dock.panel.{action}"), Some(panel_id.clone()), None, 3)
    }
    [scope, action, panel_id, input, ..] if scope == "panel" && action == "update" => (
      "dock.panel.update".to_string(),
      Some(panel_id.clone()),
      Some(input.clone()),
      4,
    ),
    _ => return Err("Usage: plvs-cli dock <describe|inspect|enter|exit|layout apply|panel describe|panel update|panel reset> ... --json".to_string()),
  };
  let read_panel = method == "dock.panel.describe";
  let enter = method == "dock.enter";
  let mut edge = None;
  let mut monitor = None;
  let mut reserve_space = None;
  let mut height = None;
  let mut expected_revision = None;
  let mut dry_run = false;
  let mut json = false;
  let mut index = consumed;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" if !read_panel => {
        dry_run = true;
        index += 1;
      }
      "--edge" if enter => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --edge.".to_string())?;
        if !matches!(value.as_str(), "top" | "bottom") {
          return Err("The --edge value must be top or bottom.".to_string());
        }
        edge = Some(value.clone());
        index += 2;
      }
      "--monitor" if enter => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --monitor.".to_string())?;
        if value.is_empty() {
          return Err("The --monitor value must be non-empty.".to_string());
        }
        monitor = Some(value.clone());
        index += 2;
      }
      "--reserve-space" if enter => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --reserve-space.".to_string())?;
        reserve_space = Some(match value.as_str() {
          "true" => true,
          "false" => false,
          _ => return Err("The --reserve-space value must be true or false.".to_string()),
        });
        index += 2;
      }
      "--height" if enter => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --height.".to_string())?;
        let parsed = value
          .parse::<u64>()
          .map_err(|_| "The --height value must be an integer from 56 to 160.".to_string())?;
        if !(56..=160).contains(&parsed) {
          return Err("The --height value must be an integer from 56 to 160.".to_string());
        }
        height = Some(parsed);
        index += 2;
      }
      "--expected-revision" if !read_panel => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let parsed = value.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if parsed > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(parsed);
        index += 2;
      }
      value => return Err(format!("Unexpected dock argument: {value}")),
    }
  }
  if !json {
    return Err("The dock command requires --json.".to_string());
  }
  if !read_panel && expected_revision.is_none() {
    return Err(format!(
      "The {method} command requires --expected-revision."
    ));
  }
  Ok(ControlCommand::DockCommand {
    method,
    panel_id,
    input,
    edge,
    monitor,
    reserve_space,
    height,
    expected_revision,
    dry_run,
  })
}

fn parse_transport_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  if args.first().map(String::as_str) == Some("inspect") {
    return if args == ["inspect", "--json"] {
      Ok(ControlCommand::TransportInspect)
    } else {
      Err("Usage: plvs-cli transport inspect --json".to_string())
    };
  }

  let (method, target_key, target, consumed) = match args {
    [scope, value, ..] if scope == "source" && matches!(value.as_str(), "live" | "file") => (
      format!("transport.source.{value}"),
      None,
      None,
      2,
    ),
    [scope, action, ..]
      if scope == "live" && matches!(action.as_str(), "start" | "stop" | "clear") =>
    {
      (format!("transport.live.{action}"), None, None, 2)
    }
    [scope, action, value, ..]
      if scope == "file"
        && matches!(
          action.as_str(),
          "analyze" | "reanalyze" | "stop" | "select" | "remove"
        ) =>
    {
      (
        format!("transport.file.{action}"),
        Some(if action == "analyze" { "path" } else { "sessionId" }.to_string()),
        Some(value.clone()),
        3,
      )
    }
    [scope, action, ..] if scope == "file" && action == "clear" => {
      ("transport.file.clear".to_string(), None, None, 2)
    }
    _ => {
      return Err(
        "Usage: plvs-cli transport <inspect|source live|source file|live start|live stop|live clear|file analyze|file reanalyze|file stop|file select|file remove|file clear> ... --json"
          .to_string(),
      )
    }
  };
  let action = is_transport_action(&method);
  let mut expected_revision = None;
  let mut allow_stop_file_analysis = false;
  let mut dry_run = false;
  let mut json = false;
  let mut index = consumed;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" if !action => {
        dry_run = true;
        index += 1;
      }
      "--dry-run" => {
        return Err(format!("The {method} action does not accept --dry-run."));
      }
      "--allow-stop-file-analysis" => {
        if !matches!(
          method.as_str(),
          "transport.source.live" | "transport.live.start"
        ) {
          return Err(format!(
            "The {method} command does not accept --allow-stop-file-analysis."
          ));
        }
        allow_stop_file_analysis = true;
        index += 1;
      }
      "--expected-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(revision);
        index += 2;
      }
      value => return Err(format!("Unexpected transport argument: {value}")),
    }
  }
  if !json {
    return Err("The transport command requires --json.".to_string());
  }
  if expected_revision.is_none() {
    return Err(format!(
      "The {method} command requires --expected-revision."
    ));
  }
  Ok(ControlCommand::TransportMutation {
    method,
    target_key,
    target,
    expected_revision,
    allow_stop_file_analysis,
    dry_run,
  })
}

fn is_transport_action(method: &str) -> bool {
  matches!(
    method,
    "transport.live.start"
      | "transport.live.stop"
      | "transport.file.analyze"
      | "transport.file.reanalyze"
      | "transport.file.stop"
  )
}

fn parse_wait_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  let mut after_revision = None;
  let mut timeout_ms = 30_000;
  let mut json = false;
  let mut index = 0;
  while index < args.len() {
    let option = args[index].as_str();
    if option == "--json" {
      json = true;
      index += 1;
      continue;
    }
    match option {
      "--after-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --after-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --after-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --after-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        after_revision = Some(revision);
        index += 2;
      }
      "--timeout-ms" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --timeout-ms.".to_string())?;
        timeout_ms = raw
          .parse::<u64>()
          .map_err(|_| "The --timeout-ms value must be an integer.".to_string())?;
        index += 2;
      }
      value => return Err(format!("Unknown wait option: {value}")),
    }
  }
  if !json {
    return Err("The wait command requires --json.".to_string());
  }
  let after_revision =
    after_revision.ok_or_else(|| "The wait command requires --after-revision.".to_string())?;
  if !(100..=300_000).contains(&timeout_ms) {
    return Err("The --timeout-ms value must be from 100 to 300000.".to_string());
  }
  Ok(ControlCommand::Wait {
    after_revision,
    timeout_ms,
  })
}

fn parse_settings_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  match args {
    [command, json] if command == "describe" && json == "--json" => {
      return Ok(ControlCommand::SettingsDescribe);
    }
    [command, json] if command == "inspect" && json == "--json" => {
      return Ok(ControlCommand::SettingsInspect);
    }
    [command, ..] if command == "describe" || command == "inspect" => {
      return Err(format!("The settings {command} command requires --json."));
    }
    _ => {}
  }
  const USAGE: &str = "Usage: plvs-cli settings update <file|-> --json [--expected-revision <n>] [--allow-measurement-restart] [--dry-run]";
  if args.first().map(String::as_str) != Some("update") {
    return Err(USAGE.to_string());
  }
  let mut input = None;
  let mut expected_revision = None;
  let mut allow_measurement_restart = false;
  let mut dry_run = false;
  let mut json = false;
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      "--allow-measurement-restart" => {
        allow_measurement_restart = true;
        index += 1;
      }
      "--expected-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(revision);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value if input.is_none() => {
        input = Some(value.to_string());
        index += 1;
      }
      value => return Err(format!("Unexpected argument: {value}")),
    }
  }
  if !json {
    return Err("The settings update command requires --json.".to_string());
  }
  if expected_revision.is_none() {
    return Err("The settings update command requires --expected-revision.".to_string());
  }
  Ok(ControlCommand::SettingsUpdate {
    input: input.ok_or_else(|| USAGE.to_string())?,
    expected_revision,
    allow_measurement_restart,
    dry_run,
  })
}

fn parse_workspace_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  if args.first().map(String::as_str) != Some("apply") {
    return Err(
      "Usage: plvs-cli workspace apply <file|-> --json [--expected-revision <n>] [--dry-run]"
        .to_string(),
    );
  }

  let mut input = None;
  let mut json = false;
  let mut expected_revision = None;
  let mut dry_run = false;
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      "--expected-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(revision);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value if input.is_none() => {
        input = Some(value.to_string());
        index += 1;
      }
      value => return Err(format!("Unexpected argument: {value}")),
    }
  }
  if !json {
    return Err("The workspace apply command requires --json.".to_string());
  }
  if expected_revision.is_none() {
    return Err("The workspace apply command requires --expected-revision.".to_string());
  }
  let input = input.ok_or_else(|| {
    "Usage: plvs-cli workspace apply <file|-> --json [--expected-revision <n>] [--dry-run]"
      .to_string()
  })?;
  Ok(ControlCommand::WorkspaceApply {
    input,
    expected_revision,
    dry_run,
  })
}

fn parse_panel_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  const UPDATE_USAGE: &str =
    "Usage: plvs-cli panel update <panel-id> <file|-> --json [--expected-revision <n>] [--dry-run]";
  const RESET_USAGE: &str =
    "Usage: plvs-cli panel reset <panel-id> --json [--expected-revision <n>] [--dry-run]";
  const DESCRIBE_USAGE: &str = "Usage: plvs-cli panel describe <panel-id> --json";
  let action = args.first().map(String::as_str);
  let usage = match action {
    Some("update") => UPDATE_USAGE,
    Some("reset") => RESET_USAGE,
    Some("describe") => DESCRIBE_USAGE,
    _ => return Err(format!("{DESCRIBE_USAGE}\n{UPDATE_USAGE}\n{RESET_USAGE}")),
  };

  let mut positionals = Vec::new();
  let mut json = false;
  let mut expected_revision = None;
  let mut dry_run = false;
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" => {
        if action == Some("describe") {
          return Err("Unknown option: --dry-run".to_string());
        }
        dry_run = true;
        index += 1;
      }
      "--expected-revision" => {
        if action == Some("describe") {
          return Err("Unknown option: --expected-revision".to_string());
        }
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(revision);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => {
        positionals.push(value.to_string());
        index += 1;
      }
    }
  }
  if !json {
    return Err(format!(
      "The panel {} command requires --json.",
      action.unwrap()
    ));
  }
  if action != Some("describe") && expected_revision.is_none() {
    return Err(format!(
      "The panel {} command requires --expected-revision.",
      action.unwrap()
    ));
  }
  let expected_positionals = if action == Some("update") { 2 } else { 1 };
  if positionals.len() != expected_positionals || positionals[0].trim().is_empty() {
    return Err(usage.to_string());
  }
  match action {
    Some("update") => Ok(ControlCommand::PanelUpdate {
      panel_id: positionals[0].clone(),
      input: positionals[1].clone(),
      expected_revision,
      dry_run,
    }),
    Some("reset") => Ok(ControlCommand::PanelReset {
      panel_id: positionals[0].clone(),
      expected_revision,
      dry_run,
    }),
    Some("describe") => Ok(ControlCommand::PanelDescribe {
      panel_id: positionals[0].clone(),
    }),
    _ => unreachable!("panel action was validated above"),
  }
}

fn parse_axis_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  match args {
    [command, json] if (command == "describe" || command == "inspect") && json == "--json" => {
      return Ok(if command == "describe" {
        ControlCommand::AxisDescribe
      } else {
        ControlCommand::AxisInspect
      });
    }
    [command, ..] if command == "describe" || command == "inspect" => {
      return Err(format!("The axis {command} command requires --json."));
    }
    _ => {}
  }

  const USAGE: &str = "Usage:\n  plvs-cli axis shared update <frequency|time> <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli axis shared reset <frequency|time> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli axis panel update <panel-id> <frequency|time> <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli axis panel reset <panel-id> <frequency|time> --json [--expected-revision <n>] [--dry-run]";
  let scope = args.first().map(String::as_str);
  let action = args.get(1).map(String::as_str);
  if !matches!(scope, Some("shared" | "panel")) || !matches!(action, Some("update" | "reset")) {
    return Err(USAGE.to_string());
  }

  let mut positionals = Vec::new();
  let mut json = false;
  let mut expected_revision = None;
  let mut dry_run = false;
  let mut index = 2;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      "--expected-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(revision);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => {
        positionals.push(value.to_string());
        index += 1;
      }
    }
  }
  if !json {
    return Err(format!(
      "The axis {} {} command requires --json.",
      scope.unwrap(),
      action.unwrap()
    ));
  }
  if expected_revision.is_none() {
    return Err("The axis mutation command requires --expected-revision.".to_string());
  }
  let expected_positionals = match (scope, action) {
    (Some("shared"), Some("update")) => 2,
    (Some("shared"), Some("reset")) => 1,
    (Some("panel"), Some("update")) => 3,
    (Some("panel"), Some("reset")) => 2,
    _ => unreachable!("axis command was validated above"),
  };
  if positionals.len() != expected_positionals
    || positionals.iter().any(|value| value.trim().is_empty())
  {
    return Err(USAGE.to_string());
  }

  match (scope, action) {
    (Some("shared"), Some("update")) => Ok(ControlCommand::AxisSharedUpdate {
      kind: positionals[0].clone(),
      input: positionals[1].clone(),
      expected_revision,
      dry_run,
    }),
    (Some("shared"), Some("reset")) => Ok(ControlCommand::AxisSharedReset {
      kind: positionals[0].clone(),
      expected_revision,
      dry_run,
    }),
    (Some("panel"), Some("update")) => Ok(ControlCommand::AxisPanelUpdate {
      panel_id: positionals[0].clone(),
      kind: positionals[1].clone(),
      input: positionals[2].clone(),
      expected_revision,
      dry_run,
    }),
    (Some("panel"), Some("reset")) => Ok(ControlCommand::AxisPanelReset {
      panel_id: positionals[0].clone(),
      kind: positionals[1].clone(),
      expected_revision,
      dry_run,
    }),
    _ => unreachable!("axis command was validated above"),
  }
}

fn parse_preset_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  match args {
    [command, json] if command == "list" && json == "--json" => {
      return Ok(ControlCommand::PresetList);
    }
    [command, ..] if command == "list" => {
      return Err("The preset list command requires --json.".to_string());
    }
    _ => {}
  }
  const USAGE: &str = "Usage: plvs-cli preset <describe|save|apply|update|rename|delete|reorder|export|import> ... --json [--expected-revision <n>] [--dry-run]";
  let command = args
    .first()
    .map(String::as_str)
    .ok_or_else(|| USAGE.to_string())?;
  if !matches!(
    command,
    "describe"
      | "save"
      | "apply"
      | "update"
      | "rename"
      | "delete"
      | "reorder"
      | "export"
      | "import"
  ) {
    return Err(USAGE.to_string());
  }
  if command == "export" || command == "import" {
    return parse_library_args("preset", args);
  }
  let mut positionals = Vec::new();
  let mut expected_revision = None;
  let mut json = false;
  let mut dry_run = false;
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--expected-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(revision);
        index += 2;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => {
        positionals.push(value.to_string());
        index += 1;
      }
    }
  }
  if !json {
    return Err(format!("The preset {command} command requires --json."));
  }
  let expected_positionals = if command == "rename" { 2 } else { 1 };
  if positionals.len() != expected_positionals
    || positionals.iter().any(|value| value.trim().is_empty())
  {
    return Err(USAGE.to_string());
  }
  if command == "describe" && dry_run {
    return Err("The preset describe command does not accept --dry-run.".to_string());
  }
  if command == "describe" && expected_revision.is_some() {
    return Err("The preset describe command does not accept --expected-revision.".to_string());
  }
  if command != "describe" && expected_revision.is_none() {
    return Err(format!(
      "The preset {command} command requires --expected-revision."
    ));
  }
  Ok(match command {
    "describe" => ControlCommand::PresetDescribe {
      preset_id: positionals.remove(0),
    },
    "save" => ControlCommand::PresetSave {
      name: positionals.remove(0),
      expected_revision,
      dry_run,
    },
    "update" => ControlCommand::PresetUpdate {
      preset_id: positionals.remove(0),
      expected_revision,
      dry_run,
    },
    "apply" => ControlCommand::PresetApply {
      preset_id: positionals.remove(0),
      expected_revision,
      dry_run,
    },
    "rename" => ControlCommand::PresetRename {
      preset_id: positionals.remove(0),
      name: positionals.remove(0),
      expected_revision,
      dry_run,
    },
    "delete" => ControlCommand::PresetDelete {
      preset_id: positionals.remove(0),
      expected_revision,
      dry_run,
    },
    "reorder" => ControlCommand::PresetReorder {
      input: positionals.remove(0),
      expected_revision,
      dry_run,
    },
    _ => unreachable!("preset command was validated above"),
  })
}

fn parse_loudness_profile_args(args: &[String]) -> Result<ControlCommand, String> {
  let Some(action) = args.first().map(String::as_str) else {
    return Err("Usage: plvs-cli loudness-profile <list|describe|select|create|update|rename|delete|reorder|export|import> ... --json".to_string());
  };
  if matches!(action, "list" | "export" | "import") {
    return parse_library_args("loudnessProfile", args);
  }
  const USAGE: &str = "Usage: plvs-cli loudness-profile <describe|select|create|update|rename|delete|reorder> ... --json --expected-revision <n> [--dry-run]";
  if !matches!(
    action,
    "describe" | "select" | "create" | "update" | "rename" | "delete" | "reorder"
  ) {
    return Err(USAGE.to_string());
  }

  let mut positionals = Vec::new();
  let mut expected_revision = None;
  let mut dry_run = false;
  let mut json = false;
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      "--expected-revision" => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let parsed = value.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if parsed > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(parsed);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => {
        positionals.push(value.to_string());
        index += 1;
      }
    }
  }
  if !json {
    return Err(format!(
      "The loudness-profile {action} command requires --json."
    ));
  }
  let expected_positionals = if matches!(action, "update" | "rename") {
    2
  } else {
    1
  };
  if positionals.len() != expected_positionals
    || positionals.iter().any(|value| value.trim().is_empty())
  {
    return Err(USAGE.to_string());
  }
  if action == "describe" {
    if dry_run || expected_revision.is_some() {
      return Err(
        "The loudness-profile describe command does not accept mutation options.".to_string(),
      );
    }
    return Ok(ControlCommand::LoudnessProfileDescribe {
      profile_id: positionals.remove(0),
    });
  }
  if expected_revision.is_none() {
    return Err(format!(
      "The loudness-profile {action} command requires --expected-revision."
    ));
  }

  let (profile_id, name, input) = match action {
    "select" | "delete" => (Some(positionals.remove(0)), None, None),
    "create" | "reorder" => (None, None, Some(positionals.remove(0))),
    "update" => (
      Some(positionals.remove(0)),
      None,
      Some(positionals.remove(0)),
    ),
    "rename" => (
      Some(positionals.remove(0)),
      Some(positionals.remove(0)),
      None,
    ),
    _ => unreachable!("loudness-profile action was validated above"),
  };
  Ok(ControlCommand::LoudnessProfileMutation {
    method: format!("loudnessProfile.{action}"),
    profile_id,
    name,
    input,
    expected_revision,
    dry_run,
  })
}

fn parse_theme_args(args: &[String]) -> Result<ControlCommand, String> {
  let Some(action) = args.first().map(String::as_str) else {
    return Err("Usage: plvs-cli theme <list|inspect|describe|select|follow-system|create|update|rename|duplicate|delete|reorder|export|import> ... --json".to_string());
  };
  if matches!(action, "list" | "export" | "import") {
    return parse_library_args("theme", args);
  }
  const USAGE: &str = "Usage: plvs-cli theme <inspect|describe|select|follow-system|create|update|rename|duplicate|delete|reorder> ... --json --expected-revision <n> [--dry-run]";
  if !matches!(
    action,
    "inspect"
      | "describe"
      | "select"
      | "follow-system"
      | "create"
      | "update"
      | "rename"
      | "duplicate"
      | "delete"
      | "reorder"
  ) {
    return Err(USAGE.to_string());
  }

  let mut positionals = Vec::new();
  let mut expected_revision = None;
  let mut dry_run = false;
  let mut json = false;
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      "--expected-revision" => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let parsed = value.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if parsed > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(parsed);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => {
        positionals.push(value.to_string());
        index += 1;
      }
    }
  }
  if !json {
    return Err(format!("The theme {action} command requires --json."));
  }
  let expected_positionals = match action {
    "inspect" | "follow-system" => 0,
    "update" | "rename" | "duplicate" => 2,
    _ => 1,
  };
  if positionals.len() != expected_positionals
    || positionals.iter().any(|value| value.trim().is_empty())
  {
    return Err(USAGE.to_string());
  }
  if matches!(action, "inspect" | "describe") {
    if dry_run || expected_revision.is_some() {
      return Err(format!(
        "The theme {action} command does not accept mutation options."
      ));
    }
    return Ok(ControlCommand::ThemeRead {
      method: format!("theme.{action}"),
      theme_id: (action == "describe").then(|| positionals.remove(0)),
    });
  }
  if expected_revision.is_none() {
    return Err(format!(
      "The theme {action} command requires --expected-revision."
    ));
  }

  let wire_action = if action == "follow-system" {
    "followSystem"
  } else {
    action
  };
  let (theme_id, name, input) = match action {
    "follow-system" => (None, None, None),
    "select" | "delete" => (Some(positionals.remove(0)), None, None),
    "create" | "reorder" => (None, None, Some(positionals.remove(0))),
    "update" => (
      Some(positionals.remove(0)),
      None,
      Some(positionals.remove(0)),
    ),
    "rename" | "duplicate" => (
      Some(positionals.remove(0)),
      Some(positionals.remove(0)),
      None,
    ),
    _ => unreachable!("theme action was validated above"),
  };
  Ok(ControlCommand::ThemeMutation {
    method: format!("theme.{wire_action}"),
    theme_id,
    name,
    input,
    expected_revision,
    dry_run,
  })
}

/// One parser for all three libraries. The CLI family word is the caller's business (`theme`,
/// `loudness-profile`, `preset`); `family` here is already the wire name.
fn parse_library_args(family: &str, args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  // Every message a user reads names the word they typed, not the wire name: `loudnessProfile` is
  // not a command they can run.
  let label = if family == "loudnessProfile" {
    "loudness-profile"
  } else {
    family
  };
  let usage = format!("Usage: plvs-cli {label} <list|export|import> ... --json");
  let command = args
    .first()
    .map(String::as_str)
    .ok_or_else(|| usage.clone())?;
  if !matches!(command, "list" | "export" | "import") {
    return Err(usage);
  }

  let mut positionals = Vec::new();
  let mut json = false;
  let mut dry_run = false;
  let mut all = false;
  let mut ids: Option<Vec<String>> = None;
  let mut out = None;
  let mut expected_revision = None;
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      "--all" => {
        all = true;
        index += 1;
      }
      "--ids" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --ids.".to_string())?;
        let parsed: Vec<String> = raw
          .split(',')
          .map(str::trim)
          .filter(|value| !value.is_empty())
          .map(str::to_string)
          .collect();
        if parsed.is_empty() {
          return Err("The --ids value must list at least one id.".to_string());
        }
        ids = Some(parsed);
        index += 2;
      }
      "--out" => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --out.".to_string())?;
        out = Some(value.clone());
        index += 2;
      }
      "--expected-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(revision);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => {
        positionals.push(value.to_string());
        index += 1;
      }
    }
  }
  if !json {
    return Err(format!("The {label} {command} command requires --json."));
  }

  match command {
    "list" => {
      if !positionals.is_empty() || all || ids.is_some() || out.is_some() || dry_run {
        return Err(format!(
          "The {label} list command takes no options other than --json."
        ));
      }
      if expected_revision.is_some() {
        return Err(format!(
          "The {label} list command does not accept --expected-revision."
        ));
      }
      Ok(ControlCommand::LibraryList {
        family: family.to_string(),
      })
    }
    "export" => {
      if !positionals.is_empty() {
        return Err(format!(
          "The {label} export command takes no positional arguments."
        ));
      }
      // Export is a read: it cannot conflict, and there is nothing to preview.
      if expected_revision.is_some() || dry_run {
        return Err(format!(
          "The {label} export command does not accept --expected-revision or --dry-run."
        ));
      }
      if all == ids.is_some() {
        return Err("Pass exactly one of --all or --ids.".to_string());
      }
      Ok(ControlCommand::LibraryExport {
        family: family.to_string(),
        ids,
        out,
      })
    }
    _ => {
      if positionals.len() != 1 || positionals[0].trim().is_empty() {
        return Err(format!(
          "Usage: plvs-cli {label} import <file|-> --json --expected-revision <n> [--dry-run]"
        ));
      }
      if all || ids.is_some() || out.is_some() {
        return Err(format!(
          "The {label} import command does not accept --all, --ids or --out."
        ));
      }
      if expected_revision.is_none() {
        return Err(format!(
          "The {label} import command requires --expected-revision."
        ));
      }
      Ok(ControlCommand::LibraryImport {
        family: family.to_string(),
        input: positionals.remove(0),
        expected_revision,
        dry_run,
      })
    }
  }
}

fn is_help(value: &str) -> bool {
  matches!(value, "--help" | "-h" | "help")
}

fn base_help_text() -> &'static str {
  "PLVS CLI - Agent Control\n\nUsage:\n  plvs-cli capabilities --json\n  plvs-cli inspect --json\n  plvs-cli measurement describe --json\n  plvs-cli measurement inspect --json\n  plvs-cli workspace apply <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli panel describe <panel-id> --json\n  plvs-cli panel update <panel-id> <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli panel reset <panel-id> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli axis describe --json\n  plvs-cli axis inspect --json\n  plvs-cli axis shared update <frequency|time> <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli axis shared reset <frequency|time> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli axis panel update <panel-id> <frequency|time> <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli axis panel reset <panel-id> <frequency|time> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli preset list --json\n  plvs-cli preset describe <preset-id> --json\n  plvs-cli preset save <name> --json --expected-revision <n> [--dry-run]\n  plvs-cli preset update <preset-id> --json --expected-revision <n> [--dry-run]\n  plvs-cli preset apply <preset-id> --json --expected-revision <n> [--dry-run]\n  plvs-cli preset rename <preset-id> <name> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli preset delete <preset-id> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli preset reorder <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli preset export <--all|--ids <id,...>> --json [--out <file>]\n  plvs-cli preset import <file|-> --json --expected-revision <n> [--dry-run]\n  plvs-cli theme list --json\n  plvs-cli theme export <--all|--ids <id,...>> --json [--out <file>]\n  plvs-cli theme import <file|-> --json --expected-revision <n> [--dry-run]\n  plvs-cli loudness-profile list --json\n  plvs-cli loudness-profile export <--all|--ids <id,...>> --json [--out <file>]\n  plvs-cli loudness-profile import <file|-> --json --expected-revision <n> [--dry-run]\n  plvs-cli settings describe --json\n  plvs-cli settings inspect --json\n  plvs-cli settings update <file|-> --json [--expected-revision <n>] [--allow-measurement-restart] [--dry-run]\n  plvs-cli wait --after-revision <n> [--timeout-ms <n>] --json\n  plvs-cli transport inspect --json\n  plvs-cli transport source <live|file> --json [--expected-revision <n>] [--allow-stop-file-analysis] [--dry-run]\n  plvs-cli transport live <start|stop> --json [--expected-revision <n>] [--allow-stop-file-analysis]\n  plvs-cli transport live clear --json [--expected-revision <n>] [--dry-run]\n  plvs-cli transport file analyze <path> --json [--expected-revision <n>]\n  plvs-cli transport file <reanalyze|stop> <session-id> --json [--expected-revision <n>]\n  plvs-cli transport file <select|remove> <session-id> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli transport file clear --json [--expected-revision <n>] [--dry-run]\n\nControls the already-running PLVS GUI with the same app identity as this CLI through its authenticated local endpoint.\nUse - to read one JSON document from stdin. This command family requires Agent Control\nto be enabled in PLVS Settings; it does not launch PLVS and does not use PATH discovery.\n\nExit codes:\n  0  command completed successfully\n  1  the running app returned a valid command error\n  2  invalid input, discovery, authentication, or transport failure"
}

pub fn help_text() -> &'static str {
  static HELP: std::sync::OnceLock<String> = std::sync::OnceLock::new();
  HELP
    .get_or_init(|| {
      base_help_text().replacen(
        "\n\nControls the already-running",
        "\n  plvs-cli device list --json\n  plvs-cli device inspect --json\n  plvs-cli device select <device-id|default> --expected-revision <n> --expected-generation <n> --json [--allow-measurement-restart] [--dry-run]\n  plvs-cli dock describe --json\n  plvs-cli dock inspect --json\n  plvs-cli dock enter [--edge top|bottom] [--monitor <id>] [--reserve-space true|false] [--height <n>] --json [--expected-revision <n>] [--dry-run]\n  plvs-cli dock exit --json [--expected-revision <n>] [--dry-run]\n  plvs-cli dock layout apply <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli dock panel describe <panel-id> --json\n  plvs-cli dock panel update <panel-id> <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli dock panel reset <panel-id> --json [--expected-revision <n>] [--dry-run]\n\nControls the already-running",
        1,
      )
      .replacen(
        "\n  plvs-cli settings describe",
        "\n  plvs-cli config export --json [--out <file>]\n  plvs-cli config import <file|-> --expected-revision <n> --json [--dry-run]\n  plvs-cli settings describe",
        1,
      )
      .replacen(
        "\n  plvs-cli theme export",
        "\n  plvs-cli theme inspect --json\n  plvs-cli theme describe <theme-id> --json\n  plvs-cli theme select <theme-id> --expected-revision <n> --json [--dry-run]\n  plvs-cli theme follow-system --expected-revision <n> --json [--dry-run]\n  plvs-cli theme create <file|-> --expected-revision <n> --json [--dry-run]\n  plvs-cli theme update <theme-id> <file|-> --expected-revision <n> --json [--dry-run]\n  plvs-cli theme rename <theme-id> <name> --expected-revision <n> --json [--dry-run]\n  plvs-cli theme duplicate <theme-id> <name> --expected-revision <n> --json [--dry-run]\n  plvs-cli theme delete <theme-id> --expected-revision <n> --json [--dry-run]\n  plvs-cli theme reorder <file|-> --expected-revision <n> --json [--dry-run]\n  plvs-cli theme export",
        1,
      )
      .replacen(
        "\n  plvs-cli loudness-profile export",
        "\n  plvs-cli loudness-profile describe <profile-id> --json\n  plvs-cli loudness-profile select <profile-id|off> --expected-revision <n> --json [--dry-run]\n  plvs-cli loudness-profile create <file|-> --expected-revision <n> --json [--dry-run]\n  plvs-cli loudness-profile update <profile-id> <file|-> --expected-revision <n> --json [--dry-run]\n  plvs-cli loudness-profile rename <profile-id> <name> --expected-revision <n> --json [--dry-run]\n  plvs-cli loudness-profile delete <profile-id> --expected-revision <n> --json [--dry-run]\n  plvs-cli loudness-profile reorder <file|-> --expected-revision <n> --json [--dry-run]\n  plvs-cli loudness-profile export",
        1,
      )
      .replace("[--expected-revision <n>]", "--expected-revision <n>")
      .replace(
        "Exit codes:\n  0  command completed successfully\n  1  the running app returned a valid command error\n  2  invalid input, discovery, authentication, or transport failure",
        "Exit codes:\n  0  success\n  1  runtime or system failure\n  2  app unavailable for control\n  3  invalid command input\n  4  current state refuses the operation\n  5  wait did not complete",
      )
    })
    .as_str()
}

pub fn family_help_text(command: &str) -> String {
  let prefix = format!("  plvs-cli {command}");
  let usage = help_text()
    .lines()
    .filter(|line| line.starts_with(&prefix))
    .collect::<Vec<_>>()
    .join("\n");

  debug_assert!(!usage.is_empty(), "missing help lines for {command}");
  format!(
    "PLVS CLI - {command}\n\nUsage:\n{usage}\n\nAdd --json for stable machine-readable output. Use - to read one JSON document from stdin.\nRunning-app commands require Agent Control to be enabled and never launch PLVS.\nUse plvs-cli --help to list every command family."
  )
}

fn read_layout<R: Read>(input: &str, stdin: &mut R) -> Result<Value, String> {
  read_json_document(input, stdin, "layout")
}

fn read_json_document<R: Read>(input: &str, stdin: &mut R, subject: &str) -> Result<Value, String> {
  let mut bytes = Vec::new();
  if input == "-" {
    stdin
      .read_to_end(&mut bytes)
      .map_err(|error| format!("Unable to read {subject} JSON from stdin: {error}"))?;
  } else {
    bytes = fs::read(Path::new(input))
      .map_err(|error| format!("Unable to read {subject} JSON from {input}: {error}"))?;
  }
  let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
  serde_json::from_slice(bytes).map_err(|error| format!("Unable to parse {subject} JSON: {error}"))
}

#[derive(Debug, Clone)]
struct AppCall {
  app: DescriptorApp,
  response: Value,
}

trait ControlClient {
  fn call(&self, request: JsonRpcRequest) -> Result<AppCall, ControlFailure>;
}

struct LocalControlClient;

/// A discovery failure has several causes and they need different sentences. Only a missing
/// descriptor is ambiguous: it means either that the user never turned Agent Control on, or that
/// it is on and the app is closed, and an agent that cannot tell those apart sends the user to the
/// wrong fix. Every other kind is specific, and reporting it as a setting would hide a real fault
/// and point the user at a switch that is already on.
fn discovery_failure(error: &DiscoveryError, enabled: bool) -> ControlFailure {
  match error.kind {
    DiscoveryErrorKind::Missing if enabled => {
      ControlFailure::transport("appNotRunning", "PLVS is not running.".to_string(), None)
    }
    DiscoveryErrorKind::Missing => ControlFailure::transport(
      "agentControlDisabled",
      "Agent Control is disabled. Enable it in PLVS Settings.".to_string(),
      None,
    ),
    DiscoveryErrorKind::Stale => {
      ControlFailure::transport("appNotRunning", "PLVS is not running.".to_string(), None)
    }
    DiscoveryErrorKind::ProtocolMismatch => {
      ControlFailure::transport("protocolMismatch", error.to_string(), None)
    }
    DiscoveryErrorKind::Malformed | DiscoveryErrorKind::Unavailable | DiscoveryErrorKind::Io => {
      ControlFailure::transport("discoveryFailed", error.to_string(), None)
    }
  }
}

impl ControlClient for LocalControlClient {
  fn call(&self, request: JsonRpcRequest) -> Result<AppCall, ControlFailure> {
    let path = descriptor_path()
      .map_err(|error| ControlFailure::transport("appNotRunning", error.to_string(), None))?;
    let descriptor =
      read_descriptor_at(&path, env!("PLVS_APP_ID"), is_process_alive).map_err(|error| {
        discovery_failure(
          &error,
          crate::agent_control::toggle::read_enabled_from_disk(),
        )
      })?;
    call_descriptor(&descriptor, &request)
  }
}

#[cfg(target_os = "windows")]
fn call_descriptor(
  descriptor: &AgentControlDescriptor,
  request: &JsonRpcRequest,
) -> Result<AppCall, ControlFailure> {
  // The same budget the broker uses, plus a wider grace, so this end is always the last to give up
  // and the app's own answer is never replaced by a client-side timeout.
  let timeout = crate::agent_control::broker::frontend_budget(request)
    + crate::agent_control::broker::CLIENT_GRACE;
  let response = crate::agent_control::windows_pipe::call_with_timeout(
    &descriptor.endpoint,
    &descriptor.token,
    request,
    timeout,
  )
  .map_err(|error| {
    let (reason, message) = match error.reason {
      crate::agent_control::windows_pipe::PipeErrorReason::Unauthorized => {
        ("authenticationFailed", error.to_string())
      }
      crate::agent_control::windows_pipe::PipeErrorReason::ConnectionFailed => {
        ("appNotRunning", "PLVS is not running.".to_string())
      }
      crate::agent_control::windows_pipe::PipeErrorReason::IoTimeout => {
        ("timeout", error.to_string())
      }
      _ => ("transportFailed", error.to_string()),
    };
    ControlFailure::transport(reason, message, Some(descriptor.app.clone()))
  })?;
  Ok(AppCall {
    app: descriptor.app.clone(),
    response,
  })
}

#[cfg(not(target_os = "windows"))]
fn call_descriptor(
  descriptor: &AgentControlDescriptor,
  _request: &JsonRpcRequest,
) -> Result<AppCall, ControlFailure> {
  Err(ControlFailure::transport(
    "transportUnavailable",
    "Live app control is currently available only on Windows.",
    Some(descriptor.app.clone()),
  ))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlError {
  code: String,
  message: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  details: Option<Value>,
}

#[derive(Debug, Clone)]
struct ControlFailure {
  error: Box<ControlError>,
  exit_code: u8,
}

impl ControlFailure {
  fn transport(code: &str, message: impl Into<String>, _app: Option<DescriptorApp>) -> Self {
    Self {
      error: Box::new(ControlError {
        code: code.to_string(),
        message: message.into(),
        details: None,
      }),
      exit_code: 2,
    }
  }

  fn invalid_arguments(message: impl Into<String>) -> Self {
    Self {
      error: Box::new(ControlError {
        code: "invalidArguments".to_string(),
        message: message.into(),
        details: None,
      }),
      exit_code: 3,
    }
  }

  fn application(_app: DescriptorApp, error: ControlError, rpc_error_code: Option<i64>) -> Self {
    let exit_code = match (rpc_error_code, error.code.as_str()) {
      (Some(-32602), _)
      | (
        _,
        "revisionRequired"
        | "resourceNotFound"
        | "panelNotFound"
        | "axisNotFound"
        | "presetNotFound"
        | "themeNotFound"
        | "loudnessProfileNotFound"
        | "deviceNotFound"
        | "invalidProfile"
        | "invalidPermutation"
        | "fileSessionNotFound"
        | "dockPanelNotFound"
        | "monitorNotFound",
      ) => 3,
      (
        _,
        "revisionConflict"
        | "editorActive"
        | "busy"
        | "operationNotAllowed"
        | "waitLimitReached"
        | "controlUnavailable"
        | "controlsUnavailable"
        | "axisUnavailable"
        | "transitionInProgress"
        | "analysisInProgress"
        | "dockActive"
        | "fileModeActive"
        | "fileAnalysisNotActive"
        | "confirmationRequired"
        | "channelConfigurationChanged"
        | "deviceInventoryChanged"
        | "deviceUnavailable",
      ) => 4,
      (_, "timeout" | "cancelled") => 5,
      _ => 1,
    };
    Self {
      error: Box::new(error),
      exit_code,
    }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlReport {
  schema_version: u32,
  ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  result: Option<Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<ControlError>,
}

fn command_name(command: &ControlCommand) -> String {
  match command {
    ControlCommand::Help | ControlCommand::FamilyHelp(_) => {
      unreachable!("help does not have a wire method")
    }
    ControlCommand::Capabilities => "app.capabilities".to_string(),
    ControlCommand::Inspect => "app.inspect".to_string(),
    ControlCommand::MeasurementRead { method } => method.clone(),
    ControlCommand::PanelDescribe { .. } => "panel.describe".to_string(),
    ControlCommand::WorkspaceApply { .. } => "workspace.applyLayout".to_string(),
    ControlCommand::PanelUpdate { .. } => "panel.update".to_string(),
    ControlCommand::PanelReset { .. } => "panel.reset".to_string(),
    ControlCommand::AxisDescribe => "axis.describe".to_string(),
    ControlCommand::AxisInspect => "axis.inspect".to_string(),
    ControlCommand::AxisSharedUpdate { .. } => "axis.shared.update".to_string(),
    ControlCommand::AxisSharedReset { .. } => "axis.shared.reset".to_string(),
    ControlCommand::AxisPanelUpdate { .. } => "axis.panel.update".to_string(),
    ControlCommand::AxisPanelReset { .. } => "axis.panel.reset".to_string(),
    ControlCommand::PresetList => "preset.list".to_string(),
    ControlCommand::PresetDescribe { .. } => "preset.describe".to_string(),
    ControlCommand::PresetSave { .. } => "preset.save".to_string(),
    ControlCommand::PresetUpdate { .. } => "preset.update".to_string(),
    ControlCommand::PresetApply { .. } => "preset.apply".to_string(),
    ControlCommand::PresetRename { .. } => "preset.rename".to_string(),
    ControlCommand::PresetDelete { .. } => "preset.delete".to_string(),
    ControlCommand::PresetReorder { .. } => "preset.reorder".to_string(),
    ControlCommand::LibraryList { family } => format!("{family}.list"),
    ControlCommand::LibraryExport { family, .. } => format!("{family}.export"),
    ControlCommand::LibraryImport { family, .. } => format!("{family}.import"),
    ControlCommand::ThemeRead { method, .. } | ControlCommand::ThemeMutation { method, .. } => {
      method.clone()
    }
    ControlCommand::LoudnessProfileDescribe { .. } => "loudnessProfile.describe".to_string(),
    ControlCommand::LoudnessProfileMutation { method, .. } => method.clone(),
    ControlCommand::ConfigExport { .. } => "config.export".to_string(),
    ControlCommand::ConfigImport { .. } => "config.import".to_string(),
    ControlCommand::SettingsDescribe => "settings.describe".to_string(),
    ControlCommand::SettingsInspect => "settings.inspect".to_string(),
    ControlCommand::DeviceRead { method } => method.clone(),
    ControlCommand::DeviceSelect { .. } => "device.select".to_string(),
    ControlCommand::TransportInspect => "transport.inspect".to_string(),
    ControlCommand::TransportMutation { method, .. } => method.clone(),
    ControlCommand::DockRead { method } | ControlCommand::DockCommand { method, .. } => {
      method.clone()
    }
    ControlCommand::SettingsUpdate { .. } => "settings.update".to_string(),
    ControlCommand::Wait { .. } => "app.wait".to_string(),
  }
}

fn mutation_params<const N: usize>(
  fields: [(&str, Value); N],
  expected_revision: Option<u64>,
  dry_run: bool,
) -> Value {
  let mut params = serde_json::Map::from_iter(
    fields
      .into_iter()
      .map(|(key, value)| (key.to_string(), value)),
  );
  params.insert("dryRun".to_string(), Value::Bool(dry_run));
  if let Some(revision) = expected_revision {
    params.insert("expectedRevision".to_string(), Value::from(revision));
  }
  Value::Object(params)
}

fn request_for_command<R: Read>(
  command: &ControlCommand,
  stdin: &mut R,
) -> Result<JsonRpcRequest, ControlFailure> {
  let method = command_name(command);
  let params = match command {
    ControlCommand::Capabilities
    | ControlCommand::Inspect
    | ControlCommand::MeasurementRead { .. }
    | ControlCommand::AxisDescribe
    | ControlCommand::AxisInspect
    | ControlCommand::PresetList
    | ControlCommand::LibraryList { .. }
    | ControlCommand::ConfigExport { .. }
    | ControlCommand::SettingsDescribe
    | ControlCommand::SettingsInspect
    | ControlCommand::DeviceRead { .. }
    | ControlCommand::TransportInspect => serde_json::json!({}),
    ControlCommand::ThemeRead { theme_id, .. } => match theme_id {
      Some(theme_id) => serde_json::json!({ "themeId": theme_id }),
      None => serde_json::json!({}),
    },
    ControlCommand::ThemeMutation {
      method,
      theme_id,
      name,
      input,
      expected_revision,
      dry_run,
    } => {
      let mut params = serde_json::Map::new();
      if let Some(theme_id) = theme_id {
        params.insert("themeId".to_string(), Value::String(theme_id.clone()));
      }
      if let Some(name) = name {
        params.insert("name".to_string(), Value::String(name.clone()));
      }
      if let Some(input) = input {
        let document = read_json_document(
          input,
          stdin,
          if method == "theme.reorder" {
            "Theme order"
          } else {
            "Theme document"
          },
        )
        .map_err(ControlFailure::invalid_arguments)?;
        if method == "theme.reorder" {
          if !document.is_array() {
            return Err(ControlFailure::invalid_arguments(
              "Theme order JSON must be an array of Theme IDs.",
            ));
          }
          params.insert("themeIds".to_string(), document);
        } else {
          params.insert("document".to_string(), document);
        }
      }
      params.insert("dryRun".to_string(), Value::Bool(*dry_run));
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
      Value::Object(params)
    }
    ControlCommand::LoudnessProfileDescribe { profile_id } => {
      serde_json::json!({ "profileId": profile_id })
    }
    ControlCommand::LoudnessProfileMutation {
      method,
      profile_id,
      name,
      input,
      expected_revision,
      dry_run,
    } => {
      let mut params = serde_json::Map::new();
      if let Some(profile_id) = profile_id {
        params.insert("profileId".to_string(), Value::String(profile_id.clone()));
      }
      if let Some(name) = name {
        params.insert("name".to_string(), Value::String(name.clone()));
      }
      if let Some(input) = input {
        let document = read_json_document(
          input,
          stdin,
          if method == "loudnessProfile.reorder" {
            "Loudness Profile order"
          } else {
            "Loudness Profile document"
          },
        )
        .map_err(ControlFailure::invalid_arguments)?;
        if method == "loudnessProfile.reorder" {
          if !document.is_array() {
            return Err(ControlFailure::invalid_arguments(
              "Loudness Profile order JSON must be an array of Profile IDs.",
            ));
          }
          params.insert("profileIds".to_string(), document);
        } else {
          params.insert("document".to_string(), document);
        }
      }
      params.insert("dryRun".to_string(), Value::Bool(*dry_run));
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
      Value::Object(params)
    }
    ControlCommand::ConfigImport {
      input,
      expected_revision,
      dry_run,
    } => {
      let configuration = read_json_document(input, stdin, "configuration")
        .map_err(ControlFailure::invalid_arguments)?;
      mutation_params(
        [("configuration", configuration)],
        *expected_revision,
        *dry_run,
      )
    }
    ControlCommand::DockRead { .. } => serde_json::json!({}),
    ControlCommand::DockCommand {
      method,
      panel_id,
      input,
      edge,
      monitor,
      reserve_space,
      height,
      expected_revision,
      dry_run,
    } => {
      let mut params = serde_json::Map::new();
      if let Some(panel_id) = panel_id {
        params.insert("panelId".to_string(), Value::String(panel_id.clone()));
      }
      if let Some(input) = input {
        let subject = if method == "dock.layout.apply" {
          "Dock layout"
        } else {
          "Dock panel controls"
        };
        let document =
          read_json_document(input, stdin, subject).map_err(ControlFailure::invalid_arguments)?;
        params.insert(
          if method == "dock.layout.apply" {
            "layout"
          } else {
            "patch"
          }
          .to_string(),
          document,
        );
      }
      if let Some(value) = edge {
        params.insert("edge".to_string(), Value::String(value.clone()));
      }
      if let Some(value) = monitor {
        params.insert("monitor".to_string(), Value::String(value.clone()));
      }
      if let Some(value) = reserve_space {
        params.insert("reserveSpace".to_string(), Value::Bool(*value));
      }
      if let Some(value) = height {
        params.insert("height".to_string(), Value::from(*value));
      }
      if method != "dock.panel.describe" {
        params.insert("dryRun".to_string(), Value::Bool(*dry_run));
        if let Some(revision) = expected_revision {
          params.insert("expectedRevision".to_string(), Value::from(*revision));
        }
      }
      Value::Object(params)
    }
    ControlCommand::TransportMutation {
      method,
      target_key,
      target,
      expected_revision,
      allow_stop_file_analysis,
      dry_run,
    } => {
      let mut params = serde_json::Map::new();
      if let (Some(key), Some(value)) = (target_key, target) {
        let value = if method == "transport.file.analyze" {
          let canonical = fs::canonicalize(Path::new(value)).map_err(|error| {
            ControlFailure::invalid_arguments(format!(
              "Unable to resolve audio path {value}: {error}"
            ))
          })?;
          Value::String(canonical.to_string_lossy().into_owned())
        } else {
          Value::String(value.clone())
        };
        params.insert(key.clone(), value);
      }
      if !is_transport_action(method) {
        params.insert("dryRun".to_string(), Value::Bool(*dry_run));
      }
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
      if *allow_stop_file_analysis {
        params.insert("allowStopFileAnalysis".to_string(), Value::Bool(true));
      }
      Value::Object(params)
    }
    ControlCommand::DeviceSelect {
      device_id,
      expected_revision,
      expected_generation,
      allow_measurement_restart,
      dry_run,
    } => {
      let mut params = serde_json::Map::from_iter([
        ("deviceId".to_string(), Value::String(device_id.clone())),
        ("dryRun".to_string(), Value::Bool(*dry_run)),
        (
          "allowMeasurementRestart".to_string(),
          Value::Bool(*allow_measurement_restart),
        ),
      ]);
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
      if let Some(generation) = expected_generation {
        params.insert("expectedGeneration".to_string(), Value::from(*generation));
      }
      Value::Object(params)
    }
    ControlCommand::PresetDescribe { preset_id } => {
      serde_json::json!({ "presetId": preset_id })
    }
    ControlCommand::PresetSave {
      name,
      expected_revision,
      dry_run,
    } => mutation_params(
      [("name", Value::String(name.clone()))],
      *expected_revision,
      *dry_run,
    ),
    ControlCommand::PresetUpdate {
      preset_id,
      expected_revision,
      dry_run,
    } => mutation_params(
      [("presetId", Value::String(preset_id.clone()))],
      *expected_revision,
      *dry_run,
    ),
    ControlCommand::PresetApply {
      preset_id,
      expected_revision,
      dry_run,
    } => mutation_params(
      [("presetId", Value::String(preset_id.clone()))],
      *expected_revision,
      *dry_run,
    ),
    ControlCommand::PresetRename {
      preset_id,
      name,
      expected_revision,
      dry_run,
    } => mutation_params(
      [
        ("presetId", Value::String(preset_id.clone())),
        ("name", Value::String(name.clone())),
      ],
      *expected_revision,
      *dry_run,
    ),
    ControlCommand::PresetDelete {
      preset_id,
      expected_revision,
      dry_run,
    } => mutation_params(
      [("presetId", Value::String(preset_id.clone()))],
      *expected_revision,
      *dry_run,
    ),
    ControlCommand::PresetReorder {
      input,
      expected_revision,
      dry_run,
    } => {
      let document = read_json_document(input, stdin, "preset order")
        .map_err(ControlFailure::invalid_arguments)?;
      let preset_ids = document
        .as_object()
        .and_then(|object| object.get("presetIds"))
        .cloned()
        .ok_or_else(|| {
          ControlFailure::invalid_arguments(
            "Preset order JSON must be an object containing presetIds.",
          )
        })?;
      mutation_params([("presetIds", preset_ids)], *expected_revision, *dry_run)
    }
    // A whole-library export omits `ids` entirely: the frontend reads an absent `ids` as the whole
    // library and rejects any value that is not a non-empty array of ids.
    ControlCommand::LibraryExport { ids, .. } => match ids {
      Some(values) => serde_json::json!({ "ids": values }),
      None => serde_json::json!({}),
    },
    ControlCommand::LibraryImport {
      input,
      expected_revision,
      dry_run,
      ..
    } => {
      let pack = read_json_document(input, stdin, "library pack")
        .map_err(ControlFailure::invalid_arguments)?;
      mutation_params([("pack", pack)], *expected_revision, *dry_run)
    }
    ControlCommand::SettingsUpdate {
      input,
      expected_revision,
      allow_measurement_restart,
      dry_run,
    } => {
      let patch = read_json_document(input, stdin, "Settings patch")
        .map_err(ControlFailure::invalid_arguments)?;
      let mut params = serde_json::Map::from_iter([
        ("patch".to_string(), patch),
        ("dryRun".to_string(), Value::Bool(*dry_run)),
        (
          "allowMeasurementRestart".to_string(),
          Value::Bool(*allow_measurement_restart),
        ),
      ]);
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
      Value::Object(params)
    }
    ControlCommand::Wait {
      after_revision,
      timeout_ms,
    } => serde_json::json!({ "afterRevision": after_revision, "timeoutMs": timeout_ms }),
    ControlCommand::PanelDescribe { panel_id } => {
      serde_json::json!({ "panelId": panel_id })
    }
    ControlCommand::WorkspaceApply {
      input,
      expected_revision,
      dry_run,
    } => {
      let layout = read_layout(input, stdin).map_err(ControlFailure::invalid_arguments)?;
      let mut params = serde_json::Map::from_iter([
        ("layout".to_string(), layout),
        ("dryRun".to_string(), Value::Bool(*dry_run)),
      ]);
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
      Value::Object(params)
    }
    ControlCommand::PanelUpdate {
      panel_id,
      input,
      expected_revision,
      dry_run,
    } => {
      let patch = read_json_document(input, stdin, "panel controls")
        .map_err(ControlFailure::invalid_arguments)?;
      let mut params = serde_json::Map::from_iter([
        ("panelId".to_string(), Value::String(panel_id.clone())),
        ("patch".to_string(), patch),
        ("dryRun".to_string(), Value::Bool(*dry_run)),
      ]);
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
      Value::Object(params)
    }
    ControlCommand::PanelReset {
      panel_id,
      expected_revision,
      dry_run,
    } => {
      let mut params = serde_json::Map::from_iter([
        ("panelId".to_string(), Value::String(panel_id.clone())),
        ("dryRun".to_string(), Value::Bool(*dry_run)),
      ]);
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
      Value::Object(params)
    }
    ControlCommand::AxisSharedUpdate {
      kind,
      input,
      expected_revision,
      dry_run,
    } => {
      let range = read_json_document(input, stdin, "axis range")
        .map_err(ControlFailure::invalid_arguments)?;
      mutation_params(
        [("kind", Value::String(kind.clone())), ("range", range)],
        *expected_revision,
        *dry_run,
      )
    }
    ControlCommand::AxisSharedReset {
      kind,
      expected_revision,
      dry_run,
    } => mutation_params(
      [("kind", Value::String(kind.clone()))],
      *expected_revision,
      *dry_run,
    ),
    ControlCommand::AxisPanelUpdate {
      panel_id,
      kind,
      input,
      expected_revision,
      dry_run,
    } => {
      let patch = read_json_document(input, stdin, "panel axis")
        .map_err(ControlFailure::invalid_arguments)?;
      mutation_params(
        [
          ("panelId", Value::String(panel_id.clone())),
          ("kind", Value::String(kind.clone())),
          ("patch", patch),
        ],
        *expected_revision,
        *dry_run,
      )
    }
    ControlCommand::AxisPanelReset {
      panel_id,
      kind,
      expected_revision,
      dry_run,
    } => mutation_params(
      [
        ("panelId", Value::String(panel_id.clone())),
        ("kind", Value::String(kind.clone())),
      ],
      *expected_revision,
      *dry_run,
    ),
    ControlCommand::Help | ControlCommand::FamilyHelp(_) => {
      unreachable!("help does not create a request")
    }
  };
  Ok(JsonRpcRequest {
    id: format!(
      "cli-{}-{}",
      std::process::id(),
      REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ),
    method,
    params,
  })
}

/// Flattens the JSON-RPC error payload into the reported `details`.
///
/// The payload nests the real details one level down and repeats the reason that the report
/// already carries at the top level, so a caller had to read `error.details.details.issues` to
/// reach what the contract documents as `error.details.issues`. Keep `path`, which says which part
/// of the request was rejected, and let a detail of the same name win.
fn public_error_details(data: &Value) -> Option<Value> {
  let mut merged = serde_json::Map::new();
  if let Some(path) = data.get("path").and_then(Value::as_str) {
    merged.insert("path".to_string(), Value::from(path));
  }
  if let Some(Value::Object(details)) = data.get("details") {
    for (key, value) in details {
      merged.insert(key.clone(), value.clone());
    }
  }
  if merged.is_empty() {
    return None;
  }
  Some(Value::Object(merged))
}

fn execute<R: Read>(
  command: &ControlCommand,
  stdin: &mut R,
  client: &dyn ControlClient,
) -> (ControlReport, u8) {
  let request = match request_for_command(command, stdin) {
    Ok(request) => request,
    Err(failure) => return (failure_report(failure.clone()), failure.exit_code),
  };
  let request_id = request.id.clone();
  match client.call(request) {
    Ok(call) => {
      // An empty id means PLVS failed before it could attribute the failure to this request (a
      // frame it could not parse or authenticate). That is still a real error with a real reason,
      // so report what it sent. Any other mismatch is a reply to somebody else's request.
      let id = call.response.get("id").and_then(Value::as_str);
      let attributed = id == Some(request_id.as_str());
      if call.response.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || !(attributed || id == Some(""))
      {
        let failure = ControlFailure::transport(
          "transportFailed",
          "PLVS returned a malformed or mismatched JSON-RPC response.",
          Some(call.app),
        );
        return (failure_report(failure), 2);
      }
      if let Some(result) = call.response.get("result") {
        let mut result = result.clone();
        if command == &ControlCommand::Capabilities {
          if let Value::Object(fields) = &mut result {
            fields.insert(
              "cliVersion".to_string(),
              Value::String(env!("CARGO_PKG_VERSION").to_string()),
            );
          }
        }
        return (
          ControlReport {
            schema_version: CLI_SCHEMA_VERSION,
            ok: true,
            result: Some(result),
            error: None,
          },
          0,
        );
      }
      let rpc_error = call.response.get("error").cloned().unwrap_or(Value::Null);
      let reason = rpc_error
        .pointer("/data/reason")
        .and_then(Value::as_str)
        .unwrap_or("commandFailed");
      // Exit 1 is reserved for a valid app result. A failure tagged `transport` never reached the
      // application at all — it is the broker, the pipe, or the envelope — so it exits 2 while
      // keeping the reason PLVS actually reported.
      if rpc_error.pointer("/data/layer").and_then(Value::as_str) == Some("transport") {
        let message = rpc_error
          .get("message")
          .and_then(Value::as_str)
          .unwrap_or("PLVS could not deliver the command.");
        let failure = if reason == "unauthorized" {
          ControlFailure::transport("authenticationFailed", message, Some(call.app))
        } else {
          ControlFailure::transport(reason, message, Some(call.app))
        };
        return (failure_report(failure), 2);
      }
      let error = ControlError {
        code: if reason == "invalidParams" {
          "invalidArguments"
        } else {
          reason
        }
        .to_string(),
        message: rpc_error
          .get("message")
          .and_then(Value::as_str)
          .unwrap_or("PLVS rejected the command.")
          .to_string(),
        details: public_error_details(rpc_error.get("data").unwrap_or(&Value::Null)),
      };
      let failure = ControlFailure::application(
        call.app,
        error,
        rpc_error.get("code").and_then(Value::as_i64),
      );
      let exit_code = failure.exit_code;
      (failure_report(failure), exit_code)
    }
    Err(failure) => {
      let exit_code = failure.exit_code;
      (failure_report(failure), exit_code)
    }
  }
}

fn failure_report(failure: ControlFailure) -> ControlReport {
  ControlReport {
    schema_version: CLI_SCHEMA_VERSION,
    ok: false,
    result: None,
    error: Some(*failure.error),
  }
}

/// Moves one exported document out of the envelope and onto disk, leaving `result.out` behind. The
/// document and `out` never appear together, so a script can tell which it got without inspecting
/// sizes.
fn write_export_file(
  report: &mut ControlReport,
  path: &str,
  field: &str,
  subject: &str,
) -> Result<(), String> {
  let Some(result) = report.result.as_mut().and_then(Value::as_object_mut) else {
    return Ok(());
  };
  let Some(document) = result.get(field) else {
    return Ok(());
  };
  let contents = format!(
    "{}\n",
    serde_json::to_string_pretty(document)
      .map_err(|error| format!("Unable to serialize {subject}: {error}"))?
  );
  // The swap happens only once the bytes are on disk. Taking the document out first loses the
  // export entirely on a write failure: no file, and an exit-1 envelope with no recoverable copy.
  fs::write(Path::new(path), contents)
    .map_err(|error| format!("Unable to write the {subject} to {path}: {error}"))?;
  result.remove(field);
  result.insert("out".to_string(), Value::String(path.to_string()));
  Ok(())
}

#[cfg(test)]
fn write_pack_file(report: &mut ControlReport, path: &str) -> Result<(), String> {
  write_export_file(report, path, "pack", "pack")
}

/// The `--out` half of an export, kept out of `run` so it can be tested without a live app.
fn finish_export(command: &ControlCommand, report: &mut ControlReport, exit_code: u8) -> u8 {
  let (path, field, subject) = match command {
    ControlCommand::LibraryExport {
      out: Some(path), ..
    } => (path, "pack", "pack"),
    ControlCommand::ConfigExport { out: Some(path) } => (path, "configuration", "configuration"),
    _ => return exit_code,
  };
  match write_export_file(report, path, field, subject) {
    Ok(()) => exit_code,
    Err(failure) => {
      eprintln!("{failure}");
      // 1, not 2: the app answered and the pack is in hand, so this is a local write failure, which
      // `docs/cli.md`'s exit-code table lists under 1. Reporting 2 would tell a script the app is
      // unreachable and send it into a retry that a full disk cannot satisfy.
      1
    }
  }
}

pub fn run(command: ControlCommand) -> ExitCode {
  match &command {
    ControlCommand::Help => {
      println!("{}", help_text());
      return ExitCode::SUCCESS;
    }
    ControlCommand::FamilyHelp(family) => {
      println!("{}", family_help_text(family));
      return ExitCode::SUCCESS;
    }
    _ => {}
  }
  let (mut report, exit_code) = execute(&command, &mut io::stdin().lock(), &LocalControlClient);
  let exit_code = finish_export(&command, &mut report, exit_code);
  match serde_json::to_string(&report) {
    Ok(json) => println!("{json}"),
    Err(error) => {
      eprintln!("Unable to serialize app-control report: {error}");
      return ExitCode::from(2);
    }
  }
  ExitCode::from(exit_code)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Cursor;

  fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
  }

  #[test]
  fn parses_read_commands_and_requires_json() {
    assert_eq!(
      parse_control_args(&args(&["capabilities", "--json"])),
      Ok(ControlCommand::Capabilities)
    );
    assert_eq!(
      parse_control_args(&args(&["inspect", "--json"])),
      Ok(ControlCommand::Inspect)
    );
    assert!(parse_control_args(&args(&["inspect"])).is_err());
  }

  #[test]
  fn parses_measurement_queries_and_rejects_every_extra_option() {
    assert_eq!(
      parse_control_args(&args(&["measurement", "describe", "--json"])),
      Ok(ControlCommand::MeasurementRead {
        method: "measurement.describe".to_string(),
      })
    );
    assert_eq!(
      parse_control_args(&args(&["measurement", "inspect", "--json"])),
      Ok(ControlCommand::MeasurementRead {
        method: "measurement.inspect".to_string(),
      })
    );
    for invalid in [
      args(&["measurement", "inspect"]),
      args(&["measurement", "inspect", "--json", "--source", "file"]),
      args(&["measurement", "inspect", "--json", "--dry-run"]),
      args(&[
        "measurement",
        "inspect",
        "--json",
        "--expected-revision",
        "1",
      ]),
      args(&["measurement", "wait", "--json"]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }

  #[test]
  fn measurement_help_and_requests_use_the_public_wire_methods() {
    let help = family_help_text("measurement");
    assert!(help.contains("plvs-cli measurement describe --json"));
    assert!(help.contains("plvs-cli measurement inspect --json"));

    for (action, method) in [
      ("describe", "measurement.describe"),
      ("inspect", "measurement.inspect"),
    ] {
      let command = parse_control_args(&args(&["measurement", action, "--json"])).unwrap();
      let request = request_for_command(&command, &mut Cursor::new(Vec::<u8>::new())).unwrap();
      assert_eq!(request.method, method);
      assert_eq!(request.params, serde_json::json!({}));
    }
  }

  #[test]
  fn parses_workspace_apply_and_rejects_unsafe_or_ambiguous_input() {
    assert_eq!(
      parse_control_args(&args(&[
        "workspace",
        "apply",
        "layout.json",
        "--json",
        "--expected-revision",
        "42",
        "--dry-run"
      ])),
      Ok(ControlCommand::WorkspaceApply {
        input: "layout.json".to_string(),
        expected_revision: Some(42),
        dry_run: true,
      })
    );
    for invalid in [
      args(&["workspace", "apply", "--json"]),
      args(&["workspace", "apply", "a.json", "b.json", "--json"]),
      args(&[
        "workspace",
        "apply",
        "-",
        "--expected-revision",
        "-1",
        "--json",
      ]),
      args(&[
        "workspace",
        "apply",
        "-",
        "--expected-revision",
        "9007199254740992",
        "--json",
      ]),
      args(&["workspace", "apply", "-", "--bogus", "--json"]),
      args(&["workspace", "apply", "-"]),
    ] {
      assert!(parse_control_args(&invalid).is_err());
    }
  }

  #[test]
  fn parses_panel_update_and_its_concurrency_options() {
    assert_eq!(
      parse_control_args(&args(&[
        "panel",
        "update",
        "levelMeter",
        "controls.json",
        "--json",
        "--expected-revision",
        "7",
        "--dry-run"
      ])),
      Ok(ControlCommand::PanelUpdate {
        panel_id: "levelMeter".to_string(),
        input: "controls.json".to_string(),
        expected_revision: Some(7),
        dry_run: true,
      })
    );
    for invalid in [
      args(&["panel", "update", "levelMeter", "--json"]),
      args(&[
        "panel",
        "update",
        "levelMeter",
        "a.json",
        "b.json",
        "--json",
      ]),
      args(&["panel", "update", "levelMeter", "-", "--bogus", "--json"]),
      args(&["panel", "update", "levelMeter", "-"]),
    ] {
      assert!(parse_control_args(&invalid).is_err());
    }
  }

  #[test]
  fn builds_panel_update_request_from_stdin() {
    let command = ControlCommand::PanelUpdate {
      panel_id: "levelMeter".to_string(),
      input: "-".to_string(),
      expected_revision: Some(7),
      dry_run: true,
    };
    let request = request_for_command(
      &command,
      &mut Cursor::new(br#"{"mode":"rms","playbackMax":true}"#),
    )
    .unwrap();

    assert_eq!(request.method, "panel.update");
    assert_eq!(request.params["panelId"], "levelMeter");
    assert_eq!(request.params["patch"]["mode"], "rms");
    assert_eq!(request.params["expectedRevision"], 7);
    assert_eq!(request.params["dryRun"], true);
  }

  #[test]
  fn parses_panel_reset_and_its_concurrency_options() {
    assert_eq!(
      parse_control_args(&args(&[
        "panel",
        "reset",
        "spectrum",
        "--json",
        "--expected-revision",
        "8",
        "--dry-run"
      ])),
      Ok(ControlCommand::PanelReset {
        panel_id: "spectrum".to_string(),
        expected_revision: Some(8),
        dry_run: true,
      })
    );
    for invalid in [
      args(&["panel", "reset", "--json"]),
      args(&["panel", "reset", "spectrum", "extra", "--json"]),
      args(&["panel", "reset", "spectrum", "--bogus", "--json"]),
      args(&["panel", "reset", "spectrum"]),
    ] {
      assert!(parse_control_args(&invalid).is_err());
    }
  }

  #[test]
  fn builds_panel_reset_request_without_an_input_document() {
    let command = ControlCommand::PanelReset {
      panel_id: "spectrum".to_string(),
      expected_revision: Some(8),
      dry_run: true,
    };
    let request = request_for_command(&command, &mut Cursor::new([])).unwrap();

    assert_eq!(request.method, "panel.reset");
    assert_eq!(request.params["panelId"], "spectrum");
    assert_eq!(request.params["expectedRevision"], 8);
    assert_eq!(request.params["dryRun"], true);
    assert!(request.params.get("patch").is_none());
  }

  #[test]
  fn parses_and_builds_panel_describe() {
    let command = parse_control_args(&args(&["panel", "describe", "spectrum", "--json"])).unwrap();
    assert_eq!(
      command,
      ControlCommand::PanelDescribe {
        panel_id: "spectrum".to_string(),
      }
    );
    let request = request_for_command(&command, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "panel.describe");
    assert_eq!(request.params, serde_json::json!({ "panelId": "spectrum" }));

    for invalid in [
      args(&["panel", "describe", "--json"]),
      args(&["panel", "describe", "spectrum"]),
      args(&["panel", "describe", "spectrum", "--dry-run", "--json"]),
      args(&[
        "panel",
        "describe",
        "spectrum",
        "--expected-revision",
        "1",
        "--json",
      ]),
    ] {
      assert!(parse_control_args(&invalid).is_err());
    }
  }

  #[test]
  fn parses_axis_read_and_mutation_commands() {
    assert_eq!(
      parse_control_args(&args(&["axis", "describe", "--json"])),
      Ok(ControlCommand::AxisDescribe)
    );
    assert_eq!(
      parse_control_args(&args(&["axis", "inspect", "--json"])),
      Ok(ControlCommand::AxisInspect)
    );
    assert_eq!(
      parse_control_args(&args(&[
        "axis",
        "shared",
        "update",
        "frequency",
        "range.json",
        "--json",
        "--expected-revision",
        "3",
        "--dry-run",
      ])),
      Ok(ControlCommand::AxisSharedUpdate {
        kind: "frequency".to_string(),
        input: "range.json".to_string(),
        expected_revision: Some(3),
        dry_run: true,
      })
    );
    assert_eq!(
      parse_control_args(&args(&[
        "axis",
        "shared",
        "reset",
        "time",
        "--json",
        "--expected-revision",
        "3",
      ])),
      Ok(ControlCommand::AxisSharedReset {
        kind: "time".to_string(),
        expected_revision: Some(3),
        dry_run: false,
      })
    );
    assert_eq!(
      parse_control_args(&args(&[
        "axis",
        "panel",
        "update",
        "spectrum",
        "frequency",
        "axis.json",
        "--json",
        "--expected-revision",
        "3",
      ])),
      Ok(ControlCommand::AxisPanelUpdate {
        panel_id: "spectrum".to_string(),
        kind: "frequency".to_string(),
        input: "axis.json".to_string(),
        expected_revision: Some(3),
        dry_run: false,
      })
    );
    assert_eq!(
      parse_control_args(&args(&[
        "axis",
        "panel",
        "reset",
        "waveform",
        "time",
        "--json",
        "--expected-revision",
        "3",
      ])),
      Ok(ControlCommand::AxisPanelReset {
        panel_id: "waveform".to_string(),
        kind: "time".to_string(),
        expected_revision: Some(3),
        dry_run: false,
      })
    );
  }

  #[test]
  fn builds_axis_requests_and_reads_update_documents() {
    let shared = request_for_command(
      &ControlCommand::AxisSharedUpdate {
        kind: "frequency".to_string(),
        input: "-".to_string(),
        expected_revision: Some(3),
        dry_run: true,
      },
      &mut Cursor::new(br#"{"minHz":200,"maxHz":5000}"#),
    )
    .unwrap();
    assert_eq!(shared.method, "axis.shared.update");
    assert_eq!(shared.params["range"]["minHz"], 200);
    assert_eq!(shared.params["expectedRevision"], 3);

    let panel = request_for_command(
      &ControlCommand::AxisPanelUpdate {
        panel_id: "spectrum".to_string(),
        kind: "frequency".to_string(),
        input: "-".to_string(),
        expected_revision: None,
        dry_run: false,
      },
      &mut Cursor::new(br#"{"linked":false}"#),
    )
    .unwrap();
    assert_eq!(panel.method, "axis.panel.update");
    assert_eq!(panel.params["panelId"], "spectrum");
    assert_eq!(panel.params["patch"]["linked"], false);

    let reset = request_for_command(
      &ControlCommand::AxisPanelReset {
        panel_id: "waveform".to_string(),
        kind: "time".to_string(),
        expected_revision: None,
        dry_run: false,
      },
      &mut Cursor::new([]),
    )
    .unwrap();
    assert_eq!(reset.method, "axis.panel.reset");
    assert_eq!(
      reset.params,
      serde_json::json!({
        "panelId": "waveform",
        "kind": "time",
        "dryRun": false,
      })
    );
  }

  #[test]
  fn rejects_incomplete_or_unsupported_axis_cli_input() {
    for invalid in [
      args(&["axis", "describe"]),
      args(&["axis", "shared", "update", "frequency", "--json"]),
      args(&["axis", "shared", "reset", "frequency", "extra", "--json"]),
      args(&["axis", "panel", "update", "spectrum", "frequency", "--json"]),
      args(&["axis", "panel", "reset", "spectrum", "--json"]),
      args(&["axis", "inspect", "--expected-revision", "1", "--json"]),
    ] {
      assert!(parse_control_args(&invalid).is_err());
    }
  }

  #[test]
  fn parses_and_builds_preset_read_commands() {
    assert_eq!(
      parse_control_args(&args(&["preset", "list", "--json"])),
      Ok(ControlCommand::PresetList)
    );
    let describe =
      parse_control_args(&args(&["preset", "describe", "preset-1", "--json"])).unwrap();
    assert_eq!(
      describe,
      ControlCommand::PresetDescribe {
        preset_id: "preset-1".to_string(),
      }
    );
    let request = request_for_command(&describe, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "preset.describe");
    assert_eq!(request.params["presetId"], "preset-1");
    assert!(request.params.get("expectedRevision").is_none());

    for invalid in [
      args(&["preset", "list"]),
      args(&["preset", "list", "extra", "--json"]),
      args(&["preset", "describe", "--json"]),
      args(&[
        "preset",
        "describe",
        "preset-1",
        "--expected-revision",
        "-1",
        "--json",
      ]),
    ] {
      assert!(parse_control_args(&invalid).is_err());
    }
  }

  #[test]
  fn parses_and_builds_preset_mutation_commands() {
    let save = parse_control_args(&args(&[
      "preset",
      "save",
      "New Mix",
      "--json",
      "--expected-revision",
      "4",
      "--dry-run",
    ]))
    .unwrap();
    assert_eq!(
      save,
      ControlCommand::PresetSave {
        name: "New Mix".to_string(),
        expected_revision: Some(4),
        dry_run: true,
      }
    );
    let request = request_for_command(&save, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "preset.save");
    assert_eq!(request.params["name"], "New Mix");
    assert_eq!(request.params["expectedRevision"], 4);
    assert_eq!(request.params["dryRun"], true);

    let update = parse_control_args(&args(&[
      "preset",
      "update",
      "preset-1",
      "--json",
      "--expected-revision",
      "4",
    ]))
    .unwrap();
    assert!(matches!(update, ControlCommand::PresetUpdate { .. }));
    assert_eq!(
      request_for_command(&update, &mut Cursor::new([]))
        .unwrap()
        .method,
      "preset.update"
    );

    let apply = parse_control_args(&args(&[
      "preset",
      "apply",
      "preset-1",
      "--json",
      "--expected-revision",
      "4",
      "--dry-run",
    ]))
    .unwrap();
    let request = request_for_command(&apply, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "preset.apply");
    assert_eq!(request.params["presetId"], "preset-1");
    assert_eq!(request.params["dryRun"], true);

    let rename = parse_control_args(&args(&[
      "preset",
      "rename",
      "preset-1",
      "Renamed Mix",
      "--json",
      "--expected-revision",
      "4",
    ]))
    .unwrap();
    assert!(matches!(rename, ControlCommand::PresetRename { .. }));
    let delete = parse_control_args(&args(&[
      "preset",
      "delete",
      "preset-1",
      "--json",
      "--expected-revision",
      "4",
    ]))
    .unwrap();
    assert!(matches!(delete, ControlCommand::PresetDelete { .. }));

    let reorder = parse_control_args(&args(&[
      "preset",
      "reorder",
      "-",
      "--json",
      "--expected-revision",
      "7",
    ]))
    .unwrap();
    let mut stdin = Cursor::new(br#"{"presetIds":["preset-2","preset-1"]}"#);
    let request = request_for_command(&reorder, &mut stdin).unwrap();
    assert_eq!(request.method, "preset.reorder");
    assert_eq!(
      request.params["presetIds"],
      serde_json::json!(["preset-2", "preset-1"])
    );
    assert_eq!(request.params["expectedRevision"], 7);
    assert_eq!(request.params["dryRun"], false);
  }

  #[test]
  fn rejects_invalid_preset_mutation_arguments() {
    for invalid in [
      args(&["preset", "save", "Mix"]),
      args(&["preset", "save", "Mix", "--json", "--expected-revision"]),
      args(&["preset", "update", "--json"]),
      args(&["preset", "rename", "preset-1", "--json"]),
      args(&["preset", "delete", "preset-1", "extra", "--json"]),
      args(&["preset", "reorder", "--json"]),
      args(&["preset", "reorder", "file.json", "--json", "--unknown"]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }

  #[test]
  fn parses_and_builds_settings_commands() {
    assert_eq!(
      parse_control_args(&args(&["settings", "describe", "--json"])),
      Ok(ControlCommand::SettingsDescribe)
    );
    assert_eq!(
      parse_control_args(&args(&["settings", "inspect", "--json"])),
      Ok(ControlCommand::SettingsInspect)
    );
    let update = parse_control_args(&args(&[
      "settings",
      "update",
      "-",
      "--json",
      "--expected-revision",
      "3",
      "--allow-measurement-restart",
      "--dry-run",
    ]))
    .unwrap();
    let mut stdin = Cursor::new(br#"{"interfaceSize":"large"}"#);
    let request = request_for_command(&update, &mut stdin).unwrap();
    assert_eq!(request.method, "settings.update");
    assert_eq!(request.params["patch"]["interfaceSize"], "large");
    assert_eq!(request.params["expectedRevision"], 3);
    assert_eq!(request.params["allowMeasurementRestart"], true);
    assert_eq!(request.params["dryRun"], true);

    for invalid in [
      args(&["settings", "describe"]),
      args(&["settings", "inspect", "extra", "--json"]),
      args(&["settings", "update", "--json"]),
      args(&[
        "settings",
        "update",
        "-",
        "--json",
        "--expected-revision",
        "-1",
      ]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }

  #[test]
  fn parses_and_builds_revision_wait() {
    let command = parse_control_args(&args(&[
      "wait",
      "--after-revision",
      "4",
      "--timeout-ms",
      "5000",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(&command, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "app.wait");
    assert_eq!(request.params["afterRevision"], 4);
    assert_eq!(request.params["timeoutMs"], 5000);

    for invalid in [
      args(&["wait", "--json"]),
      args(&["wait", "--after-revision", "0"]),
      args(&[
        "wait",
        "--after-revision",
        "0",
        "--timeout-ms",
        "99",
        "--json",
      ]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }

  #[test]
  fn parses_and_builds_transport_commands() {
    assert_eq!(
      parse_control_args(&args(&["transport", "inspect", "--json"])),
      Ok(ControlCommand::TransportInspect)
    );
    let start = parse_control_args(&args(&[
      "transport",
      "live",
      "start",
      "--expected-revision",
      "4",
      "--allow-stop-file-analysis",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(&start, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "transport.live.start");
    assert_eq!(request.params["expectedRevision"], 4);
    assert_eq!(request.params["allowStopFileAnalysis"], true);
    assert!(request.params.get("dryRun").is_none());

    let select = parse_control_args(&args(&[
      "transport",
      "file",
      "select",
      "session-1",
      "--json",
      "--expected-revision",
      "4",
    ]))
    .unwrap();
    let request = request_for_command(&select, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "transport.file.select");
    assert_eq!(request.params["sessionId"], "session-1");

    for invalid in [
      args(&["transport", "inspect"]),
      args(&["transport", "live", "start", "--json", "extra"]),
      args(&[
        "transport",
        "live",
        "start",
        "--expected-revision",
        "0",
        "--dry-run",
        "--json",
      ]),
      args(&["transport", "file", "analyze", "--json"]),
      args(&[
        "transport",
        "source",
        "file",
        "--allow-stop-file-analysis",
        "--json",
      ]),
      args(&[
        "transport",
        "live",
        "stop",
        "--expected-revision",
        "-1",
        "--json",
      ]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }

  #[test]
  fn canonicalizes_transport_analysis_paths_before_transport() {
    let path = std::env::temp_dir().join(format!("plvs-transport-{}.wav", std::process::id()));
    fs::write(&path, []).unwrap();
    let command = ControlCommand::TransportMutation {
      method: "transport.file.analyze".to_string(),
      target_key: Some("path".to_string()),
      target: Some(path.to_string_lossy().into_owned()),
      expected_revision: None,
      allow_stop_file_analysis: false,
      dry_run: false,
    };
    let request = request_for_command(&command, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "transport.file.analyze");
    assert_eq!(
      Path::new(request.params["path"].as_str().unwrap()),
      fs::canonicalize(&path).unwrap()
    );
    fs::remove_file(path).unwrap();
  }

  #[test]
  fn parses_and_builds_device_commands() {
    assert_eq!(
      parse_control_args(&args(&["device", "list", "--json"])),
      Ok(ControlCommand::DeviceRead {
        method: "device.list".to_string(),
      })
    );
    assert_eq!(
      parse_control_args(&args(&["device", "inspect", "--json"])),
      Ok(ControlCommand::DeviceRead {
        method: "device.inspect".to_string(),
      })
    );

    let select = parse_control_args(&args(&[
      "device",
      "select",
      "lb-0123456789abcdef0123456789abcdef",
      "--expected-revision",
      "4",
      "--expected-generation",
      "7",
      "--allow-measurement-restart",
      "--dry-run",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(&select, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "device.select");
    assert_eq!(
      request.params["deviceId"],
      "lb-0123456789abcdef0123456789abcdef"
    );
    assert_eq!(request.params["expectedRevision"], 4);
    assert_eq!(request.params["expectedGeneration"], 7);
    assert_eq!(request.params["allowMeasurementRestart"], true);
    assert_eq!(request.params["dryRun"], true);

    let automatic = parse_control_args(&args(&[
      "device",
      "select",
      "default",
      "--expected-revision",
      "0",
      "--expected-generation",
      "0",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(&automatic, &mut Cursor::new([])).unwrap();
    assert_eq!(request.params["deviceId"], "default");
    assert_eq!(request.params["allowMeasurementRestart"], false);
    assert_eq!(request.params["dryRun"], false);
  }

  #[test]
  fn device_commands_reject_ambiguous_ids_missing_guards_and_unrelated_flags() {
    for invalid in [
      args(&["devices", "list", "--json"]),
      args(&["device", "list"]),
      args(&["device", "inspect", "--json", "extra"]),
      args(&["device", "describe", "default", "--json"]),
      args(&[
        "device",
        "select",
        "Speakers",
        "--expected-revision",
        "1",
        "--expected-generation",
        "1",
        "--json",
      ]),
      args(&[
        "device",
        "select",
        "out:0",
        "--expected-revision",
        "1",
        "--expected-generation",
        "1",
        "--json",
      ]),
      args(&[
        "device",
        "select",
        "LB-0123456789ABCDEF0123456789ABCDEF",
        "--expected-revision",
        "1",
        "--expected-generation",
        "1",
        "--json",
      ]),
      args(&[
        "device",
        "select",
        "default",
        "--expected-generation",
        "1",
        "--json",
      ]),
      args(&[
        "device",
        "select",
        "default",
        "--expected-revision",
        "1",
        "--json",
      ]),
      args(&[
        "device",
        "select",
        "default",
        "--expected-revision",
        "9007199254740992",
        "--expected-generation",
        "1",
        "--json",
      ]),
      args(&[
        "device",
        "select",
        "default",
        "--expected-revision",
        "1",
        "--expected-generation",
        "-1",
        "--json",
      ]),
      args(&[
        "device",
        "select",
        "default",
        "--expected-revision",
        "1",
        "--expected-generation",
        "1",
        "--out",
        "devices.json",
        "--json",
      ]),
      args(&[
        "device",
        "select",
        "default",
        "--expected-revision",
        "1",
        "--expected-generation",
        "1",
        "--allow-stop-file-analysis",
        "--json",
      ]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }

  #[test]
  fn device_help_is_scoped_and_lists_both_concurrency_guards() {
    let help = family_help_text("device");
    assert!(help.contains("plvs-cli device list --json"));
    assert!(help.contains("plvs-cli device inspect --json"));
    assert!(help.contains("--expected-revision <n> --expected-generation <n>"));
    assert!(help.contains("--allow-measurement-restart"));
    assert!(!help.contains("plvs-cli transport"));
  }

  #[test]
  fn local_input_failures_use_invalid_arguments_json_and_exit_three() {
    let unused_client = FakeClient {
      response: Err(ControlFailure::transport(
        "shouldNotReachTransport",
        "request construction should fail first",
        None,
      )),
    };

    let malformed = ControlCommand::WorkspaceApply {
      input: "-".to_string(),
      expected_revision: Some(1),
      dry_run: false,
    };
    let (report, exit) = execute(&malformed, &mut Cursor::new(b"not json"), &unused_client);
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(exit, 3);
    assert_eq!(json["ok"], false);
    assert_eq!(json["error"]["code"], "invalidArguments");

    let missing_path = std::env::temp_dir()
      .join(format!("plvs-missing-transport-{}.wav", std::process::id()))
      .to_string_lossy()
      .into_owned();
    let missing_audio = ControlCommand::TransportMutation {
      method: "transport.file.analyze".to_string(),
      target_key: Some("path".to_string()),
      target: Some(missing_path),
      expected_revision: Some(1),
      allow_stop_file_analysis: false,
      dry_run: false,
    };
    let (report, exit) = execute(&missing_audio, &mut Cursor::new([]), &unused_client);
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(exit, 3);
    assert_eq!(json["ok"], false);
    assert_eq!(json["error"]["code"], "invalidArguments");
  }

  #[test]
  fn help_marks_revisions_as_required_and_lists_v1_exit_classes() {
    let help = help_text();
    assert!(!help.contains("[--expected-revision"));
    for code in 0..=5 {
      assert!(
        help.contains(&format!("  {code}  ")),
        "missing exit code {code}"
      );
    }
  }

  #[test]
  fn parses_and_builds_dock_commands() {
    assert!(help_text().contains("plvs-cli dock layout apply"));
    assert_eq!(
      parse_control_args(&args(&["dock", "inspect", "--json"])),
      Ok(ControlCommand::DockRead {
        method: "dock.inspect".to_string(),
      })
    );
    let enter = parse_control_args(&args(&[
      "dock",
      "enter",
      "--edge",
      "top",
      "--monitor",
      "DISPLAY1",
      "--reserve-space",
      "false",
      "--height",
      "72",
      "--expected-revision",
      "3",
      "--dry-run",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(&enter, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "dock.enter");
    assert_eq!(request.params["edge"], "top");
    assert_eq!(request.params["monitor"], "DISPLAY1");
    assert_eq!(request.params["reserveSpace"], false);
    assert_eq!(request.params["height"], 72);
    assert_eq!(request.params["expectedRevision"], 3);

    let update = parse_control_args(&args(&[
      "dock",
      "panel",
      "update",
      "level",
      "-",
      "--json",
      "--expected-revision",
      "3",
    ]))
    .unwrap();
    let request = request_for_command(&update, &mut Cursor::new(br#"{"mode":"rms"}"#)).unwrap();
    assert_eq!(request.method, "dock.panel.update");
    assert_eq!(request.params["panelId"], "level");
    assert_eq!(request.params["patch"]["mode"], "rms");

    for invalid in [
      args(&["dock", "describe"]),
      args(&["dock", "enter", "--edge", "left", "--json"]),
      args(&["dock", "enter", "--height", "55", "--json"]),
      args(&["dock", "enter", "--reserve-space", "yes", "--json"]),
      args(&["dock", "layout", "apply", "--json"]),
      args(&["dock", "panel", "update", "level", "--json"]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }

  #[test]
  fn reads_stdin_and_utf8_bom_layouts() {
    let mut stdin = Cursor::new(br#"{"type":"panel","panelId":"spectrum"}"#);
    assert_eq!(read_layout("-", &mut stdin).unwrap()["type"], "panel");

    let path = std::env::temp_dir().join(format!("plvs-layout-{}.json", std::process::id()));
    fs::write(
      &path,
      b"\xef\xbb\xbf{\"type\":\"panel\",\"panelId\":\"stats\"}",
    )
    .unwrap();
    assert_eq!(
      read_layout(path.to_str().unwrap(), &mut Cursor::new([])).unwrap()["panelId"],
      "stats"
    );
    fs::remove_file(path).unwrap();
  }

  struct FakeClient {
    response: Result<AppCall, ControlFailure>,
  }

  impl ControlClient for FakeClient {
    fn call(&self, request: JsonRpcRequest) -> Result<AppCall, ControlFailure> {
      self.response.clone().map(|mut call| {
        call.response["id"] = Value::String(request.id);
        call
      })
    }
  }

  fn descriptor_app() -> DescriptorApp {
    DescriptorApp {
      name: "PLVS Dev".to_string(),
      version: "0.14.5".to_string(),
      identifier: "com.soundoer.plvs.dev".to_string(),
    }
  }

  /// Answers with a fixed id instead of echoing the request's, so the id check can be exercised.
  struct FixedIdClient {
    response: Value,
  }

  impl ControlClient for FixedIdClient {
    fn call(&self, _request: JsonRpcRequest) -> Result<AppCall, ControlFailure> {
      Ok(AppCall {
        app: descriptor_app(),
        response: self.response.clone(),
      })
    }
  }

  fn transport_error(id: &str, reason: &str) -> Value {
    serde_json::json!({
      "jsonrpc": "2.0",
      "id": id,
      "error": {
        "code": -32003,
        "message": "The PLVS frontend is not ready for agent control.",
        "data": { "reason": reason, "layer": "transport" }
      }
    })
  }

  #[test]
  fn reported_details_are_flat_and_do_not_repeat_the_reason() {
    let client = FakeClient {
      response: Ok(AppCall {
        app: descriptor_app(),
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "error": {
            "code": -32050,
            "message": "The panel controls are invalid.",
            "data": {
              "reason": "invalidControls",
              "path": "$.params.patch",
              "details": {
                "issues": [{ "code": "outOfRange", "path": "$.speedPercent", "message": "nope" }]
              }
            }
          }
        }),
      }),
    };
    let (report, exit) = execute(&ControlCommand::Inspect, &mut Cursor::new([]), &client);
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(exit, 1);
    assert_eq!(json["error"]["code"], "invalidControls");
    // The documented path, not `details.details.issues`.
    assert_eq!(json["error"]["details"]["issues"][0]["code"], "outOfRange");
    assert_eq!(json["error"]["details"]["path"], "$.params.patch");
    assert!(json["error"]["details"].get("reason").is_none());
    assert!(json["error"]["details"].get("details").is_none());

    // A payload with nothing but a reason reports no details at all rather than an echo.
    let bare = FakeClient {
      response: Ok(AppCall {
        app: descriptor_app(),
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "error": {
            "code": -32050,
            "message": "gone",
            "data": { "reason": "panelNotFound", "path": "$.params.panelId" }
          }
        }),
      }),
    };
    let (report, _) = execute(&ControlCommand::Inspect, &mut Cursor::new([]), &bare);
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(
      json["error"]["details"],
      serde_json::json!({ "path": "$.params.panelId" })
    );
  }

  #[test]
  fn json_rpc_invalid_params_exit_three_and_only_rename_the_generic_reason() {
    for (reason, public_code) in [
      ("invalidParams", "invalidArguments"),
      ("invalidControls", "invalidControls"),
      ("invalidDockLayout", "invalidDockLayout"),
    ] {
      let client = FakeClient {
        response: Ok(AppCall {
          app: descriptor_app(),
          response: serde_json::json!({
            "jsonrpc": "2.0",
            "id": "replaced",
            "error": {
              "code": -32602,
              "message": "Invalid method parameters.",
              "data": { "reason": reason }
            }
          }),
        }),
      };

      let (report, exit) = execute(&ControlCommand::Inspect, &mut Cursor::new([]), &client);
      assert_eq!(exit, 3, "wrong exit for {reason}");
      assert_eq!(
        serde_json::to_value(report).unwrap()["error"]["code"],
        public_code,
        "wrong public code for {reason}"
      );
    }
  }

  #[test]
  fn stable_app_error_classes_map_to_the_v1_exit_contract() {
    let cases = [
      ("revisionRequired", None, 3),
      ("resourceNotFound", None, 3),
      ("panelNotFound", None, 3),
      ("axisNotFound", None, 3),
      ("presetNotFound", None, 3),
      ("deviceNotFound", None, 3),
      ("fileSessionNotFound", None, 3),
      ("dockPanelNotFound", None, 3),
      ("monitorNotFound", None, 3),
      ("revisionConflict", None, 4),
      ("editorActive", None, 4),
      ("operationNotAllowed", None, 4),
      ("waitLimitReached", None, 4),
      ("busy", None, 4),
      ("controlUnavailable", None, 4),
      ("controlsUnavailable", None, 4),
      ("axisUnavailable", None, 4),
      ("transitionInProgress", None, 4),
      ("analysisInProgress", None, 4),
      ("dockActive", None, 4),
      ("fileModeActive", None, 4),
      ("fileAnalysisNotActive", None, 4),
      ("confirmationRequired", None, 4),
      ("channelConfigurationChanged", None, 4),
      ("deviceInventoryChanged", None, 4),
      ("deviceUnavailable", None, 4),
      ("timeout", None, 5),
      ("cancelled", None, 5),
      ("unexpectedRuntimeFailure", None, 1),
      ("deviceStartFailed", None, 1),
      ("invalidControls", Some(-32602), 3),
    ];

    for (public_code, rpc_code, expected_exit) in cases {
      let failure = ControlFailure::application(
        descriptor_app(),
        ControlError {
          code: public_code.to_string(),
          message: "test failure".to_string(),
          details: None,
        },
        rpc_code,
      );
      assert_eq!(
        failure.exit_code, expected_exit,
        "wrong exit for {public_code} with RPC code {rpc_code:?}"
      );
    }
  }

  #[test]
  fn an_unattributed_server_error_keeps_its_reason_but_a_mismatched_reply_does_not() {
    // No request id could be recovered, so PLVS answered with the empty sentinel. The failure is
    // still real and its reason has to survive.
    let (report, exit) = execute(
      &ControlCommand::Inspect,
      &mut Cursor::new([]),
      &FixedIdClient {
        response: transport_error("", "invalidEnvelope"),
      },
    );
    assert_eq!(exit, 2);
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(json["error"]["code"], "invalidEnvelope");

    // A non-empty id that belongs to someone else is a genuinely mismatched reply.
    let (report, exit) = execute(
      &ControlCommand::Inspect,
      &mut Cursor::new([]),
      &FixedIdClient {
        response: transport_error("someone-elses-request", "frontendNotReady"),
      },
    );
    assert_eq!(exit, 2);
    assert_eq!(
      serde_json::to_value(report).unwrap()["error"]["code"],
      "transportFailed"
    );
  }

  #[test]
  fn broker_busy_exits_two_while_app_wait_limits_and_busy_exit_four() {
    let broker_busy = FakeClient {
      response: Ok(AppCall {
        app: descriptor_app(),
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "error": {
            "code": -32006,
            "message": "PLVS has reached the agent-control request limit.",
            "data": { "reason": "busy", "layer": "transport" }
          }
        }),
      }),
    };
    let (report, exit) = execute(&ControlCommand::Inspect, &mut Cursor::new([]), &broker_busy);
    assert_eq!(exit, 2);
    assert_eq!(
      serde_json::to_value(report).unwrap()["error"]["code"],
      "busy"
    );

    let wait_limit_reached = FakeClient {
      response: Ok(AppCall {
        app: descriptor_app(),
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "error": {
            "code": -32070,
            "message": "Too many revision waits are active.",
            "data": { "reason": "waitLimitReached" }
          }
        }),
      }),
    };
    let (report, exit) = execute(
      &ControlCommand::Inspect,
      &mut Cursor::new([]),
      &wait_limit_reached,
    );
    assert_eq!(exit, 4);
    assert_eq!(
      serde_json::to_value(report).unwrap()["error"]["code"],
      "waitLimitReached"
    );

    let busy = ControlFailure::application(
      descriptor_app(),
      ControlError {
        code: "busy".to_string(),
        message: "Another app operation is busy.".to_string(),
        details: None,
      },
      None,
    );
    assert_eq!(busy.exit_code, 4);
  }

  #[test]
  fn capabilities_report_the_invoking_cli_version_independently_from_the_descriptor_app() {
    let mut golden = crate::cli_contract::golden_fixture("query.capabilities");
    golden["envelope"]["result"]["cliVersion"] = serde_json::json!(env!("CARGO_PKG_VERSION"));
    let mut app_result = golden["envelope"]["result"].clone();
    app_result.as_object_mut().unwrap().remove("cliVersion");
    let client = FakeClient {
      response: Ok(AppCall {
        app: descriptor_app(),
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "result": app_result
        }),
      }),
    };

    let (report, exit) = execute(&ControlCommand::Capabilities, &mut Cursor::new([]), &client);
    let report = serde_json::to_value(report).unwrap();
    let result = report["result"].clone();

    assert_eq!(exit, 0);
    assert_eq!(report, golden["envelope"]);
    assert_eq!(result["appVersion"], "99.99.99-app");
    assert_eq!(result["cliVersion"], env!("CARGO_PKG_VERSION"));
    assert_ne!(result["cliVersion"], result["appVersion"]);
  }

  #[test]
  fn wait_timeout_matches_the_v1_golden_error() {
    let golden = crate::cli_contract::golden_fixture("wait.timeout");
    let client = FakeClient {
      response: Ok(AppCall {
        app: descriptor_app(),
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "error": {
            "code": -32071,
            "message": "The app revision did not change before the timeout.",
            "data": {
              "reason": "timeout",
              "path": "$.params.timeoutMs",
              "details": { "afterRevision": 44, "currentRevision": 44 }
            }
          }
        }),
      }),
    };

    let (report, exit) = execute(&ControlCommand::Inspect, &mut Cursor::new([]), &client);

    assert_eq!(exit, golden["exitCode"].as_u64().unwrap() as u8);
    assert_eq!(serde_json::to_value(report).unwrap(), golden["envelope"]);
  }

  #[test]
  fn reports_success_app_errors_and_transport_exit_codes_without_tokens() {
    let command = ControlCommand::Inspect;
    let ok_client = FakeClient {
      response: Ok(AppCall {
        app: descriptor_app(),
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "result": { "revision": 4 }
        }),
      }),
    };
    let (report, exit) = execute(&command, &mut Cursor::new([]), &ok_client);
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(exit, 0);
    assert_eq!(json["ok"], true);
    assert_eq!(json["result"]["revision"], 4);
    assert_eq!(json["schemaVersion"], 1);
    assert!(json.get("command").is_none());

    let app_error = FakeClient {
      response: Ok(AppCall {
        app: descriptor_app(),
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "error": {
            "code": -32004,
            "message": "conflict",
            "data": { "reason": "revisionConflict" }
          }
        }),
      }),
    };
    let (report, exit) = execute(&command, &mut Cursor::new([]), &app_error);
    assert_eq!(exit, 4);
    assert_eq!(
      serde_json::to_value(report).unwrap()["error"]["code"],
      "revisionConflict"
    );

    let authentication_error = FakeClient {
      response: Ok(AppCall {
        app: descriptor_app(),
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "error": {
            "code": -32020,
            "message": "unauthorized",
            "data": { "reason": "unauthorized", "layer": "transport" }
          }
        }),
      }),
    };
    let (report, exit) = execute(&command, &mut Cursor::new([]), &authentication_error);
    assert_eq!(exit, 2);
    assert_eq!(
      serde_json::to_value(report).unwrap()["error"]["code"],
      "authenticationFailed"
    );

    let transport = FakeClient {
      response: Err(ControlFailure::transport(
        "appNotRunning",
        "not running",
        None,
      )),
    };
    let (report, exit) = execute(&command, &mut Cursor::new([]), &transport);
    let encoded = serde_json::to_string(&report).unwrap();
    assert_eq!(exit, 2);
    assert!(encoded.contains("appNotRunning"));
    assert!(!encoded.contains("token"));
    assert!(!encoded.contains("securityDescriptor"));
  }

  #[test]
  fn a_missing_descriptor_reads_differently_when_the_toggle_is_off() {
    let missing = DiscoveryError::new(DiscoveryErrorKind::Missing, "no descriptor");

    let disabled = discovery_failure(&missing, false);
    assert_eq!(disabled.error.code, "agentControlDisabled");
    assert_eq!(
      disabled.error.message,
      "Agent Control is disabled. Enable it in PLVS Settings."
    );

    let not_running = discovery_failure(&missing, true);
    assert_eq!(not_running.error.code, "appNotRunning");
    assert_eq!(not_running.error.message, "PLVS is not running.");
  }

  #[test]
  fn malformed_discovery_keeps_its_diagnostic_but_a_stale_process_reads_as_not_running() {
    let malformed = discovery_failure(
      &DiscoveryError::new(DiscoveryErrorKind::Malformed, "bad token"),
      true,
    );
    assert_eq!(malformed.error.code, "discoveryFailed");
    assert_eq!(malformed.error.message, "bad token");

    let stale = discovery_failure(
      &DiscoveryError::new(DiscoveryErrorKind::Stale, "pid 4321 is gone"),
      true,
    );
    assert_eq!(stale.error.code, "appNotRunning");
    assert_eq!(stale.error.message, "PLVS is not running.");
  }

  #[test]
  fn parses_and_builds_library_commands() {
    assert!(help_text().contains("plvs-cli theme export"));
    assert_eq!(
      parse_control_args(&args(&["theme", "list", "--json"])),
      Ok(ControlCommand::LibraryList {
        family: "theme".to_string(),
      })
    );

    let export = parse_control_args(&args(&[
      "loudness-profile",
      "export",
      "--ids",
      "p-1,p-2",
      "--out",
      "pack.json",
      "--json",
    ]))
    .unwrap();
    assert_eq!(
      export,
      ControlCommand::LibraryExport {
        family: "loudnessProfile".to_string(),
        ids: Some(vec!["p-1".to_string(), "p-2".to_string()]),
        out: Some("pack.json".to_string()),
      }
    );
    let request = request_for_command(&export, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "loudnessProfile.export");
    assert_eq!(request.params, serde_json::json!({ "ids": ["p-1", "p-2"] }));

    // A whole-library export omits `ids` rather than sending null: `protocol.js` reads an absent
    // `ids` as the whole library and rejects any non-array value it is given.
    let all = parse_control_args(&args(&["theme", "export", "--all", "--json"])).unwrap();
    let request = request_for_command(&all, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "theme.export");
    assert_eq!(request.params, serde_json::json!({}));

    let list = request_for_command(
      &ControlCommand::LibraryList {
        family: "preset".to_string(),
      },
      &mut Cursor::new([]),
    )
    .unwrap();
    assert_eq!(list.method, "preset.list");

    // `preset export` reaches this parser through `parse_preset_args`, which has its own flag loop.
    let preset_export =
      parse_control_args(&args(&["preset", "export", "--all", "--json"])).unwrap();
    let request = request_for_command(&preset_export, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "preset.export");
  }

  #[test]
  fn parses_theme_control_commands_and_help() {
    assert!(help_text().contains("plvs-cli theme inspect --json"));
    assert!(family_help_text("theme")
      .contains("theme duplicate <theme-id> <name> --expected-revision <n> --json [--dry-run]"));

    assert_eq!(
      parse_control_args(&args(&["theme", "inspect", "--json"])),
      Ok(ControlCommand::ThemeRead {
        method: "theme.inspect".to_string(),
        theme_id: None,
      })
    );
    assert_eq!(
      parse_control_args(&args(&["theme", "describe", "plvs-dark", "--json"])),
      Ok(ControlCommand::ThemeRead {
        method: "theme.describe".to_string(),
        theme_id: Some("plvs-dark".to_string()),
      })
    );
    for (action, positionals, method) in [
      ("select", vec!["plvs-light"], "theme.select"),
      ("follow-system", vec![], "theme.followSystem"),
      ("create", vec!["theme.json"], "theme.create"),
      ("update", vec!["custom-a", "theme.json"], "theme.update"),
      ("rename", vec!["custom-a", "Studio"], "theme.rename"),
      (
        "duplicate",
        vec!["plvs-dark", "Dark Copy"],
        "theme.duplicate",
      ),
      ("delete", vec!["custom-a"], "theme.delete"),
      ("reorder", vec!["order.json"], "theme.reorder"),
    ] {
      let mut command = vec!["theme", action];
      command.extend(positionals);
      command.extend(["--expected-revision", "7", "--json", "--dry-run"]);
      let parsed = parse_control_args(&args(&command)).unwrap();
      assert_eq!(command_name(&parsed), method);
    }
  }

  #[test]
  fn builds_theme_document_and_reorder_requests_from_stdin() {
    let create = parse_control_args(&args(&[
      "theme",
      "create",
      "-",
      "--expected-revision",
      "3",
      "--json",
      "--dry-run",
    ]))
    .unwrap();
    let mut create_stdin = Cursor::new(b"\xef\xbb\xbf{\"version\":2,\"name\":\"Studio\"}".to_vec());
    let request = request_for_command(&create, &mut create_stdin).unwrap();
    assert_eq!(request.method, "theme.create");
    assert_eq!(request.params["document"]["name"], "Studio");
    assert_eq!(request.params["expectedRevision"], 3);
    assert_eq!(request.params["dryRun"], true);

    let update = parse_control_args(&args(&[
      "theme",
      "update",
      "custom-a",
      "-",
      "--expected-revision",
      "4",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(
      &update,
      &mut Cursor::new(br#"{"version":2,"name":"Updated"}"#),
    )
    .unwrap();
    assert_eq!(request.method, "theme.update");
    assert_eq!(request.params["themeId"], "custom-a");
    assert_eq!(request.params["document"]["name"], "Updated");

    let reorder = parse_control_args(&args(&[
      "theme",
      "reorder",
      "-",
      "--expected-revision",
      "5",
      "--json",
    ]))
    .unwrap();
    let request =
      request_for_command(&reorder, &mut Cursor::new(br#"["custom-b","custom-a"]"#)).unwrap();
    assert_eq!(request.method, "theme.reorder");
    assert_eq!(
      request.params["themeIds"],
      serde_json::json!(["custom-b", "custom-a"])
    );
  }

  #[test]
  fn rejects_invalid_theme_control_forms_before_transport() {
    for invalid in [
      args(&["theme", "inspect"]),
      args(&[
        "theme",
        "describe",
        "plvs-dark",
        "--expected-revision",
        "0",
        "--json",
      ]),
      args(&["theme", "follow-system", "--json"]),
      args(&[
        "theme",
        "create",
        "theme.json",
        "--expected-revision",
        "0",
        "--all",
        "--json",
      ]),
      args(&[
        "theme",
        "update",
        "custom-a",
        "--expected-revision",
        "0",
        "--json",
      ]),
      args(&[
        "theme",
        "rename",
        "custom-a",
        "--expected-revision",
        "0",
        "--json",
      ]),
      args(&[
        "theme",
        "duplicate",
        "plvs-dark",
        "Copy",
        "--out",
        "copy.json",
        "--expected-revision",
        "0",
        "--json",
      ]),
      args(&[
        "theme",
        "delete",
        "custom-a",
        "extra",
        "--expected-revision",
        "0",
        "--json",
      ]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }

    let command = parse_control_args(&args(&[
      "theme",
      "reorder",
      "-",
      "--expected-revision",
      "0",
      "--json",
    ]))
    .unwrap();
    let failure =
      request_for_command(&command, &mut Cursor::new(br#"{"themeIds":[]}"#)).unwrap_err();
    assert_eq!(failure.error.code, "invalidArguments");

    let command = parse_control_args(&args(&[
      "theme",
      "create",
      "-",
      "--expected-revision",
      "0",
      "--json",
    ]))
    .unwrap();
    let failure = request_for_command(&command, &mut Cursor::new(b"not-json")).unwrap_err();
    assert_eq!(failure.error.code, "invalidArguments");
  }

  #[test]
  fn parses_loudness_profile_control_commands_and_help() {
    assert!(help_text().contains("plvs-cli loudness-profile describe <profile-id> --json"));
    assert!(family_help_text("loudness-profile")
      .contains("loudness-profile create <file|-> --expected-revision <n> --json [--dry-run]"));

    assert_eq!(
      parse_control_args(&args(&["loudness-profile", "describe", "prof-a", "--json"])),
      Ok(ControlCommand::LoudnessProfileDescribe {
        profile_id: "prof-a".to_string(),
      })
    );
    for (action, positionals) in [
      ("select", vec!["off"]),
      ("create", vec!["profile.json"]),
      ("update", vec!["prof-a", "profile.json"]),
      ("rename", vec!["prof-a", "Broadcast"]),
      ("delete", vec!["prof-a"]),
      ("reorder", vec!["order.json"]),
    ] {
      let mut command = vec!["loudness-profile", action];
      command.extend(positionals);
      command.extend(["--expected-revision", "7", "--json", "--dry-run"]);
      let parsed = parse_control_args(&args(&command)).unwrap();
      assert_eq!(command_name(&parsed), format!("loudnessProfile.{action}"));
    }
  }

  #[test]
  fn builds_loudness_profile_document_and_reorder_requests_from_stdin() {
    let create = parse_control_args(&args(&[
      "loudness-profile",
      "create",
      "-",
      "--expected-revision",
      "3",
      "--json",
      "--dry-run",
    ]))
    .unwrap();
    let mut create_stdin = Cursor::new(
      b"\xef\xbb\xbf{\"name\":\"Broadcast\",\"referenceLufs\":-23,\"rules\":[]}".to_vec(),
    );
    let request = request_for_command(&create, &mut create_stdin).unwrap();
    assert_eq!(request.method, "loudnessProfile.create");
    assert_eq!(request.params["document"]["name"], "Broadcast");
    assert_eq!(request.params["expectedRevision"], 3);
    assert_eq!(request.params["dryRun"], true);

    let update = parse_control_args(&args(&[
      "loudness-profile",
      "update",
      "prof-a",
      "-",
      "--expected-revision",
      "4",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(
      &update,
      &mut Cursor::new(br#"{"name":"Updated","referenceLufs":null,"rules":[]}"#),
    )
    .unwrap();
    assert_eq!(request.method, "loudnessProfile.update");
    assert_eq!(request.params["profileId"], "prof-a");
    assert_eq!(request.params["document"]["name"], "Updated");

    let reorder = parse_control_args(&args(&[
      "loudness-profile",
      "reorder",
      "-",
      "--expected-revision",
      "5",
      "--json",
    ]))
    .unwrap();
    let request =
      request_for_command(&reorder, &mut Cursor::new(br#"["prof-b","prof-a"]"#)).unwrap();
    assert_eq!(request.method, "loudnessProfile.reorder");
    assert_eq!(
      request.params["profileIds"],
      serde_json::json!(["prof-b", "prof-a"])
    );
  }

  #[test]
  fn rejects_invalid_loudness_profile_control_forms() {
    for invalid in [
      args(&["loudness-profile", "describe", "prof-a"]),
      args(&[
        "loudness-profile",
        "describe",
        "prof-a",
        "--expected-revision",
        "0",
        "--json",
      ]),
      args(&["loudness-profile", "select", "off", "--json"]),
      args(&[
        "loudness-profile",
        "create",
        "profile.json",
        "--expected-revision",
        "0",
        "--all",
        "--json",
      ]),
      args(&[
        "loudness-profile",
        "update",
        "prof-a",
        "--expected-revision",
        "0",
        "--json",
      ]),
      args(&[
        "loudness-profile",
        "rename",
        "prof-a",
        "--expected-revision",
        "0",
        "--json",
      ]),
      args(&[
        "loudness-profile",
        "delete",
        "prof-a",
        "extra",
        "--expected-revision",
        "0",
        "--json",
      ]),
      args(&[
        "loudness-profile",
        "reorder",
        "order.json",
        "--out",
        "copy.json",
        "--expected-revision",
        "0",
        "--json",
      ]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }

    let command = parse_control_args(&args(&[
      "loudness-profile",
      "reorder",
      "-",
      "--expected-revision",
      "0",
      "--json",
    ]))
    .unwrap();
    let failure =
      request_for_command(&command, &mut Cursor::new(br#"{"profileIds":[]}"#)).unwrap_err();
    assert_eq!(failure.error.code, "invalidArguments");
  }

  #[test]
  fn rejects_invalid_library_commands() {
    for invalid in [
      args(&["theme", "list"]),
      args(&["theme", "list", "--expected-revision", "3", "--json"]),
      // A list that quietly accepted the export and import options would answer a user who asked
      // to export with a listing instead.
      args(&["theme", "list", "--all", "--json"]),
      args(&["theme", "list", "--out", "pack.json", "--json"]),
      args(&["theme", "list", "--dry-run", "--json"]),
      args(&["theme", "list", "extra", "--json"]),
      args(&["theme", "export", "--json"]),
      args(&["theme", "export", "--all", "--ids", "t-1", "--json"]),
      args(&["theme", "export", "--all", "--dry-run", "--json"]),
      args(&[
        "theme",
        "export",
        "--all",
        "--expected-revision",
        "3",
        "--json",
      ]),
      args(&["theme", "export", "--all", "extra", "--json"]),
      args(&["theme", "export", "--ids", " , ", "--json"]),
      args(&["theme", "import", "pack.json", "--json"]),
      args(&["theme", "import", "--expected-revision", "3", "--json"]),
      args(&[
        "theme",
        "import",
        "pack.json",
        "--out",
        "copy.json",
        "--expected-revision",
        "3",
        "--json",
      ]),
      args(&[
        "theme",
        "import",
        "pack.json",
        "--all",
        "--expected-revision",
        "3",
        "--json",
      ]),
      args(&["theme", "reorder", "order.json", "--json"]),
      args(&["loudness-profile", "list"]),
      args(&["preset", "export", "--all"]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }

    // Every message names the family word the user typed. `loudnessProfile` is the wire name and
    // is not a command anyone can run.
    let rejected = parse_control_args(&args(&[
      "loudness-profile",
      "export",
      "--all",
      "--dry-run",
      "--json",
    ]))
    .unwrap_err();
    assert_eq!(
      rejected,
      "The loudness-profile export command does not accept --expected-revision or --dry-run."
    );
  }

  #[test]
  fn parses_and_builds_config_export() {
    assert!(help_text().contains("plvs-cli config export --json [--out <file>]"));
    assert!(help_text()
      .contains("plvs-cli config import <file|-> --expected-revision <n> --json [--dry-run]"));
    assert_eq!(
      parse_control_args(&args(&[
        "config",
        "export",
        "--json",
        "--out",
        "all.plvsconfig"
      ])),
      Ok(ControlCommand::ConfigExport {
        out: Some("all.plvsconfig".to_string()),
      })
    );
    let request = request_for_command(
      &ControlCommand::ConfigExport { out: None },
      &mut Cursor::new([]),
    )
    .unwrap();
    assert_eq!(request.method, "config.export");
    assert_eq!(request.params, serde_json::json!({}));

    for invalid in [
      args(&["config", "export"]),
      args(&["config", "export", "--json", "--dry-run"]),
      args(&["config", "export", "--json", "extra"]),
      args(&["config", "import", "all.plvsconfig", "--json"]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }

  #[test]
  fn parses_and_builds_config_import() {
    let command = parse_control_args(&args(&[
      "config",
      "import",
      "-",
      "--expected-revision",
      "7",
      "--json",
      "--dry-run",
    ]))
    .unwrap();
    assert_eq!(
      command,
      ControlCommand::ConfigImport {
        input: "-".to_string(),
        expected_revision: Some(7),
        dry_run: true,
      }
    );
    let mut stdin =
      Cursor::new(br#"{"app":"PLVS","kind":"configuration-profile","version":1}"#.to_vec());
    let request = request_for_command(&command, &mut stdin).unwrap();
    assert_eq!(request.method, "config.import");
    assert_eq!(request.params["expectedRevision"], 7);
    assert_eq!(request.params["dryRun"], true);
    assert_eq!(
      request.params["configuration"]["kind"],
      "configuration-profile"
    );

    for invalid in [
      args(&["config", "import", "file.plvsconfig", "--json"]),
      args(&[
        "config",
        "import",
        "file.plvsconfig",
        "--expected-revision",
        "0",
      ]),
      args(&[
        "config",
        "import",
        "file.plvsconfig",
        "--expected-revision",
        "0",
        "--json",
        "extra",
      ]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }

  #[test]
  fn builds_a_library_import_request_from_a_document() {
    let import = parse_control_args(&args(&[
      "preset",
      "import",
      "-",
      "--expected-revision",
      "3",
      "--json",
    ]))
    .unwrap();
    assert_eq!(
      import,
      ControlCommand::LibraryImport {
        family: "preset".to_string(),
        input: "-".to_string(),
        expected_revision: Some(3),
        dry_run: false,
      }
    );
    let request = request_for_command(
      &import,
      &mut Cursor::new(br#"{"app":"PLVS","kind":"presets-pack","version":1,"items":[]}"#),
    )
    .unwrap();
    assert_eq!(request.method, "preset.import");
    assert_eq!(request.params["pack"]["kind"], "presets-pack");
    assert_eq!(request.params["expectedRevision"], 3);
    assert_eq!(request.params["dryRun"], false);
  }

  #[test]
  fn library_not_found_reasons_map_to_exit_three() {
    for reason in [
      "themeNotFound",
      "loudnessProfileNotFound",
      "invalidProfile",
      "invalidPermutation",
    ] {
      let failure = ControlFailure::application(
        descriptor_app(),
        ControlError {
          code: reason.to_string(),
          message: "missing".to_string(),
          details: None,
        },
        None,
      );
      assert_eq!(failure.exit_code, 3, "wrong exit for {reason}");
    }
  }

  #[test]
  fn writing_the_pack_replaces_it_with_the_path_it_was_written_to() {
    let path = std::env::temp_dir().join(format!("plvs-pack-{}.json", std::process::id()));
    let mut report = ControlReport {
      schema_version: CLI_SCHEMA_VERSION,
      ok: true,
      result: Some(serde_json::json!({
        "revision": 4,
        "pack": { "app": "PLVS", "kind": "theme-pack", "items": [] }
      })),
      error: None,
    };

    write_pack_file(&mut report, path.to_str().unwrap()).unwrap();

    let written: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(written["kind"], "theme-pack");
    let result = report.result.unwrap();
    assert_eq!(result["out"], path.to_str().unwrap());
    assert!(result.get("pack").is_none());
    assert_eq!(result["revision"], 4);
    fs::remove_file(path).unwrap();

    // A failure report carries no pack, and asking for one is not an error.
    let mut failed = failure_report(ControlFailure::invalid_arguments("nope"));
    write_pack_file(&mut failed, "unreachable.json").unwrap();
    assert!(failed.result.is_none());
  }

  #[test]
  fn writing_a_configuration_replaces_it_with_the_path_it_was_written_to() {
    let path = std::env::temp_dir().join(format!("plvs-config-{}.json", std::process::id()));
    let command = ControlCommand::ConfigExport {
      out: Some(path.to_string_lossy().into_owned()),
    };
    let mut report = ControlReport {
      schema_version: CLI_SCHEMA_VERSION,
      ok: true,
      result: Some(serde_json::json!({
        "revision": 4,
        "configuration": {
          "app": "PLVS",
          "kind": "configuration-profile",
          "version": 1
        }
      })),
      error: None,
    };

    assert_eq!(finish_export(&command, &mut report, 0), 0);
    let written: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(written["kind"], "configuration-profile");
    let result = report.result.unwrap();
    assert_eq!(result["out"], path.to_string_lossy().as_ref());
    assert!(result.get("configuration").is_none());
    assert_eq!(result["revision"], 4);
    fs::remove_file(path).unwrap();
  }

  fn pack_report() -> ControlReport {
    ControlReport {
      schema_version: CLI_SCHEMA_VERSION,
      ok: true,
      result: Some(serde_json::json!({
        "revision": 4,
        "pack": { "app": "PLVS", "kind": "theme-pack", "items": [] }
      })),
      error: None,
    }
  }

  /// A directory is never writable as a file, on Windows or elsewhere.
  fn unwritable_path() -> String {
    std::env::temp_dir().to_str().unwrap().to_string()
  }

  #[test]
  fn a_failed_pack_write_leaves_the_pack_in_the_envelope() {
    let mut report = pack_report();

    let error = write_pack_file(&mut report, &unwritable_path()).unwrap_err();

    assert!(error.starts_with("Unable to write the pack to"), "{error}");
    let result = report.result.unwrap();
    // The point of the ordering: an exit-1 envelope still carries the export, so a script can
    // recover it from stdout instead of re-running the command.
    assert_eq!(result["pack"]["kind"], "theme-pack");
    assert!(result.get("out").is_none());
  }

  #[test]
  fn finishing_an_export_writes_out_and_reports_a_write_failure_as_exit_one() {
    let export = |out: Option<&str>| ControlCommand::LibraryExport {
      family: "theme".to_string(),
      ids: None,
      out: out.map(str::to_string),
    };

    let path = std::env::temp_dir().join(format!("plvs-finish-{}.json", std::process::id()));
    let mut written = pack_report();
    assert_eq!(
      finish_export(&export(Some(path.to_str().unwrap())), &mut written, 0),
      0
    );
    assert_eq!(written.result.unwrap()["out"], path.to_str().unwrap());
    fs::remove_file(path).unwrap();

    // 1, not 2: the app answered, so a script must not be told to retry the connection.
    let mut failed = pack_report();
    assert_eq!(
      finish_export(&export(Some(&unwritable_path())), &mut failed, 0),
      1
    );

    // Without --out, and for any other command, the report and the app's exit code pass through.
    let mut without_out = pack_report();
    assert_eq!(finish_export(&export(None), &mut without_out, 4), 4);
    assert_eq!(without_out.result.unwrap()["pack"]["kind"], "theme-pack");
    let mut other = pack_report();
    assert_eq!(
      finish_export(
        &ControlCommand::LibraryList {
          family: "theme".to_string(),
        },
        &mut other,
        0
      ),
      0
    );
    assert_eq!(other.result.unwrap()["pack"]["kind"], "theme-pack");
  }

  #[test]
  fn protocol_mismatch_is_publicly_distinct_from_malformed_discovery() {
    let mismatch = discovery_failure(
      &DiscoveryError::new(DiscoveryErrorKind::ProtocolMismatch, "wrong protocol"),
      true,
    );
    assert_eq!(mismatch.error.code, "protocolMismatch");
    assert_eq!(mismatch.exit_code, 2);

    let malformed = discovery_failure(
      &DiscoveryError::new(DiscoveryErrorKind::Malformed, "wrong descriptor schema"),
      true,
    );
    assert_eq!(malformed.error.code, "discoveryFailed");
    assert_eq!(malformed.exit_code, 2);
  }
}
