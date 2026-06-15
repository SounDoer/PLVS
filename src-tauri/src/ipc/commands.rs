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
  AudioDevicePreview, AudioFramePayload, EngineStateChanged, FrameSubscribers,
};
use crate::state::AppState;

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
  let pair = state.inner().vectorscope_pair.clone();
  // Channel layout is auto-resolved from channel count on the capture thread; no user override.
  let layout = Arc::new(Mutex::new(ChannelLayoutSetting::Auto));
  let spectrum = state.inner().spectrum_channel.clone();
  let loudness_weights = state.inner().loudness_weights.clone();
  let dialogue_gating = state.inner().dialogue_gating_enabled.clone();
  let session = AudioCapture::start_session(
    &AppAudioBackend,
    &device_id,
    pool,
    app.clone(),
    pair,
    layout,
    spectrum,
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

/// Update vectorscope XY pair (0-based channel indices). Applied on the capture thread for subsequent frames.
#[tauri::command]
pub fn set_vectorscope_pair(x: u16, y: u16, state: State<'_, AppState>) -> Result<(), String> {
  let mut g = state
    .inner()
    .vectorscope_pair
    .lock()
    .map_err(|_| "vectorscope pair lock poisoned".to_string())?;
  *g = (x, y);
  Ok(())
}

/// Update spectrum channel selection. Applied on the capture thread for subsequent frames.
#[tauri::command]
pub fn set_spectrum_channel(
  sel_type: String,
  ch_x: u16,
  ch_y: u16,
  state: State<'_, AppState>,
) -> Result<(), String> {
  use crate::dsp::SpectrumChannelSel;
  let sel = match sel_type.as_str() {
    "pair" => SpectrumChannelSel::Pair(ch_x, ch_y),
    "single" => SpectrumChannelSel::Single(ch_x),
    _ => return Err(format!("unknown spectrum_channel sel_type: {sel_type}")),
  };
  let mut g = state
    .inner()
    .spectrum_channel
    .lock()
    .map_err(|_| "spectrum channel lock poisoned".to_string())?;
  *g = sel;
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

/// Update spectrum view mode. Applied on the capture thread for subsequent frames.
#[tauri::command]
pub fn set_spectrum_view(view: String, state: State<'_, AppState>) -> Result<(), String> {
  let parsed = parse_spectrum_view(&view)?;
  let mut g = state
    .inner()
    .spectrum_view
    .lock()
    .map_err(|_| "spectrum view lock poisoned".to_string())?;
  *g = parsed;
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
