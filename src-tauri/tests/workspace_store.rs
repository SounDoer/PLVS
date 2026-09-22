use app_lib::persistence::WorkspaceStore;
use serde_json::json;
use std::{
  io::BufRead,
  process::{Command, Stdio},
};

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

#[test]
fn a_workspace_can_be_reopened_after_its_writer_process_crashes() {
  let root = temp_root().with_extension("crash");
  let store = WorkspaceStore::open(&root, "default").unwrap();
  let mut child = Command::new(env!("CARGO_BIN_EXE_plvs"))
    .arg("--workspace-lease-test-host")
    .arg("--identity-root")
    .arg(&root)
    .arg("--workspace-id")
    .arg("default")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .expect("start workspace lease holder");
  let held_stdin = child.stdin.take().unwrap();
  let mut ready_line = String::new();
  std::io::BufReader::new(child.stdout.take().unwrap())
    .read_line(&mut ready_line)
    .expect("read workspace lease readiness");
  assert_eq!(ready_line.trim(), "ready");
  assert!(store.acquire_lease().unwrap_err().contains("already open"));

  child.kill().expect("crash workspace lease holder");
  child.wait().expect("reap workspace lease holder");
  drop(held_stdin);
  let replacement = store
    .acquire_lease()
    .expect("operating system releases lease after a crash");

  drop(replacement);
  let _ = std::fs::remove_dir_all(root);
}
