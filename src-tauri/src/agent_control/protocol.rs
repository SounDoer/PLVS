use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Map, Value};
use std::fmt;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_REQUEST_BYTES: usize = 256 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct JsonRpcRequest {
  pub id: String,
  pub method: String,
  pub params: Value,
}

impl Serialize for JsonRpcRequest {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    let mut state = serializer.serialize_struct("JsonRpcRequest", 4)?;
    state.serialize_field("jsonrpc", "2.0")?;
    state.serialize_field("id", &self.id)?;
    state.serialize_field("method", &self.method)?;
    state.serialize_field("params", &self.params)?;
    state.end()
  }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireRequest {
  jsonrpc: String,
  id: String,
  method: String,
  params: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProtocolErrorReason {
  MalformedJson,
  InvalidRequest,
  RequestTooLarge,
  ResponseTooLarge,
  SerializationFailed,
}

impl ProtocolErrorReason {
  pub const fn json_rpc_code(self) -> i64 {
    match self {
      Self::MalformedJson => -32700,
      Self::InvalidRequest => -32600,
      Self::RequestTooLarge => -32001,
      Self::ResponseTooLarge => -32002,
      Self::SerializationFailed => -32603,
    }
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError {
  pub reason: ProtocolErrorReason,
  pub message: String,
}

impl ProtocolError {
  pub fn new(reason: ProtocolErrorReason, message: impl Into<String>) -> Self {
    Self {
      reason,
      message: message.into(),
    }
  }

  pub fn rpc_error(&self) -> JsonRpcError {
    JsonRpcError {
      code: self.reason.json_rpc_code(),
      message: self.message.clone(),
      data: serde_json::json!({ "reason": self.reason, "layer": "transport" }),
    }
  }
}

impl fmt::Display for ProtocolError {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    formatter.write_str(&self.message)
  }
}

impl std::error::Error for ProtocolError {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JsonRpcError {
  pub code: i64,
  pub message: String,
  pub data: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
enum ResponsePayload {
  Success { result: Value },
  Error { error: JsonRpcError },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JsonRpcResponse {
  jsonrpc: &'static str,
  pub id: String,
  #[serde(flatten)]
  payload: ResponsePayload,
}

impl JsonRpcResponse {
  pub fn success(id: impl Into<String>, result: Value) -> Self {
    Self {
      jsonrpc: "2.0",
      id: id.into(),
      payload: ResponsePayload::Success { result },
    }
  }

  pub fn error(id: impl Into<String>, error: JsonRpcError) -> Self {
    Self {
      jsonrpc: "2.0",
      id: id.into(),
      payload: ResponsePayload::Error { error },
    }
  }
}

pub fn parse_request(bytes: &[u8]) -> Result<JsonRpcRequest, ProtocolError> {
  if bytes.len() > MAX_REQUEST_BYTES {
    return Err(ProtocolError::new(
      ProtocolErrorReason::RequestTooLarge,
      format!("Request exceeds the {MAX_REQUEST_BYTES}-byte limit."),
    ));
  }

  let wire = serde_json::from_slice::<WireRequest>(bytes).map_err(|error| {
    let reason = if error.is_syntax() || error.is_eof() {
      ProtocolErrorReason::MalformedJson
    } else {
      ProtocolErrorReason::InvalidRequest
    };
    ProtocolError::new(reason, "Invalid JSON-RPC request envelope.")
  })?;

  if wire.jsonrpc != "2.0" || wire.id.is_empty() || wire.method.is_empty() {
    return Err(ProtocolError::new(
      ProtocolErrorReason::InvalidRequest,
      "Invalid JSON-RPC request envelope.",
    ));
  }

  Ok(JsonRpcRequest {
    id: wire.id,
    method: wire.method,
    params: Value::Object(wire.params),
  })
}

pub fn encode_response(response: &JsonRpcResponse) -> Result<Vec<u8>, ProtocolError> {
  let encoded = serde_json::to_vec(response).map_err(|_| {
    ProtocolError::new(
      ProtocolErrorReason::SerializationFailed,
      "Unable to serialize the JSON-RPC response.",
    )
  })?;
  if encoded.len() > MAX_RESPONSE_BYTES {
    return Err(ProtocolError::new(
      ProtocolErrorReason::ResponseTooLarge,
      format!("Response exceeds the {MAX_RESPONSE_BYTES}-byte limit."),
    ));
  }
  Ok(encoded)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn request_json(extra: &str) -> Vec<u8> {
    format!(r#"{{"jsonrpc":"2.0","id":"req-1","method":"app.inspect","params":{{{extra}}}}}"#)
      .into_bytes()
  }

  #[test]
  fn parses_a_strict_json_rpc_request_envelope() {
    let request = parse_request(&request_json(r#""detail":"compact""#)).unwrap();
    assert_eq!(request.id, "req-1");
    assert_eq!(request.method, "app.inspect");
    assert_eq!(request.params, json!({ "detail": "compact" }));
  }

  #[test]
  fn rejects_malformed_or_non_conforming_envelopes() {
    let cases = [
      (b"{".as_slice(), ProtocolErrorReason::MalformedJson),
      (
        br#"{"jsonrpc":"1.0","id":"a","method":"x","params":{}}"#,
        ProtocolErrorReason::InvalidRequest,
      ),
      (
        br#"{"jsonrpc":"2.0","method":"x","params":{}}"#,
        ProtocolErrorReason::InvalidRequest,
      ),
      (
        br#"{"jsonrpc":"2.0","id":"a","params":{}}"#,
        ProtocolErrorReason::InvalidRequest,
      ),
      (
        br#"{"jsonrpc":"2.0","id":"a","method":"x","params":[]}"#,
        ProtocolErrorReason::InvalidRequest,
      ),
      (
        br#"{"jsonrpc":"2.0","id":"a","id":"b","method":"x","params":{}}"#,
        ProtocolErrorReason::InvalidRequest,
      ),
      (
        br#"{"jsonrpc":"2.0","id":"a","method":"x","params":{},"extra":true}"#,
        ProtocolErrorReason::InvalidRequest,
      ),
    ];

    for (input, reason) in cases {
      assert_eq!(parse_request(input).unwrap_err().reason, reason);
    }
  }

  #[test]
  fn protocol_reasons_have_stable_json_rpc_codes() {
    assert_eq!(ProtocolErrorReason::MalformedJson.json_rpc_code(), -32700);
    assert_eq!(ProtocolErrorReason::InvalidRequest.json_rpc_code(), -32600);
    assert_eq!(ProtocolErrorReason::RequestTooLarge.json_rpc_code(), -32001);
    assert_eq!(
      ProtocolErrorReason::ResponseTooLarge.json_rpc_code(),
      -32002
    );

    let rpc = ProtocolError::new(ProtocolErrorReason::RequestTooLarge, "too large").rpc_error();
    assert_eq!(rpc.code, -32001);
    assert_eq!(
      rpc.data,
      json!({ "reason": "requestTooLarge", "layer": "transport" })
    );
  }

  #[test]
  fn enforces_request_and_response_byte_limits() {
    let oversized_request = vec![b' '; MAX_REQUEST_BYTES + 1];
    assert_eq!(
      parse_request(&oversized_request).unwrap_err().reason,
      ProtocolErrorReason::RequestTooLarge
    );

    let response = JsonRpcResponse::success(
      "req-1",
      json!({
        "payload": "x".repeat(MAX_RESPONSE_BYTES)
      }),
    );
    assert_eq!(
      encode_response(&response).unwrap_err().reason,
      ProtocolErrorReason::ResponseTooLarge
    );
  }
}
