pub mod artifacts;
pub mod platform;
#[cfg(target_os = "windows")]
pub mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, State};

use artifacts::{ArtifactKind, ArtifactMetadata, ArtifactStore};
#[cfg(not(target_os = "windows"))]
use platform::UnsupportedPlatform;
use platform::{CaptureError, PlatformCapabilities, ScreenshotRequest, VisualCapturePlatform};
#[cfg(target_os = "windows")]
use windows::WindowsPlatform;

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
  fn current_platform_reports_screenshot_support_without_recording() {
    let capabilities = platform_capabilities();
    assert_eq!(capabilities.platform, std::env::consts::OS);
    assert_eq!(
      capabilities.screenshot.available,
      cfg!(target_os = "windows")
    );
    assert!(!capabilities.recording.available);
  }
}
