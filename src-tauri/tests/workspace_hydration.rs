use app_lib::persistence::{hydrate_workspace, migrate_legacy_store, WorkspaceCatalog};
use serde_json::json;

#[test]
fn migrated_shared_items_are_recomposed_with_instance_owned_active_state() {
  let parent =
    std::env::temp_dir().join(format!("plvs-workspace-hydration-{}", std::process::id()));
  std::fs::create_dir_all(&parent).unwrap();
  let legacy_path = parent.join("plvs-settings.json");
  let root = parent.join("multi-instance");
  std::fs::write(
    &legacy_path,
    serde_json::to_vec_pretty(&json!({
      "plvs:settings": {
        "referenceLufs": -23,
        "askToSendCrashReports": false,
        "loudnessProfiles": {
          "active": "profile:broadcast",
          "profiles": [{ "id": "broadcast", "name": "Broadcast" }]
        }
      },
      "plvs:workspace": { "panelOrder": ["loudness"] },
      "plvs:presets": {
        "activeId": "preset-a",
        "dirty": false,
        "list": [
          { "id": "preset-a", "name": "A" },
          { "id": "preset-b", "name": "B" }
        ]
      },
      "plvs:themes": {
        "themes": {
          "theme-b": { "id": "theme-b", "name": "B" },
          "theme-a": { "id": "theme-a", "name": "A" }
        },
        "order": ["theme-a", "theme-b"]
      },
      "clearShortcut": "CmdOrCtrl+L",
      "clearGlobal": true,
      "captureDeviceId": "out:9",
      "windowBounds": { "x": 1, "y": 2, "width": 800, "height": 600 }
    }))
    .unwrap(),
  )
  .unwrap();
  migrate_legacy_store(&legacy_path, &root).unwrap();

  let hydrated = hydrate_workspace(&root, "default").expect("hydrate default workspace");
  assert_eq!(hydrated.settings["referenceLufs"], -23);
  assert_eq!(hydrated.settings["askToSendCrashReports"], false);
  assert_eq!(
    hydrated.settings["loudnessProfiles"]["active"],
    "profile:broadcast"
  );
  assert_eq!(
    hydrated.settings["loudnessProfiles"]["profiles"][0]["id"],
    "broadcast"
  );
  assert_eq!(hydrated.workspace["panelOrder"], json!(["loudness"]));
  assert_eq!(hydrated.presets["activeId"], "preset-a");
  assert_eq!(hydrated.presets["list"][0]["id"], "preset-a");
  assert_eq!(hydrated.presets["list"][1]["id"], "preset-b");
  assert_eq!(hydrated.themes["order"], json!(["theme-a", "theme-b"]));
  assert_eq!(hydrated.themes["themes"]["theme-a"]["name"], "A");
  assert_eq!(hydrated.capture_device_id, json!("out:9"));
  assert_eq!(hydrated.window_bounds["width"], 800);
  assert_eq!(hydrated.global_preferences["clearShortcut"], "CmdOrCtrl+L");
  assert_eq!(hydrated.global_preferences["clearGlobal"], true);
  assert_eq!(hydrated.global_preferences["askToSendCrashReports"], false);
  assert_eq!(hydrated.global_preference_revisions["clearShortcut"], 1);
  assert_eq!(hydrated.library_item_revisions["preset"]["preset-a"], 1);
  assert_eq!(hydrated.library_item_revisions["theme"]["theme-b"], 1);
  assert_eq!(
    hydrated.library_item_revisions["loudnessProfile"]["broadcast"],
    1
  );
  assert_eq!(hydrated.library_collection_revisions["preset"], 2);
  assert_eq!(hydrated.library_collection_revisions["theme"], 2);
  assert_eq!(hydrated.library_collection_revisions["loudnessProfile"], 1);

  let _ = std::fs::remove_dir_all(parent);
}

#[test]
fn a_new_additional_workbench_hydrates_stopped_with_automatic_selected() {
  let root = std::env::temp_dir().join(format!(
    "plvs-blank-workspace-hydration-{}",
    std::process::id()
  ));
  let catalog = WorkspaceCatalog::open(&root).expect("open workspace catalog");
  let workspace_id = catalog
    .allocate_blank_workbench()
    .expect("allocate additional workbench");

  let hydrated = hydrate_workspace(&root, &workspace_id).expect("hydrate additional workbench");

  assert_eq!(hydrated.capture_device_id, json!("default"));
  let _ = std::fs::remove_dir_all(root);
}
