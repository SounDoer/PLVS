use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

use super::protocol::{JsonRpcError, JsonRpcRequest, JsonRpcResponse};

pub const AGENT_CONTROL_REQUEST_EVENT: &str = "agent-control://request";
pub const DEFAULT_MAX_PENDING_REQUESTS: usize = 8;
pub const DEFAULT_RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

pub trait FrontendEmitter: Send + Sync {
  fn emit(&self, request: &JsonRpcRequest) -> Result<(), String>;
}

#[derive(Debug, Clone, PartialEq)]
pub enum FrontendOutcome {
  Success(Value),
  Error(JsonRpcError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BrokerErrorReason {
  FrontendNotReady,
  FrontendUnavailable,
  DuplicateRequest,
  Busy,
  DeliveryFailed,
  Timeout,
  ClientDisconnected,
  Shutdown,
  UnknownRequest,
  InvalidResponse,
  Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrokerError {
  pub reason: BrokerErrorReason,
  pub message: String,
}

impl BrokerError {
  pub fn new(reason: BrokerErrorReason, message: impl Into<String>) -> Self {
    Self {
      reason,
      message: message.into(),
    }
  }

  pub fn rpc_error(&self) -> JsonRpcError {
    let code = match self.reason {
      BrokerErrorReason::FrontendNotReady => -32003,
      BrokerErrorReason::FrontendUnavailable => -32004,
      BrokerErrorReason::DuplicateRequest => -32005,
      BrokerErrorReason::Busy => -32006,
      BrokerErrorReason::DeliveryFailed => -32007,
      BrokerErrorReason::Timeout => -32008,
      BrokerErrorReason::Shutdown => -32009,
      BrokerErrorReason::UnknownRequest => -32010,
      BrokerErrorReason::InvalidResponse => -32011,
      BrokerErrorReason::Disabled => -32012,
      BrokerErrorReason::ClientDisconnected => -32013,
    };
    JsonRpcError {
      code,
      message: self.message.clone(),
      data: serde_json::json!({ "reason": self.reason }),
    }
  }
}

impl fmt::Display for BrokerError {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    formatter.write_str(&self.message)
  }
}

impl std::error::Error for BrokerError {}

type PendingSender = SyncSender<Result<FrontendOutcome, BrokerError>>;

struct BrokerInner {
  ready: bool,
  shutdown: bool,
  pending: HashMap<String, PendingSender>,
}

struct BrokerCore {
  emitter: Arc<dyn FrontendEmitter>,
  max_pending: usize,
  response_timeout: Duration,
  inner: Mutex<BrokerInner>,
}

#[derive(Clone)]
pub struct Broker {
  core: Arc<BrokerCore>,
}

impl Broker {
  pub fn new(
    emitter: Arc<dyn FrontendEmitter>,
    max_pending: usize,
    response_timeout: Duration,
  ) -> Self {
    Self {
      core: Arc::new(BrokerCore {
        emitter,
        max_pending,
        response_timeout,
        inner: Mutex::new(BrokerInner {
          ready: false,
          shutdown: false,
          pending: HashMap::new(),
        }),
      }),
    }
  }

  pub fn frontend_ready(&self) -> Result<(), BrokerError> {
    let mut inner = self
      .core
      .inner
      .lock()
      .expect("agent-control broker poisoned");
    if inner.shutdown {
      return Err(BrokerError::new(
        BrokerErrorReason::Shutdown,
        "Agent control is shutting down.",
      ));
    }
    inner.ready = true;
    Ok(())
  }

  pub fn frontend_not_ready(&self) {
    self.fail_all(
      BrokerErrorReason::FrontendUnavailable,
      "The PLVS frontend is no longer available.",
      false,
    );
  }

  pub fn shutdown(&self) {
    self.fail_all(
      BrokerErrorReason::Shutdown,
      "Agent control is shutting down.",
      true,
    );
  }

  fn fail_all(&self, reason: BrokerErrorReason, message: &str, shutdown: bool) {
    let senders = {
      let mut inner = self
        .core
        .inner
        .lock()
        .expect("agent-control broker poisoned");
      inner.ready = false;
      if shutdown {
        inner.shutdown = true;
      }
      inner
        .pending
        .drain()
        .map(|(_, sender)| sender)
        .collect::<Vec<_>>()
    };
    for sender in senders {
      let _ = sender.send(Err(BrokerError::new(reason, message)));
    }
  }

  pub fn dispatch(&self, request: JsonRpcRequest) -> Result<PendingRequest, BrokerError> {
    let (sender, receiver) = mpsc::sync_channel(1);
    {
      let mut inner = self
        .core
        .inner
        .lock()
        .expect("agent-control broker poisoned");
      if inner.shutdown {
        return Err(BrokerError::new(
          BrokerErrorReason::Shutdown,
          "Agent control is shutting down.",
        ));
      }
      if !inner.ready {
        return Err(BrokerError::new(
          BrokerErrorReason::FrontendNotReady,
          "The PLVS frontend is not ready for agent control.",
        ));
      }
      if inner.pending.contains_key(&request.id) {
        return Err(BrokerError::new(
          BrokerErrorReason::DuplicateRequest,
          format!("Request ID {} is already in flight.", request.id),
        ));
      }
      if inner.pending.len() >= self.core.max_pending {
        return Err(BrokerError::new(
          BrokerErrorReason::Busy,
          "PLVS has reached the agent-control request limit.",
        ));
      }
      inner.pending.insert(request.id.clone(), sender);
    }

    if let Err(error) = self.core.emitter.emit(&request) {
      self.cancel(&request.id);
      return Err(BrokerError::new(
        BrokerErrorReason::DeliveryFailed,
        format!("Unable to deliver the request to the PLVS frontend: {error}"),
      ));
    }

    Ok(PendingRequest {
      request_id: request.id,
      receiver: Some(receiver),
      core: self.core.clone(),
      completed: false,
    })
  }

  pub fn respond(&self, request_id: &str, outcome: FrontendOutcome) -> Result<(), BrokerError> {
    let sender = self
      .core
      .inner
      .lock()
      .expect("agent-control broker poisoned")
      .pending
      .remove(request_id)
      .ok_or_else(|| {
        BrokerError::new(
          BrokerErrorReason::UnknownRequest,
          format!("Request ID {request_id} is not pending."),
        )
      })?;
    sender.send(Ok(outcome)).map_err(|_| {
      BrokerError::new(
        BrokerErrorReason::UnknownRequest,
        format!("Request ID {request_id} is no longer waiting."),
      )
    })
  }

  fn cancel(&self, request_id: &str) {
    self
      .core
      .inner
      .lock()
      .expect("agent-control broker poisoned")
      .pending
      .remove(request_id);
  }

  #[cfg(test)]
  fn pending_count(&self) -> usize {
    self
      .core
      .inner
      .lock()
      .expect("agent-control broker poisoned")
      .pending
      .len()
  }
}

pub struct PendingRequest {
  request_id: String,
  receiver: Option<Receiver<Result<FrontendOutcome, BrokerError>>>,
  core: Arc<BrokerCore>,
  completed: bool,
}

impl fmt::Debug for PendingRequest {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    formatter
      .debug_struct("PendingRequest")
      .field("request_id", &self.request_id)
      .finish_non_exhaustive()
  }
}

impl PendingRequest {
  pub fn wait(mut self) -> Result<JsonRpcResponse, BrokerError> {
    self.wait_until(|| false)
  }

  pub fn wait_until<F>(
    &mut self,
    mut client_disconnected: F,
  ) -> Result<JsonRpcResponse, BrokerError>
  where
    F: FnMut() -> bool,
  {
    let receiver = self.receiver.take().expect("pending receiver missing");
    let started = std::time::Instant::now();
    let poll_interval = Duration::from_millis(25);
    loop {
      let elapsed = started.elapsed();
      if elapsed >= self.core.response_timeout {
        self.cancel_pending();
        return Err(BrokerError::new(
          BrokerErrorReason::Timeout,
          "The PLVS frontend did not respond before the timeout.",
        ));
      }
      let remaining = self.core.response_timeout - elapsed;
      match receiver.recv_timeout(remaining.min(poll_interval)) {
        Ok(Ok(FrontendOutcome::Success(result))) => {
          self.completed = true;
          return Ok(JsonRpcResponse::success(self.request_id.clone(), result));
        }
        Ok(Ok(FrontendOutcome::Error(error))) => {
          self.completed = true;
          return Ok(JsonRpcResponse::error(self.request_id.clone(), error));
        }
        Ok(Err(error)) => {
          self.completed = true;
          return Err(error);
        }
        Err(RecvTimeoutError::Disconnected) => {
          self.completed = true;
          return Err(BrokerError::new(
            BrokerErrorReason::FrontendUnavailable,
            "The PLVS frontend response channel closed.",
          ));
        }
        Err(RecvTimeoutError::Timeout) if client_disconnected() => {
          self.cancel_pending();
          return Err(BrokerError::new(
            BrokerErrorReason::ClientDisconnected,
            "The agent-control client disconnected before the response was ready.",
          ));
        }
        Err(RecvTimeoutError::Timeout) => {}
      }
    }
  }

  fn cancel_pending(&mut self) {
    self
      .core
      .inner
      .lock()
      .expect("agent-control broker poisoned")
      .pending
      .remove(&self.request_id);
    self.completed = true;
  }
}

impl Drop for PendingRequest {
  fn drop(&mut self) {
    if !self.completed {
      self
        .core
        .inner
        .lock()
        .expect("agent-control broker poisoned")
        .pending
        .remove(&self.request_id);
    }
  }
}

pub struct TauriFrontendEmitter {
  app: tauri::AppHandle,
}

impl TauriFrontendEmitter {
  pub fn new(app: tauri::AppHandle) -> Self {
    Self { app }
  }
}

impl FrontendEmitter for TauriFrontendEmitter {
  fn emit(&self, request: &JsonRpcRequest) -> Result<(), String> {
    self
      .app
      .emit_to("main", AGENT_CONTROL_REQUEST_EVENT, request.clone())
      .map_err(|error| error.to_string())
  }
}

#[derive(Default)]
pub struct AgentControlState {
  broker: Mutex<Option<Broker>>,
}

impl AgentControlState {
  pub fn install(&self, broker: Broker) {
    *self.broker.lock().expect("agent-control state poisoned") = Some(broker);
  }

  pub fn broker(&self) -> Option<Broker> {
    self
      .broker
      .lock()
      .expect("agent-control state poisoned")
      .clone()
  }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrontendResponse {
  pub request_id: String,
  pub result: Option<Value>,
  pub error: Option<JsonRpcError>,
}

fn main_broker(window: &tauri::WebviewWindow, state: &AgentControlState) -> Result<Broker, String> {
  if !cfg!(feature = "dev-identity") {
    return Err("Agent control is disabled in this build.".to_string());
  }
  if window.label() != "main" {
    return Err("Only the main PLVS window can handle agent-control requests.".to_string());
  }
  state
    .broker()
    .ok_or_else(|| "Agent control is unavailable for this PLVS process.".to_string())
}

#[tauri::command]
pub fn agent_control_frontend_ready(
  window: tauri::WebviewWindow,
  state: tauri::State<'_, AgentControlState>,
) -> Result<(), String> {
  main_broker(&window, &state)?
    .frontend_ready()
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_control_frontend_not_ready(
  window: tauri::WebviewWindow,
  state: tauri::State<'_, AgentControlState>,
) -> Result<(), String> {
  main_broker(&window, &state)?.frontend_not_ready();
  Ok(())
}

#[tauri::command]
pub fn agent_control_respond(
  window: tauri::WebviewWindow,
  state: tauri::State<'_, AgentControlState>,
  response: FrontendResponse,
) -> Result<(), String> {
  let outcome = match (response.result, response.error) {
    (Some(result), None) => FrontendOutcome::Success(result),
    (None, Some(error)) => FrontendOutcome::Error(error),
    _ => {
      return Err(
        BrokerError::new(
          BrokerErrorReason::InvalidResponse,
          "A frontend response must contain exactly one of result or error.",
        )
        .to_string(),
      )
    }
  };
  main_broker(&window, &state)?
    .respond(&response.request_id, outcome)
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;
  use std::sync::Mutex;

  #[derive(Default)]
  struct FakeEmitter {
    requests: Mutex<Vec<JsonRpcRequest>>,
    fail: bool,
  }

  impl FrontendEmitter for FakeEmitter {
    fn emit(&self, request: &JsonRpcRequest) -> Result<(), String> {
      if self.fail {
        return Err("event unavailable".to_string());
      }
      self.requests.lock().unwrap().push(request.clone());
      Ok(())
    }
  }

  fn request(id: &str) -> JsonRpcRequest {
    JsonRpcRequest {
      id: id.to_string(),
      method: "app.inspect".to_string(),
      params: json!({}),
    }
  }

  fn broker(limit: usize, timeout: Duration) -> (Broker, Arc<FakeEmitter>) {
    let emitter = Arc::new(FakeEmitter::default());
    (Broker::new(emitter.clone(), limit, timeout), emitter)
  }

  #[test]
  fn starts_not_ready_and_does_not_queue_boot_requests() {
    let (broker, emitter) = broker(2, Duration::from_secs(1));
    let error = broker.dispatch(request("one")).unwrap_err();
    assert_eq!(error.reason, BrokerErrorReason::FrontendNotReady);
    assert_eq!(broker.pending_count(), 0);
    assert!(emitter.requests.lock().unwrap().is_empty());
  }

  #[test]
  fn bounds_pending_work_and_rejects_duplicate_ids() {
    let (broker, emitter) = broker(2, Duration::from_secs(1));
    broker.frontend_ready().unwrap();
    let first = broker.dispatch(request("one")).unwrap();
    assert_eq!(
      broker.dispatch(request("one")).unwrap_err().reason,
      BrokerErrorReason::DuplicateRequest
    );
    let second = broker.dispatch(request("two")).unwrap();
    assert_eq!(
      broker.dispatch(request("three")).unwrap_err().reason,
      BrokerErrorReason::Busy
    );
    assert_eq!(broker.pending_count(), 2);
    assert_eq!(emitter.requests.lock().unwrap().len(), 2);
    drop(first);
    drop(second);
    assert_eq!(broker.pending_count(), 0);
  }

  #[test]
  fn exactly_the_matching_response_resolves_a_request_once() {
    let (broker, _) = broker(2, Duration::from_secs(1));
    broker.frontend_ready().unwrap();
    let pending_one = broker.dispatch(request("one")).unwrap();
    let pending_two = broker.dispatch(request("two")).unwrap();

    assert_eq!(
      broker
        .respond("missing", FrontendOutcome::Success(json!({})))
        .unwrap_err()
        .reason,
      BrokerErrorReason::UnknownRequest
    );
    broker
      .respond("two", FrontendOutcome::Success(json!({ "revision": 4 })))
      .unwrap();
    let response = pending_two.wait().unwrap();
    assert_eq!(
      serde_json::to_value(response).unwrap()["result"]["revision"],
      4
    );
    assert_eq!(broker.pending_count(), 1);
    assert_eq!(
      broker
        .respond("two", FrontendOutcome::Success(json!({})))
        .unwrap_err()
        .reason,
      BrokerErrorReason::UnknownRequest
    );

    broker
      .respond(
        "one",
        FrontendOutcome::Error(JsonRpcError {
          code: -32004,
          message: "conflict".to_string(),
          data: json!({ "reason": "revisionConflict" }),
        }),
      )
      .unwrap();
    let response = pending_one.wait().unwrap();
    assert_eq!(
      serde_json::to_value(response).unwrap()["error"]["code"],
      -32004
    );
  }

  #[test]
  fn timeout_teardown_and_shutdown_remove_pending_entries() {
    let (broker, _) = broker(4, Duration::from_millis(1));
    broker.frontend_ready().unwrap();
    let timed_out = broker.dispatch(request("timeout")).unwrap();
    assert_eq!(
      timed_out.wait().unwrap_err().reason,
      BrokerErrorReason::Timeout
    );
    assert_eq!(broker.pending_count(), 0);

    let teardown = broker.dispatch(request("teardown")).unwrap();
    broker.frontend_not_ready();
    assert_eq!(
      teardown.wait().unwrap_err().reason,
      BrokerErrorReason::FrontendUnavailable
    );
    assert_eq!(broker.pending_count(), 0);

    broker.frontend_ready().unwrap();
    let shutdown = broker.dispatch(request("shutdown")).unwrap();
    broker.shutdown();
    assert_eq!(
      shutdown.wait().unwrap_err().reason,
      BrokerErrorReason::Shutdown
    );
    assert_eq!(broker.pending_count(), 0);
    assert_eq!(
      broker.frontend_ready().unwrap_err().reason,
      BrokerErrorReason::Shutdown
    );
  }

  #[test]
  fn failed_event_delivery_never_leaves_a_pending_request() {
    let emitter = Arc::new(FakeEmitter {
      requests: Mutex::new(Vec::new()),
      fail: true,
    });
    let broker = Broker::new(emitter, 2, Duration::from_secs(1));
    broker.frontend_ready().unwrap();
    assert_eq!(
      broker.dispatch(request("one")).unwrap_err().reason,
      BrokerErrorReason::DeliveryFailed
    );
    assert_eq!(broker.pending_count(), 0);
  }

  #[test]
  fn client_disconnect_cancels_the_pending_frontend_request() {
    let (broker, _) = broker(2, Duration::from_secs(1));
    broker.frontend_ready().unwrap();
    let mut pending = broker.dispatch(request("one")).unwrap();

    assert_eq!(
      pending.wait_until(|| true).unwrap_err().reason,
      BrokerErrorReason::ClientDisconnected
    );
    assert_eq!(broker.pending_count(), 0);
  }
}
