use crate::update_cache::UpdateCache;
use serde::Serialize;
use std::{
  fs,
  os::unix::fs::{MetadataExt, PermissionsExt},
  path::Path,
  process::Command,
};

const EXECUTABLE: &str = "/usr/bin/plvs";
const INSTALLER: &str = "/usr/lib/plvs/plvs-update-installer";
const POLICY: &str = "/usr/share/polkit-1/actions/com.soundoer.plvs.update.policy";
const PKEXEC: &str = "/usr/bin/pkexec";
const APT_GET: &str = "/usr/bin/apt-get";
const DPKG_QUERY: &str = "/usr/bin/dpkg-query";
const DPKG_DEB: &str = "/usr/bin/dpkg-deb";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallerTicket<'a> {
  package_path: &'a Path,
  package_sha256: &'a str,
  version: &'a str,
  signature: &'a str,
}

pub fn unavailable_reason() -> Option<String> {
  availability().err()
}

fn availability() -> Result<(), String> {
  if cfg!(feature = "preview-identity") || cfg!(feature = "dev-identity") {
    return Err("This build does not install updates.".into());
  }
  let executable = std::env::current_exe()
    .ok()
    .and_then(|path| path.canonicalize().ok());
  if executable.as_deref() != Some(Path::new(EXECUTABLE)) {
    return Err(
      "Install the stable PLVS .deb with APT to enable automatic updates. This copy can still show new versions."
        .into(),
    );
  }
  for path in [PKEXEC, APT_GET, DPKG_QUERY, DPKG_DEB] {
    if !is_executable(Path::new(path)) {
      return Err(
        "This Linux system is missing a required system update tool. Download the new .deb from Releases and install it with APT."
          .into(),
      );
    }
  }
  let metadata = fs::metadata(INSTALLER).map_err(|_| {
    "This PLVS installation predates automatic Linux updates. Install the latest .deb once with APT to enable them."
      .to_string()
  })?;
  if !metadata.is_file()
    || metadata.uid() != 0
    || metadata.mode() & 0o022 != 0
    || metadata.permissions().mode() & 0o111 == 0
  {
    return Err(
      "The privileged PLVS update component is not installed safely. Reinstall the latest .deb with APT."
        .into(),
    );
  }
  let policy = fs::metadata(POLICY).map_err(|_| {
    "The PLVS system authorization policy is missing. Reinstall the latest .deb with APT."
      .to_string()
  })?;
  if !policy.is_file() || policy.uid() != 0 || policy.mode() & 0o022 != 0 {
    return Err(
      "The PLVS system authorization policy is not installed safely. Reinstall the latest .deb with APT."
        .into(),
    );
  }
  let output = Command::new(DPKG_QUERY)
    .args([
      "--show",
      "--showformat=${Status}\n${Architecture}\n${Version}",
      "plvs",
    ])
    .output()
    .map_err(|e| format!("PLVS could not inspect its package installation: {e}"))?;
  if !output.status.success() {
    return Err("Install the stable PLVS .deb with APT to enable automatic updates.".into());
  }
  let text = String::from_utf8_lossy(&output.stdout);
  let values = text.lines().map(str::trim).collect::<Vec<_>>();
  if values != ["install ok installed", "amd64", env!("CARGO_PKG_VERSION")] {
    return Err(
      "PLVS could not confirm that this exact version was installed by APT. Reinstall the latest .deb to repair automatic updates."
        .into(),
    );
  }
  Ok(())
}

fn is_executable(path: &Path) -> bool {
  fs::metadata(path)
    .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
    .unwrap_or(false)
}

pub fn install(
  cache: &UpdateCache,
  package_id: &str,
  version: &str,
  signature: &str,
  on_spawn: impl FnOnce(u32) -> Result<(), String>,
) -> Result<(), String> {
  availability()?;
  let ticket = InstallerTicket {
    package_path: &cache.package_file(package_id)?,
    package_sha256: package_id,
    version,
    signature,
  };
  let ticket_path = cache.root().join("linux-installer-ticket.json");
  let mut file = atomic_write_file::AtomicWriteFile::open(&ticket_path)
    .map_err(|e| format!("Cannot prepare the Linux installer: {e}"))?;
  use std::io::Write;
  file
    .write_all(&serde_json::to_vec(&ticket).map_err(|e| e.to_string())?)
    .and_then(|_| file.commit())
    .map_err(|e| format!("Cannot prepare the Linux installer: {e}"))?;

  let child = Command::new(PKEXEC)
    .arg(INSTALLER)
    .arg(&ticket_path)
    .spawn()
    .map_err(|e| format!("Cannot request authorization for the update: {e}"))?;
  let recording_error = on_spawn(child.id()).err();
  let output = child
    .wait_with_output()
    .map_err(|e| format!("The Linux installer did not finish: {e}"))?;
  if let Some(error) = recording_error {
    return Err(format!(
      "PLVS could not record the Linux installer process after it finished: {error}"
    ));
  }
  if output.status.success() {
    return Ok(());
  }
  match output.status.code() {
    Some(126) => Err(
      "Update canceled. The verified download was kept, so you can try again from update details."
        .into(),
    ),
    Some(127) => Err(
      "Linux authorization is unavailable. Download the new .deb from Releases and install it with APT."
        .into(),
    ),
    _ => {
      let detail = String::from_utf8_lossy(&output.stderr)
        .trim()
        .chars()
        .take(1000)
        .collect::<String>();
      Err(if detail.is_empty() {
        format!("The Linux update installer failed ({}).", output.status)
      } else {
        format!("The Linux update installer failed: {detail}")
      })
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_absolute_system_tools_are_used() {
    assert!(
      [EXECUTABLE, INSTALLER, POLICY, PKEXEC, APT_GET, DPKG_QUERY, DPKG_DEB]
        .into_iter()
        .all(|path| Path::new(path).is_absolute())
    );
  }
}
