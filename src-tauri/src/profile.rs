use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "plvs-settings.json";
const PROFILE_APP: &str = "PLVS";
const PROFILE_KIND: &str = "configuration-profile";
const PROFILE_VERSION: i64 = 1;
const DEFAULT_CLEAR_SHORTCUT: &str = "CmdOrCtrl+K";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ProfileImportOptions {
  pub include_window_bounds: bool,
  pub include_capture_device: bool,
}

const DOMAIN_KEYS: [&str; 4] = [
  "plvs:settings",
  "plvs:workspace",
  "plvs:presets",
  "plvs:themes",
];

const SIBLING_KEYS: [&str; 4] = [
  "windowBounds",
  "captureDeviceId",
  "clearShortcut",
  "clearGlobal",
];

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
  let Some(rest) = id.strip_prefix("in:").or_else(|| id.strip_prefix("out:")) else {
    return false;
  };
  !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
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
  json!({
    "x": x.round() as i64,
    "y": y.round() as i64,
    "width": width.round() as u64,
    "height": height.round() as u64,
    "isMaximized": obj.get("isMaximized").and_then(Value::as_bool).unwrap_or(false),
  })
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
    "clearShortcut".into(),
    match obj
      .and_then(|o| o.get("clearShortcut"))
      .and_then(Value::as_str)
    {
      Some(shortcut) if !shortcut.trim().is_empty() => json!(shortcut),
      _ => json!(DEFAULT_CLEAR_SHORTCUT),
    },
  );
  out.insert(
    "clearGlobal".into(),
    json!(obj
      .and_then(|o| o.get("clearGlobal"))
      .and_then(Value::as_bool)
      .unwrap_or(false)),
  );

  out
}

pub fn validate_profile_identity(profile: &Value) -> Result<(), String> {
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

pub fn write_store_map(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|err| format!("Unable to create configuration directory: {err}"))?;
  }
  let contents = serde_json::to_string_pretty(map)
    .map_err(|err| format!("Unable to serialize settings store: {err}"))?;
  fs::write(path, format!("{contents}\n"))
    .map_err(|err| format!("Unable to write settings store: {err}"))
}

pub fn build_profile_snapshot_from_store(store: &Map<String, Value>) -> Value {
  json!({
    "app": PROFILE_APP,
    "kind": PROFILE_KIND,
    "version": PROFILE_VERSION,
    "exportedAt": chrono_like_utc_now(),
    "settings": store.get("plvs:settings").cloned().unwrap_or_else(|| json!({})),
    "workspace": store.get("plvs:workspace").cloned().unwrap_or_else(|| json!({})),
    "presets": store.get("plvs:presets").cloned().unwrap_or_else(|| json!({})),
    "themes": store.get("plvs:themes").cloned().unwrap_or_else(|| json!({})),
    "windowBounds": store.get("windowBounds").cloned().unwrap_or(Value::Null),
    "captureDeviceId": store.get("captureDeviceId").cloned().unwrap_or_else(|| json!("default")),
    "clearShortcut": store.get("clearShortcut").cloned().unwrap_or_else(|| json!(DEFAULT_CLEAR_SHORTCUT)),
    "clearGlobal": store.get("clearGlobal").cloned().unwrap_or(json!(false)),
  })
}

fn chrono_like_utc_now() -> String {
  time::OffsetDateTime::now_utc()
    .format(&time::format_description::well_known::Rfc3339)
    .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// Headless export of the installed configuration profile.
pub fn export_profile_from_disk() -> Result<Value, String> {
  let path = store_file_path()?;
  let store = read_store_map(&path)?;
  Ok(build_profile_snapshot_from_store(&store))
}

/// Headless import. By default skips machine-specific window bounds and capture device id.
pub fn import_profile_to_disk(
  profile: Value,
  options: ProfileImportOptions,
) -> Result<PathBuf, String> {
  validate_profile_identity(&profile)?;
  let path = store_file_path()?;
  let mut store = read_store_map(&path)?;
  let values = normalize_profile_for_store(profile);

  for key in DOMAIN_KEYS {
    store.insert(
      key.to_string(),
      values.get(key).cloned().unwrap_or_else(|| json!({})),
    );
  }

  store.insert(
    "clearShortcut".into(),
    values
      .get("clearShortcut")
      .cloned()
      .unwrap_or_else(|| json!(DEFAULT_CLEAR_SHORTCUT)),
  );
  store.insert(
    "clearGlobal".into(),
    values.get("clearGlobal").cloned().unwrap_or(json!(false)),
  );

  if options.include_window_bounds {
    match values.get("windowBounds") {
      Some(Value::Null) | None => {
        store.remove("windowBounds");
      }
      Some(value) => {
        store.insert("windowBounds".into(), value.clone());
      }
    }
  }

  if options.include_capture_device {
    store.insert(
      "captureDeviceId".into(),
      values
        .get("captureDeviceId")
        .cloned()
        .unwrap_or_else(|| json!("default")),
    );
  }

  write_store_map(&path, &store)?;
  Ok(path)
}

#[tauri::command]
pub fn export_profile(app: AppHandle) -> Result<Value, String> {
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
    "clearShortcut": store.get("clearShortcut").unwrap_or(json!(DEFAULT_CLEAR_SHORTCUT)),
    "clearGlobal": store.get("clearGlobal").unwrap_or(json!(false)),
  }))
}

#[tauri::command]
pub fn import_profile(app: AppHandle, profile: Value) -> Result<(), String> {
  validate_profile_identity(&profile)?;
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

#[tauri::command]
pub fn reset_profile(app: AppHandle) -> Result<(), String> {
  let store = app
    .store(STORE_FILE)
    .map_err(|e| format!("store load: {e}"))?;
  for key in DOMAIN_KEYS.iter().chain(SIBLING_KEYS.iter()) {
    store.delete(key);
  }
  store.save().map_err(|e| format!("store save: {e}"))?;
  Ok(())
}

#[tauri::command]
pub fn read_profile_file(path: String) -> Result<String, String> {
  fs::read_to_string(path).map_err(|e| format!("read profile file: {e}"))
}

#[tauri::command]
pub fn write_profile_file(path: String, contents: String) -> Result<(), String> {
  fs::write(path, contents).map_err(|e| format!("write profile file: {e}"))
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
  fs::write(path, contents).map_err(|e| format!("write text file: {e}"))
}

#[cfg(test)]
mod tests {
  use super::*;

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
    assert_eq!(values["clearShortcut"], "CmdOrCtrl+L");
    assert_eq!(values["clearGlobal"], true);
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
    assert_eq!(values["clearShortcut"], DEFAULT_CLEAR_SHORTCUT);
    assert_eq!(values["clearGlobal"], false);
  }

  #[test]
  fn rejects_non_plvs_profiles() {
    assert!(validate_profile_identity(&json!({ "app": "Other" })).is_err());
    assert!(validate_profile_identity(&json!({
      "app": "PLVS",
      "kind": "configuration-profile",
      "version": 2
    }))
    .is_err());
  }
}
