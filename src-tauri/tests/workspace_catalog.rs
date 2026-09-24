use app_lib::persistence::{WorkspaceCatalog, WorkspaceStore};

fn temp_root() -> std::path::PathBuf {
  std::env::temp_dir().join(format!("plvs-workspace-catalog-{}", std::process::id()))
}

#[test]
fn first_launch_restores_default_and_additional_launches_allocate_stopped_workbenches() {
  let root = temp_root();
  let catalog = WorkspaceCatalog::open(&root).expect("open workspace catalog");
  assert_eq!(catalog.restore_set().unwrap(), vec!["default"]);

  let first = catalog
    .allocate_blank_workbench()
    .expect("allocate first additional workbench");
  let second = catalog
    .allocate_blank_workbench()
    .expect("allocate second additional workbench");
  assert_ne!(first, second);
  assert!(first.starts_with("workspace-"));

  let restored = WorkspaceCatalog::open(&root)
    .unwrap()
    .restore_set()
    .unwrap();
  assert_eq!(restored, vec!["default", first.as_str(), second.as_str()]);
  for workspace_id in [&first, &second] {
    let state = WorkspaceStore::open(&root, workspace_id)
      .unwrap()
      .load()
      .unwrap()
      .expect("blank workbench state");
    assert_eq!(state["captureDeviceId"], "default");
    assert_eq!(state["captureStatus"], "stopped");
  }

  catalog
    .remove_from_restore_set(&first)
    .expect("quit one additional workbench");
  assert_eq!(
    catalog.restore_set().unwrap(),
    vec!["default", second.as_str()]
  );
  catalog
    .remove_from_restore_set("default")
    .expect("default remains a compatibility anchor");
  assert_eq!(
    catalog.restore_set().unwrap(),
    vec!["default", second.as_str()]
  );

  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn simultaneous_secondary_launches_receive_distinct_workspaces() {
  let root = temp_root().with_extension("concurrent");
  let catalog = WorkspaceCatalog::open(&root).unwrap();
  let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
  let handles: Vec<_> = (0..8)
    .map(|_| {
      let catalog = catalog.clone();
      let barrier = barrier.clone();
      std::thread::spawn(move || {
        barrier.wait();
        catalog.allocate_blank_workbench().unwrap()
      })
    })
    .collect();
  let mut allocated: Vec<_> = handles
    .into_iter()
    .map(|handle| handle.join().unwrap())
    .collect();
  allocated.sort();
  allocated.dedup();

  assert_eq!(allocated.len(), 8);
  assert_eq!(catalog.restore_set().unwrap().len(), 9);
  let _ = std::fs::remove_dir_all(root);
}
