//! cpal / WASAPI loopback: **render** devices are opened with `build_input_stream` as loopback; **capture** devices are mics, etc.
//! Implements `AudioCapture`; the capture thread and `CaptureSession` live here (formerly `session.rs`).
//!
//! WASAPI: `render device + input stream` ⇒ `AUDCLNT_STREAMFLAGS_LOOPBACK`.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use super::capture::{AudioCapture, AudioCaptureSession};
use super::device::DeviceInfo;
use super::device_id;

use crate::engine::ChannelLayoutSetting;
use crate::engine::MeterPipeline;
use crate::ipc::types::{EngineBackpressurePayload, MeterHistoryBuf};
use tauri::{AppHandle, Emitter};

fn is_name_heuristic_loopback(name: &str) -> bool {
  let n = name.to_lowercase();
  n.contains("loopback")
    || n.contains("stereo mix")
    || n.contains("what u hear")
    || n.contains("立体声混音")
}

pub(crate) fn collect_outputs(
) -> Result<Vec<(usize, cpal::Device, cpal::SupportedStreamConfig)>, String> {
  let host = cpal::default_host();
  let mut rows = Vec::new();
  for (idx, device) in host
    .output_devices()
    .map_err(|e| e.to_string())?
    .enumerate()
  {
    if let Ok(cfg) = device.default_output_config() {
      rows.push((idx, device, cfg));
    }
  }
  rows.sort_by(|a, b| {
    let na = a.1.name().unwrap_or_default();
    let nb = b.1.name().unwrap_or_default();
    na.to_lowercase().cmp(&nb.to_lowercase())
  });
  Ok(rows)
}

pub(crate) fn collect_inputs(
) -> Result<Vec<(usize, cpal::Device, cpal::SupportedStreamConfig)>, String> {
  let host = cpal::default_host();
  let mut rows = Vec::new();
  for (idx, device) in host.input_devices().map_err(|e| e.to_string())?.enumerate() {
    if let Ok(cfg) = device.default_input_config() {
      rows.push((idx, device, cfg));
    }
  }
  rows.sort_by(|a, b| {
    let na = a.1.name().unwrap_or_default();
    let nb = b.1.name().unwrap_or_default();
    na.to_lowercase().cmp(&nb.to_lowercase())
  });
  Ok(rows)
}

pub(crate) fn pick_output_by_index(
  target: usize,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  let host = cpal::default_host();
  for (idx, device) in host
    .output_devices()
    .map_err(|e| e.to_string())?
    .enumerate()
  {
    if idx != target {
      continue;
    }
    let cfg = device
      .default_output_config()
      .map_err(|e| format!("{e} (output index {target})"))?;
    return Ok((device, cfg));
  }
  Err(format!("Output device index not found: {target}"))
}

fn pick_input_by_index(
  target: usize,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  let host = cpal::default_host();
  for (idx, device) in host.input_devices().map_err(|e| e.to_string())?.enumerate() {
    if idx != target {
      continue;
    }
    let cfg = device
      .default_input_config()
      .map_err(|e| format!("{e} (input index {target})"))?;
    return Ok((device, cfg));
  }
  Err(format!("Input device index not found: {target}"))
}

/// Selectable sources: system **outputs** (loopback) first, then **inputs** (mics, line in, virtual cables, etc.).
///
/// Device ids are stable across UI refreshes (`lb-*` / `cap-*` hashes). Legacy `out:N` / `in:N` index ids are still
/// accepted in [`resolve_device`].
pub(crate) fn build_device_list() -> Result<Vec<DeviceInfo>, String> {
  let mut out = Vec::new();
  let mut used_lb = HashSet::new();

  for (_idx, device, cfg) in collect_outputs()? {
    let name = device.name().map_err(|e| e.to_string())?;
    let id = device_id::alloc_loopback_id(&name, cfg.channels(), cfg.sample_rate().0, &mut used_lb);
    out.push(DeviceInfo {
      id,
      label: name,
      is_system_output_monitor: true,
      is_loopback: true,
      default_sample_rate: cfg.sample_rate().0,
      channels: cfg.channels(),
      core_audio_output_uid: None,
    });
  }

  append_input_devices(&mut out)?;

  Ok(out)
}

/// Input-only rows (microphones, line-in, virtual inputs) using the same `cap-*` ids as [`build_device_list`].
pub(crate) fn append_input_devices(out: &mut Vec<DeviceInfo>) -> Result<(), String> {
  let mut used_cap = HashSet::new();
  for (_idx, device, cfg) in collect_inputs()? {
    let label = device.name().map_err(|e| e.to_string())?;
    let is_loopback = is_name_heuristic_loopback(&label);
    let id =
      device_id::alloc_capture_id(&label, cfg.channels(), cfg.sample_rate().0, &mut used_cap);
    out.push(DeviceInfo {
      id,
      label,
      is_system_output_monitor: false,
      is_loopback,
      default_sample_rate: cfg.sample_rate().0,
      channels: cfg.channels(),
      core_audio_output_uid: None,
    });
  }

  Ok(())
}

pub(crate) fn resolve_default_output() -> Result<(cpal::Device, cpal::SupportedStreamConfig), String>
{
  let host = cpal::default_host();
  if let Some(def) = host.default_output_device() {
    let def_name = def.name().map_err(|e| e.to_string())?;
    for device in host.output_devices().map_err(|e| e.to_string())? {
      let Ok(name) = device.name() else {
        continue;
      };
      if name == def_name {
        let cfg = device
          .default_output_config()
          .map_err(|e| format!("default output format: {e}"))?;
        return Ok((device, cfg));
      }
    }
  }
  let host = cpal::default_host();
  for device in host.output_devices().map_err(|e| e.to_string())? {
    if let Ok(cfg) = device.default_output_config() {
      return Ok((device, cfg));
    }
  }
  pick_input_by_index(0)
}

fn resolve_stable_loopback(
  target: &str,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  let mut used_lb = HashSet::new();
  for (_, device, cfg) in collect_outputs()? {
    let name = device.name().map_err(|e| e.to_string())?;
    let id = device_id::alloc_loopback_id(&name, cfg.channels(), cfg.sample_rate().0, &mut used_lb);
    if id == target {
      return Ok((device, cfg));
    }
  }
  Err(format!("Unknown loopback device id: {target}"))
}

fn resolve_stable_capture(
  target: &str,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  let mut used_cap = HashSet::new();
  for (_, device, cfg) in collect_inputs()? {
    let name = device.name().map_err(|e| e.to_string())?;
    let id = device_id::alloc_capture_id(&name, cfg.channels(), cfg.sample_rate().0, &mut used_cap);
    if id == target {
      return Ok((device, cfg));
    }
  }
  Err(format!("Unknown capture device id: {target}"))
}

fn resolve_device(device_id: &str) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  if device_id.is_empty() || device_id == "default" {
    return resolve_default_output();
  }

  if let Some(n) = device_id::parse_legacy_output_index(device_id) {
    return pick_output_by_index(n);
  }

  if let Some(n) = device_id::parse_legacy_input_index(device_id) {
    return pick_input_by_index(n);
  }

  if device_id::is_stable_loopback_id(device_id) {
    return resolve_stable_loopback(device_id);
  }

  if device_id::is_stable_capture_id(device_id) {
    return resolve_stable_capture(device_id);
  }

  Err(format!("Unknown device id: {device_id}"))
}

/// Default `(sample_rate_hz, channels)` for a device id (UI hints / `sample-rate-changed` event).
pub fn device_default_format(device_id: &str) -> Result<(u32, u16), String> {
  let (_, supported) = resolve_device(device_id)?;
  Ok((supported.sample_rate().0, supported.channels()))
}

/// Human-readable device name and format for a capture target (including `"default"` → OS default output).
pub fn preview_device(device_id: &str) -> Result<(String, u32, u16), String> {
  let (device, supported) = resolve_device(device_id)?;
  let label = device.name().map_err(|e| e.to_string())?;
  Ok((label, supported.sample_rate().0, supported.channels()))
}

struct RunCaptureArgs {
  device: cpal::Device,
  supported: cpal::SupportedStreamConfig,
  sample_rate: u32,
  channels: u16,
  frame_subscribers: crate::ipc::types::FrameSubscribers,
  app: tauri::AppHandle,
  stop_rx: std::sync::mpsc::Receiver<()>,
  clear_peak_history: Arc<AtomicBool>,
  vectorscope_pair: Arc<std::sync::Mutex<(u16, u16)>>,
  channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
  meter_history: MeterHistoryBuf,
  dropped_chunks: Arc<AtomicU64>,
}

/// Feeds interleaved f32 PCM from `audio_rx` into [`MeterPipeline`] until the sender side is dropped.
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_meter_pipeline_bridge_thread(
  audio_rx: std::sync::mpsc::Receiver<Vec<f32>>,
  sample_rate: u32,
  channels: u16,
  frame_subscribers: crate::ipc::types::FrameSubscribers,
  app: tauri::AppHandle,
  clear_peak_history: Arc<AtomicBool>,
  vectorscope_pair: Arc<std::sync::Mutex<(u16, u16)>>,
  channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
  meter_history: MeterHistoryBuf,
  dropped_chunks: Arc<AtomicU64>,
) {
  let dropped_worker = dropped_chunks.clone();
  let mut pipeline = MeterPipeline::new(sample_rate, channels, meter_history);
  let mut recv_tick: u32 = 0;
  while let Ok(floats) = audio_rx.recv() {
    recv_tick = recv_tick.wrapping_add(1);
    if recv_tick % 480 == 0 {
      let dropped = dropped_worker.swap(0, Ordering::Relaxed);
      if dropped > 0 {
        log::warn!("cpal→meter queue dropped {dropped} audio chunks (callback backpressure)");
        let _ = app.emit(
          "engine-backpressure",
          EngineBackpressurePayload {
            dropped_chunks: dropped,
          },
        );
      }
    }
    if clear_peak_history.load(Ordering::Acquire) {
      clear_peak_history.store(false, Ordering::Release);
      pipeline.clear_peak_and_history();
    }
    let pair = vectorscope_pair.lock().map(|g| *g).unwrap_or((0, 1));
    let layout = channel_layout
      .lock()
      .map(|g| *g)
      .unwrap_or(ChannelLayoutSetting::Auto);
    let (frame, slow) = pipeline.push_pcm_f32(&floats, pair, layout);
    if let Some(f) = frame {
      if let Ok(mut m) = frame_subscribers.lock() {
        {
          // Primary webview: stop capture if the main stream drops; float panes are best-effort.
          let main_ok = match m.get_mut("main") {
            Some(tx) => tx.send(f.clone()).is_ok(),
            None => false,
          };
          if !main_ok {
            break;
          }
        }
        // Avoid per-key remove/insert on every frame; drop dead float subscribers when send fails.
        let mut to_remove: Vec<String> = Vec::new();
        for (id, tx) in m.iter_mut() {
          if id == "main" {
            continue;
          }
          if tx.send(f.clone()).is_err() {
            to_remove.push(id.clone());
          }
        }
        for id in to_remove {
          m.remove(&id);
        }
      } else {
        break;
      }
    }
    if let Some(s) = slow {
      let _ = app.emit("loudness-slow", &s);
    }
  }
}

fn run_capture_worker(args: RunCaptureArgs) -> Result<(), String> {
  let RunCaptureArgs {
    device,
    supported,
    sample_rate,
    channels,
    frame_subscribers,
    app,
    stop_rx,
    clear_peak_history,
    vectorscope_pair,
    channel_layout,
    meter_history,
    dropped_chunks,
  } = args;
  let dropped_for_callbacks = dropped_chunks.clone();
  let stream_config = StreamConfig {
    channels,
    sample_rate: supported.sample_rate(),
    buffer_size: cpal::BufferSize::Default,
  };

  let (audio_tx, audio_rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(256);

  let bridge = std::thread::spawn(move || {
    run_meter_pipeline_bridge_thread(
      audio_rx,
      sample_rate,
      channels,
      frame_subscribers,
      app,
      clear_peak_history,
      vectorscope_pair,
      channel_layout,
      meter_history,
      dropped_chunks,
    );
  });

  let stream = match supported.sample_format() {
    SampleFormat::F32 => {
      let tx = audio_tx.clone();
      let dropped = dropped_for_callbacks.clone();
      device
        .build_input_stream(
          &stream_config,
          move |data: &[f32], _: &cpal::InputCallbackInfo| {
            let mut v = Vec::with_capacity(data.len());
            v.extend_from_slice(data);
            if tx.try_send(v).is_err() {
              dropped.fetch_add(1, Ordering::Relaxed);
            }
          },
          |e| log::error!("cpal stream error: {e}"),
          None,
        )
        .map_err(|e| e.to_string())?
    }
    SampleFormat::I16 => {
      let tx = audio_tx.clone();
      let dropped = dropped_for_callbacks.clone();
      device
        .build_input_stream(
          &stream_config,
          move |data: &[i16], _: &cpal::InputCallbackInfo| {
            let mut floats: Vec<f32> = Vec::with_capacity(data.len());
            for &s in data {
              floats.push(s as f32 / 32768.0);
            }
            if tx.try_send(floats).is_err() {
              dropped.fetch_add(1, Ordering::Relaxed);
            }
          },
          |e| log::error!("cpal stream error: {e}"),
          None,
        )
        .map_err(|e| e.to_string())?
    }
    SampleFormat::U16 => {
      let tx = audio_tx.clone();
      let dropped = dropped_for_callbacks.clone();
      device
        .build_input_stream(
          &stream_config,
          move |data: &[u16], _: &cpal::InputCallbackInfo| {
            let mut floats: Vec<f32> = Vec::with_capacity(data.len());
            for &s in data {
              floats.push((s as f32 / 32768.0) - 1.0);
            }
            if tx.try_send(floats).is_err() {
              dropped.fetch_add(1, Ordering::Relaxed);
            }
          },
          |e| log::error!("cpal stream error: {e}"),
          None,
        )
        .map_err(|e| e.to_string())?
    }
    f => {
      return Err(format!("Unsupported sample format: {f:?}"));
    }
  };

  stream.play().map_err(|e| e.to_string())?;

  let _ = stop_rx.recv();
  drop(stream);
  drop(audio_tx);
  let _ = bridge.join();
  Ok(())
}

pub(crate) struct CaptureSession {
  stop_tx: std::sync::mpsc::Sender<()>,
  join: Option<JoinHandle<Result<(), String>>>,
  clear_peak_history: Arc<AtomicBool>,
}

impl Drop for CaptureSession {
  fn drop(&mut self) {
    let _ = self.stop_tx.send(());
    if let Some(j) = self.join.take() {
      let _ = j.join();
    }
  }
}

impl AudioCaptureSession for CaptureSession {
  fn request_clear_peak_history(&self) {
    self.clear_peak_history.store(true, Ordering::Release);
  }
}

impl CaptureSession {
  pub(crate) fn start(
    device_id: &str,
    frame_subscribers: crate::ipc::types::FrameSubscribers,
    app: AppHandle,
    meter_history: MeterHistoryBuf,
    vectorscope_pair: Arc<std::sync::Mutex<(u16, u16)>>,
    channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
  ) -> Result<Self, String> {
    let (device, supported) = resolve_device(device_id)?;
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let clear_peak_history = Arc::new(AtomicBool::new(false));
    let clear_worker = clear_peak_history.clone();
    let dropped_chunks = Arc::new(AtomicU64::new(0));

    let join = std::thread::Builder::new()
      .name("audiometer-capture".into())
      .spawn(move || {
        run_capture_worker(RunCaptureArgs {
          device,
          supported,
          sample_rate,
          channels,
          frame_subscribers,
          app,
          stop_rx,
          clear_peak_history: clear_worker,
          vectorscope_pair,
          channel_layout,
          meter_history,
          dropped_chunks,
        })
      })
      .map_err(|e| e.to_string())?;

    Ok(CaptureSession {
      stop_tx,
      join: Some(join),
      clear_peak_history,
    })
  }
}

/// Zero-sized type: the only capture backend in v1.0.
pub struct CpalBackend;

impl AudioCapture for CpalBackend {
  fn list_devices(&self) -> Result<Vec<DeviceInfo>, String> {
    build_device_list()
  }

  fn start_session(
    &self,
    device_id: &str,
    frame_subscribers: crate::ipc::types::FrameSubscribers,
    app: AppHandle,
    meter_history: MeterHistoryBuf,
    vectorscope_pair: Arc<std::sync::Mutex<(u16, u16)>>,
    channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
  ) -> Result<Box<dyn AudioCaptureSession>, String> {
    Ok(Box::new(CaptureSession::start(
      device_id,
      frame_subscribers,
      app,
      meter_history,
      vectorscope_pair,
      channel_layout,
    )?))
  }
}

#[cfg(test)]
mod pcm_chunk_tests {
  fn unpack_pcm_chunk(bytes: &[u8]) -> Option<(u32, u16, Vec<f32>)> {
    if bytes.len() < 12 {
      return None;
    }
    let sample_rate = u32::from_le_bytes(bytes[0..4].try_into().ok()?);
    let channels = u16::from_le_bytes(bytes[4..6].try_into().ok()?);
    let frame_count = u32::from_le_bytes(bytes[8..12].try_into().ok()?);
    let ch = channels.max(1) as usize;
    let need = 12usize.saturating_add(frame_count as usize * ch * 4);
    if bytes.len() < need {
      return None;
    }
    let mut v = Vec::with_capacity(frame_count as usize * ch);
    let off = 12usize;
    for i in 0..frame_count as usize * ch {
      let start = off + i * 4;
      v.push(f32::from_le_bytes(
        bytes.get(start..start + 4)?.try_into().ok()?,
      ));
    }
    Some((sample_rate, channels, v))
  }

  fn pack_pcm_chunk(sample_rate: u32, channels: u16, samples: &[f32]) -> Vec<u8> {
    let ch = channels.max(1) as usize;
    let frame_count = (samples.len() / ch) as u32;
    let mut v = Vec::with_capacity(12 + samples.len() * 4);
    v.extend_from_slice(&sample_rate.to_le_bytes());
    v.extend_from_slice(&channels.to_le_bytes());
    v.extend_from_slice(&0u16.to_le_bytes());
    v.extend_from_slice(&frame_count.to_le_bytes());
    for s in samples {
      v.extend_from_slice(&s.to_le_bytes());
    }
    v
  }

  #[test]
  fn pack_unpack_round_trip_stereo() {
    let sr = 48_000_u32;
    let ch = 2_u16;
    let samples = [0.25_f32, -0.5, 0.0, 1.0];
    let bytes = pack_pcm_chunk(sr, ch, &samples);
    let (sr2, ch2, v) = unpack_pcm_chunk(&bytes).expect("unpack");
    assert_eq!(sr2, sr);
    assert_eq!(ch2, ch);
    assert_eq!(v, samples);
  }

  #[test]
  fn pack_unpack_round_trip_three_channels() {
    let sr = 44_100_u32;
    let ch = 3_u16;
    let samples = [1.0_f32, 2.0, 3.0, -1.0, -2.0, -3.0];
    let bytes = pack_pcm_chunk(sr, ch, &samples);
    let (sr2, ch2, v) = unpack_pcm_chunk(&bytes).expect("unpack");
    assert_eq!(sr2, sr);
    assert_eq!(ch2, ch);
    assert_eq!(v, samples);
  }

  #[test]
  fn unpack_rejects_short_header() {
    assert!(unpack_pcm_chunk(&[0_u8; 8]).is_none());
  }

  #[test]
  fn unpack_rejects_truncated_payload() {
    let mut bytes = pack_pcm_chunk(48_000, 2, &[0.1_f32, 0.2, 0.3, 0.4]);
    let need = bytes.len();
    bytes.truncate(need.saturating_sub(3));
    assert!(unpack_pcm_chunk(&bytes).is_none());
  }
}
