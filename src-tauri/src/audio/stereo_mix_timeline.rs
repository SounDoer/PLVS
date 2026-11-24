//! Bounded PCM sum on a frame timeline owned by the mix worker.

use std::collections::HashMap;
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub(super) const MIX_SAMPLE_RATE: u32 = 48_000;

#[derive(Clone, Copy)]
struct MixFrame<const N: usize> {
  samples: [f32; N],
  members: usize,
}

impl<const N: usize> Default for MixFrame<N> {
  fn default() -> Self {
    Self {
      samples: [0.0; N],
      members: 0,
    }
  }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct MixCoverage {
  pub full: usize,
  pub partial: usize,
  pub empty: usize,
}

pub(super) struct StereoMixTimeline<const N: usize = 2> {
  frames: Vec<MixFrame<N>>,
  next_member_frame: Vec<i64>,
  next_stream_frame: HashMap<(usize, u32), i64>,
  present: Vec<u64>,
  member_words: usize,
  cursor: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum MixInsert {
  Accepted { late_frames: usize },
  Overflow,
}

impl<const N: usize> StereoMixTimeline<N> {
  pub fn new(members: usize, capacity: usize) -> Self {
    assert!(members > 0 && capacity > 0);
    let member_words = members.div_ceil(64);
    Self {
      frames: vec![MixFrame::default(); capacity],
      next_member_frame: vec![0; members],
      next_stream_frame: HashMap::new(),
      present: vec![0; capacity * member_words],
      member_words,
      cursor: 0,
    }
  }

  pub fn cursor(&self) -> i64 {
    self.cursor
  }

  /// Insert an ordered packet. Overlap with released or previously inserted frames is ignored.
  /// A packet beyond the bounded buffer is rejected without changing the timeline.
  pub fn push(
    &mut self,
    member: usize,
    stream: Option<u32>,
    start: i64,
    pcm: &[[f32; N]],
  ) -> MixInsert {
    let end = start + pcm.len() as i64;
    if end > self.cursor + self.frames.len() as i64 {
      return MixInsert::Overflow;
    }
    let next_frame = if let Some(stream) = stream {
      let oldest = self.cursor - self.frames.len() as i64;
      self.next_stream_frame.retain(|_, last| *last >= oldest);
      self.next_stream_frame.entry((member, stream)).or_insert(0)
    } else {
      &mut self.next_member_frame[member]
    };
    let unseen_start = start.max(*next_frame);
    let late_frames = (end.min(self.cursor) - unseen_start).max(0) as usize;
    let first = unseen_start.max(self.cursor);
    // Remember discarded late frames too, so a duplicate packet does not count them again.
    *next_frame = end.max(*next_frame);
    if first >= end {
      return MixInsert::Accepted { late_frames };
    }

    let capacity = self.frames.len();
    for (offset, input) in pcm[(first - start) as usize..].iter().enumerate() {
      let slot = (first as usize + offset) % capacity;
      let frame = &mut self.frames[slot];
      for (sum, value) in frame.samples.iter_mut().zip(input) {
        *sum += value;
      }
      let present = &mut self.present[slot * self.member_words + member / 64];
      let member_bit = 1 << (member % 64);
      if *present & member_bit == 0 {
        frame.members += 1;
        *present |= member_bit;
      }
    }
    MixInsert::Accepted { late_frames }
  }

  /// Finalize a block after its deadline. Missing input contributes zero.
  pub fn render(&mut self, output: &mut [[f32; N]]) -> MixCoverage {
    assert!(output.len() <= self.frames.len());
    let mut coverage = MixCoverage::default();
    let capacity = self.frames.len();
    for (offset, sample) in output.iter_mut().enumerate() {
      let slot = (self.cursor as usize + offset) % capacity;
      let frame = std::mem::take(&mut self.frames[slot]);
      let first_word = slot * self.member_words;
      self.present[first_word..first_word + self.member_words].fill(0);
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

pub(super) struct MixPacket<const N: usize = 2> {
  pub member: usize,
  pub stream: Option<u32>,
  pub time_100ns: u64,
  pub end_time_100ns: Option<u64>,
  pub frames: Vec<[f32; N]>,
}

pub(super) fn run_mix_timeline<const N: usize>(
  rx: mpsc::Receiver<MixPacket<N>>,
  member_count: usize,
  stopped: impl FnMut() -> bool,
  on_block: impl FnMut(&[f32], MixCoverage),
  on_insert: impl FnMut(MixInsert),
) -> bool {
  run_mix_timeline_with_clock(rx, member_count, stopped, on_block, on_insert, Instant::now)
}

fn run_mix_timeline_with_clock<const N: usize>(
  rx: mpsc::Receiver<MixPacket<N>>,
  member_count: usize,
  mut stopped: impl FnMut() -> bool,
  mut on_block: impl FnMut(&[f32], MixCoverage),
  mut on_insert: impl FnMut(MixInsert),
  mut now: impl FnMut() -> Instant,
) -> bool {
  const DELAY: Duration = Duration::from_millis(80);
  const POLL: Duration = Duration::from_millis(5);
  const RATE: usize = MIX_SAMPLE_RATE as usize;
  // The larger ring absorbs bursts without permitting unbounded accumulation.
  let mut timeline = StereoMixTimeline::new(member_count, RATE / 2);
  let mut block = [[0.0; N]; RATE / 100];
  let mut adjusted = Vec::new();
  let first = loop {
    if stopped() {
      return false;
    }
    match rx.recv_timeout(POLL) {
      Ok(packet) => break packet,
      Err(mpsc::RecvTimeoutError::Disconnected) => return false,
      Err(mpsc::RecvTimeoutError::Timeout) => {}
    }
  };
  let epoch = first.time_100ns;
  let frame_at = |timestamp| {
    let ticks = i128::from(timestamp) - i128::from(epoch);
    let scaled = ticks * RATE as i128;
    ((scaled + scaled.signum() * 5_000_000) / 10_000_000) as i64
  };
  let started = now();
  let mut observed_end = 0;
  let mut pending = Ok(first);

  loop {
    if let Ok(packet) = &pending {
      let position = frame_at(packet.time_100ns);
      let frames = packet
        .end_time_100ns
        .and_then(|end| usize::try_from(frame_at(end) - position).ok())
        .and_then(|len| adjust_input_clock(&packet.frames, len, &mut adjusted))
        .unwrap_or(&packet.frames);
      let outcome = timeline.push(packet.member, packet.stream, position, frames);
      if outcome != MixInsert::Overflow {
        observed_end = observed_end.max(position + frames.len() as i64);
      }
      on_insert(outcome);
    }
    let finished = matches!(pending, Err(mpsc::RecvTimeoutError::Disconnected)) || stopped();
    let release_at = if finished {
      observed_end
    } else {
      let elapsed = now()
        .saturating_duration_since(started)
        .saturating_sub(DELAY);
      let due = (elapsed.as_nanos() * RATE as u128 / 1_000_000_000) as i64;
      // Independent packet cadences can wake the mixer several times within one meter block.
      // Keep the delivery rate independent of those wakes and release the short tail on stop.
      let block_frames = block.len() as i64;
      due - due % block_frames
    };
    while timeline.cursor() < release_at {
      let count = ((release_at - timeline.cursor()) as usize).min(block.len());
      let block = &mut block[..count];
      let rendered = timeline.render(block);
      on_block(block.as_flattened(), rendered);
    }
    if finished {
      break;
    }
    pending = rx.recv_timeout(POLL);
  }
  true
}

// Inputs have already been converted to the mix rate. Correct small clock offsets between
// packet boundaries. A larger timestamp jump is a real gap.
fn adjust_input_clock<'a, const N: usize>(
  frames: &[[f32; N]],
  length: usize,
  output: &'a mut Vec<[f32; N]>,
) -> Option<&'a [[f32; N]]> {
  if length < 2
    || frames.len() < 2
    || length == frames.len()
    || length.abs_diff(frames.len()) > 2 + frames.len() / 200
  {
    return None;
  }
  output.clear();
  let step = (frames.len() - 1) as f64 / (length - 1) as f64;
  output.extend((0..length).map(|index| {
    let at = index as f64 * step;
    let lower = at as usize;
    let upper = (lower + 1).min(frames.len() - 1);
    let fraction = (at - lower as f64) as f32;
    std::array::from_fn(|channel| {
      let value = frames[lower][channel];
      value + fraction * (frames[upper][channel] - value)
    })
  }));
  Some(output)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn mix_can_stop_before_any_member_delivers_pcm() {
    let (_sender, receiver) = std::sync::mpsc::sync_channel::<MixPacket>(2);
    assert!(!run_mix_timeline(
      receiver,
      2,
      || true,
      |_, _| panic!("unexpected PCM"),
      |_| panic!("unexpected drop")
    ));
  }

  #[test]
  fn interleaved_packets_keep_fixed_blocks_through_clock_drift_and_input_restart() {
    const BLOCK: usize = 480;
    const PACKETS: usize = 800;
    let position = |index| index * BLOCK + index / 10;
    let qpc = |frame: usize| 1_000_000 + ((frame as u64 * 10_000_000 + 24_000) / 48_000);
    let time = |frame: usize| Duration::from_nanos(frame as u64 * 1_000_000_000 / 48_000);
    let mut arrivals = Vec::new();
    for index in 0..=PACKETS {
      let frames = if index == PACKETS { BLOCK / 2 } else { BLOCK };
      let at = index * BLOCK;
      arrivals.push((
        time(at + index % 5 * 29),
        MixPacket {
          member: 0,
          stream: None,
          time_100ns: qpc(at),
          end_time_100ns: None,
          frames: vec![[0.25, 0.0]; frames],
        },
      ));
      if index < PACKETS && !(200..280).contains(&index) {
        let at = position(index);
        arrivals.push((
          time(at + 96 + index % 7 * 31),
          MixPacket {
            member: 1,
            stream: None,
            time_100ns: qpc(at),
            end_time_100ns: Some(qpc(position(index + 1))),
            frames: vec![[0.125, 0.5]; BLOCK],
          },
        ));
      }
    }
    arrivals.sort_by_key(|(time, _)| *time);
    let (tx, rx) = std::sync::mpsc::sync_channel(arrivals.len());
    let mut ticks = vec![Duration::ZERO];
    for (arrival, packet) in arrivals {
      ticks.push(arrival);
      tx.send(packet).unwrap();
    }
    drop(tx);
    let now = Instant::now();
    let mut ticks = ticks.into_iter();
    let mut rendered = 0;
    let mut block_sizes = Vec::new();
    assert!(run_mix_timeline_with_clock(
      rx,
      2,
      || false,
      |pcm, coverage| {
        let mut full = 0;
        let frames = pcm.as_chunks::<2>().0;
        block_sizes.push(frames.len());
        for (index, frame) in frames.iter().enumerate() {
          let at = rendered + index;
          let input = !(position(200)..position(280)).contains(&at) && at < position(PACKETS);
          assert_eq!(
            *frame,
            if input { [0.375, 0.5] } else { [0.25, 0.0] },
            "frame {at}"
          );
          full += usize::from(input);
        }
        assert_eq!(coverage.full, full);
        assert_eq!(coverage.partial, frames.len() - full);
        assert_eq!(coverage.empty, 0);
        rendered += frames.len();
      },
      |outcome| assert_eq!(outcome, MixInsert::Accepted { late_frames: 0 }),
      || now + ticks.next().unwrap(),
    ));
    let (&tail, full) = block_sizes.split_last().unwrap();
    assert!(full.iter().all(|&size| size == BLOCK));
    assert_eq!(tail, BLOCK / 2);
    assert_eq!(rendered, PACKETS * BLOCK + BLOCK / 2);
  }

  #[test]
  fn small_input_clock_correction_stretches_pcm_but_large_gaps_stay_gaps() {
    let frames = [[0.0, 1.0], [1.0, 0.0]];
    let mut adjusted = Vec::new();
    assert_eq!(
      adjust_input_clock(&frames, 3, &mut adjusted).unwrap(),
      [[0.0, 1.0], [0.5, 0.5], [1.0, 0.0]]
    );
    assert!(adjust_input_clock(&frames, 10, &mut adjusted).is_none());
  }

  #[test]
  fn keeps_mixing_through_a_missing_member_and_accepts_its_return() {
    let mut mix = StereoMixTimeline::new(2, 4);
    mix.push(0, None, 0, &[[0.75, 0.25]; 4]);
    mix.push(1, None, 0, &[[0.75, -0.25]]);
    mix.push(1, None, 2, &[[0.0, 0.0], [-0.75, -0.25]]);

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
  fn independent_streams_sum_without_counting_one_application_twice() {
    let mut mix = StereoMixTimeline::new(2, 4);
    mix.push(0, Some(10), 0, &[[0.25, 0.0]; 4]);
    mix.push(0, Some(20), 0, &[[0.0, 0.5]; 4]);
    mix.push(0, Some(20), 0, &[[0.0, 1.0]; 4]);
    mix.push(1, None, 0, &[[0.25, 0.0]; 2]);
    let mut output = [[0.0; 2]; 4];
    assert_eq!(
      mix.render(&mut output),
      MixCoverage {
        full: 2,
        partial: 2,
        empty: 0
      }
    );
    assert_eq!(output, [[0.5, 0.5], [0.5, 0.5], [0.25, 0.5], [0.25, 0.5]]);
  }

  #[test]
  fn rejects_future_overflow_and_never_replays_late_or_overlapping_samples() {
    let mut mix = StereoMixTimeline::new(2, 4);
    assert_eq!(mix.push(0, None, 4, &[[9.0, 9.0]]), MixInsert::Overflow);
    mix.push(0, None, 0, &[[1.0, 0.0]; 2]);
    assert_eq!(
      mix.push(0, None, 1, &[[9.0, 9.0], [1.0, 0.0]]),
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
      mix.push(1, None, 3, &[[9.0, 9.0], [0.0, 1.0]]),
      MixInsert::Accepted { late_frames: 1 }
    );
    assert_eq!(
      mix.push(1, None, 3, &[[9.0, 9.0], [0.0, 1.0]]),
      MixInsert::Accepted { late_frames: 0 }
    );
    mix.render(&mut output);
    assert_eq!(output, [[0.0, 1.0], [0.0; 2], [0.0; 2], [0.0; 2]]);
  }
}
