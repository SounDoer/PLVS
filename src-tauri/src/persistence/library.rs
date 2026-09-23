use std::{
  collections::{BTreeMap, HashSet},
  fs,
  path::{Path, PathBuf},
  time::{Duration, Instant},
};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const DATABASE_SCHEMA_VERSION: i64 = 1;
const BUSY_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
  pub kind: String,
  pub id: String,
  pub revision: i64,
  pub document: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalPreference {
  pub key: String,
  pub revision: i64,
  pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCollection {
  pub collection_revision: i64,
  pub items: Vec<LibraryItem>,
}

#[derive(Debug)]
pub enum LibraryError {
  Conflict(String),
  Storage(String),
}

impl std::fmt::Display for LibraryError {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::Conflict(message) | Self::Storage(message) => formatter.write_str(message),
    }
  }
}

impl std::error::Error for LibraryError {}

#[derive(Debug, Clone)]
pub struct LibraryRepository {
  database_path: PathBuf,
}

impl LibraryRepository {
  pub fn open(identity_root: &Path) -> Result<Self, LibraryError> {
    let shared_dir = identity_root.join("shared");
    fs::create_dir_all(&shared_dir).map_err(|error| {
      LibraryError::Storage(format!(
        "Unable to create shared Library directory: {error}"
      ))
    })?;
    let repository = Self {
      database_path: shared_dir.join("library.sqlite3"),
    };
    let connection = repository.connection()?;
    initialize_schema(&connection)?;
    enable_wal(&connection)?;
    Ok(repository)
  }

  pub fn create(
    &self,
    kind: &str,
    id: &str,
    document: &Value,
  ) -> Result<LibraryItem, LibraryError> {
    validate_key(kind, "Library kind")?;
    validate_key(id, "Library item ID")?;
    let document_json = serde_json::to_string(document).map_err(|error| {
      LibraryError::Storage(format!("Unable to serialize Library item: {error}"))
    })?;
    let content_hash = content_hash(&document_json);
    let mut connection = self.connection()?;
    let transaction = connection
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(map_sqlite_error)?;
    let inserted = transaction.execute(
      "INSERT OR IGNORE INTO library_items
         (kind, item_id, revision, document_json, content_hash)
       VALUES (?1, ?2, 1, ?3, ?4)",
      params![kind, id, document_json, content_hash],
    )?;
    if inserted == 0 {
      return Err(LibraryError::Conflict(format!(
        "A {kind} Library item with ID {id} already exists."
      )));
    }
    transaction.execute(
      "INSERT INTO library_order (kind, item_id, position)
       SELECT ?1, ?2, COALESCE(MAX(position) + 1, 0)
       FROM library_order
       WHERE kind = ?1",
      params![kind, id],
    )?;
    transaction.execute(
      "INSERT INTO library_collections (kind, revision)
       VALUES (?1, 1)
       ON CONFLICT(kind) DO UPDATE SET revision = revision + 1",
      [kind],
    )?;
    transaction.commit().map_err(map_sqlite_error)?;

    Ok(LibraryItem {
      kind: kind.to_string(),
      id: id.to_string(),
      revision: 1,
      document: document.clone(),
    })
  }

  pub fn update(
    &self,
    kind: &str,
    id: &str,
    expected_revision: i64,
    document: &Value,
  ) -> Result<LibraryItem, LibraryError> {
    validate_key(kind, "Library kind")?;
    validate_key(id, "Library item ID")?;
    if expected_revision < 1 {
      return Err(LibraryError::Conflict(
        "Expected Library item revision must be positive.".to_string(),
      ));
    }
    let document_json = serde_json::to_string(document).map_err(|error| {
      LibraryError::Storage(format!("Unable to serialize Library item: {error}"))
    })?;
    let content_hash = content_hash(&document_json);
    let mut connection = self.connection()?;
    let transaction = connection
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(map_sqlite_error)?;
    let updated = transaction.execute(
      "UPDATE library_items
       SET revision = revision + 1, document_json = ?4, content_hash = ?5
       WHERE kind = ?1 AND item_id = ?2 AND revision = ?3",
      params![kind, id, expected_revision, document_json, content_hash],
    )?;
    if updated == 0 {
      let current_revision = transaction
        .query_row(
          "SELECT revision FROM library_items WHERE kind = ?1 AND item_id = ?2",
          params![kind, id],
          |row| row.get::<_, i64>(0),
        )
        .optional()?;
      return Err(match current_revision {
        Some(revision) => LibraryError::Conflict(format!(
          "Library item changed from expected revision {expected_revision} to revision {revision}."
        )),
        None => LibraryError::Conflict(format!(
          "The {kind} Library item with ID {id} no longer exists."
        )),
      });
    }
    transaction.execute(
      "INSERT INTO library_collections (kind, revision)
       VALUES (?1, 1)
       ON CONFLICT(kind) DO UPDATE SET revision = revision + 1",
      [kind],
    )?;
    transaction.commit().map_err(map_sqlite_error)?;

    Ok(LibraryItem {
      kind: kind.to_string(),
      id: id.to_string(),
      revision: expected_revision + 1,
      document: document.clone(),
    })
  }

  pub fn read(&self, kind: &str, id: &str) -> Result<Option<LibraryItem>, LibraryError> {
    validate_key(kind, "Library kind")?;
    validate_key(id, "Library item ID")?;
    let connection = self.connection()?;
    let stored = connection
      .query_row(
        "SELECT revision, document_json
         FROM library_items
         WHERE kind = ?1 AND item_id = ?2",
        params![kind, id],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
      )
      .optional()
      .map_err(map_sqlite_error)?;
    let Some((revision, document_json)) = stored else {
      return Ok(None);
    };
    let document = serde_json::from_str(&document_json).map_err(|error| {
      LibraryError::Storage(format!("Unable to parse stored Library item: {error}"))
    })?;
    Ok(Some(LibraryItem {
      kind: kind.to_string(),
      id: id.to_string(),
      revision,
      document,
    }))
  }

  pub fn delete(&self, kind: &str, id: &str, expected_revision: i64) -> Result<i64, LibraryError> {
    validate_key(kind, "Library kind")?;
    validate_key(id, "Library item ID")?;
    if expected_revision < 1 {
      return Err(LibraryError::Conflict(
        "Expected Library item revision must be positive.".to_string(),
      ));
    }
    let mut connection = self.connection()?;
    let transaction = connection
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(map_sqlite_error)?;
    let deleted = transaction.execute(
      "DELETE FROM library_items
       WHERE kind = ?1 AND item_id = ?2 AND revision = ?3",
      params![kind, id, expected_revision],
    )?;
    if deleted == 0 {
      let current_revision = transaction
        .query_row(
          "SELECT revision FROM library_items WHERE kind = ?1 AND item_id = ?2",
          params![kind, id],
          |row| row.get::<_, i64>(0),
        )
        .optional()?;
      return Err(match current_revision {
        Some(revision) => LibraryError::Conflict(format!(
          "Library item changed from expected revision {expected_revision} to revision {revision}."
        )),
        None => LibraryError::Conflict(format!(
          "The {kind} Library item with ID {id} no longer exists."
        )),
      });
    }
    let current_collection_revision = transaction
      .query_row(
        "SELECT revision FROM library_collections WHERE kind = ?1",
        [kind],
        |row| row.get::<_, i64>(0),
      )
      .optional()?
      .unwrap_or(0);
    transaction.execute(
      "INSERT INTO library_collections (kind, revision)
       VALUES (?1, 1)
       ON CONFLICT(kind) DO UPDATE SET revision = revision + 1",
      [kind],
    )?;
    transaction.commit().map_err(map_sqlite_error)?;
    Ok(current_collection_revision + 1)
  }

  pub fn collection_revision(&self, kind: &str) -> Result<i64, LibraryError> {
    validate_key(kind, "Library kind")?;
    let connection = self.connection()?;
    connection
      .query_row(
        "SELECT revision FROM library_collections WHERE kind = ?1",
        [kind],
        |row| row.get(0),
      )
      .optional()
      .map(|revision| revision.unwrap_or(0))
      .map_err(map_sqlite_error)
  }

  pub fn list(&self, kind: &str) -> Result<Vec<LibraryItem>, LibraryError> {
    validate_key(kind, "Library kind")?;
    let connection = self.connection()?;
    let mut statement = connection
      .prepare(
        "SELECT items.item_id, items.revision, items.document_json
         FROM library_order AS ordering
         JOIN library_items AS items
           ON items.kind = ordering.kind AND items.item_id = ordering.item_id
         WHERE ordering.kind = ?1
         ORDER BY ordering.position ASC, ordering.item_id ASC",
      )
      .map_err(map_sqlite_error)?;
    let rows = statement
      .query_map([kind], |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, i64>(1)?,
          row.get::<_, String>(2)?,
        ))
      })
      .map_err(map_sqlite_error)?;
    let mut items = Vec::new();
    for row in rows {
      let (id, revision, document_json) = row.map_err(map_sqlite_error)?;
      let document = serde_json::from_str(&document_json).map_err(|error| {
        LibraryError::Storage(format!("Unable to parse stored Library item: {error}"))
      })?;
      items.push(LibraryItem {
        kind: kind.to_string(),
        id,
        revision,
        document,
      });
    }
    Ok(items)
  }

  pub fn reorder(
    &self,
    kind: &str,
    ordered_ids: &[&str],
    expected_collection_revision: i64,
  ) -> Result<i64, LibraryError> {
    validate_key(kind, "Library kind")?;
    let mut requested = HashSet::new();
    for id in ordered_ids {
      validate_key(id, "Library item ID")?;
      if !requested.insert(*id) {
        return Err(LibraryError::Conflict(
          "Library order contains a duplicate item ID.".to_string(),
        ));
      }
    }

    let mut connection = self.connection()?;
    let transaction = connection
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(map_sqlite_error)?;
    let current_revision = transaction
      .query_row(
        "SELECT revision FROM library_collections WHERE kind = ?1",
        [kind],
        |row| row.get::<_, i64>(0),
      )
      .optional()?
      .unwrap_or(0);
    if current_revision != expected_collection_revision {
      return Err(LibraryError::Conflict(format!(
        "Library collection changed from expected revision {expected_collection_revision} to revision {current_revision}."
      )));
    }

    let current_ids = {
      let mut statement = transaction
        .prepare("SELECT item_id FROM library_items WHERE kind = ?1 ORDER BY item_id ASC")?;
      let ids = statement
        .query_map([kind], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
      ids
    };
    if current_ids.len() != requested.len()
      || current_ids
        .iter()
        .any(|id| !requested.contains(id.as_str()))
    {
      return Err(LibraryError::Conflict(
        "Library order must contain every item exactly once.".to_string(),
      ));
    }

    transaction.execute("DELETE FROM library_order WHERE kind = ?1", [kind])?;
    for (position, id) in ordered_ids.iter().enumerate() {
      transaction.execute(
        "INSERT INTO library_order (kind, item_id, position) VALUES (?1, ?2, ?3)",
        params![kind, id, position as i64],
      )?;
    }
    let advanced = transaction.execute(
      "UPDATE library_collections
       SET revision = revision + 1
       WHERE kind = ?1 AND revision = ?2",
      params![kind, expected_collection_revision],
    )?;
    if advanced != 1 {
      return Err(LibraryError::Conflict(
        "Library collection changed while reordering.".to_string(),
      ));
    }
    transaction.commit().map_err(map_sqlite_error)?;
    Ok(expected_collection_revision + 1)
  }

  pub fn replace_collection(
    &self,
    kind: &str,
    documents: &[Value],
    expected_collection_revision: i64,
    expected_item_revisions: &BTreeMap<String, i64>,
  ) -> Result<LibraryCollection, LibraryError> {
    validate_key(kind, "Library kind")?;
    if expected_collection_revision < 0 {
      return Err(LibraryError::Conflict(
        "Expected Library collection revision cannot be negative.".to_string(),
      ));
    }
    let mut desired = Vec::with_capacity(documents.len());
    let mut desired_ids = HashSet::new();
    for document in documents {
      let id = document
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| LibraryError::Storage("Library item has no ID.".to_string()))?;
      validate_key(id, "Library item ID")?;
      if !desired_ids.insert(id.to_string()) {
        return Err(LibraryError::Conflict(
          "Library replacement contains a duplicate item ID.".to_string(),
        ));
      }
      let document_json = serde_json::to_string(document).map_err(|error| {
        LibraryError::Storage(format!("Unable to serialize Library item: {error}"))
      })?;
      desired.push((
        id.to_string(),
        document.clone(),
        content_hash(&document_json),
        document_json,
      ));
    }

    let mut connection = self.connection()?;
    let transaction = connection
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(map_sqlite_error)?;
    let current_collection_revision = transaction
      .query_row(
        "SELECT revision FROM library_collections WHERE kind = ?1",
        [kind],
        |row| row.get::<_, i64>(0),
      )
      .optional()?
      .unwrap_or(0);
    if current_collection_revision != expected_collection_revision {
      return Err(LibraryError::Conflict(format!(
        "Library collection changed from expected revision {expected_collection_revision} to revision {current_collection_revision}."
      )));
    }
    let current: BTreeMap<String, (i64, String)> = {
      let mut statement = transaction
        .prepare("SELECT item_id, revision, content_hash FROM library_items WHERE kind = ?1")?;
      let current = statement
        .query_map([kind], |row| {
          Ok((
            row.get::<_, String>(0)?,
            (row.get::<_, i64>(1)?, row.get::<_, String>(2)?),
          ))
        })?
        .collect::<Result<_, _>>()?;
      current
    };
    let current_revisions: BTreeMap<String, i64> = current
      .iter()
      .map(|(id, (revision, _))| (id.clone(), *revision))
      .collect();
    if &current_revisions != expected_item_revisions {
      return Err(LibraryError::Conflict(
        "One or more Library items changed after this collection was read.".to_string(),
      ));
    }

    transaction.execute("DELETE FROM library_order WHERE kind = ?1", [kind])?;
    for id in current.keys().filter(|id| !desired_ids.contains(*id)) {
      transaction.execute(
        "DELETE FROM library_items WHERE kind = ?1 AND item_id = ?2",
        params![kind, id],
      )?;
    }

    let mut committed_items = Vec::with_capacity(desired.len());
    for (position, (id, document, hash, document_json)) in desired.into_iter().enumerate() {
      let revision = match current.get(&id) {
        Some((revision, current_hash)) if current_hash == &hash => *revision,
        Some((revision, _)) => {
          transaction.execute(
            "UPDATE library_items
             SET revision = revision + 1, document_json = ?3, content_hash = ?4
             WHERE kind = ?1 AND item_id = ?2",
            params![kind, id, document_json, hash],
          )?;
          revision + 1
        }
        None => {
          transaction.execute(
            "INSERT INTO library_items (kind, item_id, revision, document_json, content_hash)
             VALUES (?1, ?2, 1, ?3, ?4)",
            params![kind, id, document_json, hash],
          )?;
          1
        }
      };
      transaction.execute(
        "INSERT INTO library_order (kind, item_id, position) VALUES (?1, ?2, ?3)",
        params![kind, id, position as i64],
      )?;
      committed_items.push(LibraryItem {
        kind: kind.to_string(),
        id,
        revision,
        document,
      });
    }
    let committed_collection_revision = expected_collection_revision + 1;
    transaction.execute(
      "INSERT INTO library_collections (kind, revision) VALUES (?1, ?2)
       ON CONFLICT(kind) DO UPDATE SET revision = excluded.revision",
      params![kind, committed_collection_revision],
    )?;
    transaction.commit().map_err(map_sqlite_error)?;
    Ok(LibraryCollection {
      collection_revision: committed_collection_revision,
      items: committed_items,
    })
  }

  pub fn read_global_preference(
    &self,
    key: &str,
  ) -> Result<Option<GlobalPreference>, LibraryError> {
    validate_key(key, "Global preference key")?;
    let connection = self.connection()?;
    let stored = connection
      .query_row(
        "SELECT revision, value_json FROM global_preferences WHERE preference_key = ?1",
        [key],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
      )
      .optional()
      .map_err(map_sqlite_error)?;
    let Some((revision, value_json)) = stored else {
      return Ok(None);
    };
    let value = serde_json::from_str(&value_json).map_err(|error| {
      LibraryError::Storage(format!("Unable to parse stored global preference: {error}"))
    })?;
    Ok(Some(GlobalPreference {
      key: key.to_string(),
      revision,
      value,
    }))
  }

  pub fn set_global_preference(
    &self,
    key: &str,
    expected_revision: i64,
    value: &Value,
  ) -> Result<GlobalPreference, LibraryError> {
    validate_key(key, "Global preference key")?;
    if expected_revision < 0 {
      return Err(LibraryError::Conflict(
        "Expected global preference revision cannot be negative.".to_string(),
      ));
    }
    let value_json = serde_json::to_string(value).map_err(|error| {
      LibraryError::Storage(format!("Unable to serialize global preference: {error}"))
    })?;
    let mut connection = self.connection()?;
    let transaction = connection
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(map_sqlite_error)?;
    let changed = if expected_revision == 0 {
      transaction.execute(
        "INSERT OR IGNORE INTO global_preferences (preference_key, revision, value_json)
         VALUES (?1, 1, ?2)",
        params![key, value_json],
      )?
    } else {
      transaction.execute(
        "UPDATE global_preferences
         SET revision = revision + 1, value_json = ?3
         WHERE preference_key = ?1 AND revision = ?2",
        params![key, expected_revision, value_json],
      )?
    };
    if changed == 0 {
      let current_revision = transaction
        .query_row(
          "SELECT revision FROM global_preferences WHERE preference_key = ?1",
          [key],
          |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
      return Err(LibraryError::Conflict(format!(
        "Global preference changed from expected revision {expected_revision} to revision {current_revision}."
      )));
    }
    transaction.commit().map_err(map_sqlite_error)?;
    Ok(GlobalPreference {
      key: key.to_string(),
      revision: expected_revision + 1,
      value: value.clone(),
    })
  }

  pub fn set_global_preferences(
    &self,
    expected_revisions: &BTreeMap<String, i64>,
    values: &BTreeMap<String, Value>,
  ) -> Result<BTreeMap<String, GlobalPreference>, LibraryError> {
    if expected_revisions.len() != values.len()
      || values
        .keys()
        .any(|key| !expected_revisions.contains_key(key))
    {
      return Err(LibraryError::Conflict(
        "Global preference values and expected revisions must name the same keys.".to_string(),
      ));
    }
    let mut serialized = BTreeMap::new();
    for (key, value) in values {
      validate_key(key, "Global preference key")?;
      if expected_revisions[key] < 0 {
        return Err(LibraryError::Conflict(
          "Expected global preference revision cannot be negative.".to_string(),
        ));
      }
      serialized.insert(
        key.clone(),
        serde_json::to_string(value).map_err(|error| {
          LibraryError::Storage(format!("Unable to serialize global preference: {error}"))
        })?,
      );
    }

    let mut connection = self.connection()?;
    let transaction = connection
      .transaction_with_behavior(TransactionBehavior::Immediate)
      .map_err(map_sqlite_error)?;
    for (key, expected_revision) in expected_revisions {
      let current_revision = transaction
        .query_row(
          "SELECT revision FROM global_preferences WHERE preference_key = ?1",
          [key],
          |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
      if current_revision != *expected_revision {
        return Err(LibraryError::Conflict(format!(
          "Global preference {key} changed from expected revision {expected_revision} to revision {current_revision}."
        )));
      }
    }
    for (key, value_json) in &serialized {
      let expected_revision = expected_revisions[key];
      if expected_revision == 0 {
        transaction.execute(
          "INSERT INTO global_preferences (preference_key, revision, value_json)
           VALUES (?1, 1, ?2)",
          params![key, value_json],
        )?;
      } else {
        transaction.execute(
          "UPDATE global_preferences
           SET revision = revision + 1, value_json = ?3
           WHERE preference_key = ?1 AND revision = ?2",
          params![key, expected_revision, value_json],
        )?;
      }
    }
    transaction.commit().map_err(map_sqlite_error)?;

    Ok(
      values
        .iter()
        .map(|(key, value)| {
          (
            key.clone(),
            GlobalPreference {
              key: key.clone(),
              revision: expected_revisions[key] + 1,
              value: value.clone(),
            },
          )
        })
        .collect(),
    )
  }

  pub(super) fn connection(&self) -> Result<Connection, LibraryError> {
    let connection = Connection::open(&self.database_path).map_err(map_sqlite_error)?;
    connection
      .busy_timeout(BUSY_TIMEOUT)
      .map_err(map_sqlite_error)?;
    connection
      .pragma_update(None, "foreign_keys", "ON")
      .map_err(map_sqlite_error)?;
    Ok(connection)
  }
}

fn enable_wal(connection: &Connection) -> Result<(), LibraryError> {
  let deadline = Instant::now() + BUSY_TIMEOUT;
  loop {
    let current =
      connection.pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0));
    match current {
      Ok(mode) if mode.eq_ignore_ascii_case("wal") => return Ok(()),
      Ok(_) => match connection.pragma_update(None, "journal_mode", "WAL") {
        Ok(()) => return Ok(()),
        Err(error) if sqlite_is_busy(&error) && Instant::now() < deadline => {
          std::thread::sleep(Duration::from_millis(10));
        }
        Err(error) => return Err(map_sqlite_error(error)),
      },
      Err(error) if sqlite_is_busy(&error) && Instant::now() < deadline => {
        std::thread::sleep(Duration::from_millis(10));
      }
      Err(error) => return Err(map_sqlite_error(error)),
    }
  }
}

fn sqlite_is_busy(error: &rusqlite::Error) -> bool {
  matches!(
    error,
    rusqlite::Error::SqliteFailure(inner, _)
      if matches!(
        inner.code,
        rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
      )
  )
}

fn initialize_schema(connection: &Connection) -> Result<(), LibraryError> {
  connection
    .execute_batch(
      "CREATE TABLE IF NOT EXISTS library_items (
         kind TEXT NOT NULL,
         item_id TEXT NOT NULL,
         revision INTEGER NOT NULL CHECK (revision > 0),
         document_json TEXT NOT NULL,
         content_hash TEXT NOT NULL,
         PRIMARY KEY (kind, item_id)
       );
       CREATE TABLE IF NOT EXISTS library_collections (
         kind TEXT PRIMARY KEY,
         revision INTEGER NOT NULL CHECK (revision > 0)
       );
       CREATE TABLE IF NOT EXISTS library_order (
         kind TEXT NOT NULL,
         item_id TEXT NOT NULL,
         position INTEGER NOT NULL CHECK (position >= 0),
         PRIMARY KEY (kind, item_id),
         UNIQUE (kind, position),
         FOREIGN KEY (kind, item_id) REFERENCES library_items(kind, item_id) ON DELETE CASCADE
       );
       CREATE TABLE IF NOT EXISTS global_preferences (
         preference_key TEXT PRIMARY KEY,
         revision INTEGER NOT NULL CHECK (revision > 0),
         value_json TEXT NOT NULL
       );
       CREATE TABLE IF NOT EXISTS workspace_restore_set (
         workspace_id TEXT PRIMARY KEY,
         position INTEGER NOT NULL UNIQUE CHECK (position >= 0)
       );
       CREATE TABLE IF NOT EXISTS workspace_registry_state (
         singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
         revision INTEGER NOT NULL CHECK (revision >= 0)
       );
       INSERT OR IGNORE INTO workspace_restore_set (workspace_id, position) VALUES ('default', 0);
       INSERT OR IGNORE INTO workspace_registry_state (singleton, revision) VALUES (1, 0);",
    )
    .map_err(map_sqlite_error)?;
  let current_version: i64 = connection
    .pragma_query_value(None, "user_version", |row| row.get(0))
    .map_err(map_sqlite_error)?;
  if current_version == 0 {
    connection
      .pragma_update(None, "user_version", DATABASE_SCHEMA_VERSION)
      .map_err(map_sqlite_error)?;
  } else if current_version != DATABASE_SCHEMA_VERSION {
    return Err(LibraryError::Storage(format!(
      "Unsupported shared Library database version: {current_version}"
    )));
  }
  Ok(())
}

fn validate_key(value: &str, label: &str) -> Result<(), LibraryError> {
  if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
    return Err(LibraryError::Storage(format!("{label} is invalid.")));
  }
  Ok(())
}

#[cfg(debug_assertions)]
pub fn run_library_test_host(args: &[String]) -> std::process::ExitCode {
  use std::io::{BufRead, Write};

  let [root_flag, root, item_flag, item_id] = args else {
    eprintln!("Library test host requires --identity-root <path> --item-id <id>");
    return std::process::ExitCode::from(2);
  };
  if root_flag != "--identity-root" || item_flag != "--item-id" {
    eprintln!("Library test host requires --identity-root <path> --item-id <id>");
    return std::process::ExitCode::from(2);
  }
  let mut release = String::new();
  if let Err(error) = std::io::stdin().lock().read_line(&mut release) {
    eprintln!("Unable to await Library test release: {error}");
    return std::process::ExitCode::from(1);
  }
  let repository = match LibraryRepository::open(Path::new(root)) {
    Ok(repository) => repository,
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  let status = match repository.create(
    "preset",
    item_id,
    &serde_json::json!({ "writerPid": std::process::id() }),
  ) {
    Ok(_) => "committed",
    Err(LibraryError::Conflict(_)) => "conflict",
    Err(error) => {
      eprintln!("{error}");
      return std::process::ExitCode::from(1);
    }
  };
  println!("{}", serde_json::json!({ "status": status }));
  if let Err(error) = std::io::stdout().flush() {
    eprintln!("Unable to announce Library test result: {error}");
    return std::process::ExitCode::from(1);
  }
  std::process::ExitCode::SUCCESS
}

fn content_hash(document_json: &str) -> String {
  Sha256::digest(document_json.as_bytes())
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect()
}

fn map_sqlite_error(error: rusqlite::Error) -> LibraryError {
  LibraryError::Storage(format!("Shared Library database error: {error}"))
}

impl From<rusqlite::Error> for LibraryError {
  fn from(error: rusqlite::Error) -> Self {
    map_sqlite_error(error)
  }
}
