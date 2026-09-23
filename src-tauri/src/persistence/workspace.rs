use std::{
  fs,
  fs::{File, OpenOptions},
  io::{Seek, Write},
  path::{Path, PathBuf},
};

use atomic_write_file::AtomicWriteFile;
use fs4::{FileExt, TryLockError};
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
    let mut file = OpenOptions::new()
      .read(true)
      .write(true)
      .create(true)
      .truncate(false)
      .open(&self.lease_path)
      .map_err(|error| format!("Unable to open workspace lease: {error}"))?;
    match FileExt::try_lock(&file) {
      Ok(()) => {}
      Err(TryLockError::WouldBlock) => {
        return Err("This workspace is already open in another PLVS instance.".to_string());
      }
      Err(TryLockError::Error(error)) => {
        return Err(format!("Unable to acquire workspace lease: {error}"));
      }
    }
    file
      .set_len(0)
      .map_err(|error| format!("Unable to reset workspace lease owner: {error}"))?;
    file
      .rewind()
      .map_err(|error| format!("Unable to seek workspace lease: {error}"))?;
    writeln!(file, "{}", std::process::id())
      .map_err(|error| format!("Unable to record workspace lease owner: {error}"))?;
    file
      .sync_all()
      .map_err(|error| format!("Unable to flush workspace lease: {error}"))?;
    Ok(WorkspaceLease { file: Some(file) })
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
    if let Some(file) = self.file.take() {
      if let Err(error) = FileExt::unlock(&file) {
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

#[cfg(debug_assertions)]
pub fn run_lease_test_host(args: &[String]) -> std::process::ExitCode {
  use std::io::{BufRead, Read};

  if args.len() != 4 && args.len() != 6 {
    eprintln!(
      "workspace lease test host requires --identity-root <path> --workspace-id <workspace> [--iterations <count>]"
    );
    return std::process::ExitCode::from(2);
  }
  let [root_flag, root, workspace_flag, workspace_id] = &args[..4] else {
    unreachable!();
  };
  if root_flag != "--identity-root" || workspace_flag != "--workspace-id" {
    eprintln!(
      "workspace lease test host requires --identity-root <path> --workspace-id <workspace>"
    );
    return std::process::ExitCode::from(2);
  }
  let iterations = if args.len() == 6 {
    if args[4] != "--iterations" {
      eprintln!("workspace lease test host expected --iterations <count>");
      return std::process::ExitCode::from(2);
    }
    match args[5].parse::<usize>() {
      Ok(value) if value > 0 => Some(value),
      _ => {
        eprintln!("workspace lease test host iterations must be positive");
        return std::process::ExitCode::from(2);
      }
    }
  } else {
    None
  };
  let store = match WorkspaceStore::open(Path::new(root), workspace_id) {
    Ok(store) => store,
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  let lease = match store.acquire_lease() {
    Ok(lease) => lease,
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  if let Some(iterations) = iterations {
    let mut release = String::new();
    if let Err(error) = std::io::stdin().lock().read_line(&mut release) {
      eprintln!("unable to await workspace stress release: {error}");
      return std::process::ExitCode::from(1);
    }
    for sequence in 0..iterations {
      if let Err(error) = store.save(&serde_json::json!({
        "writer": workspace_id,
        "sequence": sequence,
      })) {
        eprintln!("{error}");
        return std::process::ExitCode::from(1);
      }
    }
    println!("{}", serde_json::json!({ "saved": iterations }));
  } else {
    println!("ready");
    if let Err(error) = std::io::stdout().flush() {
      eprintln!("unable to announce workspace lease test host: {error}");
      return std::process::ExitCode::from(1);
    }
    let mut sink = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut sink);
  }
  drop(lease);
  std::process::ExitCode::SUCCESS
}
