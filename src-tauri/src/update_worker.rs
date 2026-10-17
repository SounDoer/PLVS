//! Confirmed installer handoff. The helper has no webviews and performs no network requests.
use crate::{update_cache::UpdateCache, update_gate::InstallGate};
use serde::{Deserialize, Serialize};
use std::{
  fs,
  io::Write,
  path::{Path, PathBuf},
  process::{Child, Command},
  time::{Duration, Instant},
};

use tauri_plugin_updater::UpdaterExt;

const ACCEPTANCE_INTERRUPTION_MARKER: &str = "acceptance-helper-paused";

#[derive(Clone, Serialize, Deserialize)]
pub struct Ticket {
  pub nonce: String,
  pub package_id: String,
  pub target: PathBuf,
  pub app_data: PathBuf,
  pub args: Vec<String>,
  pub identity: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
  pub version: String,
  pub phase: String,
  pub error: Option<String>,
  pub installer_pid: Option<u32>,
  pub installer_start: Option<u64>,
  /// The helper is recorded before `installing`, so an interruption before the installer starts
  /// still leaves a process whose liveness can be checked.
  #[serde(default)]
  pub helper_pid: Option<u32>,
  #[serde(default)]
  pub helper_start: Option<u64>,
}

pub struct PendingWorker {
  pub ticket: Ticket,
  pub child: Child,
}

/// Restore grants are one-use credentials. An ordinary relaunch restores the saved workbench set
/// and must not replay the grant used to open this particular process.
pub fn relaunch_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
  let mut result = Vec::new();
  let mut args = args.into_iter();
  while let Some(arg) = args.next() {
    if matches!(
      arg.as_str(),
      "--plvs-restore-workspace" | "--plvs-restore-nonce"
    ) {
      args.next();
    } else {
      result.push(arg);
    }
  }
  result
}

pub fn save_attempt(root: &Path, attempt: &Attempt) -> Result<(), String> {
  let mut file = atomic_write_file::AtomicWriteFile::open(root.join("attempt.json"))
    .map_err(|e| e.to_string())?;
  file
    .write_all(&serde_json::to_vec(attempt).map_err(|e| e.to_string())?)
    .map_err(|e| e.to_string())?;
  file.commit().map_err(|e| e.to_string())
}

pub fn read_attempt(root: &Path) -> Result<Option<Attempt>, String> {
  match fs::read(root.join("attempt.json")) {
    Ok(bytes) => serde_json::from_slice(&bytes)
      .map(Some)
      .map_err(|e| e.to_string()),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

fn process_alive(pid: Option<u32>, start: Option<u64>) -> bool {
  pid.zip(start).is_some_and(|(pid, start)| {
    crate::coordinator::registry::process_start_identity(pid) == Some(start)
  })
}

/// A live helper or installer keeps the startup fence. Once neither process remains, the attempt
/// can no longer change files: record it as failed and open the installed version rather than
/// refusing every later launch.
pub fn check_abandoned_attempt(root: &Path) -> Result<(), String> {
  let Some(mut attempt) = read_attempt(root)? else {
    return Ok(());
  };
  if attempt.phase != "installing" {
    return Ok(());
  }
  if process_alive(attempt.installer_pid, attempt.installer_start)
    || process_alive(attempt.helper_pid, attempt.helper_start)
  {
    return Err(
      "An update installer is still running. Wait for it to finish before starting PLVS.".into(),
    );
  }
  if semver::Version::parse(&attempt.version)
    .ok()
    .zip(semver::Version::parse(env!("CARGO_PKG_VERSION")).ok())
    .is_some_and(|(target, current)| current >= target)
  {
    return Ok(());
  }
  attempt.phase = "failed".into();
  attempt.error = Some(
    "The previous installation was interrupted before it finished. If PLVS behaves unexpectedly, reinstall it from the release page.".into(),
  );
  save_attempt(root, &attempt)
}

/// Remove the previous helper copy and handshake files. Only a fresh session may do this: while
/// any workbench runs, a helper may be between spawn and claiming the installation gate.
pub fn remove_helper_files(root: &Path) {
  for name in [
    "plvs-update-worker.exe",
    "plvs-update-worker",
    "worker-ticket.json",
    "worker-ready",
    "worker-commit",
    ACCEPTANCE_INTERRUPTION_MARKER,
  ] {
    let _ = fs::remove_file(root.join(name));
  }
}

#[cfg(debug_assertions)]
fn acceptance_interruption_requested(value: Option<&std::ffi::OsStr>, identity: &str) -> bool {
  identity.starts_with("com.soundoer.plvs.updatetest.h") && value.is_some_and(|value| value == "1")
}

#[cfg(debug_assertions)]
fn pause_for_acceptance_interruption(root: &Path) -> Result<(), String> {
  if !acceptance_interruption_requested(
    std::env::var_os("PLVS_UPDATE_ACCEPTANCE_INTERRUPT_HELPER").as_deref(),
    env!("PLVS_APP_ID"),
  ) {
    return Ok(());
  }
  fs::write(root.join(ACCEPTANCE_INTERRUPTION_MARKER), b"ready").map_err(|e| e.to_string())?;
  let deadline = Instant::now() + Duration::from_secs(120);
  while Instant::now() <= deadline {
    std::thread::sleep(Duration::from_millis(25));
  }
  Err("The acceptance helper interruption was not delivered before its deadline.".into())
}

#[cfg(not(debug_assertions))]
fn pause_for_acceptance_interruption(_root: &Path) -> Result<(), String> {
  Ok(())
}

pub fn spawn(root: &Path, ticket: Ticket) -> Result<PendingWorker, String> {
  let worker_name = if cfg!(windows) {
    "plvs-update-worker.exe"
  } else {
    "plvs-update-worker"
  };
  let worker = root.join(worker_name);
  fs::copy(std::env::current_exe().map_err(|e| e.to_string())?, &worker)
    .map_err(|e| e.to_string())?;
  fs::write(
    root.join("worker-ticket.json"),
    serde_json::to_vec(&ticket).map_err(|e| e.to_string())?,
  )
  .map_err(|e| e.to_string())?;
  let mut command = Command::new(worker);
  command
    .arg("--plvs-update-worker")
    .arg(root.join("worker-ticket.json"));
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
  }
  let mut child = command.spawn().map_err(|e| e.to_string())?;
  let deadline = Instant::now() + Duration::from_secs(20);
  loop {
    if child.try_wait().map_err(|e| e.to_string())?.is_some() {
      return Err("The update helper could not prepare installation.".into());
    }
    if let Ok(ack) = fs::read_to_string(root.join("worker-ready")) {
      if ack == ticket.nonce {
        return Ok(PendingWorker { ticket, child });
      }
    }
    if Instant::now() > deadline {
      // No commit marker has been issued. Stopping this helper cannot interrupt an installer.
      let _ = child.kill();
      let _ = child.wait();
      return Err("The update helper did not become ready.".into());
    }
    std::thread::sleep(Duration::from_millis(25));
  }
}

pub fn abort(worker: &mut PendingWorker) {
  let _ = worker.child.kill();
  let _ = worker.child.wait();
}

pub fn commit(root: &Path, worker: &mut PendingWorker) -> Result<(), String> {
  if worker
    .child
    .try_wait()
    .map_err(|e| e.to_string())?
    .is_some()
  {
    return Err("The update helper exited. Please try again.".into());
  }
  fs::write(root.join("worker-commit"), &worker.ticket.nonce).map_err(|e| e.to_string())
}

pub fn run(ticket_path: &Path) -> Result<(), String> {
  if cfg!(feature = "preview-identity") {
    return Err("Preview has no updater.".into());
  }
  let ticket: Ticket = serde_json::from_slice(&fs::read(ticket_path).map_err(|e| e.to_string())?)
    .map_err(|e| e.to_string())?;
  if ticket.identity != env!("PLVS_APP_ID") {
    return Err("Update identity mismatch.".into());
  }
  let cache = UpdateCache::open(&ticket.app_data, &ticket.target)?;
  let worker = std::env::current_exe()
    .map_err(|e| e.to_string())?
    .canonicalize()
    .map_err(|e| e.to_string())?;
  if worker.parent() != Some(cache.root()) || ticket_path != cache.root().join("worker-ticket.json")
  {
    return Err("The helper is outside the approved installation cache.".into());
  }
  let mut context = crate::app_context();
  context.config_mut().app.windows.clear();
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(move |app| {
      let handle = app.handle().clone();
      std::thread::spawn(move || {
        let outcome = install(&handle, &cache, &ticket);
        if let Err(error) = outcome {
          let previous = read_attempt(cache.root())
            .ok()
            .flatten()
            .unwrap_or_default();
          let _ = save_attempt(
            cache.root(),
            &Attempt {
              phase: "failed".into(),
              error: Some(error),
              ..previous
            },
          );
        }
        handle.exit(0);
      });
      Ok(())
    })
    .build(context)
    .map_err(|e| e.to_string())?;
  app.run(|_, _| {});
  Ok(())
}

fn install(app: &tauri::AppHandle, cache: &UpdateCache, ticket: &Ticket) -> Result<(), String> {
  let gate = InstallGate::claim(cache.root())?;
  let (ready, bytes) = cache.load(&ticket.package_id)?;
  let updater = app
    .updater_builder()
    .executable_path(&ticket.target)
    .restart_after_install(false)
    .build()
    .map_err(|e| e.to_string())?;
  let update = updater
    .from_manifest(ready.manifest)
    .map_err(|e| e.to_string())?
    .ok_or("The staged version is no longer newer.")?;
  update.verify_cached(&bytes).map_err(|e| e.to_string())?;
  if ready.version != update.version {
    return Err("Cached update version metadata is inconsistent.".into());
  }
  fs::write(cache.root().join("worker-ready"), &ticket.nonce).map_err(|e| e.to_string())?;
  let deadline = Instant::now() + Duration::from_secs(120);
  while fs::read_to_string(cache.root().join("worker-commit"))
    .ok()
    .as_deref()
    != Some(&ticket.nonce)
  {
    if Instant::now() > deadline {
      return Err("Installation confirmation expired.".into());
    }
    std::thread::sleep(Duration::from_millis(25));
  }
  let version = ready.version.clone();
  let result = (|| -> Result<(), String> {
    let _running = gate.wait_until_closed(Duration::from_secs(300))?;
    // Recheck after all workbenches have exited. Cancellation cannot revive a removed candidate.
    let (_, bytes) = cache.load(&ticket.package_id)?;
    let helper_pid = std::process::id();
    let mut attempt = Attempt {
      version: ready.version,
      phase: "installing".into(),
      helper_pid: Some(helper_pid),
      helper_start: crate::coordinator::registry::process_start_identity(helper_pid),
      ..Default::default()
    };
    save_attempt(cache.root(), &attempt)?;
    pause_for_acceptance_interruption(cache.root())?;
    #[cfg(windows)]
    let result = update.install_waited_verified(&bytes, |pid| {
      attempt.installer_pid = Some(pid);
      attempt.installer_start = crate::coordinator::registry::process_start_identity(pid);
      save_attempt(cache.root(), &attempt).map_err(std::io::Error::other)
    });
    #[cfg(not(windows))]
    let result = update.install_verified(&bytes);
    attempt.phase = if result.is_ok() { "finished" } else { "failed" }.into();
    attempt.error = result.err().map(|e| e.to_string());
    save_attempt(cache.root(), &attempt)?;
    // Release only after the installer has returned, then restore the application/workbench set.
    Ok(())
  })();
  if let Err(error) = &result {
    let mut attempt = read_attempt(cache.root())
      .ok()
      .flatten()
      .unwrap_or_default();
    attempt.version = version;
    attempt.phase = "failed".into();
    attempt.error = Some(error.clone());
    let _ = save_attempt(cache.root(), &attempt);
  }
  drop(gate);
  let mut command = Command::new(&ticket.target);
  command.args(&ticket.args);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
  }
  command.spawn().map_err(|e| e.to_string())?;
  result
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn relaunch_does_not_replay_consumed_restore_grants() {
    assert_eq!(
      relaunch_args(
        [
          "--test-app-data",
          "isolated path",
          "--plvs-restore-workspace",
          "workspace",
          "--plvs-restore-nonce",
          "consumed",
          "--other"
        ]
        .map(str::to_owned)
      ),
      ["--test-app-data", "isolated path", "--other"]
    );
  }

  #[test]
  fn interrupted_attempts_block_only_while_a_recorded_process_lives() {
    let root = tempfile::tempdir().unwrap();
    assert!(check_abandoned_attempt(root.path()).is_ok());
    let mut attempt = Attempt {
      version: "999.0.0".into(),
      phase: "installing".into(),
      ..Default::default()
    };
    save_attempt(root.path(), &attempt).unwrap();
    // No recorded process remains: the launch proceeds and the attempt is reported as failed.
    assert!(check_abandoned_attempt(root.path()).is_ok());
    let recorded = read_attempt(root.path()).unwrap().unwrap();
    assert_eq!(recorded.phase, "failed");
    assert!(recorded.error.is_some());
    // A live helper keeps the fence even before an installer process exists.
    attempt.helper_pid = Some(std::process::id());
    attempt.helper_start = crate::coordinator::registry::process_start_identity(std::process::id());
    save_attempt(root.path(), &attempt).unwrap();
    assert!(check_abandoned_attempt(root.path()).is_err());
    attempt.helper_pid = None;
    attempt.helper_start = None;
    attempt.version = "0.0.1".into();
    save_attempt(root.path(), &attempt).unwrap();
    assert!(check_abandoned_attempt(root.path()).is_ok());
    attempt.version = "999.0.0".into();
    attempt.phase = "failed".into();
    save_attempt(root.path(), &attempt).unwrap();
    assert!(check_abandoned_attempt(root.path()).is_ok());
  }

  #[test]
  fn acceptance_interruption_is_limited_to_isolated_debug_packages() {
    assert!(acceptance_interruption_requested(
      Some(std::ffi::OsStr::new("1")),
      "com.soundoer.plvs.updatetest.h01234567"
    ));
    assert!(!acceptance_interruption_requested(
      Some(std::ffi::OsStr::new("1")),
      "com.soundoer.plvs"
    ));
    assert!(!acceptance_interruption_requested(
      Some(std::ffi::OsStr::new("0")),
      "com.soundoer.plvs.updatetest.h01234567"
    ));
  }
}
