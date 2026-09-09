use serde::Serialize;
use serde_json::Value;
use std::fmt;
use std::io;
use std::time::Duration;

use super::discovery::AgentControlDescriptor;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use super::protocol::JsonRpcError;
use super::protocol::JsonRpcRequest;

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) const MAX_CLIENT_WORKERS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransportErrorReason {
  EmptyFrame,
  FrameTooLarge,
  TruncatedFrame,
  TrailingPayload,
  IoTimeout,
  InvalidUtf8,
  InvalidEnvelope,
  Unauthorized,
  ConnectionFailed,
  DeliveryFailed,
  Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TransportError {
  pub reason: TransportErrorReason,
  pub message: String,
}

impl TransportError {
  pub(crate) fn new(reason: TransportErrorReason, message: impl Into<String>) -> Self {
    Self {
      reason,
      message: message.into(),
    }
  }

  #[cfg(any(target_os = "windows", target_os = "macos"))]
  pub(crate) fn rpc_error(&self) -> JsonRpcError {
    let code = match self.reason {
      TransportErrorReason::Unauthorized => -32020,
      TransportErrorReason::FrameTooLarge => -32021,
      TransportErrorReason::IoTimeout => -32022,
      TransportErrorReason::ConnectionFailed => -32023,
      _ => -32600,
    };
    JsonRpcError {
      code,
      message: self.message.clone(),
      data: serde_json::json!({ "reason": self.reason, "layer": "transport" }),
    }
  }

  pub(crate) fn io(error: io::Error) -> Self {
    Self::new(
      TransportErrorReason::Io,
      format!("Agent-control transport I/O failed: {error}"),
    )
  }
}

impl fmt::Display for TransportError {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    formatter.write_str(&self.message)
  }
}

impl std::error::Error for TransportError {}

impl From<io::Error> for TransportError {
  fn from(error: io::Error) -> Self {
    Self::io(error)
  }
}

#[cfg(target_os = "windows")]
mod windows_pipe;
#[cfg(target_os = "windows")]
use windows_pipe as platform;

#[cfg(target_os = "macos")]
mod macos_socket;
#[cfg(target_os = "macos")]
use macos_socket as platform;

#[cfg(target_os = "windows")]
pub use platform::PipeServerState as ServerState;
#[cfg(target_os = "macos")]
pub use platform::ServerState;

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
#[derive(Default)]
pub struct ServerState(());

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
impl ServerState {
  pub fn stop(&self) {}

  pub fn is_running(&self) -> bool {
    false
  }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
  platform::start(app)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn start(_app: &tauri::AppHandle) -> Result<(), String> {
  Err("Agent Control is unavailable on this platform.".to_string())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn call_with_timeout(
  descriptor: &AgentControlDescriptor,
  request: &JsonRpcRequest,
  response_timeout: Duration,
) -> Result<Value, TransportError> {
  platform::call_with_timeout(
    &descriptor.endpoint,
    &descriptor.token,
    request,
    response_timeout,
  )
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn call_with_timeout(
  _descriptor: &AgentControlDescriptor,
  _request: &JsonRpcRequest,
  _response_timeout: Duration,
) -> Result<Value, TransportError> {
  Err(TransportError::new(
    TransportErrorReason::ConnectionFailed,
    "Live app control is unavailable on this platform.",
  ))
}
