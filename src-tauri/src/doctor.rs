use std::{
  env, fs,
  path::{Path, PathBuf},
  process::Command,
};

use serde::Serialize;
use serde_json::{json, Value};

use crate::audio::device_enum::{capture_backend_name, list_devices_for_cli};
use crate::sidecar::locate_sidecar;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const APP_ID: &str = "com.soundoer.plvs";
const DOCTOR_WRITE_TEST_FILE: &str = ".plvs-doctor-write-test";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DoctorStatus {
  Ok,
  Warning,
  Error,
  Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorSummary {
  pub ok: u32,
  pub warning: u32,
  pub error: u32,
  pub skipped: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorAppInfo {
  pub name: String,
  pub version: String,
  pub executable_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorPlatformInfo {
  pub os: String,
  pub arch: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorPaths {
  pub config_dir: Option<String>,
  pub data_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
  pub id: String,
  pub status: DoctorStatus,
  pub severity: DoctorStatus,
  pub title: String,
  pub details: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
  pub schema_version: u32,
  pub status: DoctorStatus,
  pub summary: DoctorSummary,
  pub app: DoctorAppInfo,
  pub platform: DoctorPlatformInfo,
  pub paths: DoctorPaths,
  pub checks: Vec<DoctorCheck>,
}

pub fn run_doctor() -> DoctorReport {
  let app = collect_app_info();
  let platform = collect_platform_info();
  let paths = resolve_runtime_paths();

  let mut checks = vec![
    info_check(
      "app-info",
      "Application information was collected",
      json!({
        "name": app.name,
        "version": app.version,
        "executablePath": app.executable_path,
      }),
    ),
    info_check(
      "platform-info",
      "Platform information was collected",
      json!({
        "os": platform.os,
        "arch": platform.arch,
      }),
    ),
  ];

  checks.push(check_optional_writable_dir(
    "config-directory-writable",
    "Configuration directory is writable",
    "Configuration directory is not writable",
    paths.config_dir.as_deref(),
  ));
  checks.push(check_optional_writable_dir(
    "data-directory-writable",
    "Data directory is writable",
    "Data directory is not writable",
    paths.data_dir.as_deref(),
  ));
  checks.push(check_sidecar("ffmpeg"));
  checks.push(check_sidecar("ffprobe"));
  checks.push(check_capabilities());
  checks.push(check_device_enumeration());
  checks.push(check_dialogue_vad_engines());
  checks.push(check_cli_host_layout());

  let (status, summary) = aggregate_status(&checks);
  DoctorReport {
    schema_version: 1,
    status,
    summary,
    app,
    platform,
    paths,
    checks,
  }
}

pub fn aggregate_status(checks: &[DoctorCheck]) -> (DoctorStatus, DoctorSummary) {
  let mut summary = DoctorSummary {
    ok: 0,
    warning: 0,
    error: 0,
    skipped: 0,
  };

  for check in checks {
    match check.status {
      DoctorStatus::Ok => summary.ok += 1,
      DoctorStatus::Warning => summary.warning += 1,
      DoctorStatus::Error => summary.error += 1,
      DoctorStatus::Skipped => summary.skipped += 1,
    }
  }

  let status = if summary.error > 0 {
    DoctorStatus::Error
  } else if summary.warning > 0 {
    DoctorStatus::Warning
  } else {
    DoctorStatus::Ok
  };
  (status, summary)
}

fn collect_app_info() -> DoctorAppInfo {
  DoctorAppInfo {
    name: "PLVS".to_string(),
    version: env!("CARGO_PKG_VERSION").to_string(),
    executable_path: env::current_exe().ok().map(path_to_string),
  }
}

fn collect_platform_info() -> DoctorPlatformInfo {
  DoctorPlatformInfo {
    os: env::consts::OS.to_string(),
    arch: env::consts::ARCH.to_string(),
  }
}

fn resolve_runtime_paths() -> DoctorPaths {
  DoctorPaths {
    config_dir: resolve_config_dir().map(path_to_string),
    data_dir: resolve_data_dir().map(path_to_string),
  }
}

#[cfg(windows)]
fn resolve_config_dir() -> Option<PathBuf> {
  env::var_os("APPDATA").map(|base| PathBuf::from(base).join(APP_ID))
}

#[cfg(windows)]
fn resolve_data_dir() -> Option<PathBuf> {
  env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join(APP_ID))
}

#[cfg(target_os = "macos")]
fn resolve_config_dir() -> Option<PathBuf> {
  env::var_os("HOME").map(|base| {
    PathBuf::from(base)
      .join("Library")
      .join("Application Support")
      .join(APP_ID)
  })
}

#[cfg(target_os = "macos")]
fn resolve_data_dir() -> Option<PathBuf> {
  env::var_os("HOME").map(|base| {
    PathBuf::from(base)
      .join("Library")
      .join("Logs")
      .join(APP_ID)
  })
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn resolve_config_dir() -> Option<PathBuf> {
  env::var_os("XDG_CONFIG_HOME")
    .map(PathBuf::from)
    .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    .map(|base| base.join(APP_ID))
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn resolve_data_dir() -> Option<PathBuf> {
  env::var_os("XDG_DATA_HOME")
    .map(PathBuf::from)
    .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share")))
    .map(|base| base.join(APP_ID))
}

fn info_check(id: &str, title: &str, details: Value) -> DoctorCheck {
  DoctorCheck {
    id: id.to_string(),
    status: DoctorStatus::Ok,
    severity: DoctorStatus::Ok,
    title: title.to_string(),
    details,
  }
}

fn check_optional_writable_dir(
  id: &str,
  ok_title: &str,
  error_title: &str,
  path: Option<&str>,
) -> DoctorCheck {
  let Some(path) = path else {
    return DoctorCheck {
      id: id.to_string(),
      status: DoctorStatus::Error,
      severity: DoctorStatus::Error,
      title: error_title.to_string(),
      details: json!({
        "path": Value::Null,
        "exists": false,
        "writable": false,
        "error": "runtime directory could not be resolved",
      }),
    };
  };
  check_writable_dir(id, ok_title, error_title, Path::new(path))
}

fn check_writable_dir(id: &str, ok_title: &str, error_title: &str, path: &Path) -> DoctorCheck {
  let path_text = path_to_string(path.to_path_buf());
  let result = fs::create_dir_all(path).and_then(|_| {
    let test_file = path.join(DOCTOR_WRITE_TEST_FILE);
    fs::write(&test_file, b"plvs doctor write test")?;
    fs::remove_file(test_file)
  });

  match result {
    Ok(()) => DoctorCheck {
      id: id.to_string(),
      status: DoctorStatus::Ok,
      severity: DoctorStatus::Error,
      title: ok_title.to_string(),
      details: json!({
        "path": path_text,
        "exists": path.exists(),
        "writable": true,
      }),
    },
    Err(err) => DoctorCheck {
      id: id.to_string(),
      status: DoctorStatus::Error,
      severity: DoctorStatus::Error,
      title: error_title.to_string(),
      details: json!({
        "path": path_text,
        "exists": path.exists(),
        "writable": false,
        "error": err.to_string(),
      }),
    },
  }
}

fn check_sidecar(stem: &str) -> DoctorCheck {
  let path = locate_sidecar(stem);
  check_sidecar_at(stem, path)
}

fn check_sidecar_at(stem: &str, path: PathBuf) -> DoctorCheck {
  let path_text = path_to_string(path.clone());
  let exists = path.exists();

  let mut runnable = false;
  let mut version_line: Option<String> = None;
  let mut error: Option<String> = None;

  if exists {
    let mut command = Command::new(&path);
    command.arg("-version");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    match command.output() {
      Ok(output) if output.status.success() => {
        runnable = true;
        version_line = String::from_utf8_lossy(&output.stdout)
          .lines()
          .next()
          .map(|line| line.trim().to_string())
          .filter(|line| !line.is_empty());
      }
      Ok(output) => {
        error = Some(format!("sidecar exited with status {}", output.status));
      }
      Err(err) => {
        error = Some(err.to_string());
      }
    }
  } else {
    error = Some("sidecar file does not exist".to_string());
  }

  let ok = exists && runnable;
  DoctorCheck {
    id: format!("{stem}-sidecar"),
    status: if ok {
      DoctorStatus::Ok
    } else {
      DoctorStatus::Warning
    },
    severity: DoctorStatus::Warning,
    title: if ok {
      format!("{stem} sidecar is available")
    } else {
      format!("{stem} sidecar is unavailable")
    },
    details: json!({
      "path": path_text,
      "exists": exists,
      "runnable": runnable,
      "version": version_line,
      "fileAnalysisAvailable": ok,
      "error": error,
    }),
  }
}

fn path_to_string(path: PathBuf) -> String {
  path.to_string_lossy().to_string()
}

fn check_capabilities() -> DoctorCheck {
  info_check(
    "capabilities",
    "CLI capabilities for this build",
    json!({
      "commands": [
        "doctor",
        "probe",
        "analyze",
        "analyze-batch",
        "capture",
        "devices",
        "report"
      ],
      "fileAnalysis": true,
      "liveCapture": true,
      "deviceListing": true,
      "dialogueVadEngines": ["silero", "firered", "ten"],
      "captureDeviceSelectors": ["default", "stableId", "substring"],
      "captureBackend": capture_backend_name(),
    }),
  )
}

fn check_device_enumeration() -> DoctorCheck {
  match list_devices_for_cli() {
    Ok(devices) if devices.is_empty() => DoctorCheck {
      id: "device-enumeration".to_string(),
      status: DoctorStatus::Skipped,
      severity: DoctorStatus::Warning,
      title: "No audio devices were enumerated".to_string(),
      details: json!({
        "backend": capture_backend_name(),
        "count": 0,
        "reason": "empty device list; common on headless CI hosts without a sound card",
      }),
    },
    Ok(devices) => DoctorCheck {
      id: "device-enumeration".to_string(),
      status: DoctorStatus::Ok,
      severity: DoctorStatus::Warning,
      title: "Audio devices were enumerated".to_string(),
      details: json!({
        "backend": capture_backend_name(),
        "count": devices.len(),
        "devices": devices.iter().map(|device| json!({
          "id": device.id,
          "label": device.label,
          "kind": if device.is_system_output_monitor { "systemOutput" } else { "input" },
        })).collect::<Vec<_>>(),
      }),
    },
    Err(error) => DoctorCheck {
      id: "device-enumeration".to_string(),
      status: DoctorStatus::Skipped,
      severity: DoctorStatus::Warning,
      title: "Audio device enumeration was skipped".to_string(),
      details: json!({
        "backend": capture_backend_name(),
        "count": 0,
        "reason": error,
      }),
    },
  }
}

fn check_dialogue_vad_engines() -> DoctorCheck {
  info_check(
    "dialogue-vad-engines",
    "Dialogue VAD engines are bundled in this binary",
    json!({
      "engines": [
        {"id": "silero", "bundled": true},
        {"id": "firered", "bundled": true},
        {"id": "ten", "bundled": true}
      ],
      "note": "Models are linked into PLVS; they are not separate sidecar files."
    }),
  )
}

fn check_cli_host_layout() -> DoctorCheck {
  let host = env::current_exe().ok();
  let dir = host
    .as_ref()
    .and_then(|path| path.parent().map(Path::to_path_buf));
  let cli_name = if cfg!(windows) {
    "plvs-cli.exe"
  } else {
    "plvs-cli"
  };
  let host_name = if cfg!(windows) { "plvs.exe" } else { "plvs" };
  let cli_path = dir.as_ref().map(|path| path.join(cli_name));
  let sibling_host = dir.as_ref().map(|path| path.join(host_name));
  let cli_present = cli_path.as_ref().is_some_and(|path| path.is_file());
  let host_present = host.as_ref().is_some_and(|path| path.is_file())
    || sibling_host.as_ref().is_some_and(|path| path.is_file());

  DoctorCheck {
    id: "cli-host-layout".to_string(),
    status: if host_present {
      DoctorStatus::Ok
    } else {
      DoctorStatus::Warning
    },
    severity: DoctorStatus::Warning,
    title: if host_present {
      "CLI host binary layout looks usable".to_string()
    } else {
      "CLI host binary could not be confirmed".to_string()
    },
    details: json!({
      "hostExecutable": host.as_ref().map(|path| path_to_string(path.clone())),
      "cliExecutable": cli_path.as_ref().map(|path| path_to_string(path.clone())),
      "cliPresentBesideHost": cli_present,
      "note": "Installed builds place plvs-cli next to plvs. Dev cargo runs may omit the companion binary."
    }),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::{SystemTime, UNIX_EPOCH};

  fn check(status: DoctorStatus) -> DoctorCheck {
    DoctorCheck {
      id: "test".to_string(),
      status,
      severity: status,
      title: "Test".to_string(),
      details: json!({}),
    }
  }

  #[test]
  fn aggregation_reports_ok_when_all_checks_are_ok() {
    let (status, summary) = aggregate_status(&[check(DoctorStatus::Ok)]);
    assert_eq!(status, DoctorStatus::Ok);
    assert_eq!(summary.ok, 1);
    assert_eq!(summary.warning, 0);
    assert_eq!(summary.error, 0);
    assert_eq!(summary.skipped, 0);
  }

  #[test]
  fn aggregation_reports_warning_without_errors() {
    let (status, summary) =
      aggregate_status(&[check(DoctorStatus::Ok), check(DoctorStatus::Warning)]);
    assert_eq!(status, DoctorStatus::Warning);
    assert_eq!(summary.ok, 1);
    assert_eq!(summary.warning, 1);
  }

  #[test]
  fn aggregation_reports_error_when_any_check_errors() {
    let (status, summary) = aggregate_status(&[
      check(DoctorStatus::Ok),
      check(DoctorStatus::Warning),
      check(DoctorStatus::Error),
    ]);
    assert_eq!(status, DoctorStatus::Error);
    assert_eq!(summary.error, 1);
  }

  #[test]
  fn aggregation_counts_skipped_without_affecting_status() {
    let (status, summary) =
      aggregate_status(&[check(DoctorStatus::Ok), check(DoctorStatus::Skipped)]);
    assert_eq!(status, DoctorStatus::Ok);
    assert_eq!(summary.ok, 1);
    assert_eq!(summary.skipped, 1);
  }

  #[test]
  fn writable_dir_check_creates_and_removes_probe_file() {
    let dir = env::temp_dir().join(format!(
      "plvs-doctor-test-{}",
      SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    let result = check_writable_dir("test-dir", "OK", "Error", &dir);
    assert_eq!(result.status, DoctorStatus::Ok);
    assert!(dir.exists());
    assert!(!dir.join(DOCTOR_WRITE_TEST_FILE).exists());
    fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn writable_dir_check_reports_error_when_path_is_file() {
    let dir = env::temp_dir().join(format!(
      "plvs-doctor-test-{}",
      SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    let file_path = dir.join("not-a-directory");
    fs::write(&file_path, b"plvs doctor").unwrap();

    let result = check_writable_dir("test-dir", "OK", "Error", &file_path);

    assert_eq!(result.status, DoctorStatus::Error);
    assert_eq!(result.severity, DoctorStatus::Error);
    assert_eq!(result.details["exists"], true);
    assert_eq!(result.details["writable"], false);

    fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn sidecar_check_reports_warning_for_missing_sidecar_path() {
    let dir = env::temp_dir().join(format!(
      "plvs-doctor-test-{}",
      SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    let sidecar_path = dir.join(crate::sidecar::sidecar_binary_name("ffmpeg"));

    let result = check_sidecar_at("ffmpeg", sidecar_path.clone());

    assert_eq!(result.id, "ffmpeg-sidecar");
    assert_eq!(result.status, DoctorStatus::Warning);
    assert_eq!(result.severity, DoctorStatus::Warning);
    assert_eq!(result.details["path"], path_to_string(sidecar_path));
    assert_eq!(result.details["exists"], false);
    assert_eq!(result.details["runnable"], false);
    assert_eq!(result.details["fileAnalysisAvailable"], false);

    fs::remove_dir_all(dir).unwrap();
  }
}
