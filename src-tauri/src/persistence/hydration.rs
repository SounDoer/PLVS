use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{json, Map, Value};

use super::{LibraryRepository, WorkspaceStore};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HydratedWorkspace {
  pub settings: Value,
  pub workspace: Value,
  pub presets: Value,
  pub themes: Value,
  pub capture_device_id: Value,
  pub window_bounds: Value,
  pub dock_state: Value,
  pub library_item_revisions: BTreeMap<String, BTreeMap<String, i64>>,
  pub library_collection_revisions: BTreeMap<String, i64>,
}

pub fn hydrate_workspace(
  identity_root: &std::path::Path,
  workspace_id: &str,
) -> Result<HydratedWorkspace, String> {
  let state = WorkspaceStore::open(identity_root, workspace_id)?
    .load()?
    .unwrap_or_else(|| json!({}));
  let state = state
    .as_object()
    .ok_or_else(|| "Workspace state must be a JSON object.".to_string())?;
  let repository = LibraryRepository::open(identity_root).map_err(|error| error.to_string())?;

  let preset_items = repository
    .list("preset")
    .map_err(|error| error.to_string())?;
  let theme_items = repository
    .list("theme")
    .map_err(|error| error.to_string())?;
  let profile_items = repository
    .list("loudnessProfile")
    .map_err(|error| error.to_string())?;

  let mut settings = object_at(state, "plvs:settings");
  let mut loudness_profiles = settings
    .remove("loudnessProfiles")
    .and_then(|value| value.as_object().cloned())
    .unwrap_or_default();
  loudness_profiles.insert(
    "profiles".to_string(),
    Value::Array(
      profile_items
        .iter()
        .map(|item| item.document.clone())
        .collect(),
    ),
  );
  settings.insert(
    "loudnessProfiles".to_string(),
    Value::Object(loudness_profiles),
  );

  let mut presets = object_at(state, "plvs:presets");
  presets.insert(
    "list".to_string(),
    Value::Array(
      preset_items
        .iter()
        .map(|item| item.document.clone())
        .collect(),
    ),
  );

  let theme_order: Vec<Value> = theme_items
    .iter()
    .map(|item| Value::String(item.id.clone()))
    .collect();
  let theme_documents: Map<String, Value> = theme_items
    .iter()
    .map(|item| (item.id.clone(), item.document.clone()))
    .collect();

  let kinds = [
    ("preset", &preset_items),
    ("theme", &theme_items),
    ("loudnessProfile", &profile_items),
  ];
  let mut library_item_revisions = BTreeMap::new();
  let mut library_collection_revisions = BTreeMap::new();
  for (kind, items) in kinds {
    library_item_revisions.insert(
      kind.to_string(),
      items
        .iter()
        .map(|item| (item.id.clone(), item.revision))
        .collect(),
    );
    library_collection_revisions.insert(
      kind.to_string(),
      repository
        .collection_revision(kind)
        .map_err(|error| error.to_string())?,
    );
  }

  Ok(HydratedWorkspace {
    settings: Value::Object(settings),
    workspace: Value::Object(object_at(state, "plvs:workspace")),
    presets: Value::Object(presets),
    themes: json!({ "themes": theme_documents, "order": theme_order }),
    capture_device_id: state
      .get("captureDeviceId")
      .cloned()
      .unwrap_or_else(|| json!("default")),
    window_bounds: state.get("windowBounds").cloned().unwrap_or(Value::Null),
    dock_state: state.get("dockState").cloned().unwrap_or(Value::Null),
    library_item_revisions,
    library_collection_revisions,
  })
}

fn object_at(state: &Map<String, Value>, key: &str) -> Map<String, Value> {
  state
    .get(key)
    .and_then(Value::as_object)
    .cloned()
    .unwrap_or_default()
}
