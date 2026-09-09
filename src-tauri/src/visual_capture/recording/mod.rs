pub mod audio;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod session;
pub mod state;
pub mod windows;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Deserialize;

use super::platform::{CssRect, CssViewport};
use audio::SilenceReason;
use session::RecordingSessionControl;
use state::{
  RecordingAudioSource, RecordingCursorMode, RecordingRegistry, RecordingSnapshot, StopReason,
  DEFAULT_FPS, DEFAULT_MAX_DURATION_SECONDS,
};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RecordingSourceMode {
  #[default]
  Live,
  File,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RecordingAudioState {
  Active,
  #[default]
  LiveStopped,
  LiveRestart,
  SourceModeFile,
}

impl RecordingAudioState {
  pub fn silence_reason(self) -> SilenceReason {
    match self {
      Self::Active | Self::LiveRestart => SilenceReason::LiveRestart,
      Self::LiveStopped => SilenceReason::LiveStopped,
      Self::SourceModeFile => SilenceReason::SourceModeFile,
    }
  }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStartRequest {
  pub window_label: String,
  pub rect: CssRect,
  pub viewport: CssViewport,
  pub device_pixel_ratio: f64,
  #[serde(default = "default_fps")]
  pub fps: u32,
  #[serde(default = "default_max_duration")]
  pub max_duration_seconds: u32,
  #[serde(default)]
  pub audio: Option<RecordingAudioSource>,
  #[serde(default)]
  pub cursor: RecordingCursorMode,
  #[serde(default)]
  pub source_mode: RecordingSourceMode,
  #[serde(default)]
  pub audio_state: RecordingAudioState,
}

impl RecordingStartRequest {
  pub fn resolved_audio_source(&self) -> RecordingAudioSource {
    self.audio.unwrap_or(match self.source_mode {
      RecordingSourceMode::Live => RecordingAudioSource::MeasuredSource,
      RecordingSourceMode::File => RecordingAudioSource::None,
    })
  }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingGeometryRequest {
  pub recording_id: String,
  pub rect: CssRect,
  pub viewport: CssViewport,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingAudioStateRequest {
  pub recording_id: String,
  pub state: RecordingAudioState,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingIdRequest {
  pub recording_id: String,
}

fn default_fps() -> u32 {
  DEFAULT_FPS
}

fn default_max_duration() -> u32 {
  DEFAULT_MAX_DURATION_SECONDS
}

#[derive(Default)]
pub struct RecordingController {
  registry: RecordingRegistry,
  sessions: Mutex<HashMap<String, Arc<dyn RecordingSessionControl>>>,
}

impl RecordingController {
  pub fn registry(&self) -> &RecordingRegistry {
    &self.registry
  }

  pub fn inspect(&self, recording_id: &str) -> Option<RecordingSnapshot> {
    self.reap_finished();
    self.registry.inspect(recording_id)
  }

  pub fn request_stop(&self, recording_id: &str, reason: StopReason) -> Option<RecordingSnapshot> {
    let snapshot = self.registry.request_stop(recording_id, reason)?;
    if let Ok(sessions) = self.sessions.lock() {
      if let Some(session) = sessions.get(recording_id) {
        session.request_stop(reason);
      }
    }
    Some(snapshot)
  }

  pub fn update_geometry(&self, request: RecordingGeometryRequest) -> Result<(), &'static str> {
    let sessions = self.sessions.lock().map_err(|_| "stateUnavailable")?;
    let session = sessions
      .get(&request.recording_id)
      .ok_or("recordingNotFound")?;
    session.update_geometry(request.rect, request.viewport)?;
    self.registry.record_event(
      &request.recording_id,
      "resize",
      "Semantic capture geometry updated.",
    );
    Ok(())
  }

  pub fn update_audio_state(
    &self,
    request: RecordingAudioStateRequest,
  ) -> Result<(), &'static str> {
    let sessions = self.sessions.lock().map_err(|_| "stateUnavailable")?;
    let session = sessions
      .get(&request.recording_id)
      .ok_or("recordingNotFound")?;
    session.update_audio_silence_reason(request.state.silence_reason())?;
    self.registry.record_event(
      &request.recording_id,
      "audioState",
      format!("Measured-source state changed to {:?}.", request.state),
    );
    Ok(())
  }

  pub fn insert_session<S>(&self, session: S) -> Result<(), &'static str>
  where
    S: RecordingSessionControl + 'static,
  {
    self
      .sessions
      .lock()
      .map_err(|_| "stateUnavailable")?
      .insert(session.recording_id().to_owned(), Arc::new(session));
    Ok(())
  }

  fn reap_finished(&self) {
    if let Ok(mut sessions) = self.sessions.lock() {
      sessions.retain(|_, session| !session.is_finished());
    }
  }

  pub fn shutdown_and_wait(&self, timeout: std::time::Duration) {
    let sessions = self
      .sessions
      .lock()
      .map(|sessions| sessions.values().cloned().collect::<Vec<_>>())
      .unwrap_or_default();
    for session in &sessions {
      self
        .registry
        .request_stop(session.recording_id(), StopReason::Shutdown);
      session.request_stop(StopReason::Shutdown);
    }
    let deadline = std::time::Instant::now() + timeout;
    while sessions.iter().any(|session| !session.is_finished())
      && std::time::Instant::now() < deadline
    {
      std::thread::sleep(std::time::Duration::from_millis(20));
    }
  }
}

impl Drop for RecordingController {
  fn drop(&mut self) {
    if let Ok(sessions) = self.sessions.get_mut() {
      for session in sessions.values() {
        session.request_stop(StopReason::Shutdown);
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

  use super::*;

  struct FakeSession {
    id: String,
    stopped: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    geometry_updates: Arc<AtomicUsize>,
    audio_updates: Arc<AtomicUsize>,
  }

  impl RecordingSessionControl for FakeSession {
    fn recording_id(&self) -> &str {
      &self.id
    }

    fn request_stop(&self, _reason: StopReason) {
      self.stopped.store(true, Ordering::Release);
      self.finished.store(true, Ordering::Release);
    }

    fn update_geometry(&self, _rect: CssRect, _viewport: CssViewport) -> Result<(), &'static str> {
      self.geometry_updates.fetch_add(1, Ordering::Relaxed);
      Ok(())
    }

    fn update_audio_silence_reason(&self, _reason: SilenceReason) -> Result<(), &'static str> {
      self.audio_updates.fetch_add(1, Ordering::Relaxed);
      Ok(())
    }

    fn is_finished(&self) -> bool {
      self.finished.load(Ordering::Acquire)
    }
  }

  #[test]
  fn request_defaults_to_measured_source_in_live_mode() {
    let request: RecordingStartRequest = serde_json::from_value(serde_json::json!({
      "windowLabel": "main",
      "rect": { "x": 0, "y": 0, "width": 640, "height": 480 },
      "viewport": { "width": 640, "height": 480 },
      "devicePixelRatio": 1
    }))
    .unwrap();
    assert_eq!(request.fps, DEFAULT_FPS);
    assert_eq!(request.max_duration_seconds, DEFAULT_MAX_DURATION_SECONDS);
    assert_eq!(request.cursor, RecordingCursorMode::None);
    assert_eq!(
      request.resolved_audio_source(),
      RecordingAudioSource::MeasuredSource
    );
  }

  #[test]
  fn file_mode_defaults_to_none_but_preserves_explicit_none() {
    for audio in [None, Some(RecordingAudioSource::None)] {
      let mut request: RecordingStartRequest = serde_json::from_value(serde_json::json!({
        "windowLabel": "main",
        "rect": { "x": 0, "y": 0, "width": 640, "height": 480 },
        "viewport": { "width": 640, "height": 480 },
        "devicePixelRatio": 1,
        "sourceMode": "file"
      }))
      .unwrap();
      request.audio = audio;
      assert_eq!(request.resolved_audio_source(), RecordingAudioSource::None);
    }
  }

  #[test]
  fn request_preserves_visible_cursor_mode() {
    let request: RecordingStartRequest = serde_json::from_value(serde_json::json!({
      "windowLabel": "main",
      "rect": { "x": 0, "y": 0, "width": 640, "height": 480 },
      "viewport": { "width": 640, "height": 480 },
      "devicePixelRatio": 1,
      "cursor": "visible"
    }))
    .unwrap();
    assert_eq!(request.cursor, RecordingCursorMode::Visible);
  }

  #[test]
  fn controller_routes_platform_neutral_session_operations() {
    let controller = RecordingController::default();
    let created = controller
      .registry()
      .create(
        640,
        480,
        30,
        60,
        RecordingAudioSource::None,
        RecordingCursorMode::None,
      )
      .unwrap();
    let stopped = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let geometry_updates = Arc::new(AtomicUsize::new(0));
    let audio_updates = Arc::new(AtomicUsize::new(0));
    controller
      .insert_session(FakeSession {
        id: created.recording_id.clone(),
        stopped: Arc::clone(&stopped),
        finished: Arc::clone(&finished),
        geometry_updates: Arc::clone(&geometry_updates),
        audio_updates: Arc::clone(&audio_updates),
      })
      .unwrap();

    controller
      .update_geometry(RecordingGeometryRequest {
        recording_id: created.recording_id.clone(),
        rect: CssRect {
          x: 0.0,
          y: 0.0,
          width: 320.0,
          height: 240.0,
        },
        viewport: CssViewport {
          width: 640.0,
          height: 480.0,
        },
      })
      .unwrap();
    controller
      .update_audio_state(RecordingAudioStateRequest {
        recording_id: created.recording_id.clone(),
        state: RecordingAudioState::LiveStopped,
      })
      .unwrap();
    assert!(controller
      .request_stop(&created.recording_id, StopReason::Explicit)
      .is_some());

    assert_eq!(geometry_updates.load(Ordering::Relaxed), 1);
    assert_eq!(audio_updates.load(Ordering::Relaxed), 1);
    assert!(stopped.load(Ordering::Acquire));
    assert!(finished.load(Ordering::Acquire));
    controller.shutdown_and_wait(std::time::Duration::from_millis(1));
  }
}
