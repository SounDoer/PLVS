use std::collections::BTreeMap;

use app_lib::persistence::{LibraryError, LibraryRepository};
use serde_json::json;

fn temp_root() -> std::path::PathBuf {
  std::env::temp_dir().join(format!(
    "plvs-library-repository-{}-{}",
    std::process::id(),
    std::thread::current().name().unwrap_or("test")
  ))
}

#[test]
fn a_committed_library_item_is_visible_after_reopening_the_repository() {
  let root = temp_root();
  let repository = LibraryRepository::open(&root).expect("open library repository");
  let document = json!({ "id": "broadcast", "name": "Broadcast", "layout": {} });

  let committed = repository
    .create("preset", "broadcast", &document)
    .expect("create preset");
  assert_eq!(committed.revision, 1);

  drop(repository);
  let reopened = LibraryRepository::open(&root).expect("reopen library repository");
  let stored = reopened
    .read("preset", "broadcast")
    .expect("read preset")
    .expect("preset exists");
  assert_eq!(stored.revision, 1);
  assert_eq!(stored.document, document);

  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_first_editor_wins_when_two_edits_share_one_base_revision() {
  let root = temp_root().with_extension("conflict");
  let first = LibraryRepository::open(&root).expect("open first repository");
  let second = LibraryRepository::open(&root).expect("open second repository");
  first
    .create(
      "theme",
      "studio",
      &json!({ "id": "studio", "name": "Studio", "accent": "blue" }),
    )
    .expect("create theme");

  let first_commit = first
    .update(
      "theme",
      "studio",
      1,
      &json!({ "id": "studio", "name": "Studio", "accent": "green" }),
    )
    .expect("first edit commits");
  assert_eq!(first_commit.revision, 2);

  let conflict = second
    .update(
      "theme",
      "studio",
      1,
      &json!({ "id": "studio", "name": "Studio", "accent": "red" }),
    )
    .expect_err("stale edit must not overwrite the committed edit");
  assert!(conflict.to_string().contains("revision 2"));

  let stored = second
    .read("theme", "studio")
    .expect("read theme")
    .expect("theme exists");
  assert_eq!(stored.document["accent"], "green");

  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn every_committed_change_advances_the_library_collection_revision() {
  let root = temp_root().with_extension("collection-revision");
  let repository = LibraryRepository::open(&root).expect("open repository");
  assert_eq!(repository.collection_revision("profile").unwrap(), 0);

  repository
    .create(
      "profile",
      "streaming",
      &json!({ "id": "streaming", "name": "Streaming" }),
    )
    .expect("create profile");
  assert_eq!(repository.collection_revision("profile").unwrap(), 1);

  repository
    .update(
      "profile",
      "streaming",
      1,
      &json!({ "id": "streaming", "name": "Streaming Platform" }),
    )
    .expect("update profile");
  assert_eq!(repository.collection_revision("profile").unwrap(), 2);

  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn library_items_are_listed_in_the_order_the_user_created_them() {
  let root = temp_root().with_extension("order");
  let repository = LibraryRepository::open(&root).expect("open repository");
  repository
    .create("preset", "dialogue", &json!({ "id": "dialogue" }))
    .expect("create first preset");
  repository
    .create("preset", "music", &json!({ "id": "music" }))
    .expect("create second preset");

  let ids: Vec<String> = repository
    .list("preset")
    .expect("list presets")
    .into_iter()
    .map(|item| item.id)
    .collect();
  assert_eq!(ids, ["dialogue", "music"]);

  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn reordering_requires_the_current_collection_revision() {
  let root = temp_root().with_extension("reorder-conflict");
  let first = LibraryRepository::open(&root).expect("open first repository");
  let second = LibraryRepository::open(&root).expect("open second repository");
  first
    .create("theme", "dark", &json!({ "id": "dark" }))
    .expect("create dark theme");
  first
    .create("theme", "light", &json!({ "id": "light" }))
    .expect("create light theme");

  assert_eq!(first.reorder("theme", &["light", "dark"], 2).unwrap(), 3);
  let conflict = second
    .reorder("theme", &["dark", "light"], 2)
    .expect_err("stale order must not overwrite the committed order");
  assert!(conflict.to_string().contains("revision 3"));

  let ids: Vec<String> = second
    .list("theme")
    .unwrap()
    .into_iter()
    .map(|item| item.id)
    .collect();
  assert_eq!(ids, ["light", "dark"]);

  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn global_preferences_use_the_same_compare_and_swap_rule() {
  let root = temp_root().with_extension("global-preference");
  let first = LibraryRepository::open(&root).expect("open first repository");
  let second = LibraryRepository::open(&root).expect("open second repository");

  assert!(first
    .read_global_preference("clearGlobal")
    .unwrap()
    .is_none());
  let created = first
    .set_global_preference("clearGlobal", 0, &json!(true))
    .expect("create global preference");
  assert_eq!(created.revision, 1);
  assert_eq!(created.value, true);

  let conflict = second
    .set_global_preference("clearGlobal", 0, &json!(false))
    .expect_err("stale preference write must be refused");
  assert!(conflict.to_string().contains("revision 1"));

  let updated = second
    .set_global_preference("clearGlobal", 1, &json!(false))
    .expect("current preference write commits");
  assert_eq!(updated.revision, 2);
  assert_eq!(updated.value, false);

  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn related_global_preferences_commit_atomically() {
  let root = temp_root().with_extension("global-preference-batch");
  let library = LibraryRepository::open(&root).unwrap();
  let initial = BTreeMap::from([
    ("clearShortcut".to_string(), json!("CmdOrCtrl+K")),
    ("clearGlobal".to_string(), json!(false)),
  ]);
  let created = library
    .set_global_preferences(
      &BTreeMap::from([
        ("clearShortcut".to_string(), 0),
        ("clearGlobal".to_string(), 0),
      ]),
      &initial,
    )
    .unwrap();
  assert_eq!(created["clearShortcut"].revision, 1);
  assert_eq!(created["clearGlobal"].revision, 1);

  let conflict = library
    .set_global_preferences(
      &BTreeMap::from([
        ("clearShortcut".to_string(), 1),
        ("clearGlobal".to_string(), 0),
      ]),
      &BTreeMap::from([
        ("clearShortcut".to_string(), json!("CmdOrCtrl+L")),
        ("clearGlobal".to_string(), json!(true)),
      ]),
    )
    .expect_err("one stale member rejects the whole preference group");
  assert!(matches!(conflict, LibraryError::Conflict(_)));
  assert_eq!(
    library
      .read_global_preference("clearShortcut")
      .unwrap()
      .unwrap()
      .value,
    "CmdOrCtrl+K"
  );
  assert_eq!(
    library
      .read_global_preference("clearGlobal")
      .unwrap()
      .unwrap()
      .value,
    false
  );

  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn deleting_an_item_requires_its_revision_and_advances_the_collection() {
  let root = temp_root().with_extension("delete");
  let library = LibraryRepository::open(&root).unwrap();
  library
    .create("preset", "one", &json!({ "id": "one" }))
    .unwrap();
  library
    .create("preset", "two", &json!({ "id": "two" }))
    .unwrap();
  let before = library.collection_revision("preset").unwrap();

  let conflict = library
    .delete("preset", "one", 2)
    .expect_err("stale or invented item revision is refused");
  assert!(matches!(conflict, LibraryError::Conflict(_)));
  let after = library.delete("preset", "one", 1).unwrap();

  assert_eq!(after, before + 1);
  assert!(library.read("preset", "one").unwrap().is_none());
  assert_eq!(library.list("preset").unwrap()[0].id, "two");
  let _ = std::fs::remove_dir_all(root);
}

#[test]
fn replacing_a_collection_is_atomic_and_requires_its_base_revision() {
  let root = temp_root().with_extension("replace-collection");
  let library = LibraryRepository::open(&root).unwrap();
  library
    .create("preset", "one", &json!({ "id": "one", "name": "Old" }))
    .unwrap();
  library
    .create("preset", "two", &json!({ "id": "two", "name": "Two" }))
    .unwrap();
  let base = library.collection_revision("preset").unwrap();
  let expected = std::collections::BTreeMap::from([("one".to_string(), 1), ("two".to_string(), 1)]);
  let replacement = vec![
    json!({ "id": "three", "name": "Three" }),
    json!({ "id": "one", "name": "New" }),
  ];

  library
    .create("preset", "peer", &json!({ "id": "peer", "name": "Peer" }))
    .unwrap();
  let conflict = library
    .replace_collection("preset", &replacement, base, &expected)
    .expect_err("stale whole-collection replacement is refused");
  assert!(matches!(conflict, LibraryError::Conflict(_)));
  assert_eq!(library.list("preset").unwrap().len(), 3);

  let current_revision = library.collection_revision("preset").unwrap();
  let current_expected = std::collections::BTreeMap::from([
    ("one".to_string(), 1),
    ("two".to_string(), 1),
    ("peer".to_string(), 1),
  ]);
  let committed = library
    .replace_collection("preset", &replacement, current_revision, &current_expected)
    .unwrap();

  assert_eq!(committed.collection_revision, current_revision + 1);
  assert_eq!(committed.items[0].id, "three");
  assert_eq!(committed.items[0].revision, 1);
  assert_eq!(committed.items[1].id, "one");
  assert_eq!(committed.items[1].revision, 2);
  assert!(library.read("preset", "two").unwrap().is_none());
  assert!(library.read("preset", "peer").unwrap().is_none());
  let _ = std::fs::remove_dir_all(root);
}
