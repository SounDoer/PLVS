use app_lib::{coordinator::CoordinatorLease, runtime_identity::RuntimeIdentity};
use std::{
  io::BufRead,
  process::{Command, Stdio},
};

fn temp_root() -> std::path::PathBuf {
  std::env::temp_dir().join(format!("plvs-coordinator-election-{}", std::process::id()))
}

#[test]
fn exactly_one_process_role_owns_the_identity_and_a_successor_gets_a_new_generation() {
  let root = temp_root();
  let first_identity = RuntimeIdentity::new_default().unwrap();
  let second_identity = RuntimeIdentity::new_default().unwrap();

  let first = CoordinatorLease::try_acquire(&root, &first_identity)
    .expect("attempt first election")
    .expect("first process becomes coordinator");
  assert_eq!(first.generation(), 1);

  let follower =
    CoordinatorLease::try_acquire(&root, &second_identity).expect("attempt follower election");
  assert!(follower.is_none());

  drop(first);
  let successor = CoordinatorLease::try_acquire(&root, &second_identity)
    .expect("attempt successor election")
    .expect("surviving process becomes coordinator");
  assert_eq!(successor.generation(), 2);

  drop(successor);
  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_new_process_can_take_over_after_the_coordinator_crashes() {
  let root = temp_root().with_extension("crash");
  let mut child = Command::new(env!("CARGO_BIN_EXE_plvs"))
    .arg("--coordinator-test-host")
    .arg("--identity-root")
    .arg(&root)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .expect("start coordinator test host");
  let held_stdin = child.stdin.take().expect("hold child stdin open");
  let mut ready_line = String::new();
  std::io::BufReader::new(child.stdout.take().expect("child stdout"))
    .read_line(&mut ready_line)
    .expect("read coordinator readiness");
  let ready: serde_json::Value =
    serde_json::from_str(&ready_line).expect("coordinator readiness is JSON");
  assert_eq!(ready["generation"], 1);

  let successor_identity = RuntimeIdentity::new_default().unwrap();
  assert!(CoordinatorLease::try_acquire(&root, &successor_identity)
    .unwrap()
    .is_none());

  child.kill().expect("crash coordinator test host");
  child.wait().expect("reap coordinator test host");
  drop(held_stdin);
  let successor = CoordinatorLease::try_acquire(&root, &successor_identity)
    .expect("attempt election after crash")
    .expect("lock is released by process termination");
  assert_eq!(successor.generation(), 2);

  drop(successor);
  let _ = std::fs::remove_dir_all(root);
}
