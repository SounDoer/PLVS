//! `#[tauri::command]` handlers (Phase 2: capture + DSP → Channel / Events).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};

use crate::audio::capture::AudioCapture;
use crate::audio::cpal_backend;
use crate::audio::device::DeviceInfo;
use crate::audio::AppAudioBackend;
use crate::dsp::speech::VadEngineKind;
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::{
  AnalysisRequests, AudioDevicePreview, AudioFramePayload, EngineStateChanged,
  FileAnalysisProbeResult, FrameSubscribers, SpectrumAnalysisChannel, StereoMapAnalysisPair,
};
use crate::state::{AppState, EngineSource};

const MAX_SPECTRUM_ANALYSIS_REQUESTS: usize = 4;
const MAX_VECTORSCOPE_ANALYSIS_REQUESTS: usize = 4;
const MAX_STEREO_MAP_ANALYSIS_REQUESTS: usize = 4;
const MAX_ANALYSIS_CHANNEL_INDEX: u16 = 63;

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
    // Stop any active source (live or file) before starting live capture; only one runs at a time.
    let mut source = state
      .inner()
      .source
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    *source = EngineSource::Stopped;
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
  let dialogue_vad_engine = state.inner().dialogue_vad_engine.clone();
  let session = AudioCapture::start_session(
    &AppAudioBackend,
    &device_id,
    pool,
    app.clone(),
    layout,
    loudness_weights,
    dialogue_gating,
    dialogue_vad_engine,
  )?;
  {
    let mut source = state
      .inner()
      .source
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    *source = EngineSource::Live(session);
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

/// Frequency-axis smoothing width. Wire values match `SPECTRUM_OCTAVE_SMOOTHING_OPTIONS`
/// in `src/lib/panelControls.js`.
pub fn parse_octave_smoothing(s: &str) -> Result<crate::dsp::OctaveSmoothing, String> {
  use crate::dsp::OctaveSmoothing;
  match s {
    "off" => Ok(OctaveSmoothing::Off),
    "1/12" => Ok(OctaveSmoothing::OneTwelfth),
    "1/6" => Ok(OctaveSmoothing::OneSixth),
    "1/3" => Ok(OctaveSmoothing::OneThird),
    other => Err(format!("unknown octave_smoothing: {other}")),
  }
}

fn expected_spectrum_request_key(
  channel: &SpectrumAnalysisChannel,
  view: &str,
  speed_percent: f64,
  tilt_db_per_octave: f64,
  octave_smoothing: &str,
) -> Result<String, String> {
  parse_spectrum_view(view)?;
  let smoothing = parse_octave_smoothing(octave_smoothing)?;
  if !speed_percent.is_finite() || !(0.0..=100.0).contains(&speed_percent) {
    return Err("spectrum speedPercent must be finite and between 0 and 100".to_string());
  }
  if !tilt_db_per_octave.is_finite() || !(0.0..=6.0).contains(&tilt_db_per_octave) {
    return Err("spectrum tiltDbPerOctave must be finite and between 0 and 6".to_string());
  }
  let speed = speed_percent.round() as i64;
  let tilt_centidb = (tilt_db_per_octave * 100.0).round() as i64;
  // Smoothing belongs in the key: it changes the row, and panels that share a key share one
  // meter — and therefore one smoothing setting, which they would otherwise fight over.
  let sm = smoothing.key_token();
  Ok(match channel {
    SpectrumAnalysisChannel::Pair { x, y } => {
      format!("spectrum:pair:{x}:{y}:{view}:sp{speed}:tilt{tilt_centidb}:sm{sm}")
    }
    SpectrumAnalysisChannel::Single { ch } => {
      format!("spectrum:single:{ch}:combined:sp{speed}:tilt{tilt_centidb}:sm{sm}")
    }
  })
}

fn expected_stereo_map_request_key(
  pair: &StereoMapAnalysisPair,
  speed_percent: f64,
  octave_smoothing: &str,
) -> Result<String, String> {
  if pair.first > MAX_ANALYSIS_CHANNEL_INDEX || pair.second > MAX_ANALYSIS_CHANNEL_INDEX {
    return Err(format!(
      "stereo map channel indices must be between 0 and {MAX_ANALYSIS_CHANNEL_INDEX}"
    ));
  }
  if pair.first == pair.second {
    return Err("stereo map pair must contain two different channels".to_string());
  }
  if !speed_percent.is_finite() || !(0.0..=100.0).contains(&speed_percent) {
    return Err("stereo map speedPercent must be finite and between 0 and 100".to_string());
  }
  let smoothing = parse_octave_smoothing(octave_smoothing)?;
  let speed = speed_percent.round() as i64;
  Ok(format!(
    "stereoMap:pair:{}:{}:sp{speed}:sm{}",
    pair.first,
    pair.second,
    smoothing.key_token()
  ))
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
  if requests.stereo_map.len() > MAX_STEREO_MAP_ANALYSIS_REQUESTS {
    return Err(format!(
      "stereo map request count cannot exceed {MAX_STEREO_MAP_ANALYSIS_REQUESTS}"
    ));
  }

  for request in &requests.spectrum {
    validate_analysis_request_key(&request.key, "spectrum")?;
    let expected = expected_spectrum_request_key(
      &request.channel,
      &request.view,
      request.speed_percent,
      request.tilt_db_per_octave,
      &request.octave_smoothing,
    )?;
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

  let mut stereo_map_keys = HashSet::with_capacity(requests.stereo_map.len());
  for request in &requests.stereo_map {
    validate_analysis_request_key(&request.key, "stereo map")?;
    if !stereo_map_keys.insert(request.key.as_str()) {
      return Err(format!("duplicate stereo map request key: {}", request.key));
    }
    let expected = expected_stereo_map_request_key(
      &request.pair,
      request.speed_percent,
      &request.octave_smoothing,
    )?;
    if request.key != expected {
      return Err(format!(
        "stereo map request key mismatch: expected {expected}, got {}",
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

pub(crate) fn apply_dialogue_vad_engine(
  engine: &std::sync::Arc<std::sync::Mutex<VadEngineKind>>,
  key: &str,
) -> Result<(), String> {
  let kind = VadEngineKind::from_key(key).ok_or_else(|| format!("unknown VAD engine: {key}"))?;
  let mut g = engine
    .lock()
    .map_err(|_| "dialogue vad engine lock poisoned".to_string())?;
  *g = kind;
  Ok(())
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

#[tauri::command]
pub fn set_dialogue_vad_engine(engine: String, state: State<'_, AppState>) -> Result<(), String> {
  apply_dialogue_vad_engine(&state.inner().dialogue_vad_engine, &engine)
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
  {
    let mut source = state
      .inner()
      .source
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    *source = EngineSource::Stopped;
  }
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

#[tauri::command]
pub fn file_analysis_probe(path: String) -> Result<FileAnalysisProbeResult, String> {
  crate::file_analysis::probe::probe_file(path)
}

#[tauri::command]
pub fn file_analysis_start(
  app: AppHandle,
  path: String,
  probe: Option<FileAnalysisProbeResult>,
  on_frame: tauri::ipc::Channel<AudioFramePayload>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  {
    // Stop any active source (live or a previous file run) before starting a new file analysis.
    let mut source = state
      .inner()
      .source
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    *source = EngineSource::Stopped;
  }
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
  let session = crate::file_analysis::session::FileAnalysisSession::start(path, probe, pool, app)?;
  let mut source = state
    .inner()
    .source
    .lock()
    .map_err(|_| "state lock poisoned".to_string())?;
  *source = EngineSource::File(session);
  Ok(())
}

#[tauri::command]
pub fn file_analysis_stop(state: State<'_, AppState>) -> Result<(), String> {
  {
    let mut source = state
      .inner()
      .source
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    *source = EngineSource::Stopped;
  }
  let mut subscribers = state
    .inner()
    .frame_subscribers
    .lock()
    .map_err(|_| "frame subscribers lock poisoned".to_string())?;
  *subscribers = None;
  Ok(())
}

/// Reset DSP state (peak maxima + history accumulators) on the capture thread to match UI Clear
/// for the native path, then emit `meter-history-cleared`.
#[tauri::command]
pub fn clear_audio_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  {
    let g = state
      .inner()
      .source
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    if let EngineSource::Live(sess) = &*g {
      sess.request_clear_peak_history();
    }
  }
  let _ = app.emit("meter-history-cleared", ());
  Ok(())
}

/// Reset only the session True Peak Max hold on the capture thread, leaving momentary/
/// short-term/sample-peak maxima untouched (per-metric reset, e.g. click on the TP Max
/// marker).
#[tauri::command]
pub fn reset_true_peak_max(state: State<'_, AppState>) -> Result<(), String> {
  let g = state
    .inner()
    .source
    .lock()
    .map_err(|_| "state lock poisoned".to_string())?;
  if let EngineSource::Live(sess) = &*g {
    sess.request_reset_true_peak_max();
  }
  Ok(())
}

/// `running` or `stopped`.
#[tauri::command]
pub fn get_engine_state(state: State<'_, AppState>) -> Result<String, String> {
  let g = state
    .inner()
    .source
    .lock()
    .map_err(|_| "state lock poisoned".to_string())?;
  // Only live capture maps to the "running" engine state the UI reconciles against; file analysis
  // is a separate, self-completing source and reports as stopped here, matching prior behavior.
  Ok(if matches!(&*g, EngineSource::Live(_)) {
    "running".into()
  } else {
    "stopped".into()
  })
}

#[cfg(test)]
mod tests {
  use super::validate_loudness_weights;
  use crate::ipc::types::{
    AnalysisRequests, SpectrumAnalysisChannel, SpectrumAnalysisRequest, StereoMapAnalysisPair,
    StereoMapAnalysisRequest, VectorscopeAnalysisRequest,
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
  fn set_dialogue_vad_engine_updates_shared_kind() {
    let engine = std::sync::Arc::new(std::sync::Mutex::new(
      crate::dsp::speech::VadEngineKind::Silero,
    ));
    super::apply_dialogue_vad_engine(&engine, "firered").unwrap();
    assert_eq!(
      *engine.lock().unwrap(),
      crate::dsp::speech::VadEngineKind::FireRed
    );
    super::apply_dialogue_vad_engine(&engine, "ten").unwrap();
    assert_eq!(
      *engine.lock().unwrap(),
      crate::dsp::speech::VadEngineKind::Ten
    );
    assert!(super::apply_dialogue_vad_engine(&engine, "unknown").is_err());
  }

  #[test]
  fn analysis_requests_validation_accepts_frontend_keys() {
    let requests = AnalysisRequests {
      spectrum: vec![
        SpectrumAnalysisRequest {
          key: "spectrum:pair:0:1:lr:sp50:tilt450:smoff".to_string(),
          channel: SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
          view: "lr".to_string(),
          speed_percent: 50.0,
          tilt_db_per_octave: 4.5,
          octave_smoothing: "off".to_string(),
        },
        SpectrumAnalysisRequest {
          key: "spectrum:single:2:combined:sp25:tilt125:smoff".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 2 },
          view: "combined".to_string(),
          speed_percent: 25.0,
          tilt_db_per_octave: 1.25,
          octave_smoothing: "off".to_string(),
        },
      ],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:0:1".to_string(),
        x: 0,
        y: 1,
      }],
      stereo_map: vec![],
    };
    assert!(super::validate_analysis_requests(&requests).is_ok());
  }

  #[test]
  fn analysis_requests_validation_rejects_mismatched_keys() {
    let requests = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: "spectrum:pair:0:1:combined:sp50:tilt450:smoff".to_string(),
        channel: SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
        view: "ms".to_string(),
        speed_percent: 50.0,
        tilt_db_per_octave: 4.5,
        octave_smoothing: "off".to_string(),
      }],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:1:2".to_string(),
        x: 0,
        y: 1,
      }],
      stereo_map: vec![],
    };
    assert!(super::validate_analysis_requests(&requests).is_err());
  }

  #[test]
  fn analysis_requests_validation_rejects_over_cap_requests() {
    let requests = AnalysisRequests {
      spectrum: (0..=super::MAX_SPECTRUM_ANALYSIS_REQUESTS)
        .map(|idx| SpectrumAnalysisRequest {
          key: format!("spectrum:single:{idx}:combined:sp50:tilt450:smoff"),
          channel: SpectrumAnalysisChannel::Single { ch: idx as u16 },
          view: "combined".to_string(),
          speed_percent: 50.0,
          tilt_db_per_octave: 4.5,
          octave_smoothing: "off".to_string(),
        })
        .collect(),
      vectorscope: vec![],
      stereo_map: vec![],
    };
    assert!(super::validate_analysis_requests(&requests).is_err());
  }

  #[test]
  fn shared_wire_payload_deserializes_and_validates() {
    // Keep the established Spectrum/Vectorscope fixture as one half of the JS parity guard. The
    // Stereo Map fixture below owns the new family's required wire shape; compose its empty array
    // here so this older fixture remains focused on the two families it records.
    let raw = include_str!(concat!(
      env!("CARGO_MANIFEST_DIR"),
      "/../shared/analysis-request-key-fixtures.json"
    ));
    let fixture: serde_json::Value = serde_json::from_str(raw).expect("fixture parses");
    let mut wire_payload = fixture["wirePayload"].clone();
    wire_payload
      .as_object_mut()
      .expect("wire payload object")
      .insert("stereoMap".to_string(), serde_json::Value::Array(vec![]));
    let requests: AnalysisRequests = serde_json::from_value(wire_payload)
      .expect("wire payload must deserialize into AnalysisRequests");
    assert!(
      super::validate_analysis_requests(&requests).is_ok(),
      "wire payload rejected by validator"
    );
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
      let speed_percent = entry["speedPercent"].as_f64().unwrap();
      let tilt_db_per_octave = entry["tiltDbPerOctave"].as_f64().unwrap();
      let octave_smoothing = entry["octaveSmoothing"].as_str().unwrap().to_string();
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
        spectrum: vec![SpectrumAnalysisRequest {
          key,
          channel,
          view,
          speed_percent,
          tilt_db_per_octave,
          octave_smoothing,
        }],
        vectorscope: vec![],
        stereo_map: vec![],
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
        stereo_map: vec![],
      };
      assert!(
        super::validate_analysis_requests(&requests).is_ok(),
        "vectorscope fixture entry {entry:?} rejected by validator"
      );
    }
  }

  #[test]
  fn stereo_map_request_keys_match_shared_fixture() {
    let raw = include_str!(concat!(
      env!("CARGO_MANIFEST_DIR"),
      "/../shared/stereo-map-request-key-fixtures.json"
    ));
    let fixture: serde_json::Value = serde_json::from_str(raw).expect("fixture parses");

    for pair in fixture["pairs"].as_array().expect("pairs array") {
      for speed_percent in fixture["speedPercentValues"]
        .as_array()
        .expect("speed values array")
      {
        for smoothing in fixture["smoothingValues"]
          .as_array()
          .expect("smoothing values array")
        {
          let first = pair["first"].as_u64().unwrap() as u16;
          let second = pair["second"].as_u64().unwrap() as u16;
          let speed_percent = speed_percent.as_f64().unwrap();
          let octave_smoothing = smoothing["value"].as_str().unwrap().to_string();
          let expected = fixture["keyFormat"]
            .as_str()
            .unwrap()
            .replace("<first>", &first.to_string())
            .replace("<second>", &second.to_string())
            .replace("<speedPercent>", &speed_percent.to_string())
            .replace("<smoothingToken>", smoothing["token"].as_str().unwrap());
          let requests = AnalysisRequests {
            spectrum: vec![],
            vectorscope: vec![],
            stereo_map: vec![StereoMapAnalysisRequest {
              key: expected,
              pair: StereoMapAnalysisPair { first, second },
              speed_percent,
              octave_smoothing,
            }],
          };

          assert!(
            super::validate_analysis_requests(&requests).is_ok(),
            "Stereo Map fixture entry pair={pair:?}, speed={speed_percent}, smoothing={smoothing:?} rejected"
          );
        }
      }
    }
  }

  #[test]
  fn stereo_map_wire_payload_deserializes_and_validates() {
    let raw = include_str!(concat!(
      env!("CARGO_MANIFEST_DIR"),
      "/../shared/stereo-map-request-key-fixtures.json"
    ));
    let fixture: serde_json::Value = serde_json::from_str(raw).expect("fixture parses");
    let requests: AnalysisRequests = serde_json::from_value(fixture["wirePayload"].clone())
      .expect("wire payload must deserialize into AnalysisRequests");

    assert!(super::validate_analysis_requests(&requests).is_ok());
  }

  #[test]
  fn stereo_map_wire_payload_requires_the_request_array() {
    let raw = include_str!(concat!(
      env!("CARGO_MANIFEST_DIR"),
      "/../shared/stereo-map-request-key-fixtures.json"
    ));
    let fixture: serde_json::Value = serde_json::from_str(raw).expect("fixture parses");
    let mut wire_payload = fixture["wirePayload"].clone();
    wire_payload
      .as_object_mut()
      .expect("wire payload object")
      .remove("stereoMap");

    assert!(serde_json::from_value::<AnalysisRequests>(wire_payload).is_err());
  }

  #[test]
  fn stereo_map_validation_rejects_duplicate_keys() {
    let request = StereoMapAnalysisRequest {
      key: "stereoMap:pair:0:1:sp25:sm12".to_string(),
      pair: StereoMapAnalysisPair {
        first: 0,
        second: 1,
      },
      speed_percent: 25.0,
      octave_smoothing: "1/12".to_string(),
    };
    let requests = AnalysisRequests {
      spectrum: vec![],
      vectorscope: vec![],
      stereo_map: vec![request.clone(), request],
    };

    assert!(super::validate_analysis_requests(&requests).is_err());
  }

  #[test]
  fn stereo_map_validation_rejects_noncanonical_keys() {
    let requests = AnalysisRequests {
      spectrum: vec![],
      vectorscope: vec![],
      stereo_map: vec![StereoMapAnalysisRequest {
        key: "stereoMap:pair:0:1:sp25:smoff".to_string(),
        pair: StereoMapAnalysisPair {
          first: 0,
          second: 1,
        },
        speed_percent: 25.0,
        octave_smoothing: "1/12".to_string(),
      }],
    };

    assert!(super::validate_analysis_requests(&requests).is_err());
  }

  #[test]
  fn stereo_map_validation_rejects_invalid_channel_indices() {
    let requests = AnalysisRequests {
      spectrum: vec![],
      vectorscope: vec![],
      stereo_map: vec![StereoMapAnalysisRequest {
        key: "stereoMap:pair:0:64:sp25:sm12".to_string(),
        pair: StereoMapAnalysisPair {
          first: 0,
          second: 64,
        },
        speed_percent: 25.0,
        octave_smoothing: "1/12".to_string(),
      }],
    };

    assert!(super::validate_analysis_requests(&requests).is_err());
  }

  #[test]
  fn stereo_map_validation_uses_an_independent_cap() {
    let stereo_map = (0..super::MAX_STEREO_MAP_ANALYSIS_REQUESTS)
      .map(|idx| StereoMapAnalysisRequest {
        key: format!("stereoMap:pair:{idx}:{}:sp25:sm12", idx + 1),
        pair: StereoMapAnalysisPair {
          first: idx as u16,
          second: idx as u16 + 1,
        },
        speed_percent: 25.0,
        octave_smoothing: "1/12".to_string(),
      })
      .collect();
    let requests = AnalysisRequests {
      spectrum: (0..super::MAX_SPECTRUM_ANALYSIS_REQUESTS)
        .map(|idx| SpectrumAnalysisRequest {
          key: format!("spectrum:single:{idx}:combined:sp25:tilt300:smoff"),
          channel: SpectrumAnalysisChannel::Single { ch: idx as u16 },
          view: "combined".to_string(),
          speed_percent: 25.0,
          tilt_db_per_octave: 3.0,
          octave_smoothing: "off".to_string(),
        })
        .collect(),
      vectorscope: vec![],
      stereo_map,
    };

    assert!(super::validate_analysis_requests(&requests).is_ok());
  }

  #[test]
  fn stereo_map_validation_rejects_requests_over_its_cap() {
    let stereo_map = (0..=super::MAX_STEREO_MAP_ANALYSIS_REQUESTS)
      .map(|idx| StereoMapAnalysisRequest {
        key: format!("stereoMap:pair:{idx}:{}:sp25:sm12", idx + 1),
        pair: StereoMapAnalysisPair {
          first: idx as u16,
          second: idx as u16 + 1,
        },
        speed_percent: 25.0,
        octave_smoothing: "1/12".to_string(),
      })
      .collect();
    let requests = AnalysisRequests {
      spectrum: vec![],
      vectorscope: vec![],
      stereo_map,
    };

    assert!(super::validate_analysis_requests(&requests).is_err());
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
