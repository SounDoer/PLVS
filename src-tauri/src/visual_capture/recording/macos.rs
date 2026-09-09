use std::ffi::{c_char, c_void, CStr};
use std::os::unix::ffi::OsStrExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use crate::visual_capture::artifacts::{ArtifactStore, PendingArtifact};
use crate::visual_capture::platform::{CssRect, CssViewport};

use super::audio::SilenceReason;
use super::session::RecordingSessionControl;
use super::state::{RecordingCursorMode, RecordingRegistry, StopReason};

const START_TIMEOUT: Duration = Duration::from_secs(15);

const EVENT_STARTED: i32 = 0;
const EVENT_FRAME: i32 = 1;
const EVENT_DROPPED: i32 = 2;
const EVENT_DURATION_LIMIT: i32 = 3;
const EVENT_SIZE_LIMIT: i32 = 4;
const EVENT_COMPLETED: i32 = 5;
const EVENT_FAILED: i32 = 6;

unsafe extern "C" {
  fn plvs_macos_recording_start(
    webview: *mut c_void,
    path: *const u8,
    path_length: usize,
    width: u32,
    height: u32,
    fps: u32,
    max_duration: u32,
    x: f64,
    y: f64,
    rect_width: f64,
    rect_height: f64,
    viewport_width: f64,
    viewport_height: f64,
    show_cursor: bool,
    context: *mut c_void,
    callback: unsafe extern "C" fn(*mut c_void, i32, u64, *const c_char),
  ) -> *mut c_void;
  fn plvs_macos_recording_stop(session: *mut c_void);
  fn plvs_macos_recording_update_geometry(
    session: *mut c_void,
    x: f64,
    y: f64,
    rect_width: f64,
    rect_height: f64,
    viewport_width: f64,
    viewport_height: f64,
  );
  fn plvs_macos_recording_release(session: *mut c_void);
}

struct RecordingContext {
  recording_id: String,
  width: u32,
  height: u32,
  registry: RecordingRegistry,
  store: ArtifactStore,
  pending: Mutex<Option<PendingArtifact>>,
  startup: Mutex<Option<SyncSender<Result<(), String>>>>,
  finished: AtomicBool,
  native_context_released: AtomicBool,
}

pub struct MacRecordingSession {
  recording_id: String,
  native: usize,
  context: Arc<RecordingContext>,
}

impl Drop for MacRecordingSession {
  fn drop(&mut self) {
    unsafe { plvs_macos_recording_release(self.native as *mut c_void) };
  }
}

impl RecordingSessionControl for MacRecordingSession {
  fn recording_id(&self) -> &str {
    &self.recording_id
  }

  fn request_stop(&self, _reason: StopReason) {
    unsafe { plvs_macos_recording_stop(self.native as *mut c_void) };
  }

  fn update_geometry(&self, rect: CssRect, viewport: CssViewport) -> Result<(), &'static str> {
    if [
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      viewport.width,
      viewport.height,
    ]
    .iter()
    .any(|value| !value.is_finite())
      || rect.width <= 0.0
      || rect.height <= 0.0
      || viewport.width <= 0.0
      || viewport.height <= 0.0
    {
      return Err("invalidGeometry");
    }
    unsafe {
      plvs_macos_recording_update_geometry(
        self.native as *mut c_void,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        viewport.width,
        viewport.height,
      );
    }
    Ok(())
  }

  fn update_audio_silence_reason(&self, _reason: SilenceReason) -> Result<(), &'static str> {
    Ok(())
  }

  fn is_finished(&self) -> bool {
    self.context.finished.load(Ordering::Acquire)
  }
}

unsafe extern "C" fn recording_event(
  raw_context: *mut c_void,
  event: i32,
  value: u64,
  message: *const c_char,
) {
  if raw_context.is_null() {
    return;
  }
  unsafe { Arc::increment_strong_count(raw_context.cast::<RecordingContext>()) };
  let context = unsafe { Arc::from_raw(raw_context.cast::<RecordingContext>()) };
  let message = if message.is_null() {
    String::new()
  } else {
    unsafe { CStr::from_ptr(message) }
      .to_string_lossy()
      .into_owned()
  };
  match event {
    EVENT_STARTED => {
      context.registry.mark_recording(&context.recording_id);
      send_startup(&context, Ok(()));
    }
    EVENT_FRAME => context.registry.add_frame(&context.recording_id, value, 0),
    EVENT_DROPPED => context
      .registry
      .add_dropped_frames(&context.recording_id, value.max(1)),
    EVENT_DURATION_LIMIT => {
      context
        .registry
        .request_stop(&context.recording_id, StopReason::DurationLimit);
    }
    EVENT_SIZE_LIMIT => {
      context
        .registry
        .request_stop(&context.recording_id, StopReason::SizeLimit);
    }
    EVENT_COMPLETED => finish_recording(&context),
    EVENT_FAILED => {
      let message = if message.is_empty() {
        "The macOS recording session failed.".to_owned()
      } else {
        message
      };
      send_startup(&context, Err(message.clone()));
      context.registry.fail(&context.recording_id, message);
      context.finished.store(true, Ordering::Release);
    }
    _ => {}
  }
  if matches!(event, EVENT_COMPLETED | EVENT_FAILED)
    && context
      .native_context_released
      .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
      .is_ok()
  {
    drop(unsafe { Arc::from_raw(raw_context.cast::<RecordingContext>()) });
  }
}

fn send_startup(context: &RecordingContext, result: Result<(), String>) {
  if let Ok(mut startup) = context.startup.lock() {
    if let Some(sender) = startup.take() {
      let _ = sender.send(result);
    }
  }
}

fn finish_recording(context: &RecordingContext) {
  let pending = context
    .pending
    .lock()
    .ok()
    .and_then(|mut pending| pending.take());
  let Some(pending) = pending else {
    context.registry.fail(
      &context.recording_id,
      "The recording staging artifact was lost.",
    );
    context.finished.store(true, Ordering::Release);
    return;
  };
  match context
    .store
    .publish_blocking(pending, context.width, context.height, SystemTime::now())
  {
    Ok(artifact) => context.registry.complete(&context.recording_id, artifact),
    Err(error) => context.registry.fail(
      &context.recording_id,
      format!("The recording artifact could not be published: {error}"),
    ),
  }
  context.finished.store(true, Ordering::Release);
}

#[allow(clippy::too_many_arguments)]
pub fn begin_recording(
  webview: usize,
  recording_id: String,
  width: u32,
  height: u32,
  fps: u32,
  max_duration: u32,
  rect: CssRect,
  viewport: CssViewport,
  cursor: RecordingCursorMode,
  pending: PendingArtifact,
  store: ArtifactStore,
  registry: RecordingRegistry,
) -> Result<(MacRecordingSession, Receiver<Result<(), String>>), String> {
  let path = pending.path().as_os_str().as_bytes().to_vec();
  let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
  let context = Arc::new(RecordingContext {
    recording_id: recording_id.clone(),
    width,
    height,
    registry,
    store,
    pending: Mutex::new(Some(pending)),
    startup: Mutex::new(Some(startup_sender)),
    finished: AtomicBool::new(false),
    native_context_released: AtomicBool::new(false),
  });
  let callback_context = Arc::into_raw(Arc::clone(&context));
  let native = unsafe {
    plvs_macos_recording_start(
      webview as *mut c_void,
      path.as_ptr(),
      path.len(),
      width,
      height,
      fps,
      max_duration,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      viewport.width,
      viewport.height,
      cursor == RecordingCursorMode::Visible,
      callback_context.cast_mut().cast::<c_void>(),
      recording_event,
    )
  };
  if native.is_null() {
    drop(unsafe { Arc::from_raw(callback_context) });
    return Err("The native macOS recording session could not be created.".to_owned());
  }
  let session = MacRecordingSession {
    recording_id,
    native: native as usize,
    context,
  };
  Ok((session, startup_receiver))
}

pub fn wait_until_started(
  session: &MacRecordingSession,
  startup_receiver: Receiver<Result<(), String>>,
) -> Result<(), String> {
  match startup_receiver.recv_timeout(START_TIMEOUT) {
    Ok(Ok(())) => Ok(()),
    Ok(Err(message)) => Err(message),
    Err(_) => {
      session.request_stop(StopReason::CaptureFailure);
      Err("The macOS recording session timed out while starting.".to_owned())
    }
  }
}
