//! Lissajous path + Pearson correlation (matches `useAudioEngine` tick).

use std::collections::VecDeque;

use super::meter::{Meter, PcmContext};

const VS_CAP: usize = 4096;

#[derive(Debug, Clone, Copy, Default)]
pub struct VectorscopeMetrics {
  pub correlation: f64,
  pub side_to_mid_db: f64,
  pub mid_energy: f64,
  pub side_energy: f64,
}

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

  /// Flatten the ring buffers and compute `(metrics, svg_path_d)`.
  pub fn get_output(&mut self) -> (VectorscopeMetrics, String) {
    if self.vs_l.is_empty() {
      return (VectorscopeMetrics::default(), String::new());
    }
    self.vs_flat_l.clear();
    self.vs_flat_r.clear();
    self.vs_flat_l.extend(self.vs_l.iter().copied());
    self.vs_flat_r.extend(self.vs_r.iter().copied());
    self.process(&self.vs_flat_l.clone(), &self.vs_flat_r.clone())
  }

  /// Returns interleaved [L0, R0, L1, R1, …] subsampled to `n` points,
  /// and the Pearson correlation coefficient.
  /// Used for visual history storage (no SVG allocation).
  pub fn get_history_pairs(&mut self, n: usize) -> (VectorscopeMetrics, Vec<f32>) {
    if self.vs_l.is_empty() || n == 0 {
      return (VectorscopeMetrics::default(), Vec::new());
    }
    self.vs_flat_l.clear();
    self.vs_flat_r.clear();
    self.vs_flat_l.extend(self.vs_l.iter().copied());
    self.vs_flat_r.extend(self.vs_r.iter().copied());

    let len = self.vs_flat_l.len().min(self.vs_flat_r.len());
    let step = (len as f64 / n as f64).max(1.0);

    let mut sum_l = 0.0_f64;
    let mut sum_r = 0.0_f64;
    let mut sum_lr = 0.0_f64;
    let mut sum_mid = 0.0_f64;
    let mut sum_side = 0.0_f64;
    let mut pairs = Vec::with_capacity(n * 2);
    let inv_sqrt2 = std::f64::consts::FRAC_1_SQRT_2;

    for i in 0..n {
      let idx = ((i as f64 * step) as usize).min(len - 1);
      let l = self.vs_flat_l[idx] as f64;
      let r = self.vs_flat_r[idx] as f64;
      sum_l += l * l;
      sum_r += r * r;
      sum_lr += l * r;
      let side = (r - l) * inv_sqrt2;
      let mid = (l + r) * inv_sqrt2;
      sum_mid += mid * mid;
      sum_side += side * side;
      pairs.push(self.vs_flat_l[idx]);
      pairs.push(self.vs_flat_r[idx]);
    }

    (
      metrics_from_sums(sum_l, sum_r, sum_lr, sum_mid, sum_side, n),
      pairs,
    )
  }

  /// Returns `(metrics, svg_path_d)` using the same geometry as the browser tick.
  fn process(&mut self, l: &[f32], r: &[f32]) -> (VectorscopeMetrics, String) {
    if l.is_empty() || r.is_empty() {
      return (VectorscopeMetrics::default(), String::new());
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
    let mut sum_mid = 0.0_f64;
    let mut sum_side = 0.0_f64;
    let mut vec_pts: Vec<String> = Vec::new();
    let mut point_count = 0usize;
    i = 0;
    while i < n {
      let lf = l[i].clamp(-1.0, 1.0) as f64;
      let rf = r[i].clamp(-1.0, 1.0) as f64;
      sum_l += lf * lf;
      sum_r += rf * rf;
      sum_lr += lf * rf;
      let side = (rf - lf) * inv_sqrt2;
      let mid = (lf + rf) * inv_sqrt2;
      sum_mid += mid * mid;
      sum_side += side * side;
      let x = vs_half + side * eff_plot_radius;
      let y = vs_half - mid * eff_plot_radius;
      vec_pts.push(format!("{x:.2} {y:.2}"));
      point_count += 1;
      i += 6;
    }
    let metrics = metrics_from_sums(sum_l, sum_r, sum_lr, sum_mid, sum_side, point_count);
    let vp = if vec_pts.is_empty() {
      String::new()
    } else {
      format!("M {}", vec_pts.join(" L "))
    };
    (metrics, vp)
  }
}

fn metrics_from_sums(
  sum_l: f64,
  sum_r: f64,
  sum_lr: f64,
  sum_mid: f64,
  sum_side: f64,
  n: usize,
) -> VectorscopeMetrics {
  let corr_den = (sum_l * sum_r).sqrt();
  let correlation = if corr_den > 1e-9 {
    (sum_lr / corr_den).clamp(-1.0, 1.0)
  } else {
    0.0
  };
  let denom = n.max(1) as f64;
  let mid_energy = (sum_mid / denom).sqrt();
  let side_energy = (sum_side / denom).sqrt();
  let side_to_mid_db = if mid_energy > 1e-9 && side_energy > 1e-9 {
    (20.0 * (side_energy / mid_energy).log10()).clamp(-48.0, 48.0)
  } else if side_energy > 1e-9 {
    48.0
  } else if mid_energy > 1e-9 {
    -48.0
  } else {
    f64::NEG_INFINITY
  };
  VectorscopeMetrics {
    correlation,
    side_to_mid_db,
    mid_energy,
    side_energy,
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
    let (metrics, path) = vs.get_output();
    assert_eq!(metrics.correlation, 0.0);
    assert!(path.is_empty());
  }

  #[test]
  fn in_phase_gives_correlation_one() {
    let signal: Vec<f32> = (0..48).map(|i| (i as f32 * 0.02).sin() * 0.5).collect();
    let mut vs = VectorscopeMeter::new();
    vs.feed_mono(&signal); // mono uses same signal for both channels
    let (metrics, path) = vs.get_output();
    assert!(
      (metrics.correlation - 1.0).abs() < 1e-6,
      "expected corr near 1.0, got {}",
      metrics.correlation
    );
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
    let (metrics, _) = vs.get_output();
    assert!(
      (metrics.correlation + 1.0).abs() < 1e-6,
      "expected corr near -1.0, got {}",
      metrics.correlation
    );
  }

  #[test]
  fn reset_clears_ring_and_extent() {
    let loud: Vec<f32> = vec![0.9; 12];
    let mut vs = VectorscopeMeter::new();
    vs.feed_mono(&loud);
    vs.reset();
    let (metrics, path) = vs.get_output();
    assert_eq!(metrics.correlation, 0.0);
    assert!(path.is_empty());
  }

  #[test]
  fn get_history_pairs_returns_n_pairs() {
    let mut vm = VectorscopeMeter::new();
    // Feed 1000 stereo frames using interleaved samples
    let l: Vec<f32> = (0..1000).map(|i| (i as f32 * 0.001).sin()).collect();
    let r: Vec<f32> = (0..1000).map(|i| (i as f32 * 0.001).cos()).collect();
    let interleaved: Vec<f32> = l.iter().zip(r.iter()).flat_map(|(&a, &b)| [a, b]).collect();
    vm.feed_interleaved(&interleaved, 2, 0, 1);
    let (_metrics, pairs) = vm.get_history_pairs(200);
    assert_eq!(pairs.len(), 400, "200 pairs = 400 f32 values");
  }
}
