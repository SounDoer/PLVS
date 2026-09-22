use app_lib::persistence::WorkspaceStore;
use serde_json::json;

fn temp_root() -> std::path::PathBuf {
  std::env::temp_dir().join(format!(
    "plvs-workspace-store-{}-{}",
    std::process::id(),
    std::thread::current().name().unwrap_or("test")
  ))
}

#[test]
fn saved_workbench_state_is_loaded_after_reopening_the_store() {
  let root = temp_root();
  let store = WorkspaceStore::open(&root, "default").expect("open workspace store");
  let state = json!({
    "source": { "kind": "app", "id": "spotify" },
    "activePresetId": "broadcast",
    "windowBounds": { "x": 120, "y": 80, "width": 1280, "height": 720 }
  });

  store.save(&state).expect("save workspace state");
  let reopened = WorkspaceStore::open(&root, "default").expect("reopen workspace store");

  assert_eq!(reopened.load().expect("load workspace state"), Some(state));
  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_workspace_refuses_a_second_live_writer() {
  let root = temp_root().with_extension("lease");
  let first_store = WorkspaceStore::open(&root, "default").expect("open first workspace store");
  let second_store = WorkspaceStore::open(&root, "default").expect("open second workspace store");

  let first_lease = first_store.acquire_lease().expect("acquire first lease");
  let conflict = second_store
    .acquire_lease()
    .expect_err("second writer must be refused");
  assert!(conflict.contains("already open"));

  drop(first_lease);
  let replacement = second_store
    .acquire_lease()
    .expect("released workspace can be reopened");
  drop(replacement);
  let _ = std::fs::remove_dir_all(root);
}
