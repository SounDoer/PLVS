use std::{
  collections::HashMap,
  fs,
  io::Write,
  path::{Path, PathBuf},
  time::{SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};

use crate::{agent_control::discovery::is_process_alive, runtime_identity::RuntimeIdentity};

const INSTANCE_DESCRIPTOR_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureStatus {
  Stopped,
  Running,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceRuntimeState {
  pub source_label: Option<String>,
  pub capture_status: CaptureStatus,
  pub visible: bool,
  pub focus_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceDescriptor {
  pub schema_version: u32,
  pub instance_id: String,
  pub workspace_id: String,
  pub pid: u32,
  pub process_start_identity: u64,
  pub registered_at_unix_ms: u128,
  pub heartbeat_unix_ms: u128,
  pub source_label: Option<String>,
  pub capture_status: CaptureStatus,
  pub visible: bool,
  pub focus_sequence: u64,
  registration_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSummary {
  pub instance_id: String,
  pub workspace_id: String,
  pub display_name: String,
  pub capture_status: CaptureStatus,
  pub visible: bool,
  pub focus_sequence: u64,
}

#[derive(Debug, Clone)]
pub struct InstanceRegistry {
  identity_root: PathBuf,
  directory: PathBuf,
}

#[derive(Debug)]
pub struct InstanceRegistration {
  descriptor_path: PathBuf,
  registration_token: String,
}

impl InstanceRegistry {
  pub fn open(identity_root: &Path) -> Result<Self, String> {
    let directory = identity_root.join("runtime").join("instances");
    fs::create_dir_all(&directory)
      .map_err(|error| format!("Unable to create instance registry directory: {error}"))?;
    Ok(Self {
      identity_root: identity_root.to_path_buf(),
      directory,
    })
  }

  pub fn register(
    &self,
    identity: &RuntimeIdentity,
    state: &InstanceRuntimeState,
  ) -> Result<InstanceRegistration, String> {
    let registration_token = random_token()?;
    let now = unix_time_ms()?;
    let pid = std::process::id();
    let descriptor = InstanceDescriptor {
      schema_version: INSTANCE_DESCRIPTOR_SCHEMA_VERSION,
      instance_id: identity.instance_id().to_string(),
      workspace_id: identity.workspace_id().to_string(),
      pid,
      process_start_identity: process_start_identity(pid)
        .ok_or_else(|| "Unable to identify the registering process start time.".to_string())?,
      registered_at_unix_ms: now,
      heartbeat_unix_ms: now,
      source_label: state.source_label.clone(),
      capture_status: state.capture_status,
      visible: state.visible,
      focus_sequence: state.focus_sequence,
      registration_token: registration_token.clone(),
    };
    let descriptor_path = self
      .directory
      .join(format!("{}.json", identity.instance_id()));
    write_descriptor(&descriptor_path, &descriptor)?;
    Ok(InstanceRegistration {
      descriptor_path,
      registration_token,
    })
  }

  pub fn list(&self) -> Result<Vec<InstanceDescriptor>, String> {
    let entries = fs::read_dir(&self.directory)
      .map_err(|error| format!("Unable to read instance registry: {error}"))?;
    let mut descriptors = Vec::new();
    for entry in entries {
      let entry =
        entry.map_err(|error| format!("Unable to read instance registry entry: {error}"))?;
      let path = entry.path();
      if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
        continue;
      }
      let bytes =
        fs::read(&path).map_err(|error| format!("Unable to read instance descriptor: {error}"))?;
      let descriptor: InstanceDescriptor = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Unable to parse instance descriptor: {error}"))?;
      if descriptor.schema_version != INSTANCE_DESCRIPTOR_SCHEMA_VERSION {
        return Err(format!(
          "Unsupported instance descriptor version: {}",
          descriptor.schema_version
        ));
      }
      let expected_name = format!("{}.json", descriptor.instance_id);
      if path.file_name().and_then(|name| name.to_str()) != Some(expected_name.as_str()) {
        return Err("Instance descriptor filename does not match its instance ID.".to_string());
      }
      descriptors.push(descriptor);
    }
    descriptors.sort_by(|left, right| left.instance_id.cmp(&right.instance_id));
    Ok(descriptors)
  }

  pub fn remove_stale(&self) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    for descriptor in self.list()? {
      if is_process_alive(descriptor.pid)
        && process_start_identity(descriptor.pid) == Some(descriptor.process_start_identity)
      {
        continue;
      }
      let path = self
        .directory
        .join(format!("{}.json", descriptor.instance_id));
      let current = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<InstanceDescriptor>(&bytes).ok());
      if current.as_ref() != Some(&descriptor) {
        continue;
      }
      match fs::remove_file(&path) {
        Ok(()) => {
          if let Ok(mailbox) = super::RuntimeCommandMailbox::open(&self.identity_root) {
            if let Err(error) = mailbox.discard_instance(&descriptor.instance_id) {
              log::warn!("Unable to clean stale runtime commands: {error}");
            }
          }
          removed.push(descriptor.instance_id)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
          return Err(format!(
            "Unable to remove stale instance descriptor: {error}"
          ))
        }
      }
    }
    Ok(removed)
  }
}

impl InstanceRegistration {
  pub fn publish(&self, state: &InstanceRuntimeState) -> Result<(), String> {
    let bytes = fs::read(&self.descriptor_path)
      .map_err(|error| format!("Unable to read owned instance descriptor: {error}"))?;
    let mut descriptor: InstanceDescriptor = serde_json::from_slice(&bytes)
      .map_err(|error| format!("Unable to parse owned instance descriptor: {error}"))?;
    if descriptor.registration_token != self.registration_token {
      return Err("Instance registration no longer owns its descriptor.".to_string());
    }

    descriptor.source_label = state.source_label.clone();
    descriptor.capture_status = state.capture_status;
    descriptor.visible = state.visible;
    descriptor.focus_sequence = state.focus_sequence;
    descriptor.heartbeat_unix_ms = unix_time_ms()?;
    write_descriptor(&self.descriptor_path, &descriptor)
  }
}

impl Drop for InstanceRegistration {
  fn drop(&mut self) {
    let owned = fs::read(&self.descriptor_path)
      .ok()
      .and_then(|bytes| serde_json::from_slice::<InstanceDescriptor>(&bytes).ok())
      .is_some_and(|descriptor| descriptor.registration_token == self.registration_token);
    if owned {
      if let Err(error) = fs::remove_file(&self.descriptor_path) {
        if error.kind() != std::io::ErrorKind::NotFound {
          log::warn!("Unable to remove instance registration: {error}");
        }
      }
    }
  }
}

pub fn summarize_instances(mut descriptors: Vec<InstanceDescriptor>) -> Vec<InstanceSummary> {
  descriptors.sort_by(|left, right| {
    left
      .registered_at_unix_ms
      .cmp(&right.registered_at_unix_ms)
      .then_with(|| left.instance_id.cmp(&right.instance_id))
  });
  let mut occurrences = HashMap::<String, usize>::new();
  descriptors
    .into_iter()
    .map(|descriptor| {
      let base_name = descriptor
        .source_label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .unwrap_or("Choose Source");
      let occurrence = occurrences.entry(base_name.to_string()).or_default();
      *occurrence += 1;
      let display_name = match *occurrence {
        1 => base_name.to_string(),
        number => format!("{base_name} ({number})"),
      };
      InstanceSummary {
        instance_id: descriptor.instance_id,
        workspace_id: descriptor.workspace_id,
        display_name,
        capture_status: descriptor.capture_status,
        visible: descriptor.visible,
        focus_sequence: descriptor.focus_sequence,
      }
    })
    .collect()
}

fn random_token() -> Result<String, String> {
  let mut bytes = [0_u8; 16];
  getrandom::fill(&mut bytes)
    .map_err(|error| format!("Unable to create instance registration token: {error}"))?;
  Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn unix_time_ms() -> Result<u128, String> {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis())
    .map_err(|error| format!("System clock cannot timestamp instance registration: {error}"))
}

#[cfg(target_os = "windows")]
fn process_start_identity(pid: u32) -> Option<u64> {
  use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME},
    System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
  };

  let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
  if handle.is_null() {
    return None;
  }
  let mut creation = FILETIME::default();
  let mut exit = FILETIME::default();
  let mut kernel = FILETIME::default();
  let mut user = FILETIME::default();
  let result = unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) };
  unsafe { CloseHandle(handle) };
  (result != 0)
    .then(|| (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
}

#[cfg(target_os = "macos")]
fn process_start_identity(pid: u32) -> Option<u64> {
  let mut info = unsafe { std::mem::zeroed::<libc::proc_bsdinfo>() };
  let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
  let read = unsafe {
    libc::proc_pidinfo(
      pid as libc::c_int,
      libc::PROC_PIDTBSDINFO,
      0,
      (&mut info as *mut libc::proc_bsdinfo).cast(),
      size,
    )
  };
  (read == size).then(|| {
    info
      .pbi_start_tvsec
      .saturating_mul(1_000_000)
      .saturating_add(info.pbi_start_tvusec)
  })
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn process_start_identity(pid: u32) -> Option<u64> {
  let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
  let after_name = stat.rsplit_once(')')?.1;
  after_name.split_whitespace().nth(19)?.parse().ok()
}

fn write_descriptor(path: &Path, descriptor: &InstanceDescriptor) -> Result<(), String> {
  let mut bytes = serde_json::to_vec_pretty(descriptor)
    .map_err(|error| format!("Unable to serialize instance descriptor: {error}"))?;
  bytes.push(b'\n');
  let mut file = AtomicWriteFile::open(path)
    .map_err(|error| format!("Unable to open instance descriptor for atomic writing: {error}"))?;
  file
    .write_all(&bytes)
    .map_err(|error| format!("Unable to write instance descriptor: {error}"))?;
  file
    .commit()
    .map_err(|error| format!("Unable to publish instance descriptor: {error}"))
}
