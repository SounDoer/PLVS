use std::path::{Path, PathBuf};

use super::{
  migrate_legacy_store, migration::initialize_empty_store, LegacyMigrationOutcome,
  LibraryRepository, WorkspaceCatalog, WorkspacePersistenceSession,
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
  // Fresh stores seed an unresolved choice inside their atomic initialization. An existing
  // store lacking this key predates update preferences and retains automatic checking only.
  let library = LibraryRepository::open(&root).map_err(|error| error.to_string())?;
  // Only atomic fresh initialization seeds an invitation. Missing on upgrade means suppressed.
  if library
    .read_global_preference("quickTour")
    .map_err(|error| error.to_string())?
    .is_none()
  {
    if let Err(error) =
      library.set_global_preference("quickTour", 0, &serde_json::json!("dismissed"))
    {
      if library
        .read_global_preference("quickTour")
        .map_err(|error| error.to_string())?
        .is_none()
      {
        return Err(error.to_string());
      }
    }
  }
  if library
    .read_global_preference("updatePreferences")
    .map_err(|error| error.to_string())?
    .is_none()
  {
    let migrated =
      serde_json::json!({"choiceMade": true, "autoCheck": true, "autoDownload": false});
    if let Err(error) = library.set_global_preference("updatePreferences", 0, &migrated) {
      if library
        .read_global_preference("updatePreferences")
        .map_err(|error| error.to_string())?
        .is_none()
      {
        return Err(error.to_string());
      }
    }
  }
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

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn quick_tour_is_invited_only_for_fresh_identities_and_remembers_disposition() {
    let directory = tempfile::tempdir().unwrap();
    let legacy = directory.path().join("plvs-settings.json");
    let prepared = prepare_identity_storage(directory.path(), &legacy).unwrap();
    let library = LibraryRepository::open(&prepared.root).unwrap();
    let preference = library
      .read_global_preference("quickTour")
      .unwrap()
      .unwrap();
    assert_eq!(preference.value, json!("pending"));
    library
      .set_global_preference("quickTour", preference.revision, &json!("completed"))
      .unwrap();
    prepare_identity_storage(directory.path(), &legacy).unwrap();
    assert_eq!(
      library
        .read_global_preference("quickTour")
        .unwrap()
        .unwrap()
        .value,
      json!("completed")
    );
    let preference = library
      .read_global_preference("quickTour")
      .unwrap()
      .unwrap();
    library
      .delete_global_preference("quickTour", preference.revision)
      .unwrap();
    prepare_identity_storage(directory.path(), &legacy).unwrap();
    assert_eq!(
      library
        .read_global_preference("quickTour")
        .unwrap()
        .unwrap()
        .value,
      json!("dismissed")
    );
  }

  #[test]
  fn a_fresh_identity_waits_for_a_choice_and_preserves_it_on_restart() {
    let directory = tempfile::tempdir().unwrap();
    let legacy = directory.path().join("plvs-settings.json");
    let prepared = prepare_identity_storage(directory.path(), &legacy).unwrap();
    let library = LibraryRepository::open(&prepared.root).unwrap();
    let preference = library
      .read_global_preference("updatePreferences")
      .unwrap()
      .unwrap();
    assert_eq!(
      preference.value,
      json!({"choiceMade": false, "autoCheck": false, "autoDownload": false})
    );
    let choice = json!({"choiceMade": true, "autoCheck": false, "autoDownload": false});
    library
      .set_global_preference("updatePreferences", preference.revision, &choice)
      .unwrap();
    prepare_identity_storage(directory.path(), &legacy).unwrap();
    assert_eq!(
      library
        .read_global_preference("updatePreferences")
        .unwrap()
        .unwrap()
        .value,
      choice
    );
  }

  #[test]
  fn an_existing_multi_instance_identity_retains_checking_without_downloads() {
    let directory = tempfile::tempdir().unwrap();
    let legacy = directory.path().join("plvs-settings.json");
    let prepared = prepare_identity_storage(directory.path(), &legacy).unwrap();
    let library = LibraryRepository::open(&prepared.root).unwrap();
    let preference = library
      .read_global_preference("updatePreferences")
      .unwrap()
      .unwrap();
    library
      .delete_global_preference("updatePreferences", preference.revision)
      .unwrap();
    prepare_identity_storage(directory.path(), &legacy).unwrap();
    assert_eq!(
      library
        .read_global_preference("updatePreferences")
        .unwrap()
        .unwrap()
        .value,
      json!({"choiceMade": true, "autoCheck": true, "autoDownload": false})
    );
  }

  #[test]
  fn a_legacy_store_is_an_existing_user_even_when_it_contains_no_preferences() {
    let directory = tempfile::tempdir().unwrap();
    let legacy = directory.path().join("plvs-settings.json");
    std::fs::write(&legacy, "{}").unwrap();
    let prepared = prepare_identity_storage(directory.path(), &legacy).unwrap();
    let library = LibraryRepository::open(&prepared.root).unwrap();
    assert_eq!(
      library
        .read_global_preference("quickTour")
        .unwrap()
        .unwrap()
        .value,
      json!("dismissed")
    );
    assert_eq!(
      library
        .read_global_preference("updatePreferences")
        .unwrap()
        .unwrap()
        .value,
      json!({"choiceMade": true, "autoCheck": true, "autoDownload": false})
    );
  }
}
