use serde_json::Value;
use std::ffi::c_void;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::Manager;
use windows_sys::core::PWSTR;
use windows_sys::Win32::Foundation::{
  CloseHandle, LocalFree, ERROR_BROKEN_PIPE, ERROR_NO_DATA, ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED,
  ERROR_PIPE_LISTENING, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::Authorization::{
  ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{
  GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{
  CreateFileW, FlushFileBuffers, ReadFile, WriteFile, FILE_ATTRIBUTE_NORMAL,
  FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
};
use windows_sys::Win32::System::Pipes::{
  ConnectNamedPipe, CreateNamedPipeW, PeekNamedPipe, SetNamedPipeHandleState, WaitNamedPipeW,
  PIPE_NOWAIT, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
  PIPE_UNLIMITED_INSTANCES,
};
use windows_sys::Win32::System::Threading::{
  GetCurrentProcess, GetCurrentProcessId, OpenProcessToken,
};

use crate::agent_control::broker::{
  AgentControlState, Broker, BrokerError, BrokerErrorReason, TauriFrontendEmitter,
  DEFAULT_MAX_PENDING_REQUESTS, DEFAULT_RESPONSE_TIMEOUT,
};
use crate::agent_control::discovery::{
  descriptor_path, endpoint_name, generate_launch_token, parse_descriptor,
  write_descriptor_atomic_at, AgentControlDescriptor, DescriptorApp, DiscoveryError, LaunchToken,
};
use crate::agent_control::framing::{
  decode_authenticated_request, encode_authenticated_request, read_frame, read_frame_with_timeout,
  write_frame, IO_TIMEOUT, MAX_WIRE_REQUEST_BYTES,
};
use crate::agent_control::protocol::{
  encode_response, JsonRpcError, JsonRpcRequest, JsonRpcResponse, MAX_RESPONSE_BYTES,
};
use crate::agent_control::transport::{TransportError, TransportErrorReason, MAX_CLIENT_WORKERS};

const PIPE_BUFFER_BYTES: u32 = 64 * 1024;

fn wide(value: &str) -> Vec<u16> {
  value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn pipe_path(endpoint: &str) -> String {
  format!(r"\\.\pipe\{endpoint}")
}

struct OwnedHandle(HANDLE);

unsafe impl Send for OwnedHandle {}

impl Drop for OwnedHandle {
  fn drop(&mut self) {
    if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
      unsafe {
        CloseHandle(self.0);
      }
    }
  }
}

struct PipeSecurity {
  descriptor: *mut c_void,
  attributes: SECURITY_ATTRIBUTES,
}

impl Drop for PipeSecurity {
  fn drop(&mut self) {
    if !self.descriptor.is_null() {
      unsafe {
        LocalFree(self.descriptor);
      }
    }
  }
}

fn current_user_sid_string() -> io::Result<String> {
  let mut token: HANDLE = null_mut();
  if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
    return Err(io::Error::last_os_error());
  }
  let token = OwnedHandle(token);

  let mut needed = 0_u32;
  unsafe {
    GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut needed);
  }
  if needed == 0 {
    return Err(io::Error::last_os_error());
  }
  let word_size = std::mem::size_of::<usize>();
  let mut buffer = vec![0_usize; (needed as usize).div_ceil(word_size)];
  if unsafe {
    GetTokenInformation(
      token.0,
      TokenUser,
      buffer.as_mut_ptr().cast(),
      needed,
      &mut needed,
    )
  } == 0
  {
    return Err(io::Error::last_os_error());
  }
  let token_user = unsafe { &*(buffer.as_ptr().cast::<TOKEN_USER>()) };
  let mut sid_wide: PWSTR = null_mut();
  if unsafe { ConvertSidToStringSidW(token_user.User.Sid, &mut sid_wide) } == 0 {
    return Err(io::Error::last_os_error());
  }
  let mut length = 0;
  while unsafe { *sid_wide.add(length) } != 0 {
    length += 1;
  }
  let sid = String::from_utf16(unsafe { std::slice::from_raw_parts(sid_wide, length) })
    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "current-user SID is invalid"));
  unsafe {
    LocalFree(sid_wide.cast());
  }
  sid
}

fn current_user_security() -> io::Result<PipeSecurity> {
  let sid = current_user_sid_string()?;
  let sddl = wide(&format!("D:P(A;;GA;;;{sid})(A;;GA;;;SY)"));
  let mut descriptor = null_mut();
  if unsafe {
    ConvertStringSecurityDescriptorToSecurityDescriptorW(
      sddl.as_ptr(),
      SDDL_REVISION_1,
      &mut descriptor,
      null_mut(),
    )
  } == 0
  {
    return Err(io::Error::last_os_error());
  }
  Ok(PipeSecurity {
    descriptor,
    attributes: SECURITY_ATTRIBUTES {
      nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
      lpSecurityDescriptor: descriptor,
      bInheritHandle: 0,
    },
  })
}

struct NamedPipe {
  handle: OwnedHandle,
}

unsafe impl Send for NamedPipe {}

impl NamedPipe {
  fn create(endpoint: &str, first_instance: bool) -> io::Result<Self> {
    let path = wide(&pipe_path(endpoint));
    let security = current_user_security()?;
    let mut open_mode = PIPE_ACCESS_DUPLEX;
    if first_instance {
      open_mode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
    }
    let handle = unsafe {
      CreateNamedPipeW(
        path.as_ptr(),
        open_mode,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_REJECT_REMOTE_CLIENTS,
        PIPE_UNLIMITED_INSTANCES,
        PIPE_BUFFER_BYTES,
        PIPE_BUFFER_BYTES,
        IO_TIMEOUT.as_millis() as u32,
        &security.attributes,
      )
    };
    if handle == INVALID_HANDLE_VALUE {
      return Err(io::Error::last_os_error());
    }
    Ok(Self {
      handle: OwnedHandle(handle),
    })
  }

  fn connect(&self) -> io::Result<()> {
    if unsafe { ConnectNamedPipe(self.handle.0, null_mut()) } != 0 {
      return Ok(());
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(ERROR_PIPE_CONNECTED as i32) {
      Ok(())
    } else {
      Err(error)
    }
  }

  fn set_nonblocking(&self) -> io::Result<()> {
    let mode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
    if unsafe { SetNamedPipeHandleState(self.handle.0, &mode, null(), null()) } == 0 {
      Err(io::Error::last_os_error())
    } else {
      Ok(())
    }
  }

  fn is_connected(&self) -> bool {
    unsafe {
      PeekNamedPipe(
        self.handle.0,
        null_mut(),
        0,
        null_mut(),
        null_mut(),
        null_mut(),
      ) != 0
    }
  }
}

impl Read for NamedPipe {
  fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
    let mut read = 0_u32;
    if unsafe {
      ReadFile(
        self.handle.0,
        buffer.as_mut_ptr(),
        buffer.len().min(u32::MAX as usize) as u32,
        &mut read,
        null_mut(),
      )
    } != 0
    {
      return Ok(read as usize);
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error().map(|code| code as u32) {
      Some(ERROR_NO_DATA | ERROR_PIPE_LISTENING) => Err(io::ErrorKind::WouldBlock.into()),
      Some(ERROR_BROKEN_PIPE) => Err(io::ErrorKind::UnexpectedEof.into()),
      _ => Err(error),
    }
  }
}

impl Write for NamedPipe {
  fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
    let mut written = 0_u32;
    if unsafe {
      WriteFile(
        self.handle.0,
        buffer.as_ptr(),
        buffer.len().min(u32::MAX as usize) as u32,
        &mut written,
        null_mut(),
      )
    } != 0
    {
      return Ok(written as usize);
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error().map(|code| code as u32) {
      Some(ERROR_NO_DATA | ERROR_PIPE_LISTENING) => Err(io::ErrorKind::WouldBlock.into()),
      Some(ERROR_BROKEN_PIPE) => Err(io::ErrorKind::BrokenPipe.into()),
      _ => Err(error),
    }
  }

  fn flush(&mut self) -> io::Result<()> {
    if unsafe { FlushFileBuffers(self.handle.0) } != 0 {
      Ok(())
    } else {
      Err(io::Error::last_os_error())
    }
  }
}

/// A failure that could not be attributed to a request. `parse_request` rejects an empty id, so no
/// real request can ever carry one — the client reads it as "server-level error, not a stray reply
/// to some other request", and reports the error the server actually sent.
fn unattributed_error_response(error: JsonRpcError) -> JsonRpcResponse {
  JsonRpcResponse::error("", error)
}

fn handle_client(mut pipe: NamedPipe, token: LaunchToken, broker: Broker) {
  let mut pending_delivery = None;
  let response = match read_frame(&mut pipe, MAX_WIRE_REQUEST_BYTES)
    .and_then(|bytes| decode_authenticated_request(&bytes, &token))
  {
    Ok(request) => {
      // Keep the id: a broker-level failure is still an answer to *this* request, and dropping it
      // would leave the client unable to tell the real reason from a mismatched reply.
      let request_id = request.id.clone();
      match broker.dispatch(request) {
        Ok(mut pending) => match pending.wait_with_delivery_until(|| !pipe.is_connected()) {
          Ok(delivery) => {
            let response = delivery.response.clone();
            pending_delivery = Some(delivery);
            response
          }
          Err(error) if error.reason == BrokerErrorReason::ClientDisconnected => return,
          Err(error) => JsonRpcResponse::error(request_id, error.rpc_error()),
        },
        Err(error) => JsonRpcResponse::error(request_id, error.rpc_error()),
      }
    }
    // The frame never parsed into a request, so there is no id to attribute this to.
    Err(error) => unattributed_error_response(error.rpc_error()),
  };

  let await_delivery = pending_delivery
    .as_ref()
    .is_some_and(|delivery| delivery.requires_delivery_confirmation());
  let delivered = encode_response(&response)
    .map_err(|error| error.to_string())
    .and_then(|encoded| {
      write_frame(&mut pipe, &encoded, MAX_RESPONSE_BYTES).map_err(|error| error.to_string())
    })
    // On the server side this waits until the client has read every buffered response byte. That
    // is the acknowledgement needed by commands which relaunch only after their result is safe.
    .and_then(|_| {
      if await_delivery {
        pipe.flush().map_err(|error| error.to_string())
      } else {
        Ok(())
      }
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

pub struct PipeServer {
  endpoint: String,
  shutdown: Arc<AtomicBool>,
  listener: Option<JoinHandle<()>>,
  broker: Broker,
  descriptor: Option<(PathBuf, AgentControlDescriptor)>,
}

impl PipeServer {
  pub fn bind(endpoint: String, token: LaunchToken, broker: Broker) -> io::Result<Self> {
    let first = NamedPipe::create(&endpoint, true)?;
    let shutdown = Arc::new(AtomicBool::new(false));
    let active_workers = Arc::new(AtomicUsize::new(0));
    let thread_endpoint = endpoint.clone();
    let thread_shutdown = shutdown.clone();
    let thread_broker = broker.clone();
    let listener = thread::Builder::new()
      .name("agent-control-listener".to_string())
      .spawn(move || {
        let mut current = first;
        loop {
          if let Err(error) = current.connect() {
            if !thread_shutdown.load(Ordering::Acquire) {
              log::warn!("agent-control pipe accept failed: {error}");
            }
            break;
          }
          if thread_shutdown.load(Ordering::Acquire) {
            break;
          }
          if let Err(error) = current.set_nonblocking() {
            log::warn!("agent-control pipe mode failed: {error}");
            break;
          }
          let next = match NamedPipe::create(&thread_endpoint, false) {
            Ok(next) => next,
            Err(error) => {
              log::warn!("agent-control next pipe instance failed: {error}");
              break;
            }
          };

          if active_workers.load(Ordering::Acquire) < MAX_CLIENT_WORKERS {
            active_workers.fetch_add(1, Ordering::AcqRel);
            let worker_count = active_workers.clone();
            let spawn_count = active_workers.clone();
            let worker_token = token.clone();
            let worker_broker = thread_broker.clone();
            if thread::Builder::new()
              .name("agent-control-client".to_string())
              .spawn(move || {
                handle_client(current, worker_token, worker_broker);
                worker_count.fetch_sub(1, Ordering::AcqRel);
              })
              .is_err()
            {
              spawn_count.fetch_sub(1, Ordering::AcqRel);
            }
          }
          current = next;
        }
      })?;

    Ok(Self {
      endpoint,
      shutdown,
      listener: Some(listener),
      broker,
      descriptor: None,
    })
  }

  fn own_descriptor(&mut self, path: PathBuf, descriptor: AgentControlDescriptor) {
    self.descriptor = Some((path, descriptor));
  }

  pub fn stop(&mut self) {
    if self.shutdown.swap(true, Ordering::AcqRel) {
      return;
    }
    let _ = connect_client(&self.endpoint, Duration::from_millis(250));
    if let Some(listener) = self.listener.take() {
      let _ = listener.join();
    }
    self.broker.shutdown();
    self.remove_owned_descriptor();
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

impl Drop for PipeServer {
  fn drop(&mut self) {
    self.stop();
  }
}

fn connect_client(endpoint: &str, timeout: Duration) -> io::Result<OwnedHandle> {
  let path = wide(&pipe_path(endpoint));
  let deadline = Instant::now() + timeout;
  loop {
    let handle = unsafe {
      CreateFileW(
        path.as_ptr(),
        GENERIC_READ | GENERIC_WRITE,
        0,
        null(),
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        null_mut(),
      )
    };
    if handle != INVALID_HANDLE_VALUE {
      return Ok(OwnedHandle(handle));
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() != Some(ERROR_PIPE_BUSY as i32) || Instant::now() >= deadline {
      return Err(error);
    }
    unsafe {
      WaitNamedPipeW(path.as_ptr(), 25);
    }
  }
}

pub fn call_with_timeout(
  endpoint: &str,
  token: &LaunchToken,
  request: &JsonRpcRequest,
  response_timeout: Duration,
) -> Result<Value, TransportError> {
  let handle = connect_client(endpoint, IO_TIMEOUT).map_err(|error| {
    TransportError::new(
      TransportErrorReason::ConnectionFailed,
      format!("Unable to connect to the PLVS agent-control endpoint: {error}"),
    )
  })?;
  let mut pipe = NamedPipe { handle };
  pipe.set_nonblocking()?;
  let payload = encode_authenticated_request(token, request)?;
  write_frame(&mut pipe, &payload, MAX_WIRE_REQUEST_BYTES)?;
  let response = read_frame_with_timeout(&mut pipe, MAX_RESPONSE_BYTES, response_timeout)?;
  serde_json::from_slice(&response).map_err(|_| {
    TransportError::new(
      TransportErrorReason::InvalidEnvelope,
      "PLVS returned a malformed JSON-RPC response.",
    )
  })
}

#[derive(Default)]
pub struct PipeServerState {
  server: Mutex<Option<PipeServer>>,
}

impl PipeServerState {
  fn install(&self, server: PipeServer) {
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

impl Drop for PipeServerState {
  fn drop(&mut self) {
    if let Ok(server) = self.server.get_mut() {
      if let Some(mut server) = server.take() {
        server.stop();
      }
    }
  }
}

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
  let token = generate_launch_token().map_err(|error| error.to_string())?;
  let identifier = env!("PLVS_APP_ID");
  let endpoint = endpoint_name(identifier);
  let emitter = Arc::new(TauriFrontendEmitter::new(app.clone()));
  let broker = Broker::new(
    emitter,
    DEFAULT_MAX_PENDING_REQUESTS,
    DEFAULT_RESPONSE_TIMEOUT,
  );
  let mut server = PipeServer::bind(endpoint.clone(), token.clone(), broker.clone())
    .map_err(|error| format!("unable to bind {endpoint}: {error}"))?;

  let path = descriptor_path().map_err(|error| error.to_string())?;
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
    pid: unsafe { GetCurrentProcessId() },
    endpoint,
    token,
    started_at,
  };
  write_descriptor_atomic_at(&path, &descriptor)
    .map_err(|error: DiscoveryError| error.to_string())?;
  server.own_descriptor(path, descriptor);
  app.state::<AgentControlState>().install(broker);
  app.state::<PipeServerState>().install(server);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::agent_control::broker::{FrontendEmitter, FrontendOutcome};

  #[test]
  fn current_user_acl_can_be_constructed_for_the_pipe() {
    let security = current_user_security().unwrap();
    assert!(!security.descriptor.is_null());
    assert!(!current_user_sid_string().unwrap().is_empty());
  }

  #[derive(Default)]
  struct AutoResponder {
    broker: Mutex<Option<Broker>>,
    requests: AtomicUsize,
  }

  impl FrontendEmitter for AutoResponder {
    fn emit(&self, request: &JsonRpcRequest) -> Result<(), String> {
      self.requests.fetch_add(1, Ordering::AcqRel);
      self
        .broker
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .respond(
          &request.id,
          FrontendOutcome::Success(serde_json::json!({ "accepted": true })),
        )
        .map_err(|error| error.to_string())
    }
  }

  #[test]
  fn a_stalled_client_does_not_block_an_authenticated_second_client() {
    let token = generate_launch_token().unwrap();
    let endpoint = format!("plvs-agent-control-test-{}", &token.expose()[..16]);
    let responder = Arc::new(AutoResponder::default());
    let broker = Broker::new(responder.clone(), 4, Duration::from_secs(1));
    *responder.broker.lock().unwrap() = Some(broker.clone());
    broker.frontend_ready().unwrap();
    let mut server = PipeServer::bind(endpoint.clone(), token.clone(), broker).unwrap();

    let stalled = connect_client(&endpoint, Duration::from_secs(1)).unwrap();
    let client_handle = connect_client(&endpoint, Duration::from_secs(1)).unwrap();
    let mut client = NamedPipe {
      handle: client_handle,
    };
    client.set_nonblocking().unwrap();
    let request = JsonRpcRequest {
      id: "req-2".to_string(),
      method: "app.inspect".to_string(),
      params: serde_json::json!({}),
    };
    let payload = encode_authenticated_request(&token, &request).unwrap();

    write_frame(&mut client, &payload, MAX_WIRE_REQUEST_BYTES).unwrap();
    let response = read_frame(&mut client, MAX_RESPONSE_BYTES).unwrap();
    let response: Value = serde_json::from_slice(&response).unwrap();

    assert_eq!(response["id"], "req-2");
    assert_eq!(response["result"]["accepted"], true);
    assert_eq!(responder.requests.load(Ordering::Acquire), 1);

    drop(stalled);
    drop(client);
    server.stop();
  }

  #[test]
  fn a_broker_level_failure_answers_with_the_requests_own_id() {
    let token = generate_launch_token().unwrap();
    let endpoint = format!("plvs-agent-control-test-{}", &token.expose()[..16]);
    let responder = Arc::new(AutoResponder::default());
    // Deliberately never made ready: the request cannot reach the frontend at all, which is the
    // class of failure whose reason used to be lost on the way back to the client.
    let broker = Broker::new(responder.clone(), 4, Duration::from_secs(1));
    let mut server = PipeServer::bind(endpoint.clone(), token.clone(), broker).unwrap();

    let client_handle = connect_client(&endpoint, Duration::from_secs(1)).unwrap();
    let mut client = NamedPipe {
      handle: client_handle,
    };
    client.set_nonblocking().unwrap();
    let request = JsonRpcRequest {
      id: "req-3".to_string(),
      method: "app.inspect".to_string(),
      params: serde_json::json!({}),
    };
    let payload = encode_authenticated_request(&token, &request).unwrap();

    write_frame(&mut client, &payload, MAX_WIRE_REQUEST_BYTES).unwrap();
    let response = read_frame(&mut client, MAX_RESPONSE_BYTES).unwrap();
    let response: Value = serde_json::from_slice(&response).unwrap();

    assert_eq!(response["id"], "req-3");
    assert_eq!(response["error"]["data"]["reason"], "frontendNotReady");

    drop(client);
    server.stop();
  }

  #[test]
  fn a_frame_that_never_parsed_answers_without_an_id() {
    let token = generate_launch_token().unwrap();
    let endpoint = format!("plvs-agent-control-test-{}", &token.expose()[16..32]);
    let responder = Arc::new(AutoResponder::default());
    let broker = Broker::new(responder.clone(), 4, Duration::from_secs(1));
    *responder.broker.lock().unwrap() = Some(broker.clone());
    broker.frontend_ready().unwrap();
    let mut server = PipeServer::bind(endpoint.clone(), token.clone(), broker).unwrap();

    let client_handle = connect_client(&endpoint, Duration::from_secs(1)).unwrap();
    let mut client = NamedPipe {
      handle: client_handle,
    };
    client.set_nonblocking().unwrap();
    write_frame(&mut client, b"{not json", MAX_WIRE_REQUEST_BYTES).unwrap();
    let response = read_frame(&mut client, MAX_RESPONSE_BYTES).unwrap();
    let response: Value = serde_json::from_slice(&response).unwrap();

    // No request was ever recovered, so there is nothing to attribute the failure to.
    assert_eq!(response["id"], "");
    assert!(response["error"]["code"].is_i64());

    drop(client);
    server.stop();
  }

  struct PayloadResponder {
    broker: Mutex<Option<Broker>>,
    reply: String,
    received: Mutex<Vec<JsonRpcRequest>>,
  }

  impl FrontendEmitter for PayloadResponder {
    fn emit(&self, request: &JsonRpcRequest) -> Result<(), String> {
      self.received.lock().unwrap().push(request.clone());
      self
        .broker
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .respond(
          &request.id,
          FrontendOutcome::Success(serde_json::json!({ "payload": self.reply })),
        )
        .map_err(|error| error.to_string())
    }
  }

  struct DeliveryResponder {
    broker: Mutex<Option<Broker>>,
    completion: Mutex<Option<JoinHandle<Result<(), BrokerError>>>>,
  }

  impl FrontendEmitter for DeliveryResponder {
    fn emit(&self, request: &JsonRpcRequest) -> Result<(), String> {
      let broker = self.broker.lock().unwrap().as_ref().unwrap().clone();
      let request_id = request.id.clone();
      let handle = thread::spawn(move || {
        broker.respond_and_wait_for_delivery(
          &request_id,
          FrontendOutcome::Success(serde_json::json!({ "persisted": true })),
        )
      });
      *self.completion.lock().unwrap() = Some(handle);
      Ok(())
    }
  }

  /// Non-uniform content, so a payload reassembled out of order fails as loudly as a truncated one.
  fn filler(bytes: usize) -> String {
    (0..bytes)
      .map(|index| char::from(b'a' + (index % 26) as u8))
      .collect()
  }

  /// One request/response exchange over a live endpoint, with both payload sizes under the caller's
  /// control. Returns the decoded response and the request the server actually parsed.
  fn exchange(request_payload: String, reply: String) -> (Value, JsonRpcRequest) {
    let token = generate_launch_token().unwrap();
    let endpoint = format!("plvs-agent-control-test-{}", &token.expose()[..16]);
    let responder = Arc::new(PayloadResponder {
      broker: Mutex::new(None),
      reply,
      received: Mutex::new(Vec::new()),
    });
    let broker = Broker::new(responder.clone(), 4, Duration::from_secs(5));
    *responder.broker.lock().unwrap() = Some(broker.clone());
    broker.frontend_ready().unwrap();
    let mut server = PipeServer::bind(endpoint.clone(), token.clone(), broker).unwrap();

    let client_handle = connect_client(&endpoint, Duration::from_secs(1)).unwrap();
    let mut client = NamedPipe {
      handle: client_handle,
    };
    client.set_nonblocking().unwrap();
    let request = JsonRpcRequest {
      id: "req-big".to_string(),
      method: "app.inspect".to_string(),
      params: serde_json::json!({ "payload": request_payload }),
    };
    let envelope = encode_authenticated_request(&token, &request).unwrap();

    write_frame(&mut client, &envelope, MAX_WIRE_REQUEST_BYTES).unwrap();
    let response = read_frame(&mut client, MAX_RESPONSE_BYTES).unwrap();
    let response: Value = serde_json::from_slice(&response).unwrap();
    let received = responder.received.lock().unwrap()[0].clone();

    drop(client);
    server.stop();
    (response, received)
  }

  #[test]
  fn delivery_aware_response_completes_only_after_the_client_reads_it() {
    let token = generate_launch_token().unwrap();
    let endpoint = format!("plvs-agent-control-test-{}", &token.expose()[..16]);
    let responder = Arc::new(DeliveryResponder {
      broker: Mutex::new(None),
      completion: Mutex::new(None),
    });
    let broker = Broker::new(responder.clone(), 4, Duration::from_secs(5));
    *responder.broker.lock().unwrap() = Some(broker.clone());
    broker.frontend_ready().unwrap();
    let mut server = PipeServer::bind(endpoint.clone(), token.clone(), broker).unwrap();
    let client_handle = connect_client(&endpoint, Duration::from_secs(1)).unwrap();
    let mut client = NamedPipe {
      handle: client_handle,
    };
    client.set_nonblocking().unwrap();
    let request = JsonRpcRequest {
      id: "delivery-aware".to_string(),
      method: "config.import".to_string(),
      params: serde_json::json!({}),
    };
    let envelope = encode_authenticated_request(&token, &request).unwrap();

    write_frame(&mut client, &envelope, MAX_WIRE_REQUEST_BYTES).unwrap();
    let response = read_frame(&mut client, MAX_RESPONSE_BYTES).unwrap();
    let response: Value = serde_json::from_slice(&response).unwrap();
    assert_eq!(response["result"]["persisted"], true);
    let completion = responder.completion.lock().unwrap().take().unwrap();
    assert!(completion.join().unwrap().is_ok());

    drop(client);
    server.stop();
  }

  #[test]
  fn a_response_larger_than_the_pipe_buffer_round_trips_intact() {
    let reply = filler(4 * PIPE_BUFFER_BYTES as usize);
    let (response, _) = exchange("small".to_string(), reply.clone());

    assert_eq!(response["id"], "req-big");
    assert_eq!(response["result"]["payload"], Value::String(reply));
  }

  #[test]
  fn a_request_larger_than_the_pipe_buffer_round_trips_intact() {
    // Stays under MAX_REQUEST_BYTES, which the protocol layer enforces independently.
    let payload = filler(8 * PIPE_BUFFER_BYTES as usize);
    let (response, received) = exchange(payload.clone(), "small".to_string());

    assert_eq!(received.params["payload"], Value::String(payload));
    assert_eq!(response["result"]["payload"], "small");
  }

  #[test]
  fn a_response_near_the_response_limit_round_trips_intact() {
    // The envelope around the payload is under 100 bytes, so this lands just below the limit.
    let reply = filler(MAX_RESPONSE_BYTES - 1024);
    let (response, _) = exchange("small".to_string(), reply.clone());

    assert_eq!(response["result"]["payload"], Value::String(reply));
  }

  #[test]
  fn a_frame_above_the_limit_is_rejected_rather_than_retried() {
    let token = generate_launch_token().unwrap();
    let endpoint = format!("plvs-agent-control-test-{}", &token.expose()[16..32]);
    // No request ever reaches the broker: the frame is refused before anything is written.
    let broker = Broker::new(
      Arc::new(AutoResponder::default()),
      4,
      Duration::from_secs(1),
    );
    let mut server = PipeServer::bind(endpoint.clone(), token.clone(), broker).unwrap();

    let client_handle = connect_client(&endpoint, Duration::from_secs(1)).unwrap();
    let mut client = NamedPipe {
      handle: client_handle,
    };
    client.set_nonblocking().unwrap();

    let started = Instant::now();
    let oversized = vec![b'x'; MAX_WIRE_REQUEST_BYTES + 1];
    assert_eq!(
      write_frame(&mut client, &oversized, MAX_WIRE_REQUEST_BYTES)
        .unwrap_err()
        .reason,
      TransportErrorReason::FrameTooLarge
    );
    // The retry loop must not turn the limit into a wait for the deadline.
    assert!(started.elapsed() < IO_TIMEOUT);

    drop(client);
    server.stop();
  }
}
