//! **Multi-resolution spectrum display** driven by `MultiResBank` (three windowed FFTs blended
//! at crossover frequencies). Per grid-point: weighting, 4.5 dB/oct slope tilt, 1/24-oct Gaussian
//! smoothing, attack/release envelope, and peak-hold.
//!
//! Product wording: **`docs/architecture.md` §6 Spectrum / RTA**.

use super::meter::{Meter, PcmContext};
use crate::dsp::spectrum_bank::{MultiResBank, CAL_OFFSET_DB};
use crate::dsp::SpectrumChannelSel;

fn weighting_a(f_hz: f64) -> f64 {
  let f = f_hz;
  let f2 = f * f;
  let num = 12194.0_f64.powi(2) * f2 * f2;
  let den = (f2 + 20.6_f64.powi(2))
    * ((f2 + 107.7_f64.powi(2)) * (f2 + 737.9_f64.powi(2))).sqrt()
    * (f2 + 12194.0_f64.powi(2));
  2.0 + 20.0 * (num / den.max(1e-20)).log10()
}

fn weighting_c(f_hz: f64) -> f64 {
  let f = f_hz;
  let f2 = f * f;
  let num = 12194.0_f64.powi(2) * f2;
  let den = (f2 + 20.6_f64.powi(2)) * (f2 + 12194.0_f64.powi(2));
  0.06 + 20.0 * (num / den.max(1e-20)).log10()
}

fn weighting_db(freq_hz: f64, mode: &str) -> f64 {
  let f = freq_hz.max(10.0);
  match mode {
    "a" => weighting_a(f),
    "c" => weighting_c(f),
    _ => 0.0,
  }
}

const OCTAVE_SMOOTH: f64 = 1.0 / 24.0;

/// Gaussian smoothing in the log-frequency domain; `frac_oct` ~ stddev in octaves.
fn smooth_octave(db: &[f64], freqs: &[f64], frac_oct: f64) -> Vec<f64> {
  if db.len() < 3 {
    return db.to_vec();
  }
  // Grid is uniform in log2(f); convert the octave width to a point radius.
  let pts_per_oct = 1.0 / (freqs[1].log2() - freqs[0].log2());
  let sigma = (frac_oct * pts_per_oct).max(0.5);
  let radius = (sigma * 3.0).ceil() as isize;
  let mut out = vec![0.0_f64; db.len()];
  for i in 0..db.len() {
    let mut acc = 0.0;
    let mut wsum = 0.0;
    for d in -radius..=radius {
      let j = (i as isize + d).clamp(0, db.len() as isize - 1) as usize;
      let w = (-0.5 * (d as f64 / sigma).powi(2)).exp();
      acc += db[j] * w;
      wsum += w;
    }
    out[i] = acc / wsum;
  }
  out
}

pub struct SpectrumMeter {
  bank: MultiResBank,
  last_input_channels: usize,
  smooth_db: Vec<f64>,
  peak_db: Vec<f64>,
  peak_hold_until: Vec<f64>,
  last_time_sec: f64,
  sample_rate: f64,
  weighting: String,
  attack_ms: f64,
  release_ms: f64,
  peak_hold_sec: f64,
  peak_decay_db_per_sec: f64,
  tilt_db_per_octave: f64,
  min_hz: f64,
  max_hz: f64,
  /// Cached output from the most recent FFT frame — centers, smooth dB, peak dB.
  cached_centers: Vec<f64>,
  cached_smooth: Vec<f64>,
  cached_peak: Vec<f64>,
}

impl SpectrumMeter {
  pub fn new(sample_rate: f64) -> Self {
    let min_hz = 20.0;
    let max_hz = 20000.0_f64.min(sample_rate * 0.499);
    Self {
      bank: MultiResBank::new(sample_rate, min_hz, max_hz),
      last_input_channels: 0,
      smooth_db: Vec::new(),
      peak_db: Vec::new(),
      peak_hold_until: Vec::new(),
      last_time_sec: 0.0,
      sample_rate,
      weighting: "z".to_string(),
      attack_ms: 30.0,
      release_ms: 150.0,
      peak_hold_sec: 1.5,
      peak_decay_db_per_sec: 8.0,
      tilt_db_per_octave: 4.5,
      min_hz,
      max_hz,
      cached_centers: Vec::new(),
      cached_smooth: Vec::new(),
      cached_peak: Vec::new(),
    }
  }

  /// Returns the most recently computed `(centers_hz, smooth_db, peak_db)` slices.
  pub fn last_output(&self) -> (&[f64], &[f64], &[f64]) {
    (&self.cached_centers, &self.cached_smooth, &self.cached_peak)
  }

  fn post_process(&self) -> Vec<f64> {
    let centers = self.bank.grid_freqs();
    let raw = self.bank.psd_db_row(CAL_OFFSET_DB);
    let min_f = self.min_hz.max(20.0);
    let log_min_f = min_f.log2();
    // weighting + slope
    let mut shaped = Vec::with_capacity(raw.len());
    for (i, &db) in raw.iter().enumerate() {
      let f = centers[i];
      let oct = f.max(min_f).log2() - log_min_f;
      shaped.push(db + weighting_db(f, &self.weighting) + self.tilt_db_per_octave * oct);
    }
    smooth_octave(&shaped, centers, OCTAVE_SMOOTH)
  }

  /// Returns `(smooth_db, peak_db)` for SVG paths on the frontend, or `None` until the bank is ready.
  pub fn push_interleaved(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    now_sec: f64,
  ) -> Option<(Vec<f64>, Vec<f64>)> {
    let ch = channels.max(1) as usize;
    if self.last_input_channels != ch {
      self.bank = MultiResBank::new(self.sample_rate, self.min_hz, self.max_hz);
      self.last_input_channels = ch;
      self.smooth_db.clear();
      self.peak_db.clear();
    }
    let frames = interleaved.len() / ch;
    for i in 0..frames {
      let base = i * ch;
      // Mono → that sample; stereo (and any stray >2 call) → average of the first two channels.
      // Production never calls this with >2 channels: those route through push_selected.
      let s = if ch == 1 {
        interleaved[base]
      } else {
        0.5 * (interleaved[base] + interleaved[base + 1])
      };
      self.bank.push_sample(s);
    }
    if !self.bank.ready() {
      return None;
    }
    let incoming = self.post_process();
    let delta_sec = if self.last_time_sec > 0.0 {
      (now_sec - self.last_time_sec).clamp(1.0 / 240.0, 0.25)
    } else {
      1.0 / 60.0
    };
    self.last_time_sec = now_sec;
    if self.smooth_db.len() != incoming.len() {
      self.smooth_db = incoming.clone();
      self.peak_db = incoming.clone();
      self.peak_hold_until = vec![now_sec; incoming.len()];
    }
    let atk = 1.0 - (-delta_sec / (self.attack_ms / 1000.0).max(0.001)).exp();
    let rel = 1.0 - (-delta_sec / (self.release_ms / 1000.0).max(0.001)).exp();
    for (i, &inc) in incoming.iter().enumerate() {
      let prev = self.smooth_db[i];
      let alpha = if inc > prev { atk } else { rel };
      self.smooth_db[i] = prev + (inc - prev) * alpha;
      let sm = self.smooth_db[i];
      if sm >= self.peak_db[i] {
        self.peak_db[i] = sm;
        self.peak_hold_until[i] = now_sec + self.peak_hold_sec;
      } else if now_sec > self.peak_hold_until[i] {
        self.peak_db[i] = sm.max(self.peak_db[i] - self.peak_decay_db_per_sec * delta_sec);
      }
    }
    Some((self.smooth_db.clone(), self.peak_db.clone()))
  }

  pub fn push_mono_duplex(&mut self, mono: &[f32], now_sec: f64) -> Option<(Vec<f64>, Vec<f64>)> {
    let mut tmp = Vec::with_capacity(mono.len() * 2);
    for &s in mono {
      tmp.push(s);
      tmp.push(s);
    }
    self.push_interleaved(&tmp, 2, now_sec)
  }

  /// Spectrum analysis on a specific channel pair or single channel.
  /// Synthesizes a 2-ch stereo buffer and delegates to `push_interleaved`.
  /// Returns `Option<(smooth_db, peak_db)>` — same shape as `push_interleaved`.
  pub fn push_selected(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    now_sec: f64,
    sel: SpectrumChannelSel,
  ) -> Option<(Vec<f64>, Vec<f64>)> {
    let ch = channels.max(1) as usize;
    let frames = interleaved.len() / ch;
    let mut stereo = Vec::with_capacity(frames * 2);
    for i in 0..frames {
      let base = i * ch;
      let (l, r) = match sel {
        SpectrumChannelSel::Pair(x, y) => {
          let xi = (x as usize).min(ch - 1);
          let yi = (y as usize).min(ch - 1);
          (interleaved[base + xi], interleaved[base + yi])
        }
        SpectrumChannelSel::Single(c) => {
          let ci = (c as usize).min(ch - 1);
          let s = interleaved[base + ci];
          (s, s)
        }
      };
      stereo.push(l);
      stereo.push(r);
    }
    self.push_interleaved(&stereo, 2, now_sec)
  }

  pub fn band_centers(&self) -> Vec<f64> {
    self.bank.grid_freqs().to_vec()
  }

  /// Reset FFT ring, band energies, and peak-hold (UI Clear).
  pub fn reset(&mut self) {
    let sr = self.sample_rate;
    *self = SpectrumMeter::new(sr);
  }
}

impl Meter for SpectrumMeter {
  fn push_pcm(&mut self, ctx: &PcmContext<'_>) {
    let result = if ctx.channels == 1 {
      self.push_mono_duplex(ctx.interleaved, ctx.now_sec)
    } else if ctx.channels > 2 {
      self.push_selected(
        ctx.interleaved,
        ctx.channels,
        ctx.now_sec,
        ctx.spectrum_channel,
      )
    } else {
      self.push_interleaved(ctx.interleaved, ctx.channels, ctx.now_sec)
    };
    if let Some((sm, pk)) = result {
      self.cached_centers = self.band_centers();
      self.cached_smooth = sm;
      self.cached_peak = pk;
    }
  }

  fn reset(&mut self) {
    let sr = self.sample_rate;
    *self = SpectrumMeter::new(sr);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn push_selected_pair_produces_output() {
    use crate::dsp::SpectrumChannelSel;
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    // 6-ch interleaved: 1kHz on ch0+ch1 only
    let frames = 16384 * 4;
    let channels = 6_usize;
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
      pcm[i * channels] = s;
      pcm[i * channels + 1] = s;
    }
    // Feed repeatedly until output arrives
    let mut result = None;
    for _ in 0..8 {
      result = m.push_selected(&pcm, channels as u16, 0.0, SpectrumChannelSel::Pair(0, 1));
      if result.is_some() {
        break;
      }
    }
    assert!(
      result.is_some(),
      "push_selected should produce output after filling ring"
    );
  }

  #[test]
  fn push_selected_single_channel_differs_from_silent_pair() {
    use crate::dsp::SpectrumChannelSel;
    let sr = 48000.0;
    // 6-ch: tone only on ch2 (C channel), ch0+ch1 are silent
    let frames = 16384 * 12;
    let channels = 6_usize;
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 500.0 * i as f64 / sr).sin() as f32;
      pcm[i * channels + 2] = s;
    }
    // Pair(0,1) → L+R are silent → very low/negative peak
    let mut m_lr = SpectrumMeter::new(sr);
    let mut res_lr = None;
    for _ in 0..12 {
      res_lr = m_lr.push_selected(&pcm, channels as u16, 0.0, SpectrumChannelSel::Pair(0, 1));
    }
    // Single(2) → C channel has signal → higher peak
    let mut m_c = SpectrumMeter::new(sr);
    let mut res_c = None;
    for _ in 0..12 {
      res_c = m_c.push_selected(&pcm, channels as u16, 0.0, SpectrumChannelSel::Single(2));
    }
    let (smooth_lr, _) = res_lr.expect("lr should produce output");
    let (smooth_c, _) = res_c.expect("c should produce output");
    let peak_lr = smooth_lr.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let peak_c = smooth_c.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    assert!(peak_c > peak_lr + 10.0,
      "C channel spectrum should be significantly louder than silent L/R: peak_c={:.1} peak_lr={:.1}",
      peak_c, peak_lr);
  }

  #[test]
  fn peak_hold_default_holds_then_decays() {
    let sr = 48000.0;
    let m = SpectrumMeter::new(sr);
    assert!(m.peak_hold_sec >= 1.0, "peak hold should be enabled by default, got {}", m.peak_hold_sec);
    assert!(
      m.peak_decay_db_per_sec > 0.0 && m.peak_decay_db_per_sec <= 10.0,
      "decay should be gentle, got {}",
      m.peak_decay_db_per_sec
    );
  }

  #[test]
  fn default_slope_tilts_curve_upward() {
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    // White-ish noise on both channels.
    let mut x: u32 = 0xC0FFEE;
    let frames = 16384 * 6;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      x = x.wrapping_mul(1664525).wrapping_add(1013904223);
      let s = ((x >> 8) as f32 / 8_388_608.0) - 1.0;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = s;
    }
    let mut out = None;
    for _ in 0..4 {
      out = m.push_interleaved(&pcm, 2, 1.0);
    }
    let (smooth, _) = out.expect("spectrum output");
    let centers = m.band_centers();
    let val_near = |t: f64| {
      let (i, _) = centers
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| (**a - t).abs().partial_cmp(&(**b - t).abs()).unwrap())
        .unwrap();
      smooth[i]
    };
    // White noise is flat in PSD; +4.5 dB/oct slope makes 10 kHz read clearly above 100 Hz.
    let octaves = (10000.0_f64 / 100.0).log2();
    let delta = val_near(10000.0) - val_near(100.0);
    assert!(
      delta > 4.5 * octaves * 0.6,
      "slope not applied: delta={delta}"
    );
  }
}
