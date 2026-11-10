//! Sample-accurate Momentary and Short-term maxima.
//!
//! EBU Tech 3341 defines M and S as *sliding* rectangular windows (0.4 s and 3 s). The meters
//! report M and S every 100 ms, which is the display rate the standard asks for, but a maximum read
//! only at those instants misses a peak that falls between them: a 400 ms burst starting 40 ms off
//! the grid never fills one evaluated window and reads 0.45 dB low (Tech 3341 cases 13 and 14).
//!
//! This keeps the channel-weighted K-weighted power of every frame for the last 3 s and slides
//! both windows one frame at a time, so the maximum covers every window position. A window is
//! always its full length: before 0.4 s (or 3 s) of input, the time before the meter started reads
//! as silence, so a short file still has maxima and they are true 0.4 s and 3 s measures.
//!
//! Window lengths are whole meter blocks (4 and 30 blocks of 100 ms), so a window ending on a
//! block boundary holds exactly the samples of the block-based M and S readings.

use super::gating::lufs_from_mean_squares;

/// Window lengths in 100 ms meter blocks.
pub(crate) const M_BLOCKS: usize = 4;
pub(crate) const S_BLOCKS: usize = 30;

struct WindowLocations {
  frames: u64,
  m_frame: Option<u64>,
  s_frame: Option<u64>,
  m_global: (f64, Option<u64>),
  s_global: (f64, Option<u64>),
}

impl Default for WindowLocations {
  fn default() -> Self {
    Self {
      frames: 0,
      m_frame: None,
      s_frame: None,
      m_global: (f64::NEG_INFINITY, None),
      s_global: (f64::NEG_INFINITY, None),
    }
  }
}

fn earliest_max(old: (f64, Option<u64>), new: (f64, Option<u64>)) -> (f64, Option<u64>) {
  if new.0.is_nan() || new.0 == f64::NEG_INFINITY {
    return old;
  }
  if new.0 > old.0 || (new.0 == old.0 && new.1 < old.1) {
    new
  } else {
    old
  }
}

pub(crate) struct SlidingWindowMax {
  /// Per-frame weighted power for the last `s_len` frames. Allocated once, at construction.
  ring: Vec<f64>,
  head: usize,
  m_len: usize,
  s_len: usize,
  m_sum: f64,
  s_sum: f64,
  /// Largest window sum seen since the last `take_block_max`, or a negative value for none.
  m_max_sum: f64,
  s_max_sum: f64,
  locations: Option<Box<WindowLocations>>,
}

impl SlidingWindowMax {
  pub(crate) fn new(block_frames: usize) -> Self {
    let block_frames = block_frames.max(1);
    let s_len = S_BLOCKS * block_frames;
    Self {
      ring: vec![0.0; s_len],
      head: 0,
      m_len: M_BLOCKS * block_frames,
      s_len,
      m_sum: 0.0,
      s_sum: 0.0,
      m_max_sum: -1.0,
      s_max_sum: -1.0,
      locations: None,
    }
  }

  /// One frame's channel-weighted K-weighted power (the sum over channels of weight · y²).
  #[cfg(test)]
  pub(crate) fn push(&mut self, power: f64) {
    if self.locations.is_some() {
      self.push_mode::<true>(power);
    } else {
      self.push_mode::<false>(power);
    }
  }

  pub(crate) fn push_mode<const TRACK: bool>(&mut self, power: f64) {
    // The ring starts zeroed: until a window has seen its full length of input, the frame leaving
    // it is the silence before the meter started.
    let leaving_m = self.ring[(self.head + self.s_len - self.m_len) % self.s_len];
    let leaving_s = self.ring[self.head];
    self.m_sum += power - leaving_m;
    self.s_sum += power - leaving_s;
    self.ring[self.head] = power;
    self.head += 1;
    if self.head == self.s_len {
      self.head = 0;
    }
    if self.m_sum > self.m_max_sum {
      self.m_max_sum = self.m_sum;
      if TRACK {
        if let Some(locations) = self.locations.as_mut() {
          locations.m_frame = Some(locations.frames + 1);
        }
      }
    }
    if self.s_sum > self.s_max_sum {
      self.s_max_sum = self.s_sum;
      if TRACK {
        if let Some(locations) = self.locations.as_mut() {
          locations.s_frame = Some(locations.frames + 1);
        }
      }
    }
    if TRACK {
      if let Some(locations) = self.locations.as_mut() {
        locations.frames += 1;
      }
    }
  }

  pub(crate) fn enable_locations(&mut self) {
    self.locations = Some(Box::new(WindowLocations::default()));
  }

  pub(crate) fn maximum_locations(&self) -> (Option<u64>, Option<u64>) {
    let Some(locations) = self.locations.as_ref() else {
      return (None, None);
    };
    let (m, s) = self.peek_block_max();
    let m = earliest_max(locations.m_global, (m, locations.m_frame));
    let s = earliest_max(locations.s_global, (s, locations.s_frame));
    (
      if m.0.is_finite() { m.1 } else { None },
      if s.0.is_finite() { s.1 } else { None },
    )
  }

  /// `(max M, max S)` in LUFS over the windows that ended since the last call, `-inf` if no frame
  /// was pushed since. Starts the next block's maxima and re-sums both windows from the ring,
  /// so the running sums carry no rounding drift from one block to the next.
  pub(crate) fn take_block_max(&mut self) -> (f64, f64) {
    let max = self.peek_block_max();
    if let Some(locations) = self.locations.as_mut() {
      locations.m_global = earliest_max(locations.m_global, (max.0, locations.m_frame));
      locations.s_global = earliest_max(locations.s_global, (max.1, locations.s_frame));
      locations.m_frame = None;
      locations.s_frame = None;
    }
    self.m_max_sum = -1.0;
    self.s_max_sum = -1.0;
    self.resync();
    max
  }

  /// As `take_block_max`, without starting a new block: for a stream that ends mid-block.
  pub(crate) fn peek_block_max(&self) -> (f64, f64) {
    (
      Self::lufs(self.m_max_sum, self.m_len),
      Self::lufs(self.s_max_sum, self.s_len),
    )
  }

  fn lufs(sum: f64, len: usize) -> f64 {
    if sum < 0.0 {
      f64::NEG_INFINITY
    } else {
      lufs_from_mean_squares(sum / len as f64, 0.0)
    }
  }

  fn resync(&mut self) {
    let m_start = (self.head + self.s_len - self.m_len) % self.s_len;
    self.m_sum = (0..self.m_len)
      .map(|i| self.ring[(m_start + i) % self.s_len])
      .sum();
    self.s_sum = self.ring.iter().sum();
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Brute force: the mean of the window ending at every frame, with silence before the start.
  fn brute_max(powers: &[f64], len: usize) -> f64 {
    let padded: Vec<f64> = std::iter::repeat_n(0.0, len - 1)
      .chain(powers.iter().copied())
      .collect();
    padded
      .windows(len)
      .map(|w| w.iter().sum::<f64>() / len as f64)
      .fold(f64::NEG_INFINITY, f64::max)
  }

  #[test]
  fn maxima_match_a_brute_force_scan_of_every_window() {
    let block = 10;
    let mut seed = 0x1234_5678_u64;
    let powers: Vec<f64> = (0..2_000)
      .map(|_| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % 1_000) as f64 / 1_000.0
      })
      .collect();
    let mut sliding = SlidingWindowMax::new(block);
    let (mut m, mut s) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for chunk in powers.chunks(block) {
      for &p in chunk {
        sliding.push(p);
      }
      let (bm, bs) = sliding.take_block_max();
      m = m.max(bm);
      s = s.max(bs);
    }
    let expected_m = lufs_from_mean_squares(brute_max(&powers, M_BLOCKS * block), 0.0);
    let expected_s = lufs_from_mean_squares(brute_max(&powers, S_BLOCKS * block), 0.0);
    assert!((m - expected_m).abs() < 1e-9, "M {m} vs {expected_m}");
    assert!((s - expected_s).abs() < 1e-9, "S {s} vs {expected_s}");
  }

  #[test]
  fn a_burst_between_block_boundaries_is_found_in_full() {
    let block = 10;
    let mut sliding = SlidingWindowMax::new(block);
    // 7 frames of silence, then exactly one M window of power 1.0, then silence: no block
    // boundary lines up with the burst, yet one window position holds all of it.
    let mut m = f64::NEG_INFINITY;
    for n in 0..200 {
      sliding.push(if (7..7 + M_BLOCKS * block).contains(&n) {
        1.0
      } else {
        0.0
      });
      if (n + 1) % block == 0 {
        m = m.max(sliding.take_block_max().0);
      }
    }
    assert!(
      (m - -0.691).abs() < 1e-12,
      "full-window burst should read -0.691, got {m}"
    );
  }

  #[test]
  fn input_shorter_than_a_window_reads_against_silence_before_the_start() {
    let block = 10;
    let mut sliding = SlidingWindowMax::new(block);
    assert_eq!(
      sliding.peek_block_max(),
      (f64::NEG_INFINITY, f64::NEG_INFINITY)
    );
    // Half an M window of power 1.0: M averages it with the silence before the start, and S with
    // even more of it.
    for _ in 0..M_BLOCKS * block / 2 {
      sliding.push(1.0);
    }
    let (m, s) = sliding.peek_block_max();
    let half = lufs_from_mean_squares(0.5, 0.0);
    let s_share = lufs_from_mean_squares(M_BLOCKS as f64 / 2.0 / S_BLOCKS as f64, 0.0);
    assert!((m - half).abs() < 1e-12, "M {m} vs {half}");
    assert!((s - s_share).abs() < 1e-12, "S {s} vs {s_share}");
  }

  #[test]
  fn silence_after_loud_material_reads_silence_not_rounding_residue() {
    let block = 10;
    let mut sliding = SlidingWindowMax::new(block);
    for _ in 0..S_BLOCKS * block {
      sliding.push(1e6);
    }
    sliding.take_block_max();
    for _ in 0..2 * S_BLOCKS * block {
      sliding.push(0.0);
    }
    sliding.take_block_max();
    for _ in 0..block {
      sliding.push(0.0);
    }
    assert_eq!(
      sliding.take_block_max(),
      (f64::NEG_INFINITY, f64::NEG_INFINITY)
    );
  }
}

#[cfg(test)]
mod location_tests {
  use super::*;

  #[test]
  fn window_ends_are_exclusive_and_ties_keep_first_across_blocks() {
    let mut meter = SlidingWindowMax::new(1);
    meter.enable_locations();
    for i in 0..160 {
      meter.push(if (0..33).contains(&i) || (100..133).contains(&i) {
        1.0
      } else {
        0.0
      });
      meter.take_block_max();
    }
    assert_eq!(meter.maximum_locations(), (Some(4), Some(30)));
  }

  #[test]
  fn tail_and_zero_padded_short_windows_have_locations_but_silence_does_not() {
    let mut meter = SlidingWindowMax::new(10);
    assert!(meter.locations.is_none());
    meter.enable_locations();
    meter.push(0.0);
    assert_eq!(meter.maximum_locations(), (None, None));
    for i in 1..23 {
      meter.push(if i >= 20 { 1.0 } else { 0.0 });
      if (i + 1) % 10 == 0 {
        meter.take_block_max();
      }
    }
    assert_eq!(meter.maximum_locations(), (Some(23), Some(23)));
  }

  #[test]
  fn opt_in_metadata_leaves_shared_live_arithmetic_bit_identical() {
    let mut live = SlidingWindowMax::new(10);
    let mut file = SlidingWindowMax::new(10);
    file.enable_locations();
    let mut seed = 0x12345678_u64;
    for i in 0..5_003 {
      seed ^= seed << 13;
      seed ^= seed >> 7;
      seed ^= seed << 17;
      let power = (seed % 1000) as f64 / 1000.0;
      live.push(power);
      file.push(power);
      if (i + 1) % 10 == 0 {
        assert_eq!(live.take_block_max(), file.take_block_max());
      }
    }
    assert_eq!(live.peek_block_max(), file.peek_block_max());
    assert!(live.locations.is_none());
  }
}
