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

/// A dead helper is not evidence that its installer stopped. Preserve the startup fence until
/// the observed installer process is gone; an ambiguous spawn interruption requires recovery.
pub fn check_abandoned_attempt(root: &Path) -> Result<(), String> {
  let Some(attempt) = read_attempt(root)? else {
    return Ok(());
  };
  if attempt.phase == "installing"
    && attempt
      .installer_pid
      .zip(attempt.installer_start)
      .is_some_and(|(pid, start)| {
        crate::coordinator::registry::process_start_identity(pid) == Some(start)
      })
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
  if attempt.phase != "installing" {
    return Ok(());
  }
  match (attempt.installer_pid, attempt.installer_start) {
    (Some(pid), Some(start)) if crate::coordinator::registry::process_start_identity(pid) != Some(start) => Ok(()),
    _ => Err("An update installation is still active or was interrupted before its outcome could be confirmed. Finish or repair the installation before starting PLVS.".into()),
  }
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
  let mut context = tauri::generate_context!();
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
  let result = (|| -> Result<(), String> {
    let _running = gate.wait_until_closed()?;
    // Recheck after all workbenches have exited. Cancellation cannot revive a removed candidate.
    let (_, bytes) = cache.load(&ticket.package_id)?;
    let mut attempt = Attempt {
      version: ready.version,
      phase: "installing".into(),
      ..Default::default()
    };
    save_attempt(cache.root(), &attempt)?;
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
  fn abandoned_attempts_fail_closed_but_completed_versions_can_start() {
    let root = tempfile::tempdir().unwrap();
    assert!(check_abandoned_attempt(root.path()).is_ok());
    let mut attempt = Attempt {
      version: "999.0.0".into(),
      phase: "installing".into(),
      ..Default::default()
    };
    save_attempt(root.path(), &attempt).unwrap();
    assert!(check_abandoned_attempt(root.path()).is_err());
    attempt.version = "0.0.1".into();
    save_attempt(root.path(), &attempt).unwrap();
    assert!(check_abandoned_attempt(root.path()).is_ok());
    attempt.version = "999.0.0".into();
    attempt.phase = "failed".into();
    save_attempt(root.path(), &attempt).unwrap();
    assert!(check_abandoned_attempt(root.path()).is_ok());
  }
}
