use std::{
  fs::{self, File, OpenOptions},
  path::{Path, PathBuf},
  sync::Mutex,
  time::{Duration, Instant},
};

use super::write_json_atomic;
use fs4::{FileExt, TryLockError};
use serde::{Deserialize, Serialize};

const COMMAND_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCommand {
  schema_version: u32,
  pub command_id: String,
  pub operation_id: String,
  pub instance_id: String,
  pub action: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCommandAck {
  schema_version: u32,
  pub command_id: String,
  pub operation_id: String,
  pub instance_id: String,
  pub outcome: String,
  pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedRuntimeCommand {
  pub command_id: String,
  pub instance_id: String,
}

#[derive(Debug, Clone)]
pub struct RuntimeCommandMailbox {
  directory: PathBuf,
}

#[derive(Debug, Default)]
pub struct RuntimeOperationCoordinator {
  lease: Mutex<Option<RuntimeOperationLease>>,
}

#[derive(Debug)]
struct RuntimeOperationLease {
  operation_id: String,
  file: File,
}

impl RuntimeOperationCoordinator {
  pub fn require_idle(&self) -> Result<(), String> {
    if self
      .lease
      .lock()
      .expect("runtime operation lease poisoned")
      .is_none()
    {
      Ok(())
    } else {
      Err("Another identity-wide PLVS operation is already running.".to_string())
    }
  }

  pub fn begin(&self, identity_root: &Path, operation_id: &str) -> Result<(), String> {
    validate_component(operation_id)?;
    let mut lease = self.lease.lock().expect("runtime operation lease poisoned");
    if let Some(current) = lease.as_ref() {
      return if current.operation_id == operation_id {
        Ok(())
      } else {
        Err("Another identity-wide PLVS operation is already running.".to_string())
      };
    }
    let path = identity_root.join("runtime").join("operation.lock");
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create runtime operation directory: {error}"))?;
    }
    let file = OpenOptions::new()
      .read(true)
      .write(true)
      .create(true)
      .truncate(false)
      .open(path)
      .map_err(|error| format!("Unable to open runtime operation lock: {error}"))?;
    match FileExt::try_lock(&file) {
      Ok(()) => {}
      Err(TryLockError::WouldBlock) => {
        return Err("Another identity-wide PLVS operation is already running.".to_string())
      }
      Err(TryLockError::Error(error)) => {
        return Err(format!("Unable to lock the runtime operation: {error}"))
      }
    }
    *lease = Some(RuntimeOperationLease {
      operation_id: operation_id.to_string(),
      file,
    });
    Ok(())
  }

  pub fn require_owner(&self, operation_id: &str) -> Result<(), String> {
    let lease = self.lease.lock().expect("runtime operation lease poisoned");
    if lease.as_ref().map(|lease| lease.operation_id.as_str()) == Some(operation_id) {
      Ok(())
    } else {
      Err("This process does not own the identity-wide PLVS operation.".to_string())
    }
  }

  pub fn finish(&self, operation_id: &str) -> Result<(), String> {
    self.require_owner(operation_id)?;
    let lease = self
      .lease
      .lock()
      .expect("runtime operation lease poisoned")
      .take()
      .expect("owned runtime operation lease disappeared");
    FileExt::unlock(&lease.file)
      .map_err(|error| format!("Unable to release the runtime operation: {error}"))
  }
}

impl RuntimeCommandMailbox {
  pub fn open(identity_root: &Path) -> Result<Self, String> {
    let directory = identity_root.join("runtime").join("commands");
    fs::create_dir_all(directory.join("pending"))
      .and_then(|_| fs::create_dir_all(directory.join("acks")))
      .map_err(|error| format!("Unable to create runtime command mailbox: {error}"))?;
    Ok(Self { directory })
  }

  pub fn issue(
    &self,
    instance_id: &str,
    operation_id: &str,
    action: &str,
  ) -> Result<IssuedRuntimeCommand, String> {
    validate_component(instance_id)?;
    validate_component(operation_id)?;
    if !matches!(
      action,
      "show" | "quitInstance" | "prepareGlobal" | "abortGlobal" | "commitGlobal"
    ) {
      return Err("Unknown runtime coordination action.".to_string());
    }
    let lock = OpenOptions::new()
      .read(true)
      .write(true)
      .create(true)
      .truncate(false)
      .open(self.command_lock_path(instance_id))
      .map_err(|error| format!("Unable to open runtime command lock: {error}"))?;
    FileExt::lock(&lock)
      .map_err(|error| format!("Unable to lock the runtime command mailbox: {error}"))?;
    if let Some(pending) = self.poll(instance_id)? {
      let replaces_same_operation =
        pending.operation_id == operation_id && matches!(action, "abortGlobal" | "commitGlobal");
      if !replaces_same_operation {
        return Err(format!(
          "PLVS instance {instance_id} already has a pending command."
        ));
      }
    }
    let command_id = random_id()?;
    let command = RuntimeCommand {
      schema_version: COMMAND_SCHEMA_VERSION,
      command_id: command_id.clone(),
      operation_id: operation_id.to_string(),
      instance_id: instance_id.to_string(),
      action: action.to_string(),
    };
    write_json_atomic(&self.pending_path(instance_id), &command)?;
    Ok(IssuedRuntimeCommand {
      command_id,
      instance_id: instance_id.to_string(),
    })
  }

  pub fn issue_many(
    &self,
    instance_ids: &[String],
    operation_id: &str,
    action: &str,
  ) -> Result<Vec<IssuedRuntimeCommand>, String> {
    let mut issued = Vec::with_capacity(instance_ids.len());
    for instance_id in instance_ids {
      match self.issue(instance_id, operation_id, action) {
        Ok(command) => issued.push(command),
        Err(error) => {
          if action == "prepareGlobal" {
            for command in &issued {
              let _ = self.issue(&command.instance_id, operation_id, "abortGlobal");
            }
          }
          return Err(error);
        }
      }
    }
    Ok(issued)
  }

  pub fn poll(&self, instance_id: &str) -> Result<Option<RuntimeCommand>, String> {
    validate_component(instance_id)?;
    let path = self.pending_path(instance_id);
    let bytes = match fs::read(&path) {
      Ok(bytes) => bytes,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
      Err(error) => return Err(format!("Unable to read runtime command: {error}")),
    };
    let command: RuntimeCommand = serde_json::from_slice(&bytes)
      .map_err(|error| format!("Unable to parse runtime command: {error}"))?;
    if command.schema_version != COMMAND_SCHEMA_VERSION || command.instance_id != instance_id {
      return Err("The runtime command is invalid.".to_string());
    }
    Ok(Some(command))
  }

  pub fn acknowledge(
    &self,
    command: &RuntimeCommand,
    outcome: &str,
    detail: Option<String>,
  ) -> Result<(), String> {
    if !matches!(outcome, "ready" | "completed" | "blocked" | "failed") {
      return Err("Unknown runtime command outcome.".to_string());
    }
    let ack = RuntimeCommandAck {
      schema_version: COMMAND_SCHEMA_VERSION,
      command_id: command.command_id.clone(),
      operation_id: command.operation_id.clone(),
      instance_id: command.instance_id.clone(),
      outcome: outcome.to_string(),
      detail,
    };
    write_json_atomic(&self.ack_path(&command.command_id), &ack)?;
    let path = self.pending_path(&command.instance_id);
    if self.poll(&command.instance_id)?.as_ref() == Some(command) {
      fs::remove_file(path)
        .map_err(|error| format!("Unable to consume runtime command: {error}"))?;
    }
    Ok(())
  }

  pub fn wait_for(
    &self,
    issued: &[IssuedRuntimeCommand],
    timeout: Duration,
  ) -> Result<Vec<RuntimeCommandAck>, String> {
    let started = Instant::now();
    loop {
      let mut acknowledgements = Vec::with_capacity(issued.len());
      for command in issued {
        let path = self.ack_path(&command.command_id);
        let bytes = match fs::read(path) {
          Ok(bytes) => bytes,
          Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
          Err(error) => return Err(format!("Unable to read runtime acknowledgement: {error}")),
        };
        let ack: RuntimeCommandAck = serde_json::from_slice(&bytes)
          .map_err(|error| format!("Unable to parse runtime acknowledgement: {error}"))?;
        acknowledgements.push(ack);
      }
      if acknowledgements.len() == issued.len() {
        for command in issued {
          let _ = fs::remove_file(self.ack_path(&command.command_id));
        }
        return Ok(acknowledgements);
      }
      if started.elapsed() >= timeout {
        return Err(
          "A PLVS instance did not answer the coordinated operation in time.".to_string(),
        );
      }
      std::thread::sleep(Duration::from_millis(25));
    }
  }

  fn pending_path(&self, instance_id: &str) -> PathBuf {
    self
      .directory
      .join("pending")
      .join(format!("{instance_id}.json"))
  }

  fn ack_path(&self, command_id: &str) -> PathBuf {
    self
      .directory
      .join("acks")
      .join(format!("{command_id}.json"))
  }

  fn command_lock_path(&self, instance_id: &str) -> PathBuf {
    self.directory.join(format!("{instance_id}.lock"))
  }
}

fn validate_component(value: &str) -> Result<(), String> {
  if value.is_empty()
    || value.len() > 128
    || !value
      .bytes()
      .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
  {
    return Err("Runtime coordination identifier is invalid.".to_string());
  }
  Ok(())
}

fn random_id() -> Result<String, String> {
  let mut bytes = [0_u8; 16];
  getrandom::fill(&mut bytes)
    .map_err(|error| format!("Unable to generate runtime command identity: {error}"))?;
  Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
  use super::*;
  fn test_root(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
      "plvs-runtime-commands-{name}-{}",
      std::process::id()
    ))
  }

  #[test]
  fn commands_are_targeted_acknowledged_and_consumed() {
    let root = test_root("ack");
    let _ = fs::remove_dir_all(&root);
    let mailbox = RuntimeCommandMailbox::open(&root).unwrap();
    let issued = mailbox
      .issue("instance-a", "operation-a", "prepareGlobal")
      .unwrap();
    assert!(mailbox.poll("instance-b").unwrap().is_none());
    let command = mailbox.poll("instance-a").unwrap().unwrap();
    mailbox
      .acknowledge(&command, "ready", Some("flushed".to_string()))
      .unwrap();
    assert!(mailbox.poll("instance-a").unwrap().is_none());
    let acknowledgements = mailbox
      .wait_for(&[issued], Duration::from_millis(100))
      .unwrap();
    assert_eq!(acknowledgements[0].outcome, "ready");
    let _ = fs::remove_dir_all(root);
  }

  #[test]
  fn wait_times_out_instead_of_guessing_that_a_peer_is_ready() {
    let root = test_root("timeout");
    let _ = fs::remove_dir_all(&root);
    let mailbox = RuntimeCommandMailbox::open(&root).unwrap();
    let issued = mailbox
      .issue("instance-a", "operation-a", "prepareGlobal")
      .unwrap();
    assert!(mailbox
      .wait_for(&[issued], Duration::from_millis(30))
      .unwrap_err()
      .contains("did not answer"));
    let _ = fs::remove_dir_all(root);
  }

  #[test]
  fn an_unrelated_command_cannot_overwrite_a_pending_global_operation() {
    let root = test_root("pending-conflict");
    let _ = fs::remove_dir_all(&root);
    let mailbox = RuntimeCommandMailbox::open(&root).unwrap();
    mailbox
      .issue("instance-a", "operation-a", "prepareGlobal")
      .unwrap();

    assert!(mailbox
      .issue("instance-a", "show-a", "show")
      .unwrap_err()
      .contains("already has a pending command"));
    assert_eq!(
      mailbox.poll("instance-a").unwrap().unwrap().action,
      "prepareGlobal"
    );
    let _ = fs::remove_dir_all(root);
  }

  #[test]
  fn abort_can_replace_the_same_operations_unacknowledged_prepare() {
    let root = test_root("abort-replaces-prepare");
    let _ = fs::remove_dir_all(&root);
    let mailbox = RuntimeCommandMailbox::open(&root).unwrap();
    mailbox
      .issue("instance-a", "operation-a", "prepareGlobal")
      .unwrap();
    mailbox
      .issue("instance-a", "operation-a", "abortGlobal")
      .unwrap();

    assert_eq!(
      mailbox.poll("instance-a").unwrap().unwrap().action,
      "abortGlobal"
    );
    let _ = fs::remove_dir_all(root);
  }

  #[test]
  fn a_partial_prepare_batch_aborts_targets_that_were_already_issued() {
    let root = test_root("partial-prepare");
    let _ = fs::remove_dir_all(&root);
    let mailbox = RuntimeCommandMailbox::open(&root).unwrap();
    mailbox.issue("instance-b", "show-b", "show").unwrap();

    assert!(mailbox
      .issue_many(
        &["instance-a".to_string(), "instance-b".to_string()],
        "operation-a",
        "prepareGlobal"
      )
      .is_err());
    let first = mailbox.poll("instance-a").unwrap().unwrap();
    assert_eq!(first.operation_id, "operation-a");
    assert_eq!(first.action, "abortGlobal");
    assert_eq!(mailbox.poll("instance-b").unwrap().unwrap().action, "show");
    let _ = fs::remove_dir_all(root);
  }

  #[test]
  fn one_process_owns_an_identity_wide_operation_until_it_finishes() {
    let root = test_root("operation-lock");
    let _ = fs::remove_dir_all(&root);
    let first = RuntimeOperationCoordinator::default();
    let second = RuntimeOperationCoordinator::default();
    first.begin(&root, "operation-a").unwrap();
    assert!(second.begin(&root, "operation-b").is_err());
    first.finish("operation-a").unwrap();
    second.begin(&root, "operation-b").unwrap();
    second.finish("operation-b").unwrap();
    let _ = fs::remove_dir_all(root);
  }

  #[test]
  fn unrelated_commands_are_refused_while_a_global_operation_is_owned() {
    let root = test_root("operation-busy");
    let _ = fs::remove_dir_all(&root);
    let operations = RuntimeOperationCoordinator::default();
    operations.begin(&root, "operation-a").unwrap();
    assert!(operations.require_idle().is_err());
    operations.finish("operation-a").unwrap();
    assert!(operations.require_idle().is_ok());
    let _ = fs::remove_dir_all(root);
  }
}
