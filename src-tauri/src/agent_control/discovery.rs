use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::protocol::PROTOCOL_VERSION;

pub const DESCRIPTOR_SCHEMA_VERSION: u32 = 1;
pub const DESCRIPTOR_FILE_NAME: &str = "agent-control.json";
const LAUNCH_TOKEN_BYTES: usize = 32;
pub const LAUNCH_TOKEN_HEX_LEN: usize = LAUNCH_TOKEN_BYTES * 2;

#[derive(Clone, PartialEq, Eq)]
pub struct LaunchToken(String);

impl LaunchToken {
  fn parse(value: String) -> Result<Self, &'static str> {
    if value.len() != LAUNCH_TOKEN_HEX_LEN || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
      return Err("launch token must be 64 hexadecimal characters");
    }
    Ok(Self(value))
  }

  // Only the Windows pipe server reads the raw token; elsewhere it is test-only.
  #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
  pub(crate) fn expose(&self) -> &str {
    &self.0
  }
}

impl fmt::Debug for LaunchToken {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    formatter.write_str("LaunchToken([REDACTED])")
  }
}

impl fmt::Display for LaunchToken {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    formatter.write_str("[REDACTED]")
  }
}

impl Serialize for LaunchToken {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    serializer.serialize_str(&self.0)
  }
}

impl<'de> Deserialize<'de> for LaunchToken {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: Deserializer<'de>,
  {
    let value = String::deserialize(deserializer)?;
    Self::parse(value).map_err(serde::de::Error::custom)
  }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DescriptorApp {
  pub name: String,
  pub version: String,
  pub identifier: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentControlDescriptor {
  pub schema_version: u32,
  pub protocol_version: u32,
  pub app: DescriptorApp,
  pub pid: u32,
  pub endpoint: String,
  pub token: LaunchToken,
  pub started_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiscoveryErrorKind {
  Missing,
  Malformed,
  Stale,
  Unavailable,
  Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiscoveryError {
  pub kind: DiscoveryErrorKind,
  pub message: String,
}

impl DiscoveryError {
  pub fn new(kind: DiscoveryErrorKind, message: impl Into<String>) -> Self {
    Self {
      kind,
      message: message.into(),
    }
  }
}

impl fmt::Display for DiscoveryError {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    formatter.write_str(&self.message)
  }
}

impl std::error::Error for DiscoveryError {}

pub fn endpoint_name(app_identifier: &str) -> String {
  format!("plvs-control-{app_identifier}")
}

pub fn descriptor_path_in(config_dir: &Path) -> PathBuf {
  config_dir.join(DESCRIPTOR_FILE_NAME)
}

pub fn descriptor_path() -> Result<PathBuf, DiscoveryError> {
  crate::doctor::resolve_config_dir()
    .map(|directory| descriptor_path_in(&directory))
    .ok_or_else(|| {
      DiscoveryError::new(
        DiscoveryErrorKind::Unavailable,
        "The PLVS configuration directory is unavailable.",
      )
    })
}

pub fn generate_launch_token() -> Result<LaunchToken, DiscoveryError> {
  let mut bytes = [0_u8; LAUNCH_TOKEN_BYTES];
  getrandom::fill(&mut bytes).map_err(|error| {
    DiscoveryError::new(
      DiscoveryErrorKind::Unavailable,
      format!("Unable to generate a secure launch token: {error}"),
    )
  })?;
  let mut encoded = String::with_capacity(LAUNCH_TOKEN_HEX_LEN);
  for byte in bytes {
    use std::fmt::Write as _;
    write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
  }
  Ok(LaunchToken(encoded))
}

pub fn parse_descriptor(
  bytes: &[u8],
  expected_identifier: &str,
) -> Result<AgentControlDescriptor, DiscoveryError> {
  let descriptor: AgentControlDescriptor = serde_json::from_slice(bytes).map_err(|_| {
    DiscoveryError::new(
      DiscoveryErrorKind::Malformed,
      "The PLVS agent-control descriptor is malformed.",
    )
  })?;

  let valid = descriptor.schema_version == DESCRIPTOR_SCHEMA_VERSION
    && descriptor.protocol_version == PROTOCOL_VERSION
    && descriptor.app.identifier == expected_identifier
    && !descriptor.app.name.is_empty()
    && !descriptor.app.version.is_empty()
    && descriptor.pid > 0
    && descriptor.endpoint == endpoint_name(expected_identifier)
    && !descriptor.started_at.is_empty();
  if !valid {
    return Err(DiscoveryError::new(
      DiscoveryErrorKind::Malformed,
      "The PLVS agent-control descriptor is invalid for this app identity.",
    ));
  }
  Ok(descriptor)
}

pub fn write_descriptor_atomic_at(
  path: &Path,
  descriptor: &AgentControlDescriptor,
) -> Result<(), DiscoveryError> {
  let parent = path.parent().ok_or_else(|| {
    DiscoveryError::new(
      DiscoveryErrorKind::Io,
      "The descriptor path has no parent directory.",
    )
  })?;
  fs::create_dir_all(parent).map_err(|error| {
    DiscoveryError::new(
      DiscoveryErrorKind::Io,
      format!("Unable to create the descriptor directory: {error}"),
    )
  })?;
  let bytes = serde_json::to_vec_pretty(descriptor).map_err(|error| {
    DiscoveryError::new(
      DiscoveryErrorKind::Malformed,
      format!("Unable to serialize the descriptor: {error}"),
    )
  })?;
  let mut file = AtomicWriteFile::open(path).map_err(|error| {
    DiscoveryError::new(
      DiscoveryErrorKind::Io,
      format!("Unable to open the descriptor for atomic writing: {error}"),
    )
  })?;
  file.write_all(&bytes).map_err(|error| {
    DiscoveryError::new(
      DiscoveryErrorKind::Io,
      format!("Unable to write the descriptor: {error}"),
    )
  })?;
  file.commit().map_err(|error| {
    DiscoveryError::new(
      DiscoveryErrorKind::Io,
      format!("Unable to atomically replace the descriptor: {error}"),
    )
  })
}

pub fn read_descriptor_at<F>(
  path: &Path,
  expected_identifier: &str,
  is_process_alive: F,
) -> Result<AgentControlDescriptor, DiscoveryError>
where
  F: FnOnce(u32) -> bool,
{
  let bytes = fs::read(path).map_err(|error| {
    if error.kind() == std::io::ErrorKind::NotFound {
      DiscoveryError::new(
        DiscoveryErrorKind::Missing,
        "PLVS is not exposing an agent-control endpoint.",
      )
    } else {
      DiscoveryError::new(
        DiscoveryErrorKind::Io,
        format!("Unable to read the agent-control descriptor: {error}"),
      )
    }
  })?;
  let descriptor = parse_descriptor(&bytes, expected_identifier)?;
  if !is_process_alive(descriptor.pid) {
    return Err(DiscoveryError::new(
      DiscoveryErrorKind::Stale,
      "The PLVS agent-control descriptor is stale.",
    ));
  }
  Ok(descriptor)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::path::{Path, PathBuf};

  fn temp_dir(name: &str) -> PathBuf {
    let token = generate_launch_token().unwrap();
    let path = std::env::temp_dir().join(format!("plvs-agent-control-{name}-{}", token.expose()));
    fs::create_dir_all(&path).unwrap();
    path
  }

  fn descriptor(token: LaunchToken) -> AgentControlDescriptor {
    AgentControlDescriptor {
      schema_version: DESCRIPTOR_SCHEMA_VERSION,
      protocol_version: PROTOCOL_VERSION,
      app: DescriptorApp {
        name: "PLVS Dev".to_string(),
        version: "0.14.5".to_string(),
        identifier: "com.soundoer.plvs.dev".to_string(),
      },
      pid: 42,
      endpoint: endpoint_name("com.soundoer.plvs.dev"),
      token,
      started_at: "2026-09-02T08:00:00Z".to_string(),
    }
  }

  #[test]
  fn descriptor_paths_and_endpoints_are_identity_scoped() {
    let base = Path::new("C:/Users/example/AppData/Roaming");
    let release_dir = base.join("com.soundoer.plvs");
    let dev_dir = base.join("com.soundoer.plvs.dev");

    assert_ne!(
      descriptor_path_in(&release_dir),
      descriptor_path_in(&dev_dir)
    );
    assert_ne!(
      endpoint_name("com.soundoer.plvs"),
      endpoint_name("com.soundoer.plvs.dev")
    );
    assert_eq!(
      descriptor_path().unwrap(),
      descriptor_path_in(&crate::doctor::resolve_config_dir().unwrap())
    );
  }

  #[test]
  fn descriptor_round_trip_validates_schema_identity_and_token() {
    let descriptor = descriptor(generate_launch_token().unwrap());
    let bytes = serde_json::to_vec(&descriptor).unwrap();
    let parsed = parse_descriptor(&bytes, "com.soundoer.plvs.dev").unwrap();
    assert_eq!(parsed, descriptor);

    assert_eq!(
      parse_descriptor(&bytes, "com.soundoer.plvs")
        .unwrap_err()
        .kind,
      DiscoveryErrorKind::Malformed
    );
  }

  #[test]
  fn atomically_replaces_a_descriptor_without_leaving_a_sibling_temp_file() {
    let dir = temp_dir("atomic");
    let path = descriptor_path_in(&dir);
    let first = descriptor(generate_launch_token().unwrap());
    let mut second = descriptor(generate_launch_token().unwrap());
    second.pid = 84;

    write_descriptor_atomic_at(&path, &first).unwrap();
    write_descriptor_atomic_at(&path, &second).unwrap();

    assert_eq!(
      read_descriptor_at(&path, "com.soundoer.plvs.dev", |_| true).unwrap(),
      second
    );
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn classifies_missing_malformed_and_stale_descriptors() {
    let dir = temp_dir("classification");
    let path = descriptor_path_in(&dir);
    assert_eq!(
      read_descriptor_at(&path, "com.soundoer.plvs.dev", |_| true)
        .unwrap_err()
        .kind,
      DiscoveryErrorKind::Missing
    );

    fs::write(&path, b"not json").unwrap();
    assert_eq!(
      read_descriptor_at(&path, "com.soundoer.plvs.dev", |_| true)
        .unwrap_err()
        .kind,
      DiscoveryErrorKind::Malformed
    );

    write_descriptor_atomic_at(&path, &descriptor(generate_launch_token().unwrap())).unwrap();
    assert_eq!(
      read_descriptor_at(&path, "com.soundoer.plvs.dev", |_| false)
        .unwrap_err()
        .kind,
      DiscoveryErrorKind::Stale
    );
    fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn launch_tokens_are_secure_opaque_and_redacted_outside_the_descriptor() {
    let first = generate_launch_token().unwrap();
    let second = generate_launch_token().unwrap();
    assert_eq!(first.expose().len(), LAUNCH_TOKEN_HEX_LEN);
    assert_ne!(first, second);

    let descriptor = descriptor(first.clone());
    let json = serde_json::to_string(&descriptor).unwrap();
    assert!(json.contains(first.expose()));
    assert_eq!(
      serde_json::from_str::<AgentControlDescriptor>(&json).unwrap(),
      descriptor
    );

    assert!(!format!("{first:?}").contains(first.expose()));
    assert!(!first.to_string().contains(first.expose()));
    let error = DiscoveryError::new(DiscoveryErrorKind::Malformed, "bad token");
    assert!(!format!("{error}").contains(first.expose()));
    assert!(!serde_json::to_string(&error)
      .unwrap()
      .contains(first.expose()));
  }
}
