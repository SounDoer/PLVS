//! Lissajous path + Pearson correlation (matches `useAudioEngine` tick).

use std::collections::VecDeque;

use super::meter::{Meter, PcmContext};

const VS_CAP: usize = 4096;

pub struct VectorscopeMeter {
  extent_hold: f64,
  pub(crate) vs_l: VecDeque<f32>,
  pub(crate) vs_r: VecDeque<f32>,
  vs_flat_l: Vec<f32>,
  vs_flat_r: Vec<f32>,
}

impl VectorscopeMeter {
  pub fn new() -> Self {
    Self {
      extent_hold: 0.02,
      vs_l: VecDeque::with_capacity(VS_CAP),
      vs_r: VecDeque::with_capacity(VS_CAP),
      vs_flat_l: Vec::with_capacity(VS_CAP),
      vs_flat_r: Vec::with_capacity(VS_CAP),
    }
  }

  fn push_pair(&mut self, l: f32, r: f32) {
    self.vs_l.push_back(l);
    self.vs_r.push_back(r);
    while self.vs_l.len() > VS_CAP {
      self.vs_l.pop_front();
      self.vs_r.pop_front();
    }
  }

  fn feed_mono(&mut self, mono: &[f32]) {
    for &s in mono {
      self.push_pair(s, s);
    }
  }

  fn feed_interleaved(&mut self, interleaved: &[f32], channels: u16, pair_x: u16, pair_y: u16) {
    let ch = channels.max(1) as usize;
    let frames = interleaved.len() / ch;
    let x = (pair_x as usize).min(ch.saturating_sub(1));
    let y = (pair_y as usize).min(ch.saturating_sub(1));
    for i in 0..frames {
      let l = interleaved[i * ch + x];
      let r = interleaved[i * ch + y];
      self.push_pair(l, r);
    }
  }

  /// Flatten the ring buffers and compute `(correlation, svg_path_d)`.
  pub fn get_output(&mut self) -> (f64, String) {
    if self.vs_l.is_empty() {
      return (0.0, String::new());
    }
    self.vs_flat_l.clear();
    self.vs_flat_r.clear();
    self.vs_flat_l.extend(self.vs_l.iter().copied());
    self.vs_flat_r.extend(self.vs_r.iter().copied());
    self.process(&self.vs_flat_l.clone(), &self.vs_flat_r.clone())
  }

  /// Returns `(correlation, svg_path_d)` using the same geometry as the browser tick.
  fn process(&mut self, l: &[f32], r: &[f32]) -> (f64, String) {
    if l.is_empty() || r.is_empty() {
      return (0.0, String::new());
    }
    let n = l.len().min(r.len());
    let inv_sqrt2 = std::f64::consts::FRAC_1_SQRT_2;
    let vs_half = 130.0_f64;
    let vs_safe_inset = 8.0_f64;
    let vs_extent_floor = 0.02_f64;
    let vs_extent_release = 0.965_f64;
    let base_plot_radius = 96.0_f64;
    let mut max_cheb = 0.0_f64;
    let mut i = 0;
    while i < n {
      let lf = l[i].clamp(-1.0, 1.0) as f64;
      let rf = r[i].clamp(-1.0, 1.0) as f64;
      let side = (rf - lf) * inv_sqrt2;
      let mid = (lf + rf) * inv_sqrt2;
      let e = side.abs().max(mid.abs());
      if e > max_cheb {
        max_cheb = e;
      }
      i += 6;
    }
    self.extent_hold *= vs_extent_release;
    if max_cheb > self.extent_hold {
      self.extent_hold = max_cheb;
    }
    self.extent_hold = self.extent_hold.max(vs_extent_floor);
    let eff_plot_radius = base_plot_radius.min((vs_half - vs_safe_inset) / self.extent_hold);
    let mut sum_l = 0.0_f64;
    let mut sum_r = 0.0_f64;
    let mut sum_lr = 0.0_f64;
    let mut vec_pts: Vec<String> = Vec::new();
    i = 0;
    while i < n {
      let lf = l[i].clamp(-1.0, 1.0) as f64;
      let rf = r[i].clamp(-1.0, 1.0) as f64;
      sum_l += lf * lf;
      sum_r += rf * rf;
      sum_lr += lf * rf;
      let side = (rf - lf) * inv_sqrt2;
      let mid = (lf + rf) * inv_sqrt2;
      let x = vs_half + side * eff_plot_radius;
      let y = vs_half - mid * eff_plot_radius;
      vec_pts.push(format!("{x:.2} {y:.2}"));
      i += 6;
    }
    let corr_den = (sum_l * sum_r).sqrt();
    let corr = if corr_den > 1e-9 {
      (sum_lr / corr_den).clamp(-1.0, 1.0)
    } else {
      0.0
    };
    let vp = if vec_pts.is_empty() {
      String::new()
    } else {
      format!("M {}", vec_pts.join(" L "))
    };
    (corr, vp)
  }
}

impl Default for VectorscopeMeter {
  fn default() -> Self {
    Self::new()
  }
}

impl Meter for VectorscopeMeter {
  fn push_pcm(&mut self, ctx: &PcmContext<'_>) {
    let (pair_x, pair_y) = ctx.vectorscope_pair;
    if ctx.channels == 1 {
      self.feed_mono(ctx.interleaved);
    } else {
      self.feed_interleaved(ctx.interleaved, ctx.channels, pair_x, pair_y);
    }
  }

  fn reset(&mut self) {
    self.extent_hold = 0.02;
    self.vs_l.clear();
    self.vs_r.clear();
    self.vs_flat_l.clear();
    self.vs_flat_r.clear();
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn empty_gives_zero_corr_and_empty_path() {
    let mut vs = VectorscopeMeter::new();
    let (corr, path) = vs.get_output();
    assert_eq!(corr, 0.0);
    assert!(path.is_empty());
  }

  #[test]
  fn in_phase_gives_correlation_one() {
    let signal: Vec<f32> = (0..48).map(|i| (i as f32 * 0.02).sin() * 0.5).collect();
    let mut vs = VectorscopeMeter::new();
    vs.feed_mono(&signal); // mono uses same signal for both channels
    let (corr, path) = vs.get_output();
    assert!((corr - 1.0).abs() < 1e-6, "expected corr≈1.0, got {corr}");
    assert!(
      path.starts_with('M'),
      "expected SVG path starting with M, got: {path}"
    );
  }

  #[test]
  fn out_of_phase_gives_correlation_minus_one() {
    let l: Vec<f32> = (0..48).map(|i| (i as f32 * 0.02).sin() * 0.5).collect();
    let r: Vec<f32> = l.iter().map(|&x| -x).collect();
    // Feed as interleaved stereo
    let interleaved: Vec<f32> = l.iter().zip(r.iter()).flat_map(|(&a, &b)| [a, b]).collect();
    let mut vs = VectorscopeMeter::new();
    vs.feed_interleaved(&interleaved, 2, 0, 1);
    let (corr, _) = vs.get_output();
    assert!((corr + 1.0).abs() < 1e-6, "expected corr≈-1.0, got {corr}");
  }

  #[test]
  fn reset_clears_ring_and_extent() {
    let loud: Vec<f32> = vec![0.9; 12];
    let mut vs = VectorscopeMeter::new();
    vs.feed_mono(&loud);
    vs.reset();
    let (corr, path) = vs.get_output();
    assert_eq!(corr, 0.0);
    assert!(path.is_empty());
  }
}
