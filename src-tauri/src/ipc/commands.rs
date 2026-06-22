//! `#[tauri::command]` handlers (Phase 2: capture + DSP → Channel / Events).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};

use crate::audio::capture::AudioCapture;
use crate::audio::cpal_backend;
use crate::audio::device::DeviceInfo;
use crate::audio::AppAudioBackend;
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::{
  AnalysisRequests, AudioDevicePreview, AudioFramePayload, EngineStateChanged, FrameSubscribers,
  SpectrumAnalysisChannel,
};
use crate::state::AppState;

const MAX_SPECTRUM_ANALYSIS_REQUESTS: usize = 4;
const MAX_VECTORSCOPE_ANALYSIS_REQUESTS: usize = 4;

#[tauri::command]
pub fn list_audio_devices() -> Result<Vec<DeviceInfo>, String> {
  AudioCapture::list_devices(&AppAudioBackend)
}

#[tauri::command]
pub fn preview_audio_device(device_id: String) -> Result<AudioDevicePreview, String> {
  let (label, _id_key, sample_rate_hz, channels) = cpal_backend::preview_device(&device_id)?;
  Ok(AudioDevicePreview {
    label,
    sample_rate_hz,
    channels,
  })
}

/// If `device_id` is an old format-based `lb-*` / `cap-*` v1 hash, resolve it and return the current v2 id;
/// [`None`] if unknown or unplugged (caller may fall back to `"default"`).
#[tauri::command]
pub fn migrate_capture_device_id(device_id: String) -> Result<Option<String>, String> {
  if device_id.is_empty() || device_id == "default" {
    return Ok(None);
  }
  let list = AudioCapture::list_devices(&AppAudioBackend)?;
  if list.iter().any(|d| d.id == device_id) {
    return Ok(Some(device_id.clone()));
  }
  let (_label, id_key, sr, ch) = match cpal_backend::preview_device(&device_id) {
    Ok(v) => v,
    Err(_) => return Ok(None),
  };
  if let Some(id) = cpal_backend::loopback_list_id_for_row(&id_key, ch, sr)? {
    return Ok(Some(id));
  }
  if let Some(id) = cpal_backend::capture_list_id_for_row(&id_key, ch, sr)? {
    return Ok(Some(id));
  }
  Ok(None)
}

#[tauri::command]
pub fn audio_start(
  app: AppHandle,
  device_id: String,
  on_frame: tauri::ipc::Channel<AudioFramePayload>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  {
    let mut g = state
      .inner()
      .capture
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    *g = None;
  }
  {
    let mut s = state
      .inner()
      .frame_subscribers
      .lock()
      .map_err(|_| "frame subscribers lock poisoned".to_string())?;
    *s = None;
  }
  // Fresh session: frame seq restarts at 0 in the bridge, so the ack counter must too — otherwise
  // a leftover high ack from the previous session would mask the new backlog.
  state
    .inner()
    .frame_ack_seq
    .store(0, std::sync::atomic::Ordering::Relaxed);
  let pool: FrameSubscribers = Arc::new(std::sync::Mutex::new(HashMap::new()));
  {
    let mut p = pool
      .lock()
      .map_err(|_| "frame subscriber map poisoned".to_string())?;
    p.insert("main".to_string(), on_frame);
  }
  {
    let mut slot = state
      .inner()
      .frame_subscribers
      .lock()
      .map_err(|_| "frame subscribers lock poisoned".to_string())?;
    *slot = Some(pool.clone());
  }
  // Channel layout is auto-resolved from channel count on the capture thread; no user override.
  let layout = Arc::new(Mutex::new(ChannelLayoutSetting::Auto));
  let loudness_weights = state.inner().loudness_weights.clone();
  let dialogue_gating = state.inner().dialogue_gating_enabled.clone();
  let session = AudioCapture::start_session(
    &AppAudioBackend,
    &device_id,
    pool,
    app.clone(),
    layout,
    loudness_weights,
    dialogue_gating,
  )?;
  {
    let mut g = state
      .inner()
      .capture
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    *g = Some(session);
  }
  if let Ok((sr, _ch)) = cpal_backend::device_default_format(&device_id) {
    let _ = app.emit("sample-rate-changed", sr);
  }
  let _ = app.emit(
    "engine-state-changed",
    EngineStateChanged {
      state: "running".into(),
      error: None,
    },
  );
  Ok(())
}

pub fn parse_spectrum_view(s: &str) -> Result<crate::dsp::SpectrumView, String> {
  use crate::dsp::SpectrumView;
  match s {
    "combined" => Ok(SpectrumView::Combined),
    "lr" => Ok(SpectrumView::Lr),
    "ms" => Ok(SpectrumView::Ms),
    other => Err(format!("unknown spectrum_view: {other}")),
  }
}

fn expected_spectrum_request_key(
  channel: &SpectrumAnalysisChannel,
  view: &str,
) -> Result<String, String> {
  parse_spectrum_view(view)?;
  Ok(match channel {
    SpectrumAnalysisChannel::Pair { x, y } => format!("spectrum:pair:{x}:{y}:{view}"),
    SpectrumAnalysisChannel::Single { ch } => format!("spectrum:single:{ch}:combined"),
  })
}

fn validate_analysis_request_key(key: &str, label: &str) -> Result<(), String> {
  if key.is_empty() {
    return Err(format!("{label} request key cannot be empty"));
  }
  if key.len() > 128 {
    return Err(format!("{label} request key cannot exceed 128 bytes"));
  }
  Ok(())
}

fn validate_analysis_requests(requests: &AnalysisRequests) -> Result<(), String> {
  if requests.spectrum.len() > MAX_SPECTRUM_ANALYSIS_REQUESTS {
    return Err(format!(
      "spectrum request count cannot exceed {MAX_SPECTRUM_ANALYSIS_REQUESTS}"
    ));
  }
  if requests.vectorscope.len() > MAX_VECTORSCOPE_ANALYSIS_REQUESTS {
    return Err(format!(
      "vectorscope request count cannot exceed {MAX_VECTORSCOPE_ANALYSIS_REQUESTS}"
    ));
  }

  for request in &requests.spectrum {
    validate_analysis_request_key(&request.key, "spectrum")?;
    let expected = expected_spectrum_request_key(&request.channel, &request.view)?;
    if request.key != expected {
      return Err(format!(
        "spectrum request key mismatch: expected {expected}, got {}",
        request.key
      ));
    }
  }

  for request in &requests.vectorscope {
    validate_analysis_request_key(&request.key, "vectorscope")?;
    let expected = format!("vectorscope:pair:{}:{}", request.x, request.y);
    if request.key != expected {
      return Err(format!(
        "vectorscope request key mismatch: expected {expected}, got {}",
        request.key
      ));
    }
  }
  Ok(())
}

/// Store the active per-instance analysis request set requested by the workspace UI.
#[tauri::command]
pub fn set_analysis_requests(
  requests: AnalysisRequests,
  state: State<'_, AppState>,
) -> Result<(), String> {
  validate_analysis_requests(&requests)?;
  let mut g = state
    .inner()
    .analysis_requests
    .lock()
    .map_err(|_| "analysis requests lock poisoned".to_string())?;
  *g = requests;
  Ok(())
}

fn validate_loudness_weights(weights: &[f64]) -> Result<(), String> {
  if weights.is_empty() {
    return Err("loudness weights cannot be empty".to_string());
  }
  if weights.len() > 64 {
    return Err("loudness weights cannot exceed 64 channels".to_string());
  }
  if weights.iter().any(|w| !w.is_finite() || *w < 0.0) {
    return Err("loudness weights must be finite non-negative numbers".to_string());
  }
  Ok(())
}

pub(crate) fn apply_dialogue_gating(flag: &std::sync::Arc<std::sync::Mutex<bool>>, enabled: bool) {
  if let Ok(mut g) = flag.lock() {
    *g = enabled;
  }
}

#[tauri::command]
pub fn set_loudness_weights(
  weights: Option<Vec<f64>>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  if let Some(ref ws) = weights {
    validate_loudness_weights(ws)?;
  }
  let mut g = state
    .inner()
    .loudness_weights
    .lock()
    .map_err(|_| "loudness weights lock poisoned".to_string())?;
  *g = weights;
  Ok(())
}

#[tauri::command]
pub fn set_dialogue_gating(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
  apply_dialogue_gating(&state.inner().dialogue_gating_enabled, enabled);
  Ok(())
}

/// UI heartbeat: records the highest frame `seq` the webview has finished processing. The capture
/// bridge reads it to bound how many frames it sends ahead of a possibly-stalled UI. Monotonic:
/// out-of-order or stale acks are ignored.
#[tauri::command]
pub fn ack_frames(seq: u64, state: State<'_, AppState>) -> Result<(), String> {
  state
    .inner()
    .frame_ack_seq
    .fetch_max(seq, std::sync::atomic::Ordering::Relaxed);
  Ok(())
}

#[tauri::command]
pub fn audio_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  let mut g = state
    .inner()
    .capture
    .lock()
    .map_err(|_| "state lock poisoned".to_string())?;
  *g = None;
  {
    let mut s = state
      .inner()
      .frame_subscribers
      .lock()
      .map_err(|_| "frame subscribers lock poisoned".to_string())?;
    *s = None;
  }
  let _ = app.emit(
    "engine-state-changed",
    EngineStateChanged {
      state: "stopped".into(),
      error: None,
    },
  );
  Ok(())
}

/// Reset DSP state (peak maxima + history accumulators) on the capture thread to match UI Clear
/// for the native path, then emit `meter-history-cleared`.
#[tauri::command]
pub fn clear_audio_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  {
    let g = state
      .inner()
      .capture
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    if let Some(sess) = g.as_ref() {
      sess.request_clear_peak_history();
    }
  }
  let _ = app.emit("meter-history-cleared", ());
  Ok(())
}

/// `running` or `stopped`.
#[tauri::command]
pub fn get_engine_state(state: State<'_, AppState>) -> Result<String, String> {
  let g = state
    .inner()
    .capture
    .lock()
    .map_err(|_| "state lock poisoned".to_string())?;
  Ok(if g.is_some() {
    "running".into()
  } else {
    "stopped".into()
  })
}

#[cfg(test)]
mod tests {
  use super::validate_loudness_weights;
  use crate::ipc::types::{
    AnalysisRequests, SpectrumAnalysisChannel, SpectrumAnalysisRequest, VectorscopeAnalysisRequest,
  };

  #[test]
  fn loudness_weights_validation_accepts_finite_non_negative_vectors() {
    assert!(validate_loudness_weights(&[1.0, 0.0, 1.4125375446]).is_ok());
  }

  #[test]
  fn loudness_weights_validation_rejects_empty_vectors() {
    assert!(validate_loudness_weights(&[]).is_err());
  }

  #[test]
  fn loudness_weights_validation_rejects_negative_values() {
    assert!(validate_loudness_weights(&[1.0, -1.0]).is_err());
  }

  #[test]
  fn loudness_weights_validation_rejects_nan_values() {
    assert!(validate_loudness_weights(&[1.0, f64::NAN]).is_err());
  }

  #[test]
  fn loudness_weights_validation_rejects_overlong_vectors() {
    let weights = vec![1.0; 65];
    assert!(validate_loudness_weights(&weights).is_err());
  }

  #[test]
  fn set_dialogue_gating_updates_shared_flag() {
    let flag = std::sync::Arc::new(std::sync::Mutex::new(false));
    super::apply_dialogue_gating(&flag, true);
    assert!(*flag.lock().unwrap());
    super::apply_dialogue_gating(&flag, false);
    assert!(!*flag.lock().unwrap());
  }

  #[test]
  fn analysis_requests_validation_accepts_frontend_keys() {
    let requests = AnalysisRequests {
      spectrum: vec![
        SpectrumAnalysisRequest {
          key: "spectrum:pair:0:1:lr".to_string(),
          channel: SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
          view: "lr".to_string(),
        },
        SpectrumAnalysisRequest {
          key: "spectrum:single:2:combined".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 2 },
          view: "combined".to_string(),
        },
      ],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:0:1".to_string(),
        x: 0,
        y: 1,
      }],
    };
    assert!(super::validate_analysis_requests(&requests).is_ok());
  }

  #[test]
  fn analysis_requests_validation_rejects_mismatched_keys() {
    let requests = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: "spectrum:pair:0:1:combined".to_string(),
        channel: SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
        view: "ms".to_string(),
      }],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:1:2".to_string(),
        x: 0,
        y: 1,
      }],
    };
    assert!(super::validate_analysis_requests(&requests).is_err());
  }

  #[test]
  fn analysis_requests_validation_rejects_over_cap_requests() {
    let requests = AnalysisRequests {
      spectrum: (0..=super::MAX_SPECTRUM_ANALYSIS_REQUESTS)
        .map(|idx| SpectrumAnalysisRequest {
          key: format!("spectrum:single:{idx}:combined"),
          channel: SpectrumAnalysisChannel::Single { ch: idx as u16 },
          view: "combined".to_string(),
        })
        .collect(),
      vectorscope: vec![],
    };
    assert!(super::validate_analysis_requests(&requests).is_err());
  }

  #[test]
  fn analysis_request_keys_match_shared_fixture() {
    // Parity guard against the JS deriver: the Rust validator must accept exactly the request-key
    // strings recorded in the shared fixture. The JS test (src/analysis/analysisRequestKeyFormat.test.js)
    // asserts the same file, so the key grammar cannot drift on one side unnoticed.
    let raw = include_str!(concat!(
      env!("CARGO_MANIFEST_DIR"),
      "/../shared/analysis-request-key-fixtures.json"
    ));
    let fixture: serde_json::Value = serde_json::from_str(raw).expect("fixture parses");

    for entry in fixture["spectrum"].as_array().expect("spectrum array") {
      let key = entry["key"].as_str().unwrap().to_string();
      let view = entry["view"].as_str().unwrap().to_string();
      let channel = if entry["type"] == "single" {
        SpectrumAnalysisChannel::Single {
          ch: entry["ch"].as_u64().unwrap() as u16,
        }
      } else {
        SpectrumAnalysisChannel::Pair {
          x: entry["x"].as_u64().unwrap() as u16,
          y: entry["y"].as_u64().unwrap() as u16,
        }
      };
      let requests = AnalysisRequests {
        spectrum: vec![SpectrumAnalysisRequest { key, channel, view }],
        vectorscope: vec![],
      };
      assert!(
        super::validate_analysis_requests(&requests).is_ok(),
        "spectrum fixture entry {entry:?} rejected by validator"
      );
    }

    for entry in fixture["vectorscope"]
      .as_array()
      .expect("vectorscope array")
    {
      let requests = AnalysisRequests {
        spectrum: vec![],
        vectorscope: vec![VectorscopeAnalysisRequest {
          key: entry["key"].as_str().unwrap().to_string(),
          x: entry["x"].as_u64().unwrap() as u16,
          y: entry["y"].as_u64().unwrap() as u16,
        }],
      };
      assert!(
        super::validate_analysis_requests(&requests).is_ok(),
        "vectorscope fixture entry {entry:?} rejected by validator"
      );
    }
  }

  #[test]
  fn parse_spectrum_view_maps_strings() {
    use crate::dsp::SpectrumView;
    use crate::ipc::commands::parse_spectrum_view;
    assert_eq!(
      parse_spectrum_view("combined").unwrap(),
      SpectrumView::Combined
    );
    assert_eq!(parse_spectrum_view("lr").unwrap(), SpectrumView::Lr);
    assert_eq!(parse_spectrum_view("ms").unwrap(), SpectrumView::Ms);
    assert!(parse_spectrum_view("bogus").is_err());
  }
}
