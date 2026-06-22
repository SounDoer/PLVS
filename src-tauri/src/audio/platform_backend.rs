//! Cross-platform [`AudioCapture`] entry: WASAPI loopback + cpal on Windows/Linux; Core Audio tap + cpal on macOS.

use tauri::AppHandle;

use super::capture::{AudioCapture, AudioCaptureSession};
#[cfg(not(target_os = "macos"))]
use super::cpal_backend::CpalBackend;
use super::device::DeviceInfo;
#[cfg(target_os = "macos")]
use super::macos;
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::FrameSubscribers;

/// Single type used by IPC and the device-watch thread.
pub struct AppAudioBackend;

impl AudioCapture for AppAudioBackend {
  fn list_devices(&self) -> Result<Vec<DeviceInfo>, String> {
    #[cfg(target_os = "macos")]
    {
      macos::list_devices()
    }
    #[cfg(not(target_os = "macos"))]
    {
      CpalBackend.list_devices()
    }
  }

  fn start_session(
    &self,
    device_id: &str,
    frame_subscribers: FrameSubscribers,
    app: AppHandle,
    channel_layout: std::sync::Arc<std::sync::Mutex<ChannelLayoutSetting>>,
    loudness_weights: std::sync::Arc<std::sync::Mutex<Option<Vec<f64>>>>,
    dialogue_gating: std::sync::Arc<std::sync::Mutex<bool>>,
  ) -> Result<Box<dyn AudioCaptureSession>, String> {
    #[cfg(target_os = "macos")]
    {
      macos::start_session(
        device_id,
        frame_subscribers,
        app,
        channel_layout,
        loudness_weights,
        dialogue_gating,
      )
    }
    #[cfg(not(target_os = "macos"))]
    {
      CpalBackend.start_session(
        device_id,
        frame_subscribers,
        app,
        channel_layout,
        loudness_weights,
        dialogue_gating,
      )
    }
  }
}
