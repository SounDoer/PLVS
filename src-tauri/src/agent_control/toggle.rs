use serde::Serialize;
use serde_json::{Map, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

/// Top-level store key, a sibling of `windowBounds` rather than a member of `plvs:settings`.
/// `profile.rs` copies `plvs:settings` wholesale between machines; a permission must not travel
/// with an imported configuration, and staying out of both `DOMAIN_KEYS` and `SIBLING_KEYS` is
/// what keeps it out.
pub const ENABLED_KEY: &str = "agentControlEnabled";

const UNSUPPORTED_MESSAGE: &str = "Agent Control is unavailable on this platform.";

/// The help tip describes the control, not the current state: the switch already shows whether it
/// is on, and a tip that rewrites itself under the cursor reads as a status line instead of an
/// explanation.
const AGENT_CONTROL_MESSAGE: &str =
  "Lets AI agents and scripts on this machine control PLVS through plvs-cli.";

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
  /// The platform has a control endpoint at all.
  pub supported: bool,
  pub enabled: bool,
  /// The endpoint is open right now. `enabled` is the permission the user granted; a start can
  /// fail after it, and then the two disagree.
  pub listening: bool,
  /// Why the last start failed, when one did. `None` once an endpoint is up.
  pub start_error: Option<String>,
  pub cli_installed: bool,
  pub on_path: bool,
  pub message: String,
}

/// The last endpoint start failure. A launch-time failure is otherwise only a log line, which
/// leaves Settings showing a switch that is on and an endpoint nobody is listening on.
#[derive(Default)]
pub struct StartFailure(Mutex<Option<String>>);

impl StartFailure {
  fn set(&self, error: Option<String>) {
    *self.0.lock().expect("agent-control start failure poisoned") = error;
  }

  fn get(&self) -> Option<String> {
    self
      .0
      .lock()
      .expect("agent-control start failure poisoned")
      .clone()
  }
}

fn compose_status(
  supported: bool,
  cli_installed: bool,
  enabled: bool,
  listening: bool,
  start_error: Option<String>,
) -> AgentControlStatus {
  let listening = supported && cli_installed && listening;
  let message = if !supported {
    UNSUPPORTED_MESSAGE
  } else if !cli_installed {
    "plvs-cli was not found in this installation."
  } else {
    AGENT_CONTROL_MESSAGE
  };
  AgentControlStatus {
    supported,
    enabled: supported && cli_installed && enabled,
    listening,
    start_error: if listening { None } else { start_error },
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

pub(crate) fn read_enabled(app: &AppHandle) -> bool {
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
  let supported = cfg!(any(target_os = "windows", target_os = "macos")) && path_status.supported;
  let listening = app
    .state::<crate::agent_control::transport::ServerState>()
    .is_running();
  let mut status = compose_status(
    supported,
    path_status.installed,
    read_enabled(app),
    listening,
    app.state::<StartFailure>().get(),
  );
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

  // The flag is written only after the endpoint matches it. Windows PATH setup is a convenience
  // that may lag behind a failed registry write; macOS only refreshes installation status here.
  // Persisting last prevents a later launch from reopening an endpoint the user just closed.
  if enabled {
    let _ = crate::cli_path::set_cli_path_enabled(true)?;
    start_endpoint(&app)?;
    persist_enabled(&app, true)?;
  } else {
    stop_endpoint(&app);
    persist_enabled(&app, false)?;
    let _ = crate::cli_path::set_cli_path_enabled(false)?;
  }

  current_status(&app)
}

/// Start at launch, where the window is already up and a failure must not abort the app.
pub fn start_at_launch(app: &AppHandle) {
  if let Err(error) = start_endpoint(app) {
    log::warn!("agent control unavailable; PLVS will continue normally: {error}");
  }
}

fn start_endpoint(app: &AppHandle) -> Result<(), String> {
  if app
    .state::<crate::agent_control::transport::ServerState>()
    .is_running()
  {
    app.state::<StartFailure>().set(None);
    return Ok(());
  }
  let result = crate::agent_control::transport::start(app);
  match &result {
    Ok(()) => app.state::<StartFailure>().set(None),
    Err(error) => {
      app.state::<StartFailure>().set(Some(error.clone()));
      // A failed start wrote no descriptor, so anything on disk is from an earlier run. Left
      // there, it sends plvs-cli at a dead pid instead of telling it nothing is listening.
      if let Ok(path) = crate::agent_control::discovery::descriptor_path() {
        crate::agent_control::discovery::remove_stale_descriptor_at(&path, env!("PLVS_APP_ID"));
      }
    }
  }
  result
}

fn stop_endpoint(app: &AppHandle) {
  app
    .state::<crate::agent_control::transport::ServerState>()
    .stop();
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::{json, Map};

  /// The listening endpoint is the ordinary case; the tests that care about a silent one call
  /// `compose_status` directly.
  fn status(supported: bool, cli_installed: bool, enabled: bool) -> AgentControlStatus {
    compose_status(supported, cli_installed, enabled, enabled, None)
  }

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
  fn unsupported_platforms_report_a_platform_message() {
    let status = status(false, false, false);
    assert!(!status.supported);
    assert!(!status.enabled);
    assert_eq!(
      status.message,
      "Agent Control is unavailable on this platform."
    );
  }

  #[test]
  fn a_missing_cli_is_reported_before_anything_else() {
    let status = status(true, false, false);
    assert!(status.supported);
    assert!(!status.cli_installed);
    assert_eq!(
      status.message,
      "plvs-cli was not found in this installation."
    );
  }

  #[test]
  fn the_message_describes_the_control_and_does_not_track_the_switch() {
    let off = status(true, true, false);
    assert!(!off.enabled);

    let on = status(true, true, true);
    assert!(on.enabled);

    assert_eq!(
      off.message,
      "Lets AI agents and scripts on this machine control PLVS through plvs-cli."
    );
    assert_eq!(off.message, on.message);
  }

  #[test]
  fn an_enabled_switch_reports_whether_the_endpoint_is_actually_listening() {
    let up = compose_status(true, true, true, true, None);
    assert!(up.enabled);
    assert!(up.listening);
    assert_eq!(up.start_error, None);

    let silent = compose_status(true, true, true, false, None);
    assert!(silent.enabled);
    assert!(!silent.listening);
  }

  #[test]
  fn a_failed_start_is_carried_next_to_the_switch_the_user_left_on() {
    let failed = compose_status(true, true, true, false, Some("unable to bind".to_string()));
    assert!(failed.enabled);
    assert!(!failed.listening);
    assert_eq!(failed.start_error.as_deref(), Some("unable to bind"));

    // The tip still describes the control. The panel builds the failure line from the fields.
    assert_eq!(
      failed.message,
      "Lets AI agents and scripts on this machine control PLVS through plvs-cli."
    );
  }

  #[test]
  fn a_running_endpoint_clears_an_earlier_failure() {
    let recovered = compose_status(true, true, true, true, Some("unable to bind".to_string()));
    assert!(recovered.listening);
    assert_eq!(recovered.start_error, None);
  }

  #[test]
  fn a_platform_that_cannot_listen_never_reports_a_listening_endpoint() {
    assert!(!compose_status(false, true, true, true, None).listening);
    assert!(!compose_status(true, false, true, true, None).listening);
  }

  #[test]
  fn a_stored_yes_does_not_survive_a_platform_that_cannot_honour_it() {
    assert!(!status(false, true, true).enabled);
    assert!(!status(true, false, true).enabled);
    assert!(status(true, true, true).enabled);
  }
}
