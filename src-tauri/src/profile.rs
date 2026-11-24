use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use atomic_write_file::AtomicWriteFile;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

/// Store used by the legacy fallback when transactional Workspace persistence is unavailable.
const STORE_FILE: &str = "plvs-settings.json";
const PROFILE_APP: &str = "PLVS";
const PROFILE_KIND: &str = "configuration-profile";
const PROFILE_VERSION: i64 = 2;
const DEFAULT_CLEAR_SHORTCUT: &str = "CmdOrCtrl+K";
const DEFAULT_TOGGLE_LIVE_CAPTURE_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";
const DEFAULT_TOGGLE_LIVE_SNAPSHOT_SHORTCUT: &str = "CmdOrCtrl+Shift+L";
const STARTER_ITEMS_SEEDED_KEY: &str = "starterItemsSeeded";

const DOMAIN_KEYS: [&str; 4] = [
  "plvs:settings",
  "plvs:workspace",
  "plvs:presets",
  "plvs:themes",
];

const SIBLING_KEYS: [&str; 3] = ["windowBounds", "captureDeviceId", "keyboardShortcuts"];

fn default_keyboard_shortcuts() -> Value {
  json!({
    "toggleLiveCapture": {
      "accelerator": DEFAULT_TOGGLE_LIVE_CAPTURE_SHORTCUT,
      "global": false,
    },
    "toggleLiveSnapshot": {
      "accelerator": DEFAULT_TOGGLE_LIVE_SNAPSHOT_SHORTCUT,
      "global": false,
    },
    "clear": {
      "accelerator": DEFAULT_CLEAR_SHORTCUT,
      "global": false,
    },
  })
}

fn normalize_keyboard_shortcuts(obj: Option<&Map<String, Value>>) -> Value {
  let configured = obj
    .and_then(|value| value.get("keyboardShortcuts"))
    .and_then(Value::as_object);
  let defaults = default_keyboard_shortcuts();
  let defaults = defaults
    .as_object()
    .expect("shortcut defaults are an object");
  let mut normalized = Map::new();
  let mut used = std::collections::HashSet::new();
  for action_id in ["toggleLiveCapture", "toggleLiveSnapshot", "clear"] {
    let fallback = defaults[action_id].as_object().unwrap();
    let action = configured
      .and_then(|shortcuts| shortcuts.get(action_id))
      .and_then(Value::as_object);
    let mut accelerator = match action.and_then(|value| value.get("accelerator")) {
      Some(Value::Null) => Value::Null,
      Some(Value::String(value)) if !value.trim().is_empty() => json!(value),
      _ if action_id == "clear" && configured.is_none() => obj
        .and_then(|value| value.get("clearShortcut"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map_or_else(|| fallback["accelerator"].clone(), |value| json!(value)),
      _ => fallback["accelerator"].clone(),
    };
    let duplicate = accelerator
      .as_str()
      .is_some_and(|value| used.contains(value));
    if duplicate {
      accelerator = fallback["accelerator"].clone();
      if accelerator
        .as_str()
        .is_some_and(|value| used.contains(value))
      {
        accelerator = Value::Null;
      }
    }
    if let Some(value) = accelerator.as_str() {
      used.insert(value.to_string());
    }
    let global = if accelerator.is_null() || duplicate {
      false
    } else {
      action
        .and_then(|value| value.get("global"))
        .and_then(Value::as_bool)
        .or_else(|| {
          (action_id == "clear" && configured.is_none())
            .then(|| {
              obj
                .and_then(|value| value.get("clearGlobal"))
                .and_then(Value::as_bool)
            })
            .flatten()
        })
        .unwrap_or(false)
    };
    normalized.insert(
      action_id.to_string(),
      json!({ "accelerator": accelerator, "global": global }),
    );
  }
  Value::Object(normalized)
}

fn plain_object(value: Option<Value>) -> Value {
  match value {
    Some(Value::Object(_)) => value.unwrap(),
    _ => json!({}),
  }
}

fn normalize_capture_device_id(value: Option<&Value>) -> Value {
  match value.and_then(Value::as_str) {
    Some("default") => json!("default"),
    Some(id) if is_device_id_shape(id) => json!(id),
    _ => json!("default"),
  }
}

fn is_device_id_shape(id: &str) -> bool {
  if crate::audio::device_id::split_channel_source(id).is_some() {
    return true;
  }
  if let Some(rest) = id.strip_prefix("in:").or_else(|| id.strip_prefix("out:")) {
    return !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit());
  }
  id.strip_prefix("lb-")
    .or_else(|| id.strip_prefix("cap-"))
    .or_else(|| id.strip_prefix("app-"))
    .is_some_and(|rest| {
      rest.len() == 32 && rest.chars().all(|character| character.is_ascii_hexdigit())
    })
}

fn normalize_window_bounds(value: Option<&Value>) -> Value {
  let Some(obj) = value.and_then(Value::as_object) else {
    return Value::Null;
  };
  let (Some(x), Some(y), Some(width), Some(height)) = (
    obj.get("x").and_then(Value::as_f64),
    obj.get("y").and_then(Value::as_f64),
    obj.get("width").and_then(Value::as_f64),
    obj.get("height").and_then(Value::as_f64),
  ) else {
    return Value::Null;
  };
  if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
    return Value::Null;
  }
  if width <= 0.0 || height <= 0.0 {
    return Value::Null;
  }
  let mut bounds = json!({
    "x": x.round() as i64,
    "y": y.round() as i64,
    "width": width.round() as u64,
    "height": height.round() as u64,
    "isMaximized": obj.get("isMaximized").and_then(Value::as_bool).unwrap_or(false),
  });
  if let Some(relative) = obj.get("relative").filter(|value| value.is_object()) {
    bounds["relative"] = relative.clone();
  }
  bounds
}

pub fn normalize_profile_for_store(profile: Value) -> Map<String, Value> {
  let obj = profile.as_object();
  let mut out = Map::new();

  out.insert(
    "plvs:settings".into(),
    plain_object(obj.and_then(|o| o.get("settings")).cloned()),
  );
  out.insert(
    "plvs:workspace".into(),
    plain_object(obj.and_then(|o| o.get("workspace")).cloned()),
  );
  out.insert(
    "plvs:presets".into(),
    plain_object(obj.and_then(|o| o.get("presets")).cloned()),
  );
  out.insert(
    "plvs:themes".into(),
    plain_object(obj.and_then(|o| o.get("themes")).cloned()),
  );
  out.insert(
    "windowBounds".into(),
    normalize_window_bounds(obj.and_then(|o| o.get("windowBounds"))),
  );
  out.insert(
    "captureDeviceId".into(),
    normalize_capture_device_id(obj.and_then(|o| o.get("captureDeviceId"))),
  );
  out.insert(
    "keyboardShortcuts".into(),
    normalize_keyboard_shortcuts(obj),
  );

  out
}

fn validate_profile(profile: &Value) -> Result<(), String> {
  let Some(obj) = profile.as_object() else {
    return Err("Choose a PLVS configuration file.".into());
  };
  if obj.get("app").and_then(Value::as_str) != Some(PROFILE_APP)
    || obj.get("kind").and_then(Value::as_str) != Some(PROFILE_KIND)
  {
    return Err("This is not a PLVS configuration file.".into());
  }
  let version = obj.get("version").and_then(Value::as_i64).unwrap_or(0);
  if version < 1 {
    return Err("This PLVS configuration file is missing a version.".into());
  }
  if version > PROFILE_VERSION {
    return Err("This PLVS configuration file was made by a newer version.".into());
  }
  if !profile["settings"].is_object()
    || !profile["workspace"].is_object()
    || !profile["presets"]["list"].is_array()
    || !profile["themes"]["themes"].is_object()
    || profile["settings"]
      .get("loudnessProfiles")
      .is_some_and(|profiles| !profiles["profiles"].is_array())
  {
    return Err(
      "This PLVS configuration is incomplete. Choose a complete configuration export.".into(),
    );
  }
  Ok(())
}

pub fn store_file_path() -> Result<PathBuf, String> {
  let dir = crate::doctor::resolve_config_dir()
    .ok_or_else(|| "Unable to resolve the PLVS configuration directory.".to_string())?;
  Ok(dir.join(STORE_FILE))
}

pub fn read_store_map(path: &Path) -> Result<Map<String, Value>, String> {
  if !path.exists() {
    return Ok(Map::new());
  }
  let contents =
    fs::read_to_string(path).map_err(|err| format!("Unable to read settings store: {err}"))?;
  let value: Value = serde_json::from_str(&contents)
    .map_err(|err| format!("Unable to parse settings store JSON: {err}"))?;
  match value {
    Value::Object(map) => Ok(map),
    _ => Err("Settings store must be a JSON object.".to_string()),
  }
}

fn profile_from_hydrated(mut hydrated: crate::persistence::HydratedWorkspace) -> Value {
  if let Some(settings) = hydrated.settings.as_object_mut() {
    settings.remove("quickTour");
  }
  json!({
    "settings": hydrated.settings,
    "workspace": hydrated.workspace,
    "presets": hydrated.presets,
    "themes": hydrated.themes,
    "windowBounds": hydrated.window_bounds,
    "captureDeviceId": hydrated.capture_device_id,
    "keyboardShortcuts": normalize_keyboard_shortcuts(Some(&hydrated.global_preferences
      .into_iter().collect::<Map<String, Value>>())),
  })
}

fn ordered_theme_documents(themes: &Value) -> Vec<Value> {
  let Some(object) = themes.as_object() else {
    return Vec::new();
  };
  let documents = object
    .get("themes")
    .and_then(Value::as_object)
    .cloned()
    .unwrap_or_default();
  let mut seen = std::collections::HashSet::new();
  let mut ordered = Vec::new();
  for id in object
    .get("order")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .filter_map(Value::as_str)
  {
    if let Some(document) = documents.get(id) {
      ordered.push(document.clone());
      seen.insert(id.to_string());
    }
  }
  for (id, document) in documents {
    if seen.insert(id) {
      ordered.push(document);
    }
  }
  ordered
}

fn profile_import_journal_path(
  session: &crate::persistence::WorkspacePersistenceSession,
) -> PathBuf {
  session.identity_root().join("transactions").join(format!(
    "configuration-import-{}.json",
    session.workspace_id()
  ))
}

fn write_profile_import_journal(
  session: &crate::persistence::WorkspacePersistenceSession,
  import_id: &str,
) -> Result<(), String> {
  let path = profile_import_journal_path(session);
  let parent = path
    .parent()
    .ok_or_else(|| "Configuration import journal has no parent directory.".to_string())?;
  fs::create_dir_all(parent)
    .map_err(|error| format!("Unable to create configuration import journal directory: {error}"))?;
  let mut bytes = serde_json::to_vec_pretty(&json!({
    "version": 2,
    "importId": import_id,
    "workspace": session.workspace_snapshot()?,
  }))
  .map_err(|error| format!("Unable to serialize configuration import journal: {error}"))?;
  bytes.push(b'\n');
  let mut file = AtomicWriteFile::open(&path)
    .map_err(|error| format!("Unable to open configuration import journal: {error}"))?;
  file
    .write_all(&bytes)
    .map_err(|error| format!("Unable to write configuration import journal: {error}"))?;
  file
    .commit()
    .map_err(|error| format!("Unable to commit configuration import journal: {error}"))
}

fn remove_profile_import_journal(
  session: &crate::persistence::WorkspacePersistenceSession,
) -> Result<(), String> {
  match fs::remove_file(profile_import_journal_path(session)) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(error) => Err(format!(
      "Unable to remove configuration import journal: {error}"
    )),
  }
}

pub(crate) fn recover_configuration_import(
  session: &crate::persistence::WorkspacePersistenceSession,
) -> Result<(), String> {
  let path = profile_import_journal_path(session);
  let bytes = match fs::read(&path) {
    Ok(bytes) => bytes,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
    Err(error) => {
      return Err(format!(
        "Unable to read configuration import journal: {error}"
      ))
    }
  };
  let journal: Value = serde_json::from_slice(&bytes)
    .map_err(|error| format!("Unable to parse configuration import journal: {error}"))?;
  match journal.get("version").and_then(Value::as_i64) {
    Some(1) => {
      // Legacy journals have no shared revision checks. Preserve the snapshot for manual
      // recovery and leave the current data in place.
      let recovery_id =
        crate::runtime_identity::RuntimeIdentity::new_for_workspace(session.workspace_id())?;
      let archived = path.with_extension(format!("legacy-{}.json", recovery_id.instance_id()));
      fs::rename(&path, &archived).map_err(|error| {
        format!("Unable to preserve legacy configuration import journal: {error}")
      })?;
      log::warn!(
        "Legacy configuration recovery snapshot retained at {}",
        archived.display()
      );
      return Ok(());
    }
    Some(2) => {}
    _ => return Err("Unsupported configuration import journal version.".to_string()),
  }
  let import_id = journal
    .get("importId")
    .and_then(Value::as_str)
    .ok_or_else(|| "Configuration import journal is missing its import ID.".to_string())?;
  if session
    .library()
    .configuration_committed(session.workspace_id(), import_id)
    .map_err(|error| error.to_string())?
  {
    // The commit marker and shared data were written in the same SQLite transaction.
    // A leftover journal after a successful commit is safe to keep until cleanup succeeds.
    if let Err(error) = remove_profile_import_journal(session) {
      log::warn!("{error}");
    }
    return Ok(());
  }
  let workspace = journal
    .get("workspace")
    .and_then(Value::as_object)
    .cloned()
    .ok_or_else(|| "Configuration import journal is missing its workspace snapshot.".to_string())?;
  session.replace_workspace_snapshot(workspace)?;
  remove_profile_import_journal(session)
}

fn apply_profile_to_session_before_commit(
  session: &crate::persistence::WorkspacePersistenceSession,
  profile: Value,
  reset: bool,
  after_workspace_save: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
  recover_configuration_import(session)?;
  let values = normalize_profile_for_store(profile);
  let settings = &values["plvs:settings"];
  let collections = [
    (
      "preset",
      values["plvs:presets"]["list"]
        .as_array()
        .cloned()
        .unwrap_or_default(),
    ),
    ("theme", ordered_theme_documents(&values["plvs:themes"])),
    (
      "loudnessProfile",
      settings["loudnessProfiles"]["profiles"]
        .as_array()
        .cloned()
        .unwrap_or_default(),
    ),
  ];
  let mut preferences = BTreeMap::from([(
    "keyboardShortcuts",
    Some(
      values
        .get("keyboardShortcuts")
        .cloned()
        .unwrap_or_else(default_keyboard_shortcuts),
    ),
  )]);
  if let Some(consent) = settings.get("askToSendCrashReports") {
    preferences.insert("askToSendCrashReports", Some(consent.clone()));
  }
  if reset {
    preferences.insert("quickTour", Some(json!("pending")));
    preferences.insert(STARTER_ITEMS_SEEDED_KEY, None);
  }

  let import = crate::runtime_identity::RuntimeIdentity::new_for_workspace(session.workspace_id())?;
  write_profile_import_journal(session, import.instance_id())?;
  let result = session.library().commit_configuration(
    session.workspace_id(),
    import.instance_id(),
    &collections,
    &preferences,
    || {
      session.save_configuration_workspace(&values)?;
      after_workspace_save()
    },
  );
  match result {
    Ok(()) => {
      if let Err(error) = remove_profile_import_journal(session) {
        log::warn!("{error}");
      }
      Ok(())
    }
    Err(error) => match recover_configuration_import(session) {
      Ok(()) => Err(error.to_string()),
      Err(recovery_error) => Err(format!(
        "{error} Workspace recovery also failed: {recovery_error} The import journal was kept for startup recovery."
      )),
    },
  }
}

fn apply_profile_to_session(
  session: &crate::persistence::WorkspacePersistenceSession,
  profile: Value,
) -> Result<(), String> {
  apply_profile_to_session_before_commit(session, profile, false, || Ok(()))
}

#[tauri::command]
pub fn export_profile(app: AppHandle) -> Result<Value, String> {
  let runtime = app.state::<crate::persistence::commands::PersistenceRuntime>();
  if runtime.is_installed() {
    return runtime.with_session_raw(|session| session.hydrate().map(profile_from_hydrated));
  }
  let store = app
    .store(STORE_FILE)
    .map_err(|e| format!("store load: {e}"))?;
  Ok(json!({
    "settings": store.get("plvs:settings").unwrap_or(json!({})),
    "workspace": store.get("plvs:workspace").unwrap_or(json!({})),
    "presets": store.get("plvs:presets").unwrap_or(json!({})),
    "themes": store.get("plvs:themes").unwrap_or(json!({})),
    "windowBounds": store.get("windowBounds").unwrap_or(Value::Null),
    "captureDeviceId": store.get("captureDeviceId").unwrap_or(json!("default")),
    "keyboardShortcuts": normalize_keyboard_shortcuts(Some(&Map::from_iter([
      ("keyboardShortcuts".to_string(), store.get("keyboardShortcuts").unwrap_or(Value::Null)),
      ("clearShortcut".to_string(), store.get("clearShortcut").unwrap_or(Value::Null)),
      ("clearGlobal".to_string(), store.get("clearGlobal").unwrap_or(Value::Null)),
    ]))),
  }))
}

#[tauri::command]
pub fn import_profile(app: AppHandle, profile: Value) -> Result<(), String> {
  validate_profile(&profile)?;
  let runtime = app.state::<crate::persistence::commands::PersistenceRuntime>();
  if runtime.is_installed() {
    return runtime.with_session_raw(|session| apply_profile_to_session(session, profile));
  }
  let store = app
    .store(STORE_FILE)
    .map_err(|e| format!("store load: {e}"))?;
  let values = normalize_profile_for_store(profile);

  for key in DOMAIN_KEYS {
    store.set(key, values.get(key).cloned().unwrap_or_else(|| json!({})));
  }
  for key in SIBLING_KEYS {
    if key == "windowBounds" && values.get(key) == Some(&Value::Null) {
      store.delete(key);
      continue;
    }
    store.set(key, values.get(key).cloned().unwrap_or(Value::Null));
  }
  store.save().map_err(|e| format!("store save: {e}"))?;
  Ok(())
}

/// Reset restores first-run preferences in the same transaction as the Library changes.
fn reset_session(session: &crate::persistence::WorkspacePersistenceSession) -> Result<(), String> {
  apply_profile_to_session_before_commit(
    session,
    json!({ "app": PROFILE_APP, "kind": PROFILE_KIND, "version": PROFILE_VERSION }),
    true,
    || Ok(()),
  )
}

#[tauri::command]
pub fn reset_profile(app: AppHandle) -> Result<(), String> {
  let runtime = app.state::<crate::persistence::commands::PersistenceRuntime>();
  if runtime.is_installed() {
    return runtime.with_session_raw(reset_session);
  }
  let store = app
    .store(STORE_FILE)
    .map_err(|e| format!("store load: {e}"))?;
  for key in DOMAIN_KEYS.iter().chain(SIBLING_KEYS.iter()) {
    store.delete(key);
  }
  store.delete("clearShortcut");
  store.delete("clearGlobal");
  store.save().map_err(|e| format!("store save: {e}"))?;
  Ok(())
}

#[tauri::command]
pub fn read_profile_file(path: String) -> Result<String, String> {
  fs::read_to_string(path).map_err(|e| format!("read profile file: {e}"))
}

#[tauri::command]
pub fn write_profile_file(path: String, contents: String) -> Result<(), String> {
  write_export(Path::new(&path), contents.as_bytes())
    .map_err(|e| format!("write profile file: {e}"))
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
  write_export(Path::new(&path), contents.as_bytes()).map_err(|e| format!("write text file: {e}"))
}

pub(crate) fn write_export(path: &Path, contents: &[u8]) -> std::io::Result<()> {
  let mut file = open_export(path)?;
  file.write_all(contents)?;
  file.commit()
}

pub(crate) fn open_export(path: &Path) -> std::io::Result<AtomicWriteFile> {
  // An existing symlink should keep redirecting exports to the same file.
  let destination = if fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_symlink()) {
    path.canonicalize()?
  } else {
    path.to_path_buf()
  };
  match fs::metadata(&destination) {
    Ok(metadata) if metadata.is_file() => {
      // Check the existing file's write permission without truncating it.
      fs::OpenOptions::new().write(true).open(&destination)?;
    }
    Ok(_) => {
      return Err(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "The export destination is not a regular file",
      ));
    }
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
    Err(error) => return Err(error),
  }
  AtomicWriteFile::open(destination)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn exports_replace_previous_contents_completely() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("export.json");
    let destination = path.to_str().unwrap().to_owned();
    write_profile_file(destination.clone(), "old configuration".into()).unwrap();
    write_text_file(destination, "new text".into()).unwrap();
    assert_eq!(fs::read_to_string(path).unwrap(), "new text");
  }

  #[cfg(unix)]
  #[test]
  fn exporting_to_a_symlink_preserves_the_link() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("target");
    fs::write(&target, "old").unwrap();
    let path = directory.path().join("export");
    std::os::unix::fs::symlink(&target, &path).unwrap();

    write_export(&path, b"new").unwrap();

    assert!(fs::symlink_metadata(path).unwrap().is_symlink());
    assert_eq!(fs::read_to_string(target).unwrap(), "new");
  }

  #[test]
  fn preserves_relative_window_placement_for_complete_setup() {
    let bounds = json!({
      "x": 768, "y": 432, "width": 1024, "height": 576, "isMaximized": false,
      "relative": {
        "monitor": "test", "scale": 1.0,
        "workArea": {"x": 0, "y": 0, "width": 2560, "height": 1440},
        "logicalWidth": 1024, "logicalHeight": 576, "frameWidth": 0, "frameHeight": 0,
        "horizontal": 0.5, "vertical": 0.5
      }
    });
    let values = normalize_profile_for_store(json!({
      "windowBounds": bounds,
      "presets": {"list": [{"id": "test", "name": "Test", "windowBounds": bounds}]}
    }));
    assert_eq!(values["windowBounds"], bounds);
    assert_eq!(values["plvs:presets"]["list"][0]["windowBounds"], bounds);
  }

  #[test]
  fn normalizes_store_keys_from_profile_shape() {
    let values = normalize_profile_for_store(json!({
      "settings": { "referenceLufs": -23 },
      "workspace": { "panelOrder": [] },
      "presets": { "list": [], "activeId": null },
      "themes": { "themes": {}, "order": [] },
      "windowBounds": { "x": 1.2, "y": 2.8, "width": 800.4, "height": 600.6, "isMaximized": true },
      "captureDeviceId": "out:2",
      "clearShortcut": "CmdOrCtrl+L",
      "clearGlobal": true
    }));

    assert_eq!(values["plvs:settings"]["referenceLufs"], -23);
    assert_eq!(values["windowBounds"]["x"], 1);
    assert_eq!(values["windowBounds"]["y"], 3);
    assert_eq!(values["windowBounds"]["width"], 800);
    assert_eq!(values["windowBounds"]["height"], 601);
    assert_eq!(values["windowBounds"]["isMaximized"], true);
    assert_eq!(values["captureDeviceId"], "out:2");
    assert_eq!(
      values["keyboardShortcuts"]["clear"],
      json!({ "accelerator": "CmdOrCtrl+L", "global": true })
    );
  }

  #[test]
  fn transactional_profile_replaces_shared_library_and_workspace_state() {
    let root =
      std::env::temp_dir().join(format!("plvs-transactional-profile-{}", std::process::id()));
    let session = crate::persistence::WorkspacePersistenceSession::open(&root, "default").unwrap();
    apply_profile_to_session(
      &session,
      json!({
        "settings": {
          "referenceLufs": -18,
          "loudnessProfiles": {
            "active": "profile:broadcast",
            "profiles": [{ "id": "broadcast", "name": "Broadcast" }]
          }
        },
        "workspace": { "panelOrder": ["loudness"] },
        "presets": {
          "activeId": "one",
          "list": [{ "id": "one", "name": "One" }]
        },
        "themes": {
          "themes": { "dark": { "id": "dark", "name": "Dark" } },
          "order": ["dark"]
        },
        "windowBounds": { "x": 10, "y": 20, "width": 800, "height": 600 },
        "captureDeviceId": "out:2",
        "clearShortcut": "CmdOrCtrl+L",
        "clearGlobal": true
      }),
    )
    .unwrap();

    let exported = profile_from_hydrated(session.hydrate().unwrap());
    assert_eq!(exported["settings"]["referenceLufs"], -18);
    assert_eq!(exported["presets"]["list"][0]["id"], "one");
    assert_eq!(exported["themes"]["order"], json!(["dark"]));
    assert_eq!(exported["captureDeviceId"], "out:2");
    assert_eq!(
      exported["keyboardShortcuts"]["clear"],
      json!({ "accelerator": "CmdOrCtrl+L", "global": true })
    );

    drop(session);
    let _ = std::fs::remove_dir_all(root);
  }

  #[test]
  fn reset_preserves_agent_control_consent_after_reopen() {
    use crate::agent_control::toggle::ENABLED_KEY;
    use crate::persistence::WorkspacePersistenceSession;

    let root =
      std::env::temp_dir().join(format!("plvs-reset-agent-control-{}", std::process::id()));
    let session = WorkspacePersistenceSession::open(&root, "default").unwrap();
    session
      .library()
      .set_global_preference(ENABLED_KEY, 0, &json!(true))
      .unwrap();
    reset_session(&session).unwrap();
    drop(session);

    let reopened = WorkspacePersistenceSession::open(&root, "default").unwrap();
    assert_eq!(
      reopened
        .hydrate()
        .unwrap()
        .global_preferences
        .get(ENABLED_KEY),
      Some(&json!(true))
    );
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn only_reset_forgets_that_the_starter_items_were_seeded() {
    let root = std::env::temp_dir().join(format!("plvs-reset-seed-marker-{}", std::process::id()));
    let session = crate::persistence::WorkspacePersistenceSession::open(&root, "default").unwrap();
    let profiles = |session: &crate::persistence::WorkspacePersistenceSession| {
      session.hydrate().unwrap().settings["loudnessProfiles"]
        .get("profiles")
        .cloned()
    };
    // Untouched: `profiles` is left out, which asks the frontend to seed the starter.
    assert_eq!(profiles(&session), None);
    session
      .library()
      .set_global_preferences(
        &std::collections::BTreeMap::from([(STARTER_ITEMS_SEEDED_KEY.to_string(), 0)]),
        &std::collections::BTreeMap::from([(STARTER_ITEMS_SEEDED_KEY.to_string(), json!(true))]),
      )
      .unwrap();
    let seeded = |session: &crate::persistence::WorkspacePersistenceSession| {
      session
        .hydrate()
        .unwrap()
        .global_preferences
        .get(STARTER_ITEMS_SEEDED_KEY)
        .cloned()
    };

    apply_profile_to_session(
      &session,
      json!({ "app": PROFILE_APP, "kind": PROFILE_KIND, "version": PROFILE_VERSION }),
    )
    .unwrap();
    assert_eq!(seeded(&session), Some(json!(true)));
    // Settled: the emptied profile library stays empty instead of asking for the starter again.
    assert_eq!(profiles(&session), Some(json!([])));

    reset_session(&session).unwrap();
    assert_eq!(seeded(&session), None);
    assert_eq!(profiles(&session), None);

    drop(session);
    let _ = std::fs::remove_dir_all(root);
  }

  #[test]
  fn transactional_profile_rolls_back_every_domain_after_a_mid_import_failure() {
    let root = std::env::temp_dir().join(format!(
      "plvs-transactional-profile-rollback-{}",
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let session = crate::persistence::WorkspacePersistenceSession::open(&root, "default").unwrap();
    apply_profile_to_session(
      &session,
      json!({
        "settings": { "referenceLufs": -23, "askToSendCrashReports": false },
        "workspace": { "panelOrder": ["level"] },
        "presets": { "activeId": "old", "list": [{ "id": "old", "name": "Old" }] },
        "themes": { "themes": {}, "order": [] },
        "captureDeviceId": "default"
      }),
    )
    .unwrap();
    let before = session.hydrate().unwrap();

    let error = apply_profile_to_session_before_commit(
      &session,
      json!({
        "settings": { "referenceLufs": -18, "askToSendCrashReports": true },
        "workspace": { "panelOrder": ["loudness"] },
        "presets": { "activeId": "new", "list": [{ "id": "new", "name": "New" }] },
        "themes": { "themes": { "new": { "id": "new", "name": "New" } }, "order": ["new"] },
        "captureDeviceId": "out:2"
      }),
      false,
      || Err("injected import failure".to_string()),
    )
    .unwrap_err();

    assert!(error.contains("injected import failure"));
    assert_eq!(
      profile_from_hydrated(session.hydrate().unwrap()),
      profile_from_hydrated(before)
    );
    drop(session);
    let _ = std::fs::remove_dir_all(root);
  }

  #[test]
  fn recovery_after_interruption_preserves_later_saves_in_another_workbench() {
    use crate::persistence::{WorkspacePersistenceSession, WorkspaceStore};
    const CHILD_ROOT: &str = "PLVS_TEST_INTERRUPTED_CONFIGURATION_ROOT";
    const INTERRUPTED: i32 = 73;
    if let Some(root) = std::env::var_os(CHILD_ROOT) {
      let session = WorkspacePersistenceSession::open(Path::new(&root), "secondary").unwrap();
      apply_profile_to_session_before_commit(
        &session,
        json!({
          "settings": { "referenceLufs": -18, "askToSendCrashReports": true },
          "presets": { "list": [{ "id": "partial", "name": "Partial" }] },
        }),
        false,
        || std::process::exit(INTERRUPTED),
      )
      .unwrap();
      panic!("child did not stop with its transaction open");
    }
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let session = WorkspacePersistenceSession::open(root, "secondary").unwrap();
    apply_profile_to_session(
      &session,
      json!({
        "settings": { "referenceLufs": -23 },
        "presets": { "list": [{ "id": "old", "name": "Old" }] },
      }),
    )
    .unwrap();
    let prior_workspace = session.workspace_snapshot().unwrap();
    let journal = profile_import_journal_path(&session);
    drop(session);

    let child = std::process::Command::new(std::env::current_exe().unwrap())
      .args(["--exact", std::thread::current().name().unwrap()])
      .env(CHILD_ROOT, root)
      .output()
      .unwrap();
    assert_eq!(child.status.code(), Some(INTERRUPTED), "{child:?}");
    let workspace = WorkspaceStore::open(root, "secondary").unwrap();
    assert_eq!(
      workspace.load().unwrap().unwrap()["plvs:settings"]["referenceLufs"],
      -18
    );
    assert!(journal.exists());

    let peer = WorkspacePersistenceSession::open(root, "default").unwrap();
    assert!(peer.library().read("preset", "partial").unwrap().is_none());
    assert!(peer
      .library()
      .read_global_preference("askToSendCrashReports")
      .unwrap()
      .is_none());
    peer
      .library()
      .create("preset", "later", &json!({"id": "later"}))
      .unwrap();
    let saved_revision = peer.library().collection_revision("preset").unwrap();

    let recovered = WorkspacePersistenceSession::open(root, "secondary").unwrap();
    assert_eq!(recovered.workspace_snapshot().unwrap(), prior_workspace);
    assert!(peer.library().read("preset", "old").unwrap().is_some());
    assert!(peer.library().read("preset", "later").unwrap().is_some());
    assert_eq!(
      peer.library().collection_revision("preset").unwrap(),
      saved_revision
    );
    assert!(!profile_import_journal_path(&recovered).exists());
  }

  #[test]
  fn committed_import_keeps_its_workspace_even_if_the_journal_survives() {
    use crate::persistence::WorkspacePersistenceSession;
    let directory = tempfile::tempdir().unwrap();
    let session = WorkspacePersistenceSession::open(directory.path(), "default").unwrap();
    let path = profile_import_journal_path(&session);
    let mut journal = Vec::new();
    apply_profile_to_session_before_commit(
      &session,
      json!({ "settings": { "referenceLufs": -18 } }),
      false,
      || {
        journal = fs::read(&path).unwrap();
        Ok(())
      },
    )
    .unwrap();
    fs::write(&path, journal).unwrap();
    drop(session);

    let reopened = WorkspacePersistenceSession::open(directory.path(), "default").unwrap();
    assert_eq!(reopened.hydrate().unwrap().settings["referenceLufs"], -18);
    assert!(!path.exists());
  }

  #[test]
  fn legacy_import_journal_is_preserved_without_replacing_saved_items() {
    use crate::persistence::WorkspacePersistenceSession;
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let session = WorkspacePersistenceSession::open(root, "secondary").unwrap();
    let path = profile_import_journal_path(&session);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let old = br#"{"version":1,"profile":{"presets":{"list":[]}},"globalPreferences":{}}"#;
    fs::write(&path, old).unwrap();
    drop(session);
    let peer = WorkspacePersistenceSession::open(root, "default").unwrap();
    peer
      .library()
      .create("preset", "later", &json!({"id": "later"}))
      .unwrap();

    let _reopened = WorkspacePersistenceSession::open(root, "secondary").unwrap();
    assert!(peer.library().read("preset", "later").unwrap().is_some());
    assert!(!path.exists());
    let archived = fs::read_dir(path.parent().unwrap())
      .unwrap()
      .next()
      .unwrap()
      .unwrap();
    assert_eq!(fs::read(archived.path()).unwrap(), old);
  }

  #[test]
  fn falls_back_for_invalid_sibling_values() {
    let values = normalize_profile_for_store(json!({
      "windowBounds": { "x": 0, "y": 0, "width": 0, "height": 1 },
      "captureDeviceId": "speaker",
      "clearShortcut": "",
      "clearGlobal": "yes"
    }));

    assert_eq!(values["windowBounds"], Value::Null);
    assert_eq!(values["captureDeviceId"], "default");
    assert_eq!(values["keyboardShortcuts"], default_keyboard_shortcuts());
  }

  #[test]
  fn normalizes_a_null_capture_source_to_automatic() {
    let values = normalize_profile_for_store(json!({ "captureDeviceId": null }));
    assert_eq!(values["captureDeviceId"], "default");
  }

  #[test]
  fn rejects_non_plvs_profiles() {
    assert!(validate_profile(&json!({ "app": "Other" })).is_err());
    assert!(validate_profile(&json!({
      "app": "PLVS",
      "kind": "configuration-profile",
      "version": 3
    }))
    .is_err());
  }

  #[test]
  fn incomplete_profiles_do_not_replace_an_existing_library() {
    let directory = tempfile::tempdir().unwrap();
    let session =
      crate::persistence::WorkspacePersistenceSession::open(directory.path(), "default").unwrap();
    session
      .library()
      .create(
        "preset",
        "existing",
        &json!({"id":"existing","name":"Existing"}),
      )
      .unwrap();
    let header = json!({"app":"PLVS","kind":"configuration-profile","version":2});
    assert!(validate_profile(&header)
      .and_then(|()| apply_profile_to_session(&session, header))
      .is_err());
    drop(session);
    let reopened =
      crate::persistence::WorkspacePersistenceSession::open(directory.path(), "default").unwrap();
    assert_eq!(
      reopened.hydrate().unwrap().presets["list"][0]["id"],
      "existing"
    );
    for version in [1, 2] {
      assert!(validate_profile(&json!({
        "app":"PLVS", "kind":"configuration-profile", "version":version,
        "settings":{}, "workspace":{}, "presets":{"list":[]}, "themes":{"themes":{}}
      }))
      .is_ok());
    }
  }

  #[test]
  fn agent_control_is_neither_exported_nor_imported() {
    use crate::agent_control::toggle::ENABLED_KEY;

    let directory = tempfile::tempdir().unwrap();
    let session =
      crate::persistence::WorkspacePersistenceSession::open(directory.path(), "default").unwrap();
    session
      .library()
      .set_global_preference(ENABLED_KEY, 0, &json!(true))
      .unwrap();
    let snapshot = profile_from_hydrated(session.hydrate().unwrap());
    assert!(
      snapshot.get(ENABLED_KEY).is_none(),
      "a permission must not travel inside an exported configuration"
    );

    assert!(!DOMAIN_KEYS.contains(&ENABLED_KEY));
    assert!(!SIBLING_KEYS.contains(&ENABLED_KEY));
  }
}
