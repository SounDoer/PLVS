use std::ffi::{c_char, c_void, CStr};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::platform::{
  CaptureError, CaptureFuture, CapturedImage, PlatformCapabilities, RecordingCapabilities,
  RecordingPermission, ScreenshotCapabilities, ScreenshotRequest, VisualCapturePlatform,
};

const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5);

type SnapshotResult = Result<CapturedImage, CaptureError>;
type SnapshotSender = mpsc::SyncSender<SnapshotResult>;

unsafe extern "C" {
  fn plvs_macos_screen_capture_preflight() -> bool;
  fn plvs_macos_screen_capture_request() -> bool;

  fn plvs_macos_capture_webview_png(
    webview: *mut c_void,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    path: *const u8,
    path_length: usize,
    context: *mut c_void,
    callback: unsafe extern "C" fn(*mut c_void, i32, u32, u32, *const c_char),
  );
}

pub fn recording_permission() -> RecordingPermission {
  classify_recording_permission(unsafe { plvs_macos_screen_capture_preflight() })
}

fn classify_recording_permission(granted: bool) -> RecordingPermission {
  if granted {
    RecordingPermission::Granted
  } else {
    RecordingPermission::Required
  }
}

pub fn request_recording_permission() -> Result<(), CaptureError> {
  if unsafe { plvs_macos_screen_capture_request() } {
    Ok(())
  } else {
    Err(CaptureError {
      reason: "screenCapturePermissionRequired",
      message: "Allow PLVS in System Settings > Privacy & Security > Screen & System Audio Recording, then restart PLVS.".to_owned(),
    })
  }
}

pub struct MacOsPlatform;

impl VisualCapturePlatform for MacOsPlatform {
  fn capabilities(&self) -> PlatformCapabilities {
    PlatformCapabilities {
      platform: "macos".to_owned(),
      screenshot: ScreenshotCapabilities {
        available: true,
        targets: vec!["main", "workspace", "panel", "dockHeader", "dockEditor"],
      },
      recording: RecordingCapabilities {
        available: true,
        permission: recording_permission(),
        targets: vec!["main", "workspace"],
        audio_sources: vec!["none", "measuredSource"],
        cursor_modes: vec!["none", "visible"],
      },
    }
  }

  fn capture_screenshot<'a>(
    &'a self,
    app: &'a AppHandle,
    request: &'a ScreenshotRequest,
    output_path: &'a Path,
  ) -> CaptureFuture<'a> {
    Box::pin(capture_webview_screenshot(app, request, output_path))
  }
}

unsafe extern "C" fn snapshot_completed(
  context: *mut c_void,
  status: i32,
  width: u32,
  height: u32,
  message: *const c_char,
) {
  if context.is_null() {
    return;
  }
  let sender = unsafe { Box::from_raw(context.cast::<SnapshotSender>()) };
  let message = if message.is_null() {
    String::new()
  } else {
    unsafe { CStr::from_ptr(message) }
      .to_string_lossy()
      .into_owned()
  };
  let _ = sender.send(snapshot_result(status, width, height, message));
}

fn snapshot_result(status: i32, width: u32, height: u32, message: String) -> SnapshotResult {
  match status {
    0 if width > 0 && height > 0 => Ok(CapturedImage { width, height }),
    1 => Err(CaptureError::target_unavailable(message)),
    3 => Err(CaptureError {
      reason: "artifactWriteFailed",
      message,
    }),
    _ => Err(CaptureError::failed(if message.is_empty() {
      "The WebKit screenshot failed.".to_owned()
    } else {
      message
    })),
  }
}

async fn capture_webview_screenshot(
  app: &AppHandle,
  request: &ScreenshotRequest,
  output_path: &Path,
) -> SnapshotResult {
  let window = app
    .get_webview_window(&request.window_label)
    .ok_or_else(|| {
      CaptureError::target_unavailable("The requested PLVS WebView does not exist.")
    })?;
  if !window
    .is_visible()
    .map_err(|_| CaptureError::failed("The requested PLVS WebView visibility is unavailable."))?
  {
    return Err(CaptureError::target_unavailable(
      "The requested PLVS WebView is not visible.",
    ));
  }

  let request = request.clone();
  let path = output_path.as_os_str().as_bytes().to_vec();
  let (sender, receiver) = mpsc::sync_channel(1);
  window
    .with_webview(move |platform_webview| {
      let context = Box::into_raw(Box::new(sender)).cast::<c_void>();
      unsafe {
        plvs_macos_capture_webview_png(
          platform_webview.inner(),
          request.rect.x,
          request.rect.y,
          request.rect.width,
          request.rect.height,
          path.as_ptr(),
          path.len(),
          context,
          snapshot_completed,
        );
      }
    })
    .map_err(|_| CaptureError::failed("The WebView capture task could not be scheduled."))?;

  tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(SNAPSHOT_TIMEOUT))
    .await
    .map_err(|_| CaptureError::failed("The WebView screenshot wait failed."))?
    .map_err(|_| CaptureError::failed("The WebView screenshot timed out."))?
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn macos_capabilities_expose_measured_source_window_recording() {
    let capabilities = MacOsPlatform.capabilities();
    assert!(capabilities.screenshot.available);
    assert_eq!(capabilities.screenshot.targets.len(), 5);
    assert!(capabilities.recording.available);
    assert_eq!(
      capabilities.recording.audio_sources,
      vec!["none", "measuredSource"]
    );
  }

  #[test]
  fn native_snapshot_statuses_keep_stable_public_reasons() {
    assert_eq!(
      snapshot_result(0, 20, 10, String::new()).unwrap(),
      CapturedImage {
        width: 20,
        height: 10,
      }
    );
    assert_eq!(
      snapshot_result(1, 0, 0, "moved".into()).unwrap_err().reason,
      "targetUnavailable"
    );
    assert_eq!(
      snapshot_result(3, 0, 0, "write".into()).unwrap_err().reason,
      "artifactWriteFailed"
    );
    assert_eq!(
      snapshot_result(0, 0, 0, String::new()).unwrap_err().reason,
      "captureFailed"
    );
  }

  #[test]
  fn recording_permission_classification_never_prompts() {
    assert_eq!(
      classify_recording_permission(true),
      RecordingPermission::Granted
    );
    assert_eq!(
      classify_recording_permission(false),
      RecordingPermission::Required
    );
  }

  #[test]
  fn native_recording_stays_window_scoped_and_avoids_system_audio() {
    let source = include_str!(concat!(
      env!("CARGO_MANIFEST_DIR"),
      "/native/macos/visual_capture_bridge.m"
    ));
    assert!(source.contains("candidate.windowID == windowID"));
    assert!(source.contains("candidate.owningApplication.processID =="));
    assert!(source.contains("initWithDesktopIndependentWindow:source"));
    assert!(source.contains("configuration.capturesAudio = NO"));
    assert!(source.contains("kAudioFormatMPEG4AAC"));
    assert!(source.contains("dataWithBytes:samples"));
    assert!(!source.contains("configuration.sourceRect"));
  }
}
