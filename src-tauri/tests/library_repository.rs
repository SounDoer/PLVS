use app_lib::persistence::LibraryRepository;
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
