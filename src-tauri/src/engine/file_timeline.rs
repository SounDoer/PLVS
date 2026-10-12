//! Media-time cadence and pending delivery queues for offline file analysis.

/// Owns file-only time and batching state without knowing anything about PCM or frame payloads.
pub(super) struct FileTimeline<LoudnessCheckpoint, VisualCheckpoint> {
  loudness_cadence_ms: u64,
  visual_cadence_ms: u64,
  current_media_time_ms: Option<u64>,
  last_media_time_ms: Option<u64>,
  last_loudness_observation_ms: Option<u64>,
  last_loudness_checkpoint_ms: Option<u64>,
  last_visual_checkpoint_ms: Option<u64>,
  pending_loudness: Vec<LoudnessCheckpoint>,
  pending_visual: Vec<VisualCheckpoint>,
}

impl<LoudnessCheckpoint, VisualCheckpoint> FileTimeline<LoudnessCheckpoint, VisualCheckpoint> {
  pub(super) fn new(loudness_cadence_ms: u64, visual_cadence_ms: u64) -> Self {
    Self {
      loudness_cadence_ms,
      visual_cadence_ms,
      current_media_time_ms: None,
      last_media_time_ms: None,
      last_loudness_observation_ms: None,
      last_loudness_checkpoint_ms: None,
      last_visual_checkpoint_ms: None,
      pending_loudness: Vec::new(),
      pending_visual: Vec::new(),
    }
  }

  pub(super) fn begin_push(&mut self, media_time_ms: u64) {
    self.current_media_time_ms = Some(media_time_ms);
    self.last_media_time_ms = Some(media_time_ms);
  }

  pub(super) fn end_push(&mut self) {
    self.current_media_time_ms = None;
  }

  pub(super) fn timestamp_ms(&self) -> Option<u64> {
    self.current_media_time_ms.or(self.last_media_time_ms)
  }

  pub(super) fn loudness_checkpoint_due(&mut self, timestamp_ms: u64) -> bool {
    self.last_loudness_observation_ms = Some(timestamp_ms);
    checkpoint_due(
      &mut self.last_loudness_checkpoint_ms,
      timestamp_ms,
      self.loudness_cadence_ms,
    )
  }

  pub(super) fn visual_checkpoint_due(&mut self, timestamp_ms: u64) -> bool {
    checkpoint_due(
      &mut self.last_visual_checkpoint_ms,
      timestamp_ms,
      self.visual_cadence_ms,
    )
  }

  pub(super) fn final_loudness_checkpoint_due(&mut self) -> Option<u64> {
    final_checkpoint_due(
      self.last_loudness_observation_ms,
      &mut self.last_loudness_checkpoint_ms,
    )
  }

  pub(super) fn final_visual_checkpoint_due(&mut self) -> Option<u64> {
    final_checkpoint_due(self.last_media_time_ms, &mut self.last_visual_checkpoint_ms)
  }

  pub(super) fn queue_loudness(&mut self, checkpoint: LoudnessCheckpoint) {
    self.pending_loudness.push(checkpoint);
  }

  pub(super) fn queue_visual(&mut self, checkpoint: VisualCheckpoint) {
    self.pending_visual.push(checkpoint);
  }

  pub(super) fn has_pending(&self) -> bool {
    !self.pending_loudness.is_empty() || !self.pending_visual.is_empty()
  }

  pub(super) fn drain(&mut self) -> (Vec<LoudnessCheckpoint>, Vec<VisualCheckpoint>) {
    (
      std::mem::take(&mut self.pending_loudness),
      std::mem::take(&mut self.pending_visual),
    )
  }

  pub(super) fn reset(&mut self) {
    self.current_media_time_ms = None;
    self.last_media_time_ms = None;
    self.last_loudness_observation_ms = None;
    self.last_loudness_checkpoint_ms = None;
    self.last_visual_checkpoint_ms = None;
    self.pending_loudness.clear();
    self.pending_visual.clear();
  }
}

fn checkpoint_due(
  last_checkpoint_ms: &mut Option<u64>,
  timestamp_ms: u64,
  cadence_ms: u64,
) -> bool {
  let due = last_checkpoint_ms
    .map(|last| timestamp_ms.saturating_sub(last) >= cadence_ms)
    .unwrap_or(true);
  if due {
    *last_checkpoint_ms = Some(timestamp_ms);
  }
  due
}

fn final_checkpoint_due(
  last_media_time_ms: Option<u64>,
  last_checkpoint_ms: &mut Option<u64>,
) -> Option<u64> {
  let timestamp_ms = last_media_time_ms?;
  if *last_checkpoint_ms == Some(timestamp_ms) {
    return None;
  }
  *last_checkpoint_ms = Some(timestamp_ms);
  Some(timestamp_ms)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn media_time_cadence_is_independent_from_wall_clock() {
    let mut timeline = FileTimeline::<(), ()>::new(100, 40);
    assert!(timeline.visual_checkpoint_due(100));
    assert!(!timeline.visual_checkpoint_due(120));
    assert!(timeline.visual_checkpoint_due(140));
  }

  #[test]
  fn last_media_time_survives_until_reset() {
    let mut timeline = FileTimeline::<(), ()>::new(100, 40);
    timeline.begin_push(1_250);
    assert_eq!(timeline.timestamp_ms(), Some(1_250));
    timeline.end_push();
    assert_eq!(timeline.timestamp_ms(), Some(1_250));
    timeline.reset();
    assert_eq!(timeline.timestamp_ms(), None);
  }

  #[test]
  fn queues_drain_without_pcm_or_frame_assembly() {
    let mut timeline = FileTimeline::new(100, 40);
    timeline.queue_loudness("loudness");
    timeline.queue_visual("visual");
    assert!(timeline.has_pending());

    let drained = timeline.drain();
    assert_eq!(drained, (vec!["loudness"], vec!["visual"]));
    assert!(!timeline.has_pending());
  }

  #[test]
  fn final_checkpoint_closes_the_media_time_range_once() {
    let mut timeline = FileTimeline::<(), ()>::new(1_000, 1_000);
    assert!(timeline.loudness_checkpoint_due(1_000));
    assert!(!timeline.loudness_checkpoint_due(1_900));
    timeline.begin_push(2_000);
    timeline.end_push();

    assert_eq!(timeline.final_loudness_checkpoint_due(), Some(1_900));
    assert_eq!(timeline.final_visual_checkpoint_due(), Some(2_000));
    assert_eq!(timeline.final_loudness_checkpoint_due(), None);
    assert_eq!(timeline.final_visual_checkpoint_due(), None);
  }
}
