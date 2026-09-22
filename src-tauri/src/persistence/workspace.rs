use std::{
  fs,
  fs::{File, OpenOptions},
  io::Write,
  path::{Path, PathBuf},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const WORKSPACE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDocument {
  schema_version: u32,
  state: Value,
}

#[derive(Debug, Clone)]
pub struct WorkspaceStore {
  state_path: PathBuf,
  lease_path: PathBuf,
}

#[derive(Debug)]
pub struct WorkspaceLease {
  file: Option<File>,
  path: PathBuf,
}

impl WorkspaceStore {
  pub fn open(identity_root: &Path, workspace_id: &str) -> Result<Self, String> {
    if !valid_workspace_id(workspace_id) {
      return Err("Workspace ID contains unsupported characters.".to_string());
    }
    let workspace_dir = identity_root.join("workspaces").join(workspace_id);
    Ok(Self {
      state_path: workspace_dir.join("state.json"),
      lease_path: workspace_dir.join("writer.lock"),
    })
  }

  pub fn acquire_lease(&self) -> Result<WorkspaceLease, String> {
    let parent = self
      .lease_path
      .parent()
      .ok_or_else(|| "Workspace lease path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
      .map_err(|error| format!("Unable to create workspace directory: {error}"))?;
    let mut file = match OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&self.lease_path)
    {
      Ok(file) => file,
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
        return Err("This workspace is already open in another PLVS instance.".to_string());
      }
      Err(error) => return Err(format!("Unable to acquire workspace lease: {error}")),
    };
    writeln!(file, "{}", std::process::id())
      .map_err(|error| format!("Unable to record workspace lease owner: {error}"))?;
    file
      .sync_all()
      .map_err(|error| format!("Unable to flush workspace lease: {error}"))?;
    Ok(WorkspaceLease {
      file: Some(file),
      path: self.lease_path.clone(),
    })
  }

  pub fn load(&self) -> Result<Option<Value>, String> {
    let bytes = match fs::read(&self.state_path) {
      Ok(bytes) => bytes,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
      Err(error) => return Err(format!("Unable to read workspace state: {error}")),
    };
    let document: WorkspaceDocument = serde_json::from_slice(&bytes)
      .map_err(|error| format!("Unable to parse workspace state: {error}"))?;
    if document.schema_version != WORKSPACE_SCHEMA_VERSION {
      return Err(format!(
        "Unsupported workspace state version: {}",
        document.schema_version
      ));
    }
    Ok(Some(document.state))
  }

  pub fn save(&self, state: &Value) -> Result<(), String> {
    let parent = self
      .state_path
      .parent()
      .ok_or_else(|| "Workspace state path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
      .map_err(|error| format!("Unable to create workspace state directory: {error}"))?;
    let document = WorkspaceDocument {
      schema_version: WORKSPACE_SCHEMA_VERSION,
      state: state.clone(),
    };
    let mut bytes = serde_json::to_vec_pretty(&document)
      .map_err(|error| format!("Unable to serialize workspace state: {error}"))?;
    bytes.push(b'\n');

    let mut file = AtomicWriteFile::open(&self.state_path)
      .map_err(|error| format!("Unable to open workspace state for atomic writing: {error}"))?;
    file
      .write_all(&bytes)
      .map_err(|error| format!("Unable to write workspace state: {error}"))?;
    file
      .commit()
      .map_err(|error| format!("Unable to atomically replace workspace state: {error}"))
  }
}

impl Drop for WorkspaceLease {
  fn drop(&mut self) {
    drop(self.file.take());
    if let Err(error) = fs::remove_file(&self.path) {
      if error.kind() != std::io::ErrorKind::NotFound {
        log::warn!("Unable to release workspace lease: {error}");
      }
    }
  }
}

fn valid_workspace_id(workspace_id: &str) -> bool {
  !workspace_id.is_empty()
    && workspace_id
      .chars()
      .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}
