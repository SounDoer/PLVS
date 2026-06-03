//! `AudioCapture` abstraction over platform backends (see `docs/architecture.md` §5).
//!
//! Concrete backends: `cpal_backend` (WASAPI loopback + inputs), `platform_backend::AppAudioBackend` (dispatches to Core Audio tap on macOS).

use tauri::AppHandle;

use super::device::DeviceInfo;
use crate::dsp::SpectrumChannelSel;
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::FrameSubscribers;
use crate::ipc::types::MeterHistoryBuf;

/// One PCM buffer from the device; channel count is never hard-coded to stereo.
#[derive(Clone, Debug)]
pub struct PcmFrame {
  pub samples: Vec<f32>,
  pub channels: u16,
  pub sample_rate: u32,
  pub timestamp_ns: u64,
}

/// One active capture session; removing it from `AppState` and dropping it stops the stream.
pub trait AudioCaptureSession: Send {
  fn request_clear_peak_history(&self);
}

/// List devices + start capture; returns a session as a trait object to avoid circular deps between `capture` and concrete backends.
pub trait AudioCapture: Send + Sync {
  fn list_devices(&self) -> Result<Vec<DeviceInfo>, String>;

  #[allow(clippy::too_many_arguments)]
  fn start_session(
    &self,
    device_id: &str,
    frame_subscribers: FrameSubscribers,
    app: AppHandle,
    meter_history: MeterHistoryBuf,
    vectorscope_pair: std::sync::Arc<std::sync::Mutex<(u16, u16)>>,
    channel_layout: std::sync::Arc<std::sync::Mutex<ChannelLayoutSetting>>,
    spectrum_channel: std::sync::Arc<std::sync::Mutex<SpectrumChannelSel>>,
  ) -> Result<Box<dyn AudioCaptureSession>, String>;
}
