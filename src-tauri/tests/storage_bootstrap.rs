use app_lib::persistence::{
  prepare_identity_storage, WorkspaceCatalog, WorkspacePersistenceSession,
};

#[test]
fn fresh_identity_storage_starts_with_one_empty_default_workspace() {
  let app_data =
    std::env::temp_dir().join(format!("plvs-storage-bootstrap-{}", std::process::id()));
  let legacy = app_data.join("plvs-settings.json");

  let prepared = prepare_identity_storage(&app_data, &legacy).expect("prepare fresh storage");
  assert_eq!(prepared.root, app_data.join("multi-instance"));
  assert!(!prepared.migrated_legacy);
  assert_eq!(
    WorkspaceCatalog::open(&prepared.root)
      .unwrap()
      .restore_set()
      .unwrap(),
    vec!["default"]
  );
  let session = WorkspacePersistenceSession::open(&prepared.root, "default").unwrap();
  let hydrated = session.hydrate().unwrap();
  assert_eq!(hydrated.capture_device_id, "default");
  drop(session);

  let reopened = prepare_identity_storage(&app_data, &legacy).unwrap();
  assert_eq!(reopened.root, prepared.root);
  assert!(!reopened.migrated_legacy);
  let _ = std::fs::remove_dir_all(app_data);
}

#[test]
fn simultaneous_first_launches_converge_on_one_complete_store() {
  let app_data = std::env::temp_dir().join(format!(
    "plvs-storage-bootstrap-race-{}",
    std::process::id()
  ));
  let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
  let handles: Vec<_> = (0..8)
    .map(|_| {
      let app_data = app_data.clone();
      let barrier = barrier.clone();
      std::thread::spawn(move || {
        barrier.wait();
        prepare_identity_storage(&app_data, &app_data.join("plvs-settings.json"))
      })
    })
    .collect();

  for handle in handles {
    let prepared = handle.join().unwrap().expect("first launch converges");
    assert_eq!(prepared.root, app_data.join("multi-instance"));
  }
  assert_eq!(
    WorkspaceCatalog::open(&app_data.join("multi-instance"))
      .unwrap()
      .restore_set()
      .unwrap(),
    vec!["default"]
  );
  let _ = std::fs::remove_dir_all(app_data);
}
