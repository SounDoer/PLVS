use std::path::{Path, PathBuf};

use super::{
  migrate_legacy_store, migration::initialize_empty_store, LegacyMigrationOutcome,
  WorkspaceCatalog, WorkspacePersistenceSession,
};

const STORAGE_DIRECTORY: &str = "multi-instance";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedIdentityStorage {
  pub root: PathBuf,
  pub migrated_legacy: bool,
}

pub fn prepare_identity_storage(
  app_data_dir: &Path,
  legacy_store_path: &Path,
) -> Result<PreparedIdentityStorage, String> {
  let root = app_data_dir.join(STORAGE_DIRECTORY);
  let migrated_legacy = if legacy_store_path.is_file() {
    migrate_legacy_store(legacy_store_path, &root)? == LegacyMigrationOutcome::Migrated
  } else {
    initialize_empty_store(&root)?;
    false
  };
  Ok(PreparedIdentityStorage {
    root,
    migrated_legacy,
  })
}

pub fn open_ordinary_launch_workspace(
  identity_root: &Path,
) -> Result<(String, WorkspacePersistenceSession), String> {
  match WorkspacePersistenceSession::open(identity_root, "default") {
    Ok(session) => Ok(("default".to_string(), session)),
    Err(error) if error.contains("already open in another PLVS instance") => {
      let workspace_id = WorkspaceCatalog::open(identity_root)?.allocate_blank_workbench()?;
      let session = WorkspacePersistenceSession::open(identity_root, &workspace_id)?;
      Ok((workspace_id, session))
    }
    Err(error) => Err(error),
  }
}
