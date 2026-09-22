use app_lib::persistence::{
  migrate_legacy_store, plan_legacy_store, LegacyMigrationOutcome, LibraryRepository,
  WorkspaceStore,
};
use serde_json::{json, Map};

#[test]
fn legacy_store_is_split_into_shared_library_and_default_workspace_state() {
  let legacy: Map<String, serde_json::Value> = serde_json::from_value(json!({
    "plvs:settings": {
      "themeId": "night",
      "appearance": "fixed",
      "referenceLufs": -23,
      "loudnessProfiles": {
        "active": "profile:ebu",
        "profiles": [{ "id": "ebu", "name": "EBU R128", "rules": [] }]
      }
    },
    "plvs:workspace": { "panelOrder": ["levelMeter", "spectrum"] },
    "plvs:presets": {
      "list": [{ "id": "mix", "name": "Mix", "tree": null }],
      "activeId": "mix",
      "dirty": true
    },
    "plvs:themes": {
      "themes": { "night": { "id": "night", "name": "Night" } },
      "order": ["night"]
    },
    "captureDeviceId": "out:2",
    "windowBounds": { "x": 10, "y": 20, "width": 1000, "height": 700 },
    "dockState": { "enabled": false, "edge": "right" },
    "clearShortcut": "Ctrl+Shift+K",
    "clearGlobal": true,
    "agentControlEnabled": true
  }))
  .unwrap();

  let plan = plan_legacy_store(&legacy).expect("plan legacy migration");
  let library_keys: Vec<(&str, &str, usize)> = plan
    .library_items
    .iter()
    .map(|item| (item.kind.as_str(), item.id.as_str(), item.position))
    .collect();
  assert_eq!(
    library_keys,
    [
      ("preset", "mix", 0),
      ("theme", "night", 0),
      ("loudnessProfile", "ebu", 0),
    ]
  );
  assert_eq!(
    plan.workspace_state["plvs:workspace"]["panelOrder"][1],
    "spectrum"
  );
  assert_eq!(plan.workspace_state["plvs:presets"]["activeId"], "mix");
  assert_eq!(plan.workspace_state["plvs:presets"]["dirty"], true);
  assert!(plan.workspace_state["plvs:presets"].get("list").is_none());
  assert_eq!(
    plan.workspace_state["plvs:settings"]["loudnessProfiles"]["active"],
    "profile:ebu"
  );
  assert!(plan.workspace_state["plvs:settings"]["loudnessProfiles"]
    .get("profiles")
    .is_none());
  assert_eq!(plan.workspace_state["captureDeviceId"], "out:2");
  assert_eq!(plan.workspace_state["windowBounds"]["width"], 1000);
  assert_eq!(plan.workspace_state["dockState"]["edge"], "right");
  assert_eq!(plan.global_preferences["clearShortcut"], "Ctrl+Shift+K");
  assert_eq!(plan.global_preferences["clearGlobal"], true);
  assert_eq!(plan.global_preferences["agentControlEnabled"], true);
}

#[test]
fn migration_publishes_a_complete_new_store_and_keeps_a_recoverable_backup() {
  let root = std::env::temp_dir().join(format!("plvs-legacy-migration-{}", std::process::id()));
  let legacy_path = root.join("plvs-settings.json");
  let new_root = root.join("multi-instance-v1");
  std::fs::create_dir_all(&root).unwrap();
  let legacy = json!({
    "plvs:settings": {
      "loudnessProfiles": {
        "active": "profile:ebu",
        "profiles": [{ "id": "ebu", "name": "EBU R128" }]
      }
    },
    "plvs:workspace": { "panelOrder": ["levelMeter"] },
    "plvs:presets": { "list": [{ "id": "mix", "name": "Mix" }], "activeId": "mix" },
    "plvs:themes": { "themes": {}, "order": [] },
    "clearGlobal": true
  });
  let legacy_bytes = serde_json::to_vec_pretty(&legacy).unwrap();
  std::fs::write(&legacy_path, &legacy_bytes).unwrap();

  let first = migrate_legacy_store(&legacy_path, &new_root).expect("migrate legacy store");
  assert_eq!(first, LegacyMigrationOutcome::Migrated);
  assert_eq!(
    std::fs::read(root.join("plvs-settings.pre-multi-instance.json")).unwrap(),
    legacy_bytes
  );
  assert_eq!(std::fs::read(&legacy_path).unwrap(), legacy_bytes);

  let library = LibraryRepository::open(&new_root).unwrap();
  assert_eq!(library.list("preset").unwrap()[0].id, "mix");
  assert_eq!(library.list("loudnessProfile").unwrap()[0].id, "ebu");
  let clear_global = library
    .read_global_preference("clearGlobal")
    .unwrap()
    .expect("global preference migrated");
  assert_eq!(clear_global.revision, 1);
  assert_eq!(clear_global.value, true);
  let workspace = WorkspaceStore::open(&new_root, "default").unwrap();
  let state = workspace.load().unwrap().expect("default workspace state");
  assert_eq!(state["plvs:presets"]["activeId"], "mix");

  let second = migrate_legacy_store(&legacy_path, &new_root).expect("repeat migration");
  assert_eq!(second, LegacyMigrationOutcome::AlreadyMigrated);
  assert_eq!(library.list("preset").unwrap().len(), 1);

  let _ = std::fs::remove_dir_all(root);
}
