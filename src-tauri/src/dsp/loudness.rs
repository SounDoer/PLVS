//! ITU-R BS.1770 / EBU R128 style loudness (ported from `loudness-meter.js`).

use super::filters::{KWeightMono, KWeightStereo};
use super::meter::{Meter, PcmContext};
use crate::engine::ChannelLayoutSetting;

const IBL_CAP: usize = 36_000;
const STH_CAP: usize = 36_000;

fn lufs_from_mean_squares(m0: f64, m1: f64) -> f64 {
  let s = m0 + m1;
  if s <= 0.0 {
    f64::NEG_INFINITY
  } else {
    -0.691 + 10.0 * s.log10()
  }
}

fn init_true_peak_filters() -> (usize, usize, Vec<Vec<f64>>) {
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

pub struct LoudnessMeter {
  sample_rate: f64,
  kf: KWeightStereo,
  kf_mc: Vec<KWeightMono>,
  bsz: usize,
  ba: [f64; 2],
  bn: usize,
  rn: usize,
  ring: Vec<f64>,
  rh: usize,
  rc: usize,
  ibl: Vec<[f64; 2]>,
  sth: Vec<f64>,
  tp_block: f64,
  tp_block_ch: [f64; 2],
  tp_t: usize,
  tp_p: usize,
  tp_ph: Vec<Vec<f64>>,
  tp_h: [Vec<f64>; 2],
  tp_wp: [usize; 2],
  pending_block: Option<LoudnessBlock>,
}

impl LoudnessMeter {
  pub fn new(sample_rate: f64) -> Self {
    let sr = sample_rate;
    let bsz = (sr * 0.1).round() as usize;
    let rn = 60;
    let (tp_t, tp_p, tp_ph) = init_true_peak_filters();
    let tp_h = [vec![0.0_f64; tp_t], vec![0.0_f64; tp_t]];
    Self {
      sample_rate: sr,
      kf: KWeightStereo::new(sr),
      kf_mc: Vec::new(),
      bsz: bsz.max(1),
      ba: [0.0, 0.0],
      bn: 0,
      rn,
      ring: vec![0.0_f64; rn * 2],
      rh: 0,
      rc: 0,
      ibl: Vec::with_capacity(1024),
      sth: Vec::with_capacity(1024),
      tp_block: 0.0,
      tp_block_ch: [0.0, 0.0],
      tp_t,
      tp_p,
      tp_ph,
      tp_h,
      tp_wp: [0, 0],
      pending_block: None,
    }
  }

  /// Takes and returns the most recent [`LoudnessBlock`] produced since the last call.
  pub fn take_block(&mut self) -> Option<LoudnessBlock> {
    self.pending_block.take()
  }

  /// Full meter state reset (UI Clear): K-weighting blocks, gating buffers, true-peak accumulators.
  pub fn reset(&mut self) {
    let sr = self.sample_rate;
    *self = LoudnessMeter::new(sr);
  }

  fn tp_sample(&mut self, x: f64, ch: usize) -> f64 {
    let t = self.tp_t;
    let wp = self.tp_wp[ch];
    self.tp_h[ch][wp] = x;
    self.tp_wp[ch] = (wp + 1) % t;
    let mut mx = x.abs();
    for p in 1..self.tp_p {
      let ph = &self.tp_ph[p];
      let mut y = 0.0;
      for (tt, coeff) in ph.iter().enumerate().take(t) {
        let idx = (wp + t - tt) % t;
        y += coeff * self.tp_h[ch][idx];
      }
      let ay = y.abs();
      if ay > mx {
        mx = ay;
      }
    }
    mx
  }

  fn integrated(&self) -> f64 {
    if self.ibl.is_empty() {
      return f64::NEG_INFINITY;
    }
    let mut s0 = 0.0;
    let mut s1 = 0.0;
    let mut n = 0_usize;
    for x in &self.ibl {
      if lufs_from_mean_squares(x[0], x[1]) > -70.0 {
        s0 += x[0];
        s1 += x[1];
        n += 1;
      }
    }
    if n == 0 {
      return f64::NEG_INFINITY;
    }
    let ga = -0.691 + 10.0 * ((s0 / n as f64) + (s1 / n as f64)).log10() - 10.0;
    s0 = 0.0;
    s1 = 0.0;
    n = 0;
    for x in &self.ibl {
      let l = lufs_from_mean_squares(x[0], x[1]);
      if l > -70.0 && l > ga {
        s0 += x[0];
        s1 += x[1];
        n += 1;
      }
    }
    if n == 0 {
      f64::NEG_INFINITY
    } else {
      -0.691 + 10.0 * ((s0 / n as f64) + (s1 / n as f64)).log10()
    }
  }

  fn lra(&self) -> f64 {
    let h: Vec<f64> = self
      .sth
      .iter()
      .copied()
      .filter(|l| l.is_finite() && *l > -70.0)
      .collect();
    if h.len() < 2 {
      return 0.0;
    }
    let mean: f64 = h.iter().map(|l| 10_f64.powf(l / 10.0)).sum::<f64>() / h.len() as f64;
    let gr = 10.0 * mean.log10() - 20.0;
    let mut r: Vec<f64> = h.into_iter().filter(|l| *l > gr).collect();
    if r.len() < 2 {
      return 0.0;
    }
    r.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p95 = r[(r.len() as f64 * 0.95).floor() as usize].min(r[r.len() - 1]);
    let p10 = r[(r.len() as f64 * 0.1).floor() as usize];
    (p95 - p10).max(0.0)
  }

  /// Stereo samples interleaved L,R,... Returns `Some` each ~100ms with block loudness.
  pub fn push_interleaved(&mut self, interleaved_lr: &[f32]) -> Option<LoudnessBlock> {
    let mut out = None;
    let frames = interleaved_lr.len() / 2;
    for i in 0..frames {
      let xl = interleaved_lr[i * 2] as f64;
      let xr = interleaved_lr[i * 2 + 1] as f64;
      let (kwl, kwr) = self.kf.tick_lr(xl, xr);
      self.ba[0] += kwl * kwl;
      self.ba[1] += kwr * kwr;
      let tp0 = self.tp_sample(xl, 0);
      let tp1 = self.tp_sample(xr, 1);
      if tp0 > self.tp_block {
        self.tp_block = tp0;
      }
      if tp1 > self.tp_block {
        self.tp_block = tp1;
      }
      if tp0 > self.tp_block_ch[0] {
        self.tp_block_ch[0] = tp0;
      }
      if tp1 > self.tp_block_ch[1] {
        self.tp_block_ch[1] = tp1;
      }
      self.bn += 1;
      if self.bn >= self.bsz {
        let m0 = self.ba[0] / self.bn as f64;
        let m1 = self.ba[1] / self.bn as f64;
        let idx = self.rh * 2;
        self.ring[idx] = m0;
        self.ring[idx + 1] = m1;
        self.rh = (self.rh + 1) % self.rn;
        self.rc = (self.rc + 1).min(self.rn);
        self.ibl.push([m0, m1]);
        if self.ibl.len() > IBL_CAP {
          self.ibl.remove(0);
        }
        let mut a0 = 0.0;
        let mut a1 = 0.0;
        let mut an = 0_usize;
        for b in 0..4.min(self.rc) {
          let idx = ((self.rh + self.rn - 1 - b) % self.rn) * 2;
          a0 += self.ring[idx];
          a1 += self.ring[idx + 1];
          an += 1;
        }
        let momentary = if an > 0 {
          lufs_from_mean_squares(a0 / an as f64, a1 / an as f64)
        } else {
          f64::NEG_INFINITY
        };
        a0 = 0.0;
        a1 = 0.0;
        an = 0;
        for b in 0..30.min(self.rc) {
          let idx = ((self.rh + self.rn - 1 - b) % self.rn) * 2;
          a0 += self.ring[idx];
          a1 += self.ring[idx + 1];
          an += 1;
        }
        let short_term = if an > 0 {
          lufs_from_mean_squares(a0 / an as f64, a1 / an as f64)
        } else {
          f64::NEG_INFINITY
        };
        if short_term.is_finite() {
          self.sth.push(short_term);
          if self.sth.len() > STH_CAP {
            self.sth.remove(0);
          }
        }
        let tp_now = if self.tp_block > 0.0 {
          20.0 * self.tp_block.log10()
        } else {
          f64::NEG_INFINITY
        };
        let tp_now_l = if self.tp_block_ch[0] > 0.0 {
          20.0 * self.tp_block_ch[0].log10()
        } else {
          f64::NEG_INFINITY
        };
        let tp_now_r = if self.tp_block_ch[1] > 0.0 {
          20.0 * self.tp_block_ch[1].log10()
        } else {
          f64::NEG_INFINITY
        };
        out = Some(LoudnessBlock {
          momentary,
          short_term,
          integrated: self.integrated(),
          lra: self.lra(),
          true_peak: tp_now,
          true_peak_l: tp_now_l,
          true_peak_r: tp_now_r,
        });
        self.ba = [0.0, 0.0];
        self.bn = 0;
        self.tp_block = 0.0;
        self.tp_block_ch = [0.0, 0.0];
      }
    }
    out
  }

  /// BS.1770 stereo path: from **N-channel interleaved** PCM, take the first two samples per frame then `push_interleaved` (v1.0; N>2 see architecture §5).
  pub fn push_interleaved_multichannel(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    channel_layout: ChannelLayoutSetting,
  ) -> Option<LoudnessBlock> {
    let ch = channels.max(1) as usize;
    if ch == 1 {
      return self.push_mono_duplex(interleaved);
    }

    // Manual 5.1 preset: Ch1..Ch6 => FL FR C LFE SL SR.
    // Loudness aggregation per BS.1770 sums K-weighted mean-squares across channels; LFE has 0 weight.
    if channel_layout == ChannelLayoutSetting::Surround51 && ch >= 6 {
      if self.kf_mc.len() != 6 {
        self.kf_mc = (0..6).map(|_| KWeightMono::new(self.sample_rate)).collect();
      }
      let mut out = None;
      let frames = interleaved.len() / ch;
      for i in 0..frames {
        let base = i * ch;
        let mut sum_ms = 0.0_f64;
        for (ci, w) in [1.0_f64, 1.0, 1.0, 0.0, 1.0, 1.0].into_iter().enumerate() {
          let x = interleaved[base + ci] as f64;
          let kw = self.kf_mc[ci].tick(x);
          if w != 0.0 {
            sum_ms += w * kw * kw;
          }
        }
        self.ba[0] += sum_ms;
        self.ba[1] += 0.0;

        // Keep true-peak semantics consistent with the existing UI: report L/R from channels 1/2.
        let xl = interleaved[base] as f64;
        let xr = interleaved[base + 1] as f64;
        let tp0 = self.tp_sample(xl, 0);
        let tp1 = self.tp_sample(xr, 1);
        if tp0 > self.tp_block {
          self.tp_block = tp0;
        }
        if tp1 > self.tp_block {
          self.tp_block = tp1;
        }
        if tp0 > self.tp_block_ch[0] {
          self.tp_block_ch[0] = tp0;
        }
        if tp1 > self.tp_block_ch[1] {
          self.tp_block_ch[1] = tp1;
        }

        self.bn += 1;
        if self.bn >= self.bsz {
          let m0 = self.ba[0] / self.bn as f64;
          let m1 = 0.0_f64;
          let idx = self.rh * 2;
          self.ring[idx] = m0;
          self.ring[idx + 1] = m1;
          self.rh = (self.rh + 1) % self.rn;
          self.rc = (self.rc + 1).min(self.rn);
          self.ibl.push([m0, m1]);
          if self.ibl.len() > IBL_CAP {
            self.ibl.remove(0);
          }
          let mut a0 = 0.0;
          let mut a1 = 0.0;
          let mut an = 0_usize;
          for b in 0..4.min(self.rc) {
            let idx = ((self.rh + self.rn - 1 - b) % self.rn) * 2;
            a0 += self.ring[idx];
            a1 += self.ring[idx + 1];
            an += 1;
          }
          let momentary = if an > 0 {
            lufs_from_mean_squares(a0 / an as f64, a1 / an as f64)
          } else {
            f64::NEG_INFINITY
          };
          a0 = 0.0;
          a1 = 0.0;
          an = 0;
          for b in 0..30.min(self.rc) {
            let idx = ((self.rh + self.rn - 1 - b) % self.rn) * 2;
            a0 += self.ring[idx];
            a1 += self.ring[idx + 1];
            an += 1;
          }
          let short_term = if an > 0 {
            lufs_from_mean_squares(a0 / an as f64, a1 / an as f64)
          } else {
            f64::NEG_INFINITY
          };
          if short_term.is_finite() {
            self.sth.push(short_term);
            if self.sth.len() > STH_CAP {
              self.sth.remove(0);
            }
          }
          let tp_now = if self.tp_block > 0.0 {
            20.0 * self.tp_block.log10()
          } else {
            f64::NEG_INFINITY
          };
          let tp_now_l = if self.tp_block_ch[0] > 0.0 {
            20.0 * self.tp_block_ch[0].log10()
          } else {
            f64::NEG_INFINITY
          };
          let tp_now_r = if self.tp_block_ch[1] > 0.0 {
            20.0 * self.tp_block_ch[1].log10()
          } else {
            f64::NEG_INFINITY
          };
          out = Some(LoudnessBlock {
            momentary,
            short_term,
            integrated: self.integrated(),
            lra: self.lra(),
            true_peak: tp_now,
            true_peak_l: tp_now_l,
            true_peak_r: tp_now_r,
          });
          self.ba = [0.0, 0.0];
          self.bn = 0;
          self.tp_block = 0.0;
          self.tp_block_ch = [0.0, 0.0];
        }
      }
      return out;
    }

    // Manual 7.1 preset: Ch1..Ch8 => FL FR C LFE SL SR BL BR.
    // LFE (index 3) has 0 weight per BS.1770-4.
    if channel_layout == ChannelLayoutSetting::Surround71 && ch >= 8 {
      if self.kf_mc.len() != 8 {
        self.kf_mc = (0..8).map(|_| KWeightMono::new(self.sample_rate)).collect();
      }
      let mut out = None;
      let frames = interleaved.len() / ch;
      for i in 0..frames {
        let base = i * ch;
        let mut sum_ms = 0.0_f64;
        for (ci, w) in [1.0_f64, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0].into_iter().enumerate() {
          let x = interleaved[base + ci] as f64;
          let kw = self.kf_mc[ci].tick(x);
          if w != 0.0 {
            sum_ms += w * kw * kw;
          }
        }
        self.ba[0] += sum_ms;
        self.ba[1] += 0.0;

        // Keep true-peak semantics consistent with the existing UI: report L/R from channels 1/2.
        let xl = interleaved[base] as f64;
        let xr = interleaved[base + 1] as f64;
        let tp0 = self.tp_sample(xl, 0);
        let tp1 = self.tp_sample(xr, 1);
        if tp0 > self.tp_block {
          self.tp_block = tp0;
        }
        if tp1 > self.tp_block {
          self.tp_block = tp1;
        }
        if tp0 > self.tp_block_ch[0] {
          self.tp_block_ch[0] = tp0;
        }
        if tp1 > self.tp_block_ch[1] {
          self.tp_block_ch[1] = tp1;
        }

        self.bn += 1;
        if self.bn >= self.bsz {
          let m0 = self.ba[0] / self.bn as f64;
          let m1 = 0.0_f64;
          let idx = self.rh * 2;
          self.ring[idx] = m0;
          self.ring[idx + 1] = m1;
          self.rh = (self.rh + 1) % self.rn;
          self.rc = (self.rc + 1).min(self.rn);
          self.ibl.push([m0, m1]);
          if self.ibl.len() > IBL_CAP {
            self.ibl.remove(0);
          }
          let mut a0 = 0.0;
          let mut a1 = 0.0;
          let mut an = 0_usize;
          for b in 0..4.min(self.rc) {
            let idx = ((self.rh + self.rn - 1 - b) % self.rn) * 2;
            a0 += self.ring[idx];
            a1 += self.ring[idx + 1];
            an += 1;
          }
          let momentary = if an > 0 {
            lufs_from_mean_squares(a0 / an as f64, a1 / an as f64)
          } else {
            f64::NEG_INFINITY
          };
          a0 = 0.0;
          a1 = 0.0;
          an = 0;
          for b in 0..30.min(self.rc) {
            let idx = ((self.rh + self.rn - 1 - b) % self.rn) * 2;
            a0 += self.ring[idx];
            a1 += self.ring[idx + 1];
            an += 1;
          }
          let short_term = if an > 0 {
            lufs_from_mean_squares(a0 / an as f64, a1 / an as f64)
          } else {
            f64::NEG_INFINITY
          };
          if short_term.is_finite() {
            self.sth.push(short_term);
            if self.sth.len() > STH_CAP {
              self.sth.remove(0);
            }
          }
          let tp_now = if self.tp_block > 0.0 {
            20.0 * self.tp_block.log10()
          } else {
            f64::NEG_INFINITY
          };
          let tp_now_l = if self.tp_block_ch[0] > 0.0 {
            20.0 * self.tp_block_ch[0].log10()
          } else {
            f64::NEG_INFINITY
          };
          let tp_now_r = if self.tp_block_ch[1] > 0.0 {
            20.0 * self.tp_block_ch[1].log10()
          } else {
            f64::NEG_INFINITY
          };
          out = Some(LoudnessBlock {
            momentary,
            short_term,
            integrated: self.integrated(),
            lra: self.lra(),
            true_peak: tp_now,
            true_peak_l: tp_now_l,
            true_peak_r: tp_now_r,
          });
          self.ba = [0.0, 0.0];
          self.bn = 0;
          self.tp_block = 0.0;
          self.tp_block_ch = [0.0, 0.0];
        }
      }
      return out;
    }

    let frames = interleaved.len() / ch;
    if frames == 0 {
      return None;
    }
    let mut tmp = Vec::with_capacity(frames * 2);
    for f in 0..frames {
      tmp.push(interleaved[f * ch]);
      tmp.push(interleaved[f * ch + 1]);
    }
    self.push_interleaved(&tmp)
  }

  /// Mono duplicate to stereo.
  pub fn push_mono_duplex(&mut self, mono: &[f32]) -> Option<LoudnessBlock> {
    let mut tmp = Vec::with_capacity(mono.len() * 2);
    for &s in mono {
      tmp.push(s);
      tmp.push(s);
    }
    self.push_interleaved(&tmp)
  }
}

#[derive(Clone, Debug)]
pub struct LoudnessBlock {
  pub momentary: f64,
  pub short_term: f64,
  pub integrated: f64,
  pub lra: f64,
  pub true_peak: f64,
  pub true_peak_l: f64,
  pub true_peak_r: f64,
}

impl Meter for LoudnessMeter {
  fn push_pcm(&mut self, ctx: &PcmContext<'_>) {
    let block = if ctx.channels == 1 {
      self.push_mono_duplex(ctx.interleaved)
    } else {
      self.push_interleaved_multichannel(ctx.interleaved, ctx.channels, ctx.channel_layout)
    };
    if let Some(b) = block {
      self.pending_block = Some(b);
    }
  }

  fn reset(&mut self) {
    let sr = self.sample_rate;
    *self = LoudnessMeter::new(sr);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn run_once_100ms(
    m: &mut LoudnessMeter,
    interleaved: &[f32],
    channels: u16,
    layout: ChannelLayoutSetting,
  ) -> LoudnessBlock {
    m.push_interleaved_multichannel(interleaved, channels, layout)
      .expect("expected a 100ms loudness block")
  }

  #[test]
  fn manual_51_ignores_lfe_for_loudness() {
    let sr = 48_000.0;
    let frames = 4_800usize; // ~100ms
    let ch = 6usize;
    let mut pcm0 = vec![0.0_f32; frames * ch];
    let mut pcm1 = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      // FL FR C LFE SL SR
      for (ci, v) in [
        (0, 0.1_f32),
        (1, 0.1),
        (2, 0.1),
        (3, 0.0),
        (4, 0.1),
        (5, 0.1),
      ] {
        pcm0[base + ci] = v;
      }
      for (ci, v) in [
        (0, 0.1_f32),
        (1, 0.1),
        (2, 0.1),
        (3, 0.8),
        (4, 0.1),
        (5, 0.1),
      ] {
        pcm1[base + ci] = v;
      }
    }
    let mut m0 = LoudnessMeter::new(sr);
    let mut m1 = LoudnessMeter::new(sr);
    let b0 = run_once_100ms(&mut m0, &pcm0, 6, ChannelLayoutSetting::Surround51);
    let b1 = run_once_100ms(&mut m1, &pcm1, 6, ChannelLayoutSetting::Surround51);
    assert!(
      (b0.momentary - b1.momentary).abs() < 0.15,
      "LFE must not change 5.1 loudness: {} vs {}",
      b0.momentary,
      b1.momentary
    );
  }

  #[test]
  fn surround71_lufs_uses_all_channels_except_lfe() {
    // 7.1: FL FR C LFE SL SR BL BR. LFE (ch index 3) should have 0 weight.
    let sr = 48000.0_f64;
    let frames = (sr * 0.4) as usize;
    let channels = 8_usize;
    let hz = 1000.0_f64;
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32;
      for ch in 0..channels {
        pcm[i * channels + ch] = s;
      }
    }
    let mut m71 = LoudnessMeter::new(sr);
    let b71 = m71.push_interleaved_multichannel(&pcm, 8, ChannelLayoutSetting::Surround71)
      .expect("should produce a block in 0.4s");
    let mut mst = LoudnessMeter::new(sr);
    let stereo_pcm: Vec<f32> = (0..frames)
      .flat_map(|i| {
        let s = (2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32;
        [s, s]
      })
      .collect();
    let bst = mst.push_interleaved(&stereo_pcm).expect("stereo block");
    assert!(b71.momentary.is_finite(), "7.1 momentary should be finite");
    assert!(
      b71.momentary > bst.momentary,
      "7.1 with 7 active channels should be louder than stereo: {} vs {}",
      b71.momentary,
      bst.momentary
    );
  }

  #[test]
  fn surround71_lfe_has_zero_weight() {
    let sr = 48000.0_f64;
    let frames = (sr * 0.4) as usize;
    let channels = 8_usize;
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 60.0 * i as f64 / sr).sin() as f32;
      pcm[i * channels + 3] = s;
    }
    let mut m = LoudnessMeter::new(sr);
    let b = m.push_interleaved_multichannel(&pcm, 8, ChannelLayoutSetting::Surround71)
      .expect("should produce a block");
    assert!(
      !b.momentary.is_finite() || b.momentary < -70.0,
      "LFE-only 7.1 should be near silence: {}",
      b.momentary
    );
  }

  #[test]
  fn manual_51_matches_stereo_when_only_fl_fr_present() {
    let sr = 48_000.0;
    let frames = 4_800usize; // ~100ms
    let ch = 6usize;
    let mut pcm51 = vec![0.0_f32; frames * ch];
    let mut pcm2 = vec![0.0_f32; frames * 2];
    for f in 0..frames {
      let base = f * ch;
      pcm51[base] = 0.1;
      pcm51[base + 1] = -0.1;
      // other channels are silent
      pcm2[f * 2] = 0.1;
      pcm2[f * 2 + 1] = -0.1;
    }
    let mut m_st = LoudnessMeter::new(sr);
    let mut m_51 = LoudnessMeter::new(sr);
    let b_st = m_st.push_interleaved(&pcm2).expect("stereo block");
    let b_51 = run_once_100ms(&mut m_51, &pcm51, 6, ChannelLayoutSetting::Surround51);
    assert!(
      (b_st.momentary - b_51.momentary).abs() < 0.15,
      "5.1 should match stereo when only FL/FR carry signal: {} vs {}",
      b_st.momentary,
      b_51.momentary
    );
  }
}
