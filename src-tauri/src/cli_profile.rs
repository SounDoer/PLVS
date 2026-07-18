use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::profile::{
  export_profile_from_disk, import_profile_to_disk, validate_profile_identity, ProfileImportOptions,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliProfileStatus {
  Ok,
  Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileValidateReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliProfileStatus,
  pub app: CliProfileApp,
  pub source: CliProfileSource,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub profile: Option<CliProfileIdentity>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<CliProfileError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileApp {
  pub name: String,
  pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileSource {
  pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileIdentity {
  pub app: String,
  pub kind: String,
  pub version: i64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub exported_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileError {
  pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileImportReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliProfileStatus,
  pub app: CliProfileApp,
  pub source: CliProfileSource,
  pub store_path: String,
  pub included_window_bounds: bool,
  pub included_capture_device: bool,
  pub note: String,
}

fn app_info() -> CliProfileApp {
  CliProfileApp {
    name: "PLVS".to_string(),
    version: env!("CARGO_PKG_VERSION").to_string(),
  }
}

pub fn run_profile_validate(path: &str) -> CliProfileValidateReport {
  match read_profile_value(path).and_then(|value| {
    validate_profile_identity(&value)?;
    Ok(value)
  }) {
    Ok(value) => CliProfileValidateReport {
      schema_version: 1,
      command: "profile-validate".to_string(),
      status: CliProfileStatus::Ok,
      app: app_info(),
      source: CliProfileSource {
        path: path.to_string(),
      },
      profile: Some(identity_from_value(&value)),
      error: None,
    },
    Err(message) => CliProfileValidateReport {
      schema_version: 1,
      command: "profile-validate".to_string(),
      status: CliProfileStatus::Error,
      app: app_info(),
      source: CliProfileSource {
        path: path.to_string(),
      },
      profile: None,
      error: Some(CliProfileError { message }),
    },
  }
}

pub fn run_profile_export() -> Result<Value, String> {
  export_profile_from_disk()
}

pub fn run_profile_import(
  path: &str,
  options: ProfileImportOptions,
) -> Result<CliProfileImportReport, String> {
  let value = read_profile_value(path)?;
  let store_path = import_profile_to_disk(value, options)?;
  Ok(CliProfileImportReport {
    schema_version: 1,
    command: "profile-import".to_string(),
    status: CliProfileStatus::Ok,
    app: app_info(),
    source: CliProfileSource {
      path: path.to_string(),
    },
    store_path: store_path.display().to_string(),
    included_window_bounds: options.include_window_bounds,
    included_capture_device: options.include_capture_device,
    note: "Restart the PLVS desktop app if it is open so it reloads the imported configuration."
      .to_string(),
  })
}

pub fn render_profile_validate_text(report: &CliProfileValidateReport) -> String {
  match report.status {
    CliProfileStatus::Ok => {
      let profile = report.profile.as_ref();
      format!(
        "PLVS profile: ok\nFile: {}\nApp: {}\nKind: {}\nVersion: {}\nExported at: {}\n",
        report.source.path,
        profile.map(|p| p.app.as_str()).unwrap_or("-"),
        profile.map(|p| p.kind.as_str()).unwrap_or("-"),
        profile
          .map(|p| p.version.to_string())
          .unwrap_or_else(|| "-".to_string()),
        profile
          .and_then(|p| p.exported_at.as_deref())
          .unwrap_or("-"),
      )
    }
    CliProfileStatus::Error => format!(
      "PLVS profile: error\nFile: {}\n{}\n",
      report.source.path,
      report
        .error
        .as_ref()
        .map(|error| error.message.as_str())
        .unwrap_or("unknown error"),
    ),
  }
}

pub fn render_profile_import_text(report: &CliProfileImportReport) -> String {
  format!(
    "PLVS profile imported\nSource: {}\nStore: {}\nWindow bounds: {}\nCapture device: {}\n{}\n",
    report.source.path,
    report.store_path,
    if report.included_window_bounds {
      "included"
    } else {
      "kept existing"
    },
    if report.included_capture_device {
      "included"
    } else {
      "kept existing"
    },
    report.note,
  )
}

fn read_profile_value(path: &str) -> Result<Value, String> {
  let contents = fs::read_to_string(Path::new(path))
    .map_err(|err| format!("Unable to read profile file: {err}"))?;
  let contents = contents.trim_start_matches('\u{feff}');
  serde_json::from_str(contents).map_err(|err| format!("Unable to parse profile JSON: {err}"))
}

fn identity_from_value(value: &Value) -> CliProfileIdentity {
  let obj = value.as_object();
  CliProfileIdentity {
    app: obj
      .and_then(|o| o.get("app"))
      .and_then(Value::as_str)
      .unwrap_or("")
      .to_string(),
    kind: obj
      .and_then(|o| o.get("kind"))
      .and_then(Value::as_str)
      .unwrap_or("")
      .to_string(),
    version: obj
      .and_then(|o| o.get("version"))
      .and_then(Value::as_i64)
      .unwrap_or(0),
    exported_at: obj
      .and_then(|o| o.get("exportedAt"))
      .and_then(Value::as_str)
      .map(str::to_string),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn validate_accepts_current_profile_shape() {
    let path =
      std::env::temp_dir().join(format!("plvs-profile-validate-{}.json", std::process::id()));
    fs::write(
      &path,
      serde_json::to_string(&json!({
        "app": "PLVS",
        "kind": "configuration-profile",
        "version": 1,
        "exportedAt": "2026-07-18T00:00:00Z",
        "settings": {},
        "workspace": {},
        "presets": { "list": [], "activeId": null },
        "themes": { "themes": {}, "order": [] },
        "windowBounds": null,
        "captureDeviceId": "default",
        "clearShortcut": "CmdOrCtrl+K",
        "clearGlobal": false
      }))
      .unwrap(),
    )
    .unwrap();

    let report = run_profile_validate(path.to_str().unwrap());
    let _ = fs::remove_file(&path);

    assert_eq!(report.status, CliProfileStatus::Ok);
    assert_eq!(report.profile.as_ref().map(|p| p.version), Some(1));
  }

  #[test]
  fn validate_rejects_foreign_profiles() {
    let path =
      std::env::temp_dir().join(format!("plvs-profile-reject-{}.json", std::process::id()));
    fs::write(
      &path,
      r#"{"app":"Other","kind":"configuration-profile","version":1}"#,
    )
    .unwrap();
    let report = run_profile_validate(path.to_str().unwrap());
    let _ = fs::remove_file(&path);
    assert_eq!(report.status, CliProfileStatus::Error);
  }
}
