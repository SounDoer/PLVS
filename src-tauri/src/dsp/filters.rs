//! K-weighting IIR (BS.1770), ported from `public/worklets/loudness-meter.js`.

#[derive(Clone, Copy)]
pub struct BiquadCoeffs {
  pub b0: f64,
  pub b1: f64,
  pub b2: f64,
  pub a1: f64,
  pub a2: f64,
}

#[derive(Clone)]
pub struct Biquad {
  pub c: BiquadCoeffs,
  x1: f64,
  x2: f64,
  y1: f64,
  y2: f64,
}

impl Biquad {
  pub fn new(c: BiquadCoeffs) -> Self {
    Self {
      c,
      x1: 0.0,
      x2: 0.0,
      y1: 0.0,
      y2: 0.0,
    }
  }

  pub fn tick(&mut self, x: f64) -> f64 {
    let c = &self.c;
    let y = c.b0 * x + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
    self.x2 = self.x1;
    self.x1 = x;
    self.y2 = self.y1;
    self.y1 = y;
    y
  }
}

fn kw_coeffs(sr: f64) -> (BiquadCoeffs, BiquadCoeffs) {
  let vh = 10_f64.powf(3.999843853973347 / 20.0);
  let vb = vh.powf(0.4996667741545416);
  let f0 = 1681.974450955533_f64;
  let q1 = 0.7071752369554196_f64;
  let k1 = (std::f64::consts::PI * f0 / sr).tan();
  let d0 = 1.0 + k1 / q1 + k1 * k1;
  let s1 = BiquadCoeffs {
    b0: (vh + vb * k1 / q1 + k1 * k1) / d0,
    b1: 2.0 * (k1 * k1 - vh) / d0,
    b2: (vh - vb * k1 / q1 + k1 * k1) / d0,
    a1: 2.0 * (k1 * k1 - 1.0) / d0,
    a2: (1.0 - k1 / q1 + k1 * k1) / d0,
  };
  let f1 = 38.13547087602444_f64;
  let q2 = 0.5003270373238773_f64;
  let k2 = (std::f64::consts::PI * f1 / sr).tan();
  let d1 = 1.0 + k2 / q2 + k2 * k2;
  let s2 = BiquadCoeffs {
    b0: 1.0,
    b1: -2.0,
    b2: 1.0,
    a1: 2.0 * (k2 * k2 - 1.0) / d1,
    a2: (1.0 - k2 / q2 + k2 * k2) / d1,
  };
  (s1, s2)
}

/// Two K-weighting stages in series per channel (left/right).
pub struct KWeightStereo {
  pub l: [Biquad; 2],
  pub r: [Biquad; 2],
}

impl KWeightStereo {
  pub fn new(sample_rate: f64) -> Self {
    let (s1, s2) = kw_coeffs(sample_rate);
    let mk = || [Biquad::new(s1), Biquad::new(s2)];
    Self { l: mk(), r: mk() }
  }

  pub fn tick_lr(&mut self, x_l: f64, x_r: f64) -> (f64, f64) {
    let l0 = self.l[0].tick(x_l);
    let kl = self.l[1].tick(l0);
    let r0 = self.r[0].tick(x_r);
    let kr = self.r[1].tick(r0);
    (kl, kr)
  }
}

/// Two K-weighting stages in series for one channel.
#[derive(Clone)]
pub struct KWeightMono {
  s: [Biquad; 2],
}

impl KWeightMono {
  pub fn new(sample_rate: f64) -> Self {
    let (s1, s2) = kw_coeffs(sample_rate);
    Self {
      s: [Biquad::new(s1), Biquad::new(s2)],
    }
  }

  pub fn tick(&mut self, x: f64) -> f64 {
    let y0 = self.s[0].tick(x);
    self.s[1].tick(y0)
  }
}

/// BS.1770 True Peak measurement: build the 4× oversampling polyphase FIR bank
/// (windowed-sinc, Blackman-Harris) shared by the live and summary meters.
/// Returns `(taps_per_phase, phases, phase_coefficients)`.
pub(crate) fn init_true_peak_filters() -> (usize, usize, Vec<Vec<f64>>) {
  let p = 4_usize;
  let t = 32_usize;
  let n = p * t;
  let mut h = vec![0.0_f64; n];
  let ctr = (n - 1) as f64 / 2.0;
  for (i, hi) in h.iter_mut().enumerate().take(n) {
    let n0 = i as f64 - ctr;
    let x = n0 / p as f64;
    let sinc = if x.abs() < 1e-12 {
      1.0
    } else {
      (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x)
    };
    let bh = 0.35875 - 0.48829 * (2.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos()
      + 0.14128 * (4.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos()
      - 0.01168 * (6.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos();
    *hi = sinc * bh;
  }
  let mut tp_ph = Vec::with_capacity(p);
  for ph_idx in 0..p {
    let mut ph = vec![0.0_f64; t];
    for (tt, slot) in ph.iter_mut().enumerate().take(t) {
      *slot = h[ph_idx + tt * p];
    }
    let s: f64 = ph.iter().sum();
    if s.abs() > 1e-10 {
      for v in &mut ph {
        *v /= s;
      }
    }
    tp_ph.push(ph);
  }
  (t, p, tp_ph)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn biquad_silence_in_silence_out() {
    let c = BiquadCoeffs {
      b0: 1.0,
      b1: 0.0,
      b2: 0.0,
      a1: 0.0,
      a2: 0.0,
    };
    let mut f = Biquad::new(c);
    for _ in 0..100 {
      assert_eq!(f.tick(0.0), 0.0);
    }
  }

  #[test]
  fn biquad_unity_passthrough() {
    // All-pass: b0=1, rest 0
    let c = BiquadCoeffs {
      b0: 1.0,
      b1: 0.0,
      b2: 0.0,
      a1: 0.0,
      a2: 0.0,
    };
    let mut f = Biquad::new(c);
    assert!((f.tick(0.5) - 0.5).abs() < 1e-12);
    assert!((f.tick(-0.3) - (-0.3)).abs() < 1e-12);
  }

  #[test]
  fn kweight_stereo_silence_in_silence_out() {
    let mut kw = KWeightStereo::new(48000.0);
    for _ in 0..200 {
      let (l, r) = kw.tick_lr(0.0, 0.0);
      assert!(l.abs() < 1e-30, "expected silence, got {l}");
      assert!(r.abs() < 1e-30, "expected silence, got {r}");
    }
  }

  #[test]
  fn kweight_mono_silence_in_silence_out() {
    let mut kw = KWeightMono::new(48000.0);
    for _ in 0..200 {
      let y = kw.tick(0.0);
      assert!(y.abs() < 1e-30, "expected silence, got {y}");
    }
  }

  #[test]
  fn kweight_stereo_settles_after_impulse() {
    let mut kw = KWeightStereo::new(48000.0);
    kw.tick_lr(1.0, 1.0);
    for _ in 0..2000 {
      let (l, r) = kw.tick_lr(0.0, 0.0);
      let _ = (l, r);
    }
    let (l, r) = kw.tick_lr(0.0, 0.0);
    assert!(l.abs() < 1e-4, "filter did not settle: l={l}");
    assert!(r.abs() < 1e-4, "filter did not settle: r={r}");
  }
}
