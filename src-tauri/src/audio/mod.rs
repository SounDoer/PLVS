//! System audio capture: WASAPI loopback, macOS Core Audio taps, and Linux PulseAudio monitors.

pub mod capture;
pub mod capture_summary;
pub mod cpal_backend;
pub mod device;
pub mod device_enum;
pub mod device_id;
#[cfg(target_os = "linux")]
mod linux_devices;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
pub mod macos_capture_apps;
mod platform_backend;
#[cfg(target_os = "windows")]
pub mod windows_capture_apps;
#[cfg(target_os = "windows")]
pub mod windows_process_loopback;

pub use capture::{
  AudioCapture, AudioCaptureSession, MeasuredPcmReceiver, MeasuredPcmSubscriptions, PcmFrame,
};
pub use device::DeviceInfo;
pub use platform_backend::AppAudioBackend;
