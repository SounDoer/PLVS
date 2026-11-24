//! Bounded PCM sum on a frame timeline owned by the mix worker.

#[derive(Clone, Copy, Default)]
struct MixFrame {
  samples: [f32; 2],
  members: usize,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct MixCoverage {
  pub full: usize,
  pub partial: usize,
  pub empty: usize,
}

pub(super) struct StereoMixTimeline {
  frames: Vec<MixFrame>,
  next_member_frame: Vec<i64>,
  cursor: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum MixInsert {
  Accepted { late_frames: usize },
  Overflow,
}

impl StereoMixTimeline {
  pub fn new(members: usize, capacity: usize) -> Self {
    assert!(members > 0 && capacity > 0);
    Self {
      frames: vec![MixFrame::default(); capacity],
      next_member_frame: vec![0; members],
      cursor: 0,
    }
  }

  pub fn cursor(&self) -> i64 {
    self.cursor
  }

  /// Insert an ordered packet. Overlap with released or previously inserted frames is ignored.
  /// A packet beyond the bounded buffer is rejected without changing the timeline.
  pub fn push(&mut self, member: usize, start: i64, pcm: &[[f32; 2]]) -> MixInsert {
    let end = start + pcm.len() as i64;
    if end > self.cursor + self.frames.len() as i64 {
      return MixInsert::Overflow;
    }
    let unseen_start = start.max(self.next_member_frame[member]);
    let late_frames = (end.min(self.cursor) - unseen_start).max(0) as usize;
    let first = unseen_start.max(self.cursor);
    // Remember discarded late frames too, so a duplicate packet does not count them again.
    self.next_member_frame[member] = end.max(self.next_member_frame[member]);
    if first >= end {
      return MixInsert::Accepted { late_frames };
    }

    let capacity = self.frames.len();
    for (offset, input) in pcm[(first - start) as usize..].iter().enumerate() {
      let frame = &mut self.frames[(first as usize + offset) % capacity];
      frame.samples[0] += input[0];
      frame.samples[1] += input[1];
      frame.members += 1;
    }
    MixInsert::Accepted { late_frames }
  }

  /// Finalize a block after its deadline. Missing input contributes zero.
  pub fn render(&mut self, output: &mut [[f32; 2]]) -> MixCoverage {
    assert!(output.len() <= self.frames.len());
    let mut coverage = MixCoverage::default();
    let capacity = self.frames.len();
    for (offset, sample) in output.iter_mut().enumerate() {
      let frame = std::mem::take(&mut self.frames[(self.cursor as usize + offset) % capacity]);
      *sample = frame.samples;
      if frame.members == self.next_member_frame.len() {
        coverage.full += 1;
      } else if frame.members > 0 {
        coverage.partial += 1;
      } else {
        coverage.empty += 1;
      }
    }
    self.cursor += output.len() as i64;
    coverage
  }
}

#[cfg(test)]
mod tests {
  use super::{MixCoverage, MixInsert, StereoMixTimeline};

  #[test]
  fn keeps_mixing_through_a_missing_member_and_accepts_its_return() {
    let mut mix = StereoMixTimeline::new(2, 4);
    mix.push(0, 0, &[[0.75, 0.25]; 4]);
    mix.push(1, 0, &[[0.75, -0.25]]);
    mix.push(1, 2, &[[0.0, 0.0], [-0.75, -0.25]]);

    let mut output = [[0.0; 2]; 4];
    assert_eq!(
      mix.render(&mut output),
      MixCoverage {
        full: 3,
        partial: 1,
        empty: 0
      }
    );
    assert_eq!(output, [[1.5, 0.0], [0.75, 0.25], [0.75, 0.25], [0.0, 0.0]]);
    assert_eq!(mix.cursor(), 4);
  }

  #[test]
  fn rejects_future_overflow_and_never_replays_late_or_overlapping_samples() {
    let mut mix = StereoMixTimeline::new(2, 4);
    assert_eq!(mix.push(0, 4, &[[9.0, 9.0]]), MixInsert::Overflow);
    mix.push(0, 0, &[[1.0, 0.0]; 2]);
    assert_eq!(
      mix.push(0, 1, &[[9.0, 9.0], [1.0, 0.0]]),
      MixInsert::Accepted { late_frames: 0 }
    );

    let mut output = [[0.0; 2]; 4];
    assert_eq!(
      mix.render(&mut output),
      MixCoverage {
        full: 0,
        partial: 3,
        empty: 1
      }
    );
    assert_eq!(output, [[1.0, 0.0], [1.0, 0.0], [1.0, 0.0], [0.0, 0.0]]);
    assert_eq!(
      mix.push(1, 3, &[[9.0, 9.0], [0.0, 1.0]]),
      MixInsert::Accepted { late_frames: 1 }
    );
    assert_eq!(
      mix.push(1, 3, &[[9.0, 9.0], [0.0, 1.0]]),
      MixInsert::Accepted { late_frames: 0 }
    );
    mix.render(&mut output);
    assert_eq!(output, [[0.0, 1.0], [0.0; 2], [0.0; 2], [0.0; 2]]);
  }
}
