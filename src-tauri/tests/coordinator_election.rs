use app_lib::{coordinator::CoordinatorLease, runtime_identity::RuntimeIdentity};
use std::{
  io::BufRead,
  process::{Command, Stdio},
  time::Duration,
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

#[test]
fn an_already_running_participant_promotes_without_restart() {
  let root = temp_root().with_extension("survivor");
  let mut coordinator = Command::new(env!("CARGO_BIN_EXE_plvs"))
    .arg("--coordinator-test-host")
    .arg("--identity-root")
    .arg(&root)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .spawn()
    .expect("start coordinator");
  let coordinator_stdin = coordinator.stdin.take().unwrap();
  let mut coordinator_out = std::io::BufReader::new(coordinator.stdout.take().unwrap());
  let mut line = String::new();
  coordinator_out.read_line(&mut line).unwrap();

  let mut participant = Command::new(env!("CARGO_BIN_EXE_plvs"))
    .arg("--coordinator-role-test-host")
    .arg("--identity-root")
    .arg(&root)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .spawn()
    .expect("start participant");
  let participant_stdin = participant.stdin.take().unwrap();
  let mut participant_out = std::io::BufReader::new(participant.stdout.take().unwrap());
  line.clear();
  participant_out.read_line(&mut line).unwrap();
  assert_eq!(
    serde_json::from_str::<serde_json::Value>(&line).unwrap()["isCoordinator"],
    false
  );

  coordinator.kill().unwrap();
  coordinator.wait().unwrap();
  drop(coordinator_stdin);

  let (sender, receiver) = std::sync::mpsc::channel();
  std::thread::spawn(move || {
    let mut promoted = String::new();
    let result = participant_out.read_line(&mut promoted).map(|_| promoted);
    let _ = sender.send(result);
  });
  let promoted = receiver
    .recv_timeout(Duration::from_secs(5))
    .expect("participant should promote while it is still running")
    .unwrap();
  let promoted: serde_json::Value = serde_json::from_str(&promoted).unwrap();
  assert_eq!(promoted["isCoordinator"], true);
  assert_eq!(promoted["generation"], 2);

  drop(participant_stdin);
  participant.wait().unwrap();
  let _ = std::fs::remove_dir_all(root);
}
