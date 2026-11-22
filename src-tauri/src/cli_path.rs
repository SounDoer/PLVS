use serde::Serialize;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::ffi::OsStr;
#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
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

#[cfg(target_os = "linux")]
fn platform_status() -> Result<CliPathStatus, String> {
  let install_dir = current_install_dir()?;
  Ok(unix_status_for_install_dir(
    &install_dir,
    std::env::var_os("PATH").as_deref(),
  ))
}

#[cfg(target_os = "macos")]
fn platform_status() -> Result<CliPathStatus, String> {
  let install_dir = current_install_dir()?;
  let status = unix_status_for_install_dir(&install_dir, std::env::var_os("PATH").as_deref());
  Ok(match macos_link::plan_for(&status) {
    Some(plan) => macos_link::status_with_link(status, &plan),
    None => status,
  })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn unix_status_for_install_dir(install_dir: &Path, path: Option<&OsStr>) -> CliPathStatus {
  use std::os::unix::fs::PermissionsExt;

  let cli_path = install_dir.join(env!("PLVS_CLI_BINARY"));
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
      "An executable plvs-cli was not found next to this application.".into()
    } else if on_path {
      "Available from the current process PATH.".into()
    } else {
      "Use the bundled plvs-cli by its full path.".into()
    },
  }
}

#[cfg(target_os = "linux")]
fn platform_set_enabled(_enabled: bool) -> Result<CliPathStatus, String> {
  platform_status()
}

/// Agent Control on macOS links the bundled CLI into `/usr/local/bin`, which is on the default
/// shell `PATH`, as Windows adds the install folder to the user `PATH`. A link failure, including
/// a declined administrator prompt, never fails the toggle: the CLI stays usable by full path.
#[cfg(target_os = "macos")]
fn platform_set_enabled(enabled: bool) -> Result<CliPathStatus, String> {
  let install_dir = current_install_dir()?;
  let status = unix_status_for_install_dir(&install_dir, std::env::var_os("PATH").as_deref());
  if let Some(plan) = macos_link::plan_for(&status) {
    let result = if enabled {
      macos_link::install(&plan, &macos_link::AdministratorPrompt)
    } else {
      macos_link::remove(&plan, &macos_link::AdministratorPrompt)
    };
    if let Err(error) = result {
      log::warn!(
        "plvs-cli PATH link was not {}: {error}",
        if enabled { "created" } else { "removed" }
      );
    }
  }
  platform_status()
}

#[cfg(target_os = "macos")]
mod macos_link {
  use super::CliPathStatus;
  use std::io::ErrorKind;
  use std::path::{Path, PathBuf};

  pub(super) const LINK_DIR: &str = "/usr/local/bin";

  pub(super) struct LinkPlan {
    pub(super) cli: PathBuf,
    pub(super) link: PathBuf,
  }

  /// The command name each identity installs. The dev identity is reached through
  /// `npm run desktop:control`, and tests must never touch the real directory.
  fn link_name() -> Option<&'static str> {
    if cfg!(test) || cfg!(feature = "dev-identity") {
      None
    } else if cfg!(feature = "preview-identity") {
      Some("plvs-preview-cli")
    } else {
      Some("plvs-cli")
    }
  }

  pub(super) fn plan_for(status: &CliPathStatus) -> Option<LinkPlan> {
    if !status.installed {
      return None;
    }
    Some(LinkPlan {
      cli: PathBuf::from(status.cli_path.as_ref()?),
      link: Path::new(LINK_DIR).join(link_name()?),
    })
  }

  #[derive(Debug, PartialEq, Eq)]
  pub(super) enum LinkState {
    Absent,
    /// A symbolic link to this installation's CLI.
    Ours,
    /// Anything else at that path: another installation, a moved app, or a user's own file.
    Foreign,
  }

  pub(super) fn link_state(plan: &LinkPlan) -> LinkState {
    match std::fs::symlink_metadata(&plan.link) {
      Err(error) if error.kind() == ErrorKind::NotFound => LinkState::Absent,
      Ok(metadata) if metadata.file_type().is_symlink() => match std::fs::read_link(&plan.link) {
        Ok(target) if target == plan.cli => LinkState::Ours,
        _ => LinkState::Foreign,
      },
      _ => LinkState::Foreign,
    }
  }

  pub(super) fn status_with_link(mut status: CliPathStatus, plan: &LinkPlan) -> CliPathStatus {
    let name = plan
      .link
      .file_name()
      .and_then(|name| name.to_str())
      .unwrap_or("plvs-cli");
    match link_state(plan) {
      LinkState::Ours => {
        status.on_path = true;
        status.message = format!("Available as {name} from {}.", plan.link.display());
      }
      LinkState::Foreign if !status.on_path => {
        status.message = format!(
          "{} belongs to another installation. Use the bundled plvs-cli by its full path.",
          plan.link.display()
        );
      }
      _ => {}
    }
    status
  }

  /// Runs one shell command as an administrator. Separate so tests never show a real prompt.
  pub(super) trait Privileged {
    fn run(&self, script: &str, args: &[&Path]) -> Result<(), String>;
  }

  /// The standard macOS administrator prompt, through AppleScript. Paths travel as arguments and
  /// reach the shell through `quoted form of`, never spliced into the script text.
  pub(super) struct AdministratorPrompt;

  impl Privileged for AdministratorPrompt {
    fn run(&self, script: &str, args: &[&Path]) -> Result<(), String> {
      let output = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", "on run argv", "-e", script, "-e", "end run"])
        .args(args)
        .output()
        .map_err(|error| format!("start osascript: {error}"))?;
      if output.status.success() {
        Ok(())
      } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
      }
    }
  }

  const LINK_SCRIPT: &str = "do shell script \"/bin/mkdir -p \" & quoted form of (item 1 of argv) & \" && /bin/ln -s \" & quoted form of (item 2 of argv) & \" \" & quoted form of (item 3 of argv) with administrator privileges";
  const UNLINK_SCRIPT: &str =
    "do shell script \"/bin/rm \" & quoted form of (item 1 of argv) with administrator privileges";

  pub(super) fn install(plan: &LinkPlan, privileged: &dyn Privileged) -> Result<(), String> {
    if link_state(plan) != LinkState::Absent {
      return Ok(());
    }
    let directory = plan.link.parent().unwrap_or(Path::new(LINK_DIR));
    let direct = std::fs::create_dir_all(directory)
      .and_then(|()| std::os::unix::fs::symlink(&plan.cli, &plan.link));
    match direct {
      Ok(()) => Ok(()),
      Err(error) if error.kind() == ErrorKind::PermissionDenied => {
        privileged.run(LINK_SCRIPT, &[directory, &plan.cli, &plan.link])
      }
      Err(error) => Err(error.to_string()),
    }
  }

  pub(super) fn remove(plan: &LinkPlan, privileged: &dyn Privileged) -> Result<(), String> {
    if link_state(plan) != LinkState::Ours {
      return Ok(());
    }
    match std::fs::remove_file(&plan.link) {
      Ok(()) => Ok(()),
      Err(error) if error.kind() == ErrorKind::PermissionDenied => {
        privileged.run(UNLINK_SCRIPT, &[&plan.link])
      }
      Err(error) => Err(error.to_string()),
    }
  }

  #[cfg(test)]
  mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Recorder {
      calls: RefCell<Vec<String>>,
      result: Result<(), String>,
    }

    impl Privileged for Recorder {
      fn run(&self, script: &str, args: &[&Path]) -> Result<(), String> {
        self.calls.borrow_mut().push(format!(
          "{} {:?}",
          if script.contains("/bin/rm") {
            "unlink"
          } else {
            "link"
          },
          args
        ));
        self.result.clone()
      }
    }

    fn recorder(result: Result<(), String>) -> Recorder {
      Recorder {
        calls: RefCell::new(Vec::new()),
        result,
      }
    }

    fn plan_in(directory: &Path) -> LinkPlan {
      let cli = directory.join("PLVS Preview.app/Contents/MacOS/plvs-cli");
      std::fs::create_dir_all(cli.parent().unwrap()).unwrap();
      std::fs::write(&cli, b"cli").unwrap();
      LinkPlan {
        cli,
        link: directory.join("bin/plvs-cli"),
      }
    }

    #[test]
    fn links_and_unlinks_only_its_own_cli() {
      let directory = tempfile::tempdir().unwrap();
      let plan = plan_in(directory.path());
      let prompt = recorder(Ok(()));
      assert_eq!(link_state(&plan), LinkState::Absent);

      install(&plan, &prompt).unwrap();
      assert_eq!(link_state(&plan), LinkState::Ours);
      install(&plan, &prompt).unwrap();
      remove(&plan, &prompt).unwrap();
      assert_eq!(link_state(&plan), LinkState::Absent);
      assert!(
        prompt.calls.borrow().is_empty(),
        "a writable directory needs no prompt"
      );
    }

    #[test]
    fn leaves_another_installation_in_place() {
      let directory = tempfile::tempdir().unwrap();
      let plan = plan_in(directory.path());
      std::fs::create_dir_all(plan.link.parent().unwrap()).unwrap();
      std::os::unix::fs::symlink("/Applications/Other.app/plvs-cli", &plan.link).unwrap();
      let prompt = recorder(Ok(()));

      assert_eq!(link_state(&plan), LinkState::Foreign);
      install(&plan, &prompt).unwrap();
      remove(&plan, &prompt).unwrap();
      assert_eq!(
        std::fs::read_link(&plan.link).unwrap(),
        PathBuf::from("/Applications/Other.app/plvs-cli")
      );
      assert!(prompt.calls.borrow().is_empty());
    }

    #[test]
    fn asks_for_administrator_rights_only_when_the_directory_refuses() {
      use std::os::unix::fs::PermissionsExt;
      let directory = tempfile::tempdir().unwrap();
      let plan = plan_in(directory.path());
      let bin = plan.link.parent().unwrap();
      std::fs::create_dir_all(bin).unwrap();
      std::fs::set_permissions(bin, std::fs::Permissions::from_mode(0o555)).unwrap();
      let declined = recorder(Err("User canceled. (-128)".into()));

      assert_eq!(
        install(&plan, &declined),
        Err("User canceled. (-128)".into())
      );
      assert_eq!(declined.calls.borrow().len(), 1);
      assert!(declined.calls.borrow()[0].starts_with("link"));
      assert!(declined.calls.borrow()[0].contains("PLVS Preview.app"));
      std::fs::set_permissions(bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn reports_the_link_as_the_way_onto_path() {
      let directory = tempfile::tempdir().unwrap();
      let plan = plan_in(directory.path());
      let base = || CliPathStatus {
        supported: true,
        install_dir: None,
        cli_path: Some(plan.cli.display().to_string()),
        installed: true,
        on_path: false,
        message: "Use the bundled plvs-cli by its full path.".into(),
      };
      assert!(!status_with_link(base(), &plan).on_path);
      install(&plan, &recorder(Ok(()))).unwrap();
      let linked = status_with_link(base(), &plan);
      assert!(linked.on_path);
      assert!(linked.message.starts_with("Available as plvs-cli from "));
    }
  }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn same_path(candidate: &Path, expected: &Path) -> bool {
  match (candidate.canonicalize(), expected.canonicalize()) {
    (Ok(candidate), Ok(expected)) => candidate == expected,
    _ => candidate == expected,
  }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
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

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn platform_set_enabled(_enabled: bool) -> Result<CliPathStatus, String> {
  platform_status()
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
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
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod unix_tests {
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

    let missing_execute = unix_status_for_install_dir(&directory, None);
    assert!(!missing_execute.installed);
    assert!(!missing_execute.on_path);

    fs::set_permissions(&cli_path, fs::Permissions::from_mode(0o700)).unwrap();
    let path = std::env::join_paths([PathBuf::from("/usr/bin"), directory.clone()]).unwrap();
    let installed = unix_status_for_install_dir(&directory, Some(&path));
    assert!(installed.installed);
    assert!(installed.on_path);

    fs::remove_dir_all(directory).unwrap();
  }
}
