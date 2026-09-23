use std::{
  collections::HashMap,
  fs::{self, OpenOptions},
  io::Write,
  path::{Path, PathBuf},
  sync::Mutex,
};

use serde::{Deserialize, Serialize};

const RESTORE_GRANT_TTL_MS: u128 = 30_000;

pub struct RestoreGrant {
  workspace_id: String,
  nonce: String,
  expires_at_unix_ms: u128,
}

impl RestoreGrant {
  pub fn workspace_id(&self) -> &str {
    &self.workspace_id
  }

  pub fn nonce(&self) -> &str {
    &self.nonce
  }

  pub fn expires_at_unix_ms(&self) -> u128 {
    self.expires_at_unix_ms
  }
}

#[derive(Default)]
pub struct RestoreGrantAuthority {
  pending: Mutex<HashMap<String, PendingRestoreGrant>>,
}

struct PendingRestoreGrant {
  workspace_id: String,
  expires_at_unix_ms: u128,
}

#[derive(Debug, Clone)]
pub struct DiskRestoreGrantAuthority {
  directory: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskRestoreGrant {
  workspace_id: String,
  expires_at_unix_ms: u128,
}

impl DiskRestoreGrantAuthority {
  pub fn open(identity_root: &Path) -> Result<Self, String> {
    let directory = identity_root.join("runtime").join("restore-grants");
    fs::create_dir_all(&directory)
      .map_err(|error| format!("Unable to create restore grant directory: {error}"))?;
    Ok(Self { directory })
  }

  pub fn issue(&self, workspace_id: &str, now_unix_ms: u128) -> Result<RestoreGrant, String> {
    validate_workspace_id(workspace_id)?;
    let expires_at_unix_ms = now_unix_ms
      .checked_add(RESTORE_GRANT_TTL_MS)
      .ok_or_else(|| "Restore grant expiration is out of range.".to_string())?;
    let nonce = random_nonce()?;
    let path = self.directory.join(format!("{nonce}.json"));
    let record = DiskRestoreGrant {
      workspace_id: workspace_id.to_string(),
      expires_at_unix_ms,
    };
    let bytes = serde_json::to_vec(&record)
      .map_err(|error| format!("Unable to serialize restore grant: {error}"))?;
    let mut file = OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(path)
      .map_err(|error| format!("Unable to create restore grant: {error}"))?;
    file
      .write_all(&bytes)
      .and_then(|_| file.sync_all())
      .map_err(|error| format!("Unable to persist restore grant: {error}"))?;
    Ok(RestoreGrant {
      workspace_id: workspace_id.to_string(),
      nonce,
      expires_at_unix_ms,
    })
  }

  pub fn claim(&self, workspace_id: &str, nonce: &str, now_unix_ms: u128) -> Result<(), String> {
    validate_workspace_id(workspace_id)?;
    if nonce.len() != 64 || !nonce.chars().all(|character| character.is_ascii_hexdigit()) {
      return Err("Restore grant nonce is invalid.".to_string());
    }
    let path = self.directory.join(format!("{nonce}.json"));
    let bytes =
      fs::read(&path).map_err(|_| "Restore grant is invalid or was already used.".to_string())?;
    let grant: DiskRestoreGrant = serde_json::from_slice(&bytes)
      .map_err(|error| format!("Unable to parse restore grant: {error}"))?;
    if grant.workspace_id != workspace_id {
      return Err("Restore grant belongs to a different workspace.".to_string());
    }
    if now_unix_ms > grant.expires_at_unix_ms {
      let _ = fs::remove_file(path);
      return Err("Restore grant has expired.".to_string());
    }
    fs::remove_file(path).map_err(|_| "Restore grant is invalid or was already used.".to_string())
  }
}

impl RestoreGrantAuthority {
  pub fn new() -> Self {
    Self::default()
  }

  pub fn issue(&self, workspace_id: &str, now_unix_ms: u128) -> Result<RestoreGrant, String> {
    validate_workspace_id(workspace_id)?;
    let expires_at_unix_ms = now_unix_ms
      .checked_add(RESTORE_GRANT_TTL_MS)
      .ok_or_else(|| "Restore grant expiration is out of range.".to_string())?;
    let nonce = random_nonce()?;
    let mut pending = self
      .pending
      .lock()
      .map_err(|_| "Restore grant authority is unavailable.".to_string())?;
    pending.retain(|_, grant| grant.expires_at_unix_ms >= now_unix_ms);
    pending.insert(
      nonce.clone(),
      PendingRestoreGrant {
        workspace_id: workspace_id.to_string(),
        expires_at_unix_ms,
      },
    );
    Ok(RestoreGrant {
      workspace_id: workspace_id.to_string(),
      nonce,
      expires_at_unix_ms,
    })
  }

  pub fn claim(&self, workspace_id: &str, nonce: &str, now_unix_ms: u128) -> Result<(), String> {
    validate_workspace_id(workspace_id)?;
    let mut pending = self
      .pending
      .lock()
      .map_err(|_| "Restore grant authority is unavailable.".to_string())?;
    let grant = pending
      .get(nonce)
      .ok_or_else(|| "Restore grant is invalid or was already used.".to_string())?;
    if now_unix_ms > grant.expires_at_unix_ms {
      pending.remove(nonce);
      return Err("Restore grant has expired.".to_string());
    }
    if grant.workspace_id != workspace_id {
      return Err("Restore grant belongs to a different workspace.".to_string());
    }
    pending.remove(nonce);
    Ok(())
  }
}

fn validate_workspace_id(workspace_id: &str) -> Result<(), String> {
  if workspace_id.is_empty()
    || !workspace_id
      .chars()
      .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
  {
    return Err("Workspace ID contains unsupported characters.".to_string());
  }
  Ok(())
}

fn random_nonce() -> Result<String, String> {
  let mut bytes = [0_u8; 32];
  getrandom::fill(&mut bytes)
    .map_err(|error| format!("Unable to create restore grant: {error}"))?;
  Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
