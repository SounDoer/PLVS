//! macOS 14.2+ system audio via Core Audio process tap + private aggregate device (`native/macos/tap_bridge.m`).
//! Physical inputs still use cpal (same `cap-*` ids as Windows).

mod pcm_shim;

use std::collections::HashSet;
use std::ffi::{c_char, c_int, c_void, CString};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use tauri::AppHandle;

use super::capture::{AudioCapture, AudioCaptureSession};
use super::cpal_backend::{
  append_input_devices, collect_outputs, device_id_key, device_list_label, pick_output_by_index,
  pooled_pcm_buffer_capacity, resolve_default_output, run_meter_pipeline_bridge_thread,
  CpalBackend, PcmBufferPool,
};
use super::device::DeviceInfo;
use super::device_id;
use crate::dsp::SpectrumChannelSel;
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::FrameSubscribers;

use pcm_shim::PcmBridgeCtx;

#[link(name = "tap_bridge", kind = "static")]
unsafe extern "C" {
  fn macos_uid_for_output_name(
    name_utf8: *const c_char,
    out_uid: *mut c_char,
    out_cap: usize,
  ) -> c_int;
  fn macos_default_output_uid(out_uid: *mut c_char, out_cap: usize) -> c_int;
  fn macos_tap_create(
    device_uid_utf8: *const c_char,
    stream_index: isize,
    pcm_userdata: *mut c_void,
    err_out: *mut c_char,
    err_cap: usize,
  ) -> *mut c_void;
  fn macos_tap_destroy(opaque: *mut c_void, out_pcm_userdata: *mut *mut c_void);
}

fn uid_for_output_name(label: &str) -> Option<String> {
  let cname = CString::new(label).ok()?;
  let mut buf = vec![0u8; 512];
  let st = unsafe { macos_uid_for_output_name(cname.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) };
  if st != 0 {
    return None;
  }
  let n = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
  Some(String::from_utf8_lossy(&buf[..n]).into_owned())
}

fn uid_for_default_output() -> Result<String, String> {
  let mut buf = vec![0u8; 512];
  let st = unsafe { macos_default_output_uid(buf.as_mut_ptr().cast(), buf.len()) };
  if st != 0 {
    return Err(
      "failed to resolve default output device UID (is an audio output device available?)".into(),
    );
  }
  let n = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
  Ok(String::from_utf8_lossy(&buf[..n]).into_owned())
}

/// Loopback rows only (same ordering and `lb-*` ids as [`super::cpal_backend::build_device_list`] on Windows).
fn list_loopback_rows_macos() -> Result<Vec<DeviceInfo>, String> {
  let mut out = Vec::new();
  let mut used_lb = HashSet::new();
  for (_idx, device, cfg) in collect_outputs()? {
    let key = device_id_key(&device)?;
    let label = device_list_label(&device)?;
    let core_uid = uid_for_output_name(&key);
    let id = device_id::alloc_loopback_id(&key, &mut used_lb);
    out.push(DeviceInfo {
      id,
      label,
      is_system_output_monitor: true,
      is_loopback: true,
      default_sample_rate: cfg.sample_rate(),
      channels: cfg.channels(),
      core_audio_output_uid: core_uid,
    });
  }
  Ok(out)
}

pub fn list_devices() -> Result<Vec<DeviceInfo>, String> {
  let mut out = list_loopback_rows_macos()?;
  append_input_devices(&mut out)?;
  Ok(out)
}

fn resolve_tap_uid_channels_rate(device_id: &str) -> Result<(String, u32, u16), String> {
  if device_id.is_empty() || device_id == "default" {
    let uid = uid_for_default_output()?;
    let (_dev, cfg) = resolve_default_output()?;
    return Ok((uid, cfg.sample_rate(), cfg.channels()));
  }
  if let Some(n) = device_id::parse_legacy_output_index(device_id) {
    let (dev, cfg) = pick_output_by_index(n)?;
    let key = device_id_key(&dev)?;
    let uid = uid_for_output_name(&key).ok_or_else(|| {
      format!("no Core Audio UID for output device \"{key}\" (macOS 14.2+ tap requires a UID)")
    })?;
    return Ok((uid, cfg.sample_rate(), cfg.channels()));
  }
  if device_id::is_stable_loopback_id(device_id) {
    for d in list_loopback_rows_macos()? {
      if d.id == device_id {
        let uid = d.core_audio_output_uid.clone().ok_or_else(|| {
          format!(
            "Core Audio tap is unavailable for \"{}\" (could not map to device UID)",
            d.label
          )
        })?;
        return Ok((uid, d.default_sample_rate, d.channels));
      }
    }
    // Legacy v1 ids (included channel count + sample rate); still resolve to the same Core Audio UID.
    let mut used_legacy = HashSet::new();
    for (_idx, device, cfg) in collect_outputs()? {
      let key = device_id_key(&device)?;
      let legacy_id = device_id::legacy_alloc_loopback_id(
        &key,
        cfg.channels(),
        cfg.sample_rate(),
        &mut used_legacy,
      );
      if legacy_id == device_id {
        let uid = uid_for_output_name(&key).ok_or_else(|| {
          format!(
            "Core Audio tap is unavailable for \"{key}\" (could not map legacy id to device UID)"
          )
        })?;
        return Ok((uid, cfg.sample_rate(), cfg.channels()));
      }
    }
    return Err(format!("unknown loopback device id: {device_id}"));
  }
  Err(format!("not a loopback device id: {device_id}"))
}

fn run_macos_tap_worker(
  device_id: String,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  stop_rx: std::sync::mpsc::Receiver<()>,
  clear_peak_history: Arc<AtomicBool>,
  vectorscope_pair: Arc<std::sync::Mutex<(u16, u16)>>,
  channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
  spectrum_channel: Arc<std::sync::Mutex<SpectrumChannelSel>>,
  loudness_weights: Arc<std::sync::Mutex<Option<Vec<f64>>>>,
  dialogue_gating: Arc<std::sync::Mutex<bool>>,
  dropped_chunks: Arc<AtomicU64>,
) -> Result<(), String> {
  let (uid, sample_rate, channels) = resolve_tap_uid_channels_rate(&device_id)?;
  let pcm_pool = PcmBufferPool::new(64, pooled_pcm_buffer_capacity(sample_rate, channels));
  let bridge_pool = pcm_pool.clone();
  let (audio_tx, audio_rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(64);
  let clear_for_thread = clear_peak_history.clone();
  let dropped_for_thread = dropped_chunks.clone();
  let bridge = std::thread::spawn(move || {
    run_meter_pipeline_bridge_thread(
      audio_rx,
      sample_rate,
      channels,
      frame_subscribers,
      app,
      clear_for_thread,
      vectorscope_pair,
      channel_layout,
      spectrum_channel,
      loudness_weights,
      dialogue_gating,
      dropped_for_thread,
      bridge_pool,
    );
  });

  let ctx = Box::new(PcmBridgeCtx {
    tx: audio_tx.clone(),
    dropped: dropped_chunks,
    pool: pcm_pool,
  });
  let ctx_ptr = Box::into_raw(ctx);
  let uid_c = CString::new(uid).map_err(|_| "device UID contains NUL".to_string())?;
  let mut err = vec![0u8; 512];
  let tap = unsafe {
    macos_tap_create(
      uid_c.as_ptr(),
      0isize,
      ctx_ptr.cast(),
      err.as_mut_ptr().cast(),
      err.len(),
    )
  };
  if tap.is_null() {
    unsafe {
      drop(Box::from_raw(ctx_ptr));
    }
    drop(audio_tx);
    let _ = bridge.join();
    let msg = err
      .iter()
      .position(|&b| b == 0)
      .map(|n| String::from_utf8_lossy(&err[..n]).into_owned())
      .filter(|s| !s.is_empty())
      .unwrap_or_else(|| "macos_tap_create failed".into());
    return Err(msg);
  }

  let _ = stop_rx.recv();

  let mut userdata_out: *mut c_void = std::ptr::null_mut();
  unsafe {
    macos_tap_destroy(tap, &mut userdata_out);
    if !userdata_out.is_null() {
      drop(Box::from_raw(userdata_out.cast::<PcmBridgeCtx>()));
    }
  }
  drop(audio_tx);
  let _ = bridge.join();
  Ok(())
}

pub(crate) struct MacosTapCaptureSession {
  stop_tx: std::sync::mpsc::Sender<()>,
  join: Option<JoinHandle<Result<(), String>>>,
  clear_peak_history: Arc<AtomicBool>,
}

impl Drop for MacosTapCaptureSession {
  fn drop(&mut self) {
    let _ = self.stop_tx.send(());
    if let Some(j) = self.join.take() {
      let _ = j.join();
    }
  }
}

impl AudioCaptureSession for MacosTapCaptureSession {
  fn request_clear_peak_history(&self) {
    self.clear_peak_history.store(true, Ordering::Release);
  }
}

impl MacosTapCaptureSession {
  fn start(
    device_id: &str,
    frame_subscribers: FrameSubscribers,
    app: AppHandle,
    vectorscope_pair: Arc<std::sync::Mutex<(u16, u16)>>,
    channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
    spectrum_channel: Arc<std::sync::Mutex<SpectrumChannelSel>>,
    loudness_weights: Arc<std::sync::Mutex<Option<Vec<f64>>>>,
    dialogue_gating: Arc<std::sync::Mutex<bool>>,
  ) -> Result<Self, String> {
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let clear_peak_history = Arc::new(AtomicBool::new(false));
    let clear_worker = clear_peak_history.clone();
    let dropped_chunks = Arc::new(AtomicU64::new(0));
    let device_id = device_id.to_string();
    let join = std::thread::Builder::new()
      .name("capture".into())
      .spawn(move || {
        run_macos_tap_worker(
          device_id,
          frame_subscribers,
          app,
          stop_rx,
          clear_worker,
          vectorscope_pair,
          channel_layout,
          spectrum_channel,
          loudness_weights,
          dialogue_gating,
          dropped_chunks,
        )
      })
      .map_err(|e| e.to_string())?;
    Ok(MacosTapCaptureSession {
      stop_tx,
      join: Some(join),
      clear_peak_history,
    })
  }
}

fn is_macos_loopback_selection(device_id: &str) -> bool {
  device_id.is_empty()
    || device_id == "default"
    || device_id::is_stable_loopback_id(device_id)
    || device_id::parse_legacy_output_index(device_id).is_some()
}

pub fn start_session(
  device_id: &str,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  vectorscope_pair: Arc<std::sync::Mutex<(u16, u16)>>,
  channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
  spectrum_channel: Arc<std::sync::Mutex<SpectrumChannelSel>>,
  loudness_weights: Arc<std::sync::Mutex<Option<Vec<f64>>>>,
  dialogue_gating: Arc<std::sync::Mutex<bool>>,
) -> Result<Box<dyn AudioCaptureSession>, String> {
  if is_macos_loopback_selection(device_id) {
    Ok(Box::new(MacosTapCaptureSession::start(
      device_id,
      frame_subscribers,
      app,
      vectorscope_pair,
      channel_layout,
      spectrum_channel,
      loudness_weights,
      dialogue_gating,
    )?))
  } else {
    CpalBackend.start_session(
      device_id,
      frame_subscribers,
      app,
      vectorscope_pair,
      channel_layout,
      spectrum_channel,
      loudness_weights,
      dialogue_gating,
    )
  }
}
