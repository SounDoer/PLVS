use std::path::{Path, PathBuf};

use rusqlite::{params, TransactionBehavior};

use super::{LibraryRepository, WorkspaceStore};

const DEFAULT_WORKSPACE_ID: &str = "default";

#[derive(Debug, Clone)]
pub struct WorkspaceCatalog {
  identity_root: PathBuf,
  repository: LibraryRepository,
}

impl WorkspaceCatalog {
  pub fn open(identity_root: &Path) -> Result<Self, String> {
    let repository = LibraryRepository::open(identity_root).map_err(|error| error.to_string())?;
    Ok(Self {
      identity_root: identity_root.to_path_buf(),
      repository,
    })
  }

  pub fn restore_set(&self) -> Result<Vec<String>, String> {
    let connection = self
      .repository
      .connection()
      .map_err(|error| error.to_string())?;
    let mut statement = connection
      .prepare(
        "SELECT workspace_id
         FROM workspace_restore_set
         ORDER BY position ASC",
      )
      .map_err(|error| format!("Unable to read workspace restore set: {error}"))?;
    let restore_set = statement
      .query_map([], |row| row.get::<_, String>(0))
      .map_err(|error| format!("Unable to query workspace restore set: {error}"))?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("Unable to decode workspace restore set: {error}"))?;
    Ok(restore_set)
  }

  pub fn allocate_blank_workbench(&self) -> Result<String, String> {
    let mut connection = self
      .repository
      .connection()
      .map_err(|error| error.to_string())?;
    let transaction = connection
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(|error| format!("Unable to lock workspace restore set: {error}"))?;
    let workspace_id = loop {
      let candidate = format!("workspace-{}", random_uuid()?);
      let exists = transaction
        .query_row(
          "SELECT EXISTS(SELECT 1 FROM workspace_restore_set WHERE workspace_id = ?1)",
          [&candidate],
          |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Unable to check workspace identity: {error}"))?;
      if !exists {
        break candidate;
      }
    };
    WorkspaceStore::open(&self.identity_root, &workspace_id)?.save(&serde_json::json!({
      "captureDeviceId": "default",
      "captureStatus": "stopped"
    }))?;
    transaction
      .execute(
        "INSERT INTO workspace_restore_set (workspace_id, position)
         SELECT ?1, COALESCE(MAX(position) + 1, 0) FROM workspace_restore_set",
        [&workspace_id],
      )
      .map_err(|error| format!("Unable to add workspace to restore set: {error}"))?;
    transaction
      .execute(
        "UPDATE workspace_registry_state SET revision = revision + 1 WHERE singleton = 1",
        [],
      )
      .map_err(|error| format!("Unable to advance workspace registry revision: {error}"))?;
    transaction
      .commit()
      .map_err(|error| format!("Unable to commit workspace allocation: {error}"))?;
    Ok(workspace_id)
  }

  pub fn remove_from_restore_set(&self, workspace_id: &str) -> Result<(), String> {
    if workspace_id == DEFAULT_WORKSPACE_ID {
      return Ok(());
    }
    let mut connection = self
      .repository
      .connection()
      .map_err(|error| error.to_string())?;
    let transaction = connection
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(|error| format!("Unable to lock workspace restore set: {error}"))?;
    let removed = transaction
      .execute(
        "DELETE FROM workspace_restore_set WHERE workspace_id = ?1",
        [workspace_id],
      )
      .map_err(|error| format!("Unable to remove workspace from restore set: {error}"))?;
    if removed == 0 {
      return Ok(());
    }
    let remaining = {
      let mut statement = transaction
        .prepare("SELECT workspace_id FROM workspace_restore_set ORDER BY position ASC")
        .map_err(|error| format!("Unable to compact workspace restore set: {error}"))?;
      let remaining = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Unable to query remaining workspaces: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to decode remaining workspaces: {error}"))?;
      remaining
    };
    for (position, candidate) in remaining.iter().enumerate() {
      transaction
        .execute(
          "UPDATE workspace_restore_set SET position = ?2 WHERE workspace_id = ?1",
          params![candidate, position as i64],
        )
        .map_err(|error| format!("Unable to compact workspace restore position: {error}"))?;
    }
    transaction
      .execute(
        "UPDATE workspace_registry_state SET revision = revision + 1 WHERE singleton = 1",
        [],
      )
      .map_err(|error| format!("Unable to advance workspace registry revision: {error}"))?;
    transaction
      .commit()
      .map_err(|error| format!("Unable to commit workspace removal: {error}"))
  }
}

fn random_uuid() -> Result<String, String> {
  let mut bytes = [0_u8; 16];
  getrandom::fill(&mut bytes)
    .map_err(|error| format!("Unable to allocate workspace identity: {error}"))?;
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  Ok(format!(
    "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8],
    bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
  ))
}
