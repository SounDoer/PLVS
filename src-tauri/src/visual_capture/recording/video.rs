use std::collections::VecDeque;

/// Constant-rate presentation slots on the same elapsed clock as recorded PCM.
/// Capture timestamps survive queueing/encoding delays: a future picture is never backdated
/// into an earlier slot. Before the first picture, the caller supplies an explicit black frame.
pub(crate) struct VideoTimeline<T> {
  fps: u32,
  next_frame: u64,
  pending: VecDeque<(u64, T)>,
  latest: Option<T>,
}

impl<T> VideoTimeline<T> {
  pub(crate) fn new(fps: u32) -> Self {
    assert!(fps > 0);
    Self {
      fps,
      next_frame: 0,
      pending: VecDeque::new(),
      latest: None,
    }
  }

  pub(crate) fn push(&mut self, captured_ns: u64, frame: T) {
    self.pending.push_back((captured_ns, frame));
  }

  fn timestamp_ns(&self, index: u64) -> u64 {
    index.saturating_mul(1_000_000_000) / u64::from(self.fps)
  }

  pub(crate) fn next_deadline_ns(&self) -> u64 {
    self.timestamp_ns(self.next_frame.saturating_add(1))
  }

  pub(crate) fn frame_count(&self) -> u64 {
    self.next_frame
  }

  pub(crate) fn next_due(&mut self, elapsed_ns: u64) -> Option<(u64, Option<&T>)> {
    if self.next_deadline_ns() > elapsed_ns {
      return None;
    }
    let index = self.next_frame;
    let timestamp = self.timestamp_ns(index);
    while self.pending.front().is_some_and(|(at, _)| *at <= timestamp) {
      self.latest = self.pending.pop_front().map(|(_, frame)| frame);
    }
    self.next_frame = self.next_frame.saturating_add(1);
    Some((index, self.latest.as_ref()))
  }
}

#[cfg(test)]
mod tests {
  use super::VideoTimeline;

  #[test]
  fn delayed_first_picture_keeps_empty_startup_time_on_the_pcm_clock() {
    let mut video = VideoTimeline::new(30);
    video.push(250_000_000, "first");
    let mut output = Vec::new();
    while let Some((index, frame)) = video.next_due(1_000_000_000) {
      output.push((index, frame.copied()));
    }
    assert_eq!(output.len(), 30);
    assert!(output[..8].iter().all(|(_, frame)| frame.is_none()));
    assert_eq!(output[8], (8, Some("first")));
    // Frame 8 starts at 266.667 ms, not at time zero despite the 250 ms startup wait.
    let video_sample = output[8].0 * 48_000 / 30;
    assert_eq!(video_sample, 12_800);
    let origin_ns = 9_000_000_000;
    let mut audio = super::super::audio::AudioTimeline::new(origin_ns);
    let packets = audio.ingest(
      &crate::audio::PcmFrame {
        timestamp_ns: origin_ns + 250_000_000,
        samples: vec![0.1; 480 * 2],
        sample_rate: 48_000,
        channels: 2,
        sequence: 1,
        dropped_before: 0,
      },
      super::super::audio::SilenceReason::LiveRestart,
    );
    let audio_sample = packets.last().unwrap().start_frame;
    assert_eq!(audio_sample, 12_000);
    assert!(video_sample - audio_sample < 48_000 / 30);
    assert_eq!(video.frame_count() * 48_000 / 30, 48_000);
  }

  #[test]
  fn encoder_backlog_does_not_put_new_pictures_into_past_slots() {
    let mut video = VideoTimeline::new(30);
    video.push(0, "old");
    assert_eq!(video.next_due(33_333_333), Some((0, Some(&"old"))));
    // Both captures arrive before the stalled encoder gets CPU again.
    video.push(200_000_000, "middle");
    video.push(500_000_000, "new");
    let mut output = Vec::new();
    while let Some((index, frame)) = video.next_due(1_000_000_000) {
      output.push((index, frame.copied()));
    }
    assert_eq!(output.len(), 29);
    assert!(output
      .iter()
      .filter(|(i, _)| *i < 6)
      .all(|(_, f)| *f == Some("old")));
    assert!(output
      .iter()
      .filter(|(i, _)| (6..15).contains(i))
      .all(|(_, f)| *f == Some("middle")));
    assert!(output
      .iter()
      .filter(|(i, _)| *i >= 15)
      .all(|(_, f)| *f == Some("new")));
    assert_eq!(video.frame_count(), 30);
  }

  #[test]
  fn rational_deadlines_keep_long_recordings_at_the_requested_frame_rate() {
    for fps in [15, 30, 60] {
      let mut video = VideoTimeline::<()>::new(fps);
      for index in 0..u64::from(fps) * 600 {
        let deadline = video.next_deadline_ns();
        assert!(video.next_due(deadline - 1).is_none());
        assert_eq!(video.next_due(deadline), Some((index, None)));
      }
      assert_eq!(video.frame_count() * 48_000 / u64::from(fps), 600 * 48_000);
    }
  }
}
