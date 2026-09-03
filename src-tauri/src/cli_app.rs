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
    [command, ..] => return Err(format!("Unknown app subcommand: {command}")),
    [] => {}
  }
  Err("Usage: plvs-cli app <capabilities|inspect|workspace apply|panel|axis> ...".to_string())
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

fn is_help(value: &str) -> bool {
  matches!(value, "--help" | "-h" | "help")
}

pub fn help_text() -> &'static str {
  "PLVS CLI - development app control\n\nUsage:\n  plvs-cli app capabilities --json\n  plvs-cli app inspect --json\n  plvs-cli app workspace apply <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli app panel describe <panel-id> --json\n  plvs-cli app panel update <panel-id> <file|-> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli app panel reset <panel-id> --json [--expected-revision <n>] [--dry-run]\n  plvs-cli app axis describe --json\n  plvs-cli app axis inspect --json\n  plvs-cli app axis shared update <frequency|time> <file|-> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app axis shared reset <frequency|time> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app axis panel update <panel-id> <frequency|time> <file|-> --json [--expected-workspace-revision <n>] [--dry-run]\n  plvs-cli app axis panel reset <panel-id> <frequency|time> --json [--expected-workspace-revision <n>] [--dry-run]\n\nControls the already-running PLVS Dev GUI through its authenticated local endpoint.\nUse - to read one JSON document from stdin. This command family is available\nonly in a dev-identity build; it does not launch PLVS and does not use PATH discovery.\n\nExit codes:\n  0  command completed successfully\n  1  the running app returned a valid command error\n  2  invalid input, discovery, authentication, or transport failure"
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
  let response =
    crate::agent_control::windows_pipe::call(&descriptor.endpoint, &descriptor.token, request)
      .map_err(|error| {
        let reason = match error.reason {
          crate::agent_control::windows_pipe::PipeErrorReason::Unauthorized => {
            "authenticationFailed"
          }
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

fn command_name(command: &CliAppCommand) -> &'static str {
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
    | CliAppCommand::AxisInspect => serde_json::json!({}),
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
      if call.response.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || call.response.get("id").and_then(Value::as_str) != Some(request_id.as_str())
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
      if reason == "unauthorized" {
        let failure = CliAppFailure::transport(
          "authenticationFailed",
          rpc_error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("PLVS rejected the local-control credential."),
          Some(call.app),
        );
        return (failure_report(command_label, failure), 2);
      }
      let error = CliAppError {
        reason: reason.to_string(),
        message: rpc_error
          .get("message")
          .and_then(Value::as_str)
          .unwrap_or("PLVS rejected the command.")
          .to_string(),
        details: rpc_error.get("data").cloned(),
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
            "data": { "reason": "unauthorized" }
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
