use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{File, OpenOptions};
use std::io;
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::Manager;

use super::{TransportError, TransportErrorReason};
use crate::agent_control::broker::{
  AgentControlState, Broker, BrokerError, BrokerErrorReason, TauriFrontendEmitter,
  DEFAULT_MAX_PENDING_REQUESTS, DEFAULT_RESPONSE_TIMEOUT,
};
use crate::agent_control::discovery::{
  descriptor_path, generate_launch_token, macos_socket_file_name, parse_descriptor,
  write_descriptor_atomic_at, AgentControlDescriptor, DescriptorApp, DiscoveryError, LaunchToken,
};
use crate::agent_control::framing::{
  decode_authenticated_request, encode_authenticated_request, read_frame, read_frame_with_timeout,
  write_frame, MAX_CLIENT_WORKERS, MAX_WIRE_REQUEST_BYTES,
};
use crate::agent_control::protocol::{
  encode_response, JsonRpcError, JsonRpcRequest, JsonRpcResponse, MAX_RESPONSE_BYTES,
};

const ACK_MAX_BYTES: usize = 1024;
const ACK_TIMEOUT: Duration = Duration::from_millis(1500);
const DELIVERY_ACK_FIELD: &str = "_plvsDeliveryAcknowledgement";
const TRANSPORT_RESPONSE_OVERHEAD: usize = 128;
const MAX_WIRE_RESPONSE_BYTES: usize = MAX_RESPONSE_BYTES + TRANSPORT_RESPONSE_OVERHEAD;
const ACCEPT_RETRY_DELAY: Duration = Duration::from_millis(10);
const SOCKET_PATH_MAX_BYTES: usize = 103;
const LOCK_FILE_NAME: &str = "agent-control.lock";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeliveryAcknowledgement {
  request_id: String,
}

struct OwnershipLock {
  file: File,
}

impl OwnershipLock {
  fn acquire(path: &Path) -> io::Result<Self> {
    let file = OpenOptions::new()
      .read(true)
      .write(true)
      .create(true)
      .truncate(false)
      .mode(0o600)
      .custom_flags(libc::O_NOFOLLOW)
      .open(path)?;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result != 0 {
      return Err(io::Error::last_os_error());
    }
    Ok(Self { file })
  }
}

impl Drop for OwnershipLock {
  fn drop(&mut self) {
    unsafe {
      libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
    }
  }
}

fn socket_path(identifier: &str) -> Result<PathBuf, TransportError> {
  let temporary_directory = std::env::temp_dir();
  let metadata = temporary_directory.metadata().map_err(TransportError::io)?;
  let current_uid = unsafe { libc::geteuid() };
  if !metadata.is_dir() || metadata.uid() != current_uid || metadata.mode() & 0o077 != 0 {
    return Err(TransportError::new(
      TransportErrorReason::ConnectionFailed,
      "The macOS user temporary directory is not private to the current user.",
    ));
  }
  socket_path_in(&temporary_directory, identifier)
}

fn socket_path_in(temporary_directory: &Path, identifier: &str) -> Result<PathBuf, TransportError> {
  let path = temporary_directory.join(macos_socket_file_name(identifier));
  let length = path.as_os_str().as_encoded_bytes().len();
  if length > SOCKET_PATH_MAX_BYTES {
    return Err(TransportError::new(
      TransportErrorReason::ConnectionFailed,
      format!(
        "The macOS agent-control socket path is too long ({length} bytes; maximum {SOCKET_PATH_MAX_BYTES})."
      ),
    ));
  }
  Ok(path)
}

fn remove_stale_socket(path: &Path) -> Result<(), TransportError> {
  match std::fs::symlink_metadata(path) {
    Ok(metadata) if metadata.file_type().is_socket() => {
      std::fs::remove_file(path).map_err(TransportError::io)
    }
    Ok(_) => Err(TransportError::new(
      TransportErrorReason::ConnectionFailed,
      "The macOS agent-control endpoint path is occupied by a non-socket entry.",
    )),
    Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
    Err(error) => Err(error.into()),
  }
}

fn peer_uid(fd: RawFd) -> io::Result<libc::uid_t> {
  let mut uid = 0;
  let mut gid = 0;
  let result = unsafe { libc::getpeereid(fd, &mut uid, &mut gid) };
  if result == 0 {
    Ok(uid)
  } else {
    Err(io::Error::last_os_error())
  }
}

fn verify_current_user(stream: &UnixStream) -> Result<(), TransportError> {
  let peer = peer_uid(stream.as_raw_fd()).map_err(TransportError::io)?;
  let current = unsafe { libc::geteuid() };
  if peer == current {
    Ok(())
  } else {
    Err(TransportError::new(
      TransportErrorReason::Unauthorized,
      "The macOS agent-control peer belongs to another user.",
    ))
  }
}

fn is_connected(fd: RawFd) -> bool {
  let mut byte = 0_u8;
  let result = unsafe {
    libc::recv(
      fd,
      (&mut byte as *mut u8).cast(),
      1,
      libc::MSG_PEEK | libc::MSG_DONTWAIT,
    )
  };
  if result > 0 {
    return true;
  }
  if result == 0 {
    return false;
  }
  matches!(
    io::Error::last_os_error().kind(),
    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
  )
}

fn unattributed_error_response(error: JsonRpcError) -> JsonRpcResponse {
  JsonRpcResponse::error("", error)
}

fn read_acknowledgement(
  stream: &mut UnixStream,
  expected_request_id: &str,
) -> Result<(), TransportError> {
  let bytes = read_frame_with_timeout(stream, ACK_MAX_BYTES, ACK_TIMEOUT)?;
  let acknowledgement: DeliveryAcknowledgement = serde_json::from_slice(&bytes).map_err(|_| {
    TransportError::new(
      TransportErrorReason::DeliveryFailed,
      "The agent-control response acknowledgement is malformed.",
    )
  })?;
  if acknowledgement.request_id != expected_request_id {
    return Err(TransportError::new(
      TransportErrorReason::DeliveryFailed,
      "The agent-control response acknowledgement does not match the request.",
    ));
  }
  Ok(())
}

fn write_acknowledgement(stream: &mut UnixStream, request_id: &str) -> Result<(), TransportError> {
  let bytes = serde_json::to_vec(&DeliveryAcknowledgement {
    request_id: request_id.to_string(),
  })
  .map_err(|_| {
    TransportError::new(
      TransportErrorReason::DeliveryFailed,
      "Unable to encode the agent-control response acknowledgement.",
    )
  })?;
  write_frame(stream, &bytes, ACK_MAX_BYTES)
}

fn encode_transport_response(
  response: &JsonRpcResponse,
  acknowledgement_requested: bool,
) -> Result<Vec<u8>, TransportError> {
  let encoded = encode_response(response).map_err(|error| {
    TransportError::new(TransportErrorReason::InvalidEnvelope, error.to_string())
  })?;
  if !acknowledgement_requested {
    return Ok(encoded);
  }
  let mut value: Value = serde_json::from_slice(&encoded).map_err(|_| {
    TransportError::new(
      TransportErrorReason::InvalidEnvelope,
      "Unable to encode the agent-control delivery request.",
    )
  })?;
  value
    .as_object_mut()
    .expect("JSON-RPC responses serialize as objects")
    .insert(DELIVERY_ACK_FIELD.to_string(), Value::Bool(true));
  serde_json::to_vec(&value).map_err(|_| {
    TransportError::new(
      TransportErrorReason::InvalidEnvelope,
      "Unable to encode the agent-control delivery request.",
    )
  })
}

fn handle_client(mut stream: UnixStream, token: LaunchToken, broker: Broker) {
  if let Err(error) = verify_current_user(&stream) {
    log::warn!("agent-control peer rejected: {error}");
    return;
  }
  if let Err(error) = stream.set_nonblocking(true) {
    log::warn!("agent-control socket mode failed: {error}");
    return;
  }

  let mut pending_delivery = None;
  let response = match read_frame(&mut stream, MAX_WIRE_REQUEST_BYTES)
    .and_then(|bytes| decode_authenticated_request(&bytes, &token))
  {
    Ok(request) => {
      let request_id = request.id.clone();
      match broker.dispatch(request) {
        Ok(mut pending) => {
          match pending.wait_with_delivery_until(|| !is_connected(stream.as_raw_fd())) {
            Ok(delivery) => {
              let response = delivery.response.clone();
              pending_delivery = Some(delivery);
              response
            }
            Err(error) if error.reason == BrokerErrorReason::ClientDisconnected => return,
            Err(error) => JsonRpcResponse::error(request_id, error.rpc_error()),
          }
        }
        Err(error) => JsonRpcResponse::error(request_id, error.rpc_error()),
      }
    }
    Err(error) => unattributed_error_response(error.rpc_error()),
  };

  let request_id = response.id.clone();
  let acknowledgement_requested = pending_delivery
    .as_ref()
    .is_some_and(|delivery| delivery.requires_delivery_confirmation());
  let delivered = encode_transport_response(&response, acknowledgement_requested)
    .map_err(|error| error.to_string())
    .and_then(|encoded| {
      write_frame(&mut stream, &encoded, MAX_WIRE_RESPONSE_BYTES).map_err(|error| error.to_string())
    })
    .and_then(|_| match acknowledgement_requested {
      true => read_acknowledgement(&mut stream, &request_id).map_err(|error| error.to_string()),
      false => Ok(()),
    });
  if let Err(error) = &delivered {
    log::warn!("agent-control response delivery failed: {error}");
  }
  if let Some(delivery) = pending_delivery {
    delivery.confirm_delivery(
      delivered.map_err(|message| BrokerError::new(BrokerErrorReason::DeliveryFailed, message)),
    );
  }
}

pub struct SocketServer {
  endpoint: PathBuf,
  shutdown: Arc<AtomicBool>,
  listener: Option<JoinHandle<()>>,
  broker: Broker,
  descriptor: Option<(PathBuf, AgentControlDescriptor)>,
  _ownership: OwnershipLock,
}

impl SocketServer {
  fn bind(
    endpoint: PathBuf,
    token: LaunchToken,
    broker: Broker,
    ownership: OwnershipLock,
  ) -> Result<Self, TransportError> {
    remove_stale_socket(&endpoint)?;
    let listener = UnixListener::bind(&endpoint).map_err(TransportError::io)?;
    std::fs::set_permissions(&endpoint, std::fs::Permissions::from_mode(0o600))
      .map_err(TransportError::io)?;
    listener.set_nonblocking(true).map_err(TransportError::io)?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let active_workers = Arc::new(AtomicUsize::new(0));
    let thread_shutdown = shutdown.clone();
    let thread_broker = broker.clone();
    let listener_thread = thread::Builder::new()
      .name("agent-control-listener".to_string())
      .spawn(move || loop {
        if thread_shutdown.load(Ordering::Acquire) {
          break;
        }
        match listener.accept() {
          Ok((stream, _)) => {
            if active_workers.load(Ordering::Acquire) >= MAX_CLIENT_WORKERS {
              continue;
            }
            active_workers.fetch_add(1, Ordering::AcqRel);
            let worker_count = active_workers.clone();
            let spawn_count = active_workers.clone();
            let worker_token = token.clone();
            let worker_broker = thread_broker.clone();
            if thread::Builder::new()
              .name("agent-control-client".to_string())
              .spawn(move || {
                handle_client(stream, worker_token, worker_broker);
                worker_count.fetch_sub(1, Ordering::AcqRel);
              })
              .is_err()
            {
              spawn_count.fetch_sub(1, Ordering::AcqRel);
            }
          }
          Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            thread::sleep(ACCEPT_RETRY_DELAY);
          }
          Err(error) => {
            if !thread_shutdown.load(Ordering::Acquire) {
              log::warn!("agent-control socket accept failed: {error}");
            }
            break;
          }
        }
      })
      .map_err(TransportError::io)?;

    Ok(Self {
      endpoint,
      shutdown,
      listener: Some(listener_thread),
      broker,
      descriptor: None,
      _ownership: ownership,
    })
  }

  fn own_descriptor(&mut self, path: PathBuf, descriptor: AgentControlDescriptor) {
    self.descriptor = Some((path, descriptor));
  }

  fn stop(&mut self) {
    if self.shutdown.swap(true, Ordering::AcqRel) {
      return;
    }
    if let Some(listener) = self.listener.take() {
      let _ = listener.join();
    }
    self.broker.shutdown();
    self.remove_owned_descriptor();
    let _ = remove_stale_socket(&self.endpoint);
  }

  fn remove_owned_descriptor(&mut self) {
    let Some((path, owned)) = self.descriptor.take() else {
      return;
    };
    let Ok(bytes) = std::fs::read(&path) else {
      return;
    };
    let Ok(current) = parse_descriptor(&bytes, &owned.app.identifier) else {
      return;
    };
    if current.pid == owned.pid && current.token == owned.token {
      let _ = std::fs::remove_file(path);
    }
  }
}

impl Drop for SocketServer {
  fn drop(&mut self) {
    self.stop();
  }
}

#[derive(Default)]
pub struct ServerState {
  server: Mutex<Option<SocketServer>>,
}

impl ServerState {
  fn install(&self, server: SocketServer) {
    *self
      .server
      .lock()
      .expect("agent-control server state poisoned") = Some(server);
  }

  pub fn stop(&self) {
    if let Some(mut server) = self
      .server
      .lock()
      .expect("agent-control server state poisoned")
      .take()
    {
      server.stop();
    }
  }

  pub fn is_running(&self) -> bool {
    self
      .server
      .lock()
      .expect("agent-control server state poisoned")
      .is_some()
  }
}

impl Drop for ServerState {
  fn drop(&mut self) {
    if let Ok(server) = self.server.get_mut() {
      if let Some(mut server) = server.take() {
        server.stop();
      }
    }
  }
}

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
  let identifier = env!("PLVS_APP_ID");
  let descriptor_path = descriptor_path().map_err(|error| error.to_string())?;
  let config_dir = descriptor_path
    .parent()
    .ok_or_else(|| "The agent-control descriptor has no parent directory.".to_string())?;
  std::fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
  std::fs::set_permissions(config_dir, std::fs::Permissions::from_mode(0o700))
    .map_err(|error| format!("unable to secure the agent-control directory: {error}"))?;
  let lock = OwnershipLock::acquire(&config_dir.join(LOCK_FILE_NAME))
    .map_err(|error| format!("unable to claim the agent-control endpoint: {error}"))?;
  let endpoint = socket_path(identifier).map_err(|error| error.to_string())?;
  let token = generate_launch_token().map_err(|error| error.to_string())?;
  let emitter = Arc::new(TauriFrontendEmitter::new(app.clone()));
  let broker = Broker::new(
    emitter,
    DEFAULT_MAX_PENDING_REQUESTS,
    DEFAULT_RESPONSE_TIMEOUT,
  );
  let mut server = SocketServer::bind(endpoint.clone(), token.clone(), broker.clone(), lock)
    .map_err(|error| format!("unable to bind {}: {error}", endpoint.display()))?;
  let started_at = time::OffsetDateTime::now_utc()
    .format(&time::format_description::well_known::Rfc3339)
    .map_err(|error| format!("unable to format agent-control start time: {error}"))?;
  let descriptor = AgentControlDescriptor {
    schema_version: crate::agent_control::discovery::DESCRIPTOR_SCHEMA_VERSION,
    protocol_version: crate::agent_control::protocol::PROTOCOL_VERSION,
    app: DescriptorApp {
      name: if cfg!(feature = "dev-identity") {
        "PLVS Dev"
      } else {
        "PLVS"
      }
      .to_string(),
      version: env!("CARGO_PKG_VERSION").to_string(),
      identifier: identifier.to_string(),
    },
    pid: std::process::id(),
    endpoint: endpoint.display().to_string(),
    token,
    started_at,
  };
  write_descriptor_atomic_at(&descriptor_path, &descriptor)
    .map_err(|error: DiscoveryError| error.to_string())?;
  server.own_descriptor(descriptor_path, descriptor);
  app.state::<AgentControlState>().install(broker);
  app.state::<ServerState>().install(server);
  Ok(())
}

pub fn call_with_timeout(
  endpoint: &str,
  token: &LaunchToken,
  request: &JsonRpcRequest,
  response_timeout: Duration,
) -> Result<Value, TransportError> {
  let mut stream = UnixStream::connect(endpoint).map_err(|error| {
    TransportError::new(
      TransportErrorReason::ConnectionFailed,
      format!("Unable to connect to the PLVS agent-control endpoint: {error}"),
    )
  })?;
  verify_current_user(&stream)?;
  stream.set_nonblocking(true).map_err(TransportError::io)?;
  let payload = encode_authenticated_request(token, request)?;
  write_frame(&mut stream, &payload, MAX_WIRE_REQUEST_BYTES)?;
  let response = read_frame_with_timeout(&mut stream, MAX_WIRE_RESPONSE_BYTES, response_timeout)?;
  let mut value: Value = serde_json::from_slice(&response).map_err(|_| {
    TransportError::new(
      TransportErrorReason::InvalidEnvelope,
      "PLVS returned a malformed JSON-RPC response.",
    )
  })?;
  let acknowledgement_requested = value
    .as_object_mut()
    .and_then(|object| object.remove(DELIVERY_ACK_FIELD))
    .and_then(|flag| flag.as_bool())
    .unwrap_or(false);
  let response_id = value.get("id").and_then(Value::as_str).ok_or_else(|| {
    TransportError::new(
      TransportErrorReason::InvalidEnvelope,
      "PLVS returned a JSON-RPC response without an ID.",
    )
  })?;
  // An empty ID is reserved for a server-level framing/authentication error that could not be
  // attributed to a parsed request. Any other different ID is a stray response.
  if !response_id.is_empty() && response_id != request.id {
    return Err(TransportError::new(
      TransportErrorReason::InvalidEnvelope,
      "PLVS returned a JSON-RPC response for another request.",
    ));
  }
  if acknowledgement_requested {
    write_acknowledgement(&mut stream, response_id)?;
  }
  Ok(value)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::agent_control::broker::{FrontendEmitter, FrontendOutcome};

  struct Responder {
    broker: Mutex<Option<Broker>>,
    delivery: bool,
    completion: Mutex<Option<JoinHandle<Result<(), BrokerError>>>>,
  }

  impl FrontendEmitter for Responder {
    fn emit(&self, request: &JsonRpcRequest) -> Result<(), String> {
      let broker = self.broker.lock().unwrap().as_ref().unwrap().clone();
      if self.delivery {
        let request_id = request.id.clone();
        let completion = thread::spawn(move || {
          broker.respond_and_wait_for_delivery(
            &request_id,
            FrontendOutcome::Success(serde_json::json!({ "persisted": true })),
          )
        });
        *self.completion.lock().unwrap() = Some(completion);
        Ok(())
      } else {
        broker
          .respond(
            &request.id,
            FrontendOutcome::Success(serde_json::json!({ "platform": "macos" })),
          )
          .map_err(|error| error.to_string())
      }
    }
  }

  fn test_server(delivery: bool) -> (SocketServer, LaunchToken, Arc<Responder>) {
    let token = generate_launch_token().unwrap();
    let suffix = &token.expose()[..16];
    let directory = std::env::temp_dir().join(format!("plvs-agent-control-test-{suffix}"));
    std::fs::create_dir_all(&directory).unwrap();
    let endpoint = directory.join("control.sock");
    let ownership = OwnershipLock::acquire(&directory.join("owner.lock")).unwrap();
    let responder = Arc::new(Responder {
      broker: Mutex::new(None),
      delivery,
      completion: Mutex::new(None),
    });
    let broker = Broker::new(responder.clone(), 4, Duration::from_secs(5));
    *responder.broker.lock().unwrap() = Some(broker.clone());
    broker.frontend_ready().unwrap();
    let server = SocketServer::bind(endpoint, token.clone(), broker, ownership).unwrap();
    (server, token, responder)
  }

  #[test]
  fn endpoint_names_are_short_and_identity_specific() {
    let release = socket_path("com.soundoer.plvs").unwrap();
    let development = socket_path("com.soundoer.plvs.dev").unwrap();
    assert_ne!(release, development);
    assert!(release.as_os_str().as_encoded_bytes().len() <= SOCKET_PATH_MAX_BYTES);
  }

  #[test]
  fn endpoint_path_length_is_rejected_instead_of_truncated() {
    let long_parent = PathBuf::from(format!("/tmp/{}", "x".repeat(SOCKET_PATH_MAX_BYTES)));
    let error = socket_path_in(&long_parent, "com.soundoer.plvs.dev").unwrap_err();
    assert_eq!(error.reason, TransportErrorReason::ConnectionFailed);
    assert!(error.message.contains("too long"));
  }

  #[test]
  fn stale_cleanup_removes_only_socket_entries() {
    let token = generate_launch_token().unwrap();
    let endpoint = std::env::temp_dir().join(format!("plvs-clean-{}.sock", &token.expose()[..8]));

    std::fs::write(&endpoint, b"not a socket").unwrap();
    assert_eq!(
      remove_stale_socket(&endpoint).unwrap_err().reason,
      TransportErrorReason::ConnectionFailed
    );
    assert!(endpoint.is_file());
    std::fs::remove_file(&endpoint).unwrap();

    let listener = UnixListener::bind(&endpoint).unwrap();
    drop(listener);
    remove_stale_socket(&endpoint).unwrap();
    assert!(!endpoint.exists());
  }

  #[test]
  fn ownership_lock_has_one_live_owner() {
    use std::os::unix::fs::PermissionsExt;

    let directory =
      std::env::temp_dir().join(format!("plvs-agent-control-lock-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("owner.lock");
    let first = OwnershipLock::acquire(&path).unwrap();
    assert_eq!(path.metadata().unwrap().permissions().mode() & 0o777, 0o600);
    assert!(OwnershipLock::acquire(&path).is_err());
    drop(first);
    assert!(OwnershipLock::acquire(&path).is_ok());
    std::fs::remove_dir_all(directory).unwrap();
  }

  #[test]
  fn authenticated_request_round_trips_over_a_unix_socket() {
    use std::os::unix::fs::PermissionsExt;

    let (mut server, token, _) = test_server(false);
    assert_eq!(
      server.endpoint.metadata().unwrap().permissions().mode() & 0o777,
      0o600
    );
    let request = JsonRpcRequest {
      id: "macos-round-trip".to_string(),
      method: "app.inspect".to_string(),
      params: serde_json::json!({}),
    };

    let response = call_with_timeout(
      server.endpoint.to_str().unwrap(),
      &token,
      &request,
      Duration::from_secs(5),
    )
    .unwrap();

    assert_eq!(response["id"], "macos-round-trip");
    assert_eq!(response["result"]["platform"], "macos");
    let directory = server.endpoint.parent().unwrap().to_path_buf();
    server.stop();
    drop(server);
    std::fs::remove_dir_all(directory).unwrap();
  }

  #[test]
  fn invalid_launch_token_returns_an_unattributed_authentication_error() {
    let (mut server, _, _) = test_server(false);
    let wrong_token = generate_launch_token().unwrap();
    let request = JsonRpcRequest {
      id: "wrong-token".to_string(),
      method: "app.inspect".to_string(),
      params: serde_json::json!({}),
    };

    let response = call_with_timeout(
      server.endpoint.to_str().unwrap(),
      &wrong_token,
      &request,
      Duration::from_secs(5),
    )
    .unwrap();

    assert_eq!(response["id"], "");
    assert_eq!(response["error"]["data"]["reason"], "unauthorized");
    let directory = server.endpoint.parent().unwrap().to_path_buf();
    server.stop();
    drop(server);
    std::fs::remove_dir_all(directory).unwrap();
  }

  #[test]
  fn delivery_wait_finishes_only_after_the_client_acknowledges_the_response() {
    let (mut server, token, responder) = test_server(true);
    let request = JsonRpcRequest {
      id: "macos-delivery".to_string(),
      method: "config.import".to_string(),
      params: serde_json::json!({}),
    };

    let response = call_with_timeout(
      server.endpoint.to_str().unwrap(),
      &token,
      &request,
      Duration::from_secs(5),
    )
    .unwrap();

    assert_eq!(response["result"]["persisted"], true);
    let completion = responder.completion.lock().unwrap().take().unwrap();
    assert!(completion.join().unwrap().is_ok());
    let directory = server.endpoint.parent().unwrap().to_path_buf();
    server.stop();
    drop(server);
    std::fs::remove_dir_all(directory).unwrap();
  }
}
