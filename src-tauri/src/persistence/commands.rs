use std::{collections::BTreeMap, sync::Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use super::{
  HydratedWorkspace, LibraryCollection, LibraryError, LibraryItem, WorkspaceDomain,
  WorkspacePersistenceSession,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PersistenceErrorReason {
  Conflict,
  Storage,
  Unavailable,
  InvalidDomain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceCommandError {
  pub reason: PersistenceErrorReason,
  pub message: String,
}

impl PersistenceCommandError {
  fn unavailable() -> Self {
    Self {
      reason: PersistenceErrorReason::Unavailable,
      message: "Multi-instance persistence is not ready.".to_string(),
    }
  }

  fn storage(message: String) -> Self {
    Self {
      reason: PersistenceErrorReason::Storage,
      message,
    }
  }
}

impl From<LibraryError> for PersistenceCommandError {
  fn from(error: LibraryError) -> Self {
    match error {
      LibraryError::Conflict(message) => Self {
        reason: PersistenceErrorReason::Conflict,
        message,
      },
      LibraryError::Storage(message) => Self::storage(message),
    }
  }
}

#[derive(Debug, Default)]
pub struct PersistenceRuntime {
  session: Mutex<Option<WorkspacePersistenceSession>>,
}

impl PersistenceRuntime {
  pub fn install(&self, session: WorkspacePersistenceSession) -> Result<(), String> {
    let mut current = self
      .session
      .lock()
      .map_err(|_| "Persistence runtime is unavailable.".to_string())?;
    if current.is_some() {
      return Err("Persistence runtime is already installed.".to_string());
    }
    *current = Some(session);
    Ok(())
  }

  fn with_session<T>(
    &self,
    action: impl FnOnce(&WorkspacePersistenceSession) -> Result<T, PersistenceCommandError>,
  ) -> Result<T, PersistenceCommandError> {
    let current = self
      .session
      .lock()
      .map_err(|_| PersistenceCommandError::unavailable())?;
    action(
      current
        .as_ref()
        .ok_or_else(PersistenceCommandError::unavailable)?,
    )
  }
}

#[tauri::command]
pub fn persistence_hydrate(
  runtime: State<'_, PersistenceRuntime>,
) -> Result<HydratedWorkspace, PersistenceCommandError> {
  runtime.with_session(|session| session.hydrate().map_err(PersistenceCommandError::storage))
}

#[tauri::command]
pub fn persistence_save_domain(
  runtime: State<'_, PersistenceRuntime>,
  domain: String,
  value: Value,
) -> Result<(), PersistenceCommandError> {
  let domain = match domain.as_str() {
    "settings" => WorkspaceDomain::Settings,
    "workspace" => WorkspaceDomain::Workspace,
    "presets" => WorkspaceDomain::Presets,
    _ => {
      return Err(PersistenceCommandError {
        reason: PersistenceErrorReason::InvalidDomain,
        message: format!("Unknown workspace persistence domain: {domain}"),
      })
    }
  };
  runtime.with_session(|session| {
    session
      .save_instance_domain(domain, &value)
      .map_err(PersistenceCommandError::storage)
  })
}

#[tauri::command]
pub fn persistence_library_create(
  runtime: State<'_, PersistenceRuntime>,
  kind: String,
  id: String,
  document: Value,
) -> Result<LibraryItem, PersistenceCommandError> {
  runtime.with_session(|session| {
    session
      .library()
      .create(&kind, &id, &document)
      .map_err(Into::into)
  })
}

#[tauri::command]
pub fn persistence_library_update(
  runtime: State<'_, PersistenceRuntime>,
  kind: String,
  id: String,
  expected_revision: i64,
  document: Value,
) -> Result<LibraryItem, PersistenceCommandError> {
  runtime.with_session(|session| {
    session
      .library()
      .update(&kind, &id, expected_revision, &document)
      .map_err(Into::into)
  })
}

#[tauri::command]
pub fn persistence_library_delete(
  runtime: State<'_, PersistenceRuntime>,
  kind: String,
  id: String,
  expected_revision: i64,
) -> Result<i64, PersistenceCommandError> {
  runtime.with_session(|session| {
    session
      .library()
      .delete(&kind, &id, expected_revision)
      .map_err(Into::into)
  })
}

#[tauri::command]
pub fn persistence_library_reorder(
  runtime: State<'_, PersistenceRuntime>,
  kind: String,
  ordered_ids: Vec<String>,
  expected_collection_revision: i64,
) -> Result<i64, PersistenceCommandError> {
  runtime.with_session(|session| {
    let ordered_ids: Vec<&str> = ordered_ids.iter().map(String::as_str).collect();
    session
      .library()
      .reorder(&kind, &ordered_ids, expected_collection_revision)
      .map_err(Into::into)
  })
}

#[tauri::command]
pub fn persistence_library_replace(
  runtime: State<'_, PersistenceRuntime>,
  kind: String,
  documents: Vec<Value>,
  expected_collection_revision: i64,
  expected_item_revisions: BTreeMap<String, i64>,
) -> Result<LibraryCollection, PersistenceCommandError> {
  runtime.with_session(|session| {
    session
      .library()
      .replace_collection(
        &kind,
        &documents,
        expected_collection_revision,
        &expected_item_revisions,
      )
      .map_err(Into::into)
  })
}
