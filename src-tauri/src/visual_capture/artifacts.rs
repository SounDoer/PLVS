use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use sha2::{Digest, Sha256};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub const ARTIFACT_DIRECTORY: &str = "agent-artifacts";
pub const RETENTION: Duration = Duration::from_secs(24 * 60 * 60);
pub const MAX_COMPLETED_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ArtifactKind {
  Screenshot,
  Recording,
}

impl ArtifactKind {
  fn extension(self) -> &'static str {
    match self {
      Self::Screenshot => "png",
      Self::Recording => "mp4",
    }
  }

  fn media_type(self) -> &'static str {
    match self {
      Self::Screenshot => "image/png",
      Self::Recording => "video/mp4",
    }
  }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactMetadata {
  pub artifact_id: String,
  pub kind: ArtifactKind,
  pub media_type: String,
  pub staged_path: PathBuf,
  pub width: u32,
  pub height: u32,
  pub bytes: u64,
  pub sha256: String,
  pub created_at: String,
  pub expires_at: String,
}

#[derive(Clone)]
pub struct ArtifactStore {
  root: PathBuf,
  protected: Arc<Mutex<HashSet<PathBuf>>>,
}

pub struct PendingArtifact {
  artifact_id: String,
  kind: ArtifactKind,
  temporary_path: PathBuf,
  final_path: PathBuf,
  protected: Arc<Mutex<HashSet<PathBuf>>>,
}

impl PendingArtifact {
  pub fn path(&self) -> &Path {
    &self.temporary_path
  }
}

impl Drop for PendingArtifact {
  fn drop(&mut self) {
    if let Ok(mut protected) = self.protected.lock() {
      protected.remove(&self.temporary_path);
      protected.remove(&self.final_path);
    }
    let _ = fs::remove_file(&self.temporary_path);
  }
}

pub struct ArtifactProtection {
  path: PathBuf,
  protected: Arc<Mutex<HashSet<PathBuf>>>,
}

impl Drop for ArtifactProtection {
  fn drop(&mut self) {
    if let Ok(mut protected) = self.protected.lock() {
      protected.remove(&self.path);
    }
  }
}

impl ArtifactStore {
  pub fn initialize(app_data_dir: &Path) -> io::Result<Self> {
    let requested_root = app_data_dir.join(ARTIFACT_DIRECTORY);
    fs::create_dir_all(&requested_root)?;
    let store = Self {
      root: fs::canonicalize(requested_root)?,
      protected: Arc::new(Mutex::new(HashSet::new())),
    };
    store.cleanup_orphan_temporaries()?;
    store.cleanup(SystemTime::now())?;
    Ok(store)
  }

  pub fn root(&self) -> &Path {
    &self.root
  }

  pub fn begin(&self, kind: ArtifactKind) -> io::Result<PendingArtifact> {
    for _ in 0..16 {
      let artifact_id = random_id("art")?;
      let final_path = self
        .root
        .join(format!("{artifact_id}.{}", kind.extension()));
      let temporary_path = self
        .root
        .join(format!(".{artifact_id}.{}.tmp", kind.extension()));
      match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
      {
        Ok(_) => {
          self
            .protected
            .lock()
            .map_err(|_| io::Error::other("artifact protection lock poisoned"))?
            .insert(temporary_path.clone());
          return Ok(PendingArtifact {
            artifact_id,
            kind,
            temporary_path,
            final_path,
            protected: Arc::clone(&self.protected),
          });
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
        Err(error) => return Err(error),
      }
    }
    Err(io::Error::new(
      io::ErrorKind::AlreadyExists,
      "could not allocate a unique artifact path",
    ))
  }

  /// Hashing and publication always leave the UI/runtime executor before performing file IO.
  pub async fn publish(
    &self,
    pending: PendingArtifact,
    width: u32,
    height: u32,
    created_at: SystemTime,
  ) -> io::Result<ArtifactMetadata> {
    let store = self.clone();
    tauri::async_runtime::spawn_blocking(move || {
      store.publish_blocking(pending, width, height, created_at)
    })
    .await
    .map_err(io::Error::other)?
  }

  pub(crate) fn publish_blocking(
    &self,
    pending: PendingArtifact,
    width: u32,
    height: u32,
    created_at: SystemTime,
  ) -> io::Result<ArtifactMetadata> {
    let (bytes, sha256) = file_identity(&pending.temporary_path)?;
    fs::rename(&pending.temporary_path, &pending.final_path)?;
    {
      let mut protected = self
        .protected
        .lock()
        .map_err(|_| io::Error::other("artifact protection lock poisoned"))?;
      protected.remove(&pending.temporary_path);
      protected.insert(pending.final_path.clone());
    }
    let metadata = ArtifactMetadata {
      artifact_id: pending.artifact_id.clone(),
      kind: pending.kind,
      media_type: pending.kind.media_type().to_owned(),
      staged_path: pending.final_path.clone(),
      width,
      height,
      bytes,
      sha256,
      created_at: format_time(created_at)?,
      expires_at: format_time(created_at + RETENTION)?,
    };
    drop(pending);
    self.cleanup(SystemTime::now())?;
    Ok(metadata)
  }

  pub fn protect(&self, path: &Path) -> io::Result<ArtifactProtection> {
    let path = self.contained_existing_path(path)?;
    self
      .protected
      .lock()
      .map_err(|_| io::Error::other("artifact protection lock poisoned"))?
      .insert(path.clone());
    Ok(ArtifactProtection {
      path,
      protected: Arc::clone(&self.protected),
    })
  }

  pub fn cleanup(&self, now: SystemTime) -> io::Result<()> {
    let protected = self
      .protected
      .lock()
      .map_err(|_| io::Error::other("artifact protection lock poisoned"))?
      .clone();
    let entries = self.completed_entries(&protected)?;
    for path in cleanup_candidates(&entries, now, MAX_COMPLETED_BYTES) {
      self.remove_contained_file(&path)?;
    }
    Ok(())
  }

  fn cleanup_orphan_temporaries(&self) -> io::Result<()> {
    for entry in fs::read_dir(&self.root)? {
      let entry = entry?;
      let path = entry.path();
      if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(".art-") && name.ends_with(".tmp"))
      {
        self.remove_contained_file(&path)?;
      }
    }
    Ok(())
  }

  fn completed_entries(&self, protected: &HashSet<PathBuf>) -> io::Result<Vec<CleanupEntry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(&self.root)? {
      let entry = entry?;
      let path = entry.path();
      let extension = path.extension().and_then(|value| value.to_str());
      if !matches!(extension, Some("png" | "mp4")) {
        continue;
      }
      let metadata = match entry.metadata() {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => continue,
        Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
        Err(error) => return Err(error),
      };
      entries.push(CleanupEntry {
        path: self.contained_existing_path(&path)?,
        modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        bytes: metadata.len(),
        protected: protected.contains(&path),
      });
    }
    Ok(entries)
  }

  fn contained_existing_path(&self, path: &Path) -> io::Result<PathBuf> {
    let normalized = normalize_absolute(path)?;
    let canonical = fs::canonicalize(&normalized)?;
    if canonical == self.root || !canonical.starts_with(&self.root) {
      return Err(io::Error::new(
        io::ErrorKind::PermissionDenied,
        "artifact path escapes the staging root",
      ));
    }
    Ok(canonical)
  }

  fn remove_contained_file(&self, path: &Path) -> io::Result<()> {
    let contained = match self.contained_existing_path(path) {
      Ok(path) => path,
      Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
      Err(error) => return Err(error),
    };
    match fs::remove_file(contained) {
      Ok(()) => Ok(()),
      Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
      Err(error) => Err(error),
    }
  }
}

#[derive(Clone, Debug)]
struct CleanupEntry {
  path: PathBuf,
  modified: SystemTime,
  bytes: u64,
  protected: bool,
}

fn cleanup_candidates(
  entries: &[CleanupEntry],
  now: SystemTime,
  maximum_bytes: u64,
) -> Vec<PathBuf> {
  let mut ordered = entries.to_vec();
  ordered.sort_by_key(|entry| entry.modified);
  let mut retained_bytes = ordered.iter().map(|entry| entry.bytes).sum::<u64>();
  let mut selected = Vec::new();
  for entry in &ordered {
    if entry.protected {
      continue;
    }
    let expired = now
      .duration_since(entry.modified)
      .is_ok_and(|age| age >= RETENTION);
    if expired || retained_bytes > maximum_bytes {
      selected.push(entry.path.clone());
      retained_bytes = retained_bytes.saturating_sub(entry.bytes);
    }
  }
  selected
}

fn random_id(prefix: &str) -> io::Result<String> {
  let mut bytes = [0_u8; 16];
  getrandom::fill(&mut bytes).map_err(io::Error::other)?;
  let encoded = bytes
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  Ok(format!("{prefix}-{encoded}"))
}

fn file_identity(path: &Path) -> io::Result<(u64, String)> {
  let mut file = File::open(path)?;
  let mut hasher = Sha256::new();
  let mut bytes = 0_u64;
  let mut buffer = [0_u8; 64 * 1024];
  loop {
    let read = file.read(&mut buffer)?;
    if read == 0 {
      break;
    }
    bytes += read as u64;
    hasher.update(&buffer[..read]);
  }
  let digest = hasher.finalize();
  let sha256 = digest
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  Ok((bytes, sha256))
}

fn format_time(value: SystemTime) -> io::Result<String> {
  OffsetDateTime::from(value)
    .format(&Rfc3339)
    .map_err(io::Error::other)
}

fn normalize_absolute(path: &Path) -> io::Result<PathBuf> {
  if !path.is_absolute() {
    return Err(io::Error::new(
      io::ErrorKind::InvalidInput,
      "artifact path must be absolute",
    ));
  }
  let mut normalized = PathBuf::new();
  for component in path.components() {
    match component {
      Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
        normalized.push(component)
      }
      Component::CurDir => {}
      Component::ParentDir => {
        if !normalized.pop() {
          return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "artifact path escapes its root",
          ));
        }
      }
    }
  }
  Ok(normalized)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  struct TestDirectory(PathBuf);

  impl TestDirectory {
    fn new() -> Self {
      let path = std::env::temp_dir().join(random_id("plvs-artifact-test").unwrap());
      fs::create_dir_all(&path).unwrap();
      Self(path)
    }
  }

  impl Drop for TestDirectory {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  fn entry(name: &str, age: Duration, bytes: u64, protected: bool) -> CleanupEntry {
    CleanupEntry {
      path: PathBuf::from(name),
      modified: SystemTime::UNIX_EPOCH + RETENTION + Duration::from_secs(100) - age,
      bytes,
      protected,
    }
  }

  #[test]
  fn expiry_boundary_is_inclusive_and_protected_files_survive() {
    let now = SystemTime::UNIX_EPOCH + RETENTION + Duration::from_secs(100);
    let entries = vec![
      entry("fresh.png", RETENTION - Duration::from_secs(1), 1, false),
      entry("expired.png", RETENTION, 1, false),
      entry("active.mp4", RETENTION + Duration::from_secs(1), 1, true),
    ];
    assert_eq!(
      cleanup_candidates(&entries, now, u64::MAX),
      vec![PathBuf::from("expired.png")]
    );
  }

  #[test]
  fn capacity_cleanup_removes_oldest_completed_files_first() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1000);
    let entries = vec![
      entry("new.png", Duration::from_secs(1), 4, false),
      entry("old.png", Duration::from_secs(3), 4, false),
      entry("middle.png", Duration::from_secs(2), 4, false),
    ];
    assert_eq!(
      cleanup_candidates(&entries, now, 7),
      vec![PathBuf::from("old.png"), PathBuf::from("middle.png")]
    );
  }

  #[test]
  fn publishes_complete_hashed_metadata_and_removes_protection() {
    let parent = TestDirectory::new();
    let store = ArtifactStore::initialize(&parent.0).unwrap();
    let pending = store.begin(ArtifactKind::Screenshot).unwrap();
    fs::write(pending.path(), b"png bytes").unwrap();
    let temporary = pending.path().to_owned();
    let created_at = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    let metadata =
      tauri::async_runtime::block_on(store.publish(pending, 640, 480, created_at)).unwrap();

    assert_eq!(metadata.kind, ArtifactKind::Screenshot);
    assert_eq!(metadata.media_type, "image/png");
    assert_eq!(metadata.width, 640);
    assert_eq!(metadata.height, 480);
    assert_eq!(metadata.bytes, 9);
    assert_eq!(
      metadata.sha256,
      "d013614dc14a37ee20fe92005737ab7d3427e7e93580ad56ef8a42205e7f7a4e"
    );
    assert!(!temporary.exists());
    assert!(metadata.staged_path.exists());
    assert!(store.protected.lock().unwrap().is_empty());
  }

  #[test]
  fn rename_failure_does_not_publish_a_final_path() {
    let parent = TestDirectory::new();
    let store = ArtifactStore::initialize(&parent.0).unwrap();
    let pending = store.begin(ArtifactKind::Screenshot).unwrap();
    fs::write(pending.path(), b"complete").unwrap();
    fs::create_dir(&pending.final_path).unwrap();
    let final_path = pending.final_path.clone();
    assert!(
      tauri::async_runtime::block_on(store.publish(pending, 1, 1, SystemTime::now())).is_err()
    );
    assert!(final_path.is_dir());
  }

  #[test]
  fn startup_removes_orphan_temporaries_but_not_completed_artifacts() {
    let parent = TestDirectory::new();
    let root = parent.0.join(ARTIFACT_DIRECTORY);
    fs::create_dir_all(&root).unwrap();
    let orphan = root.join(".art-deadbeef.png.tmp");
    let complete = root.join("art-complete.png");
    fs::write(&orphan, b"partial").unwrap();
    fs::write(&complete, b"complete").unwrap();
    ArtifactStore::initialize(&parent.0).unwrap();
    assert!(!orphan.exists());
    assert!(complete.exists());
  }

  #[test]
  fn cleanup_tolerates_a_candidate_that_disappeared() {
    let parent = TestDirectory::new();
    let store = ArtifactStore::initialize(&parent.0).unwrap();
    let missing = store.root.join("art-missing.png");
    assert!(store.remove_contained_file(&missing).is_ok());
  }

  #[test]
  fn deletion_rejects_relative_parent_and_outside_paths() {
    let parent = TestDirectory::new();
    let store = ArtifactStore::initialize(&parent.0).unwrap();
    let outside = parent.0.join("outside.png");
    fs::write(&outside, b"outside").unwrap();
    assert_eq!(
      store
        .remove_contained_file(Path::new("art.png"))
        .unwrap_err()
        .kind(),
      io::ErrorKind::InvalidInput
    );
    assert_eq!(
      store.remove_contained_file(&outside).unwrap_err().kind(),
      io::ErrorKind::PermissionDenied
    );
    assert!(outside.exists());
  }

  #[test]
  fn explicit_protection_prevents_cleanup_selection() {
    let parent = TestDirectory::new();
    let store = ArtifactStore::initialize(&parent.0).unwrap();
    let file = store.root.join("art-active.mp4");
    fs::write(&file, b"active").unwrap();
    let guard = store.protect(&file).unwrap();
    let protected = store.protected.lock().unwrap().clone();
    let entries = store.completed_entries(&protected).unwrap();
    assert!(entries[0].protected);
    drop(guard);
    assert!(store.protected.lock().unwrap().is_empty());
  }
}
