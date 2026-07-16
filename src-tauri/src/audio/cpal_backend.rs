//! cpal / WASAPI capture loop and session management.
//! Device enumeration and id resolution live in `device_enum`.

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use super::capture::{AudioCapture, AudioCaptureSession};
use super::device::DeviceInfo;
#[cfg(target_os = "windows")]
use super::device_enum::is_loopback_capture;
use super::device_enum::{build_device_list, resolve_device};

use crate::dsp::speech::VadEngineKind;
use crate::engine::ChannelLayoutSetting;
use crate::engine::MeterPipeline;
use crate::ipc::types::{AnalysisRequests, EngineBackpressurePayload};
use tauri::{AppHandle, Emitter, Manager};

const PCM_QUEUE_CAP: usize = 64;
const PCM_POOL_CHUNK_MS: usize = 100;
const PCM_MIN_BUFFER_SAMPLES: usize = 4096;
/// Max frames sent to the UI but not yet acked before the bridge starts dropping. The Tauri
/// `Channel` to the webview has no backpressure: if the UI thread stalls (e.g. a render loop)
/// while capture keeps producing ~60 Hz, frames queue in the host process unboundedly until OOM.
/// Capping in-flight frames bounds that backlog to ~2 s (~1 MB) and resumes once the UI catches up.
const MAX_FRAMES_INFLIGHT: u64 = 120;

/// True when `sent_seq - acked_seq` has reached `max_inflight`, i.e. the next frame must be
/// dropped rather than sent. `saturating_sub` guards a stale-high ack after an engine restart.
pub(crate) fn frame_inflight_exceeds(sent_seq: u64, acked_seq: u64, max_inflight: u64) -> bool {
  sent_seq.saturating_sub(acked_seq) >= max_inflight
}

// Re-export device helpers for ipc/commands.rs (all platforms).
pub use super::device_enum::{
  capture_list_id_for_row, device_default_format, loopback_list_id_for_row, preview_device,
};
// Re-export helpers used by macos/mod.rs (compiled only on macOS).
#[cfg(target_os = "macos")]
pub(crate) use super::device_enum::{
  append_input_devices, collect_outputs, device_id_key, device_list_label, pick_output_by_index,
  resolve_default_output,
};

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
    channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
    loudness_weights: Arc<std::sync::Mutex<Option<Vec<f64>>>>,
    dialogue_gating: Arc<std::sync::Mutex<bool>>,
    dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
  ) -> Result<Box<dyn AudioCaptureSession>, String> {
    Ok(Box::new(CaptureSession::start(
      device_id,
      frame_subscribers,
      app,
      channel_layout,
      loudness_weights,
      dialogue_gating,
      dialogue_vad_engine,
    )?))
  }
}

pub(crate) struct CaptureSession {
  stop_tx: std::sync::mpsc::Sender<()>,
  join: Option<JoinHandle<Result<(), String>>>,
  clear_peak_history: Arc<AtomicBool>,
  reset_tp_max: Arc<AtomicBool>,
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

  fn request_reset_true_peak_max(&self) {
    self.reset_tp_max.store(true, Ordering::Release);
  }
}

impl CaptureSession {
  #[allow(clippy::too_many_arguments)]
  pub(crate) fn start(
    device_id: &str,
    frame_subscribers: crate::ipc::types::FrameSubscribers,
    app: AppHandle,
    channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
    loudness_weights: Arc<std::sync::Mutex<Option<Vec<f64>>>>,
    dialogue_gating: Arc<std::sync::Mutex<bool>>,
    dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
  ) -> Result<Self, String> {
    let (device, supported) = resolve_device(device_id)?;
    let sample_rate = supported.sample_rate();
    let channels = supported.channels();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let clear_peak_history = Arc::new(AtomicBool::new(false));
    let clear_worker = clear_peak_history.clone();
    let reset_tp_max = Arc::new(AtomicBool::new(false));
    let reset_tp_max_worker = reset_tp_max.clone();
    let dropped_chunks = Arc::new(AtomicU64::new(0));
    let device_id = device_id.to_string();

    let join = std::thread::Builder::new()
      .name("capture".into())
      .spawn(move || {
        run_capture_worker(RunCaptureArgs {
          device_id: device_id.to_string(),
          device,
          supported,
          sample_rate,
          channels,
          frame_subscribers,
          app,
          stop_rx,
          clear_peak_history: clear_worker,
          reset_tp_max: reset_tp_max_worker,
          channel_layout,
          loudness_weights,
          dialogue_gating,
          dialogue_vad_engine,
          dropped_chunks,
        })
      })
      .map_err(|e| e.to_string())?;

    Ok(CaptureSession {
      stop_tx,
      join: Some(join),
      clear_peak_history,
      reset_tp_max,
    })
  }
}

struct RunCaptureArgs {
  device_id: String,
  device: cpal::Device,
  supported: cpal::SupportedStreamConfig,
  sample_rate: u32,
  channels: u16,
  frame_subscribers: crate::ipc::types::FrameSubscribers,
  app: tauri::AppHandle,
  stop_rx: std::sync::mpsc::Receiver<()>,
  clear_peak_history: Arc<AtomicBool>,
  reset_tp_max: Arc<AtomicBool>,
  channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
  loudness_weights: Arc<std::sync::Mutex<Option<Vec<f64>>>>,
  dialogue_gating: Arc<std::sync::Mutex<bool>>,
  dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
  dropped_chunks: Arc<AtomicU64>,
}

#[derive(Clone)]
pub(crate) struct PcmBufferPool {
  buffers: Arc<Mutex<Vec<Vec<f32>>>>,
}

impl PcmBufferPool {
  pub(crate) fn new(buffer_count: usize, buffer_capacity: usize) -> Self {
    let mut buffers = Vec::with_capacity(buffer_count);
    for _ in 0..buffer_count {
      buffers.push(Vec::with_capacity(buffer_capacity));
    }
    Self {
      buffers: Arc::new(Mutex::new(buffers)),
    }
  }

  pub(crate) fn checkout(&self) -> Option<Vec<f32>> {
    self.buffers.try_lock().ok()?.pop().map(|mut buffer| {
      buffer.clear();
      buffer
    })
  }

  pub(crate) fn recycle(&self, mut buffer: Vec<f32>) {
    buffer.clear();
    if let Ok(mut buffers) = self.buffers.try_lock() {
      buffers.push(buffer);
    }
  }
}

pub(crate) fn pooled_pcm_buffer_capacity(sample_rate: u32, channels: u16) -> usize {
  let ch = channels.max(1) as usize;
  ((sample_rate as usize * ch * PCM_POOL_CHUNK_MS) / 1000).max(PCM_MIN_BUFFER_SAMPLES)
}

pub(crate) fn send_pcm_buffer_or_count_drop(
  tx: &std::sync::mpsc::SyncSender<Vec<f32>>,
  pool: &PcmBufferPool,
  buffer: Vec<f32>,
  dropped: &AtomicU64,
) -> bool {
  match tx.try_send(buffer) {
    Ok(()) => true,
    Err(std::sync::mpsc::TrySendError::Full(buffer))
    | Err(std::sync::mpsc::TrySendError::Disconnected(buffer)) => {
      dropped.fetch_add(1, Ordering::Relaxed);
      pool.recycle(buffer);
      false
    }
  }
}

pub(crate) fn copy_f32_pcm_to_pooled_buffer(
  pool: &PcmBufferPool,
  data: &[f32],
  dropped: &AtomicU64,
) -> Option<Vec<f32>> {
  let mut buffer = match pool.checkout() {
    Some(buffer) => buffer,
    None => {
      dropped.fetch_add(1, Ordering::Relaxed);
      return None;
    }
  };
  if buffer.capacity() < data.len() {
    dropped.fetch_add(1, Ordering::Relaxed);
    pool.recycle(buffer);
    return None;
  }
  buffer.extend_from_slice(data);
  Some(buffer)
}

fn copy_i16_pcm_to_pooled_buffer(
  pool: &PcmBufferPool,
  data: &[i16],
  dropped: &AtomicU64,
) -> Option<Vec<f32>> {
  let mut buffer = match pool.checkout() {
    Some(buffer) => buffer,
    None => {
      dropped.fetch_add(1, Ordering::Relaxed);
      return None;
    }
  };
  if buffer.capacity() < data.len() {
    dropped.fetch_add(1, Ordering::Relaxed);
    pool.recycle(buffer);
    return None;
  }
  for &s in data {
    buffer.push(s as f32 / 32768.0);
  }
  Some(buffer)
}

fn copy_u16_pcm_to_pooled_buffer(
  pool: &PcmBufferPool,
  data: &[u16],
  dropped: &AtomicU64,
) -> Option<Vec<f32>> {
  let mut buffer = match pool.checkout() {
    Some(buffer) => buffer,
    None => {
      dropped.fetch_add(1, Ordering::Relaxed);
      return None;
    }
  };
  if buffer.capacity() < data.len() {
    dropped.fetch_add(1, Ordering::Relaxed);
    pool.recycle(buffer);
    return None;
  }
  for &s in data {
    buffer.push((s as f32 / 32768.0) - 1.0);
  }
  Some(buffer)
}

/// Feeds interleaved f32 PCM from `audio_rx` into [`MeterPipeline`] until the sender side drops.
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_meter_pipeline_bridge_thread(
  audio_rx: std::sync::mpsc::Receiver<Vec<f32>>,
  sample_rate: u32,
  channels: u16,
  frame_subscribers: crate::ipc::types::FrameSubscribers,
  app: tauri::AppHandle,
  clear_peak_history: Arc<AtomicBool>,
  reset_tp_max: Arc<AtomicBool>,
  channel_layout: Arc<std::sync::Mutex<ChannelLayoutSetting>>,
  loudness_weights: Arc<std::sync::Mutex<Option<Vec<f64>>>>,
  dialogue_gating: Arc<std::sync::Mutex<bool>>,
  dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
  dropped_chunks: Arc<AtomicU64>,
  pcm_pool: PcmBufferPool,
) {
  let dropped_worker = dropped_chunks.clone();
  // Shared UI ack counter (see AppState::frame_ack_seq). Cloned once so the loop only does an
  // atomic load per frame. Falls back to a private counter if state is somehow unmanaged.
  let acked_seq = app
    .try_state::<crate::state::AppState>()
    .map(|s| s.frame_ack_seq.clone())
    .unwrap_or_else(|| Arc::new(AtomicU64::new(0)));
  let analysis_requests = app
    .try_state::<crate::state::AppState>()
    .map(|s| s.analysis_requests.clone())
    .unwrap_or_else(|| Arc::new(Mutex::new(AnalysisRequests::default())));
  let mut sent_seq: u64 = 0;
  let mut dropped_frames: u64 = 0;
  let mut pipeline = MeterPipeline::new(sample_rate, channels);
  let mut recv_tick: u32 = 0;
  while let Ok(floats) = audio_rx.recv() {
    recv_tick = recv_tick.wrapping_add(1);
    if recv_tick.is_multiple_of(480) {
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
      if dropped_frames > 0 {
        log::warn!(
          "UI frame backlog at cap: dropped {dropped_frames} frames (webview not consuming)"
        );
        dropped_frames = 0;
      }
    }
    if clear_peak_history.load(Ordering::Acquire) {
      clear_peak_history.store(false, Ordering::Release);
      pipeline.clear_peak_and_history();
    }
    if reset_tp_max.load(Ordering::Acquire) {
      reset_tp_max.store(false, Ordering::Release);
      pipeline.reset_true_peak_max();
    }
    let layout = channel_layout
      .lock()
      .map(|g| *g)
      .unwrap_or(ChannelLayoutSetting::Auto);
    let requests = analysis_requests
      .lock()
      .map(|g| g.clone())
      .unwrap_or_else(|_| AnalysisRequests::default());
    let loudness_weights = loudness_weights.lock().map(|g| g.clone()).unwrap_or(None);
    let dialogue_gating = dialogue_gating.lock().map(|g| *g).unwrap_or(false);
    let dialogue_vad_engine = dialogue_vad_engine.lock().map(|g| *g).unwrap_or_default();
    let frame = pipeline.push_pcm_f32_with_requests(
      &floats,
      layout,
      &requests,
      loudness_weights,
      dialogue_gating,
      dialogue_vad_engine,
    );
    let mut should_stop = false;
    if let Some(mut f) = frame {
      // Backpressure: the UI Channel never blocks, so a stalled webview would let frames pile up
      // in the host process until OOM. Drop frames once too many are sent-but-unacked; sending
      // resumes automatically once the UI acks and the backlog clears.
      if frame_inflight_exceeds(
        sent_seq,
        acked_seq.load(Ordering::Relaxed),
        MAX_FRAMES_INFLIGHT,
      ) {
        dropped_frames += 1;
        pcm_pool.recycle(floats);
        continue;
      }
      sent_seq += 1;
      f.seq = sent_seq;
      if let Ok(mut m) = frame_subscribers.lock() {
        {
          // Stop capture if the main stream drops.
          let main_ok = match m.get_mut("main") {
            Some(tx) => tx.send(f.clone()).is_ok(),
            None => false,
          };
          if !main_ok {
            should_stop = true;
          }
        }
        // Avoid per-key remove/insert on every frame; drop dead subscribers lazily.
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
        should_stop = true;
      }
    }
    pcm_pool.recycle(floats);
    if should_stop {
      break;
    }
  }
}

/// Create a silence output stream on the same device to keep WASAPI loopback active.
/// On Windows, WASAPI loopback stops sending callbacks when there's no audio playing.
/// Playing silence keeps the audio engine active so callbacks continue.
#[cfg(target_os = "windows")]
fn create_silence_stream(device: &cpal::Device, config: &StreamConfig) -> Option<cpal::Stream> {
  let stream = device
    .build_output_stream(
      *config,
      move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
        // Write silence (all zeros)
        for sample in data.iter_mut() {
          *sample = 0.0;
        }
      },
      |e| log::error!("silence stream error: {e}"),
      None,
    )
    .ok()?;

  if stream.play().is_ok() {
    log::info!("Silence stream started for WASAPI loopback capture");
    Some(stream)
  } else {
    log::warn!("Failed to start silence stream");
    None
  }
}

/// Device-facing half of live capture, free of Tauri. Opens the stream, feeds
/// pooled PCM into a queue, and hands the queue to `consumer` on its own thread.
/// The GUI passes the meter/IPC bridge; the CLI passes a `SummaryMeter` loop.
/// Blocks until `stop_rx` fires, then tears the stream down and joins `consumer`.
pub(crate) struct CaptureStreamArgs {
  pub(crate) device_id: String,
  pub(crate) device: cpal::Device,
  pub(crate) supported: cpal::SupportedStreamConfig,
  pub(crate) sample_rate: u32,
  pub(crate) channels: u16,
  pub(crate) stop_rx: std::sync::mpsc::Receiver<()>,
  pub(crate) dropped_chunks: Arc<AtomicU64>,
}

pub(crate) fn run_capture_stream<C>(args: CaptureStreamArgs, consumer: C) -> Result<(), String>
where
  C: FnOnce(std::sync::mpsc::Receiver<Vec<f32>>, PcmBufferPool, u32, u16) + Send + 'static,
{
  let CaptureStreamArgs {
    device_id: _device_id,
    device,
    supported,
    sample_rate,
    channels,
    stop_rx,
    dropped_chunks,
  } = args;
  let dropped_for_callbacks = dropped_chunks;
  let stream_config = StreamConfig {
    channels,
    sample_rate: supported.sample_rate(),
    buffer_size: cpal::BufferSize::Default,
  };

  // On Windows, create a silence output stream for loopback devices to keep
  // the audio engine active when no other audio is playing.
  #[cfg(target_os = "windows")]
  let device_id = _device_id;
  #[cfg(target_os = "windows")]
  let _silence_stream = if is_loopback_capture(&device_id) {
    create_silence_stream(&device, &stream_config)
  } else {
    None
  };

  let pcm_pool = PcmBufferPool::new(
    PCM_QUEUE_CAP,
    pooled_pcm_buffer_capacity(sample_rate, channels),
  );
  let consumer_pool = pcm_pool.clone();
  let (audio_tx, audio_rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(PCM_QUEUE_CAP);

  let consumer_thread = std::thread::spawn(move || {
    consumer(audio_rx, consumer_pool, sample_rate, channels);
  });

  let stream = match supported.sample_format() {
    SampleFormat::F32 => {
      let tx = audio_tx.clone();
      let dropped = dropped_for_callbacks.clone();
      let pool = pcm_pool.clone();
      device
        .build_input_stream(
          stream_config,
          move |data: &[f32], _: &cpal::InputCallbackInfo| {
            if let Some(buffer) = copy_f32_pcm_to_pooled_buffer(&pool, data, &dropped) {
              send_pcm_buffer_or_count_drop(&tx, &pool, buffer, &dropped);
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
      let pool = pcm_pool.clone();
      device
        .build_input_stream(
          stream_config,
          move |data: &[i16], _: &cpal::InputCallbackInfo| {
            if let Some(buffer) = copy_i16_pcm_to_pooled_buffer(&pool, data, &dropped) {
              send_pcm_buffer_or_count_drop(&tx, &pool, buffer, &dropped);
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
      let pool = pcm_pool.clone();
      device
        .build_input_stream(
          stream_config,
          move |data: &[u16], _: &cpal::InputCallbackInfo| {
            if let Some(buffer) = copy_u16_pcm_to_pooled_buffer(&pool, data, &dropped) {
              send_pcm_buffer_or_count_drop(&tx, &pool, buffer, &dropped);
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
  let _ = consumer_thread.join();
  Ok(())
}

fn run_capture_worker(args: RunCaptureArgs) -> Result<(), String> {
  let RunCaptureArgs {
    device_id,
    device,
    supported,
    sample_rate,
    channels,
    frame_subscribers,
    app,
    stop_rx,
    clear_peak_history,
    reset_tp_max,
    channel_layout,
    loudness_weights,
    dialogue_gating,
    dialogue_vad_engine,
    dropped_chunks,
  } = args;
  let bridge_dropped = dropped_chunks.clone();

  run_capture_stream(
    CaptureStreamArgs {
      device_id,
      device,
      supported,
      sample_rate,
      channels,
      stop_rx,
      dropped_chunks,
    },
    move |audio_rx, pool, sample_rate, channels| {
      run_meter_pipeline_bridge_thread(
        audio_rx,
        sample_rate,
        channels,
        frame_subscribers,
        app,
        clear_peak_history,
        reset_tp_max,
        channel_layout,
        loudness_weights,
        dialogue_gating,
        dialogue_vad_engine,
        bridge_dropped,
        pool,
      );
    },
  )
}

#[cfg(test)]
mod backpressure_tests {
  use super::{frame_inflight_exceeds, MAX_FRAMES_INFLIGHT};

  #[test]
  fn does_not_drop_while_ui_keeps_up() {
    // UI acked the latest frame: zero in-flight, never drop.
    assert!(!frame_inflight_exceeds(1000, 1000, MAX_FRAMES_INFLIGHT));
    // A few unacked frames (normal IPC + ack latency) stay under the cap.
    assert!(!frame_inflight_exceeds(
      1000,
      1000 - (MAX_FRAMES_INFLIGHT - 1),
      MAX_FRAMES_INFLIGHT
    ));
  }

  #[test]
  fn drops_when_backlog_reaches_cap() {
    // UI stalled: sent keeps climbing, acked frozen → drop at and beyond the cap.
    assert!(frame_inflight_exceeds(
      MAX_FRAMES_INFLIGHT,
      0,
      MAX_FRAMES_INFLIGHT
    ));
    assert!(frame_inflight_exceeds(
      MAX_FRAMES_INFLIGHT + 5000,
      0,
      MAX_FRAMES_INFLIGHT
    ));
  }

  #[test]
  fn resumes_after_ui_catches_up() {
    // Backlog was at the cap, then the UI acks everything → drop clears.
    assert!(frame_inflight_exceeds(120, 0, MAX_FRAMES_INFLIGHT));
    assert!(!frame_inflight_exceeds(120, 120, MAX_FRAMES_INFLIGHT));
  }

  #[test]
  fn stale_high_ack_after_restart_does_not_wrap() {
    // A leftover ack above the fresh sent counter must not underflow into a huge in-flight.
    assert!(!frame_inflight_exceeds(3, 1000, MAX_FRAMES_INFLIGHT));
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

#[cfg(test)]
mod pcm_buffer_pool_tests {
  use super::{
    copy_f32_pcm_to_pooled_buffer, copy_i16_pcm_to_pooled_buffer, copy_u16_pcm_to_pooled_buffer,
    send_pcm_buffer_or_count_drop, PcmBufferPool,
  };
  use std::sync::atomic::{AtomicU64, Ordering};

  #[test]
  fn returned_buffers_are_cleared_and_reused() {
    let pool = PcmBufferPool::new(1, 4);

    let mut first = pool.checkout().expect("buffer");
    first.extend_from_slice(&[0.25, -0.5]);
    let first_capacity = first.capacity();

    pool.recycle(first);

    let second = pool.checkout().expect("buffer");
    assert!(second.is_empty());
    assert_eq!(second.capacity(), first_capacity);
  }

  #[test]
  fn checkout_returns_none_instead_of_blocking_when_pool_is_busy() {
    let pool = PcmBufferPool::new(1, 4);
    let _guard = pool.buffers.lock().expect("lock pool");
    let worker_pool = pool.clone();
    let (tx, rx) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
      tx.send(worker_pool.checkout().is_none())
        .expect("send result");
    });

    assert_eq!(
      rx.recv_timeout(std::time::Duration::from_millis(50)),
      Ok(true)
    );
  }

  #[test]
  fn full_queue_recycles_buffer_and_counts_drop() {
    let pool = PcmBufferPool::new(1, 4);
    let dropped = AtomicU64::new(0);
    let (tx, _rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(0);

    let mut buffer = pool.checkout().expect("buffer");
    buffer.extend_from_slice(&[0.25, -0.5]);
    let capacity = buffer.capacity();

    assert!(!send_pcm_buffer_or_count_drop(&tx, &pool, buffer, &dropped));

    assert_eq!(dropped.load(Ordering::Relaxed), 1);
    let recycled = pool.checkout().expect("recycled buffer");
    assert!(recycled.is_empty());
    assert_eq!(recycled.capacity(), capacity);
  }

  #[test]
  fn f32_pcm_data_is_copied_into_a_pooled_buffer() {
    let pool = PcmBufferPool::new(1, 4);
    let dropped = AtomicU64::new(0);

    let buffer =
      copy_f32_pcm_to_pooled_buffer(&pool, &[0.25, -0.5], &dropped).expect("pooled buffer");

    assert_eq!(buffer, vec![0.25, -0.5]);
    assert_eq!(dropped.load(Ordering::Relaxed), 0);
    assert!(pool.checkout().is_none());
  }

  #[test]
  fn oversized_pcm_data_is_dropped_instead_of_growing_the_buffer() {
    let pool = PcmBufferPool::new(1, 1);
    let dropped = AtomicU64::new(0);

    let buffer = copy_f32_pcm_to_pooled_buffer(&pool, &[0.25, -0.5], &dropped);

    assert!(buffer.is_none());
    assert_eq!(dropped.load(Ordering::Relaxed), 1);
    let recycled = pool.checkout().expect("recycled buffer");
    assert_eq!(recycled.capacity(), 1);
  }

  #[test]
  fn i16_pcm_data_is_converted_into_a_pooled_buffer() {
    let pool = PcmBufferPool::new(1, 4);
    let dropped = AtomicU64::new(0);

    let buffer =
      copy_i16_pcm_to_pooled_buffer(&pool, &[16_384, -32_768], &dropped).expect("pooled buffer");

    assert_eq!(buffer, vec![0.5, -1.0]);
    assert_eq!(dropped.load(Ordering::Relaxed), 0);
    assert!(pool.checkout().is_none());
  }

  #[test]
  fn u16_pcm_data_is_converted_into_a_pooled_buffer() {
    let pool = PcmBufferPool::new(1, 4);
    let dropped = AtomicU64::new(0);

    let buffer =
      copy_u16_pcm_to_pooled_buffer(&pool, &[49_152, 0], &dropped).expect("pooled buffer");

    assert_eq!(buffer, vec![0.5, -1.0]);
    assert_eq!(dropped.load(Ordering::Relaxed), 0);
    assert!(pool.checkout().is_none());
  }
}
