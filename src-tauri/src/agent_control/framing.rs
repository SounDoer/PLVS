use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::thread;
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;

use super::discovery::LaunchToken;
use super::protocol::{parse_request, JsonRpcRequest, ProtocolError, MAX_REQUEST_BYTES};
use super::transport::{TransportError, TransportErrorReason};

const FRAME_PREFIX_BYTES: usize = 4;
// Windows `PIPE_NOWAIT` writes must fit in the free pipe buffer. Keeping shared writes below half
// the platform's 64 KiB pipe buffer also gives the Unix-socket transport bounded write slices.
const WRITE_CHUNK_BYTES: usize = 32 * 1024;
const AUTH_ENVELOPE_OVERHEAD: usize = 1024;
pub(crate) const MAX_WIRE_REQUEST_BYTES: usize = MAX_REQUEST_BYTES + AUTH_ENVELOPE_OVERHEAD;
pub(crate) const IO_TIMEOUT: Duration = Duration::from_secs(2);
pub(crate) const RETRY_DELAY: Duration = Duration::from_millis(2);

fn read_exact_until<R: Read>(
  reader: &mut R,
  buffer: &mut [u8],
  deadline: Instant,
) -> Result<(), TransportError> {
  let mut offset = 0;
  while offset < buffer.len() {
    match reader.read(&mut buffer[offset..]) {
      Ok(0) => {
        return Err(TransportError::new(
          TransportErrorReason::TruncatedFrame,
          "The agent-control frame ended before its declared length.",
        ))
      }
      Ok(count) => offset += count,
      Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
        if Instant::now() >= deadline {
          return Err(TransportError::new(
            TransportErrorReason::IoTimeout,
            "The agent-control frame did not arrive before the timeout.",
          ));
        }
        thread::sleep(RETRY_DELAY);
      }
      Err(error) => return Err(error.into()),
    }
  }
  Ok(())
}

fn write_all_until<W: Write>(
  writer: &mut W,
  payload: &[u8],
  deadline: Instant,
) -> Result<(), TransportError> {
  let mut offset = 0;
  while offset < payload.len() {
    let end = payload.len().min(offset + WRITE_CHUNK_BYTES);
    let stalled = match writer.write(&payload[offset..end]) {
      Ok(0) => true,
      Ok(count) => {
        offset += count;
        false
      }
      Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => true,
      Err(error) => return Err(error.into()),
    };
    if stalled {
      if Instant::now() >= deadline {
        return Err(TransportError::new(
          TransportErrorReason::IoTimeout,
          "The agent-control frame was not accepted before the timeout.",
        ));
      }
      thread::sleep(RETRY_DELAY);
    }
  }
  Ok(())
}

pub(crate) fn read_frame<R: Read>(
  reader: &mut R,
  max_bytes: usize,
) -> Result<Vec<u8>, TransportError> {
  read_frame_with_timeout(reader, max_bytes, IO_TIMEOUT)
}

pub(crate) fn read_frame_with_timeout<R: Read>(
  reader: &mut R,
  max_bytes: usize,
  timeout: Duration,
) -> Result<Vec<u8>, TransportError> {
  let deadline = Instant::now() + timeout;
  let mut prefix = [0_u8; FRAME_PREFIX_BYTES];
  read_exact_until(reader, &mut prefix, deadline)?;
  let length = u32::from_le_bytes(prefix) as usize;
  if length == 0 {
    return Err(TransportError::new(
      TransportErrorReason::EmptyFrame,
      "Agent-control frames cannot be empty.",
    ));
  }
  if length > max_bytes {
    return Err(TransportError::new(
      TransportErrorReason::FrameTooLarge,
      format!("Agent-control frame exceeds the {max_bytes}-byte limit."),
    ));
  }

  let mut payload = vec![0_u8; length];
  read_exact_until(reader, &mut payload, deadline)?;
  let mut trailing = [0_u8; 1];
  match reader.read(&mut trailing) {
    Ok(0) => {}
    Ok(_) => {
      return Err(TransportError::new(
        TransportErrorReason::TrailingPayload,
        "Agent-control connection contains data after its single frame.",
      ))
    }
    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
    Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {}
    Err(error) => return Err(error.into()),
  }
  Ok(payload)
}

pub(crate) fn write_frame<W: Write>(
  writer: &mut W,
  payload: &[u8],
  max_bytes: usize,
) -> Result<(), TransportError> {
  if payload.is_empty() {
    return Err(TransportError::new(
      TransportErrorReason::EmptyFrame,
      "Agent-control frames cannot be empty.",
    ));
  }
  if payload.len() > max_bytes || payload.len() > u32::MAX as usize {
    return Err(TransportError::new(
      TransportErrorReason::FrameTooLarge,
      format!("Agent-control frame exceeds the {max_bytes}-byte limit."),
    ));
  }
  let deadline = Instant::now() + IO_TIMEOUT;
  write_all_until(writer, &(payload.len() as u32).to_le_bytes(), deadline)?;
  write_all_until(writer, payload, deadline)?;
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

pub(crate) fn encode_authenticated_request(
  token: &LaunchToken,
  request: &JsonRpcRequest,
) -> Result<Vec<u8>, TransportError> {
  serde_json::to_vec(&OutgoingEnvelope {
    token: token.expose(),
    request,
  })
  .map_err(|_| {
    TransportError::new(
      TransportErrorReason::InvalidEnvelope,
      "Unable to encode the authenticated request envelope.",
    )
  })
}

pub(crate) fn decode_authenticated_request(
  bytes: &[u8],
  expected_token: &LaunchToken,
) -> Result<JsonRpcRequest, TransportError> {
  if std::str::from_utf8(bytes).is_err() {
    return Err(TransportError::new(
      TransportErrorReason::InvalidUtf8,
      "The agent-control payload is not valid UTF-8.",
    ));
  }
  let envelope: AuthenticatedEnvelope = serde_json::from_slice(bytes).map_err(|_| {
    TransportError::new(
      TransportErrorReason::InvalidEnvelope,
      "The agent-control authentication envelope is malformed.",
    )
  })?;
  let expected = expected_token.expose().as_bytes();
  let provided = envelope.token.as_bytes();
  if provided.len() != expected.len() || !bool::from(provided.ct_eq(expected)) {
    return Err(TransportError::new(
      TransportErrorReason::Unauthorized,
      "The agent-control authentication token is invalid.",
    ));
  }

  let request_bytes = serde_json::to_vec(&envelope.request).map_err(|_| {
    TransportError::new(
      TransportErrorReason::InvalidEnvelope,
      "The JSON-RPC request could not be encoded.",
    )
  })?;
  parse_request(&request_bytes).map_err(protocol_error)
}

fn protocol_error(error: ProtocolError) -> TransportError {
  TransportError::new(TransportErrorReason::InvalidEnvelope, error.message)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::agent_control::discovery::generate_launch_token;
  use std::io::{self, Cursor};

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
  fn fragmented_frames_round_trip() {
    let payload = vec![42_u8; 96 * 1024];
    let mut writer = FragmentedWriter {
      bytes: Vec::new(),
      chunk: 3,
    };
    write_frame(&mut writer, &payload, payload.len()).unwrap();
    assert_eq!(writer.bytes, framed(&payload));

    let mut reader = FragmentedReader {
      inner: Cursor::new(writer.bytes),
      chunk: 2,
    };
    assert_eq!(read_frame(&mut reader, payload.len()).unwrap(), payload);
  }

  #[test]
  fn rejects_empty_oversized_truncated_and_trailing_frames() {
    assert_eq!(
      write_frame(&mut Vec::new(), &[], 10).unwrap_err().reason,
      TransportErrorReason::EmptyFrame
    );
    assert_eq!(
      write_frame(&mut Vec::new(), &[1, 2], 1).unwrap_err().reason,
      TransportErrorReason::FrameTooLarge
    );
    assert_eq!(
      read_frame(&mut Cursor::new([4, 0, 0, 0, 1, 2]), 10)
        .unwrap_err()
        .reason,
      TransportErrorReason::TruncatedFrame
    );
    let mut trailing = framed(b"ok");
    trailing.push(b'x');
    assert_eq!(
      read_frame(&mut Cursor::new(trailing), 10)
        .unwrap_err()
        .reason,
      TransportErrorReason::TrailingPayload
    );
  }

  #[test]
  fn authentication_precedes_json_rpc_validation() {
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
      TransportErrorReason::Unauthorized
    );
    assert_eq!(
      decode_authenticated_request(&[0xff, 0xfe], &token)
        .unwrap_err()
        .reason,
      TransportErrorReason::InvalidUtf8
    );
  }

  #[test]
  fn authenticated_envelope_round_trips() {
    let token = generate_launch_token().unwrap();
    let request = JsonRpcRequest {
      id: "req-1".to_string(),
      method: "app.inspect".to_string(),
      params: serde_json::json!({}),
    };
    let bytes = encode_authenticated_request(&token, &request).unwrap();
    assert!(bytes.len() <= MAX_WIRE_REQUEST_BYTES);
    assert_eq!(
      decode_authenticated_request(&bytes, &token).unwrap(),
      request
    );
  }
}
