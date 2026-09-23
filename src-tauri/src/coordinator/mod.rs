use std::{
  fs::{self, File, OpenOptions},
  io::Write,
  path::{Path, PathBuf},
  sync::Mutex,
};

use atomic_write_file::AtomicWriteFile;
use fs4::{FileExt, TryLockError};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::runtime_identity::RuntimeIdentity;

mod commands;
mod registry;
mod restore_grant;

pub use commands::{
  IssuedRuntimeCommand, RuntimeCommand, RuntimeCommandAck, RuntimeCommandMailbox,
  RuntimeOperationCoordinator,
};
pub use registry::{
  summarize_instances, CaptureStatus, InstanceDescriptor, InstanceRegistration, InstanceRegistry,
  InstanceRuntimeState, InstanceSummary,
};
pub use restore_grant::{DiskRestoreGrantAuthority, RestoreGrant, RestoreGrantAuthority};

const COORDINATOR_SCHEMA_VERSION: u32 = 1;
const LOCK_FILE_NAME: &str = "coordinator.lock";
const GENERATION_FILE_NAME: &str = "coordinator-generation.json";
const DESCRIPTOR_FILE_NAME: &str = "coordinator.json";

pub fn coordinator_descriptor_path(identity_root: &Path) -> PathBuf {
  identity_root.join("runtime").join(DESCRIPTOR_FILE_NAME)
}

pub fn read_coordinator_descriptor(identity_root: &Path) -> Result<CoordinatorDescriptor, String> {
  let path = coordinator_descriptor_path(identity_root);
  let bytes = fs::read(&path).map_err(|error| {
    format!(
      "Unable to read coordinator descriptor {}: {error}",
      path.display()
    )
  })?;
  let descriptor: CoordinatorDescriptor = serde_json::from_slice(&bytes).map_err(|error| {
    format!(
      "Unable to parse coordinator descriptor {}: {error}",
      path.display()
    )
  })?;
  if descriptor.schema_version != COORDINATOR_SCHEMA_VERSION
    || descriptor.pid == 0
    || descriptor.instance_id.is_empty()
    || descriptor.workspace_id.is_empty()
  {
    return Err("The coordinator descriptor is invalid.".to_string());
  }
  Ok(descriptor)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorDescriptor {
  pub schema_version: u32,
  pub generation: u64,
  pub pid: u32,
  pub instance_id: String,
  pub workspace_id: String,
}

#[derive(Debug)]
pub struct CoordinatorLease {
  file: Option<File>,
  generation: u64,
  descriptor_path: PathBuf,
}

#[derive(Debug)]
pub struct CoordinatorRole {
  lease: Mutex<Option<CoordinatorLease>>,
}

impl CoordinatorRole {
  pub fn acquire(identity_root: &Path, identity: &RuntimeIdentity) -> Result<Self, String> {
    Ok(Self {
      lease: Mutex::new(CoordinatorLease::try_acquire(identity_root, identity)?),
    })
  }

  pub fn is_coordinator(&self) -> bool {
    self
      .lease
      .lock()
      .expect("coordinator role poisoned")
      .is_some()
  }

  pub fn generation(&self) -> Option<u64> {
    self
      .lease
      .lock()
      .expect("coordinator role poisoned")
      .as_ref()
      .map(CoordinatorLease::generation)
  }

  pub fn try_promote(
    &self,
    identity_root: &Path,
    identity: &RuntimeIdentity,
  ) -> Result<bool, String> {
    let mut lease = self.lease.lock().expect("coordinator role poisoned");
    if lease.is_some() {
      return Ok(false);
    }
    let Some(acquired) = CoordinatorLease::try_acquire(identity_root, identity)? else {
      return Ok(false);
    };
    *lease = Some(acquired);
    Ok(true)
  }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedInstanceState {
  display_name: String,
  is_coordinator: bool,
  coordinator_generation: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceStateUpdate {
  source_label: Option<String>,
  capture_status: String,
  visible: bool,
  focus_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreLaunch {
  pub workspace_id: String,
  pub nonce: String,
}

pub fn parse_restore_launch(args: &[String]) -> Result<Option<RestoreLaunch>, String> {
  let workspace = args
    .windows(2)
    .find(|pair| pair[0] == "--plvs-restore-workspace")
    .map(|pair| pair[1].clone());
  let nonce = args
    .windows(2)
    .find(|pair| pair[0] == "--plvs-restore-nonce")
    .map(|pair| pair[1].clone());
  match (workspace, nonce) {
    (None, None) => Ok(None),
    (Some(workspace_id), Some(nonce)) => Ok(Some(RestoreLaunch {
      workspace_id,
      nonce,
    })),
    _ => Err("Internal workspace restore arguments are incomplete.".to_string()),
  }
}

pub fn restore_missing_workspaces(
  restore_set: &[String],
  live: &[InstanceDescriptor],
  current_workspace_id: &str,
) -> Vec<String> {
  let live: std::collections::HashSet<&str> = live
    .iter()
    .map(|instance| instance.workspace_id.as_str())
    .collect();
  restore_set
    .iter()
    .filter(|workspace_id| {
      workspace_id.as_str() != current_workspace_id && !live.contains(workspace_id.as_str())
    })
    .cloned()
    .collect()
}

fn restore_spawn_delay_for(platform: &str) -> std::time::Duration {
  if platform == "windows" {
    // WebView2 can reject one of several same-profile environments created in the same scheduler
    // slice with E_INVALIDARG. Ordinary launches are naturally separated by user input; restore
    // is the only path that can create several PLVS WebViews at once.
    std::time::Duration::from_millis(1_500)
  } else {
    std::time::Duration::ZERO
  }
}

pub fn start_restore_reconciliation(
  identity_root: &Path,
  current_workspace_id: &str,
  registry: &InstanceRegistry,
  isolated_app_data: Option<&Path>,
) {
  let identity_root = identity_root.to_path_buf();
  let current_workspace_id = current_workspace_id.to_string();
  let registry = registry.clone();
  let isolated_app_data = isolated_app_data.map(Path::to_path_buf);
  let _ = std::thread::Builder::new()
    .name("workspace-restore-reconciliation".to_string())
    .spawn(move || {
      for delay in [
        std::time::Duration::from_secs(8),
        std::time::Duration::from_secs(12),
      ] {
        std::thread::sleep(delay);
        if let Err(error) = registry.remove_stale() {
          log::warn!("Unable to clean stale instances during workspace restore: {error}");
        }
        if let Err(error) = spawn_missing_restored_workspaces(
          &identity_root,
          &current_workspace_id,
          &registry,
          isolated_app_data.as_deref(),
        ) {
          log::warn!("Unable to reconcile saved workspaces: {error}");
        }
      }
    });
}

pub fn spawn_missing_restored_workspaces(
  identity_root: &Path,
  current_workspace_id: &str,
  registry: &InstanceRegistry,
  isolated_app_data: Option<&Path>,
) -> Result<(), String> {
  let restore_set = crate::persistence::WorkspaceCatalog::open(identity_root)?.restore_set()?;
  let live = registry.list()?;
  let authority = DiskRestoreGrantAuthority::open(identity_root)?;
  let executable = std::env::current_exe()
    .map_err(|error| format!("Unable to locate PLVS for workspace restore: {error}"))?;
  let missing = restore_missing_workspaces(&restore_set, &live, current_workspace_id);
  let delay = restore_spawn_delay_for(std::env::consts::OS);
  for (index, workspace_id) in missing.iter().enumerate() {
    let grant = authority.issue(workspace_id, current_unix_time_ms()?)?;
    let mut command = std::process::Command::new(&executable);
    command.args([
      "--plvs-restore-workspace",
      grant.workspace_id(),
      "--plvs-restore-nonce",
      grant.nonce(),
    ]);
    if let Some(path) = isolated_app_data {
      command.arg("--plvs-test-app-data-root").arg(path);
    }
    command
      .stdin(std::process::Stdio::null())
      .stdout(std::process::Stdio::null())
      .stderr(std::process::Stdio::null())
      .spawn()
      .map_err(|error| format!("Unable to restore workspace {workspace_id}: {error}"))?;
    if !delay.is_zero() && index + 1 < missing.len() {
      std::thread::sleep(delay);
    }
  }
  Ok(())
}

pub fn current_unix_time_ms() -> Result<u128, String> {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|duration| duration.as_millis())
    .map_err(|error| format!("System clock cannot timestamp runtime coordination: {error}"))
}

#[tauri::command]
pub fn runtime_publish_instance_state(
  app: tauri::AppHandle,
  identity: State<'_, RuntimeIdentity>,
  registration: State<'_, InstanceRegistration>,
  registry: State<'_, InstanceRegistry>,
  role: State<'_, CoordinatorRole>,
  persistence: State<'_, crate::persistence::commands::PersistenceRuntime>,
  update: InstanceStateUpdate,
) -> Result<PublishedInstanceState, String> {
  let capture_status = match update.capture_status.as_str() {
    "running" => CaptureStatus::Running,
    "stopped" => CaptureStatus::Stopped,
    _ => return Err("Unknown instance capture status.".to_string()),
  };
  registration.publish(&InstanceRuntimeState {
    source_label: update.source_label,
    capture_status,
    visible: update.visible,
    focus_sequence: update.focus_sequence,
  })?;
  let identity_root = persistence.identity_root()?;
  if role.try_promote(&identity_root, &identity)? {
    crate::agent_control::toggle::handle_coordinator_promotion(&app);
  }
  let _ = registry.remove_stale()?;
  let display_name = summarize_instances(registry.list()?)
    .into_iter()
    .find(|instance| instance.instance_id == identity.instance_id())
    .map(|instance| instance.display_name)
    .ok_or_else(|| "Published instance is missing from the live registry.".to_string())?;
  Ok(PublishedInstanceState {
    display_name,
    is_coordinator: role.is_coordinator(),
    coordinator_generation: role.generation(),
  })
}

#[tauri::command]
pub fn runtime_list_instances(
  registry: State<'_, InstanceRegistry>,
) -> Result<Vec<InstanceSummary>, String> {
  let _ = registry.remove_stale()?;
  Ok(summarize_instances(registry.list()?))
}

#[tauri::command]
pub fn runtime_issue_commands(
  identity: State<'_, RuntimeIdentity>,
  registry: State<'_, InstanceRegistry>,
  operations: State<'_, RuntimeOperationCoordinator>,
  persistence: State<'_, crate::persistence::commands::PersistenceRuntime>,
  instance_ids: Option<Vec<String>>,
  operation_id: String,
  action: String,
) -> Result<Vec<IssuedRuntimeCommand>, String> {
  if action == "prepareGlobal" {
    operations.begin(&persistence.identity_root()?, &operation_id)?;
  } else if matches!(action.as_str(), "abortGlobal" | "commitGlobal") {
    operations.require_owner(&operation_id)?;
  } else {
    operations.require_idle()?;
  }
  let _ = registry.remove_stale()?;
  let live = registry.list()?;
  let targets: Vec<String> = match instance_ids {
    Some(ids) => ids,
    None => live
      .iter()
      .filter(|instance| instance.instance_id != identity.instance_id())
      .map(|instance| instance.instance_id.clone())
      .collect(),
  };
  if targets.iter().any(|target| {
    target == identity.instance_id() || !live.iter().any(|instance| &instance.instance_id == target)
  }) {
    return Err("A selected PLVS instance is no longer running.".to_string());
  }
  let mailbox = RuntimeCommandMailbox::open(&persistence.identity_root()?)?;
  let issued = mailbox.issue_many(&targets, &operation_id, &action);
  if issued.is_err() && action == "prepareGlobal" {
    let _ = operations.finish(&operation_id);
  }
  issued
}

#[tauri::command]
pub fn runtime_finish_operation(
  operations: State<'_, RuntimeOperationCoordinator>,
  operation_id: String,
) -> Result<(), String> {
  operations.finish(&operation_id)
}

#[tauri::command]
pub fn runtime_poll_command(
  identity: State<'_, RuntimeIdentity>,
  persistence: State<'_, crate::persistence::commands::PersistenceRuntime>,
) -> Result<Option<RuntimeCommand>, String> {
  RuntimeCommandMailbox::open(&persistence.identity_root()?)?.poll(identity.instance_id())
}

#[tauri::command]
pub fn runtime_ack_command(
  identity: State<'_, RuntimeIdentity>,
  persistence: State<'_, crate::persistence::commands::PersistenceRuntime>,
  command_id: String,
  outcome: String,
  detail: Option<String>,
) -> Result<(), String> {
  let mailbox = RuntimeCommandMailbox::open(&persistence.identity_root()?)?;
  let command = mailbox
    .poll(identity.instance_id())?
    .filter(|command| command.command_id == command_id)
    .ok_or_else(|| "The runtime command is no longer pending.".to_string())?;
  mailbox.acknowledge(&command, &outcome, detail)
}

#[tauri::command]
pub async fn runtime_wait_commands(
  persistence: State<'_, crate::persistence::commands::PersistenceRuntime>,
  issued: Vec<IssuedRuntimeCommand>,
  timeout_ms: u64,
) -> Result<Vec<RuntimeCommandAck>, String> {
  if timeout_ms == 0 || timeout_ms > 30_000 {
    return Err("Runtime coordination timeout is out of range.".to_string());
  }
  let identity_root = persistence.identity_root()?;
  tauri::async_runtime::spawn_blocking(move || {
    RuntimeCommandMailbox::open(&identity_root)?
      .wait_for(&issued, std::time::Duration::from_millis(timeout_ms))
  })
  .await
  .map_err(|error| format!("Runtime coordination wait failed: {error}"))?
}

#[tauri::command]
pub fn runtime_retire_current_workspace(
  identity: State<'_, RuntimeIdentity>,
  persistence: State<'_, crate::persistence::commands::PersistenceRuntime>,
) -> Result<(), String> {
  let identity_root = persistence.identity_root()?;
  crate::persistence::WorkspaceCatalog::open(&identity_root)?
    .remove_from_restore_set(identity.workspace_id())
}

fn global_shortcut_target(
  instances: &[InstanceSummary],
  current_instance_id: &str,
) -> Option<String> {
  let focused = instances
    .iter()
    .filter(|instance| instance.focus_sequence > 0)
    .max_by(|left, right| {
      left
        .focus_sequence
        .cmp(&right.focus_sequence)
        .then_with(|| left.instance_id.cmp(&right.instance_id))
    });
  focused
    .or_else(|| {
      instances
        .iter()
        .find(|instance| instance.instance_id == current_instance_id)
    })
    .or_else(|| instances.first())
    .map(|instance| instance.instance_id.clone())
}

#[tauri::command]
pub async fn runtime_route_global_clear(
  identity: State<'_, RuntimeIdentity>,
  registry: State<'_, InstanceRegistry>,
  persistence: State<'_, crate::persistence::commands::PersistenceRuntime>,
) -> Result<bool, String> {
  let _ = registry.remove_stale()?;
  let instances = summarize_instances(registry.list()?);
  let current_instance_id = identity.instance_id().to_string();
  let Some(target_instance_id) = global_shortcut_target(&instances, &current_instance_id) else {
    return Ok(false);
  };
  if target_instance_id == current_instance_id {
    return Ok(false);
  }
  let identity_root = persistence.identity_root()?;
  tauri::async_runtime::spawn_blocking(move || {
    route_clear_to_instance(&identity_root, &target_instance_id)
  })
  .await
  .map_err(|error| format!("Global shortcut routing task failed: {error}"))??;
  Ok(true)
}

#[tauri::command]
pub async fn runtime_route_instance_transport(
  identity: State<'_, RuntimeIdentity>,
  registry: State<'_, InstanceRegistry>,
  persistence: State<'_, crate::persistence::commands::PersistenceRuntime>,
  instance_id: String,
  action: String,
) -> Result<bool, String> {
  if action != "start" && action != "stop" {
    return Err("Unknown instance transport action.".to_string());
  }
  let _ = registry.remove_stale()?;
  if !registry
    .list()?
    .iter()
    .any(|instance| instance.instance_id == instance_id)
  {
    return Err("The selected PLVS instance is no longer running.".to_string());
  }
  if instance_id == identity.instance_id() {
    return Ok(false);
  }
  let identity_root = persistence.identity_root()?;
  tauri::async_runtime::spawn_blocking(move || {
    route_revisioned_method_to_instance(
      &identity_root,
      &instance_id,
      &format!("transport.live.{action}"),
      &format!("tray-{action}"),
    )
  })
  .await
  .map_err(|error| format!("Tray instance routing task failed: {error}"))??;
  Ok(true)
}

fn route_clear_to_instance(identity_root: &Path, instance_id: &str) -> Result<(), String> {
  route_revisioned_method_to_instance(
    identity_root,
    instance_id,
    "transport.live.clear",
    "global-shortcut-clear",
  )
}

fn route_revisioned_method_to_instance(
  identity_root: &Path,
  instance_id: &str,
  method: &str,
  request_prefix: &str,
) -> Result<(), String> {
  let descriptor_path =
    crate::agent_control::discovery::instance_descriptor_path(identity_root, instance_id);
  let descriptor = crate::agent_control::discovery::read_instance_descriptor_at(
    &descriptor_path,
    env!("PLVS_APP_ID"),
    instance_id,
    crate::agent_control::discovery::is_process_alive,
  )
  .map_err(|error| error.to_string())?;
  let inspect = crate::agent_control::protocol::JsonRpcRequest {
    id: format!("global-shortcut-inspect-{}", std::process::id()),
    method: "app.inspect".to_string(),
    params: serde_json::json!({}),
  };
  let inspected = crate::agent_control::transport::call_with_timeout(
    &descriptor,
    &inspect,
    crate::agent_control::broker::frontend_budget(&inspect)
      + crate::agent_control::broker::CLIENT_GRACE,
  )
  .map_err(|error| error.to_string())?;
  let revision = inspected
    .pointer("/result/revision")
    .and_then(serde_json::Value::as_u64)
    .ok_or_else(|| agent_response_error(&inspected, "inspect"))?;
  let clear = crate::agent_control::protocol::JsonRpcRequest {
    id: format!("{request_prefix}-{}", std::process::id()),
    method: method.to_string(),
    params: serde_json::json!({ "expectedRevision": revision }),
  };
  let response = crate::agent_control::transport::call_with_timeout(
    &descriptor,
    &clear,
    crate::agent_control::broker::frontend_budget(&clear)
      + crate::agent_control::broker::CLIENT_GRACE,
  )
  .map_err(|error| error.to_string())?;
  if response.get("result").is_none() {
    return Err(agent_response_error(&response, method));
  }
  Ok(())
}

fn agent_response_error(response: &serde_json::Value, action: &str) -> String {
  response
    .pointer("/error/message")
    .and_then(serde_json::Value::as_str)
    .map(str::to_string)
    .unwrap_or_else(|| format!("The target PLVS instance returned an invalid {action} response."))
}

impl CoordinatorLease {
  pub fn try_acquire(
    identity_root: &Path,
    identity: &RuntimeIdentity,
  ) -> Result<Option<Self>, String> {
    let runtime_dir = identity_root.join("runtime");
    fs::create_dir_all(&runtime_dir)
      .map_err(|error| format!("Unable to create coordinator runtime directory: {error}"))?;
    let lock_path = runtime_dir.join(LOCK_FILE_NAME);
    let file = OpenOptions::new()
      .read(true)
      .write(true)
      .create(true)
      .truncate(false)
      .open(&lock_path)
      .map_err(|error| format!("Unable to open coordinator lock: {error}"))?;
    match FileExt::try_lock(&file) {
      Ok(()) => {}
      Err(TryLockError::WouldBlock) => return Ok(None),
      Err(TryLockError::Error(error)) => {
        return Err(format!("Unable to acquire coordinator lock: {error}"));
      }
    }

    let generation_path = runtime_dir.join(GENERATION_FILE_NAME);
    let generation = read_generation(&generation_path)?
      .checked_add(1)
      .ok_or_else(|| "Coordinator generation is exhausted.".to_string())?;
    write_json_atomic(
      &generation_path,
      &serde_json::json!({ "generation": generation }),
    )?;
    let descriptor_path = coordinator_descriptor_path(identity_root);
    let descriptor = CoordinatorDescriptor {
      schema_version: COORDINATOR_SCHEMA_VERSION,
      generation,
      pid: std::process::id(),
      instance_id: identity.instance_id().to_string(),
      workspace_id: identity.workspace_id().to_string(),
    };
    write_json_atomic(&descriptor_path, &descriptor)?;

    Ok(Some(Self {
      file: Some(file),
      generation,
      descriptor_path,
    }))
  }

  pub fn generation(&self) -> u64 {
    self.generation
  }
}

impl Drop for CoordinatorLease {
  fn drop(&mut self) {
    if descriptor_generation(&self.descriptor_path) == Some(self.generation) {
      if let Err(error) = fs::remove_file(&self.descriptor_path) {
        if error.kind() != std::io::ErrorKind::NotFound {
          log::warn!("Unable to remove coordinator descriptor: {error}");
        }
      }
    }
    if let Some(file) = self.file.take() {
      if let Err(error) = FileExt::unlock(&file) {
        log::warn!("Unable to release coordinator lock: {error}");
      }
    }
  }
}

#[cfg(debug_assertions)]
pub fn run_test_host(args: &[String]) -> std::process::ExitCode {
  use std::io::Read;

  let [flag, root] = args else {
    eprintln!("coordinator test host requires --identity-root <path>");
    return std::process::ExitCode::from(2);
  };
  if flag != "--identity-root" {
    eprintln!("coordinator test host requires --identity-root <path>");
    return std::process::ExitCode::from(2);
  }
  let identity = match RuntimeIdentity::new_default() {
    Ok(identity) => identity,
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  let lease = match CoordinatorLease::try_acquire(Path::new(root), &identity) {
    Ok(Some(lease)) => lease,
    Ok(None) => {
      eprintln!("coordinator identity is already owned");
      return std::process::ExitCode::from(3);
    }
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  println!(
    "{}",
    serde_json::json!({
      "generation": lease.generation(),
      "instanceId": identity.instance_id(),
    })
  );
  if let Err(error) = std::io::stdout().flush() {
    eprintln!("unable to announce coordinator test host: {error}");
    return std::process::ExitCode::from(1);
  }

  let mut sink = Vec::new();
  let _ = std::io::stdin().read_to_end(&mut sink);
  drop(lease);
  std::process::ExitCode::SUCCESS
}

#[cfg(debug_assertions)]
pub fn run_role_test_host(args: &[String]) -> std::process::ExitCode {
  use std::{
    io::Read,
    sync::{
      atomic::{AtomicBool, Ordering},
      Arc,
    },
    time::Duration,
  };

  let [flag, root] = args else {
    eprintln!("coordinator role test host requires --identity-root <path>");
    return std::process::ExitCode::from(2);
  };
  if flag != "--identity-root" {
    eprintln!("coordinator role test host requires --identity-root <path>");
    return std::process::ExitCode::from(2);
  }
  let identity = match RuntimeIdentity::new_default() {
    Ok(identity) => identity,
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  let role = match CoordinatorRole::acquire(Path::new(root), &identity) {
    Ok(role) => role,
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  println!(
    "{}",
    serde_json::json!({
      "isCoordinator": role.is_coordinator(),
      "generation": role.generation(),
    })
  );
  if std::io::stdout().flush().is_err() {
    return std::process::ExitCode::from(1);
  }

  let finished = Arc::new(AtomicBool::new(false));
  let reader_finished = finished.clone();
  std::thread::spawn(move || {
    let mut sink = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut sink);
    reader_finished.store(true, Ordering::Release);
  });
  while !finished.load(Ordering::Acquire) {
    match role.try_promote(Path::new(root), &identity) {
      Ok(true) => {
        println!(
          "{}",
          serde_json::json!({
            "isCoordinator": true,
            "generation": role.generation(),
          })
        );
        let _ = std::io::stdout().flush();
      }
      Ok(false) => {}
      Err(error) => {
        eprintln!("{error}");
        return std::process::ExitCode::from(1);
      }
    }
    std::thread::sleep(Duration::from_millis(50));
  }
  std::process::ExitCode::SUCCESS
}

#[cfg(debug_assertions)]
pub fn run_registry_test_host(args: &[String]) -> std::process::ExitCode {
  use std::io::Read;

  let [flag, root] = args else {
    eprintln!("instance registry test host requires --identity-root <path>");
    return std::process::ExitCode::from(2);
  };
  if flag != "--identity-root" {
    eprintln!("instance registry test host requires --identity-root <path>");
    return std::process::ExitCode::from(2);
  }
  let identity = match RuntimeIdentity::new_default() {
    Ok(identity) => identity,
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  let registry = match InstanceRegistry::open(Path::new(root)) {
    Ok(registry) => registry,
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  let registration = match registry.register(
    &identity,
    &InstanceRuntimeState {
      source_label: None,
      capture_status: CaptureStatus::Stopped,
      visible: true,
      focus_sequence: 0,
    },
  ) {
    Ok(registration) => registration,
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  println!(
    "{}",
    serde_json::json!({ "instanceId": identity.instance_id() })
  );
  if let Err(error) = std::io::stdout().flush() {
    eprintln!("unable to announce instance registry test host: {error}");
    return std::process::ExitCode::from(1);
  }

  let mut sink = Vec::new();
  let _ = std::io::stdin().read_to_end(&mut sink);
  drop(registration);
  std::process::ExitCode::SUCCESS
}

fn read_generation(path: &Path) -> Result<u64, String> {
  match fs::read(path) {
    Ok(bytes) => serde_json::from_slice::<serde_json::Value>(&bytes)
      .map_err(|error| format!("Unable to parse coordinator generation: {error}"))?
      .get("generation")
      .and_then(serde_json::Value::as_u64)
      .ok_or_else(|| "Coordinator generation file is malformed.".to_string()),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
    Err(error) => Err(format!("Unable to read coordinator generation: {error}")),
  }
}

fn descriptor_generation(path: &Path) -> Option<u64> {
  let bytes = fs::read(path).ok()?;
  serde_json::from_slice::<CoordinatorDescriptor>(&bytes)
    .ok()
    .map(|descriptor| descriptor.generation)
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), String> {
  let mut bytes = serde_json::to_vec_pretty(value)
    .map_err(|error| format!("Unable to serialize coordinator state: {error}"))?;
  bytes.push(b'\n');
  let mut file = AtomicWriteFile::open(path)
    .map_err(|error| format!("Unable to open coordinator state for atomic writing: {error}"))?;
  file
    .write_all(&bytes)
    .map_err(|error| format!("Unable to write coordinator state: {error}"))?;
  file
    .commit()
    .map_err(|error| format!("Unable to publish coordinator state: {error}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_running_participant_can_promote_after_the_coordinator_releases_its_lease() {
    let root = std::env::temp_dir().join(format!(
      "plvs-coordinator-promotion-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    let first_identity = RuntimeIdentity::new_for_workspace("workspace-first").unwrap();
    let second_identity = RuntimeIdentity::new_for_workspace("workspace-second").unwrap();
    let first = CoordinatorRole::acquire(&root, &first_identity).unwrap();
    let second = CoordinatorRole::acquire(&root, &second_identity).unwrap();

    assert!(first.is_coordinator());
    assert!(!second.is_coordinator());
    assert!(!second.try_promote(&root, &second_identity).unwrap());

    drop(first);

    assert!(second.try_promote(&root, &second_identity).unwrap());
    assert!(second.is_coordinator());
    assert_eq!(second.generation(), Some(2));
    assert!(!second.try_promote(&root, &second_identity).unwrap());
    drop(second);
    let _ = std::fs::remove_dir_all(root);
  }

  fn instance(id: &str, focus_sequence: u64) -> InstanceSummary {
    InstanceSummary {
      instance_id: id.to_string(),
      workspace_id: format!("workspace-{id}"),
      display_name: id.to_string(),
      capture_status: CaptureStatus::Stopped,
      visible: true,
      focus_sequence,
    }
  }

  #[test]
  fn restore_launch_requires_the_workspace_and_nonce_together() {
    let args = vec![
      "--plvs-restore-workspace".to_string(),
      "workspace-one".to_string(),
      "--plvs-restore-nonce".to_string(),
      "secret".to_string(),
    ];
    assert_eq!(
      parse_restore_launch(&args).unwrap(),
      Some(RestoreLaunch {
        workspace_id: "workspace-one".to_string(),
        nonce: "secret".to_string(),
      })
    );
    assert!(parse_restore_launch(&args[..2]).is_err());
  }

  #[test]
  fn restoration_preserves_order_and_skips_workspaces_that_are_already_live() {
    let root = std::env::temp_dir().join(format!(
      "plvs-restore-plan-{}-{}",
      std::process::id(),
      current_unix_time_ms().unwrap()
    ));
    let registry = InstanceRegistry::open(&root).unwrap();
    let live_identity = RuntimeIdentity::new_for_workspace("workspace-one").unwrap();
    let _live = registry
      .register(
        &live_identity,
        &InstanceRuntimeState {
          source_label: None,
          capture_status: CaptureStatus::Stopped,
          visible: true,
          focus_sequence: 0,
        },
      )
      .unwrap();
    let restore_set = vec![
      "default".to_string(),
      "workspace-one".to_string(),
      "workspace-two".to_string(),
      "workspace-three".to_string(),
    ];

    assert_eq!(
      restore_missing_workspaces(&restore_set, &registry.list().unwrap(), "default"),
      vec!["workspace-two", "workspace-three"]
    );

    drop(_live);
    let _ = std::fs::remove_dir_all(root);
  }

  #[test]
  fn windows_restore_launches_are_staggered_to_avoid_webview2_startup_collisions() {
    assert_eq!(
      restore_spawn_delay_for("windows"),
      std::time::Duration::from_millis(1_500)
    );
    assert_eq!(restore_spawn_delay_for("macos"), std::time::Duration::ZERO);
  }

  #[test]
  fn global_shortcut_targets_the_most_recently_focused_instance() {
    let instances = vec![instance("coordinator", 20), instance("participant", 42)];
    assert_eq!(
      global_shortcut_target(&instances, "coordinator").as_deref(),
      Some("participant")
    );
  }

  #[test]
  fn global_shortcut_falls_back_to_the_coordinator_before_focus_is_published() {
    let instances = vec![instance("participant", 0), instance("coordinator", 0)];
    assert_eq!(
      global_shortcut_target(&instances, "coordinator").as_deref(),
      Some("coordinator")
    );
  }
}
