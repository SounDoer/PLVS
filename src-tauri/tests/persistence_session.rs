use app_lib::persistence::{WorkspaceDomain, WorkspacePersistenceSession};
use serde_json::json;

#[test]
fn instance_domains_and_shared_library_items_keep_separate_owners() {
  let root = std::env::temp_dir().join(format!("plvs-persistence-session-{}", std::process::id()));
  let first = WorkspacePersistenceSession::open(&root, "default").expect("open default workspace");
  let second =
    WorkspacePersistenceSession::open(&root, "workspace-two").expect("open second workspace");

  first
    .save_instance_domain(
      WorkspaceDomain::Settings,
      &json!({
        "referenceLufs": -23,
        "loudnessProfiles": {
          "active": "profile:broadcast",
          "profiles": [{ "id": "broadcast", "name": "Broadcast" }]
        }
      }),
    )
    .unwrap();
  first
    .save_instance_domain(
      WorkspaceDomain::Presets,
      &json!({
        "activeId": "preset-a",
        "dirty": true,
        "list": [{ "id": "preset-a", "name": "A" }]
      }),
    )
    .unwrap();
  first
    .library()
    .create(
      "preset",
      "preset-a",
      &json!({ "id": "preset-a", "name": "A" }),
    )
    .unwrap();
  first
    .library()
    .create(
      "loudnessProfile",
      "broadcast",
      &json!({ "id": "broadcast", "name": "Broadcast" }),
    )
    .unwrap();

  let first_state = first.hydrate().unwrap();
  let second_state = second.hydrate().unwrap();
  assert_eq!(first_state.presets["activeId"], "preset-a");
  assert_eq!(second_state.presets.get("activeId"), None);
  assert_eq!(first_state.presets["list"], second_state.presets["list"]);
  assert_eq!(
    first_state.settings["loudnessProfiles"]["profiles"],
    second_state.settings["loudnessProfiles"]["profiles"]
  );
  assert_eq!(
    first_state.settings["loudnessProfiles"]["active"],
    "profile:broadcast"
  );
  assert_eq!(
    second_state.settings["loudnessProfiles"].get("active"),
    None
  );

  drop(first);
  drop(second);
  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn one_workspace_still_has_exactly_one_live_persistence_session() {
  let root = std::env::temp_dir().join(format!(
    "plvs-persistence-session-lease-{}",
    std::process::id()
  ));
  let first = WorkspacePersistenceSession::open(&root, "default").unwrap();
  let error = WorkspacePersistenceSession::open(&root, "default")
    .expect_err("second session must not write the same workspace");
  assert!(error.contains("already open"));

  drop(first);
  WorkspacePersistenceSession::open(&root, "default").expect("workspace reopens after release");
  let _ = std::fs::remove_dir_all(root);
}
