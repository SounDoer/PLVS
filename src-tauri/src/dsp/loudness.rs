//! ITU-R BS.1770 / EBU R128 style loudness (ported from `loudness-meter.js`).

use super::dialogue::DialogueIntegrator;
use super::filters::{KWeightMono, KWeightStereo};
use super::meter::{Meter, PcmContext};
use super::speech::{downmix_to_mono, SpeechDetector};
use crate::engine::ChannelLayoutSetting;

const IBL_CAP: usize = 36_000;
const STH_CAP: usize = 36_000;
const SURROUND_LOUDNESS_WEIGHT: f64 = 1.412_537_544_622_754_4;

pub(crate) fn lufs_from_mean_squares(m0: f64, m1: f64) -> f64 {
  let s = m0 + m1;
  if s <= 0.0 {
    f64::NEG_INFINITY
  } else {
    -0.691 + 10.0 * s.log10()
  }
}

/// EBU R128 loudness range (LRA) over a set of short-term loudness values (LUFS):
/// −70 absolute gate, then a relative gate at mean − 20 LU, then p95 − p10. `0.0` when
/// there are too few qualifying samples.
pub(crate) fn gated_lra(short_terms: &[f64]) -> f64 {
  let h: Vec<f64> = short_terms
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

/// BS.1770 two-pass gated integrated loudness over a set of mean-square blocks.
/// First pass: −70 LUFS absolute gate to compute a relative threshold (mean − 10 LU).
/// Second pass: keep blocks above both gates and average. `NEG_INFINITY` if none qualify.
pub(crate) fn gated_integrated_lufs(blocks: &[[f64; 2]]) -> f64 {
  if blocks.is_empty() {
    return f64::NEG_INFINITY;
  }
  let mut s0 = 0.0;
  let mut s1 = 0.0;
  let mut n = 0_usize;
  for x in blocks {
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
  for x in blocks {
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
  /// Speech detector for dialogue gating; lazily built on first gated push (`None` until then,
  /// or if model init fails).
  speech: Option<SpeechDetector>,
  /// Dialogue-gated loudness accumulator.
  dialogue: DialogueIntegrator,
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
      speech: None,
      dialogue: DialogueIntegrator::new(),
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

  /// Reset only the dialogue accumulators + speech detector buffers (gating toggle), not main loudness.
  pub fn reset_dialogue(&mut self) {
    self.dialogue.reset();
    if let Some(det) = self.speech.as_mut() {
      det.reset();
    }
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
    gated_integrated_lufs(&self.ibl)
  }

  fn lra(&self) -> f64 {
    gated_lra(&self.sth)
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
          dialogue_integrated: LoudnessBlock::DIALOGUE_OFF.0,
          dialogue_lra: LoudnessBlock::DIALOGUE_OFF.1,
          dialogue_percent: LoudnessBlock::DIALOGUE_OFF.2,
        });
        self.ba = [0.0, 0.0];
        self.bn = 0;
        self.tp_block = 0.0;
        self.tp_block_ch = [0.0, 0.0];
      }
    }
    out
  }

  pub fn push_interleaved_weighted(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    weights: &[f64],
  ) -> Option<LoudnessBlock> {
    let ch = channels.max(1) as usize;
    if weights.len() != ch {
      return self.push_interleaved_multichannel(interleaved, channels, ChannelLayoutSetting::Auto);
    }
    if ch == 1 {
      let scaled: Vec<f32> = interleaved
        .iter()
        .map(|s| (*s as f64 * weights[0].sqrt()) as f32)
        .collect();
      return self.push_mono_duplex(&scaled);
    }
    if self.kf_mc.len() != ch {
      self.kf_mc = (0..ch)
        .map(|_| KWeightMono::new(self.sample_rate))
        .collect();
    }
    let mut out = None;
    let frames = interleaved.len() / ch;
    for i in 0..frames {
      let base = i * ch;
      let mut sum_ms = 0.0_f64;
      for (ci, weight) in weights.iter().copied().enumerate() {
        if weight == 0.0 {
          continue;
        }
        let x = interleaved[base + ci] as f64;
        let kw = self.kf_mc[ci].tick(x);
        sum_ms += weight * kw * kw;
      }
      self.ba[0] += sum_ms;
      self.ba[1] += 0.0;

      // Keep true-peak semantics consistent with the existing UI: report L/R from channels 1/2.
      let xl = interleaved[base] as f64;
      let xr = if ch > 1 {
        interleaved[base + 1] as f64
      } else {
        xl
      };
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
          dialogue_integrated: LoudnessBlock::DIALOGUE_OFF.0,
          dialogue_lra: LoudnessBlock::DIALOGUE_OFF.1,
          dialogue_percent: LoudnessBlock::DIALOGUE_OFF.2,
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

    // Auto 5.0: Ch1..Ch5 => FL FR C SL SR. Same order as 5.1 without the LFE slot.
    if channel_layout == ChannelLayoutSetting::Auto && ch == 5 {
      return self.push_interleaved_weighted(
        interleaved,
        channels,
        &[
          1.0,
          1.0,
          1.0,
          SURROUND_LOUDNESS_WEIGHT,
          SURROUND_LOUDNESS_WEIGHT,
        ],
      );
    }

    // Auto 7.0: Ch1..Ch7 => FL FR C SL SR BL BR. Same order as 7.1 without the LFE slot.
    if channel_layout == ChannelLayoutSetting::Auto && ch == 7 {
      return self.push_interleaved_weighted(
        interleaved,
        channels,
        &[
          1.0,
          1.0,
          1.0,
          SURROUND_LOUDNESS_WEIGHT,
          SURROUND_LOUDNESS_WEIGHT,
          SURROUND_LOUDNESS_WEIGHT,
          SURROUND_LOUDNESS_WEIGHT,
        ],
      );
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
        for (ci, w) in [
          1.0_f64,
          1.0,
          1.0,
          0.0,
          SURROUND_LOUDNESS_WEIGHT,
          SURROUND_LOUDNESS_WEIGHT,
        ]
        .into_iter()
        .enumerate()
        {
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
            dialogue_integrated: LoudnessBlock::DIALOGUE_OFF.0,
            dialogue_lra: LoudnessBlock::DIALOGUE_OFF.1,
            dialogue_percent: LoudnessBlock::DIALOGUE_OFF.2,
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
        for (ci, w) in [
          1.0_f64,
          1.0,
          1.0,
          0.0,
          SURROUND_LOUDNESS_WEIGHT,
          SURROUND_LOUDNESS_WEIGHT,
          SURROUND_LOUDNESS_WEIGHT,
          SURROUND_LOUDNESS_WEIGHT,
        ]
        .into_iter()
        .enumerate()
        {
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
            dialogue_integrated: LoudnessBlock::DIALOGUE_OFF.0,
            dialogue_lra: LoudnessBlock::DIALOGUE_OFF.1,
            dialogue_percent: LoudnessBlock::DIALOGUE_OFF.2,
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
  /// Dialogue-gated integrated loudness (LUFS); `NEG_INFINITY` when gating off or no speech.
  pub dialogue_integrated: f64,
  /// Dialogue-gated loudness range (LU); `0.0` when gating off or insufficient speech.
  pub dialogue_lra: f64,
  /// Percentage of audible program classified as dialogue; `0.0` when gating off.
  pub dialogue_percent: f64,
}

impl LoudnessBlock {
  /// Default dialogue fields for blocks produced with gating off.
  const DIALOGUE_OFF: (f64, f64, f64) = (f64::NEG_INFINITY, 0.0, 0.0);
}

impl Meter for LoudnessMeter {
  fn push_pcm(&mut self, ctx: &PcmContext<'_>) {
    // Feed the speech sidechain continuously (downmixed mono) so its 16 kHz chunks keep
    // flowing regardless of which loudness path runs below.
    if ctx.dialogue_gating {
      if self.speech.is_none() {
        self.speech = SpeechDetector::new(self.sample_rate);
      }
      if let Some(det) = self.speech.as_mut() {
        let mono = downmix_to_mono(ctx.interleaved, ctx.channels);
        det.push_mono(&mono);
      }
    }

    let block = if let Some(weights) = ctx.loudness_weights.as_ref() {
      if weights.len() == ctx.channels.max(1) as usize {
        self.push_interleaved_weighted(ctx.interleaved, ctx.channels, weights)
      } else if ctx.channels == 1 {
        self.push_mono_duplex(ctx.interleaved)
      } else {
        self.push_interleaved_multichannel(ctx.interleaved, ctx.channels, ctx.channel_layout)
      }
    } else if ctx.channels == 1 {
      self.push_mono_duplex(ctx.interleaved)
    } else {
      self.push_interleaved_multichannel(ctx.interleaved, ctx.channels, ctx.channel_layout)
    };
    if let Some(mut b) = block {
      // A block just closed: settle its speech verdict and fold it into the dialogue readouts.
      if ctx.dialogue_gating {
        let ms = self.ibl.last().copied().unwrap_or([0.0, 0.0]);
        let is_speech = self
          .speech
          .as_mut()
          .map(|det| det.take_block_decision())
          .unwrap_or(false);
        self.dialogue.push_block(ms, b.short_term, is_speech);
        b.dialogue_integrated = self.dialogue.integrated();
        b.dialogue_lra = self.dialogue.lra();
        b.dialogue_percent = self.dialogue.percent();
      }
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
  use crate::dsp::channel_sel::SpectrumChannelSel;

  fn dialogue_ctx<'a>(interleaved: &'a [f32], channels: u16) -> PcmContext<'a> {
    PcmContext {
      interleaved,
      channels,
      now_sec: 0.0,
      channel_layout: ChannelLayoutSetting::Auto,
      loudness_weights: None,
      vectorscope_pair: (0, 1),
      spectrum_channel: SpectrumChannelSel::default(),
      dialogue_gating: true,
    }
  }

  // End-to-end wiring smoke test: with gating on, a non-speech tone flows through
  // downmix→resample→Silero→vote→dialogue integrator without panicking and is not counted
  // as dialogue (a pure tone is not speech). The speech-positive path is verified manually.
  #[test]
  fn gated_push_pcm_runs_and_tone_is_not_dialogue() {
    let sr = 48_000.0;
    let frames = 4_800usize; // one 100ms block
    let stereo: Vec<f32> = (0..frames)
      .flat_map(|i| {
        let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32 * 0.5;
        [s, s]
      })
      .collect();

    let mut m = LoudnessMeter::new(sr);
    m.push_pcm(&dialogue_ctx(&stereo, 2));
    let block = m.take_block().expect("a 100ms block should close");

    assert!(
      block.momentary.is_finite(),
      "tone should yield finite momentary"
    );
    assert_eq!(
      block.dialogue_percent, 0.0,
      "a pure tone must not register as dialogue"
    );
    assert!(
      !block.dialogue_integrated.is_finite(),
      "no speech blocks → dialogue integrated stays -inf, got {}",
      block.dialogue_integrated
    );
  }

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
  fn dynamic_weights_ignore_lfe_channel() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 3usize;
    let mut pcm = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      pcm[base] = 0.1;
      pcm[base + 1] = 0.1;
      pcm[base + 2] = 0.8;
    }

    let weights_without_lfe = vec![1.0, 1.0, 0.0];
    let weights_with_lfe = vec![1.0, 1.0, 1.0];

    let mut a = LoudnessMeter::new(sr);
    let mut b = LoudnessMeter::new(sr);
    let block_a = a
      .push_interleaved_weighted(&pcm, ch as u16, &weights_without_lfe)
      .expect("weighted block");
    let block_b = b
      .push_interleaved_weighted(&pcm, ch as u16, &weights_with_lfe)
      .expect("weighted block");

    assert!(
      block_b.momentary > block_a.momentary + 3.0,
      "including LFE channel should be much louder than zero-weighting it: {} vs {}",
      block_b.momentary,
      block_a.momentary
    );
  }

  #[test]
  fn dynamic_surround_weight_increases_loudness_against_unity() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 1usize;
    let pcm = vec![0.1_f32; frames * ch];
    let surround_weight = 10_f64.powf(1.5 / 10.0);

    let mut unity = LoudnessMeter::new(sr);
    let mut surround = LoudnessMeter::new(sr);
    let block_unity = unity
      .push_interleaved_weighted(&pcm, ch as u16, &[1.0])
      .expect("unity weighted block");
    let block_surround = surround
      .push_interleaved_weighted(&pcm, ch as u16, &[surround_weight])
      .expect("surround weighted block");

    assert!(
      (block_surround.momentary - block_unity.momentary - 1.5).abs() < 0.2,
      "surround gain should be about +1.5 dB: {} vs {}",
      block_surround.momentary,
      block_unity.momentary
    );
  }

  #[test]
  fn auto_50_matches_standard_surround_weights() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 5usize;
    let mut pcm = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      pcm[base + 3] = 0.1;
      pcm[base + 4] = 0.1;
    }
    let surround_weight = 10_f64.powf(1.5 / 10.0);

    let mut auto = LoudnessMeter::new(sr);
    let mut standard = LoudnessMeter::new(sr);
    let auto_block = auto
      .push_interleaved_multichannel(&pcm, ch as u16, ChannelLayoutSetting::Auto)
      .expect("5.0 auto block");
    let standard_block = standard
      .push_interleaved_weighted(
        &pcm,
        ch as u16,
        &[1.0, 1.0, 1.0, surround_weight, surround_weight],
      )
      .expect("5.0 standard block");

    assert!(
      (auto_block.momentary - standard_block.momentary).abs() < 0.15,
      "5.0 auto should use standard surround weights: {} vs {}",
      auto_block.momentary,
      standard_block.momentary
    );
  }

  #[test]
  fn hardcoded_51_matches_standard_surround_weights() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 6usize;
    let mut pcm = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      pcm[base + 4] = 0.1;
      pcm[base + 5] = 0.1;
    }
    let surround_weight = 10_f64.powf(1.5 / 10.0);

    let mut hardcoded = LoudnessMeter::new(sr);
    let mut standard = LoudnessMeter::new(sr);
    let hardcoded_block = hardcoded
      .push_interleaved_multichannel(&pcm, ch as u16, ChannelLayoutSetting::Surround51)
      .expect("5.1 hardcoded block");
    let standard_block = standard
      .push_interleaved_weighted(
        &pcm,
        ch as u16,
        &[1.0, 1.0, 1.0, 0.0, surround_weight, surround_weight],
      )
      .expect("5.1 standard block");

    assert!(
      (hardcoded_block.momentary - standard_block.momentary).abs() < 0.15,
      "5.1 hardcoded should use standard surround weights: {} vs {}",
      hardcoded_block.momentary,
      standard_block.momentary
    );
  }

  #[test]
  fn auto_70_matches_standard_surround_weights() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 7usize;
    let mut pcm = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      pcm[base + 3] = 0.1;
      pcm[base + 4] = 0.1;
      pcm[base + 5] = 0.1;
      pcm[base + 6] = 0.1;
    }
    let surround_weight = 10_f64.powf(1.5 / 10.0);

    let mut auto = LoudnessMeter::new(sr);
    let mut standard = LoudnessMeter::new(sr);
    let auto_block = auto
      .push_interleaved_multichannel(&pcm, ch as u16, ChannelLayoutSetting::Auto)
      .expect("7.0 auto block");
    let standard_block = standard
      .push_interleaved_weighted(
        &pcm,
        ch as u16,
        &[
          1.0,
          1.0,
          1.0,
          surround_weight,
          surround_weight,
          surround_weight,
          surround_weight,
        ],
      )
      .expect("7.0 standard block");

    assert!(
      (auto_block.momentary - standard_block.momentary).abs() < 0.15,
      "7.0 auto should use standard surround weights: {} vs {}",
      auto_block.momentary,
      standard_block.momentary
    );
  }

  #[test]
  fn hardcoded_71_matches_standard_surround_weights() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 8usize;
    let mut pcm = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      pcm[base + 4] = 0.1;
      pcm[base + 5] = 0.1;
      pcm[base + 6] = 0.1;
      pcm[base + 7] = 0.1;
    }
    let surround_weight = 10_f64.powf(1.5 / 10.0);

    let mut hardcoded = LoudnessMeter::new(sr);
    let mut standard = LoudnessMeter::new(sr);
    let hardcoded_block = hardcoded
      .push_interleaved_multichannel(&pcm, ch as u16, ChannelLayoutSetting::Surround71)
      .expect("7.1 hardcoded block");
    let standard_block = standard
      .push_interleaved_weighted(
        &pcm,
        ch as u16,
        &[
          1.0,
          1.0,
          1.0,
          0.0,
          surround_weight,
          surround_weight,
          surround_weight,
          surround_weight,
        ],
      )
      .expect("7.1 standard block");

    assert!(
      (hardcoded_block.momentary - standard_block.momentary).abs() < 0.15,
      "7.1 hardcoded should use standard surround weights: {} vs {}",
      hardcoded_block.momentary,
      standard_block.momentary
    );
  }

  #[test]
  fn auto_50_uses_surround_channels_for_loudness() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 5usize;
    let mut pcm = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      pcm[base + 3] = 0.1;
      pcm[base + 4] = 0.1;
    }

    let mut meter = LoudnessMeter::new(sr);
    let block = meter
      .push_interleaved_multichannel(&pcm, ch as u16, ChannelLayoutSetting::Auto)
      .expect("5.0 block");

    assert!(
      block.momentary.is_finite() && block.momentary > -70.0,
      "5.0 auto loudness should include surround channels, got {}",
      block.momentary
    );
  }

  #[test]
  fn auto_70_uses_back_channels_for_loudness() {
    let sr = 48_000.0;
    let frames = 4_800usize;
    let ch = 7usize;
    let mut pcm = vec![0.0_f32; frames * ch];
    for f in 0..frames {
      let base = f * ch;
      pcm[base + 5] = 0.1;
      pcm[base + 6] = 0.1;
    }

    let mut meter = LoudnessMeter::new(sr);
    let block = meter
      .push_interleaved_multichannel(&pcm, ch as u16, ChannelLayoutSetting::Auto)
      .expect("7.0 block");

    assert!(
      block.momentary.is_finite() && block.momentary > -70.0,
      "7.0 auto loudness should include back channels, got {}",
      block.momentary
    );
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
    let b71 = m71
      .push_interleaved_multichannel(&pcm, 8, ChannelLayoutSetting::Surround71)
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
    let b = m
      .push_interleaved_multichannel(&pcm, 8, ChannelLayoutSetting::Surround71)
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
