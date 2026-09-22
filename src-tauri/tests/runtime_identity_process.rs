use std::process::{Command, Stdio};

use serde_json::Value;

fn diagnostics(root: &std::path::Path) -> Value {
  let output = Command::new(env!("CARGO_BIN_EXE_plvs"))
    .arg("--runtime-diagnostics")
    .arg("--test-identity-root")
    .arg(root)
    .stdin(Stdio::null())
    .output()
    .expect("runtime diagnostics process starts");

  assert!(
    output.status.success(),
    "runtime diagnostics failed: {}",
    String::from_utf8_lossy(&output.stderr)
  );
  serde_json::from_slice(&output.stdout).expect("runtime diagnostics are JSON")
}

#[test]
fn two_processes_share_only_the_isolated_identity_root() {
  let root = std::env::temp_dir().join(format!(
    "plvs-runtime-identity-process-{}",
    std::process::id()
  ));

  let first = diagnostics(&root);
  let second = diagnostics(&root);

  assert_ne!(first["instanceId"], second["instanceId"]);
  assert_eq!(first["workspaceId"], "default");
  assert_eq!(second["workspaceId"], "default");
  assert_eq!(first["configDir"], second["configDir"]);
  assert_eq!(first["dataDir"], second["dataDir"]);
  assert!(
    std::path::Path::new(first["configDir"].as_str().expect("config directory")).starts_with(&root)
  );
  assert!(
    std::path::Path::new(first["dataDir"].as_str().expect("data directory")).starts_with(&root)
  );

  let _ = std::fs::remove_dir_all(root);
}
