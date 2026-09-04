use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{self, Read};
use std::path::Path;
use std::process::ExitCode;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::agent_control::discovery::{
  descriptor_path, read_descriptor_at, AgentControlDescriptor, DescriptorApp, DiscoveryErrorKind,
};
use crate::agent_control::protocol::JsonRpcRequest;

const MAX_SAFE_REVISION: u64 = 9_007_199_254_740_991;
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliAppCommand {
  Help,
  Capabilities,
  Inspect,
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
    expected_revision: Option<u64>,
  },
  PresetSave {
    name: String,
    expected_workspace_revision: Option<u64>,
    expected_presets_revision: Option<u64>,
    dry_run: bool,
  },
  PresetUpdate {
    preset_id: String,
    expected_workspace_revision: Option<u64>,
    expected_presets_revision: Option<u64>,
    dry_run: bool,
  },
  PresetApply {
    preset_id: String,
    expected_workspace_revision: Option<u64>,
    expected_presets_revision: Option<u64>,
    dry_run: bool,
  },
  PresetRename {
    preset_id: String,
    name: String,
    expected_presets_revision: Option<u64>,
    dry_run: bool,
  },
  PresetDelete {
    preset_id: String,
    expected_presets_revision: Option<u64>,
    dry_run: bool,
  },
  PresetReorder {
    input: String,
    expected_presets_revision: Option<u64>,
    dry_run: bool,
  },
  SettingsDescribe,
  SettingsInspect,
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
    workspace_revision: Option<u64>,
    presets_revision: Option<u64>,
    settings_revision: Option<u64>,
    transport_revision: Option<u64>,
    timeout_ms: u64,
  },
}

pub fn parse_app_args(args: &[String]) -> Result<CliAppCommand, String> {
  match args {
    [flag] if is_help(flag) => return Ok(CliAppCommand::Help),
    [command, flag] if (command == "capabilities" || command == "inspect") && flag == "--json" => {
      return Ok(if command == "capabilities" {
        CliAppCommand::Capabilities
      } else {
        CliAppCommand::Inspect
      });
    }
    [command, ..] if command == "capabilities" || command == "inspect" => {
      return Err(format!("The app {command} command requires --json."));
    }
    [command, rest @ ..] if command == "workspace" => return parse_workspace_args(rest),
    [command, rest @ ..] if command == "panel" => return parse_panel_args(rest),
    [command, rest @ ..] if command == "axis" => return parse_axis_args(rest),
    [command, rest @ ..] if command == "preset" => return parse_preset_args(rest),
    [command, rest @ ..] if command == "settings" => return parse_settings_args(rest),
    [command, rest @ ..] if command == "transport" => return parse_transport_args(rest),
    [command, rest @ ..] if command == "dock" => return parse_dock_args(rest),
    [command, rest @ ..] if command == "wait" => return parse_wait_args(rest),
    [command, ..] => return Err(format!("Unknown app subcommand: {command}")),
    [] => {}
  }
  Err("Usage: plvs-cli app <capabilities|inspect|workspace apply|panel|axis> ...".to_string())
}

fn parse_dock_args(args: &[String]) -> Result<CliAppCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(CliAppCommand::Help);
  }
  if let [action, json] = args {
    if matches!(action.as_str(), "describe" | "inspect") && json == "--json" {
      return Ok(CliAppCommand::DockRead {
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
    _ => return Err("Usage: plvs-cli app dock <describe|inspect|enter|exit|layout apply|panel describe|panel update|panel reset> ... --json".to_string()),
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
      "--expected-workspace-revision" if !read_panel => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-workspace-revision.".to_string())?;
        let parsed = value.parse::<u64>().map_err(|_| {
          "The --expected-workspace-revision value must be a non-negative safe integer.".to_string()
        })?;
        if parsed > MAX_SAFE_REVISION {
          return Err(
            "The --expected-workspace-revision value must be a non-negative safe integer."
              .to_string(),
          );
        }
        expected_revision = Some(parsed);
        index += 2;
      }
      value => return Err(format!("Unexpected dock argument: {value}")),
    }
  }
  if !json {
    return Err("The app dock command requires --json.".to_string());
  }
  Ok(CliAppCommand::DockCommand {
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

fn parse_transport_args(args: &[String]) -> Result<CliAppCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(CliAppCommand::Help);
  }
  if args.first().map(String::as_str) == Some("inspect") {
    return if args == ["inspect", "--json"] {
      Ok(CliAppCommand::TransportInspect)
    } else {
      Err("Usage: plvs-cli app transport inspect --json".to_string())
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
        "Usage: plvs-cli app transport <inspect|source live|source file|live start|live stop|live clear|file analyze|file reanalyze|file stop|file select|file remove|file clear> ... --json"
          .to_string(),
      )
    }
  };
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
      "--dry-run" => {
        dry_run = true;
        index += 1;
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
      "--expected-transport-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-transport-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-transport-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-transport-revision value must be a non-negative safe integer."
              .to_string(),
          );
        }
        expected_revision = Some(revision);
        index += 2;
      }
      value => return Err(format!("Unexpected transport argument: {value}")),
    }
  }
  if !json {
    return Err("The app transport command requires --json.".to_string());
  }
  Ok(CliAppCommand::TransportMutation {
    method,
    target_key,
    target,
    expected_revision,
    allow_stop_file_analysis,
    dry_run,
  })
}

fn parse_wait_args(args: &[String]) -> Result<CliAppCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(CliAppCommand::Help);
  }
  let mut workspace_revision = None;
  let mut presets_revision = None;
  let mut settings_revision = None;
  let mut transport_revision = None;
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
    let target = match option {
      "--workspace-revision" => &mut workspace_revision,
      "--presets-revision" => &mut presets_revision,
      "--settings-revision" => &mut settings_revision,
      "--transport-revision" => &mut transport_revision,
      "--timeout-ms" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --timeout-ms.".to_string())?;
        timeout_ms = raw
          .parse::<u64>()
          .map_err(|_| "The --timeout-ms value must be an integer.".to_string())?;
        index += 2;
        continue;
      }
      value => return Err(format!("Unknown wait option: {value}")),
    };
    let raw = args
      .get(index + 1)
      .ok_or_else(|| format!("Missing value for {option}."))?;
    let revision = raw
      .parse::<u64>()
      .map_err(|_| format!("The {option} value must be a non-negative safe integer."))?;
    if revision > MAX_SAFE_REVISION {
      return Err(format!(
        "The {option} value must be a non-negative safe integer."
      ));
    }
    *target = Some(revision);
    index += 2;
  }
  if !json {
    return Err("The app wait command requires --json.".to_string());
  }
  if workspace_revision.is_none()
    && presets_revision.is_none()
    && settings_revision.is_none()
    && transport_revision.is_none()
  {
    return Err("The app wait command requires at least one revision baseline.".to_string());
  }
  if !(100..=300_000).contains(&timeout_ms) {
    return Err("The --timeout-ms value must be from 100 to 300000.".to_string());
  }
  Ok(CliAppCommand::Wait {
    workspace_revision,
    presets_revision,
    settings_revision,
    transport_revision,
    timeout_ms,
  })
}

fn parse_settings_args(args: &[String]) -> Result<CliAppCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(CliAppCommand::Help);
  }
  match args {
    [command, json] if command == "describe" && json == "--json" => {
      return Ok(CliAppCommand::SettingsDescribe);
    }
    [command, json] if command == "inspect" && json == "--json" => {
      return Ok(CliAppCommand::SettingsInspect);
    }
    [command, ..] if command == "describe" || command == "inspect" => {
      return Err(format!(
        "The app settings {command} command requires --json."
      ));
    }
    _ => {}
  }
  const USAGE: &str = "Usage: plvs-cli app settings update <file|-> --json [--expected-settings-revision <n>] [--allow-measurement-restart] [--dry-run]";
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
      "--expected-settings-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-settings-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-settings-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-settings-revision value must be a non-negative safe integer."
              .to_string(),
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
    return Err("The app settings update command requires --json.".to_string());
  }
  Ok(CliAppCommand::SettingsUpdate {
    input: input.ok_or_else(|| USAGE.to_string())?,
    expected_revision,
    allow_measurement_restart,
    dry_run,
  })
}

fn parse_workspace_args(args: &[String]) -> Result<CliAppCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(CliAppCommand::Help);
  }
  if args.first().map(String::as_str) != Some("apply") {
    return Err(
      "Usage: plvs-cli app workspace apply <file|-> --json [--expected-revision <n>] [--dry-run]"
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
    return Err("The app workspace apply command requires --json.".to_string());
  }
  let input = input.ok_or_else(|| {
    "Usage: plvs-cli app workspace apply <file|-> --json [--expected-revision <n>] [--dry-run]"
      .to_string()
  })?;
  Ok(CliAppCommand::WorkspaceApply {
    input,
    expected_revision,
    dry_run,
  })
}

fn parse_panel_args(args: &[String]) -> Result<CliAppCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(CliAppCommand::Help);
  }
  const UPDATE_USAGE: &str =
    "Usage: plvs-cli app panel update <panel-id> <file|-> --json [--expected-revision <n>] [--dry-run]";
  const RESET_USAGE: &str =
    "Usage: plvs-cli app panel reset <panel-id> --json [--expected-revision <n>] [--dry-run]";
  const DESCRIBE_USAGE: &str = "Usage: plvs-cli app panel describe <panel-id> --json";
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
      "The app panel {} command requires --json.",
      action.unwrap()
    ));
  }
  let expected_positionals = if action == Some("update") { 2 } else { 1 };
  if positionals.len() != expected_positionals || positionals[0].trim().is_empty() {
    return Err(usage.to_string());
  }
  match action {
    Some("update") => Ok(CliAppCommand::PanelUpdate {
      panel_id: positionals[0].clone(),
      input: positionals[1].clone(),
      expected_revision,
      dry_run,
    }),
    Some("reset") => Ok(CliAppCommand::PanelReset {
      panel_id: positionals[0].clone(),
      expected_revision,
      dry_run,
    }),
    Some("describe") => Ok(CliAppCommand::PanelDescribe {
      panel_id: positionals[0].clone(),
    }),
    _ => unreachable!("panel action was validated above"),
  }
}

fn parse_axis_args(args: &[String]) -> Result<CliAppCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(CliAppCommand::Help);
  }
  match args {
    [command, json] if (command == "describe" || command == "inspect") && json == "--json" => {
      return Ok(if command == "describe" {
        CliAppCommand::AxisDescribe
      } else {
        CliAppCommand::AxisInspect
      });
    }
    [command, ..] if command == "describe" || command == "inspect" => {
      return Err(format!("The app axis {command} command requires --json."));
    }
    _ => {}
  }

  const USAGE: &str = "Usage:\n  plvs-cli app axis shared update <frequency|time> <file|-> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app axis shared reset <frequency|time> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app axis panel update <panel-id> <frequency|time> <file|-> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app axis panel reset <panel-id> <frequency|time> --json [--expected-workspace-revision <n>] [--dry-run]";
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
      "--expected-workspace-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-workspace-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-workspace-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-workspace-revision value must be a non-negative safe integer."
              .to_string(),
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
      "The app axis {} {} command requires --json.",
      scope.unwrap(),
      action.unwrap()
    ));
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
    (Some("shared"), Some("update")) => Ok(CliAppCommand::AxisSharedUpdate {
      kind: positionals[0].clone(),
      input: positionals[1].clone(),
      expected_revision,
      dry_run,
    }),
    (Some("shared"), Some("reset")) => Ok(CliAppCommand::AxisSharedReset {
      kind: positionals[0].clone(),
      expected_revision,
      dry_run,
    }),
    (Some("panel"), Some("update")) => Ok(CliAppCommand::AxisPanelUpdate {
      panel_id: positionals[0].clone(),
      kind: positionals[1].clone(),
      input: positionals[2].clone(),
      expected_revision,
      dry_run,
    }),
    (Some("panel"), Some("reset")) => Ok(CliAppCommand::AxisPanelReset {
      panel_id: positionals[0].clone(),
      kind: positionals[1].clone(),
      expected_revision,
      dry_run,
    }),
    _ => unreachable!("axis command was validated above"),
  }
}

fn parse_preset_args(args: &[String]) -> Result<CliAppCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(CliAppCommand::Help);
  }
  match args {
    [command, json] if command == "list" && json == "--json" => {
      return Ok(CliAppCommand::PresetList);
    }
    [command, ..] if command == "list" => {
      return Err("The app preset list command requires --json.".to_string());
    }
    _ => {}
  }
  const USAGE: &str = "Usage: plvs-cli app preset <describe|save|apply|update|rename|delete|reorder> ... --json [--expected-workspace-revision <n>] [--expected-presets-revision <n>] [--dry-run]";
  let command = args
    .first()
    .map(String::as_str)
    .ok_or_else(|| USAGE.to_string())?;
  if !matches!(
    command,
    "describe" | "save" | "apply" | "update" | "rename" | "delete" | "reorder"
  ) {
    return Err(USAGE.to_string());
  }
  let mut positionals = Vec::new();
  let mut expected_workspace_revision = None;
  let mut expected_presets_revision = None;
  let mut json = false;
  let mut dry_run = false;
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--expected-presets-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-presets-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-presets-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-presets-revision value must be a non-negative safe integer."
              .to_string(),
          );
        }
        expected_presets_revision = Some(revision);
        index += 2;
      }
      "--expected-workspace-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-workspace-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-workspace-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-workspace-revision value must be a non-negative safe integer."
              .to_string(),
          );
        }
        expected_workspace_revision = Some(revision);
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
    return Err(format!("The app preset {command} command requires --json."));
  }
  let expected_positionals = if command == "rename" { 2 } else { 1 };
  if positionals.len() != expected_positionals
    || positionals.iter().any(|value| value.trim().is_empty())
  {
    return Err(USAGE.to_string());
  }
  if command != "save"
    && command != "apply"
    && command != "update"
    && expected_workspace_revision.is_some()
  {
    return Err(format!(
      "The app preset {command} command does not accept --expected-workspace-revision."
    ));
  }
  if command == "describe" && dry_run {
    return Err("The app preset describe command does not accept --dry-run.".to_string());
  }
  Ok(match command {
    "describe" => CliAppCommand::PresetDescribe {
      preset_id: positionals.remove(0),
      expected_revision: expected_presets_revision,
    },
    "save" => CliAppCommand::PresetSave {
      name: positionals.remove(0),
      expected_workspace_revision,
      expected_presets_revision,
      dry_run,
    },
    "update" => CliAppCommand::PresetUpdate {
      preset_id: positionals.remove(0),
      expected_workspace_revision,
      expected_presets_revision,
      dry_run,
    },
    "apply" => CliAppCommand::PresetApply {
      preset_id: positionals.remove(0),
      expected_workspace_revision,
      expected_presets_revision,
      dry_run,
    },
    "rename" => CliAppCommand::PresetRename {
      preset_id: positionals.remove(0),
      name: positionals.remove(0),
      expected_presets_revision,
      dry_run,
    },
    "delete" => CliAppCommand::PresetDelete {
      preset_id: positionals.remove(0),
      expected_presets_revision,
      dry_run,
    },
    "reorder" => CliAppCommand::PresetReorder {
      input: positionals.remove(0),
      expected_presets_revision,
      dry_run,
    },
    _ => unreachable!("preset command was validated above"),
  })
}

fn is_help(value: &str) -> bool {
  matches!(value, "--help" | "-h" | "help")
}

fn base_help_text() -> &'static str {
  "PLVS CLI - development app control\n\nUsage:\n  plvs-cli app capabilities --json\n  plvs-cli app inspect --json\n  plvs-cli app workspace apply <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli app panel describe <panel-id> --json\n  plvs-cli app panel update <panel-id> <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli app panel reset <panel-id> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli app axis describe --json\n  plvs-cli app axis inspect --json\n  plvs-cli app axis shared update <frequency|time> <file|-> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app axis shared reset <frequency|time> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app axis panel update <panel-id> <frequency|time> <file|-> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app axis panel reset <panel-id> <frequency|time> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app preset list --json\n  plvs-cli app preset describe <preset-id> --json [--expected-presets-revision <n>]\n  plvs-cli app preset save <name> --json [--expected-workspace-revision <n>] [--expected-presets-revision <n>] [--dry-run]\n  plvs-cli app preset update <preset-id> --json [--expected-workspace-revision <n>] [--expected-presets-revision <n>] [--dry-run]\n  plvs-cli app preset apply <preset-id> --json [--expected-workspace-revision <n>] [--expected-presets-revision <n>] [--dry-run]\n  plvs-cli app preset rename <preset-id> <name> --json [--expected-presets-revision <n>] [--dry-run]\n  plvs-cli app preset delete <preset-id> --json [--expected-presets-revision <n>] [--dry-run]\n  plvs-cli app preset reorder <file|-> --json [--expected-presets-revision <n>] [--dry-run]\n  plvs-cli app settings describe --json\n  plvs-cli app settings inspect --json\n  plvs-cli app settings update <file|-> --json [--expected-settings-revision <n>] [--allow-measurement-restart] [--dry-run]\n  plvs-cli app wait <--workspace-revision <n>|--presets-revision <n>|--settings-revision <n>|--transport-revision <n>> [--timeout-ms <n>] --json\n  plvs-cli app transport inspect --json\n  plvs-cli app transport source <live|file> --json [--expected-transport-revision <n>] [--allow-stop-file-analysis] [--dry-run]\n  plvs-cli app transport live <start|stop|clear> --json [--expected-transport-revision <n>] [--allow-stop-file-analysis] [--dry-run]\n  plvs-cli app transport file analyze <path> --json [--expected-transport-revision <n>] [--dry-run]\n  plvs-cli app transport file <reanalyze|stop|select|remove> <session-id> --json [--expected-transport-revision <n>] [--dry-run]\n  plvs-cli app transport file clear --json [--expected-transport-revision <n>] [--dry-run]\n\nControls the already-running PLVS Dev GUI through its authenticated local endpoint.\nUse - to read one JSON document from stdin. This command family is available\nonly in a dev-identity build; it does not launch PLVS and does not use PATH discovery.\n\nExit codes:\n  0  command completed successfully\n  1  the running app returned a valid command error\n  2  invalid input, discovery, authentication, or transport failure"
}

pub fn help_text() -> &'static str {
  static HELP: std::sync::OnceLock<String> = std::sync::OnceLock::new();
  HELP
    .get_or_init(|| {
      base_help_text().replacen(
        "\n\nControls the already-running",
        "\n  plvs-cli app dock describe --json\n  plvs-cli app dock inspect --json\n  plvs-cli app dock enter [--edge top|bottom] [--monitor <id>] [--reserve-space true|false] [--height <n>] --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app dock exit --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app dock layout apply <file|-> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app dock panel describe <panel-id> --json\n  plvs-cli app dock panel update <panel-id> <file|-> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app dock panel reset <panel-id> --json [--expected-workspace-revision <n>] [--dry-run]\n\nControls the already-running",
        1,
      )
    })
    .as_str()
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
  protocol_version: u32,
  response: Value,
}

trait ControlClient {
  fn call(&self, request: JsonRpcRequest) -> Result<AppCall, CliAppFailure>;
}

struct LocalControlClient;

impl ControlClient for LocalControlClient {
  fn call(&self, request: JsonRpcRequest) -> Result<AppCall, CliAppFailure> {
    let path = descriptor_path()
      .map_err(|error| CliAppFailure::transport("appNotRunning", error.to_string(), None))?;
    let descriptor = read_descriptor_at(&path, env!("PLVS_APP_ID"), |_| true).map_err(|error| {
      let reason = match error.kind {
        DiscoveryErrorKind::Missing | DiscoveryErrorKind::Malformed | DiscoveryErrorKind::Stale => {
          "appNotRunning"
        }
        DiscoveryErrorKind::Unavailable | DiscoveryErrorKind::Io => "discoveryFailed",
      };
      CliAppFailure::transport(reason, error.to_string(), None)
    })?;
    call_descriptor(&descriptor, &request)
  }
}

#[cfg(target_os = "windows")]
fn call_descriptor(
  descriptor: &AgentControlDescriptor,
  request: &JsonRpcRequest,
) -> Result<AppCall, CliAppFailure> {
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
    let reason = match error.reason {
      crate::agent_control::windows_pipe::PipeErrorReason::Unauthorized => "authenticationFailed",
      crate::agent_control::windows_pipe::PipeErrorReason::ConnectionFailed => "appNotRunning",
      crate::agent_control::windows_pipe::PipeErrorReason::IoTimeout => "timeout",
      _ => "transportFailed",
    };
    CliAppFailure::transport(reason, error.to_string(), Some(descriptor.app.clone()))
  })?;
  Ok(AppCall {
    app: descriptor.app.clone(),
    protocol_version: descriptor.protocol_version,
    response,
  })
}

#[cfg(not(target_os = "windows"))]
fn call_descriptor(
  descriptor: &AgentControlDescriptor,
  _request: &JsonRpcRequest,
) -> Result<AppCall, CliAppFailure> {
  Err(CliAppFailure::transport(
    "transportUnavailable",
    "Live app control is currently available only on Windows.",
    Some(descriptor.app.clone()),
  ))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliAppError {
  reason: String,
  message: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  details: Option<Value>,
}

#[derive(Debug, Clone)]
struct CliAppFailure {
  error: Box<CliAppError>,
  app: Option<DescriptorApp>,
  exit_code: u8,
}

impl CliAppFailure {
  fn transport(reason: &str, message: impl Into<String>, app: Option<DescriptorApp>) -> Self {
    Self {
      error: Box::new(CliAppError {
        reason: reason.to_string(),
        message: message.into(),
        details: None,
      }),
      app,
      exit_code: 2,
    }
  }

  fn app(app: DescriptorApp, error: CliAppError) -> Self {
    Self {
      error: Box::new(error),
      app: Some(app),
      exit_code: 1,
    }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CliAppReport {
  schema_version: u32,
  command: String,
  status: &'static str,
  #[serde(skip_serializing_if = "Option::is_none")]
  app: Option<DescriptorApp>,
  protocol_version: u32,
  #[serde(skip_serializing_if = "Option::is_none")]
  result: Option<Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<CliAppError>,
}

fn command_name(command: &CliAppCommand) -> &str {
  match command {
    CliAppCommand::Help => "app.help",
    CliAppCommand::Capabilities => "app.capabilities",
    CliAppCommand::Inspect => "app.inspect",
    CliAppCommand::PanelDescribe { .. } => "panel.describe",
    CliAppCommand::WorkspaceApply { .. } => "workspace.applyLayout",
    CliAppCommand::PanelUpdate { .. } => "panel.update",
    CliAppCommand::PanelReset { .. } => "panel.reset",
    CliAppCommand::AxisDescribe => "axis.describe",
    CliAppCommand::AxisInspect => "axis.inspect",
    CliAppCommand::AxisSharedUpdate { .. } => "axis.shared.update",
    CliAppCommand::AxisSharedReset { .. } => "axis.shared.reset",
    CliAppCommand::AxisPanelUpdate { .. } => "axis.panel.update",
    CliAppCommand::AxisPanelReset { .. } => "axis.panel.reset",
    CliAppCommand::PresetList => "preset.list",
    CliAppCommand::PresetDescribe { .. } => "preset.describe",
    CliAppCommand::PresetSave { .. } => "preset.save",
    CliAppCommand::PresetUpdate { .. } => "preset.update",
    CliAppCommand::PresetApply { .. } => "preset.apply",
    CliAppCommand::PresetRename { .. } => "preset.rename",
    CliAppCommand::PresetDelete { .. } => "preset.delete",
    CliAppCommand::PresetReorder { .. } => "preset.reorder",
    CliAppCommand::SettingsDescribe => "settings.describe",
    CliAppCommand::SettingsInspect => "settings.inspect",
    CliAppCommand::TransportInspect => "transport.inspect",
    CliAppCommand::TransportMutation { method, .. } => method,
    CliAppCommand::DockRead { method } | CliAppCommand::DockCommand { method, .. } => method,
    CliAppCommand::SettingsUpdate { .. } => "settings.update",
    CliAppCommand::Wait { .. } => "app.wait",
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
  command: &CliAppCommand,
  stdin: &mut R,
) -> Result<JsonRpcRequest, CliAppFailure> {
  let method = command_name(command);
  let params = match command {
    CliAppCommand::Capabilities
    | CliAppCommand::Inspect
    | CliAppCommand::AxisDescribe
    | CliAppCommand::AxisInspect
    | CliAppCommand::PresetList
    | CliAppCommand::SettingsDescribe
    | CliAppCommand::SettingsInspect
    | CliAppCommand::TransportInspect => serde_json::json!({}),
    CliAppCommand::DockRead { .. } => serde_json::json!({}),
    CliAppCommand::DockCommand {
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
        let document = read_json_document(input, stdin, subject)
          .map_err(|error| CliAppFailure::transport("invalidInput", error, None))?;
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
          params.insert(
            "expectedWorkspaceRevision".to_string(),
            Value::from(*revision),
          );
        }
      }
      Value::Object(params)
    }
    CliAppCommand::TransportMutation {
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
            CliAppFailure::transport(
              "invalidInput",
              format!("Unable to resolve audio path {value}: {error}"),
              None,
            )
          })?;
          Value::String(canonical.to_string_lossy().into_owned())
        } else {
          Value::String(value.clone())
        };
        params.insert(key.clone(), value);
      }
      params.insert("dryRun".to_string(), Value::Bool(*dry_run));
      if let Some(revision) = expected_revision {
        params.insert(
          "expectedTransportRevision".to_string(),
          Value::from(*revision),
        );
      }
      if *allow_stop_file_analysis {
        params.insert("allowStopFileAnalysis".to_string(), Value::Bool(true));
      }
      Value::Object(params)
    }
    CliAppCommand::PresetDescribe {
      preset_id,
      expected_revision,
    } => {
      let mut params =
        serde_json::Map::from_iter([("presetId".to_string(), Value::String(preset_id.clone()))]);
      if let Some(revision) = expected_revision {
        params.insert(
          "expectedPresetsRevision".to_string(),
          Value::from(*revision),
        );
      }
      Value::Object(params)
    }
    CliAppCommand::PresetSave {
      name,
      expected_workspace_revision,
      expected_presets_revision,
      dry_run,
    } => preset_mutation_params(
      [("name", Value::String(name.clone()))],
      *expected_workspace_revision,
      *expected_presets_revision,
      *dry_run,
    ),
    CliAppCommand::PresetUpdate {
      preset_id,
      expected_workspace_revision,
      expected_presets_revision,
      dry_run,
    } => preset_mutation_params(
      [("presetId", Value::String(preset_id.clone()))],
      *expected_workspace_revision,
      *expected_presets_revision,
      *dry_run,
    ),
    CliAppCommand::PresetApply {
      preset_id,
      expected_workspace_revision,
      expected_presets_revision,
      dry_run,
    } => preset_mutation_params(
      [("presetId", Value::String(preset_id.clone()))],
      *expected_workspace_revision,
      *expected_presets_revision,
      *dry_run,
    ),
    CliAppCommand::PresetRename {
      preset_id,
      name,
      expected_presets_revision,
      dry_run,
    } => preset_mutation_params(
      [
        ("presetId", Value::String(preset_id.clone())),
        ("name", Value::String(name.clone())),
      ],
      None,
      *expected_presets_revision,
      *dry_run,
    ),
    CliAppCommand::PresetDelete {
      preset_id,
      expected_presets_revision,
      dry_run,
    } => preset_mutation_params(
      [("presetId", Value::String(preset_id.clone()))],
      None,
      *expected_presets_revision,
      *dry_run,
    ),
    CliAppCommand::PresetReorder {
      input,
      expected_presets_revision,
      dry_run,
    } => {
      let document = read_json_document(input, stdin, "preset order")
        .map_err(|error| CliAppFailure::transport("invalidInput", error, None))?;
      let preset_ids = document
        .as_object()
        .and_then(|object| object.get("presetIds"))
        .cloned()
        .ok_or_else(|| {
          CliAppFailure::transport(
            "invalidInput",
            "Preset order JSON must be an object containing presetIds.".to_string(),
            None,
          )
        })?;
      preset_mutation_params(
        [("presetIds", preset_ids)],
        None,
        *expected_presets_revision,
        *dry_run,
      )
    }
    CliAppCommand::SettingsUpdate {
      input,
      expected_revision,
      allow_measurement_restart,
      dry_run,
    } => {
      let patch = read_json_document(input, stdin, "Settings patch")
        .map_err(|error| CliAppFailure::transport("invalidInput", error, None))?;
      let mut params = serde_json::Map::from_iter([
        ("patch".to_string(), patch),
        ("dryRun".to_string(), Value::Bool(*dry_run)),
        (
          "allowMeasurementRestart".to_string(),
          Value::Bool(*allow_measurement_restart),
        ),
      ]);
      if let Some(revision) = expected_revision {
        params.insert(
          "expectedSettingsRevision".to_string(),
          Value::from(*revision),
        );
      }
      Value::Object(params)
    }
    CliAppCommand::Wait {
      workspace_revision,
      presets_revision,
      settings_revision,
      transport_revision,
      timeout_ms,
    } => {
      let mut params = serde_json::Map::new();
      for (key, revision) in [
        ("workspaceRevision", workspace_revision),
        ("presetsRevision", presets_revision),
        ("settingsRevision", settings_revision),
        ("transportRevision", transport_revision),
      ] {
        if let Some(revision) = revision {
          params.insert(key.to_string(), Value::from(*revision));
        }
      }
      params.insert("timeoutMs".to_string(), Value::from(*timeout_ms));
      Value::Object(params)
    }
    CliAppCommand::PanelDescribe { panel_id } => {
      serde_json::json!({ "panelId": panel_id })
    }
    CliAppCommand::WorkspaceApply {
      input,
      expected_revision,
      dry_run,
    } => {
      let layout = read_layout(input, stdin)
        .map_err(|error| CliAppFailure::transport("invalidInput", error, None))?;
      let mut params = serde_json::Map::from_iter([
        ("layout".to_string(), layout),
        ("dryRun".to_string(), Value::Bool(*dry_run)),
      ]);
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
      Value::Object(params)
    }
    CliAppCommand::PanelUpdate {
      panel_id,
      input,
      expected_revision,
      dry_run,
    } => {
      let patch = read_json_document(input, stdin, "panel controls")
        .map_err(|error| CliAppFailure::transport("invalidInput", error, None))?;
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
    CliAppCommand::PanelReset {
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
    CliAppCommand::AxisSharedUpdate {
      kind,
      input,
      expected_revision,
      dry_run,
    } => {
      let range = read_json_document(input, stdin, "axis range")
        .map_err(|error| CliAppFailure::transport("invalidInput", error, None))?;
      mutation_params(
        [("kind", Value::String(kind.clone())), ("range", range)],
        *expected_revision,
        *dry_run,
      )
    }
    CliAppCommand::AxisSharedReset {
      kind,
      expected_revision,
      dry_run,
    } => mutation_params(
      [("kind", Value::String(kind.clone()))],
      *expected_revision,
      *dry_run,
    ),
    CliAppCommand::AxisPanelUpdate {
      panel_id,
      kind,
      input,
      expected_revision,
      dry_run,
    } => {
      let patch = read_json_document(input, stdin, "panel axis")
        .map_err(|error| CliAppFailure::transport("invalidInput", error, None))?;
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
    CliAppCommand::AxisPanelReset {
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
    CliAppCommand::Help => unreachable!("help does not create a request"),
  };
  Ok(JsonRpcRequest {
    id: format!(
      "cli-{}-{}",
      std::process::id(),
      REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ),
    method: method.to_string(),
    params,
  })
}

fn preset_mutation_params<const N: usize>(
  fields: [(&str, Value); N],
  expected_workspace_revision: Option<u64>,
  expected_presets_revision: Option<u64>,
  dry_run: bool,
) -> Value {
  let mut params = serde_json::Map::from_iter(
    fields
      .into_iter()
      .map(|(key, value)| (key.to_string(), value)),
  );
  params.insert("dryRun".to_string(), Value::Bool(dry_run));
  if let Some(revision) = expected_workspace_revision {
    params.insert(
      "expectedWorkspaceRevision".to_string(),
      Value::from(revision),
    );
  }
  if let Some(revision) = expected_presets_revision {
    params.insert("expectedPresetsRevision".to_string(), Value::from(revision));
  }
  Value::Object(params)
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
  command: &CliAppCommand,
  stdin: &mut R,
  client: &dyn ControlClient,
) -> (CliAppReport, u8) {
  let command_label = command_name(command).to_string();
  let request = match request_for_command(command, stdin) {
    Ok(request) => request,
    Err(failure) => {
      return (
        failure_report(command_label, failure.clone()),
        failure.exit_code,
      )
    }
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
        let failure = CliAppFailure::transport(
          "transportFailed",
          "PLVS returned a malformed or mismatched JSON-RPC response.",
          Some(call.app),
        );
        return (failure_report(command_label, failure), 2);
      }
      if let Some(result) = call.response.get("result") {
        return (
          CliAppReport {
            schema_version: 1,
            command: command_label,
            status: "ok",
            app: Some(call.app),
            protocol_version: call.protocol_version,
            result: Some(result.clone()),
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
          CliAppFailure::transport("authenticationFailed", message, Some(call.app))
        } else {
          CliAppFailure::transport(reason, message, Some(call.app))
        };
        return (failure_report(command_label, failure), 2);
      }
      let error = CliAppError {
        reason: reason.to_string(),
        message: rpc_error
          .get("message")
          .and_then(Value::as_str)
          .unwrap_or("PLVS rejected the command.")
          .to_string(),
        details: public_error_details(rpc_error.get("data").unwrap_or(&Value::Null)),
      };
      let failure = CliAppFailure::app(call.app, error);
      (failure_report(command_label, failure), 1)
    }
    Err(failure) => {
      let exit_code = failure.exit_code;
      (failure_report(command_label, failure), exit_code)
    }
  }
}

fn failure_report(command: String, failure: CliAppFailure) -> CliAppReport {
  CliAppReport {
    schema_version: 1,
    command,
    status: "error",
    app: failure.app,
    protocol_version: 1,
    result: None,
    error: Some(*failure.error),
  }
}

pub fn run(command: CliAppCommand) -> ExitCode {
  if command == CliAppCommand::Help {
    println!("{}", help_text());
    return ExitCode::SUCCESS;
  }
  let (report, exit_code) = execute(&command, &mut io::stdin().lock(), &LocalControlClient);
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
      parse_app_args(&args(&["capabilities", "--json"])),
      Ok(CliAppCommand::Capabilities)
    );
    assert_eq!(
      parse_app_args(&args(&["inspect", "--json"])),
      Ok(CliAppCommand::Inspect)
    );
    assert!(parse_app_args(&args(&["inspect"])).is_err());
  }

  #[test]
  fn parses_workspace_apply_and_rejects_unsafe_or_ambiguous_input() {
    assert_eq!(
      parse_app_args(&args(&[
        "workspace",
        "apply",
        "layout.json",
        "--json",
        "--expected-revision",
        "42",
        "--dry-run"
      ])),
      Ok(CliAppCommand::WorkspaceApply {
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
      assert!(parse_app_args(&invalid).is_err());
    }
  }

  #[test]
  fn parses_panel_update_and_its_concurrency_options() {
    assert_eq!(
      parse_app_args(&args(&[
        "panel",
        "update",
        "levelMeter",
        "controls.json",
        "--json",
        "--expected-revision",
        "7",
        "--dry-run"
      ])),
      Ok(CliAppCommand::PanelUpdate {
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
      assert!(parse_app_args(&invalid).is_err());
    }
  }

  #[test]
  fn builds_panel_update_request_from_stdin() {
    let command = CliAppCommand::PanelUpdate {
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
      parse_app_args(&args(&[
        "panel",
        "reset",
        "spectrum",
        "--json",
        "--expected-revision",
        "8",
        "--dry-run"
      ])),
      Ok(CliAppCommand::PanelReset {
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
      assert!(parse_app_args(&invalid).is_err());
    }
  }

  #[test]
  fn builds_panel_reset_request_without_an_input_document() {
    let command = CliAppCommand::PanelReset {
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
    let command = parse_app_args(&args(&["panel", "describe", "spectrum", "--json"])).unwrap();
    assert_eq!(
      command,
      CliAppCommand::PanelDescribe {
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
      assert!(parse_app_args(&invalid).is_err());
    }
  }

  #[test]
  fn parses_axis_read_and_mutation_commands() {
    assert_eq!(
      parse_app_args(&args(&["axis", "describe", "--json"])),
      Ok(CliAppCommand::AxisDescribe)
    );
    assert_eq!(
      parse_app_args(&args(&["axis", "inspect", "--json"])),
      Ok(CliAppCommand::AxisInspect)
    );
    assert_eq!(
      parse_app_args(&args(&[
        "axis",
        "shared",
        "update",
        "frequency",
        "range.json",
        "--json",
        "--expected-workspace-revision",
        "3",
        "--dry-run",
      ])),
      Ok(CliAppCommand::AxisSharedUpdate {
        kind: "frequency".to_string(),
        input: "range.json".to_string(),
        expected_revision: Some(3),
        dry_run: true,
      })
    );
    assert_eq!(
      parse_app_args(&args(&["axis", "shared", "reset", "time", "--json",])),
      Ok(CliAppCommand::AxisSharedReset {
        kind: "time".to_string(),
        expected_revision: None,
        dry_run: false,
      })
    );
    assert_eq!(
      parse_app_args(&args(&[
        "axis",
        "panel",
        "update",
        "spectrum",
        "frequency",
        "axis.json",
        "--json",
      ])),
      Ok(CliAppCommand::AxisPanelUpdate {
        panel_id: "spectrum".to_string(),
        kind: "frequency".to_string(),
        input: "axis.json".to_string(),
        expected_revision: None,
        dry_run: false,
      })
    );
    assert_eq!(
      parse_app_args(&args(&[
        "axis", "panel", "reset", "waveform", "time", "--json",
      ])),
      Ok(CliAppCommand::AxisPanelReset {
        panel_id: "waveform".to_string(),
        kind: "time".to_string(),
        expected_revision: None,
        dry_run: false,
      })
    );
  }

  #[test]
  fn builds_axis_requests_and_reads_update_documents() {
    let shared = request_for_command(
      &CliAppCommand::AxisSharedUpdate {
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
      &CliAppCommand::AxisPanelUpdate {
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
      &CliAppCommand::AxisPanelReset {
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
      args(&[
        "axis",
        "inspect",
        "--expected-workspace-revision",
        "1",
        "--json",
      ]),
    ] {
      assert!(parse_app_args(&invalid).is_err());
    }
  }

  #[test]
  fn parses_and_builds_preset_read_commands() {
    assert_eq!(
      parse_app_args(&args(&["preset", "list", "--json"])),
      Ok(CliAppCommand::PresetList)
    );
    let describe = parse_app_args(&args(&[
      "preset",
      "describe",
      "preset-1",
      "--json",
      "--expected-presets-revision",
      "4",
    ]))
    .unwrap();
    assert_eq!(
      describe,
      CliAppCommand::PresetDescribe {
        preset_id: "preset-1".to_string(),
        expected_revision: Some(4),
      }
    );
    let request = request_for_command(&describe, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "preset.describe");
    assert_eq!(request.params["presetId"], "preset-1");
    assert_eq!(request.params["expectedPresetsRevision"], 4);

    for invalid in [
      args(&["preset", "list"]),
      args(&["preset", "list", "extra", "--json"]),
      args(&["preset", "describe", "--json"]),
      args(&[
        "preset",
        "describe",
        "preset-1",
        "--expected-presets-revision",
        "-1",
        "--json",
      ]),
    ] {
      assert!(parse_app_args(&invalid).is_err());
    }
  }

  #[test]
  fn parses_and_builds_preset_mutation_commands() {
    let save = parse_app_args(&args(&[
      "preset",
      "save",
      "New Mix",
      "--json",
      "--expected-workspace-revision",
      "3",
      "--expected-presets-revision",
      "4",
      "--dry-run",
    ]))
    .unwrap();
    assert_eq!(
      save,
      CliAppCommand::PresetSave {
        name: "New Mix".to_string(),
        expected_workspace_revision: Some(3),
        expected_presets_revision: Some(4),
        dry_run: true,
      }
    );
    let request = request_for_command(&save, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "preset.save");
    assert_eq!(request.params["name"], "New Mix");
    assert_eq!(request.params["expectedWorkspaceRevision"], 3);
    assert_eq!(request.params["expectedPresetsRevision"], 4);
    assert_eq!(request.params["dryRun"], true);

    let update = parse_app_args(&args(&["preset", "update", "preset-1", "--json"])).unwrap();
    assert!(matches!(update, CliAppCommand::PresetUpdate { .. }));
    assert_eq!(
      request_for_command(&update, &mut Cursor::new([]))
        .unwrap()
        .method,
      "preset.update"
    );

    let apply = parse_app_args(&args(&[
      "preset",
      "apply",
      "preset-1",
      "--json",
      "--dry-run",
    ]))
    .unwrap();
    let request = request_for_command(&apply, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "preset.apply");
    assert_eq!(request.params["presetId"], "preset-1");
    assert_eq!(request.params["dryRun"], true);

    let rename = parse_app_args(&args(&[
      "preset",
      "rename",
      "preset-1",
      "Renamed Mix",
      "--json",
    ]))
    .unwrap();
    assert!(matches!(rename, CliAppCommand::PresetRename { .. }));
    let delete = parse_app_args(&args(&["preset", "delete", "preset-1", "--json"])).unwrap();
    assert!(matches!(delete, CliAppCommand::PresetDelete { .. }));

    let reorder = parse_app_args(&args(&[
      "preset",
      "reorder",
      "-",
      "--json",
      "--expected-presets-revision",
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
    assert_eq!(request.params["expectedPresetsRevision"], 7);
    assert_eq!(request.params["dryRun"], false);
  }

  #[test]
  fn rejects_invalid_preset_mutation_arguments() {
    for invalid in [
      args(&["preset", "save", "Mix"]),
      args(&[
        "preset",
        "save",
        "Mix",
        "--json",
        "--expected-workspace-revision",
      ]),
      args(&["preset", "update", "--json"]),
      args(&["preset", "rename", "preset-1", "--json"]),
      args(&["preset", "delete", "preset-1", "extra", "--json"]),
      args(&["preset", "reorder", "--json"]),
      args(&["preset", "reorder", "file.json", "--json", "--unknown"]),
    ] {
      assert!(parse_app_args(&invalid).is_err(), "accepted {invalid:?}");
    }
  }

  #[test]
  fn parses_and_builds_settings_commands() {
    assert_eq!(
      parse_app_args(&args(&["settings", "describe", "--json"])),
      Ok(CliAppCommand::SettingsDescribe)
    );
    assert_eq!(
      parse_app_args(&args(&["settings", "inspect", "--json"])),
      Ok(CliAppCommand::SettingsInspect)
    );
    let update = parse_app_args(&args(&[
      "settings",
      "update",
      "-",
      "--json",
      "--expected-settings-revision",
      "3",
      "--allow-measurement-restart",
      "--dry-run",
    ]))
    .unwrap();
    let mut stdin = Cursor::new(br#"{"interfaceSize":"large"}"#);
    let request = request_for_command(&update, &mut stdin).unwrap();
    assert_eq!(request.method, "settings.update");
    assert_eq!(request.params["patch"]["interfaceSize"], "large");
    assert_eq!(request.params["expectedSettingsRevision"], 3);
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
        "--expected-settings-revision",
        "-1",
      ]),
    ] {
      assert!(parse_app_args(&invalid).is_err(), "accepted {invalid:?}");
    }
  }

  #[test]
  fn parses_and_builds_revision_wait() {
    let command = parse_app_args(&args(&[
      "wait",
      "--workspace-revision",
      "1",
      "--presets-revision",
      "2",
      "--settings-revision",
      "3",
      "--transport-revision",
      "4",
      "--timeout-ms",
      "5000",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(&command, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "app.wait");
    assert_eq!(request.params["workspaceRevision"], 1);
    assert_eq!(request.params["presetsRevision"], 2);
    assert_eq!(request.params["settingsRevision"], 3);
    assert_eq!(request.params["transportRevision"], 4);
    assert_eq!(request.params["timeoutMs"], 5000);

    for invalid in [
      args(&["wait", "--json"]),
      args(&["wait", "--workspace-revision", "0"]),
      args(&[
        "wait",
        "--workspace-revision",
        "0",
        "--timeout-ms",
        "99",
        "--json",
      ]),
    ] {
      assert!(parse_app_args(&invalid).is_err(), "accepted {invalid:?}");
    }
  }

  #[test]
  fn parses_and_builds_transport_commands() {
    assert_eq!(
      parse_app_args(&args(&["transport", "inspect", "--json"])),
      Ok(CliAppCommand::TransportInspect)
    );
    let start = parse_app_args(&args(&[
      "transport",
      "live",
      "start",
      "--expected-transport-revision",
      "4",
      "--allow-stop-file-analysis",
      "--dry-run",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(&start, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "transport.live.start");
    assert_eq!(request.params["expectedTransportRevision"], 4);
    assert_eq!(request.params["allowStopFileAnalysis"], true);
    assert_eq!(request.params["dryRun"], true);

    let select = parse_app_args(&args(&[
      "transport",
      "file",
      "select",
      "session-1",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(&select, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "transport.file.select");
    assert_eq!(request.params["sessionId"], "session-1");

    for invalid in [
      args(&["transport", "inspect"]),
      args(&["transport", "live", "start", "--json", "extra"]),
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
        "--expected-transport-revision",
        "-1",
        "--json",
      ]),
    ] {
      assert!(parse_app_args(&invalid).is_err(), "accepted {invalid:?}");
    }
  }

  #[test]
  fn canonicalizes_transport_analysis_paths_before_transport() {
    let path = std::env::temp_dir().join(format!("plvs-transport-{}.wav", std::process::id()));
    fs::write(&path, []).unwrap();
    let command = CliAppCommand::TransportMutation {
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
  fn parses_and_builds_dock_commands() {
    assert!(help_text().contains("app dock layout apply"));
    assert_eq!(
      parse_app_args(&args(&["dock", "inspect", "--json"])),
      Ok(CliAppCommand::DockRead {
        method: "dock.inspect".to_string(),
      })
    );
    let enter = parse_app_args(&args(&[
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
      "--expected-workspace-revision",
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
    assert_eq!(request.params["expectedWorkspaceRevision"], 3);

    let update =
      parse_app_args(&args(&["dock", "panel", "update", "level", "-", "--json"])).unwrap();
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
      assert!(parse_app_args(&invalid).is_err(), "accepted {invalid:?}");
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
    response: Result<AppCall, CliAppFailure>,
  }

  impl ControlClient for FakeClient {
    fn call(&self, request: JsonRpcRequest) -> Result<AppCall, CliAppFailure> {
      self.response.clone().map(|mut call| {
        call.response["id"] = Value::String(request.id);
        call
      })
    }
  }

  fn app() -> DescriptorApp {
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
    fn call(&self, _request: JsonRpcRequest) -> Result<AppCall, CliAppFailure> {
      Ok(AppCall {
        app: app(),
        protocol_version: 1,
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
        app: app(),
        protocol_version: 1,
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
    let (report, exit) = execute(&CliAppCommand::Inspect, &mut Cursor::new([]), &client);
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(exit, 1);
    assert_eq!(json["error"]["reason"], "invalidControls");
    // The documented path, not `details.details.issues`.
    assert_eq!(json["error"]["details"]["issues"][0]["code"], "outOfRange");
    assert_eq!(json["error"]["details"]["path"], "$.params.patch");
    assert!(json["error"]["details"].get("reason").is_none());
    assert!(json["error"]["details"].get("details").is_none());

    // A payload with nothing but a reason reports no details at all rather than an echo.
    let bare = FakeClient {
      response: Ok(AppCall {
        app: app(),
        protocol_version: 1,
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
    let (report, _) = execute(&CliAppCommand::Inspect, &mut Cursor::new([]), &bare);
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(
      json["error"]["details"],
      serde_json::json!({ "path": "$.params.panelId" })
    );
  }

  #[test]
  fn an_unattributed_server_error_keeps_its_reason_but_a_mismatched_reply_does_not() {
    // No request id could be recovered, so PLVS answered with the empty sentinel. The failure is
    // still real and its reason has to survive.
    let (report, exit) = execute(
      &CliAppCommand::Inspect,
      &mut Cursor::new([]),
      &FixedIdClient {
        response: transport_error("", "invalidEnvelope"),
      },
    );
    assert_eq!(exit, 2);
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(json["error"]["reason"], "invalidEnvelope");

    // A non-empty id that belongs to someone else is a genuinely mismatched reply.
    let (report, exit) = execute(
      &CliAppCommand::Inspect,
      &mut Cursor::new([]),
      &FixedIdClient {
        response: transport_error("someone-elses-request", "frontendNotReady"),
      },
    );
    assert_eq!(exit, 2);
    assert_eq!(
      serde_json::to_value(report).unwrap()["error"]["reason"],
      "transportFailed"
    );
  }

  #[test]
  fn a_failure_below_the_app_exits_two_while_an_app_result_exits_one() {
    // Same reason string on both sides of the boundary: the broker's pending limit versus the
    // frontend refusing a fifth concurrent wait. Only `layer` tells them apart.
    let broker_busy = FakeClient {
      response: Ok(AppCall {
        app: app(),
        protocol_version: 1,
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
    let (report, exit) = execute(&CliAppCommand::Inspect, &mut Cursor::new([]), &broker_busy);
    assert_eq!(exit, 2);
    assert_eq!(
      serde_json::to_value(report).unwrap()["error"]["reason"],
      "busy"
    );

    let frontend_busy = FakeClient {
      response: Ok(AppCall {
        app: app(),
        protocol_version: 1,
        response: serde_json::json!({
          "jsonrpc": "2.0",
          "id": "replaced",
          "error": {
            "code": -32070,
            "message": "Too many revision waits are active.",
            "data": { "reason": "busy" }
          }
        }),
      }),
    };
    let (report, exit) = execute(
      &CliAppCommand::Inspect,
      &mut Cursor::new([]),
      &frontend_busy,
    );
    assert_eq!(exit, 1);
    assert_eq!(
      serde_json::to_value(report).unwrap()["error"]["reason"],
      "busy"
    );
  }

  #[test]
  fn reports_success_app_errors_and_transport_exit_codes_without_tokens() {
    let command = CliAppCommand::Inspect;
    let ok_client = FakeClient {
      response: Ok(AppCall {
        app: app(),
        protocol_version: 1,
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
    assert_eq!(json["status"], "ok");
    assert_eq!(json["result"]["revision"], 4);
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["command"], "app.inspect");

    let app_error = FakeClient {
      response: Ok(AppCall {
        app: app(),
        protocol_version: 1,
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
    assert_eq!(exit, 1);
    assert_eq!(
      serde_json::to_value(report).unwrap()["error"]["reason"],
      "revisionConflict"
    );

    let authentication_error = FakeClient {
      response: Ok(AppCall {
        app: app(),
        protocol_version: 1,
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
      serde_json::to_value(report).unwrap()["error"]["reason"],
      "authenticationFailed"
    );

    let transport = FakeClient {
      response: Err(CliAppFailure::transport(
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
}
