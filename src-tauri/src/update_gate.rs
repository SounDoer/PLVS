//! File leases span processes; a helper owns the entry lease across application replacement.
use fs4::FileExt;
use std::{
  fs::{File, OpenOptions},
  path::{Path, PathBuf},
};

fn open(root: &Path, name: &str) -> Result<File, String> {
  std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
  OpenOptions::new()
    .read(true)
    .write(true)
    .create(true)
    .truncate(false)
    .open(root.join(name))
    .map_err(|e| e.to_string())
}

pub struct RunningInstallation {
  pub fresh_session: bool,
  _running: File,
}

pub struct InstallGate {
  root: PathBuf,
  _entry: File,
}

impl RunningInstallation {
  pub fn enter(root: &Path) -> Result<Self, String> {
    // Serialize the fresh-session probe and shared-lock acquisition. Otherwise two first launches
    // could both see an empty running set during an unlock/downgrade gap.
    let admission = open(root, "admission.lock")?;
    FileExt::lock(&admission).map_err(|e| e.to_string())?;
    let entry = open(root, "entry.lock")?;
    FileExt::try_lock_shared(&entry).map_err(|_| {
      "An update is being installed. Start PLVS again when installation finishes.".to_string()
    })?;
    let running = open(root, "running.lock")?;
    let fresh_session = FileExt::try_lock(&running).is_ok();
    if fresh_session {
      FileExt::unlock(&running).map_err(|e| e.to_string())?;
    }
    FileExt::lock_shared(&running).map_err(|e| e.to_string())?;
    Ok(Self {
      fresh_session,
      _running: running,
    })
  }
}

impl InstallGate {
  pub fn claim(root: &Path) -> Result<Self, String> {
    let admission = open(root, "admission.lock")?;
    FileExt::lock(&admission).map_err(|e| e.to_string())?;
    let entry = open(root, "entry.lock")?;
    FileExt::try_lock(&entry)
      .map_err(|_| "Another update installation is already pending.".to_string())?;
    Ok(Self {
      root: root.to_path_buf(),
      _entry: entry,
    })
  }

  /// Hold the returned lease until the native installer has actually finished. A workbench that
  /// never exits must not hold the entry gate, and with it every later launch, indefinitely.
  pub fn wait_until_closed(&self, timeout: std::time::Duration) -> Result<File, String> {
    let running = open(&self.root, "running.lock")?;
    let deadline = std::time::Instant::now() + timeout;
    while FileExt::try_lock(&running).is_err() {
      if std::time::Instant::now() >= deadline {
        return Err(
          "Another PLVS workbench did not close, so the update was not installed.".into(),
        );
      }
      std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok(running)
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  #[ignore = "Internal child process for cross-process gate validation"]
  fn gate_child_probe() {
    let root = std::env::var_os("PLVS_GATE_PROBE_ROOT").expect("probe root");
    let expected = std::env::var("PLVS_GATE_PROBE_EXPECT").unwrap();
    let result = RunningInstallation::enter(Path::new(&root));
    match expected.as_str() {
      "blocked" => assert!(result.is_err()),
      "peer" => assert!(!result.unwrap().fresh_session),
      "fresh" => assert!(result.unwrap().fresh_session),
      _ => panic!("invalid probe expectation"),
    }
  }

  #[test]
  fn startup_fence_is_enforced_in_an_independent_process() {
    let root = tempfile::tempdir().unwrap();
    let child = |expected| {
      let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
          "--ignored",
          "--exact",
          "update_gate::tests::gate_child_probe",
        ])
        .env("PLVS_GATE_PROBE_ROOT", root.path())
        .env("PLVS_GATE_PROBE_EXPECT", expected)
        .status()
        .unwrap();
      assert!(status.success());
    };
    child("fresh");
    let app = RunningInstallation::enter(root.path()).unwrap();
    child("peer");
    let helper = InstallGate::claim(root.path()).unwrap();
    child("blocked");
    drop(app);
    let installing = helper
      .wait_until_closed(std::time::Duration::from_secs(5))
      .unwrap();
    child("blocked");
    drop(installing);
    drop(helper);
    child("fresh");
  }
  #[test]
  fn only_the_first_live_instance_is_an_eligible_session() {
    let root = tempfile::tempdir().unwrap();
    let first = RunningInstallation::enter(root.path()).unwrap();
    assert!(first.fresh_session);
    let second = RunningInstallation::enter(root.path()).unwrap();
    assert!(!second.fresh_session);
    drop(first);
    assert!(
      !RunningInstallation::enter(root.path())
        .unwrap()
        .fresh_session
    );
    drop(second);
    assert!(
      RunningInstallation::enter(root.path())
        .unwrap()
        .fresh_session
    );
  }
  #[test]
  fn helper_owns_the_gate_after_the_old_app_exits() {
    let root = tempfile::tempdir().unwrap();
    let app = RunningInstallation::enter(root.path()).unwrap();
    let helper = InstallGate::claim(root.path()).unwrap();
    assert!(RunningInstallation::enter(root.path()).is_err());
    assert!(InstallGate::claim(root.path()).is_err());
    drop(app);
    let replacement = helper
      .wait_until_closed(std::time::Duration::from_secs(5))
      .unwrap();
    assert!(RunningInstallation::enter(root.path()).is_err());
    drop(replacement);
    drop(helper);
    assert!(
      RunningInstallation::enter(root.path())
        .unwrap()
        .fresh_session
    );
  }
  #[test]
  fn a_workbench_that_never_exits_releases_the_gate_after_the_deadline() {
    let root = tempfile::tempdir().unwrap();
    let _stuck = RunningInstallation::enter(root.path()).unwrap();
    let helper = InstallGate::claim(root.path()).unwrap();
    assert!(helper
      .wait_until_closed(std::time::Duration::from_millis(200))
      .is_err());
    drop(helper);
    assert!(RunningInstallation::enter(root.path()).is_ok());
  }
}
