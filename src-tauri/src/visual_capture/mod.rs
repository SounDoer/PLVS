pub mod artifacts;
pub mod platform;
pub mod recording;
#[cfg(target_os = "windows")]
pub mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;

use serde::Serialize;
#[cfg(target_os = "windows")]
use tauri::Manager;
use tauri::{AppHandle, State};

use artifacts::{ArtifactKind, ArtifactMetadata, ArtifactStore};
#[cfg(not(target_os = "windows"))]
use platform::UnsupportedPlatform;
use platform::{CaptureError, PlatformCapabilities, ScreenshotRequest, VisualCapturePlatform};
use recording::state::{RecordingAudioSource, RecordingSnapshot, StopReason};
use recording::{
  RecordingAudioStateRequest, RecordingController, RecordingGeometryRequest, RecordingIdRequest,
  RecordingSourceMode, RecordingStartRequest,
};
#[cfg(target_os = "windows")]
use windows::WindowsPlatform;

#[cfg(target_os = "windows")]
const RECORDING_PCM_QUEUE_CAPACITY: usize = 256;

#[derive(Default)]
pub struct ScreenshotCaptureState {
  active: Arc<AtomicBool>,
}

#[derive(Debug)]
struct CapturePermit(Arc<AtomicBool>);

impl Drop for CapturePermit {
  fn drop(&mut self) {
    self.0.store(false, Ordering::Release);
  }
}

impl ScreenshotCaptureState {
  fn acquire(&self) -> Result<CapturePermit, NativeCaptureError> {
    self
      .active
      .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
      .map(|_| CapturePermit(Arc::clone(&self.active)))
      .map_err(|_| NativeCaptureError::new("captureBusy", "A screenshot is already in progress."))
  }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureError {
  reason: &'static str,
  message: String,
}

impl NativeCaptureError {
  fn new(reason: &'static str, message: impl Into<String>) -> Self {
    Self {
      reason,
      message: message.into(),
    }
  }

  fn artifact(message: impl Into<String>) -> Self {
    Self::new("artifactWriteFailed", message)
  }

  fn recording(reason: &'static str, message: impl Into<String>) -> Self {
    Self::new(reason, message)
  }
}

impl From<CaptureError> for NativeCaptureError {
  fn from(value: CaptureError) -> Self {
    Self::new(value.reason, value.message)
  }
}

fn platform_capabilities() -> PlatformCapabilities {
  #[cfg(target_os = "windows")]
  {
    WindowsPlatform.capabilities()
  }
  #[cfg(not(target_os = "windows"))]
  {
    UnsupportedPlatform.capabilities()
  }
}

#[tauri::command]
pub fn visual_capture_capabilities() -> PlatformCapabilities {
  platform_capabilities()
}

#[tauri::command]
pub async fn visual_capture_screenshot(
  app: AppHandle,
  artifact_store: State<'_, ArtifactStore>,
  capture_state: State<'_, ScreenshotCaptureState>,
  request: ScreenshotRequest,
) -> Result<ArtifactMetadata, NativeCaptureError> {
  let _permit = capture_state.acquire()?;
  if !matches!(
    request.window_label.as_str(),
    "main" | "dock-header" | "dock-editor"
  ) {
    return Err(NativeCaptureError::new(
      "targetUnavailable",
      "The requested window is not a PLVS capture surface.",
    ));
  }
  if !request.device_pixel_ratio.is_finite() || request.device_pixel_ratio <= 0.0 {
    return Err(NativeCaptureError::new(
      "captureFailed",
      "The frontend device pixel ratio is invalid.",
    ));
  }

  let store = artifact_store.inner().clone();
  let pending = store.begin(ArtifactKind::Screenshot).map_err(|_| {
    NativeCaptureError::artifact("The screenshot staging file could not be created.")
  })?;

  #[cfg(target_os = "windows")]
  if let Err(error) = WindowsPlatform
    .capture_preview(&app, &request.window_label, pending.path())
    .await
  {
    log::warn!("visual screenshot failed: {error}");
    return Err(error.into());
  }
  #[cfg(not(target_os = "windows"))]
  UnsupportedPlatform
    .capture_preview(&app, &request.window_label, pending.path())
    .await?;

  #[cfg(target_os = "windows")]
  let (width, height) = {
    let path = pending.path().to_owned();
    let viewport = request.viewport;
    let rect = request.rect;
    let result = tauri::async_runtime::spawn_blocking(move || {
      windows::crop_preview_png(&path, viewport, rect)
    })
    .await
    .map_err(|_| NativeCaptureError::new("captureFailed", "The PNG crop worker failed."))?;
    if let Err(error) = &result {
      log::warn!("visual screenshot crop failed: {error}");
    }
    result?
  };
  #[cfg(not(target_os = "windows"))]
  let (width, height) = unreachable!();

  store
    .publish(pending, width, height, SystemTime::now())
    .await
    .map_err(|_| NativeCaptureError::artifact("The screenshot artifact could not be published."))
}

fn output_canvas(request: &RecordingStartRequest) -> Result<(u32, u32), NativeCaptureError> {
  let values = [
    request.rect.width,
    request.rect.height,
    request.device_pixel_ratio,
  ];
  if values
    .iter()
    .any(|value| !value.is_finite() || *value <= 0.0)
  {
    return Err(NativeCaptureError::recording(
      "recordingFailed",
      "The recording output geometry is invalid.",
    ));
  }
  let even = |value: f64| -> Result<u32, NativeCaptureError> {
    let rounded = value.round();
    if rounded < 2.0 || rounded > f64::from(u32::MAX) {
      return Err(NativeCaptureError::recording(
        "recordingFailed",
        "The recording output geometry is out of range.",
      ));
    }
    Ok((rounded as u32) & !1)
  };
  Ok((
    even(request.rect.width * request.device_pixel_ratio)?,
    even(request.rect.height * request.device_pixel_ratio)?,
  ))
}

#[tauri::command]
pub async fn visual_recording_start(
  app: AppHandle,
  artifact_store: State<'_, ArtifactStore>,
  controller: State<'_, RecordingController>,
  engine_state: State<'_, crate::state::AppState>,
  request: RecordingStartRequest,
) -> Result<RecordingSnapshot, NativeCaptureError> {
  if request.window_label != "main" {
    return Err(NativeCaptureError::recording(
      "targetUnavailable",
      "Recordings can only capture the PLVS main window.",
    ));
  }
  let audio_source = request.resolved_audio_source();
  if audio_source == RecordingAudioSource::MeasuredSource
    && request.source_mode == RecordingSourceMode::File
  {
    return Err(NativeCaptureError::recording(
      "audioUnavailable",
      "Measured-source audio is unavailable while File is selected.",
    ));
  }
  let (width, height) = output_canvas(&request)?;
  let created = controller
    .registry()
    .create(
      width,
      height,
      request.fps,
      request.max_duration_seconds,
      audio_source,
    )
    .map_err(|reason| {
      NativeCaptureError::recording(reason, "The recording request is invalid or busy.")
    })?;
  let pending = match artifact_store.begin(ArtifactKind::Recording) {
    Ok(pending) => pending,
    Err(error) => {
      controller
        .registry()
        .fail(&created.recording_id, error.to_string());
      return Err(NativeCaptureError::artifact(
        "The recording staging file could not be created.",
      ));
    }
  };

  #[cfg(target_os = "windows")]
  {
    let Some(window) = app.get_webview_window("main") else {
      controller.registry().fail(
        &created.recording_id,
        "The PLVS main window does not exist.",
      );
      return Err(NativeCaptureError::recording(
        "targetUnavailable",
        "The PLVS main window does not exist.",
      ));
    };
    let hwnd = match window.hwnd() {
      Ok(hwnd) => hwnd.0 as usize,
      Err(error) => {
        controller
          .registry()
          .fail(&created.recording_id, error.to_string());
        return Err(NativeCaptureError::recording(
          "recordingFailed",
          "The PLVS main window handle is unavailable.",
        ));
      }
    };
    let recording_id = created.recording_id.clone();
    let store = artifact_store.inner().clone();
    let registry = controller.registry().clone();
    let rect = request.rect;
    let viewport = request.viewport;
    let fps = request.fps;
    let max_duration_seconds = request.max_duration_seconds;
    let measured_pcm = engine_state.inner().measured_pcm.clone();
    let audio_origin_ns = measured_pcm.timestamp_ns();
    let audio_receiver = if audio_source == RecordingAudioSource::MeasuredSource {
      // Windows devices may deliver one-millisecond buffers while the encoder drains on the video
      // cadence. Keep the queue bounded but large enough for the 100 ms A/V settlement window and
      // ordinary scheduler jitter, so a healthy source does not manufacture backpressure gaps.
      match measured_pcm.subscribe(RECORDING_PCM_QUEUE_CAPACITY) {
        Ok(receiver) => Some(receiver),
        Err(reason) => {
          controller.registry().fail(
            &created.recording_id,
            "Measured-source audio could not be attached.",
          );
          return Err(NativeCaptureError::recording(
            reason,
            "Measured-source audio could not be attached.",
          ));
        }
      }
    } else {
      None
    };
    let session_result = tauri::async_runtime::spawn_blocking(move || {
      recording::windows::start_recording(
        hwnd as *mut std::ffi::c_void,
        recording_id,
        width,
        height,
        fps,
        max_duration_seconds,
        recording::windows::RecordingGeometry { rect, viewport },
        pending,
        store,
        registry,
        audio_source,
        audio_origin_ns,
        audio_receiver,
        request.audio_state.silence_reason(),
      )
    })
    .await;
    let session = match session_result {
      Ok(Ok(session)) => session,
      Ok(Err(message)) => {
        log::warn!("visual recording start failed: {message}");
        controller
          .registry()
          .fail(&created.recording_id, message.clone());
        return Err(NativeCaptureError::recording("recordingFailed", message));
      }
      Err(error) => {
        controller
          .registry()
          .fail(&created.recording_id, error.to_string());
        return Err(NativeCaptureError::recording(
          "recordingFailed",
          "The recording startup worker failed.",
        ));
      }
    };
    if let Err(reason) = controller.insert_session(session.clone()) {
      session.request_stop(StopReason::CaptureFailure);
      controller.registry().fail(
        &created.recording_id,
        "The recording session could not be retained.",
      );
      return Err(NativeCaptureError::recording(
        reason,
        "The recording session could not be retained.",
      ));
    }
    Ok(controller.inspect(&created.recording_id).unwrap_or(created))
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = (app, pending);
    controller
      .registry()
      .fail(&created.recording_id, "Visual recording is unavailable.");
    Err(NativeCaptureError::recording(
      "visualUnavailable",
      "Visual recording is unavailable on this platform.",
    ))
  }
}

#[tauri::command]
pub fn visual_recording_update_audio_state(
  controller: State<'_, RecordingController>,
  request: RecordingAudioStateRequest,
) -> Result<(), NativeCaptureError> {
  controller.update_audio_state(request).map_err(|reason| {
    NativeCaptureError::recording(reason, "The recording audio state could not be updated.")
  })
}

#[tauri::command]
pub fn visual_recording_inspect(
  controller: State<'_, RecordingController>,
  request: RecordingIdRequest,
) -> Result<RecordingSnapshot, NativeCaptureError> {
  controller.inspect(&request.recording_id).ok_or_else(|| {
    NativeCaptureError::recording("recordingNotFound", "The recording ID is unknown.")
  })
}

#[tauri::command]
pub fn visual_recording_update_geometry(
  controller: State<'_, RecordingController>,
  request: RecordingGeometryRequest,
) -> Result<(), NativeCaptureError> {
  controller.update_geometry(request).map_err(|reason| {
    NativeCaptureError::recording(reason, "The recording geometry update was rejected.")
  })
}

#[tauri::command]
pub async fn visual_recording_stop(
  controller: State<'_, RecordingController>,
  request: RecordingIdRequest,
) -> Result<RecordingSnapshot, NativeCaptureError> {
  let snapshot = controller
    .request_stop(&request.recording_id, StopReason::Explicit)
    .ok_or_else(|| {
      NativeCaptureError::recording("recordingNotFound", "The recording ID is unknown.")
    })?;
  Ok(snapshot)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn capture_permit_enforces_one_active_screenshot_and_releases_on_drop() {
    let state = ScreenshotCaptureState::default();
    let permit = state.acquire().unwrap();
    assert_eq!(state.acquire().unwrap_err().reason, "captureBusy");
    drop(permit);
    assert!(state.acquire().is_ok());
  }

  #[test]
  fn current_platform_reports_visual_support() {
    let capabilities = platform_capabilities();
    assert_eq!(capabilities.platform, std::env::consts::OS);
    assert_eq!(
      capabilities.screenshot.available,
      cfg!(target_os = "windows")
    );
    assert_eq!(
      capabilities.recording.available,
      cfg!(target_os = "windows")
    );
  }

  #[test]
  fn recording_canvas_rounds_to_even_h264_dimensions() {
    let request = RecordingStartRequest {
      window_label: "main".into(),
      rect: platform::CssRect {
        x: 0.0,
        y: 0.0,
        width: 101.0,
        height: 51.0,
      },
      viewport: platform::CssViewport {
        width: 200.0,
        height: 100.0,
      },
      device_pixel_ratio: 1.25,
      fps: 30,
      max_duration_seconds: 60,
      audio: Some(RecordingAudioSource::None),
      source_mode: RecordingSourceMode::Live,
      audio_state: recording::RecordingAudioState::Active,
    };
    assert_eq!(output_canvas(&request).unwrap(), (126, 64));
  }

  #[cfg(target_os = "windows")]
  #[test]
  fn recording_pcm_queue_covers_the_audio_settlement_window_at_one_ms_cadence() {
    assert!(RECORDING_PCM_QUEUE_CAPACITY >= 100);
  }
}
