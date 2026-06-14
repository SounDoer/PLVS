pub const FFT_BIG: usize = 16384;
pub const FFT_MID: usize = 4096;
pub const FFT_SMALL: usize = 1024;
pub const XOVER_LO_HZ: f64 = 200.0;
pub const XOVER_HI_HZ: f64 = 2000.0;
pub const XFADE_HALF_OCT: f64 = 1.0 / 6.0; // crossfade half-width, octaves
pub const GRID_POINTS_PER_OCT: f64 = 96.0;
pub const POWER_AVG_FRAMES: usize = 4;
pub const OVERLAP: usize = 4; // 75% overlap → hop = size / OVERLAP

/// Fixed log-frequency render grid spanning [min_hz, max_hz] at GRID_POINTS_PER_OCT points/octave.
pub struct LogGrid {
  pub freqs: Vec<f64>,
}

impl LogGrid {
  pub fn new(min_hz: f64, max_hz: f64) -> Self {
    let lo = min_hz.max(1.0);
    let hi = max_hz.max(lo * 2.0);
    let octaves = (hi / lo).log2();
    let count = (octaves * GRID_POINTS_PER_OCT).ceil() as usize + 1;
    let mut freqs = Vec::with_capacity(count);
    for i in 0..count {
      let frac = i as f64 / (count - 1) as f64;
      freqs.push(lo * 2_f64.powf(frac * octaves));
    }
    Self { freqs }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn grid_spans_range_and_is_log_spaced() {
    let g = LogGrid::new(20.0, 20000.0);
    assert!((g.freqs[0] - 20.0).abs() < 1e-6);
    assert!((g.freqs[g.freqs.len() - 1] - 20000.0).abs() < 1e-3);
    // ~96 points/oct over ~9.97 octaves → ~958 points
    assert!(g.freqs.len() > 900 && g.freqs.len() < 1010);
    // log spacing: ratio between adjacent points is ~constant
    let r0 = g.freqs[1] / g.freqs[0];
    let r1 = g.freqs[100] / g.freqs[99];
    assert!((r0 - r1).abs() < 1e-9);
  }
}
