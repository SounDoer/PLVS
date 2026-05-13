//! Lissajous path + Pearson correlation (matches `useAudioEngine` tick).

pub struct VectorscopeState {
  extent_hold: f64,
}

impl VectorscopeState {
  pub fn new() -> Self {
    Self { extent_hold: 0.02 }
  }

  pub fn reset(&mut self) {
    *self = Self::new();
  }

  /// Returns `(correlation, svg_path_d)` using the same geometry as the browser tick.
  pub fn process(&mut self, l: &[f32], r: &[f32]) -> (f64, String) {
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn empty_slices_return_zero_corr_and_empty_path() {
    let mut vs = VectorscopeState::new();
    let (corr, path) = vs.process(&[], &[]);
    assert_eq!(corr, 0.0);
    assert!(path.is_empty());
  }

  #[test]
  fn in_phase_gives_correlation_one() {
    let mut vs = VectorscopeState::new();
    let signal: Vec<f32> = (0..48).map(|i| (i as f32 * 0.02).sin() * 0.5).collect();
    let (corr, path) = vs.process(&signal, &signal);
    assert!((corr - 1.0).abs() < 1e-6, "expected corr≈1.0, got {corr}");
    assert!(path.starts_with('M'), "expected SVG path starting with M, got: {path}");
  }

  #[test]
  fn out_of_phase_gives_correlation_minus_one() {
    let mut vs = VectorscopeState::new();
    let l: Vec<f32> = (0..48).map(|i| (i as f32 * 0.02).sin() * 0.5).collect();
    let r: Vec<f32> = l.iter().map(|&x| -x).collect();
    let (corr, _) = vs.process(&l, &r);
    assert!((corr + 1.0).abs() < 1e-6, "expected corr≈-1.0, got {corr}");
  }

  #[test]
  fn silence_gives_zero_correlation_and_center_point() {
    let mut vs = VectorscopeState::new();
    let zeros = vec![0.0f32; 12];
    let (corr, path) = vs.process(&zeros, &zeros);
    assert_eq!(corr, 0.0);
    assert!(path.starts_with("M 130.00 130.00"), "expected center point, got: {path}");
  }

  #[test]
  fn reset_clears_extent_hold() {
    let mut vs = VectorscopeState::new();
    let loud: Vec<f32> = vec![0.9; 12];
    vs.process(&loud, &loud);
    vs.reset();
    let (_, path_after) = vs.process(&[0.0f32; 12], &[0.0f32; 12]);
    assert!(path_after.starts_with("M 130.00 130.00"), "reset should clear extent hold");
  }
}
