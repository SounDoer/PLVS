use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

/// Top-level store key, a sibling of `windowBounds` rather than a member of `plvs:settings`.
/// `profile.rs` copies `plvs:settings` wholesale between machines; a permission must not travel
/// with an imported configuration, and staying out of both `DOMAIN_KEYS` and `SIBLING_KEYS` is
/// what keeps it out.
pub const ENABLED_KEY: &str = "agentControlEnabled";

/// Development builds keep the behaviour they have today — Agent Control on, no setup step.
/// Release builds start off, including on upgrade from a version that had no such setting.
pub fn default_enabled() -> bool {
  cfg!(feature = "dev-identity")
}

pub fn enabled_from_store_map(map: &Map<String, Value>) -> bool {
  match map.get(ENABLED_KEY) {
    Some(Value::Bool(value)) => *value,
    _ => default_enabled(),
  }
}

/// Read the flag straight off disk. Used by `plvs-cli`, which has no `AppHandle`.
pub fn read_enabled_from_disk() -> bool {
  let Ok(path) = crate::profile::store_file_path() else {
    return default_enabled();
  };
  let Ok(map) = crate::profile::read_store_map(&path) else {
    return default_enabled();
  };
  enabled_from_store_map(&map)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlStatus {
  /// The platform has a control endpoint at all. Windows only for now.
  pub supported: bool,
  pub enabled: bool,
  pub cli_installed: bool,
  pub on_path: bool,
  pub message: String,
}

fn compose_status(supported: bool, cli_installed: bool, enabled: bool) -> AgentControlStatus {
  let message = if !supported {
    "Agent Control is currently available on Windows only."
  } else if !cli_installed {
    "plvs-cli.exe was not found in this installation."
  } else if enabled {
    "Programs on this machine can control PLVS through plvs-cli."
  } else {
    "Allows programs on this machine to control PLVS through plvs-cli."
  };
  AgentControlStatus {
    supported,
    enabled: supported && cli_installed && enabled,
    cli_installed,
    on_path: false,
    message: message.to_string(),
  }
}

const STORE_FILE: &str = "plvs-settings.json";

fn persist_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
  let store = app
    .store(STORE_FILE)
    .map_err(|error| format!("store load: {error}"))?;
  store.set(ENABLED_KEY, Value::Bool(enabled));
  store.save().map_err(|error| format!("store save: {error}"))
}

fn read_enabled(app: &AppHandle) -> bool {
  let Ok(store) = app.store(STORE_FILE) else {
    return default_enabled();
  };
  match store.get(ENABLED_KEY) {
    Some(Value::Bool(value)) => value,
    _ => default_enabled(),
  }
}

fn current_status(app: &AppHandle) -> Result<AgentControlStatus, String> {
  let path_status = crate::cli_path::cli_path_status()?;
  let supported = cfg!(target_os = "windows") && path_status.supported;
  let mut status = compose_status(supported, path_status.installed, read_enabled(app));
  status.on_path = path_status.on_path;
  Ok(status)
}

#[tauri::command]
pub fn agent_control_status(app: AppHandle) -> Result<AgentControlStatus, String> {
  current_status(&app)
}

#[tauri::command]
pub fn set_agent_control_enabled(
  app: AppHandle,
  enabled: bool,
) -> Result<AgentControlStatus, String> {
  let before = current_status(&app)?;
  if !before.supported || !before.cli_installed {
    return Ok(before);
  }

  // PATH first when enabling and last when disabling, so a failure never leaves the endpoint open
  // with no way to reach it, nor PATH pointing at an endpoint that is gone.
  if enabled {
    let _ = crate::cli_path::set_cli_path_enabled(true)?;
    start_endpoint(&app)?;
  } else {
    stop_endpoint(&app);
    let _ = crate::cli_path::set_cli_path_enabled(false)?;
  }

  persist_enabled(&app, enabled)?;
  current_status(&app)
}

#[cfg(target_os = "windows")]
fn start_endpoint(app: &AppHandle) -> Result<(), String> {
  if app
    .state::<crate::agent_control::windows_pipe::PipeServerState>()
    .is_running()
  {
    return Ok(());
  }
  crate::agent_control::windows_pipe::start(app)
}

#[cfg(not(target_os = "windows"))]
fn start_endpoint(_app: &AppHandle) -> Result<(), String> {
  Err("Agent Control is currently available on Windows only.".to_string())
}

fn stop_endpoint(app: &AppHandle) {
  app
    .state::<crate::agent_control::windows_pipe::PipeServerState>()
    .stop();
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::{json, Map};

  #[test]
  fn reads_the_persisted_flag_when_present() {
    let mut map = Map::new();
    map.insert(ENABLED_KEY.into(), json!(true));
    assert!(enabled_from_store_map(&map));

    map.insert(ENABLED_KEY.into(), json!(false));
    assert!(!enabled_from_store_map(&map));
  }

  #[test]
  fn falls_back_to_the_build_default_when_absent_or_malformed() {
    let mut map = Map::new();
    assert_eq!(enabled_from_store_map(&map), default_enabled());

    map.insert(ENABLED_KEY.into(), json!("yes"));
    assert_eq!(enabled_from_store_map(&map), default_enabled());
  }

  #[cfg(feature = "dev-identity")]
  #[test]
  fn development_builds_default_to_enabled() {
    assert!(default_enabled());
  }

  #[cfg(not(feature = "dev-identity"))]
  #[test]
  fn release_builds_default_to_disabled() {
    assert!(!default_enabled());
  }

  #[test]
  fn unsupported_platforms_report_a_windows_only_message() {
    let status = compose_status(false, false, false);
    assert!(!status.supported);
    assert!(!status.enabled);
    assert_eq!(
      status.message,
      "Agent Control is currently available on Windows only."
    );
  }

  #[test]
  fn a_missing_cli_is_reported_before_anything_else() {
    let status = compose_status(true, false, false);
    assert!(status.supported);
    assert!(!status.cli_installed);
    assert_eq!(
      status.message,
      "plvs-cli.exe was not found in this installation."
    );
  }

  #[test]
  fn the_message_says_plainly_what_being_on_means() {
    let off = compose_status(true, true, false);
    assert!(!off.enabled);
    assert_eq!(
      off.message,
      "Allows programs on this machine to control PLVS through plvs-cli."
    );

    let on = compose_status(true, true, true);
    assert!(on.enabled);
    assert_eq!(
      on.message,
      "Programs on this machine can control PLVS through plvs-cli."
    );
  }

  #[test]
  fn a_stored_yes_does_not_survive_a_platform_that_cannot_honour_it() {
    assert!(!compose_status(false, true, true).enabled);
    assert!(!compose_status(true, false, true).enabled);
    assert!(compose_status(true, true, true).enabled);
  }
}
