use app_lib::{
  coordinator::{
    summarize_instances, CaptureStatus, InstanceRegistry, InstanceRuntimeState,
    RuntimeCommandMailbox,
  },
  runtime_identity::RuntimeIdentity,
};
use std::{
  io::BufRead,
  process::{Command, Stdio},
};

#[test]
fn live_workbenches_register_and_unregister_independently() {
  let root = std::env::temp_dir().join(format!("plvs-instance-registry-{}", std::process::id()));
  let registry = InstanceRegistry::open(&root).expect("open instance registry");
  let default_identity = RuntimeIdentity::new_default().unwrap();
  let spotify_identity = RuntimeIdentity::new_for_workspace("workspace-spotify").unwrap();

  let default_registration = registry
    .register(
      &default_identity,
      &InstanceRuntimeState {
        source_label: None,
        capture_status: CaptureStatus::Stopped,
        visible: true,
        focus_sequence: 1,
      },
    )
    .expect("register default workbench");
  let spotify_registration = registry
    .register(
      &spotify_identity,
      &InstanceRuntimeState {
        source_label: Some("Spotify".to_string()),
        capture_status: CaptureStatus::Running,
        visible: false,
        focus_sequence: 2,
      },
    )
    .expect("register Spotify workbench");

  let instances = registry.list().expect("list live workbenches");
  assert_eq!(instances.len(), 2);
  let spotify = instances
    .iter()
    .find(|instance| instance.workspace_id == "workspace-spotify")
    .expect("Spotify workbench is discoverable");
  assert_eq!(spotify.source_label.as_deref(), Some("Spotify"));
  assert_eq!(spotify.capture_status, CaptureStatus::Running);
  assert!(!spotify.visible);

  drop(default_registration);
  let remaining = registry.list().expect("list remaining workbenches");
  assert_eq!(remaining.len(), 1);
  assert_eq!(remaining[0].instance_id, spotify_identity.instance_id());

  drop(spotify_registration);
  assert!(registry.list().unwrap().is_empty());
  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn source_names_are_disambiguated_without_creating_user_managed_names() {
  let root = std::env::temp_dir().join(format!(
    "plvs-instance-registry-names-{}",
    std::process::id()
  ));
  let registry = InstanceRegistry::open(&root).unwrap();
  let first_spotify = RuntimeIdentity::new_for_workspace("workspace-a").unwrap();
  let vlc = RuntimeIdentity::new_for_workspace("workspace-b").unwrap();
  let second_spotify = RuntimeIdentity::new_for_workspace("workspace-c").unwrap();
  let unnamed = RuntimeIdentity::new_for_workspace("workspace-d").unwrap();

  let mut registrations = Vec::new();
  for (identity, label) in [
    (&first_spotify, Some("Spotify")),
    (&vlc, Some("VLC")),
    (&second_spotify, Some("Spotify")),
    (&unnamed, None),
  ] {
    registrations.push(
      registry
        .register(
          identity,
          &InstanceRuntimeState {
            source_label: label.map(str::to_string),
            capture_status: CaptureStatus::Stopped,
            visible: true,
            focus_sequence: 0,
          },
        )
        .unwrap(),
    );
  }

  let summaries = summarize_instances(registry.list().unwrap());
  let display_name = |workspace_id: &str| {
    summaries
      .iter()
      .find(|summary| summary.workspace_id == workspace_id)
      .unwrap()
      .display_name
      .as_str()
  };
  assert_eq!(display_name("workspace-a"), "Spotify");
  assert_eq!(display_name("workspace-c"), "Spotify (2)");
  assert_eq!(display_name("workspace-b"), "VLC");
  assert_eq!(display_name("workspace-d"), "Choose Source");

  drop(registrations);
  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn an_instance_can_publish_source_capture_visibility_and_focus_changes() {
  let root = std::env::temp_dir().join(format!(
    "plvs-instance-registry-update-{}",
    std::process::id()
  ));
  let registry = InstanceRegistry::open(&root).unwrap();
  let identity = RuntimeIdentity::new_default().unwrap();
  let registration = registry
    .register(
      &identity,
      &InstanceRuntimeState {
        source_label: None,
        capture_status: CaptureStatus::Stopped,
        visible: true,
        focus_sequence: 0,
      },
    )
    .unwrap();

  registration
    .publish(&InstanceRuntimeState {
      source_label: Some("VLC".to_string()),
      capture_status: CaptureStatus::Running,
      visible: false,
      focus_sequence: 27,
    })
    .expect("publish changed runtime state");

  let current = registry.list().unwrap().pop().expect("registered instance");
  assert_eq!(current.source_label.as_deref(), Some("VLC"));
  assert_eq!(current.capture_status, CaptureStatus::Running);
  assert!(!current.visible);
  assert_eq!(current.focus_sequence, 27);

  drop(registration);
  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn stale_cleanup_rejects_pid_reuse_by_checking_process_start_identity() {
  let root = std::env::temp_dir().join(format!(
    "plvs-instance-registry-stale-{}",
    std::process::id()
  ));
  let registry = InstanceRegistry::open(&root).unwrap();
  let identity = RuntimeIdentity::new_default().unwrap();
  let registration = registry
    .register(
      &identity,
      &InstanceRuntimeState {
        source_label: Some("Spotify".to_string()),
        capture_status: CaptureStatus::Running,
        visible: true,
        focus_sequence: 1,
      },
    )
    .unwrap();

  let descriptor_path = root
    .join("runtime")
    .join("instances")
    .join(format!("{}.json", identity.instance_id()));
  let mut descriptor: serde_json::Value =
    serde_json::from_slice(&std::fs::read(&descriptor_path).unwrap()).unwrap();
  descriptor["processStartIdentity"] = serde_json::json!(0);
  std::fs::write(
    &descriptor_path,
    serde_json::to_vec_pretty(&descriptor).unwrap(),
  )
  .unwrap();

  let removed = registry.remove_stale().expect("remove stale registration");
  assert_eq!(removed, vec![identity.instance_id().to_string()]);
  assert!(registry.list().unwrap().is_empty());

  drop(registration);
  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn crashed_process_registration_is_removed_from_the_live_registry() {
  let root = std::env::temp_dir().join(format!(
    "plvs-instance-registry-crash-{}",
    std::process::id()
  ));
  let registry = InstanceRegistry::open(&root).unwrap();
  let mut child = Command::new(env!("CARGO_BIN_EXE_plvs"))
    .arg("--instance-registry-test-host")
    .arg("--identity-root")
    .arg(&root)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .expect("start registered test process");
  let held_stdin = child.stdin.take().unwrap();
  let mut ready_line = String::new();
  std::io::BufReader::new(child.stdout.take().unwrap())
    .read_line(&mut ready_line)
    .expect("read registration readiness");
  let ready: serde_json::Value = serde_json::from_str(&ready_line).expect("readiness is JSON");
  let instance_id = ready["instanceId"].as_str().unwrap().to_string();
  assert_eq!(registry.list().unwrap().len(), 1);
  let mailbox = RuntimeCommandMailbox::open(&root).unwrap();
  mailbox.issue(&instance_id, "show-a", "show").unwrap();

  child.kill().expect("crash registered process");
  child.wait().expect("reap registered process");
  drop(held_stdin);
  assert_eq!(registry.remove_stale().unwrap(), vec![instance_id]);
  assert!(registry.list().unwrap().is_empty());
  assert!(mailbox
    .poll(ready["instanceId"].as_str().unwrap())
    .unwrap()
    .is_none());

  let _ = std::fs::remove_dir_all(root);
}
