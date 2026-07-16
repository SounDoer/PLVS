//! System audio capture: WASAPI loopback on Windows; Core Audio process tap (macOS 14.2+) + cpal.

pub mod capture;
pub mod capture_summary;
pub mod cpal_backend;
pub mod device;
pub mod device_enum;
pub mod device_id;
#[cfg(target_os = "macos")]
pub mod macos;
mod platform_backend;

pub use capture::{AudioCapture, AudioCaptureSession, PcmFrame};
pub use device::DeviceInfo;
pub use platform_backend::AppAudioBackend;
