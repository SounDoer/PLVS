use serde::Serialize;
#[cfg(target_os = "macos")]
use std::ffi::OsStr;
#[cfg(any(windows, target_os = "macos"))]
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPathStatus {
  pub(crate) supported: bool,
  pub(crate) install_dir: Option<String>,
  pub(crate) cli_path: Option<String>,
  pub(crate) installed: bool,
  pub(crate) on_path: bool,
  pub(crate) message: String,
}

#[tauri::command]
pub fn cli_path_status() -> Result<CliPathStatus, String> {
  platform_status()
}

#[tauri::command]
pub fn set_cli_path_enabled(enabled: bool) -> Result<CliPathStatus, String> {
  platform_set_enabled(enabled)
}

#[cfg(windows)]
fn platform_status() -> Result<CliPathStatus, String> {
  let install_dir = current_install_dir()?;
  let cli_path = install_dir.join("plvs-cli.exe");
  let user_path = read_user_path()?;
  let on_path = path_contains_dir(&user_path, &install_dir);
  let installed = cli_path.is_file();
  Ok(CliPathStatus {
    supported: true,
    install_dir: Some(install_dir.display().to_string()),
    cli_path: Some(cli_path.display().to_string()),
    installed,
    on_path,
    message: if !installed {
      "plvs-cli.exe was not found in this installation.".into()
    } else if on_path {
      "Available in new terminals.".into()
    } else {
      "Add PLVS to user PATH to call plvs-cli from new terminals.".into()
    },
  })
}

#[cfg(windows)]
fn platform_set_enabled(enabled: bool) -> Result<CliPathStatus, String> {
  let install_dir = current_install_dir()?;
  let user_path = read_user_path()?;
  let mut parts: Vec<String> = split_path(&user_path)
    .into_iter()
    .filter(|part| !same_path_text(part, &install_dir))
    .collect();

  if enabled {
    parts.push(install_dir.display().to_string());
  }

  write_user_path(&parts.join(";"))?;
  platform_status()
}

#[cfg(target_os = "macos")]
fn platform_status() -> Result<CliPathStatus, String> {
  let install_dir = current_install_dir()?;
  Ok(macos_status_for_install_dir(
    &install_dir,
    std::env::var_os("PATH").as_deref(),
  ))
}

#[cfg(target_os = "macos")]
fn macos_status_for_install_dir(install_dir: &Path, path: Option<&OsStr>) -> CliPathStatus {
  use std::os::unix::fs::PermissionsExt;

  let cli_path = install_dir.join("plvs-cli");
  let installed = cli_path
    .metadata()
    .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
    .unwrap_or(false);
  let on_path = path
    .map(|path| std::env::split_paths(path).any(|entry| same_path(&entry, install_dir)))
    .unwrap_or(false);
  CliPathStatus {
    supported: true,
    install_dir: Some(install_dir.display().to_string()),
    cli_path: Some(cli_path.display().to_string()),
    installed,
    on_path,
    message: if !installed {
      "plvs-cli was not found in this application bundle.".into()
    } else if on_path {
      "Available from the current process PATH.".into()
    } else {
      "Use the bundled plvs-cli by its full application path.".into()
    },
  }
}

#[cfg(target_os = "macos")]
fn platform_set_enabled(_enabled: bool) -> Result<CliPathStatus, String> {
  platform_status()
}

#[cfg(target_os = "macos")]
fn same_path(candidate: &Path, expected: &Path) -> bool {
  match (candidate.canonicalize(), expected.canonicalize()) {
    (Ok(candidate), Ok(expected)) => candidate == expected,
    _ => candidate == expected,
  }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn platform_status() -> Result<CliPathStatus, String> {
  Ok(CliPathStatus {
    supported: false,
    install_dir: None,
    cli_path: None,
    installed: false,
    on_path: false,
    message: "PATH setup is currently available on Windows only.".into(),
  })
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn platform_set_enabled(_enabled: bool) -> Result<CliPathStatus, String> {
  platform_status()
}

#[cfg(any(windows, target_os = "macos"))]
fn current_install_dir() -> Result<PathBuf, String> {
  std::env::current_exe()
    .map_err(|e| format!("read current executable path: {e}"))?
    .parent()
    .map(Path::to_path_buf)
    .ok_or_else(|| "read current executable directory".to_string())
}

#[cfg(windows)]
fn split_path(path: &str) -> Vec<String> {
  path
    .split(';')
    .map(str::trim)
    .filter(|part| !part.is_empty())
    .map(str::to_string)
    .collect()
}

#[cfg(windows)]
fn path_contains_dir(path: &str, dir: &Path) -> bool {
  split_path(path)
    .iter()
    .any(|part| same_path_text(part, dir))
}

#[cfg(windows)]
fn same_path_text(candidate: &str, dir: &Path) -> bool {
  normalize_path_text(candidate) == normalize_path_text(&dir.display().to_string())
}

#[cfg(windows)]
fn normalize_path_text(path: &str) -> String {
  path
    .trim_matches('"')
    .trim_end_matches(['\\', '/'])
    .replace('/', "\\")
    .to_ascii_lowercase()
}

#[cfg(windows)]
fn read_user_path() -> Result<String, String> {
  use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
  use winreg::RegKey;

  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let env = hkcu
    .open_subkey_with_flags("Environment", KEY_READ)
    .map_err(|e| format!("open user environment: {e}"))?;
  match env.get_value::<String, _>("Path") {
    Ok(path) => Ok(path),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
    Err(e) => Err(format!("read user PATH: {e}")),
  }
}

#[cfg(windows)]
fn write_user_path(path: &str) -> Result<(), String> {
  use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_EXPAND_SZ, REG_SZ};
  use winreg::{RegKey, RegValue};

  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let env = hkcu
    .open_subkey_with_flags("Environment", KEY_READ | KEY_SET_VALUE)
    .map_err(|e| format!("open user environment: {e}"))?;
  let value_type = env
    .get_raw_value("Path")
    .map(|value| match value.vtype {
      REG_SZ | REG_EXPAND_SZ => value.vtype,
      _ => REG_EXPAND_SZ,
    })
    .unwrap_or(REG_EXPAND_SZ);
  let mut bytes = Vec::new();
  for unit in path.encode_utf16().chain(std::iter::once(0)) {
    bytes.extend(unit.to_le_bytes());
  }
  env
    .set_raw_value(
      "Path",
      &RegValue {
        vtype: value_type,
        bytes: bytes.into(),
      },
    )
    .map_err(|e| format!("write user PATH: {e}"))
}

#[cfg(test)]
#[cfg(windows)]
mod tests {
  use super::*;

  #[test]
  fn detects_path_entries_case_insensitively() {
    let dir = PathBuf::from(r"C:\Users\me\AppData\Local\PLVS");
    assert!(path_contains_dir(
      r"C:\Windows;C:\USERS\me\AppData\Local\PLVS\",
      &dir
    ));
  }

  #[test]
  fn ignores_similar_prefixes() {
    let dir = PathBuf::from(r"C:\Users\me\AppData\Local\PLVS");
    assert!(!path_contains_dir(
      r"C:\Windows;C:\Users\me\AppData\Local\PLVS Tools",
      &dir
    ));
  }
}

#[cfg(test)]
#[cfg(target_os = "macos")]
mod macos_tests {
  use super::*;
  use std::fs;
  use std::os::unix::fs::PermissionsExt;

  #[test]
  fn reports_the_adjacent_unix_cli_without_mutating_path() {
    let status = platform_status().unwrap();
    assert!(status.supported);
    assert!(status.cli_path.as_deref().unwrap().ends_with("/plvs-cli"));

    let refreshed = platform_set_enabled(true).unwrap();
    assert_eq!(refreshed.cli_path, status.cli_path);
    assert_eq!(refreshed.on_path, status.on_path);
  }

  #[test]
  fn requires_an_executable_cli_and_observes_paths_with_spaces() {
    let directory = std::env::temp_dir().join(format!("plvs cli path test {}", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    let cli_path = directory.join("plvs-cli");
    fs::write(&cli_path, b"test").unwrap();
    fs::set_permissions(&cli_path, fs::Permissions::from_mode(0o600)).unwrap();

    let missing_execute = macos_status_for_install_dir(&directory, None);
    assert!(!missing_execute.installed);
    assert!(!missing_execute.on_path);

    fs::set_permissions(&cli_path, fs::Permissions::from_mode(0o700)).unwrap();
    let path = std::env::join_paths([PathBuf::from("/usr/bin"), directory.clone()]).unwrap();
    let installed = macos_status_for_install_dir(&directory, Some(&path));
    assert!(installed.installed);
    assert!(installed.on_path);

    fs::remove_dir_all(directory).unwrap();
  }
}
