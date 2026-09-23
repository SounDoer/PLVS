use std::{path::Path, sync::Mutex};

use serde_json::{Map, Value};

use super::{
  hydrate_workspace, workspace::WorkspaceLease, HydratedWorkspace, LibraryRepository,
  WorkspaceStore,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceDomain {
  Settings,
  Workspace,
  Presets,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceValue {
  CaptureDeviceId,
  WindowBounds,
  DockState,
}

impl WorkspaceValue {
  fn key(self) -> &'static str {
    match self {
      Self::CaptureDeviceId => "captureDeviceId",
      Self::WindowBounds => "windowBounds",
      Self::DockState => "dockState",
    }
  }
}

impl WorkspaceDomain {
  fn key(self) -> &'static str {
    match self {
      Self::Settings => "plvs:settings",
      Self::Workspace => "plvs:workspace",
      Self::Presets => "plvs:presets",
    }
  }
}

#[derive(Debug)]
pub struct WorkspacePersistenceSession {
  identity_root: std::path::PathBuf,
  workspace_id: String,
  store: WorkspaceStore,
  _lease: WorkspaceLease,
  library: LibraryRepository,
  state: Mutex<Map<String, Value>>,
}

impl WorkspacePersistenceSession {
  pub fn open(identity_root: &Path, workspace_id: &str) -> Result<Self, String> {
    let store = WorkspaceStore::open(identity_root, workspace_id)?;
    let lease = store.acquire_lease()?;
    let state = store.load()?.unwrap_or_else(|| Value::Object(Map::new()));
    let state = state
      .as_object()
      .cloned()
      .ok_or_else(|| "Workspace state must be a JSON object.".to_string())?;
    let library = LibraryRepository::open(identity_root).map_err(|error| error.to_string())?;
    Ok(Self {
      identity_root: identity_root.to_path_buf(),
      workspace_id: workspace_id.to_string(),
      store,
      _lease: lease,
      library,
      state: Mutex::new(state),
    })
  }

  pub fn hydrate(&self) -> Result<HydratedWorkspace, String> {
    hydrate_workspace(&self.identity_root, &self.workspace_id)
  }

  pub fn identity_root(&self) -> &Path {
    &self.identity_root
  }

  pub fn library(&self) -> &LibraryRepository {
    &self.library
  }

  pub fn save_instance_domain(&self, domain: WorkspaceDomain, value: &Value) -> Result<(), String> {
    let mut domain_value = value
      .as_object()
      .cloned()
      .ok_or_else(|| "Workspace domain value must be a JSON object.".to_string())?;
    match domain {
      WorkspaceDomain::Settings => {
        domain_value.remove("askToSendCrashReports");
        if let Some(profiles) = domain_value
          .get_mut("loudnessProfiles")
          .and_then(Value::as_object_mut)
        {
          profiles.remove("profiles");
        }
      }
      WorkspaceDomain::Presets => {
        domain_value.remove("list");
      }
      WorkspaceDomain::Workspace => {}
    }

    self.save_state_value(domain.key(), Value::Object(domain_value))
  }

  pub fn save_workspace_value(&self, key: WorkspaceValue, value: &Value) -> Result<(), String> {
    self.save_state_value(key.key(), value.clone())
  }

  pub fn workspace_value(&self, key: WorkspaceValue) -> Result<Option<Value>, String> {
    self
      .state
      .lock()
      .map(|state| state.get(key.key()).cloned())
      .map_err(|_| "Workspace persistence session is unavailable.".to_string())
  }

  fn save_state_value(&self, key: &str, value: Value) -> Result<(), String> {
    let mut state = self
      .state
      .lock()
      .map_err(|_| "Workspace persistence session is unavailable.".to_string())?;
    let mut next = state.clone();
    next.insert(key.to_string(), value);
    self.store.save(&Value::Object(next.clone()))?;
    *state = next;
    Ok(())
  }
}
