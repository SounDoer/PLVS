//! cpal / WASAPI capture loop and session management.
//! Device enumeration and id resolution live in `device_enum`.

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use crossbeam_queue::ArrayQueue;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::capture::{
  AudioCapture, AudioCaptureSession, MeasuredPcmSubscriptions, MeterResetKind, MeterResetRequest,
};
use super::device::DeviceInfo;
#[cfg(target_os = "windows")]
use super::device_enum::is_loopback_capture;
use super::device_enum::{build_device_list, resolve_device};
use super::source_layout::CaptureWorkerError;

use crate::dsp::speech::VadEngineKind;
use crate::engine::MeterPipeline;
use crate::ipc::types::{AnalysisRequests, EngineBackpressurePayload, EngineStateChanged};
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const PCM_QUEUE_CAP: usize = 64;
const PCM_POOL_CHUNK_MS: usize = 100;
const PCM_MIN_BUFFER_SAMPLES: usize = 4096;
/// Worker-only idle wait. The callback never wakes or unparks the worker; at most 1 ms is added
/// when transitioning from an empty queue, while avoiding a busy-spin during silence or shutdown.
const PCM_WORKER_IDLE_POLL: std::time::Duration = std::time::Duration::from_millis(1);
/// Max frames sent to the UI but not yet acked before the bridge starts dropping. The Tauri
/// `Channel` to the webview has no backpressure: if the UI thread stalls (e.g. a render loop)
/// while capture keeps producing ~60 Hz, frames queue in the host process unboundedly until OOM.
/// Capping in-flight frames bounds that backlog to ~2 s (~1 MB) and resumes once the UI catches up.
pub(crate) const MAX_FRAMES_INFLIGHT: u64 = 120;

/// A running capture that delivers no callbacks for this long has failed. WASAPI loopback (kept
/// alive by the silence stream), cpal inputs and the macOS tap all call back continuously, even in
/// silence. Longer than the 2 s device watch, so an Automatic default-output change restarts
/// capture before this fires.
pub(crate) const CAPTURE_STALL_TIMEOUT: Duration = Duration::from_secs(5);
/// Starting a macOS system-output tap can show the one-time recording permission prompt. Keep the
/// startup allowance separate from the running-stream stall threshold so a user can answer the
/// prompt without weakening detection after the first callback arrives.
#[cfg(target_os = "macos")]
pub(crate) const CAPTURE_START_TIMEOUT: Duration = Duration::from_secs(30);
const CAPTURE_WATCH_POLL: Duration = Duration::from_millis(250);

/// Last fatal stream error the backend reported, recorded lock-free from the error callback so the
/// stall report can name a cause.
const STREAM_ERROR_NONE: u8 = 0;
const STREAM_ERROR_DEVICE_UNAVAILABLE: u8 = 1;
const STREAM_ERROR_INVALIDATED: u8 = 2;
const STREAM_ERROR_OUTPUT_IN_USE: u8 = 3;
const AUDCLNT_E_NOT_INITIALIZED: i32 = 0x8889_0001_u32 as i32;
const AUDCLNT_E_WRONG_ENDPOINT_TYPE: i32 = 0x8889_0003_u32 as i32;
const AUDCLNT_E_DEVICE_INVALIDATED: i32 = 0x8889_0004_u32 as i32;
const AUDCLNT_E_DEVICE_IN_USE: i32 = 0x8889_000A_u32 as i32;

const OUTPUT_IN_USE_MESSAGE: &str = "Capture unavailable: another app has exclusive use \
  of this output, for example to send Dolby Atmos to a receiver. Stop that playback, then select \
  Start.";

/// CPAL exposes WASAPI HRESULTs only in the message's ` (os error N)` suffix.
fn wasapi_os_error(message: &str) -> Option<i32> {
  message
    .strip_suffix(')')
    .and_then(|message| message.rsplit_once(" (os error "))
    .and_then(|(_, code)| code.parse::<i32>().ok())
}

/// While an app holds the endpoint exclusively (encoded passthrough such as Dolby Atmos), shared
/// loopback initialization fails with either HRESULT; a running stream reports DEVICE_IN_USE.
fn is_output_in_use_error(message: &str) -> bool {
  matches!(
    wasapi_os_error(message),
    Some(AUDCLNT_E_NOT_INITIALIZED | AUDCLNT_E_DEVICE_IN_USE)
  )
}

/// Replaces a loopback start failure caused by exclusive output use with a readable message and
/// records the cause so the failure event carries a structured reason.
fn loopback_start_error(message: String, wasapi_loopback: bool, flag: &AtomicU8) -> String {
  if wasapi_loopback && is_output_in_use_error(&message) {
    log::warn!("loopback start refused while the output is in use: {message}");
    flag.store(STREAM_ERROR_OUTPUT_IN_USE, Ordering::Relaxed);
    OUTPUT_IN_USE_MESSAGE.into()
  } else {
    message
  }
}

fn store_output_in_use(flag: &AtomicU8, error: &cpal::Error) {
  if error.message().and_then(wasapi_os_error) == Some(AUDCLNT_E_DEVICE_IN_USE) {
    let _ = flag.compare_exchange(
      STREAM_ERROR_NONE,
      STREAM_ERROR_OUTPUT_IN_USE,
      Ordering::Relaxed,
      Ordering::Relaxed,
    );
  }
}

fn stream_error_code(kind: cpal::ErrorKind) -> u8 {
  match kind {
    cpal::ErrorKind::DeviceNotAvailable => STREAM_ERROR_DEVICE_UNAVAILABLE,
    cpal::ErrorKind::StreamInvalidated => STREAM_ERROR_INVALIDATED,
    _ => STREAM_ERROR_NONE,
  }
}

fn store_stream_error(flag: &AtomicU8, error: &cpal::Error, wasapi_loopback: bool) {
  // WASAPI invalidates both the capture client and its silence output during an endpoint
  // reconfiguration. CPAL maps that HRESULT to DeviceNotAvailable even when the endpoint
  // remains present. Let the recovery path check whether the selected endpoint can be reopened.
  let code = if wasapi_loopback
    && error.kind() == cpal::ErrorKind::DeviceNotAvailable
    && error.message().and_then(wasapi_os_error) == Some(AUDCLNT_E_DEVICE_INVALIDATED)
  {
    STREAM_ERROR_INVALIDATED
  } else {
    stream_error_code(error.kind())
  };
  if code != STREAM_ERROR_NONE {
    flag.store(code, Ordering::Relaxed);
  }
}

fn record_stream_error(
  flag: Arc<AtomicU8>,
  wasapi_loopback: bool,
) -> impl FnMut(cpal::Error) + Send + 'static {
  move |error| {
    store_stream_error(&flag, &error, wasapi_loopback);
    if wasapi_loopback {
      store_output_in_use(&flag, &error);
    }
    // Spatial Sound can invalidate a running loopback stream with this HRESULT. CPAL reports it
    // as UnsupportedOperation and exposes the native code only in the message's os error suffix.
    if wasapi_loopback
      && error.kind() == cpal::ErrorKind::UnsupportedOperation
      && error.message().and_then(wasapi_os_error) == Some(AUDCLNT_E_WRONG_ENDPOINT_TYPE)
    {
      // Keep an explicit disconnection reported by the silence output stream.
      let _ = flag.compare_exchange(
        STREAM_ERROR_NONE,
        STREAM_ERROR_INVALIDATED,
        Ordering::Relaxed,
        Ordering::Relaxed,
      );
    }
    log::error!("cpal stream error: {error}");
  }
}

pub(crate) fn capture_stall_message(stream_error: u8) -> String {
  match stream_error {
    STREAM_ERROR_DEVICE_UNAVAILABLE => {
      "Capture stopped: the audio device is no longer available.".into()
    }
    STREAM_ERROR_INVALIDATED => "Capture stopped: the system invalidated the audio stream.".into(),
    STREAM_ERROR_OUTPUT_IN_USE => OUTPUT_IN_USE_MESSAGE.into(),
    _ => format!(
      "Capture stopped: no audio received for {} s.",
      CAPTURE_STALL_TIMEOUT.as_secs()
    ),
  }
}

/// Tracks whether a callback activity counter is still advancing.
pub(crate) struct StallWatch {
  timeout: Duration,
  last_activity: u64,
  last_progress: Instant,
}

impl StallWatch {
  pub(crate) fn new(timeout: Duration, activity: u64, now: Instant) -> Self {
    Self {
      timeout,
      last_activity: activity,
      last_progress: now,
    }
  }

  /// True once `activity` has not changed for the whole timeout.
  pub(crate) fn observe(&mut self, activity: u64, now: Instant) -> bool {
    if activity != self.last_activity {
      self.last_activity = activity;
      self.last_progress = now;
      return false;
    }
    now.saturating_duration_since(self.last_progress) >= self.timeout
  }
}

/// Blocks until `stop_rx` fires or its sender is dropped (`Ok`), a fatal backend error arrives, or,
/// when `activity` is watched, capture stops calling back (`Err` with a user-facing reason).
pub(crate) fn wait_for_stop_or_stall(
  stop_rx: &std::sync::mpsc::Receiver<()>,
  activity: Option<&AtomicU64>,
  stream_error: &AtomicU8,
) -> Result<(), String> {
  let mut watch = activity.map(|activity| {
    StallWatch::new(
      CAPTURE_STALL_TIMEOUT,
      activity.load(Ordering::Relaxed),
      Instant::now(),
    )
  });
  loop {
    match stop_rx.recv_timeout(CAPTURE_WATCH_POLL) {
      Err(RecvTimeoutError::Timeout) => {
        let error_code = stream_error.load(Ordering::Relaxed);
        if error_code != STREAM_ERROR_NONE {
          return Err(capture_stall_message(error_code));
        }
        if let (Some(activity), Some(watch)) = (activity, watch.as_mut()) {
          if watch.observe(activity.load(Ordering::Relaxed), Instant::now()) {
            return Err(capture_stall_message(STREAM_ERROR_NONE));
          }
        }
      }
      Ok(()) | Err(RecvTimeoutError::Disconnected) => return Ok(()),
    }
  }
}

/// Waits for the first backend callback while still honoring an explicit stop. Returns `true` once
/// capture is active and `false` when the session was stopped before it became active.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn wait_for_first_activity_or_stop(
  stop_rx: &std::sync::mpsc::Receiver<()>,
  activity: &AtomicU64,
  timeout: Duration,
) -> Result<bool, String> {
  let started = Instant::now();
  loop {
    if activity.load(Ordering::Relaxed) > 0 {
      return Ok(true);
    }
    let elapsed = started.elapsed();
    if elapsed >= timeout {
      return Err(format!(
        "Capture did not start: no audio received for {} s.",
        timeout.as_secs()
      ));
    }
    let wait = CAPTURE_WATCH_POLL.min(timeout.saturating_sub(elapsed));
    match stop_rx.recv_timeout(wait) {
      Err(RecvTimeoutError::Timeout) => {}
      Ok(()) | Err(RecvTimeoutError::Disconnected) => return Ok(false),
    }
  }
}

/// Reports a capture thread that ended on its own (startup failure or stall). Without it the UI
/// keeps showing LIVE over a frozen, silent meter.
pub(crate) fn emit_capture_failure(app: &AppHandle, error: &str, reason: Option<&str>) {
  log::error!("capture failed: {error}");
  let _ = app.emit(
    "engine-state-changed",
    EngineStateChanged {
      state: "error".into(),
      error: Some(error.to_string()),
      reason: reason.map(str::to_string),
    },
  );
}

#[cfg(test)]
mod capture_watch_tests {
  use super::{
    capture_stall_message, loopback_start_error, record_stream_error, store_stream_error,
    stream_error_code, wait_for_first_activity_or_stop, wait_for_stop_or_stall, StallWatch,
    OUTPUT_IN_USE_MESSAGE, STREAM_ERROR_DEVICE_UNAVAILABLE, STREAM_ERROR_INVALIDATED,
    STREAM_ERROR_NONE, STREAM_ERROR_OUTPUT_IN_USE,
  };
  use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
  use std::sync::Arc;
  use std::time::{Duration, Instant};

  const TIMEOUT: Duration = Duration::from_secs(5);

  #[test]
  fn advancing_activity_never_stalls() {
    let start = Instant::now();
    let mut watch = StallWatch::new(TIMEOUT, 0, start);
    for tick in 1..=60 {
      assert!(!watch.observe(tick, start + Duration::from_secs(tick)));
    }
  }

  #[test]
  fn frozen_activity_stalls_only_once_the_timeout_elapses() {
    let start = Instant::now();
    let mut watch = StallWatch::new(TIMEOUT, 7, start);
    assert!(!watch.observe(7, start + Duration::from_millis(4_999)));
    assert!(watch.observe(7, start + TIMEOUT));
  }

  #[test]
  fn progress_restarts_the_timeout() {
    let start = Instant::now();
    let mut watch = StallWatch::new(TIMEOUT, 0, start);
    assert!(!watch.observe(0, start + Duration::from_secs(4)));
    assert!(!watch.observe(1, start + Duration::from_millis(4_500)));
    assert!(!watch.observe(1, start + Duration::from_secs(9)));
    assert!(watch.observe(1, start + Duration::from_millis(9_500)));
  }

  #[test]
  fn a_requested_stop_is_not_a_failure() {
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    stop_tx.send(()).unwrap();
    let activity = AtomicU64::new(0);
    assert_eq!(
      wait_for_stop_or_stall(&stop_rx, Some(&activity), &AtomicU8::new(0)),
      Ok(())
    );
  }

  #[test]
  fn a_dropped_session_is_not_a_failure() {
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    drop(stop_tx);
    let activity = AtomicU64::new(0);
    assert_eq!(
      wait_for_stop_or_stall(&stop_rx, Some(&activity), &AtomicU8::new(0)),
      Ok(())
    );
  }

  #[test]
  fn an_existing_callback_completes_startup_immediately() {
    let (_stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    assert_eq!(
      wait_for_first_activity_or_stop(&stop_rx, &AtomicU64::new(1), Duration::from_secs(30)),
      Ok(true)
    );
  }

  #[test]
  fn a_stop_can_cancel_callback_startup_wait() {
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    stop_tx.send(()).unwrap();
    assert_eq!(
      wait_for_first_activity_or_stop(&stop_rx, &AtomicU64::new(0), Duration::from_secs(30)),
      Ok(false)
    );
  }

  #[test]
  fn first_callback_startup_wait_has_its_own_timeout() {
    let (_stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    assert_eq!(
      wait_for_first_activity_or_stop(&stop_rx, &AtomicU64::new(0), Duration::ZERO),
      Err("Capture did not start: no audio received for 0 s.".into())
    );
  }

  #[test]
  fn backend_errors_name_the_stall_cause() {
    assert_eq!(
      stream_error_code(cpal::ErrorKind::DeviceNotAvailable),
      STREAM_ERROR_DEVICE_UNAVAILABLE
    );
    assert_eq!(
      stream_error_code(cpal::ErrorKind::StreamInvalidated),
      STREAM_ERROR_INVALIDATED
    );
    assert_eq!(
      stream_error_code(cpal::ErrorKind::DeviceBusy),
      STREAM_ERROR_NONE
    );
    assert_eq!(
      stream_error_code(cpal::ErrorKind::DeviceChanged),
      STREAM_ERROR_NONE
    );
    assert_eq!(
      capture_stall_message(STREAM_ERROR_NONE),
      "Capture stopped: no audio received for 5 s."
    );
    assert_eq!(
      capture_stall_message(STREAM_ERROR_DEVICE_UNAVAILABLE),
      "Capture stopped: the audio device is no longer available."
    );
  }

  #[test]
  fn wasapi_endpoint_type_error_only_invalidates_loopback_capture() {
    let error = || {
      cpal::Error::with_message(
        cpal::ErrorKind::UnsupportedOperation,
        "OS Error -2004287485 (FormatMessageW() returned error 317) (os error -2004287485)",
      )
    };
    let flag = Arc::new(AtomicU8::new(STREAM_ERROR_NONE));
    record_stream_error(flag.clone(), false)(error());
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_NONE);

    let mut report = record_stream_error(flag.clone(), true);
    report(cpal::ErrorKind::UnsupportedOperation.into());
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_NONE);

    report(error());
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_INVALIDATED);

    report(cpal::ErrorKind::DeviceNotAvailable.into());
    report(error());
    assert_eq!(
      flag.load(Ordering::Relaxed),
      STREAM_ERROR_DEVICE_UNAVAILABLE
    );
  }

  #[test]
  fn wasapi_device_invalidation_allows_loopback_recovery_from_either_stream() {
    let capture_error = cpal::Error::with_message(
      cpal::ErrorKind::DeviceNotAvailable,
      "OS Error -2004287484 (FormatMessageW() returned error 317) (os error -2004287484)",
    );
    let silence_error = cpal::Error::with_message(
      cpal::ErrorKind::DeviceNotAvailable,
      "Failed to get current padding: OS Error -2004287484 (FormatMessageW() returned error 317) (os error -2004287484)",
    );
    let flag = Arc::new(AtomicU8::new(STREAM_ERROR_NONE));

    store_stream_error(&flag, &silence_error, true);
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_INVALIDATED);
    record_stream_error(flag.clone(), true)(capture_error.clone());
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_INVALIDATED);

    record_stream_error(flag.clone(), false)(capture_error);
    assert_eq!(
      flag.load(Ordering::Relaxed),
      STREAM_ERROR_DEVICE_UNAVAILABLE
    );
  }

  #[test]
  fn device_in_use_names_exclusive_output_use_only_for_loopback_capture() {
    let error = || {
      cpal::Error::with_message(
        cpal::ErrorKind::DeviceBusy,
        "OS Error -2004287478 (FormatMessageW() returned error 317) (os error -2004287478)",
      )
    };
    let flag = Arc::new(AtomicU8::new(STREAM_ERROR_NONE));
    record_stream_error(flag.clone(), false)(error());
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_NONE);

    record_stream_error(flag.clone(), true)(error());
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_OUTPUT_IN_USE);
    assert_eq!(
      capture_stall_message(STREAM_ERROR_OUTPUT_IN_USE),
      OUTPUT_IN_USE_MESSAGE
    );

    let (_stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    assert_eq!(
      wait_for_stop_or_stall(&stop_rx, None, &flag),
      Err(OUTPUT_IN_USE_MESSAGE.into())
    );
  }

  #[test]
  fn loopback_start_refused_by_exclusive_output_use_is_readable() {
    let not_initialized = "Failed to initialize audio client: OS Error -2004287487 \
      (FormatMessageW() returned error 317) (os error -2004287487)";
    let flag = AtomicU8::new(STREAM_ERROR_NONE);
    assert_eq!(
      loopback_start_error(not_initialized.into(), false, &flag),
      not_initialized
    );
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_NONE);

    let unsupported = "Failed to initialize audio client: OS Error -2004287480 \
      (FormatMessageW() returned error 317) (os error -2004287480)";
    assert_eq!(
      loopback_start_error(unsupported.into(), true, &flag),
      unsupported
    );
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_NONE);

    assert_eq!(
      loopback_start_error(not_initialized.into(), true, &flag),
      OUTPUT_IN_USE_MESSAGE
    );
    assert_eq!(flag.load(Ordering::Relaxed), STREAM_ERROR_OUTPUT_IN_USE);
  }

  #[test]
  fn fatal_stream_error_stops_even_when_callback_stalls_are_not_watched() {
    let (_stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let error = AtomicU8::new(STREAM_ERROR_INVALIDATED);
    assert_eq!(
      wait_for_stop_or_stall(&stop_rx, None, &error),
      Err("Capture stopped: the system invalidated the audio stream.".into())
    );
  }
}

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
    channel_selection: Arc<std::sync::Mutex<Option<crate::dsp::channel_layouts::ChannelSelection>>>,
    dialogue_gating: Arc<std::sync::Mutex<bool>>,
    dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
    measured_pcm: Arc<MeasuredPcmSubscriptions>,
  ) -> Result<Box<dyn AudioCaptureSession>, String> {
    Ok(Box::new(CaptureSession::start(
      device_id,
      frame_subscribers,
      app,
      channel_selection,
      dialogue_gating,
      dialogue_vad_engine,
      measured_pcm,
    )?))
  }
}

pub(crate) struct CaptureSession {
  stop_tx: std::sync::mpsc::Sender<()>,
  join: Option<JoinHandle<Result<(), CaptureWorkerError>>>,
  meter_resets: tauri::async_runtime::Sender<MeterResetRequest>,
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
  fn meter_resets(&self) -> &tauri::async_runtime::Sender<MeterResetRequest> {
    &self.meter_resets
  }
}

impl CaptureSession {
  #[allow(clippy::too_many_arguments)]
  pub(crate) fn start(
    device_id: &str,
    frame_subscribers: crate::ipc::types::FrameSubscribers,
    app: AppHandle,
    channel_selection: Arc<std::sync::Mutex<Option<crate::dsp::channel_layouts::ChannelSelection>>>,
    dialogue_gating: Arc<std::sync::Mutex<bool>>,
    dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
    measured_pcm: Arc<MeasuredPcmSubscriptions>,
  ) -> Result<Self, String> {
    let (device, supported) = resolve_device(device_id)?;
    let sample_rate = supported.sample_rate();
    let channels = supported.channels();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let (meter_resets, reset_requests) = tauri::async_runtime::channel(1);
    let dropped_chunks = Arc::new(AtomicU64::new(0));
    let device_id = device_id.to_string();
    let failure_app = app.clone();
    let stream_error = Arc::new(AtomicU8::new(STREAM_ERROR_NONE));
    let worker_stream_error = stream_error.clone();

    let join = std::thread::Builder::new()
      .name("capture".into())
      .spawn(move || {
        let result = run_capture_worker(RunCaptureArgs {
          device_id: device_id.to_string(),
          device,
          supported,
          sample_rate,
          channels,
          frame_subscribers,
          app,
          stop_rx,
          meter_resets: reset_requests,
          channel_selection,
          dialogue_gating,
          dialogue_vad_engine,
          measured_pcm,
          dropped_chunks,
          stream_error: worker_stream_error,
        });
        if let Err(error) = &result {
          let error_code = stream_error.load(Ordering::Relaxed);
          emit_capture_failure(
            &failure_app,
            error.message(),
            error.reason().or(match error_code {
              STREAM_ERROR_DEVICE_UNAVAILABLE => Some("deviceDisconnected"),
              STREAM_ERROR_INVALIDATED => Some("deviceInvalidated"),
              STREAM_ERROR_OUTPUT_IN_USE => Some("outputInUse"),
              _ => None,
            }),
          );
        }
        result
      })
      .map_err(|e| e.to_string())?;

    Ok(CaptureSession {
      stop_tx,
      join: Some(join),
      meter_resets,
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
  meter_resets: tauri::async_runtime::Receiver<MeterResetRequest>,
  channel_selection: Arc<std::sync::Mutex<Option<crate::dsp::channel_layouts::ChannelSelection>>>,
  dialogue_gating: Arc<std::sync::Mutex<bool>>,
  dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
  measured_pcm: Arc<MeasuredPcmSubscriptions>,
  dropped_chunks: Arc<AtomicU64>,
  stream_error: Arc<AtomicU8>,
}

#[derive(Clone)]
pub(crate) struct PcmBufferPool {
  buffers: Arc<ArrayQueue<Vec<f32>>>,
}

impl PcmBufferPool {
  pub(crate) fn new(buffer_count: usize, buffer_capacity: usize) -> Self {
    let buffers = Arc::new(ArrayQueue::new(buffer_count));
    for _ in 0..buffer_count {
      buffers
        .push(Vec::with_capacity(buffer_capacity))
        .expect("new PCM pool has one slot per buffer");
    }
    Self { buffers }
  }

  pub(crate) fn checkout(&self) -> Option<Vec<f32>> {
    self.buffers.pop().map(|mut buffer| {
      buffer.clear();
      buffer
    })
  }

  pub(crate) fn recycle(&self, mut buffer: Vec<f32>) {
    buffer.clear();
    let _ = self.buffers.push(buffer);
  }
}

/// A delivered buffer and the time the device handed it over.
type DeliveredPcm = (Vec<f32>, std::time::Instant);

#[derive(Clone)]
pub(crate) struct PcmDeliveryQueue {
  buffers: Arc<ArrayQueue<DeliveredPcm>>,
  producer_stopped: Arc<AtomicBool>,
  consumer_stopped: Arc<AtomicBool>,
  active_pushes: Arc<AtomicUsize>,
}

impl PcmDeliveryQueue {
  pub(crate) fn new(capacity: usize) -> Self {
    Self {
      buffers: Arc::new(ArrayQueue::new(capacity)),
      producer_stopped: Arc::new(AtomicBool::new(false)),
      consumer_stopped: Arc::new(AtomicBool::new(false)),
      active_pushes: Arc::new(AtomicUsize::new(0)),
    }
  }

  pub(crate) fn producer(&self) -> PcmDeliveryProducer {
    PcmDeliveryProducer {
      buffers: self.buffers.clone(),
      consumer_stopped: self.consumer_stopped.clone(),
      active_pushes: self.active_pushes.clone(),
    }
  }

  pub(crate) fn pop(&self) -> Option<Vec<f32>> {
    self.buffers.pop().map(|(buffer, _)| buffer)
  }

  pub(crate) fn stop_producer(&self) {
    self.producer_stopped.store(true, Ordering::Release);
  }

  pub(crate) fn pop_until_stopped(&self) -> Option<Vec<f32>> {
    self
      .pop_until_stopped_with_arrival()
      .map(|(buffer, _)| buffer)
  }

  /// As `pop_until_stopped`, with the time the buffer arrived from the device.
  pub(crate) fn pop_until_stopped_with_arrival(&self) -> Option<DeliveredPcm> {
    loop {
      if let Some(delivered) = self.buffers.pop() {
        return Some(delivered);
      }
      if self.producer_stopped.load(Ordering::Acquire) {
        return None;
      }
      std::thread::sleep(PCM_WORKER_IDLE_POLL);
    }
  }

  pub(crate) fn consumer_finished(&self, pool: &PcmBufferPool) {
    self.consumer_stopped.store(true, Ordering::Release);
    while self.active_pushes.load(Ordering::Acquire) != 0 {
      std::thread::yield_now();
    }
    while let Some(buffer) = self.pop() {
      pool.recycle(buffer);
    }
  }
}

#[derive(Clone)]
pub(crate) struct PcmDeliveryProducer {
  buffers: Arc<ArrayQueue<DeliveredPcm>>,
  consumer_stopped: Arc<AtomicBool>,
  active_pushes: Arc<AtomicUsize>,
}

impl PcmDeliveryProducer {
  fn push(&self, buffer: Vec<f32>) -> Result<(), Vec<f32>> {
    self.active_pushes.fetch_add(1, Ordering::AcqRel);
    if self.consumer_stopped.load(Ordering::Acquire) {
      self.active_pushes.fetch_sub(1, Ordering::Release);
      return Err(buffer);
    }
    // A monotonic clock read: user-mode on Windows (QPC), macOS and Linux (vDSO), so it neither
    // allocates nor blocks on a realtime callback thread.
    let result = self
      .buffers
      .push((buffer, std::time::Instant::now()))
      .map_err(|(buffer, _)| buffer);
    self.active_pushes.fetch_sub(1, Ordering::Release);
    result
  }
}

pub(crate) fn pooled_pcm_buffer_capacity(sample_rate: u32, channels: u16) -> usize {
  let ch = channels.max(1) as usize;
  ((sample_rate as usize * ch * PCM_POOL_CHUNK_MS) / 1000).max(PCM_MIN_BUFFER_SAMPLES)
}

fn enqueue_pcm_buffer_or_count_drop(
  producer: &PcmDeliveryProducer,
  pool: &PcmBufferPool,
  buffer: Vec<f32>,
  dropped: &AtomicU64,
) -> bool {
  match producer.push(buffer) {
    Ok(()) => true,
    Err(buffer) => {
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

/// Callback-side capability: copy PCM into an existing pooled buffer and try to enqueue it.
///
/// This type deliberately owns no meter, planner, spectral runtime, or blocking receive capability.
#[derive(Clone)]
pub(crate) struct PcmCallbackForwarder {
  producer: PcmDeliveryProducer,
  pool: PcmBufferPool,
  dropped: Arc<AtomicU64>,
  /// Counts every callback, delivered or dropped: the stall watch only asks whether the backend is
  /// still calling back.
  activity: Arc<AtomicU64>,
}

impl PcmCallbackForwarder {
  pub(crate) fn new(
    producer: PcmDeliveryProducer,
    pool: PcmBufferPool,
    dropped: Arc<AtomicU64>,
  ) -> Self {
    Self {
      producer,
      pool,
      dropped,
      activity: Arc::new(AtomicU64::new(0)),
    }
  }

  pub(crate) fn activity(&self) -> Arc<AtomicU64> {
    self.activity.clone()
  }

  pub(crate) fn forward_f32(&self, data: &[f32]) -> bool {
    self.forward(copy_f32_pcm_to_pooled_buffer(
      &self.pool,
      data,
      &self.dropped,
    ))
  }

  fn forward_i16(&self, data: &[i16]) -> bool {
    self.forward(copy_i16_pcm_to_pooled_buffer(
      &self.pool,
      data,
      &self.dropped,
    ))
  }

  fn forward_u16(&self, data: &[u16]) -> bool {
    self.forward(copy_u16_pcm_to_pooled_buffer(
      &self.pool,
      data,
      &self.dropped,
    ))
  }

  fn forward(&self, buffer: Option<Vec<f32>>) -> bool {
    self.activity.fetch_add(1, Ordering::Relaxed);
    buffer.is_some_and(|buffer| {
      enqueue_pcm_buffer_or_count_drop(&self.producer, &self.pool, buffer, &self.dropped)
    })
  }

  #[cfg(test)]
  fn recycle_for_test(&self, buffer: Vec<f32>) {
    self.pool.recycle(buffer);
  }
}

/// Feeds interleaved f32 PCM from the delivery queue into [`MeterPipeline`] until capture stops.
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_meter_pipeline_bridge_thread(
  delivery: PcmDeliveryQueue,
  sample_rate: u32,
  channels: u16,
  frame_subscribers: crate::ipc::types::FrameSubscribers,
  app: tauri::AppHandle,
  mut meter_resets: tauri::async_runtime::Receiver<MeterResetRequest>,
  channel_selection: Arc<std::sync::Mutex<Option<crate::dsp::channel_layouts::ChannelSelection>>>,
  dialogue_gating: Arc<std::sync::Mutex<bool>>,
  dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
  measured_pcm: Arc<MeasuredPcmSubscriptions>,
  publish_measured_pcm: bool,
  dropped_chunks: Arc<AtomicU64>,
  pcm_pool: PcmBufferPool,
  native_layout: Option<super::source_layout::NativeLayout>,
) {
  let dropped_worker = dropped_chunks.clone();
  // Shared UI ack counter (see AppState::frame_ack_seq). Cloned once so the loop only does an
  // atomic load per frame. Falls back to a private counter if state is somehow unmanaged.
  let acked_seq = app
    .try_state::<crate::state::AppState>()
    .map(|s| s.frame_ack_seq.clone())
    .unwrap_or_else(|| Arc::new(AtomicU64::new(0)));
  let ui_frame_diagnostics = app
    .try_state::<crate::state::AppState>()
    .map(|s| s.ui_frame_diagnostics.clone())
    .unwrap_or_default();
  let analysis_requests = app
    .try_state::<crate::state::AppState>()
    .map(|s| s.analysis_requests.clone())
    .unwrap_or_else(|| Arc::new(Mutex::new(AnalysisRequests::default())));
  let mut sent_seq: u64 = 0;
  let mut dropped_frames: u64 = 0;
  let plan = super::source_layout::MonitoringPlan::new(channels, native_layout);
  let channels = plan.channels();
  let mut projected = Vec::new();
  let mut pipeline = MeterPipeline::new(sample_rate, channels);
  pipeline.set_source_channel_roles(plan.roles.clone());
  pipeline.enable_async_dialogue();
  // Stop/Start continues the session statistics; `audio_start` empties the slot when the WebView
  // asks for a fresh measurement. Taking it also guarantees a carry is never resumed twice.
  let live_session_carry = app
    .try_state::<crate::state::AppState>()
    .map(|s| s.live_session_carry.clone());
  if let Some(carry) = live_session_carry
    .as_ref()
    .and_then(|slot| slot.lock().ok().and_then(|mut carry| carry.take()))
  {
    if !pipeline.resume_live_session(carry, sample_rate) {
      log::info!("Live session statistics restart: the Source format changed while stopped");
    }
  }
  let mut recv_tick: u32 = 0;
  loop {
    if delivery.producer_stopped.load(Ordering::Acquire) && delivery.buffers.is_empty() {
      break;
    }
    if let Ok(request) = meter_resets.try_recv() {
      if !request.completion.is_closed() {
        let result = apply_meter_reset(
          &mut pipeline,
          &frame_subscribers,
          request.kind,
          request.request_id,
          &channel_selection,
          &dialogue_gating,
          &dialogue_vad_engine,
        );
        let _ = request.completion.try_send(result);
      }
    }
    let Some((floats, arrived_at)) = delivery.buffers.pop() else {
      std::thread::sleep(PCM_WORKER_IDLE_POLL);
      continue;
    };
    let samples = plan.pcm(&floats, &mut projected);
    recv_tick = recv_tick.wrapping_add(1);
    if recv_tick.is_multiple_of(480) {
      let dropped = dropped_worker.swap(0, Ordering::Relaxed);
      if dropped > 0 {
        ui_frame_diagnostics.record_audio_dropped_chunks(dropped);
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
    if publish_measured_pcm {
      measured_pcm.publish_arrived_at(samples, sample_rate, channels, arrived_at);
    }
    let requests = analysis_requests
      .lock()
      .map(|g| g.clone())
      .unwrap_or_else(|_| AnalysisRequests::default());
    let channel_selection = channel_selection.lock().map(|g| g.clone()).unwrap_or(None);
    let dialogue_gating = dialogue_gating.lock().map(|g| *g).unwrap_or(false);
    let dialogue_vad_engine = dialogue_vad_engine.lock().map(|g| *g).unwrap_or_default();
    let frame = pipeline.push_pcm_f32_with_requests(
      samples,
      &requests,
      channel_selection,
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
        ui_frame_diagnostics.record_dropped();
        pcm_pool.recycle(floats);
        continue;
      }
      sent_seq += 1;
      f.seq = sent_seq;
      // Encode once for every subscriber. This also replaces the per-subscriber clone of the
      // payload -- cloning the encoded bytes copies one buffer instead of every band row's `Vec`.
      let Ok(message) = crate::ipc::frame_encode::encode_audio_frame(&f) else {
        // The envelope cannot fail on data the pipeline produces, so this is not a frame to skip
        // and retry -- it means the payload itself is malformed. Stop rather than stream garbage.
        pcm_pool.recycle(floats);
        break;
      };
      if let Ok(mut m) = frame_subscribers.lock() {
        {
          // Stop capture if the main stream drops.
          let main_ok = match m.get_mut("main") {
            Some(tx) => tx
              .send(tauri::ipc::InvokeResponseBody::Raw(message.clone()))
              .is_ok(),
            None => false,
          };
          if !main_ok {
            should_stop = true;
          } else {
            ui_frame_diagnostics.record_sent(sent_seq, acked_seq.load(Ordering::Relaxed));
          }
        }
        // Avoid per-key remove/insert on every frame; drop dead subscribers lazily.
        let mut to_remove: Vec<String> = Vec::new();
        for (id, tx) in m.iter_mut() {
          if id == "main" {
            continue;
          }
          if tx
            .send(tauri::ipc::InvokeResponseBody::Raw(message.clone()))
            .is_err()
          {
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
  if let Some(slot) = live_session_carry {
    if let Ok(mut carry) = slot.lock() {
      *carry = Some(pipeline.into_live_session_carry(sample_rate));
    }
  }
}

fn apply_meter_reset(
  pipeline: &mut MeterPipeline,
  subscribers: &crate::ipc::types::FrameSubscribers,
  kind: MeterResetKind,
  request_id: u32,
  channel_selection: &Mutex<Option<crate::dsp::channel_layouts::ChannelSelection>>,
  dialogue_gating: &Mutex<bool>,
  dialogue_vad_engine: &Mutex<VadEngineKind>,
) -> Result<(), String> {
  let subscribers = subscribers
    .lock()
    .map_err(|_| "meter subscribers lock poisoned")?;
  let main = subscribers.get("main").ok_or("Live meter stream closed")?;
  // This marker shares the ordered frame channel, so the WebView applies the reset after
  // all older frames and before any newer frames. It does not occupy a frame sequence number.
  let publish_marker = || {
    let marker = serde_json::json!({ "meterReset": request_id }).to_string();
    main
      .send(tauri::ipc::InvokeResponseBody::Json(marker))
      .map_err(|_| "Could not publish the Live meter reset".to_string())
  };
  match kind {
    MeterResetKind::History => pipeline.clear_peak_and_history(),
    MeterResetKind::Rules {
      channel_selection: selection,
      dialogue_gating: gating,
      dialogue_vad_engine: engine,
    } => {
      let mut channel_selection = channel_selection
        .lock()
        .map_err(|_| "channel selection lock poisoned")?;
      let mut dialogue_gating = dialogue_gating
        .lock()
        .map_err(|_| "dialogue gating lock poisoned")?;
      let mut dialogue_vad_engine = dialogue_vad_engine
        .lock()
        .map_err(|_| "dialogue engine lock poisoned")?;
      // Validate the delivery before committing the new rules. The worker cannot emit a frame
      // between this marker and the reset, and acknowledges the command after both are complete.
      publish_marker()?;
      *channel_selection = selection;
      *dialogue_gating = gating;
      *dialogue_vad_engine = engine;
      pipeline.clear_peak_and_history();
      return Ok(());
    }
    MeterResetKind::TruePeakMax => pipeline.reset_true_peak_max(),
  }
  publish_marker()
}

/// Create a zero-filled output stream on the same device as capture. Windows keeps it for the
/// session so idle WASAPI loopback continues calling back; macOS holds it only until the first
/// system-output tap callback wakes the aggregate clock.
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn create_silence_output_stream(
  device: &cpal::Device,
  config: &StreamConfig,
  stream_error: Arc<AtomicU8>,
) -> Option<cpal::Stream> {
  let stream = device
    .build_output_stream(
      *config,
      move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
        // Write silence (all zeros)
        for sample in data.iter_mut() {
          *sample = 0.0;
        }
      },
      move |error| {
        store_stream_error(&stream_error, &error, cfg!(target_os = "windows"));
        store_output_in_use(&stream_error, &error);
        log::error!("silence stream error: {error}");
      },
      None,
    )
    .ok()?;

  if stream.play().is_ok() {
    log::info!("Silence output stream started for capture");
    Some(stream)
  } else {
    log::warn!("Failed to start silence stream");
    None
  }
}

/// Everything [`run_capture_stream`] needs to open one device stream.
pub(crate) struct CaptureStreamArgs {
  pub(crate) device_id: String,
  pub(crate) device: cpal::Device,
  pub(crate) supported: cpal::SupportedStreamConfig,
  pub(crate) sample_rate: u32,
  pub(crate) channels: u16,
  pub(crate) stop_rx: std::sync::mpsc::Receiver<()>,
  pub(crate) dropped_chunks: Arc<AtomicU64>,
  pub(crate) stream_error: Option<Arc<AtomicU8>>,
  #[cfg(target_os = "linux")]
  pub(crate) measured_pcm: Option<Arc<MeasuredPcmSubscriptions>>,
  #[cfg(target_os = "linux")]
  pub(crate) monitoring_plan: Option<super::source_layout::MonitoringPlan>,
}

/// Device-facing half of live capture, free of Tauri. Opens the stream, feeds
/// pooled PCM into a queue, and hands the queue to `consumer` on its own thread.
/// The GUI passes the meter/IPC bridge; the CLI passes a `SummaryMeter` loop.
/// Blocks until `stop_rx` fires, then tears the stream down and joins `consumer`.
#[cfg(target_os = "linux")]
pub(crate) fn run_capture_stream<C>(args: CaptureStreamArgs, consumer: C) -> Result<(), String>
where
  C: FnOnce(PcmDeliveryQueue, PcmBufferPool, u32, u16) + Send + 'static,
{
  super::linux_capture::run_capture_stream(args, consumer)
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn run_capture_stream<C>(args: CaptureStreamArgs, consumer: C) -> Result<(), String>
where
  C: FnOnce(PcmDeliveryQueue, PcmBufferPool, u32, u16) + Send + 'static,
{
  run_cpal_capture_stream(args, consumer)
}

#[cfg_attr(target_os = "linux", allow(dead_code))]
fn run_cpal_capture_stream<C>(args: CaptureStreamArgs, consumer: C) -> Result<(), String>
where
  C: FnOnce(PcmDeliveryQueue, PcmBufferPool, u32, u16) + Send + 'static,
{
  let CaptureStreamArgs {
    device_id: _device_id,
    device,
    supported,
    sample_rate,
    channels,
    stop_rx,
    dropped_chunks,
    stream_error,
    ..
  } = args;
  let dropped_for_callbacks = dropped_chunks;
  let stream_config = StreamConfig {
    channels,
    sample_rate: supported.sample_rate(),
    // PulseAudio's default fragments can exceed the fixed 100 ms PCM pool buffers.
    // Negotiate 20 ms fragments before capture instead of allocating in the callback.
    #[cfg(target_os = "linux")]
    buffer_size: cpal::BufferSize::Fixed((supported.sample_rate() / 50).max(1)),
    #[cfg(not(target_os = "linux"))]
    buffer_size: cpal::BufferSize::Default,
  };

  let stream_error = stream_error.unwrap_or_else(|| Arc::new(AtomicU8::new(STREAM_ERROR_NONE)));

  // On Windows, create a silence output stream for loopback devices to keep
  // the audio engine active when no other audio is playing.
  #[cfg(target_os = "windows")]
  let wasapi_loopback = is_loopback_capture(&_device_id);
  #[cfg(not(target_os = "windows"))]
  let wasapi_loopback = false;
  #[cfg(target_os = "windows")]
  let _silence_stream = if wasapi_loopback {
    create_silence_output_stream(&device, &stream_config, stream_error.clone())
  } else {
    None
  };

  let pcm_pool = PcmBufferPool::new(
    PCM_QUEUE_CAP + 1,
    pooled_pcm_buffer_capacity(sample_rate, channels),
  );
  let consumer_pool = pcm_pool.clone();
  let consumer_cleanup_pool = pcm_pool.clone();
  let delivery = PcmDeliveryQueue::new(PCM_QUEUE_CAP);
  let consumer_delivery = delivery.clone();
  let consumer_state = delivery.clone();

  let forwarder =
    PcmCallbackForwarder::new(delivery.producer(), pcm_pool.clone(), dropped_for_callbacks);
  let activity = forwarder.activity();
  let on_error = record_stream_error(stream_error.clone(), wasapi_loopback);
  let start_error = |error: &dyn std::fmt::Display| {
    loopback_start_error(error.to_string(), wasapi_loopback, &stream_error)
  };
  let stream = match supported.sample_format() {
    SampleFormat::F32 => device
      .build_input_stream(
        stream_config,
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
          forwarder.forward_f32(data);
        },
        on_error,
        None,
      )
      .map_err(|e| start_error(&e))?,
    SampleFormat::I16 => device
      .build_input_stream(
        stream_config,
        move |data: &[i16], _: &cpal::InputCallbackInfo| {
          forwarder.forward_i16(data);
        },
        on_error,
        None,
      )
      .map_err(|e| start_error(&e))?,
    SampleFormat::U16 => device
      .build_input_stream(
        stream_config,
        move |data: &[u16], _: &cpal::InputCallbackInfo| {
          forwarder.forward_u16(data);
        },
        on_error,
        None,
      )
      .map_err(|e| start_error(&e))?,
    f => {
      return Err(format!("Unsupported sample format: {f:?}"));
    }
  };

  let consumer_thread = std::thread::spawn(move || {
    consumer(consumer_delivery, consumer_pool, sample_rate, channels);
    consumer_state.consumer_finished(&consumer_cleanup_pool);
  });

  if let Err(error) = stream.play() {
    drop(stream);
    delivery.stop_producer();
    let _ = consumer_thread.join();
    return Err(start_error(&error));
  }
  // Loopback without the silence stream legitimately stops calling back while nothing plays, so
  // only then is a quiet stream not evidence of failure.
  #[cfg(target_os = "windows")]
  let watch_stalls = !(wasapi_loopback && _silence_stream.is_none());
  #[cfg(not(target_os = "windows"))]
  let watch_stalls = true;
  let outcome = wait_for_stop_or_stall(
    &stop_rx,
    watch_stalls.then_some(activity.as_ref()),
    &stream_error,
  );
  drop(stream);
  delivery.stop_producer();
  let _ = consumer_thread.join();
  outcome
}

fn run_capture_worker(args: RunCaptureArgs) -> Result<(), CaptureWorkerError> {
  let RunCaptureArgs {
    device_id,
    device,
    supported,
    sample_rate,
    channels,
    frame_subscribers,
    app,
    stop_rx,
    meter_resets,
    channel_selection,
    dialogue_gating,
    dialogue_vad_engine,
    measured_pcm,
    dropped_chunks,
    stream_error,
  } = args;
  let bridge_dropped = dropped_chunks.clone();
  let output = device_id.is_empty()
    || device_id == "default"
    || super::device_id::is_stable_loopback_id(&device_id)
    || super::device_id::parse_legacy_output_index(&device_id).is_some();
  let native_layout = super::source_layout::capture_device_layout(&device, channels, output);
  if output {
    super::source_layout::MonitoringPlan::require_system_scope(channels, native_layout.clone())
      .map_err(CaptureWorkerError::SystemSpeakerLayout)?;
  }
  let bridge_layout = native_layout.clone();
  #[cfg(target_os = "linux")]
  let reader_measured_pcm = measured_pcm.clone();

  run_capture_stream(
    CaptureStreamArgs {
      device_id,
      device,
      supported,
      sample_rate,
      channels,
      stop_rx,
      dropped_chunks,
      stream_error: Some(stream_error),
      #[cfg(target_os = "linux")]
      measured_pcm: Some(reader_measured_pcm),
      #[cfg(target_os = "linux")]
      monitoring_plan: Some(super::source_layout::MonitoringPlan::new(
        channels,
        native_layout,
      )),
    },
    move |audio_rx, pool, sample_rate, channels| {
      run_meter_pipeline_bridge_thread(
        audio_rx,
        sample_rate,
        channels,
        frame_subscribers,
        app,
        meter_resets,
        channel_selection,
        dialogue_gating,
        dialogue_vad_engine,
        measured_pcm,
        !cfg!(target_os = "linux"),
        bridge_dropped,
        pool,
        bridge_layout,
      );
    },
  )
  .map_err(CaptureWorkerError::from)
}

#[cfg(test)]
mod backpressure_tests {
  use super::{
    frame_inflight_exceeds, PcmBufferPool, PcmCallbackForwarder, PcmDeliveryQueue,
    MAX_FRAMES_INFLIGHT,
  };
  use crate::state::UiFrameDiagnosticsCounters;
  use std::sync::atomic::{AtomicU64, Ordering};
  use std::sync::Arc;

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
  fn stalled_webview_drop_policy_is_visible_in_diagnostics() {
    let counters = UiFrameDiagnosticsCounters::default();
    let acked_seq = 0;
    let mut sent_seq = 0;

    // Simulate 125 frame opportunities while the WebView never acknowledges one. The existing
    // policy admits 120 and drops the remaining five; the diagnostic must reveal those otherwise
    // invisible drops even though the admitted sequence remains perfectly contiguous.
    for _ in 0..125 {
      if frame_inflight_exceeds(sent_seq, acked_seq, MAX_FRAMES_INFLIGHT) {
        counters.record_dropped();
      } else {
        sent_seq += 1;
        counters.record_sent(sent_seq, acked_seq);
      }
    }

    let snapshot = counters.snapshot(acked_seq, MAX_FRAMES_INFLIGHT);
    assert_eq!(snapshot.sent_frames, 120);
    assert_eq!(snapshot.dropped_frames, 5);
    assert_eq!(snapshot.current_inflight_frames, 120);
    assert_eq!(snapshot.max_inflight_frames, 120);
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

  #[test]
  fn callback_forwarder_only_exposes_bounded_pcm_delivery() {
    fn assert_send<T: Send>() {}
    assert_send::<PcmCallbackForwarder>();

    let pool = PcmBufferPool::new(2, 4);
    let delivery = PcmDeliveryQueue::new(1);
    let dropped = Arc::new(AtomicU64::new(0));
    let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool.clone(), dropped.clone());

    assert!(forwarder.forward_f32(&[0.25, -0.5]));
    assert!(!forwarder.forward_f32(&[0.75, -1.0]));
    assert_eq!(dropped.load(Ordering::Relaxed), 1);
    assert_eq!(delivery.pop().expect("queued PCM"), vec![0.25, -0.5]);
    assert!(
      pool.checkout().is_some(),
      "the dropped chunk must return to the preallocated pool"
    );
  }

  #[test]
  fn callback_forwarder_preserves_existing_integer_conversion_and_drop_policy() {
    let pool = PcmBufferPool::new(2, 4);
    let delivery = PcmDeliveryQueue::new(2);
    let dropped = Arc::new(AtomicU64::new(0));
    let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool, dropped.clone());

    assert!(forwarder.forward_i16(&[16_384, -32_768]));
    assert!(forwarder.forward_u16(&[49_152, 0]));
    assert_eq!(delivery.pop().unwrap(), vec![0.5, -1.0]);
    assert_eq!(delivery.pop().unwrap(), vec![0.5, -1.0]);
    assert_eq!(dropped.load(Ordering::Relaxed), 0);
  }

  #[test]
  fn warmed_f32_i16_and_u16_callback_forwarding_performs_zero_heap_allocations() {
    let pool = PcmBufferPool::new(2, 4);
    let delivery = PcmDeliveryQueue::new(1);
    let dropped = Arc::new(AtomicU64::new(0));
    let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool, dropped);
    assert!(forwarder.forward_f32(&[0.0, 0.0]));
    let warmup = delivery.pop().unwrap();
    forwarder.recycle_for_test(warmup);

    let f32_allocations =
      crate::dsp::shared_spectral_engine::allocation_counter::count_current_thread_allocations(
        || assert!(forwarder.forward_f32(&[0.25, -0.5])),
      );
    let f32_buffer = delivery.pop().unwrap();
    assert_eq!(f32_buffer, vec![0.25, -0.5]);
    forwarder.recycle_for_test(f32_buffer);

    let i16_allocations =
      crate::dsp::shared_spectral_engine::allocation_counter::count_current_thread_allocations(
        || assert!(forwarder.forward_i16(&[16_384, -32_768])),
      );
    let i16_buffer = delivery.pop().unwrap();
    assert_eq!(i16_buffer, vec![0.5, -1.0]);
    forwarder.recycle_for_test(i16_buffer);

    let u16_allocations =
      crate::dsp::shared_spectral_engine::allocation_counter::count_current_thread_allocations(
        || assert!(forwarder.forward_u16(&[49_152, 0])),
      );
    assert_eq!(delivery.pop().unwrap(), vec![0.5, -1.0]);

    assert_eq!(f32_allocations, 0, "warmed f32 forwarding allocated");
    assert_eq!(i16_allocations, 0, "warmed i16 forwarding allocated");
    assert_eq!(u16_allocations, 0, "warmed u16 forwarding allocated");
  }

  #[test]
  fn worker_polling_pops_fifo_and_recycles_every_buffer() {
    let pool = PcmBufferPool::new(4, 4);
    let delivery = PcmDeliveryQueue::new(3);
    let dropped = Arc::new(AtomicU64::new(0));
    let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool.clone(), dropped.clone());

    assert!(forwarder.forward_f32(&[1.0]));
    assert!(forwarder.forward_f32(&[2.0]));
    assert!(forwarder.forward_f32(&[3.0]));
    delivery.stop_producer();

    let worker_delivery = delivery.clone();
    let worker_pool = pool.clone();
    let observed = std::thread::spawn(move || {
      let mut values = Vec::new();
      while let Some(buffer) = worker_delivery.pop_until_stopped() {
        values.push(buffer[0]);
        worker_pool.recycle(buffer);
      }
      values
    })
    .join()
    .expect("delivery worker");

    assert_eq!(observed, vec![1.0, 2.0, 3.0]);
    assert_eq!(dropped.load(Ordering::Relaxed), 0);
    let returned: Vec<_> = (0..4)
      .map(|_| pool.checkout().expect("worker recycled every buffer"))
      .collect();
    assert!(pool.checkout().is_none());
    for buffer in returned {
      pool.recycle(buffer);
    }
  }

  #[test]
  fn stop_with_nonempty_queue_drains_before_worker_exit() {
    let pool = PcmBufferPool::new(3, 4);
    let delivery = PcmDeliveryQueue::new(2);
    let dropped = Arc::new(AtomicU64::new(0));
    let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool.clone(), dropped);
    assert!(forwarder.forward_f32(&[10.0]));
    assert!(forwarder.forward_f32(&[20.0]));

    delivery.stop_producer();
    let first = delivery.pop_until_stopped().expect("first queued buffer");
    let second = delivery.pop_until_stopped().expect("second queued buffer");
    assert_eq!((first[0], second[0]), (10.0, 20.0));
    pool.recycle(first);
    pool.recycle(second);
    assert!(
      delivery.pop_until_stopped().is_none(),
      "stopped worker must exit only after draining"
    );
  }

  #[test]
  fn disconnected_worker_drains_queue_and_rejects_later_callbacks() {
    let pool = PcmBufferPool::new(3, 4);
    let delivery = PcmDeliveryQueue::new(2);
    let dropped = Arc::new(AtomicU64::new(0));
    let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool.clone(), dropped.clone());
    assert!(forwarder.forward_f32(&[10.0]));
    assert!(forwarder.forward_f32(&[20.0]));

    delivery.consumer_finished(&pool);
    assert!(!forwarder.forward_f32(&[30.0]));
    assert_eq!(dropped.load(Ordering::Relaxed), 1);
    assert!(delivery.pop().is_none());

    let returned: Vec<_> = (0..3)
      .map(|_| {
        pool
          .checkout()
          .expect("disconnected worker returned buffer")
      })
      .collect();
    assert!(pool.checkout().is_none());
    for buffer in returned {
      pool.recycle(buffer);
    }
  }

  #[test]
  fn concurrent_delivery_has_no_uncounted_loss_and_returns_unique_buffers() {
    const QUEUE_CAPACITY: usize = 8;
    const BUFFER_COUNT: usize = QUEUE_CAPACITY + 1;
    const CHUNKS: usize = 20_000;

    let pool = PcmBufferPool::new(BUFFER_COUNT, 4);
    let delivery = PcmDeliveryQueue::new(QUEUE_CAPACITY);
    let dropped = Arc::new(AtomicU64::new(0));
    let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool.clone(), dropped.clone());
    let worker_delivery = delivery.clone();
    let worker_pool = pool.clone();
    let worker = std::thread::spawn(move || {
      let mut observed = Vec::new();
      while let Some(buffer) = worker_delivery.pop_until_stopped() {
        observed.push(buffer[0] as usize);
        worker_pool.recycle(buffer);
      }
      observed
    });

    let mut accepted = Vec::new();
    for sequence in 0..CHUNKS {
      if forwarder.forward_f32(&[sequence as f32]) {
        accepted.push(sequence);
      }
    }
    delivery.stop_producer();
    let observed = worker.join().expect("delivery stress worker");

    assert_eq!(observed, accepted, "FIFO delivery lost or reordered PCM");
    assert_eq!(
      observed.len() as u64 + dropped.load(Ordering::Relaxed),
      CHUNKS as u64,
      "every rejected chunk must be counted"
    );

    let mut returned = Vec::with_capacity(BUFFER_COUNT);
    let mut pointers = Vec::with_capacity(BUFFER_COUNT);
    for _ in 0..BUFFER_COUNT {
      let buffer = pool.checkout().expect("all buffers returned after drain");
      pointers.push(buffer.as_ptr() as usize);
      returned.push(buffer);
    }
    pointers.sort_unstable();
    pointers.dedup();
    assert_eq!(pointers.len(), BUFFER_COUNT);
    assert!(pool.checkout().is_none(), "buffer ownership exceeded bound");
    for buffer in returned {
      pool.recycle(buffer);
    }
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
    enqueue_pcm_buffer_or_count_drop, PcmBufferPool, PcmDeliveryQueue,
  };
  use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
  use std::sync::Arc;

  #[test]
  fn callback_reachable_pcm_pool_source_contains_no_locks() {
    let source = include_str!("cpal_backend.rs");
    let callback_pool_source = source
      .split("pub(crate) struct PcmBufferPool")
      .nth(1)
      .expect("pool source")
      .split("pub(crate) fn run_meter_pipeline_bridge_thread")
      .next()
      .expect("callback pool boundary");

    for forbidden in [
      "SyncSender",
      "mpsc",
      "Mutex",
      "RwLock",
      "try_lock",
      "lock()",
      "unpark",
      "Condvar",
    ] {
      assert!(
        !callback_pool_source.contains(forbidden),
        "callback-reachable PCM pool still contains {forbidden}"
      );
    }

    let forwarder_source = source
      .split("pub(crate) struct PcmCallbackForwarder")
      .nth(1)
      .expect("callback forwarder source")
      .split("pub(crate) fn run_meter_pipeline_bridge_thread")
      .next()
      .expect("callback forwarder boundary");
    for forbidden in [
      "PcmDeliveryQueue",
      "MeasuredPcm",
      "SyncSender",
      "mpsc",
      "Mutex",
      "RwLock",
      "sleep",
      "yield_now",
      "unpark",
      "Condvar",
    ] {
      assert!(
        !forwarder_source.contains(forbidden),
        "callback forwarder still has {forbidden} capability"
      );
    }

    let worker_source = source
      .split("pub(crate) fn run_meter_pipeline_bridge_thread")
      .nth(1)
      .expect("meter worker source")
      .split("fn create_silence_output_stream")
      .next()
      .expect("meter worker boundary");
    let publish = worker_source
      .find("measured_pcm.publish")
      .expect("measured PCM is published on the worker");
    let dsp = worker_source
      .find("pipeline.push_pcm_f32_with_requests")
      .expect("DSP runs on the worker");
    assert!(
      publish < dsp,
      "measured PCM must be copied before DSP mutation"
    );
  }

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
  fn concurrent_checkout_and_recycle_keeps_buffers_unique_and_bounded() {
    const BUFFER_COUNT: usize = 8;
    const THREADS: usize = 8;
    const ITERATIONS: usize = 5_000;

    let pool = PcmBufferPool::new(BUFFER_COUNT, 16);
    let mut initial = Vec::with_capacity(BUFFER_COUNT);
    let mut pointers = Vec::with_capacity(BUFFER_COUNT);
    for _ in 0..BUFFER_COUNT {
      let buffer = pool.checkout().expect("initial buffer");
      pointers.push(buffer.as_ptr() as usize);
      initial.push(buffer);
    }
    pointers.sort_unstable();
    pointers.dedup();
    assert_eq!(pointers.len(), BUFFER_COUNT, "pool buffers must be unique");
    for buffer in initial {
      pool.recycle(buffer);
    }

    let pointers = Arc::new(pointers);
    let in_use = Arc::new(
      (0..BUFFER_COUNT)
        .map(|_| AtomicBool::new(false))
        .collect::<Vec<_>>(),
    );
    let workers: Vec<_> = (0..THREADS)
      .map(|thread_index| {
        let pool = pool.clone();
        let pointers = pointers.clone();
        let in_use = in_use.clone();
        std::thread::spawn(move || {
          for iteration in 0..ITERATIONS {
            let mut buffer = loop {
              if let Some(buffer) = pool.checkout() {
                break buffer;
              }
              std::thread::yield_now();
            };
            let index = pointers
              .binary_search(&(buffer.as_ptr() as usize))
              .expect("checked-out buffer belongs to pool");
            assert!(
              in_use[index]
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok(),
              "buffer checked out concurrently more than once"
            );
            buffer.push((thread_index * ITERATIONS + iteration) as f32);
            assert!(in_use[index].swap(false, Ordering::AcqRel));
            pool.recycle(buffer);
          }
        })
      })
      .collect();

    for worker in workers {
      worker.join().expect("pool stress worker");
    }
    assert!(in_use.iter().all(|flag| !flag.load(Ordering::Acquire)));

    let mut returned = Vec::with_capacity(BUFFER_COUNT);
    let mut returned_pointers = Vec::with_capacity(BUFFER_COUNT);
    for _ in 0..BUFFER_COUNT {
      let buffer = pool.checkout().expect("all buffers returned");
      assert!(buffer.is_empty());
      returned_pointers.push(buffer.as_ptr() as usize);
      returned.push(buffer);
    }
    returned_pointers.sort_unstable();
    assert_eq!(returned_pointers, *pointers);
    assert!(pool.checkout().is_none(), "pool exceeded fixed capacity");
    for buffer in returned {
      pool.recycle(buffer);
    }
  }

  #[test]
  fn checkout_returns_none_instead_of_blocking_when_pool_is_busy() {
    let pool = PcmBufferPool::new(1, 4);
    let _checked_out = pool.checkout().expect("buffer");
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
  fn empty_pool_counts_drop_without_allocating_or_blocking() {
    let pool = PcmBufferPool::new(1, 4);
    let _checked_out = pool.checkout().expect("buffer");
    let dropped = AtomicU64::new(0);

    let allocations =
      crate::dsp::shared_spectral_engine::allocation_counter::count_current_thread_allocations(
        || {
          assert!(copy_f32_pcm_to_pooled_buffer(&pool, &[0.25, -0.5], &dropped).is_none());
        },
      );

    assert_eq!(allocations, 0);
    assert_eq!(dropped.load(Ordering::Relaxed), 1);
  }

  #[test]
  fn recycling_into_full_pool_discards_extra_buffer_without_growth() {
    let pool = PcmBufferPool::new(1, 4);
    let extra = Vec::with_capacity(4);

    let allocations =
      crate::dsp::shared_spectral_engine::allocation_counter::count_current_thread_allocations(
        || pool.recycle(extra),
      );

    assert_eq!(allocations, 0);
    let only = pool.checkout().expect("original pooled buffer");
    assert!(pool.checkout().is_none(), "full recycle grew the pool");
    pool.recycle(only);
  }

  #[test]
  fn delivered_buffer_keeps_the_time_it_arrived_not_the_time_it_was_taken() {
    let delivery = PcmDeliveryQueue::new(1);
    let before = std::time::Instant::now();
    assert!(delivery.producer().push(vec![0.5]).is_ok());
    let after = std::time::Instant::now();
    std::thread::sleep(std::time::Duration::from_millis(30));
    delivery.stop_producer();

    let (buffer, arrived_at) = delivery
      .pop_until_stopped_with_arrival()
      .expect("delivered buffer");
    assert_eq!(buffer, vec![0.5]);
    assert!(before <= arrived_at && arrived_at <= after);
  }

  #[test]
  fn full_queue_recycles_buffer_and_counts_drop() {
    let pool = PcmBufferPool::new(2, 4);
    let delivery = PcmDeliveryQueue::new(1);
    let producer = delivery.producer();
    let dropped = AtomicU64::new(0);

    let mut queued = pool.checkout().expect("queued buffer");
    queued.extend_from_slice(&[0.0]);
    assert!(producer.push(queued).is_ok());
    let mut rejected = pool.checkout().expect("callback-local buffer");
    rejected.extend_from_slice(&[0.25, -0.5]);
    let capacity = rejected.capacity();

    assert!(!enqueue_pcm_buffer_or_count_drop(
      &producer, &pool, rejected, &dropped
    ));

    assert_eq!(dropped.load(Ordering::Relaxed), 1);
    let recycled = pool.checkout().expect("recycled buffer");
    assert!(recycled.is_empty());
    assert_eq!(recycled.capacity(), capacity);
    pool.recycle(recycled);
    pool.recycle(delivery.pop().expect("queued buffer"));
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
