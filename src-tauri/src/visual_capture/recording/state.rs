use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::visual_capture::artifacts::ArtifactMetadata;
use crate::visual_capture::recording::audio::{
  AudioInterruption, AAC_BITRATE, OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE,
};

pub const DEFAULT_FPS: u32 = 30;
pub const SUPPORTED_FPS: [u32; 3] = [15, 30, 60];
pub const DEFAULT_MAX_DURATION_SECONDS: u32 = 60;
pub const MAX_DURATION_SECONDS: u32 = 1_800;
pub const MAX_ARTIFACT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_LEDGER_EVENTS: usize = 32;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordingAudioSource {
  None,
  MeasuredSource,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordingCursorMode {
  #[default]
  None,
  Visible,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMetadata {
  pub source: RecordingAudioSource,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub codec: Option<&'static str>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub sample_rate: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub channels: Option<u16>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub bitrate: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub silent_duration_ms: Option<u64>,
  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub interruptions: Vec<AudioInterruption>,
}

impl AudioMetadata {
  fn new(source: RecordingAudioSource) -> Self {
    match source {
      RecordingAudioSource::None => Self {
        source,
        codec: None,
        sample_rate: None,
        channels: None,
        bitrate: None,
        silent_duration_ms: None,
        interruptions: Vec::new(),
      },
      RecordingAudioSource::MeasuredSource => Self {
        source,
        codec: Some("aac"),
        sample_rate: Some(OUTPUT_SAMPLE_RATE),
        channels: Some(OUTPUT_CHANNELS),
        bitrate: Some(AAC_BITRATE),
        silent_duration_ms: Some(0),
        interruptions: Vec::new(),
      },
    }
  }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordingState {
  Starting,
  Recording,
  Stopping,
  Completed,
  Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopReason {
  Explicit,
  DurationLimit,
  SizeLimit,
  WindowLost,
  Shutdown,
  CaptureFailure,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
  pub width: u32,
  pub height: u32,
  pub fps: u32,
  pub codec: &'static str,
  pub cursor: RecordingCursorMode,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingLimits {
  pub max_duration_seconds: u32,
  pub max_artifact_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingFailure {
  pub reason: &'static str,
  pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingEvent {
  pub kind: &'static str,
  pub elapsed_ms: u64,
  pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSnapshot {
  pub recording_id: String,
  pub state: RecordingState,
  pub duration_ms: u64,
  pub captured_frames: u64,
  pub dropped_frames: u64,
  pub bytes: u64,
  pub video: VideoMetadata,
  pub audio: AudioMetadata,
  pub limits: RecordingLimits,
  pub events: Vec<RecordingEvent>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub stop_reason: Option<StopReason>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<RecordingFailure>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub artifact: Option<ArtifactMetadata>,
}

struct Entry {
  snapshot: RecordingSnapshot,
  started: Instant,
}

#[derive(Clone, Default)]
pub struct RecordingRegistry {
  inner: Arc<Mutex<RegistryInner>>,
}

#[derive(Default)]
struct RegistryInner {
  active_id: Option<String>,
  entries: HashMap<String, Entry>,
}

impl RecordingRegistry {
  pub fn create(
    &self,
    width: u32,
    height: u32,
    fps: u32,
    max_duration_seconds: u32,
    audio_source: RecordingAudioSource,
    cursor: RecordingCursorMode,
  ) -> Result<RecordingSnapshot, &'static str> {
    if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
      return Err("invalidGeometry");
    }
    if !SUPPORTED_FPS.contains(&fps) {
      return Err("invalidFps");
    }
    if !(1..=MAX_DURATION_SECONDS).contains(&max_duration_seconds) {
      return Err("invalidDuration");
    }
    let mut inner = self.inner.lock().map_err(|_| "stateUnavailable")?;
    if inner.active_id.is_some() {
      return Err("captureBusy");
    }
    let recording_id = random_recording_id().map_err(|_| "stateUnavailable")?;
    let snapshot = RecordingSnapshot {
      recording_id: recording_id.clone(),
      state: RecordingState::Starting,
      duration_ms: 0,
      captured_frames: 0,
      dropped_frames: 0,
      bytes: 0,
      video: VideoMetadata {
        width,
        height,
        fps,
        codec: "h264",
        cursor,
      },
      audio: AudioMetadata::new(audio_source),
      limits: RecordingLimits {
        max_duration_seconds,
        max_artifact_bytes: MAX_ARTIFACT_BYTES,
      },
      events: vec![RecordingEvent {
        kind: "starting",
        elapsed_ms: 0,
        message: "Recording initialization started.".into(),
      }],
      stop_reason: None,
      error: None,
      artifact: None,
    };
    inner.active_id = Some(recording_id.clone());
    inner.entries.insert(
      recording_id,
      Entry {
        snapshot: snapshot.clone(),
        started: Instant::now(),
      },
    );
    Ok(snapshot)
  }

  pub fn inspect(&self, recording_id: &str) -> Option<RecordingSnapshot> {
    let mut inner = self.inner.lock().ok()?;
    let entry = inner.entries.get_mut(recording_id)?;
    if matches!(
      entry.snapshot.state,
      RecordingState::Recording | RecordingState::Stopping
    ) {
      entry.snapshot.duration_ms = entry.started.elapsed().as_millis() as u64;
    }
    Some(entry.snapshot.clone())
  }

  pub fn mark_recording(&self, recording_id: &str) {
    self.update_entry(recording_id, |entry| {
      let snapshot = &mut entry.snapshot;
      if snapshot.state == RecordingState::Starting {
        snapshot.state = RecordingState::Recording;
        push_event(entry, "recording", "Video capture started.");
      }
    });
  }

  pub fn add_frame(&self, recording_id: &str, bytes: u64, dropped: u64) {
    self.update_entry(recording_id, |entry| {
      let snapshot = &mut entry.snapshot;
      snapshot.captured_frames = snapshot.captured_frames.saturating_add(1);
      snapshot.dropped_frames = snapshot.dropped_frames.saturating_add(dropped);
      snapshot.bytes = bytes;
    });
  }

  pub fn add_dropped_frames(&self, recording_id: &str, dropped: u64) {
    self.update_entry(recording_id, |entry| {
      entry.snapshot.dropped_frames = entry.snapshot.dropped_frames.saturating_add(dropped);
    });
  }

  pub fn set_bytes(&self, recording_id: &str, bytes: u64) {
    self.update_entry(recording_id, |entry| entry.snapshot.bytes = bytes);
  }

  pub fn update_audio(
    &self,
    recording_id: &str,
    silent_duration_ms: u64,
    interruptions: Vec<AudioInterruption>,
  ) {
    self.update_entry(recording_id, |entry| {
      if entry.snapshot.audio.source == RecordingAudioSource::MeasuredSource {
        entry.snapshot.audio.silent_duration_ms = Some(silent_duration_ms);
        entry.snapshot.audio.interruptions = interruptions;
      }
    });
  }

  pub fn record_event(&self, recording_id: &str, kind: &'static str, message: impl Into<String>) {
    let message = message.into();
    self.update_entry(recording_id, |entry| push_event(entry, kind, message));
  }

  pub fn request_stop(&self, recording_id: &str, reason: StopReason) -> Option<RecordingSnapshot> {
    let mut inner = self.inner.lock().ok()?;
    let entry = inner.entries.get_mut(recording_id)?;
    if matches!(
      entry.snapshot.state,
      RecordingState::Starting | RecordingState::Recording
    ) {
      entry.snapshot.state = RecordingState::Stopping;
      entry.snapshot.stop_reason = Some(reason);
      push_event(entry, "stopping", format!("Stop requested: {reason:?}."));
    }
    Some(entry.snapshot.clone())
  }

  pub fn complete(&self, recording_id: &str, artifact: ArtifactMetadata) {
    self.terminal(recording_id, |entry| {
      let snapshot = &mut entry.snapshot;
      snapshot.state = RecordingState::Completed;
      snapshot.bytes = artifact.bytes;
      snapshot.artifact = Some(artifact);
      push_event(entry, "completed", "Recording finalized and published.");
    });
  }

  pub fn fail(&self, recording_id: &str, message: impl Into<String>) {
    let message = message.into();
    self.terminal(recording_id, move |entry| {
      let snapshot = &mut entry.snapshot;
      snapshot.state = RecordingState::Failed;
      snapshot
        .stop_reason
        .get_or_insert(StopReason::CaptureFailure);
      snapshot.error = Some(RecordingFailure {
        reason: "recordingFailed",
        message,
      });
      push_event(entry, "failed", "Recording failed.");
    });
  }

  pub fn fail_with_artifact(
    &self,
    recording_id: &str,
    message: impl Into<String>,
    artifact: ArtifactMetadata,
  ) {
    let message = message.into();
    self.terminal(recording_id, move |entry| {
      entry.snapshot.state = RecordingState::Failed;
      entry
        .snapshot
        .stop_reason
        .get_or_insert(StopReason::CaptureFailure);
      entry.snapshot.bytes = artifact.bytes;
      entry.snapshot.artifact = Some(artifact);
      entry.snapshot.error = Some(RecordingFailure {
        reason: "recordingFailed",
        message,
      });
      push_event(
        entry,
        "failed",
        "Recording failed after producing a finalized artifact.",
      );
    });
  }

  fn update_entry(&self, recording_id: &str, update: impl FnOnce(&mut Entry)) {
    if let Ok(mut inner) = self.inner.lock() {
      if let Some(entry) = inner.entries.get_mut(recording_id) {
        update(entry);
      }
    }
  }

  fn terminal(&self, recording_id: &str, update: impl FnOnce(&mut Entry)) {
    if let Ok(mut inner) = self.inner.lock() {
      if let Some(entry) = inner.entries.get_mut(recording_id) {
        entry.snapshot.duration_ms = entry.started.elapsed().as_millis() as u64;
        update(entry);
      }
      if inner.active_id.as_deref() == Some(recording_id) {
        inner.active_id = None;
      }
    }
  }
}

fn push_event(entry: &mut Entry, kind: &'static str, message: impl Into<String>) {
  if entry.snapshot.events.len() == MAX_LEDGER_EVENTS {
    entry.snapshot.events.remove(0);
  }
  entry.snapshot.events.push(RecordingEvent {
    kind,
    elapsed_ms: entry.started.elapsed().as_millis() as u64,
    message: message.into(),
  });
}

fn random_recording_id() -> Result<String, getrandom::Error> {
  let mut bytes = [0_u8; 16];
  getrandom::fill(&mut bytes)?;
  Ok(format!(
    "rec-{}",
    bytes
      .iter()
      .map(|byte| format!("{byte:02x}"))
      .collect::<String>()
  ))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::PathBuf;

  fn artifact() -> ArtifactMetadata {
    ArtifactMetadata {
      artifact_id: "art-test".into(),
      kind: crate::visual_capture::artifacts::ArtifactKind::Recording,
      media_type: "video/mp4".into(),
      staged_path: PathBuf::from("C:/tmp/art-test.mp4"),
      width: 640,
      height: 480,
      bytes: 42,
      sha256: "00".repeat(32),
      created_at: "2026-09-07T00:00:00Z".into(),
      expires_at: "2026-09-08T00:00:00Z".into(),
    }
  }

  #[test]
  fn validates_limits_and_enforces_one_active_recording() {
    let registry = RecordingRegistry::default();
    assert_eq!(
      registry
        .create(
          0,
          2,
          30,
          60,
          RecordingAudioSource::None,
          RecordingCursorMode::None
        )
        .unwrap_err(),
      "invalidGeometry"
    );
    assert_eq!(
      registry
        .create(
          3,
          2,
          30,
          60,
          RecordingAudioSource::None,
          RecordingCursorMode::None
        )
        .unwrap_err(),
      "invalidGeometry"
    );
    assert_eq!(
      registry
        .create(
          2,
          2,
          24,
          60,
          RecordingAudioSource::None,
          RecordingCursorMode::None
        )
        .unwrap_err(),
      "invalidFps"
    );
    assert_eq!(
      registry
        .create(
          2,
          2,
          30,
          0,
          RecordingAudioSource::None,
          RecordingCursorMode::None
        )
        .unwrap_err(),
      "invalidDuration"
    );
    let first = registry
      .create(
        640,
        480,
        30,
        60,
        RecordingAudioSource::None,
        RecordingCursorMode::None,
      )
      .unwrap();
    assert_eq!(
      registry
        .create(
          640,
          480,
          30,
          60,
          RecordingAudioSource::None,
          RecordingCursorMode::None
        )
        .unwrap_err(),
      "captureBusy"
    );
    registry.fail(&first.recording_id, "failed");
    assert!(registry
      .create(
        640,
        480,
        30,
        60,
        RecordingAudioSource::None,
        RecordingCursorMode::None
      )
      .is_ok());
  }

  #[test]
  fn stop_is_idempotent_and_terminal_records_remain_inspectable() {
    let registry = RecordingRegistry::default();
    let created = registry
      .create(
        640,
        480,
        30,
        60,
        RecordingAudioSource::None,
        RecordingCursorMode::None,
      )
      .unwrap();
    registry.mark_recording(&created.recording_id);
    registry.add_frame(&created.recording_id, 10, 2);
    let stopping = registry
      .request_stop(&created.recording_id, StopReason::Explicit)
      .unwrap();
    assert_eq!(stopping.state, RecordingState::Stopping);
    assert_eq!(
      registry
        .request_stop(&created.recording_id, StopReason::DurationLimit)
        .unwrap()
        .stop_reason,
      Some(StopReason::Explicit)
    );
    registry.complete(&created.recording_id, artifact());
    let completed = registry.inspect(&created.recording_id).unwrap();
    assert_eq!(completed.state, RecordingState::Completed);
    assert_eq!(completed.captured_frames, 1);
    assert_eq!(completed.dropped_frames, 2);
    assert_eq!(completed.bytes, 42);
    assert!(completed.artifact.is_some());
    assert_eq!(
      registry
        .request_stop(&created.recording_id, StopReason::Explicit)
        .unwrap(),
      completed
    );
  }

  #[test]
  fn failures_release_concurrency_and_preserve_stable_error_shape() {
    let registry = RecordingRegistry::default();
    let created = registry
      .create(
        640,
        480,
        60,
        1,
        RecordingAudioSource::None,
        RecordingCursorMode::None,
      )
      .unwrap();
    registry.fail(&created.recording_id, "encoder unavailable");
    let failed = registry.inspect(&created.recording_id).unwrap();
    assert_eq!(failed.state, RecordingState::Failed);
    assert_eq!(failed.stop_reason, Some(StopReason::CaptureFailure));
    assert_eq!(failed.error.unwrap().reason, "recordingFailed");
    assert!(registry
      .create(
        640,
        480,
        15,
        MAX_DURATION_SECONDS,
        RecordingAudioSource::None,
        RecordingCursorMode::None
      )
      .is_ok());
  }

  #[test]
  fn event_ledger_is_bounded_and_keeps_the_newest_events() {
    let registry = RecordingRegistry::default();
    let created = registry
      .create(
        640,
        480,
        30,
        60,
        RecordingAudioSource::None,
        RecordingCursorMode::None,
      )
      .unwrap();
    for index in 0..(MAX_LEDGER_EVENTS + 5) {
      registry.record_event(&created.recording_id, "resize", index.to_string());
    }
    let snapshot = registry.inspect(&created.recording_id).unwrap();
    assert_eq!(snapshot.events.len(), MAX_LEDGER_EVENTS);
    assert_eq!(snapshot.events.first().unwrap().message, "5");
    assert_eq!(snapshot.events.last().unwrap().message, "36");
  }

  #[test]
  fn aggregate_counters_saturate_and_bytes_can_advance_without_a_frame() {
    let registry = RecordingRegistry::default();
    let created = registry
      .create(
        640,
        480,
        30,
        60,
        RecordingAudioSource::None,
        RecordingCursorMode::None,
      )
      .unwrap();
    registry.add_dropped_frames(&created.recording_id, u64::MAX);
    registry.add_dropped_frames(&created.recording_id, 1);
    registry.set_bytes(&created.recording_id, 99);
    let snapshot = registry.inspect(&created.recording_id).unwrap();
    assert_eq!(snapshot.dropped_frames, u64::MAX);
    assert_eq!(snapshot.bytes, 99);
  }

  #[test]
  fn measured_source_reports_fixed_aac_shape_and_silence_history() {
    let registry = RecordingRegistry::default();
    let created = registry
      .create(
        640,
        480,
        30,
        60,
        RecordingAudioSource::MeasuredSource,
        RecordingCursorMode::Visible,
      )
      .unwrap();
    let interruptions = (0..(MAX_LEDGER_EVENTS + 5))
      .map(|index| AudioInterruption {
        reason: crate::visual_capture::recording::audio::SilenceReason::LiveStopped,
        started_ms: index as u64,
        duration_ms: 1,
      })
      .collect::<Vec<_>>();
    registry.update_audio(&created.recording_id, 37, interruptions.clone());
    let audio = registry.inspect(&created.recording_id).unwrap().audio;
    assert_eq!(audio.source, RecordingAudioSource::MeasuredSource);
    assert_eq!(audio.codec, Some("aac"));
    assert_eq!(audio.sample_rate, Some(48_000));
    assert_eq!(audio.channels, Some(2));
    assert_eq!(audio.bitrate, Some(192_000));
    assert_eq!(audio.silent_duration_ms, Some(37));
    assert_eq!(audio.interruptions, interruptions);
    assert_eq!(
      registry
        .inspect(&created.recording_id)
        .unwrap()
        .video
        .cursor,
      RecordingCursorMode::Visible
    );
  }

  #[test]
  fn finalized_artifact_is_retained_when_capture_ends_in_failure() {
    let registry = RecordingRegistry::default();
    let created = registry
      .create(
        640,
        480,
        30,
        60,
        RecordingAudioSource::None,
        RecordingCursorMode::None,
      )
      .unwrap();
    registry.fail_with_artifact(&created.recording_id, "window lost", artifact());
    let snapshot = registry.inspect(&created.recording_id).unwrap();
    assert_eq!(snapshot.state, RecordingState::Failed);
    assert!(snapshot.artifact.is_some());
    assert_eq!(snapshot.bytes, 42);
  }
}
