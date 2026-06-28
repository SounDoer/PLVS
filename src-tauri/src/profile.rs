use std::fs;

use serde_json::{json, Map, Value};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "plvs-settings.json";
const PROFILE_APP: &str = "PLVS";
const PROFILE_KIND: &str = "configuration-profile";
const PROFILE_VERSION: i64 = 1;
const DEFAULT_CLEAR_SHORTCUT: &str = "CmdOrCtrl+K";

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

fn normalize_profile_for_store(profile: Value) -> Map<String, Value> {
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

fn validate_profile_identity(profile: &Value) -> Result<(), String> {
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
