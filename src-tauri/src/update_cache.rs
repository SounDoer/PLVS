//! Durable update staging. No network or installer calls occur in this module.
//! Verification is supplied by the updater adapter before publishing ready state.
use atomic_write_file::AtomicWriteFile;
use fs4::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
  fs::{self, File, OpenOptions},
  io::Write,
  path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadyUpdate {
  pub id: String,
  pub version: String,
  pub manifest: Value,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheState {
  generation: u64,
  ready: Option<ReadyUpdate>,
}

#[derive(Clone, Debug)]
pub struct UpdateCache {
  root: PathBuf,
}

fn io_error(error: impl std::fmt::Display) -> String {
  format!("Update cache: {error}")
}

fn digest(bytes: &[u8]) -> String {
  Sha256::digest(bytes)
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect()
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let mut file = AtomicWriteFile::open(path).map_err(io_error)?;
  file.write_all(bytes).map_err(io_error)?;
  file.commit().map_err(io_error)
}

impl UpdateCache {
  pub fn root(&self) -> &Path {
    &self.root
  }

  /// Recover interrupted metadata/package writes under the publication lock. Only our hex-named
  /// packages are eligible for cleanup; leases and installer attempt records are never removed.
  pub fn reconcile(&self) -> Result<(), String> {
    let _lock = self.lock()?;
    let mut state = match fs::read(self.root.join("state.json")) {
      Ok(bytes) => match serde_json::from_slice::<CacheState>(&bytes) {
        Ok(state) => state,
        Err(_) => {
          let mut nonce = [0; 8];
          getrandom::fill(&mut nonce).map_err(io_error)?;
          CacheState {
            generation: u64::from_le_bytes(nonce) / 2,
            ready: None,
          }
        }
      },
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => CacheState::default(),
      Err(error) => return Err(io_error(error)),
    };
    if let Some(ready) = &state.ready {
      let intact = self
        .package_path(&ready.id)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .is_some_and(|bytes| digest(&bytes) == ready.id);
      if !intact {
        state.ready = None;
        state.generation = state
          .generation
          .checked_add(1)
          .ok_or("Update generation exhausted.")?;
      }
    }
    self.save(&state)?;
    for entry in fs::read_dir(&self.root).map_err(io_error)? {
      let entry = entry.map_err(io_error)?;
      let name = entry.file_name();
      let name = name.to_string_lossy();
      if let Some(id) = name.strip_suffix(".package") {
        if self.package_path(id).is_ok() && state.ready.as_ref().is_none_or(|ready| ready.id != id)
        {
          let _ = fs::remove_file(entry.path());
        }
      }
    }
    Ok(())
  }
  /// Installation-scoped even when multiple installed/Portable copies share app preferences.
  pub fn open(app_data: &Path, executable: &Path) -> Result<Self, String> {
    let executable = executable.canonicalize().map_err(io_error)?;
    let installation = digest(executable.to_string_lossy().as_bytes());
    let root = app_data.join("updates").join(installation);
    fs::create_dir_all(&root).map_err(io_error)?;
    let root = root.canonicalize().map_err(io_error)?;
    Ok(Self { root })
  }

  fn lock(&self) -> Result<File, String> {
    let file = OpenOptions::new()
      .create(true)
      .truncate(false)
      .read(true)
      .write(true)
      .open(self.root.join("state.lock"))
      .map_err(io_error)?;
    FileExt::lock(&file).map_err(io_error)?;
    Ok(file)
  }

  fn read(&self) -> Result<CacheState, String> {
    match fs::read(self.root.join("state.json")) {
      Ok(bytes) => serde_json::from_slice(&bytes).map_err(io_error),
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(CacheState::default()),
      Err(error) => Err(io_error(error)),
    }
  }

  fn save(&self, state: &CacheState) -> Result<(), String> {
    write_atomic(
      &self.root.join("state.json"),
      &serde_json::to_vec(state).map_err(io_error)?,
    )
  }

  /// Keep this lease for the whole transfer; another process cannot start a competing writer.
  pub fn download_lease(&self) -> Result<File, String> {
    let file = OpenOptions::new()
      .create(true)
      .truncate(false)
      .read(true)
      .write(true)
      .open(self.root.join("download.lock"))
      .map_err(io_error)?;
    FileExt::try_lock(&file)
      .map_err(|_| "Another instance is downloading an update.".to_string())?;
    Ok(file)
  }

  pub fn generation(&self) -> Result<u64, String> {
    let _lock = self.lock()?;
    Ok(self.read()?.generation)
  }

  pub fn ready(&self) -> Result<Option<ReadyUpdate>, String> {
    let _lock = self.lock()?;
    Ok(self.read()?.ready)
  }

  fn package_path(&self, id: &str) -> Result<PathBuf, String> {
    if id.len() != 64 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
      return Err("Invalid staged update identifier.".to_string());
    }
    Ok(self.root.join(format!("{id}.package")))
  }

  /// The caller verifies bytes with the trusted updater key before this transaction.
  /// A canceled generation cannot publish or overwrite the previous ready candidate.
  pub fn publish_verified(
    &self,
    generation: u64,
    version: String,
    manifest: Value,
    bytes: &[u8],
  ) -> Result<Option<ReadyUpdate>, String> {
    let _lock = self.lock()?;
    let mut state = self.read()?;
    if state.generation != generation {
      return Ok(None);
    }
    let id = digest(bytes);
    let ready = ReadyUpdate {
      id,
      version,
      manifest,
    };
    let path = self.package_path(&ready.id)?;
    write_atomic(&path, bytes)?;
    let previous = state.ready.replace(ready.clone());
    self.save(&state)?;
    if let Some(previous) = previous.filter(|p| p.id != ready.id) {
      // Metadata has committed first. Cleanup failure cannot lose the new ready package.
      let _ = fs::remove_file(self.package_path(&previous.id)?);
    }
    Ok(Some(ready))
  }

  /// Re-read identity under the lock; a dialog cannot load a replacement using a stale ID.
  /// The returned bytes still require signature verification immediately before installation.
  pub fn load(&self, expected_id: &str) -> Result<(ReadyUpdate, Vec<u8>), String> {
    let _lock = self.lock()?;
    let ready = self
      .read()?
      .ready
      .filter(|r| r.id == expected_id)
      .ok_or_else(|| "This update is no longer ready. Reopen update details.".to_string())?;
    let bytes = fs::read(self.package_path(&ready.id)?).map_err(io_error)?;
    if digest(&bytes) != ready.id {
      return Err("The staged update is damaged. Download it again.".to_string());
    }
    Ok((ready, bytes))
  }

  pub fn cancel(&self) -> Result<(), String> {
    let _lock = self.lock()?;
    let mut state = self.read()?;
    state.generation = state
      .generation
      .checked_add(1)
      .ok_or_else(|| "Update generation exhausted.".to_string())?;
    let previous = state.ready.take();
    self.save(&state)?;
    if let Some(previous) = previous {
      match fs::remove_file(self.package_path(&previous.id)?) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error(error)),
      }
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn cache() -> (tempfile::TempDir, UpdateCache) {
    let temp = tempfile::tempdir().unwrap();
    let executable = temp.path().join("app.exe");
    fs::write(&executable, b"application").unwrap();
    let cache = UpdateCache::open(temp.path(), &executable).unwrap();
    (temp, cache)
  }

  #[test]
  fn startup_discards_corrupt_metadata_and_orphaned_packages_without_touching_leases() {
    let (_temp, cache) = cache();
    let ready = cache
      .publish_verified(0, "2.0.0".into(), Value::Null, b"first")
      .unwrap()
      .unwrap();
    fs::write(cache.root.join("state.json"), b"interrupted").unwrap();
    fs::write(cache.root.join("entry.lock"), b"keep").unwrap();
    cache.reconcile().unwrap();
    assert!(cache.ready().unwrap().is_none());
    assert!(!cache.package_path(&ready.id).unwrap().exists());
    assert_eq!(fs::read(cache.root.join("entry.lock")).unwrap(), b"keep");
    assert!(cache
      .publish_verified(0, "2.0.0".into(), Value::Null, b"late")
      .unwrap()
      .is_none());
  }

  #[test]
  fn cancellation_prevents_late_completion_and_removes_ready_package() {
    let (_temp, cache) = cache();
    let generation = cache.generation().unwrap();
    let ready = cache
      .publish_verified(generation, "2.0.0".into(), Value::Null, b"first")
      .unwrap()
      .unwrap();
    cache.cancel().unwrap();
    assert!(cache.load(&ready.id).is_err());
    assert!(cache
      .publish_verified(generation, "3.0.0".into(), Value::Null, b"late")
      .unwrap()
      .is_none());
    assert!(cache.ready().unwrap().is_none());
    assert!(!cache.package_path(&ready.id).unwrap().exists());
  }

  #[test]
  fn ready_survives_reopen_and_replacement_rejects_stale_target() {
    let (temp, cache) = cache();
    let first = cache
      .publish_verified(0, "2.0.0".into(), Value::Null, b"first")
      .unwrap()
      .unwrap();
    let reopened = UpdateCache::open(temp.path(), &temp.path().join("app.exe")).unwrap();
    assert_eq!(reopened.load(&first.id).unwrap().1, b"first");
    let second = cache
      .publish_verified(0, "3.0.0".into(), Value::Null, b"second")
      .unwrap()
      .unwrap();
    assert!(reopened.load(&first.id).is_err());
    assert_eq!(reopened.load(&second.id).unwrap().1, b"second");
  }

  #[test]
  fn rejects_tampering_invalid_ids_and_competing_downloaders() {
    let (_temp, cache) = cache();
    let ready = cache
      .publish_verified(0, "2.0.0".into(), Value::Null, b"first")
      .unwrap()
      .unwrap();
    fs::write(cache.package_path(&ready.id).unwrap(), b"changed").unwrap();
    assert!(cache.load(&ready.id).is_err());
    assert!(cache.package_path("../anything").is_err());
    let lease = cache.download_lease().unwrap();
    assert!(cache.download_lease().is_err());
    drop(lease);
    assert!(cache.download_lease().is_ok());
  }
}
