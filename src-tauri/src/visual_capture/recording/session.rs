use super::super::platform::{CssRect, CssViewport};
use super::audio::SilenceReason;
use super::state::StopReason;

pub trait RecordingSessionControl: Send + Sync {
  fn recording_id(&self) -> &str;
  fn request_stop(&self, reason: StopReason);
  fn update_geometry(&self, rect: CssRect, viewport: CssViewport) -> Result<(), &'static str>;
  fn update_audio_silence_reason(&self, reason: SilenceReason) -> Result<(), &'static str>;
  fn is_finished(&self) -> bool;
}
