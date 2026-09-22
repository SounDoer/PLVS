use std::{
  collections::HashSet,
  fs::{self, OpenOptions},
  io::Write,
  path::{Path, PathBuf},
};

use atomic_write_file::AtomicWriteFile;
use serde_json::{Map, Value};

use super::{LibraryRepository, WorkspaceStore};

const MIGRATION_MARKER: &str = "migration-complete.json";
const LEGACY_BACKUP_FILE: &str = "plvs-settings.pre-multi-instance.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyMigrationOutcome {
  Migrated,
  AlreadyMigrated,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LegacyLibrarySeed {
  pub kind: String,
  pub id: String,
  pub position: usize,
  pub document: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LegacyMigrationPlan {
  pub library_items: Vec<LegacyLibrarySeed>,
  pub workspace_state: Value,
  pub global_preferences: Map<String, Value>,
}

pub fn plan_legacy_store(legacy: &Map<String, Value>) -> Result<LegacyMigrationPlan, String> {
  let settings = object_value(legacy.get("plvs:settings"));
  let workspace = object_value(legacy.get("plvs:workspace"));
  let presets = object_value(legacy.get("plvs:presets"));
  let themes = object_value(legacy.get("plvs:themes"));

  let mut library_items = Vec::new();
  collect_array_items(
    "preset",
    presets.get("list").and_then(Value::as_array),
    &mut library_items,
  )?;
  collect_theme_items(&themes, &mut library_items)?;
  collect_array_items(
    "loudnessProfile",
    settings
      .get("loudnessProfiles")
      .and_then(Value::as_object)
      .and_then(|profiles| profiles.get("profiles"))
      .and_then(Value::as_array),
    &mut library_items,
  )?;

  let mut workspace_settings = settings.clone();
  if let Some(profiles) = workspace_settings
    .get_mut("loudnessProfiles")
    .and_then(Value::as_object_mut)
  {
    profiles.remove("profiles");
  }
  let mut global_preferences = Map::new();
  if let Some(value) = workspace_settings.remove("askToSendCrashReports") {
    global_preferences.insert("askToSendCrashReports".to_string(), value);
  }
  for key in ["clearShortcut", "clearGlobal", "agentControlEnabled"] {
    if let Some(value) = legacy.get(key) {
      global_preferences.insert(key.to_string(), value.clone());
    }
  }

  let mut workspace_presets = presets;
  workspace_presets.remove("list");
  let mut workspace_state = Map::new();
  workspace_state.insert(
    "plvs:settings".to_string(),
    Value::Object(workspace_settings),
  );
  workspace_state.insert("plvs:workspace".to_string(), Value::Object(workspace));
  workspace_state.insert("plvs:presets".to_string(), Value::Object(workspace_presets));
  for key in ["captureDeviceId", "windowBounds", "dockState"] {
    if let Some(value) = legacy.get(key) {
      workspace_state.insert(key.to_string(), value.clone());
    }
  }

  Ok(LegacyMigrationPlan {
    library_items,
    workspace_state: Value::Object(workspace_state),
    global_preferences,
  })
}

pub fn migrate_legacy_store(
  legacy_path: &Path,
  new_root: &Path,
) -> Result<LegacyMigrationOutcome, String> {
  if new_root.join(MIGRATION_MARKER).is_file() {
    return Ok(LegacyMigrationOutcome::AlreadyMigrated);
  }
  if new_root.exists() {
    return Err(
      "Incomplete multi-instance storage already exists and requires recovery.".to_string(),
    );
  }

  let legacy_bytes = fs::read(legacy_path)
    .map_err(|error| format!("Unable to read legacy settings store: {error}"))?;
  let legacy_value: Value = serde_json::from_slice(&legacy_bytes)
    .map_err(|error| format!("Unable to parse legacy settings store: {error}"))?;
  let legacy = legacy_value
    .as_object()
    .ok_or_else(|| "Legacy settings store must be a JSON object.".to_string())?;
  let plan = plan_legacy_store(legacy)?;

  let parent = new_root
    .parent()
    .ok_or_else(|| "Multi-instance storage path has no parent directory.".to_string())?;
  fs::create_dir_all(parent)
    .map_err(|error| format!("Unable to create migration directory: {error}"))?;
  preserve_legacy_backup(&parent.join(LEGACY_BACKUP_FILE), &legacy_bytes)?;

  let staging_root = migration_staging_path(parent)?;
  fs::create_dir(&staging_root)
    .map_err(|error| format!("Unable to create migration staging directory: {error}"))?;
  let result = populate_staging_store(&staging_root, &plan).and_then(|()| {
    match fs::rename(&staging_root, new_root) {
      Ok(()) => Ok(LegacyMigrationOutcome::Migrated),
      Err(_) if new_root.join(MIGRATION_MARKER).is_file() => {
        let _ = fs::remove_dir_all(&staging_root);
        Ok(LegacyMigrationOutcome::AlreadyMigrated)
      }
      Err(error) => Err(format!("Unable to publish migrated storage: {error}")),
    }
  });
  if result.is_err() {
    log::warn!(
      "Legacy migration staging data remains at {} for diagnosis",
      staging_root.display()
    );
  }
  result
}

fn preserve_legacy_backup(path: &Path, bytes: &[u8]) -> Result<(), String> {
  match OpenOptions::new().write(true).create_new(true).open(path) {
    Ok(mut file) => {
      file
        .write_all(bytes)
        .map_err(|error| format!("Unable to write legacy settings backup: {error}"))?;
      file
        .sync_all()
        .map_err(|error| format!("Unable to flush legacy settings backup: {error}"))
    }
    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
    Err(error) => Err(format!("Unable to create legacy settings backup: {error}")),
  }
}

fn migration_staging_path(parent: &Path) -> Result<PathBuf, String> {
  let mut random = [0_u8; 8];
  getrandom::fill(&mut random)
    .map_err(|error| format!("Unable to create migration staging identity: {error}"))?;
  let suffix = random
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  Ok(parent.join(format!(".multi-instance-migration-{suffix}")))
}

fn populate_staging_store(staging_root: &Path, plan: &LegacyMigrationPlan) -> Result<(), String> {
  let library = LibraryRepository::open(staging_root).map_err(|error| error.to_string())?;
  for item in &plan.library_items {
    library
      .create(&item.kind, &item.id, &item.document)
      .map_err(|error| error.to_string())?;
  }
  for (key, value) in &plan.global_preferences {
    library
      .set_global_preference(key, 0, value)
      .map_err(|error| error.to_string())?;
  }
  let workspace = WorkspaceStore::open(staging_root, "default")?;
  workspace.save(&plan.workspace_state)?;
  write_atomic_json(
    &staging_root.join(MIGRATION_MARKER),
    &serde_json::json!({ "schemaVersion": 1, "source": "plvs-settings.json" }),
  )
}

fn write_atomic_json(path: &Path, value: &Value) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Unable to create migration output directory: {error}"))?;
  }
  let mut bytes = serde_json::to_vec_pretty(value)
    .map_err(|error| format!("Unable to serialize migration output: {error}"))?;
  bytes.push(b'\n');
  let mut file = AtomicWriteFile::open(path)
    .map_err(|error| format!("Unable to open migration output: {error}"))?;
  file
    .write_all(&bytes)
    .map_err(|error| format!("Unable to write migration output: {error}"))?;
  file
    .commit()
    .map_err(|error| format!("Unable to publish migration output: {error}"))
}

fn object_value(value: Option<&Value>) -> Map<String, Value> {
  value
    .and_then(Value::as_object)
    .cloned()
    .unwrap_or_default()
}

fn collect_array_items(
  kind: &str,
  items: Option<&Vec<Value>>,
  output: &mut Vec<LegacyLibrarySeed>,
) -> Result<(), String> {
  let mut seen = HashSet::new();
  for (position, document) in items.into_iter().flatten().enumerate() {
    let id = document
      .get("id")
      .and_then(Value::as_str)
      .filter(|id| !id.is_empty())
      .ok_or_else(|| format!("Legacy {kind} item at position {position} has no ID."))?;
    if !seen.insert(id) {
      return Err(format!("Legacy {kind} Library contains duplicate ID {id}."));
    }
    output.push(LegacyLibrarySeed {
      kind: kind.to_string(),
      id: id.to_string(),
      position,
      document: document.clone(),
    });
  }
  Ok(())
}

fn collect_theme_items(
  themes: &Map<String, Value>,
  output: &mut Vec<LegacyLibrarySeed>,
) -> Result<(), String> {
  let documents = themes
    .get("themes")
    .and_then(Value::as_object)
    .cloned()
    .unwrap_or_default();
  let mut ordered_ids = Vec::new();
  let mut seen = HashSet::new();
  for id in themes
    .get("order")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .filter_map(Value::as_str)
  {
    if documents.contains_key(id) && seen.insert(id.to_string()) {
      ordered_ids.push(id.to_string());
    }
  }
  let mut remaining: Vec<String> = documents
    .keys()
    .filter(|id| !seen.contains(*id))
    .cloned()
    .collect();
  remaining.sort();
  ordered_ids.extend(remaining);

  for (position, id) in ordered_ids.into_iter().enumerate() {
    let document = documents
      .get(&id)
      .cloned()
      .ok_or_else(|| format!("Legacy theme {id} is missing its document."))?;
    let document_id = document.get("id").and_then(Value::as_str);
    if document_id != Some(id.as_str()) {
      return Err(format!(
        "Legacy theme key {id} does not match its document ID."
      ));
    }
    output.push(LegacyLibrarySeed {
      kind: "theme".to_string(),
      id,
      position,
      document,
    });
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn planner_rejects_duplicate_library_ids_before_writing() {
    let legacy = json!({
      "plvs:presets": {
        "list": [{ "id": "same" }, { "id": "same" }]
      }
    });
    let error = plan_legacy_store(legacy.as_object().unwrap()).unwrap_err();
    assert!(error.contains("duplicate ID same"));
  }
}
