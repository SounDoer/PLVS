use std::{
  io::{BufRead, Read, Write},
  process::{Child, Command, Stdio},
};

fn spawn_writer(root: &std::path::Path, item_id: &str) -> Child {
  Command::new(env!("CARGO_BIN_EXE_plvs"))
    .arg("--library-test-host")
    .arg("--identity-root")
    .arg(root)
    .arg("--item-id")
    .arg(item_id)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .expect("start Library writer")
}

fn release_all(mut children: Vec<Child>) -> Vec<serde_json::Value> {
  for child in &mut children {
    child.stdin.take().unwrap().write_all(b"go\n").unwrap();
  }
  children
    .into_iter()
    .map(|mut child| {
      let mut output = String::new();
      std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut output)
        .unwrap();
      let mut error = String::new();
      child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut error)
        .unwrap();
      let status = child.wait().unwrap();
      assert!(status.success(), "Library test host failed: {error}");
      serde_json::from_str(&output).expect("Library test host emits JSON")
    })
    .collect()
}

#[test]
fn separate_processes_commit_independent_items_and_conflict_on_one_id() {
  let root = std::env::temp_dir().join(format!("plvs-library-processes-{}", std::process::id()));
  let independent: Vec<_> = (0..4)
    .map(|index| spawn_writer(&root, &format!("preset-{index}")))
    .collect();
  let independent_results = release_all(independent);
  assert!(independent_results
    .iter()
    .all(|result| result["status"] == "committed"));

  let contenders = vec![spawn_writer(&root, "shared"), spawn_writer(&root, "shared")];
  let results = release_all(contenders);
  assert_eq!(
    results
      .iter()
      .filter(|result| result["status"] == "committed")
      .count(),
    1
  );
  assert_eq!(
    results
      .iter()
      .filter(|result| result["status"] == "conflict")
      .count(),
    1
  );

  let _ = std::fs::remove_dir_all(root);
}
