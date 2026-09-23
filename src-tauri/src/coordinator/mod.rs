use std::{
  fs::{self, File, OpenOptions},
  io::Write,
  path::{Path, PathBuf},
};

use atomic_write_file::AtomicWriteFile;
use fs4::{FileExt, TryLockError};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::runtime_identity::RuntimeIdentity;

mod registry;
mod restore_grant;

pub use registry::{
  summarize_instances, CaptureStatus, InstanceDescriptor, InstanceRegistration, InstanceRegistry,
  InstanceRuntimeState, InstanceSummary,
};
pub use restore_grant::{RestoreGrant, RestoreGrantAuthority};

const COORDINATOR_SCHEMA_VERSION: u32 = 1;
const LOCK_FILE_NAME: &str = "coordinator.lock";
const GENERATION_FILE_NAME: &str = "coordinator-generation.json";
const DESCRIPTOR_FILE_NAME: &str = "coordinator.json";

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
  lease: Option<CoordinatorLease>,
}

impl CoordinatorRole {
  pub fn acquire(identity_root: &Path, identity: &RuntimeIdentity) -> Result<Self, String> {
    Ok(Self {
      lease: CoordinatorLease::try_acquire(identity_root, identity)?,
    })
  }

  pub fn is_coordinator(&self) -> bool {
    self.lease.is_some()
  }

  pub fn generation(&self) -> Option<u64> {
    self.lease.as_ref().map(CoordinatorLease::generation)
  }
}

#[tauri::command]
pub fn runtime_publish_instance_state(
  identity: State<'_, RuntimeIdentity>,
  registration: State<'_, InstanceRegistration>,
  registry: State<'_, InstanceRegistry>,
  source_label: Option<String>,
  capture_status: String,
  visible: bool,
  focus_sequence: u64,
) -> Result<String, String> {
  let capture_status = match capture_status.as_str() {
    "running" => CaptureStatus::Running,
    "stopped" => CaptureStatus::Stopped,
    _ => return Err("Unknown instance capture status.".to_string()),
  };
  registration.publish(&InstanceRuntimeState {
    source_label,
    capture_status,
    visible,
    focus_sequence,
  })?;
  let _ = registry.remove_stale()?;
  summarize_instances(registry.list()?)
    .into_iter()
    .find(|instance| instance.instance_id == identity.instance_id())
    .map(|instance| instance.display_name)
    .ok_or_else(|| "Published instance is missing from the live registry.".to_string())
}

#[tauri::command]
pub fn runtime_list_instances(
  registry: State<'_, InstanceRegistry>,
) -> Result<Vec<InstanceSummary>, String> {
  let _ = registry.remove_stale()?;
  Ok(summarize_instances(registry.list()?))
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
    let descriptor_path = runtime_dir.join(DESCRIPTOR_FILE_NAME);
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
