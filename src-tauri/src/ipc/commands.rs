//! `#[tauri::command]` handlers (Phase 2: capture + DSP → Channel / Events).

use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::audio::capture::AudioCapture;
use crate::audio::cpal_backend;
use crate::audio::device::DeviceInfo;
use crate::audio::AppAudioBackend;
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::{
  AudioDevicePreview, AudioFramePayload, EngineStateChanged, FrameSubscribers, MeterHistoryEntry,
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
  {
    let mut h = state
      .inner()
      .meter_history
      .lock()
      .map_err(|_| "meter history lock poisoned".to_string())?;
    h.clear();
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
  let mh = state.inner().meter_history.clone();
  let pair = state.inner().vectorscope_pair.clone();
  let layout = state.inner().channel_layout.clone();
  let session = AudioCapture::start_session(
    &AppAudioBackend,
    &device_id,
    pool,
    app.clone(),
    mh,
    pair,
    layout,
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

/// Update channel layout preset. Applied on the capture thread for subsequent frames.
#[tauri::command]
pub fn set_channel_layout(layout: String, state: State<'_, AppState>) -> Result<(), String> {
  let v = ChannelLayoutSetting::from_str_lossy(&layout);
  let mut g = state
    .inner()
    .channel_layout
    .lock()
    .map_err(|_| "channel layout lock poisoned".to_string())?;
  *g = v;
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

/// Extra float webview: receive the same `AudioFramePayload` stream as the main window.
#[tauri::command]
pub fn meter_add_frame_subscriber(
  id: String,
  on_frame: tauri::ipc::Channel<AudioFramePayload>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let pool = {
    let s = state
      .inner()
      .frame_subscribers
      .lock()
      .map_err(|_| "frame subscribers lock poisoned".to_string())?;
    s.as_ref()
      .cloned()
      .ok_or_else(|| "meter engine is not running".to_string())?
  };
  {
    let mut m = pool
      .lock()
      .map_err(|_| "frame subscriber map poisoned".to_string())?;
    m.insert(id, on_frame);
  }
  Ok(())
}

#[tauri::command]
pub fn meter_remove_frame_subscriber(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let opt = {
    let s = state
      .inner()
      .frame_subscribers
      .lock()
      .map_err(|_| "frame subscribers lock poisoned".to_string())?;
    s.as_ref().cloned()
  };
  if let Some(pool) = opt {
    let mut m = pool
      .lock()
      .map_err(|_| "frame subscriber map poisoned".to_string())?;
    m.remove(&id);
  }
  Ok(())
}

/// Clear meter history deque + DSP state on the capture thread (matches UI Clear for native path).
/// Also empties the shared `meter_history` buffer immediately and emits `meter-history-cleared` so
/// pop-out webviews can reset local rings without waiting for the next audio chunk.
#[tauri::command]
pub fn clear_audio_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
  {
    let mut h = state
      .inner()
      .meter_history
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    h.clear();
  }
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

/// Full meter history ring (export / reconnect); same rows as `loudness_hist_tick` stream.
#[tauri::command]
pub fn get_meter_history(state: State<'_, AppState>) -> Result<Vec<MeterHistoryEntry>, String> {
  let g = state
    .inner()
    .meter_history
    .lock()
    .map_err(|_| "meter history lock poisoned".to_string())?;
  Ok(g.iter().cloned().collect())
}

/// `running` or `stopped` (float panes: no Tauri event replay; query on load).
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
