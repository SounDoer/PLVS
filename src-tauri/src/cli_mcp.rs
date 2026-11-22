//! `plvs-cli mcp`: the Agent Control MCP adapter.
//!
//! A stdio MCP server that exposes a small, fixed set of generic tools over the existing Agent
//! Control wire protocol. Tool input is the command's manifest `wireParams`, sent as-is through
//! the same client the CLI uses, so discovery, identity, the Agent Control switch, instance
//! selection and every app-side guard behave exactly as they do for `plvs-cli`.
//!
//! Which tool serves a command is derived from the manifest: queries, waits, and the two risk
//! tiers of mutations and actions. A host remembers "always allow" per tool, so keeping risky
//! changes in their own tool means a user who always-allows ordinary changes is still asked
//! before one that cannot be undone.

use std::borrow::Cow;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use rmcp::model::{
  CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
  JsonObject, ListToolsResult, PaginatedRequestParams, ProgressNotificationParam,
  ServerCapabilities, ServerConfig, Tool, ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer, ServerHandler, ServiceExt};
use serde_json::{json, Map, Value};

use crate::cli_control::{call_wire_method, read_staged_artifact};
use crate::cli_manifest::{command_manifest, CommandEntry};

mod files;

/// One wait call never exceeds this. Measured 2026-11: Claude's chat bridge stops a tool call at
/// 80 s and sends no progress token; Codex allowed 240 s. 45 s leaves margin for the request
/// itself on the strictest host, and the agent calls again on `stillWaiting`.
const WAIT_SEGMENT_MS: u64 = 45_000;
/// The wire default when a wait omits `timeoutMs`.
const WIRE_DEFAULT_TIMEOUT_MS: u64 = 30_000;
const PROGRESS_INTERVAL: Duration = Duration::from_secs(10);

const INSTRUCTIONS: &str = "PLVS is a real-time audio metering app running on this computer. \
These tools inspect and control the running PLVS window through Agent Control.\n\
Workflow: call plvs_inspect first and keep its `revision`. Before using an unfamiliar command, \
call plvs_describe with its command ID to read its parameters. Every change needs \
`expectedRevision` set to the latest revision you have; UI navigation also needs \
`expectedUiGeneration` from plvs_inspect with scope \"ui\". Many changes accept `dryRun: true` \
to preview. After a `revisionConflict`, inspect again and reconcile with what the user changed; \
never retry blindly. Use plvs_change for ordinary changes and plvs_change_risky for operations \
that cannot be undone inside PLVS or end the connection; tell the user what a risky operation \
will do before calling it. A wait that returns `stillWaiting` has not failed: call it again with \
the same arguments. If Agent Control is off, ask the user to enable it in PLVS Settings; if PLVS \
is not running, ask the user to open it.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ToolKind {
  Capabilities,
  Inspect,
  Describe,
  Query,
  Wait,
  Screenshot,
  Change,
  ChangeRisky,
}

const TOOL_KINDS: [ToolKind; 8] = [
  ToolKind::Capabilities,
  ToolKind::Inspect,
  ToolKind::Describe,
  ToolKind::Query,
  ToolKind::Wait,
  ToolKind::Screenshot,
  ToolKind::Change,
  ToolKind::ChangeRisky,
];

impl ToolKind {
  fn name(self) -> &'static str {
    match self {
      Self::Capabilities => "plvs_capabilities",
      Self::Inspect => "plvs_inspect",
      Self::Describe => "plvs_describe",
      Self::Query => "plvs_query",
      Self::Wait => "plvs_wait",
      Self::Screenshot => "plvs_screenshot",
      Self::Change => "plvs_change",
      Self::ChangeRisky => "plvs_change_risky",
    }
  }

  fn from_name(name: &str) -> Option<Self> {
    TOOL_KINDS.into_iter().find(|kind| kind.name() == name)
  }
}

/// How MCP reaches one manifest command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Route {
  /// Sent to the running app by this tool.
  Tool(ToolKind),
  /// An offline command whose answer a tool includes (instances, doctor, schema).
  Served(ToolKind),
  /// Deliberately not offered, with the reason.
  Excluded(&'static str),
}

fn route(entry: &CommandEntry) -> Route {
  if entry.execution != "runningApp" || entry.wire_method.is_none() {
    return match entry.id.as_str() {
      "instances.list" | "doctor" => Route::Served(ToolKind::Capabilities),
      "schema.list" | "schema.get" => Route::Served(ToolKind::Describe),
      "completion" => Route::Excluded("shell completion scripts have no use in a chat"),
      "mcp" => Route::Excluded("this server itself"),
      _ => Route::Excluded("offline command without an MCP route"),
    };
  }
  match entry.id.as_str() {
    "app.capabilities" => return Route::Tool(ToolKind::Capabilities),
    "app.inspect" | "ui.inspect" => return Route::Tool(ToolKind::Inspect),
    "visual.screenshot" => return Route::Tool(ToolKind::Screenshot),
    _ => {}
  }
  match (entry.operation.as_str(), entry.risk.as_deref()) {
    ("query", _) => Route::Tool(ToolKind::Query),
    ("wait", _) => Route::Tool(ToolKind::Wait),
    ("mutation" | "action", Some("risky")) => Route::Tool(ToolKind::ChangeRisky),
    ("mutation" | "action", _) => Route::Tool(ToolKind::Change),
    _ => Route::Excluded("unknown operation"),
  }
}

fn tool_for_command(entry: &CommandEntry) -> Option<ToolKind> {
  match route(entry) {
    Route::Tool(kind) => Some(kind),
    Route::Served(_) | Route::Excluded(_) => None,
  }
}

/// The MCP server name a host shows, one per app identity so a user with stable and Preview
/// installed can register both.
fn server_name(app_id: &str) -> &'static str {
  match app_id {
    "com.soundoer.plvs.preview" => "plvs-preview",
    "com.soundoer.plvs.dev" => "plvs-dev",
    _ => "plvs",
  }
}

fn schema(value: Value) -> Arc<JsonObject> {
  match value {
    Value::Object(map) => Arc::new(map),
    _ => Arc::new(Map::new()),
  }
}

fn instance_property() -> Value {
  json!({
    "type": "string",
    "description": "Workbench instance ID. Omit when one PLVS workbench is running; when several \
  are, the error lists them — ask the user which one and pass its ID on every later call."
  })
}

fn command_input_schema(command_help: &str) -> Arc<JsonObject> {
  schema(json!({
    "type": "object",
    "required": ["command"],
    "properties": {
      "command": { "type": "string", "description": command_help },
      "params": {
        "type": "object",
        "description": "The command's wire parameters exactly as plvs_describe reports them."
      },
      "files": {
        "type": "object",
        "additionalProperties": { "type": "string" },
        "description": "Read a JSON document parameter from a local file instead of `params`: map \
  one of the command's `fileFields` (plvs_describe) to an absolute path, e.g. \
  {\"pack\": \"~/Downloads/Studio.plvstheme\"}."
      },
      "saveTo": {
        "type": "string",
        "description": "Save an exported document, report, Statistics CSV or recording to this \
  absolute path or folder, or \"downloads\". Exports and reports are otherwise returned inline; \
  CSV and recordings are always saved, to Downloads by default. The result gives the path as `out`."
      },
      "instance": instance_property()
    }
  }))
}

fn tool(kind: ToolKind, description: &str, input: Arc<JsonObject>) -> Tool {
  let read_only = !matches!(kind, ToolKind::Change | ToolKind::ChangeRisky);
  let annotations = ToolAnnotations::new()
    .read_only(read_only)
    .destructive(kind == ToolKind::ChangeRisky);
  Tool::new(kind.name(), description.to_string(), input).annotate(annotations)
}

fn tool_list() -> Vec<Tool> {
  vec![
    tool(
      ToolKind::Capabilities,
      "Whether PLVS can be controlled and what it supports: app and protocol version, methods \
and features, and the running workbench instances. Set `doctor` for installation health checks.",
      schema(json!({
        "type": "object",
        "properties": {
          "doctor": { "type": "boolean", "default": false },
          "instance": instance_property()
        }
      })),
    ),
    tool(
      ToolKind::Inspect,
      "Snapshot of PLVS state with its current `revision`. scope \"app\" (default): Workspace, \
panels and their controls, Presets, Settings, View, Dock, Transport, Devices, Appearance and \
Loudness Profile. scope \"ui\": open windows, dialogs and editors with `uiGeneration`.",
      schema(json!({
        "type": "object",
        "properties": {
          "scope": { "type": "string", "enum": ["app", "ui"], "default": "app" },
          "instance": instance_property()
        }
      })),
    ),
    tool(
      ToolKind::Describe,
      "Command catalogue. Without `command`: every command ID with its summary and the tool that \
runs it. With `command`: that command's parameters (`wireParams`), revision and dry-run rules.",
      schema(json!({
        "type": "object",
        "properties": {
          "command": { "type": "string", "description": "Command ID, e.g. loudnessProfile.select" }
        }
      })),
    ),
    tool(
      ToolKind::Query,
      "Run a read-only PLVS query by command ID, e.g. measurement.inspect, panel.describe, \
loudnessProfile.list. Changes nothing.",
      command_input_schema("Query command ID from plvs_describe."),
    ),
    tool(
      ToolKind::Wait,
      "Wait for a change: app.wait, measurement.wait, measurement.waitUntil, transport.file.wait \
or visual.recording.wait. Each call waits at most 45 seconds; `stillWaiting` means call again \
with the same arguments.",
      command_input_schema("Wait command ID."),
    ),
    tool(
      ToolKind::Screenshot,
      "Capture a PLVS surface as an image. params.target defaults to {\"kind\":\"main\"}; see \
plvs_describe visual.screenshot for panels and Dock surfaces.",
      schema(json!({
        "type": "object",
        "properties": {
          "params": { "type": "object", "description": "visual.screenshot wire parameters." },
          "instance": instance_property()
        }
      })),
    ),
    tool(
      ToolKind::Change,
      "Make an ordinary change in PLVS by command ID: panels, axes, settings, view, theme and \
loudness profile selection and editing, presets, Dock, devices, transport, windows, UI \
navigation. Requires params.expectedRevision; many accept params.dryRun.",
      command_input_schema("Ordinary mutation or action command ID from plvs_describe."),
    ),
    tool(
      ToolKind::ChangeRisky,
      "Make a change that cannot be undone inside PLVS or that ends the connection: deleting or \
importing library items, overwriting a preset, resetting or importing the configuration, \
resetting layouts or held readings, clearing measurements or File results, discarding an editor \
draft, answering a dialog, installing an update, quitting. Tell the user what will happen first.",
      command_input_schema("Risky mutation or action command ID from plvs_describe."),
    ),
  ]
}

fn text_result(value: &Value, ok: bool) -> CallToolResult {
  let text = serde_json::to_string(value).unwrap_or_default();
  let mut result = if ok {
    CallToolResult::success(vec![ContentBlock::text(text)])
  } else {
    CallToolResult::error(vec![ContentBlock::text(text)])
  };
  result.structured_content = Some(value.clone());
  result
}

fn usage_error(message: impl Into<String>) -> CallToolResult {
  text_result(
    &json!({ "ok": false, "error": { "code": "invalidArguments", "message": message.into() } }),
    false,
  )
}

fn report_ok(report: &Value) -> bool {
  report.get("ok").and_then(Value::as_bool) == Some(true)
}

fn report_result(report: &Value) -> CallToolResult {
  text_result(report, report_ok(report))
}

fn string_arg(arguments: &JsonObject, key: &str) -> Option<String> {
  arguments
    .get(key)
    .and_then(Value::as_str)
    .map(str::to_string)
}

fn params_arg(arguments: &JsonObject) -> Result<Value, String> {
  match arguments.get("params") {
    None | Some(Value::Null) => Ok(Value::Object(Map::new())),
    Some(value @ Value::Object(_)) => Ok(value.clone()),
    Some(_) => Err("`params` must be an object.".to_string()),
  }
}

fn find_command(id: &str) -> Result<&'static CommandEntry, String> {
  let manifest = command_manifest().map_err(str::to_string)?;
  manifest
    .commands
    .iter()
    .find(|entry| entry.id == id)
    .ok_or_else(|| format!("Unknown command `{id}`. Call plvs_describe for the catalogue."))
}

fn describe(arguments: &JsonObject) -> CallToolResult {
  let manifest = match command_manifest() {
    Ok(manifest) => manifest,
    Err(error) => return usage_error(error),
  };
  let Some(id) = string_arg(arguments, "command") else {
    let commands: Vec<Value> = manifest
      .commands
      .iter()
      .filter_map(|entry| {
        tool_for_command(entry)
          .map(|kind| json!({ "command": entry.id, "summary": entry.summary, "tool": kind.name() }))
      })
      .collect();
    return text_result(
      &json!({ "ok": true, "result": { "commands": commands } }),
      true,
    );
  };
  let entry = match find_command(&id) {
    Ok(entry) => entry,
    Err(error) => return usage_error(error),
  };
  match tool_for_command(entry) {
    Some(kind) => text_result(
      &json!({ "ok": true, "result": {
        "command": entry.id,
        "summary": entry.summary,
        "tool": kind.name(),
        "operation": entry.operation,
        "risk": entry.risk,
        "expectedRevision": entry.expected_revision,
        "dryRun": entry.dry_run,
        "params": entry.wire_params,
        "fileFields": files::document_fields(entry),
        "note": "A `schemaRef` names a shape the app describes at runtime; use the family's \
describe query (for example panel.describe or settings.describe) to read it."
      } }),
      true,
    ),
    None => usage_error(match route(entry) {
      Route::Served(kind) => format!("`{id}` is answered by {}.", kind.name()),
      _ => format!("`{id}` is not available through MCP."),
    }),
  }
}

async fn call_blocking(method: String, params: Value, instance: Option<String>) -> Value {
  tokio::task::spawn_blocking(move || call_wire_method(&method, params, instance).0)
    .await
    .unwrap_or_else(|error| internal_error(error.to_string()))
}

fn internal_error(message: String) -> Value {
  json!({ "ok": false, "error": { "code": "internalError", "message": message } })
}

async fn capabilities(arguments: &JsonObject) -> CallToolResult {
  let instance = string_arg(arguments, "instance");
  let want_doctor = arguments
    .get("doctor")
    .and_then(Value::as_bool)
    .unwrap_or(false);
  let mut report = call_blocking("app.capabilities".to_string(), json!({}), instance).await;
  let extras = tokio::task::spawn_blocking(move || {
    let instances = crate::cli_main::read_live_instances()
      .map(|list| serde_json::to_value(list).unwrap_or(Value::Null))
      .unwrap_or_else(|error| json!({ "error": error }));
    let doctor =
      want_doctor.then(|| serde_json::to_value(crate::doctor::run_doctor()).unwrap_or(Value::Null));
    (instances, doctor)
  })
  .await;
  let (instances, doctor) = match extras {
    Ok(extras) => extras,
    Err(error) => (json!({ "error": error.to_string() }), None),
  };
  // Instances and doctor are answered without the app, so they appear even when the app part
  // failed: they are what tells "PLVS is closed" apart from "Agent Control is off".
  if let Some(object) = report.as_object_mut() {
    object.insert("instances".to_string(), instances);
    if let Some(doctor) = doctor {
      object.insert("doctor".to_string(), doctor);
    }
    if let Some(result) = object.get_mut("result").and_then(Value::as_object_mut) {
      result.insert(
        "mcpServerVersion".to_string(),
        Value::String(env!("CARGO_PKG_VERSION").to_string()),
      );
    }
  }
  report_result(&report)
}

/// Sends progress notifications while `work` runs, when the host asked for them.
async fn with_progress<F: std::future::Future<Output = Value>>(
  context: &RequestContext<RoleServer>,
  work: F,
) -> Value {
  let Some(token) = context.meta.get_progress_token() else {
    return work.await;
  };
  let peer = context.peer.clone();
  let ticker = tokio::spawn(async move {
    let mut elapsed = 0.0;
    loop {
      tokio::time::sleep(PROGRESS_INTERVAL).await;
      elapsed += PROGRESS_INTERVAL.as_secs_f64();
      let mut param = ProgressNotificationParam::new(token.clone(), elapsed);
      param.message = Some("Waiting for PLVS".to_string());
      if peer.notify_progress(param).await.is_err() {
        break;
      }
    }
  });
  let value = work.await;
  ticker.abort();
  value
}

/// Caps one wait call at `segment_ms` and returns the timeout actually sent.
fn cap_wait(params: &mut Value, segment_ms: u64) -> u64 {
  let requested = params
    .get("timeoutMs")
    .and_then(Value::as_u64)
    .unwrap_or(WIRE_DEFAULT_TIMEOUT_MS);
  let capped = requested.min(segment_ms);
  params["timeoutMs"] = json!(capped);
  capped
}

/// A segment that ends unsatisfied is progress, not failure: every wait resumes from its own
/// anchor (revision, frame, run or recording ID), so calling again loses nothing.
fn segment_outcome(report: Value, waited_ms: u64) -> Value {
  if report.pointer("/error/code").and_then(Value::as_str) != Some("timeout") {
    return report;
  }
  json!({ "ok": true, "result": {
    "outcome": "stillWaiting",
    "waitedMs": waited_ms,
    "next": "Not finished yet. Call plvs_wait again with the same arguments; tell the user it is \
still in progress if this keeps happening."
  } })
}

async fn run_command(
  kind: ToolKind,
  arguments: &JsonObject,
  context: &RequestContext<RoleServer>,
) -> CallToolResult {
  let Some(id) = string_arg(arguments, "command") else {
    return usage_error("`command` is required.");
  };
  let entry = match find_command(&id) {
    Ok(entry) => entry,
    Err(error) => return usage_error(error),
  };
  match route(entry) {
    Route::Tool(owner) if owner == kind => {}
    Route::Tool(owner) | Route::Served(owner) => {
      return usage_error(format!("`{id}` belongs to {}.", owner.name()));
    }
    Route::Excluded(_) => return usage_error(format!("`{id}` is not available through MCP.")),
  }
  let mut params = match params_arg(arguments) {
    Ok(params) => params,
    Err(error) => return usage_error(error),
  };
  let home = match files::home_dir() {
    Ok(home) => home,
    Err(error) => return usage_error(error),
  };
  if let Err(error) = files::apply_files(entry, arguments, &mut params, &home)
    .and_then(|()| files::normalize_audio_paths(entry, &mut params, &home))
  {
    return usage_error(error);
  }
  let save_to = string_arg(arguments, "saveTo");
  let instance = string_arg(arguments, "instance");
  let method = entry.wire_method.clone().unwrap_or_default();

  let report = if kind == ToolKind::Wait {
    let waited = cap_wait(&mut params, WAIT_SEGMENT_MS);
    let report = with_progress(context, call_blocking(method, params, instance)).await;
    segment_outcome(report, waited)
  } else {
    call_blocking(method, params, instance).await
  };
  let id = entry.id.clone();
  let finished = tokio::task::spawn_blocking(move || {
    let mut report = report;
    save_outputs(&id, &mut report, save_to.as_deref(), &home).map(|()| report)
  })
  .await;
  match finished {
    Ok(Ok(report)) => report_result(&report),
    Ok(Err(error)) => report_result(&internal_error(error)),
    Err(error) => report_result(&internal_error(error.to_string())),
  }
}

/// Text outputs stay in the chat unless `saveTo` asks for a file; Statistics CSV and recordings
/// are always written locally because they do not belong in a conversation.
fn save_outputs(
  id: &str,
  report: &mut Value,
  save_to: Option<&str>,
  home: &std::path::Path,
) -> Result<(), String> {
  if !report_ok(report) {
    return Ok(());
  }
  if matches!(id, "visual.recording.wait" | "visual.recording.stop") {
    if report.pointer("/result/recording/artifact").is_none() {
      return Ok(());
    }
    if let Some(path) = files::destination(save_to, true, "PLVS Recording", "mp4", home)? {
      files::save_recording(report, &path)?;
    }
    return Ok(());
  }
  let Some(spec) = report
    .get("result")
    .and_then(|result| files::output_spec(id, result))
  else {
    return Ok(());
  };
  match files::destination(save_to, spec.always, spec.name, spec.extension, home)? {
    Some(path) => files::save_document(report, spec, &path),
    None => Ok(()),
  }
}

async fn screenshot(arguments: &JsonObject) -> CallToolResult {
  let mut params = match params_arg(arguments) {
    Ok(params) => params,
    Err(error) => return usage_error(error),
  };
  if params.get("target").is_none() {
    params["target"] = json!({ "kind": "main" });
  }
  let instance = string_arg(arguments, "instance");
  let mut report = call_blocking("visual.screenshot".to_string(), params, instance).await;
  if !report_ok(&report) {
    return report_result(&report);
  }
  let Some(artifact) = report.pointer("/result/artifact").cloned() else {
    return usage_error("PLVS returned no screenshot.");
  };
  let bytes =
    match tokio::task::spawn_blocking(move || read_staged_artifact(&artifact, "image/png")).await {
      Ok(Ok(bytes)) => bytes,
      Ok(Err(error)) => return report_result(&internal_error(error)),
      Err(error) => return report_result(&internal_error(error.to_string())),
    };
  if let Some(artifact) = report
    .pointer_mut("/result/artifact")
    .and_then(Value::as_object_mut)
  {
    artifact.remove("stagedPath");
  }
  let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
  let mut result = CallToolResult::success(vec![
    ContentBlock::image(encoded, "image/png"),
    ContentBlock::text(serde_json::to_string(&report).unwrap_or_default()),
  ]);
  result.structured_content = Some(report);
  result
}

struct PlvsMcp;

impl ServerHandler for PlvsMcp {
  fn get_info(&self) -> ServerConfig {
    ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
      .with_server_info(Implementation::new(
        server_name(env!("PLVS_APP_ID")),
        env!("CARGO_PKG_VERSION"),
      ))
      .with_instructions(INSTRUCTIONS)
  }

  async fn list_tools(
    &self,
    _request: Option<PaginatedRequestParams>,
    _context: RequestContext<RoleServer>,
  ) -> Result<ListToolsResult, ErrorData> {
    Ok(ListToolsResult {
      tools: tool_list(),
      ..Default::default()
    })
  }

  async fn call_tool(
    &self,
    request: CallToolRequestParams,
    context: RequestContext<RoleServer>,
  ) -> Result<CallToolResponse, ErrorData> {
    let arguments = request.arguments.clone().unwrap_or_default();
    let name: Cow<'static, str> = request.name.clone();
    let result = match ToolKind::from_name(&name) {
      None => usage_error(format!("Unknown tool `{name}`.")),
      Some(ToolKind::Describe) => describe(&arguments),
      Some(ToolKind::Capabilities) => capabilities(&arguments).await,
      Some(ToolKind::Inspect) => {
        let method = match string_arg(&arguments, "scope").as_deref() {
          None | Some("app") => "app.inspect",
          Some("ui") => "ui.inspect",
          Some(other) => {
            return Ok(usage_error(format!("Unknown inspect scope `{other}`.")).into());
          }
        };
        let instance = string_arg(&arguments, "instance");
        report_result(&call_blocking(method.to_string(), json!({}), instance).await)
      }
      Some(ToolKind::Screenshot) => screenshot(&arguments).await,
      Some(kind) => run_command(kind, &arguments, &context).await,
    };
    Ok(result.into())
  }
}

pub fn run() -> ExitCode {
  let runtime = match tokio::runtime::Builder::new_current_thread()
    .enable_all()
    .build()
  {
    Ok(runtime) => runtime,
    Err(error) => {
      eprintln!("Unable to start the MCP server: {error}");
      return ExitCode::from(1);
    }
  };
  // stdout carries the protocol; anything human-readable goes to stderr.
  runtime.block_on(async move {
    let service = match PlvsMcp.serve(rmcp::transport::stdio()).await {
      Ok(service) => service,
      Err(error) => {
        eprintln!("MCP initialization failed: {error}");
        return ExitCode::from(1);
      }
    };
    match service.waiting().await {
      Ok(_) => ExitCode::SUCCESS,
      Err(error) => {
        eprintln!("MCP server stopped: {error}");
        ExitCode::from(1)
      }
    }
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn entry(id: &str) -> &'static CommandEntry {
    find_command(id).expect("manifest entry")
  }

  #[test]
  fn every_command_has_a_route_and_only_named_offline_commands_are_excluded() {
    let manifest = command_manifest().expect("manifest");
    for entry in &manifest.commands {
      match route(entry) {
        Route::Tool(_) => assert_eq!(entry.execution, "runningApp", "{}", entry.id),
        Route::Served(_) => assert_eq!(entry.execution, "offline", "{}", entry.id),
        Route::Excluded(reason) => assert!(
          matches!(entry.id.as_str(), "completion" | "mcp"),
          "{} is excluded without a decision: {reason}",
          entry.id
        ),
      }
    }
  }

  #[test]
  fn changes_follow_the_manifest_risk_tier() {
    let manifest = command_manifest().expect("manifest");
    for entry in &manifest.commands {
      if matches!(entry.operation.as_str(), "mutation" | "action")
        && entry.id != "visual.screenshot"
      {
        let expected = match entry.risk.as_deref() {
          Some("risky") => ToolKind::ChangeRisky,
          _ => ToolKind::Change,
        };
        assert_eq!(route(entry), Route::Tool(expected), "{}", entry.id);
      }
    }
    assert_eq!(
      route(entry("preset.delete")),
      Route::Tool(ToolKind::ChangeRisky)
    );
    assert_eq!(
      route(entry("loudnessProfile.select")),
      Route::Tool(ToolKind::Change)
    );
  }

  #[test]
  fn read_tools_are_read_only_and_only_the_risky_tool_is_destructive() {
    let tools = tool_list();
    assert_eq!(tools.len(), 8);
    for tool in &tools {
      let annotations = tool.annotations.as_ref().expect("annotations");
      let change = matches!(tool.name.as_ref(), "plvs_change" | "plvs_change_risky");
      assert_eq!(annotations.read_only_hint, Some(!change), "{}", tool.name);
      assert_eq!(
        annotations.destructive_hint,
        Some(tool.name == "plvs_change_risky"),
        "{}",
        tool.name
      );
    }
  }

  #[test]
  fn waits_are_capped_to_one_segment() {
    let mut params = json!({ "afterRevision": 3, "timeoutMs": 300000 });
    assert_eq!(cap_wait(&mut params, WAIT_SEGMENT_MS), WAIT_SEGMENT_MS);
    assert_eq!(params["timeoutMs"], json!(WAIT_SEGMENT_MS));
    let mut short = json!({ "afterRevision": 3, "timeoutMs": 2000 });
    assert_eq!(cap_wait(&mut short, WAIT_SEGMENT_MS), 2000);
    let mut omitted = json!({ "afterRevision": 3 });
    assert_eq!(
      cap_wait(&mut omitted, WAIT_SEGMENT_MS),
      WIRE_DEFAULT_TIMEOUT_MS
    );
  }

  #[test]
  fn a_timed_out_segment_reports_still_waiting_and_other_failures_pass_through() {
    let timed_out = json!({ "ok": false, "error": { "code": "timeout", "message": "x" } });
    let outcome = segment_outcome(timed_out, 45_000);
    assert_eq!(outcome["ok"], json!(true));
    assert_eq!(outcome["result"]["outcome"], json!("stillWaiting"));
    let conflict = json!({ "ok": false, "error": { "code": "revisionConflict" } });
    assert_eq!(segment_outcome(conflict.clone(), 45_000), conflict);
  }

  #[test]
  fn server_names_follow_the_app_identity() {
    assert_eq!(server_name("com.soundoer.plvs"), "plvs");
    assert_eq!(server_name("com.soundoer.plvs.preview"), "plvs-preview");
    assert_eq!(server_name("com.soundoer.plvs.dev"), "plvs-dev");
  }
}
