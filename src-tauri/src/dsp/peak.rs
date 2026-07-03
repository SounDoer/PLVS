//! Block sample peaks and sample RMS (dBFS) from interleaved PCM.

pub struct RmsWindow {
  channels: usize,
  window_frames: usize,
  squares: Vec<f64>,
  sums: Vec<f64>,
  next_frame: usize,
  filled_frames: usize,
}

impl RmsWindow {
  pub fn new(sample_rate: u32, channels: u16, window_ms: u32) -> Self {
    let channels = channels.max(1) as usize;
    let window_frames = ((sample_rate as u64 * window_ms as u64) / 1000).max(1) as usize;
    Self {
      channels,
      window_frames,
      squares: vec![0.0; channels * window_frames],
      sums: vec![0.0; channels],
      next_frame: 0,
      filled_frames: 0,
    }
  }

  pub fn reset(&mut self) {
    self.squares.fill(0.0);
    self.sums.fill(0.0);
    self.next_frame = 0;
    self.filled_frames = 0;
  }

  pub fn push_interleaved(&mut self, interleaved: &[f32], channels: u16) {
    let ch = channels.max(1) as usize;
    if ch != self.channels {
      return;
    }

    let frames = interleaved.len() / ch;
    for frame in 0..frames {
      let slot = self.next_frame * self.channels;
      let input = frame * ch;
      for c in 0..self.channels {
        let old = self.squares[slot + c];
        let sample = interleaved[input + c] as f64;
        let square = sample * sample;
        self.squares[slot + c] = square;
        self.sums[c] += square - old;
      }
      self.next_frame = (self.next_frame + 1) % self.window_frames;
      self.filled_frames = (self.filled_frames + 1).min(self.window_frames);
    }
  }

  pub fn db_per_channel(&self) -> Vec<f64> {
    if self.filled_frames == 0 {
      return vec![f64::NEG_INFINITY; self.channels];
    }
    let denom = self.filled_frames as f64;
    self
      .sums
      .iter()
      .map(|sum| {
        let rms = (sum / denom).sqrt();
        if rms > 0.0 {
          20.0 * rms.log10()
        } else {
          f64::NEG_INFINITY
        }
      })
      .collect()
  }
}

/// Interleaved PCM: `channels` samples per frame; peak meters use **first two channels per frame** (v1.0 stereo-style; `channels==1` uses the mono path).
pub fn sample_peak_db_interleaved(interleaved: &[f32], channels: u16) -> (f64, f64) {
  let ch = channels.max(1) as usize;
  if ch == 1 {
    return sample_peak_db_mono(interleaved);
  }
  let mut ml = 0.0_f64;
  let mut mr = 0.0_f64;
  let frames = interleaved.len() / ch;
  for i in 0..frames {
    let al = interleaved[i * ch].abs() as f64;
    let ar = interleaved[i * ch + 1].abs() as f64;
    if al > ml {
      ml = al;
    }
    if ar > mr {
      mr = ar;
    }
  }
  let dl = if ml > 0.0 {
    20.0 * ml.log10()
  } else {
    f64::NEG_INFINITY
  };
  let dr = if mr > 0.0 {
    20.0 * mr.log10()
  } else {
    f64::NEG_INFINITY
  };
  (dl, dr)
}

pub fn sample_peak_db_mono(mono: &[f32]) -> (f64, f64) {
  let mut m = 0.0_f64;
  for &s in mono {
    let a = s.abs() as f64;
    if a > m {
      m = a;
    }
  }
  let d = if m > 0.0 {
    20.0 * m.log10()
  } else {
    f64::NEG_INFINITY
  };
  (d, d)
}

/// Interleaved PCM: `channels` samples per frame; returns per-channel sample peaks (dBFS).
pub fn sample_peak_db_per_channel_interleaved(interleaved: &[f32], channels: u16) -> Vec<f64> {
  let ch = channels.max(1) as usize;
  if ch == 1 {
    let (d, _) = sample_peak_db_mono(interleaved);
    return vec![d];
  }

  let frames = interleaved.len() / ch;
  let mut max_abs: Vec<f64> = vec![0.0; ch];
  for i in 0..frames {
    let base = i * ch;
    for c in 0..ch {
      let a = interleaved[base + c].abs() as f64;
      if a > max_abs[c] {
        max_abs[c] = a;
      }
    }
  }

  max_abs
    .into_iter()
    .map(|m| {
      if m > 0.0 {
        20.0 * m.log10()
      } else {
        f64::NEG_INFINITY
      }
    })
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn interleaved_stereo_uses_lr_pairs() {
    let interleaved = [0.5_f32, -0.25, 0.1, 0.9];
    let (l, r) = sample_peak_db_interleaved(&interleaved, 2);
    let el = 20.0 * 0.5_f64.log10();
    let er = 20.0 * 0.9_f64.log10();
    assert!((l - el).abs() < 1e-5, "l={l} expected ~{el}");
    assert!((r - er).abs() < 1e-5, "r={r} expected ~{er}");
  }

  #[test]
  fn interleaved_quad_first_two_channels_only() {
    // frames: (L,R,C,LFE) — peak L/R must ignore C/LFE (third/fourth sample each frame)
    let interleaved = [
      0.1_f32, 0.2, 1.0, 1.0, // frame 0: L/R small, C/LFE huge
      0.5, 0.5, 0.0, 0.0, // frame 1
    ];
    let (l, r) = sample_peak_db_interleaved(&interleaved, 4);
    let el = 20.0 * 0.5_f64.log10();
    assert!((l - el).abs() < 1e-5);
    assert!((r - el).abs() < 1e-5);
  }

  #[test]
  fn mono_duplex_matches_interleaved_ch1() {
    let mono = [0.25_f32, -0.4];
    let (a, b) = sample_peak_db_interleaved(&mono, 1);
    let (c, d) = sample_peak_db_mono(&mono);
    assert_eq!((a, b), (c, d));
  }

  #[test]
  fn per_channel_peaks_match_stereo_lr() {
    let interleaved = [0.5_f32, -0.25, 0.1, 0.9];
    let (l, r) = sample_peak_db_interleaved(&interleaved, 2);
    let v = sample_peak_db_per_channel_interleaved(&interleaved, 2);
    assert_eq!(v.len(), 2);
    assert!((v[0] - l).abs() < 1e-5);
    assert!((v[1] - r).abs() < 1e-5);
  }

  #[test]
  fn per_channel_peaks_include_all_channels() {
    // frame0: (L,R,C,LFE) have distinct peaks; frame1 is zeros
    let interleaved = [0.1_f32, 0.2, 0.3, 0.4, 0.0, 0.0, 0.0, 0.0];
    let v = sample_peak_db_per_channel_interleaved(&interleaved, 4);
    assert_eq!(v.len(), 4);
    let e0 = 20.0 * 0.1_f64.log10();
    let e1 = 20.0 * 0.2_f64.log10();
    let e2 = 20.0 * 0.3_f64.log10();
    let e3 = 20.0 * 0.4_f64.log10();
    assert!((v[0] - e0).abs() < 1e-5);
    assert!((v[1] - e1).abs() < 1e-5);
    assert!((v[2] - e2).abs() < 1e-5);
    assert!((v[3] - e3).abs() < 1e-5);
  }

  #[test]
  fn rms_window_reports_per_channel_unweighted_rms() {
    let mut rms = RmsWindow::new(10, 2, 400);
    rms.push_interleaved(&[1.0, 0.5, -1.0, -0.5, 1.0, 0.5, -1.0, -0.5], 2);
    let db = rms.db_per_channel();
    assert_eq!(db.len(), 2);
    assert!((db[0] - 0.0).abs() < 1e-8);
    assert!((db[1] - (20.0 * 0.5_f64.log10())).abs() < 1e-8);
  }

  #[test]
  fn rms_window_slides_over_recent_frames() {
    let mut rms = RmsWindow::new(10, 1, 400);
    rms.push_interleaved(&[1.0, 1.0, 1.0, 1.0], 1);
    rms.push_interleaved(&[0.0, 0.0, 0.0, 0.0], 1);
    assert_eq!(rms.db_per_channel()[0], f64::NEG_INFINITY);
  }
}
