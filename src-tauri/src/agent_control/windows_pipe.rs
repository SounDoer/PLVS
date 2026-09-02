use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::c_void;
use std::fmt;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;
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
  CreateFileW, ReadFile, WriteFile, FILE_ATTRIBUTE_NORMAL, FILE_FLAG_FIRST_PIPE_INSTANCE,
  OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
};
use windows_sys::Win32::System::Pipes::{
  ConnectNamedPipe, CreateNamedPipeW, PeekNamedPipe, SetNamedPipeHandleState, WaitNamedPipeW,
  PIPE_NOWAIT, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
  PIPE_UNLIMITED_INSTANCES,
};
use windows_sys::Win32::System::Threading::{
  GetCurrentProcess, GetCurrentProcessId, OpenProcessToken,
};

use super::broker::{
  AgentControlState, Broker, BrokerErrorReason, TauriFrontendEmitter, DEFAULT_MAX_PENDING_REQUESTS,
  DEFAULT_RESPONSE_TIMEOUT,
};
use super::discovery::{
  descriptor_path, endpoint_name, generate_launch_token, parse_descriptor,
  write_descriptor_atomic_at, AgentControlDescriptor, DescriptorApp, DiscoveryError, LaunchToken,
};
use super::protocol::{
  encode_response, parse_request, JsonRpcError, JsonRpcRequest, JsonRpcResponse, ProtocolError,
  MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
};

const FRAME_PREFIX_BYTES: usize = 4;
const AUTH_ENVELOPE_OVERHEAD: usize = 1024;
const MAX_WIRE_REQUEST_BYTES: usize = MAX_REQUEST_BYTES + AUTH_ENVELOPE_OVERHEAD;
const IO_TIMEOUT: Duration = Duration::from_secs(2);
const RETRY_DELAY: Duration = Duration::from_millis(2);
const MAX_CLIENT_WORKERS: usize = 8;
const PIPE_BUFFER_BYTES: u32 = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PipeErrorReason {
  EmptyFrame,
  FrameTooLarge,
  TruncatedFrame,
  TrailingPayload,
  IoTimeout,
  InvalidUtf8,
  InvalidEnvelope,
  Unauthorized,
  ConnectionFailed,
  Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PipeError {
  pub reason: PipeErrorReason,
  pub message: String,
}

impl PipeError {
  fn new(reason: PipeErrorReason, message: impl Into<String>) -> Self {
    Self {
      reason,
      message: message.into(),
    }
  }

  fn rpc_error(&self) -> JsonRpcError {
    let code = match self.reason {
      PipeErrorReason::Unauthorized => -32020,
      PipeErrorReason::FrameTooLarge => -32021,
      PipeErrorReason::IoTimeout => -32022,
      PipeErrorReason::ConnectionFailed => -32023,
      _ => -32600,
    };
    JsonRpcError {
      code,
      message: self.message.clone(),
      data: serde_json::json!({ "reason": self.reason }),
    }
  }
}

impl fmt::Display for PipeError {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    formatter.write_str(&self.message)
  }
}

impl std::error::Error for PipeError {}

impl From<io::Error> for PipeError {
  fn from(error: io::Error) -> Self {
    Self::new(
      PipeErrorReason::Io,
      format!("Named-pipe I/O failed: {error}"),
    )
  }
}

fn read_exact_until<R: Read>(
  reader: &mut R,
  buffer: &mut [u8],
  deadline: Instant,
) -> Result<(), PipeError> {
  let mut offset = 0;
  while offset < buffer.len() {
    match reader.read(&mut buffer[offset..]) {
      Ok(0) => {
        return Err(PipeError::new(
          PipeErrorReason::TruncatedFrame,
          "The named-pipe frame ended before its declared length.",
        ))
      }
      Ok(count) => offset += count,
      Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
        if Instant::now() >= deadline {
          return Err(PipeError::new(
            PipeErrorReason::IoTimeout,
            "The named-pipe frame did not arrive before the timeout.",
          ));
        }
        thread::sleep(RETRY_DELAY);
      }
      Err(error) => return Err(error.into()),
    }
  }
  Ok(())
}

fn read_frame<R: Read>(reader: &mut R, max_bytes: usize) -> Result<Vec<u8>, PipeError> {
  let deadline = Instant::now() + IO_TIMEOUT;
  let mut prefix = [0_u8; FRAME_PREFIX_BYTES];
  read_exact_until(reader, &mut prefix, deadline)?;
  let length = u32::from_le_bytes(prefix) as usize;
  if length == 0 {
    return Err(PipeError::new(
      PipeErrorReason::EmptyFrame,
      "Named-pipe frames cannot be empty.",
    ));
  }
  if length > max_bytes {
    return Err(PipeError::new(
      PipeErrorReason::FrameTooLarge,
      format!("Named-pipe frame exceeds the {max_bytes}-byte limit."),
    ));
  }

  let mut payload = vec![0_u8; length];
  read_exact_until(reader, &mut payload, deadline)?;
  let mut trailing = [0_u8; 1];
  match reader.read(&mut trailing) {
    Ok(0) => {}
    Ok(_) => {
      return Err(PipeError::new(
        PipeErrorReason::TrailingPayload,
        "Named-pipe connection contains data after its single frame.",
      ))
    }
    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
    Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {}
    Err(error) => return Err(error.into()),
  }
  Ok(payload)
}

fn write_frame<W: Write>(
  writer: &mut W,
  payload: &[u8],
  max_bytes: usize,
) -> Result<(), PipeError> {
  if payload.is_empty() {
    return Err(PipeError::new(
      PipeErrorReason::EmptyFrame,
      "Named-pipe frames cannot be empty.",
    ));
  }
  if payload.len() > max_bytes || payload.len() > u32::MAX as usize {
    return Err(PipeError::new(
      PipeErrorReason::FrameTooLarge,
      format!("Named-pipe frame exceeds the {max_bytes}-byte limit."),
    ));
  }
  writer.write_all(&(payload.len() as u32).to_le_bytes())?;
  writer.write_all(payload)?;
  writer.flush()?;
  Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthenticatedEnvelope {
  token: String,
  request: Value,
}

#[derive(Serialize)]
struct OutgoingEnvelope<'a> {
  token: &'a str,
  request: &'a JsonRpcRequest,
}

fn decode_authenticated_request(
  bytes: &[u8],
  expected_token: &LaunchToken,
) -> Result<JsonRpcRequest, PipeError> {
  if std::str::from_utf8(bytes).is_err() {
    return Err(PipeError::new(
      PipeErrorReason::InvalidUtf8,
      "The named-pipe payload is not valid UTF-8.",
    ));
  }
  let envelope: AuthenticatedEnvelope = serde_json::from_slice(bytes).map_err(|_| {
    PipeError::new(
      PipeErrorReason::InvalidEnvelope,
      "The named-pipe authentication envelope is malformed.",
    )
  })?;
  let expected = expected_token.expose().as_bytes();
  let provided = envelope.token.as_bytes();
  if provided.len() != expected.len() || !bool::from(provided.ct_eq(expected)) {
    return Err(PipeError::new(
      PipeErrorReason::Unauthorized,
      "The named-pipe authentication token is invalid.",
    ));
  }

  let request_bytes = serde_json::to_vec(&envelope.request).map_err(|_| {
    PipeError::new(
      PipeErrorReason::InvalidEnvelope,
      "The JSON-RPC request could not be encoded.",
    )
  })?;
  parse_request(&request_bytes).map_err(protocol_pipe_error)
}

fn protocol_pipe_error(error: ProtocolError) -> PipeError {
  PipeError::new(PipeErrorReason::InvalidEnvelope, error.message)
}

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
    Ok(())
  }
}

fn error_response(error: JsonRpcError) -> JsonRpcResponse {
  JsonRpcResponse::error("", error)
}

fn handle_client(mut pipe: NamedPipe, token: LaunchToken, broker: Broker) {
  let response = match read_frame(&mut pipe, MAX_WIRE_REQUEST_BYTES)
    .and_then(|bytes| decode_authenticated_request(&bytes, &token))
  {
    Ok(request) => match broker.dispatch(request) {
      Ok(mut pending) => match pending.wait_until(|| !pipe.is_connected()) {
        Ok(response) => response,
        Err(error) if error.reason == BrokerErrorReason::ClientDisconnected => return,
        Err(error) => error_response(error.rpc_error()),
      },
      Err(error) => error_response(error.rpc_error()),
    },
    Err(error) => error_response(error.rpc_error()),
  };

  if let Ok(encoded) = encode_response(&response) {
    let _ = write_frame(&mut pipe, &encoded, MAX_RESPONSE_BYTES);
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

pub fn call(
  endpoint: &str,
  token: &LaunchToken,
  request: &JsonRpcRequest,
) -> Result<Value, PipeError> {
  let handle = connect_client(endpoint, IO_TIMEOUT).map_err(|error| {
    PipeError::new(
      PipeErrorReason::ConnectionFailed,
      format!("Unable to connect to the PLVS agent-control endpoint: {error}"),
    )
  })?;
  let mut pipe = NamedPipe { handle };
  pipe.set_nonblocking()?;
  let payload = serde_json::to_vec(&OutgoingEnvelope {
    token: token.expose(),
    request,
  })
  .map_err(|_| {
    PipeError::new(
      PipeErrorReason::InvalidEnvelope,
      "Unable to encode the authenticated request envelope.",
    )
  })?;
  write_frame(&mut pipe, &payload, MAX_WIRE_REQUEST_BYTES)?;
  let response = read_frame(&mut pipe, MAX_RESPONSE_BYTES)?;
  serde_json::from_slice(&response).map_err(|_| {
    PipeError::new(
      PipeErrorReason::InvalidEnvelope,
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

pub fn start_for_app(app: &tauri::App) -> Result<(), String> {
  let token = generate_launch_token().map_err(|error| error.to_string())?;
  let identifier = env!("PLVS_APP_ID");
  let endpoint = endpoint_name(identifier);
  let emitter = Arc::new(TauriFrontendEmitter::new(app.handle().clone()));
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
    schema_version: super::discovery::DESCRIPTOR_SCHEMA_VERSION,
    protocol_version: super::protocol::PROTOCOL_VERSION,
    app: DescriptorApp {
      name: "PLVS Dev".to_string(),
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
  use std::io::Cursor;

  struct FragmentedReader {
    inner: Cursor<Vec<u8>>,
    chunk: usize,
  }

  impl Read for FragmentedReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
      let limit = buffer.len().min(self.chunk);
      self.inner.read(&mut buffer[..limit])
    }
  }

  #[derive(Default)]
  struct FragmentedWriter {
    bytes: Vec<u8>,
    chunk: usize,
  }

  impl Write for FragmentedWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
      let count = buffer.len().min(self.chunk);
      self.bytes.extend_from_slice(&buffer[..count]);
      Ok(count)
    }

    fn flush(&mut self) -> io::Result<()> {
      Ok(())
    }
  }

  fn framed(payload: &[u8]) -> Vec<u8> {
    let mut bytes = (payload.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(payload);
    bytes
  }

  #[test]
  fn framing_handles_fragmented_reads_and_writes() {
    let payload = br#"{"jsonrpc":"2.0"}"#;
    let mut reader = FragmentedReader {
      inner: Cursor::new(framed(payload)),
      chunk: 2,
    };
    assert_eq!(read_frame(&mut reader, 1024).unwrap(), payload);

    let mut writer = FragmentedWriter {
      bytes: Vec::new(),
      chunk: 3,
    };
    write_frame(&mut writer, payload, 1024).unwrap();
    assert_eq!(writer.bytes, framed(payload));
  }

  #[test]
  fn framing_rejects_zero_oversized_truncated_and_trailing_payloads() {
    assert_eq!(
      read_frame(&mut Cursor::new(0_u32.to_le_bytes()), 16)
        .unwrap_err()
        .reason,
      PipeErrorReason::EmptyFrame
    );
    assert_eq!(
      read_frame(&mut Cursor::new(17_u32.to_le_bytes()), 16)
        .unwrap_err()
        .reason,
      PipeErrorReason::FrameTooLarge
    );
    assert_eq!(
      read_frame(&mut Cursor::new(framed(b"short")), 4)
        .unwrap_err()
        .reason,
      PipeErrorReason::FrameTooLarge
    );
    let mut truncated = 5_u32.to_le_bytes().to_vec();
    truncated.extend_from_slice(b"no");
    assert_eq!(
      read_frame(&mut Cursor::new(truncated), 16)
        .unwrap_err()
        .reason,
      PipeErrorReason::TruncatedFrame
    );
    let mut trailing = framed(b"ok");
    trailing.push(b'x');
    assert_eq!(
      read_frame(&mut Cursor::new(trailing), 16)
        .unwrap_err()
        .reason,
      PipeErrorReason::TrailingPayload
    );
  }

  #[test]
  fn authentication_precedes_json_rpc_dispatch_and_rejects_invalid_utf8() {
    let token = generate_launch_token().unwrap();
    let wrong = generate_launch_token().unwrap();
    let unauthorized = serde_json::to_vec(&serde_json::json!({
      "token": wrong.expose(),
      "request": { "not": "json-rpc" }
    }))
    .unwrap();
    assert_eq!(
      decode_authenticated_request(&unauthorized, &token)
        .unwrap_err()
        .reason,
      PipeErrorReason::Unauthorized
    );
    assert_eq!(
      decode_authenticated_request(&[0xff, 0xfe], &token)
        .unwrap_err()
        .reason,
      PipeErrorReason::InvalidUtf8
    );
  }

  #[test]
  fn authentic_envelope_round_trips_a_request_and_response_limits_are_enforced() {
    let token = generate_launch_token().unwrap();
    let request = JsonRpcRequest {
      id: "req-1".to_string(),
      method: "app.inspect".to_string(),
      params: serde_json::json!({}),
    };
    let bytes = serde_json::to_vec(&OutgoingEnvelope {
      token: token.expose(),
      request: &request,
    })
    .unwrap();
    assert_eq!(
      decode_authenticated_request(&bytes, &token).unwrap(),
      request
    );

    let mut sink = FragmentedWriter {
      bytes: Vec::new(),
      chunk: 8,
    };
    assert_eq!(
      write_frame(&mut sink, &[0; 17], 16).unwrap_err().reason,
      PipeErrorReason::FrameTooLarge
    );
  }

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
    let payload = serde_json::to_vec(&OutgoingEnvelope {
      token: token.expose(),
      request: &request,
    })
    .unwrap();

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
}
