//! **Multi-resolution spectrum display** driven by `MultiResBank` (three windowed FFTs blended
//! at crossover frequencies). Per grid-point: weighting, 4.5 dB/oct slope tilt (pivoted at 1 kHz),
//! attack/release envelope, and peak-hold. No octave smoothing — peaks stay sharp and tone levels
//! read at their true dBFS (SPAN-style); time stability comes from the bank's power averaging.
//!
//! Product wording: **`docs/architecture.md` §6 Spectrum / RTA**.

use super::meter::{Meter, PcmContext};
use crate::dsp::spectrum_bank::{MultiResBank, CAL_OFFSET_DB};
use crate::dsp::{SpectrumChannelSel, SpectrumView};

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

const SLOPE_PIVOT_HZ: f64 = 1000.0;

/// Apply attack/release smoothing + peak-hold for one bank's incoming dB row.
#[allow(clippy::too_many_arguments)]
fn apply_envelope(
  incoming: &[f64],
  smooth: &mut Vec<f64>,
  peak: &mut Vec<f64>,
  hold_until: &mut Vec<f64>,
  now_sec: f64,
  delta_sec: f64,
  attack_ms: f64,
  release_ms: f64,
  peak_hold_sec: f64,
  peak_decay_db_per_sec: f64,
) {
  if attack_ms <= 0.0 && release_ms <= 0.0 {
    *smooth = incoming.to_vec();
    if peak.len() != incoming.len() {
      *peak = incoming.to_vec();
      *hold_until = vec![now_sec; incoming.len()];
    }
    for (i, &sm) in smooth.iter().enumerate() {
      if sm >= peak[i] {
        peak[i] = sm;
        hold_until[i] = now_sec + peak_hold_sec;
      } else if now_sec > hold_until[i] {
        peak[i] = sm.max(peak[i] - peak_decay_db_per_sec * delta_sec);
      }
    }
    return;
  }
  if smooth.len() != incoming.len() {
    *smooth = incoming.to_vec();
    *peak = incoming.to_vec();
    *hold_until = vec![now_sec; incoming.len()];
    return;
  }
  let atk = 1.0 - (-delta_sec / (attack_ms / 1000.0).max(0.001)).exp();
  let rel = 1.0 - (-delta_sec / (release_ms / 1000.0).max(0.001)).exp();
  for (i, &inc) in incoming.iter().enumerate() {
    let prev = smooth[i];
    let alpha = if inc > prev { atk } else { rel };
    smooth[i] = prev + (inc - prev) * alpha;
    let sm = smooth[i];
    if sm >= peak[i] {
      peak[i] = sm;
      hold_until[i] = now_sec + peak_hold_sec;
    } else if now_sec > hold_until[i] {
      peak[i] = sm.max(peak[i] - peak_decay_db_per_sec * delta_sec);
    }
  }
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
  analysis_average_sec: f64,
  min_hz: f64,
  max_hz: f64,
  /// Cached output from the most recent FFT frame — centers, smooth dB, peak dB.
  cached_centers: Vec<f64>,
  cached_smooth: Vec<f64>,
  cached_peak: Vec<f64>,
  /// Secondary curve state (only used for Lr/Ms views).
  bank_b: Option<MultiResBank>,
  smooth_db_b: Vec<f64>,
  peak_db_b: Vec<f64>,
  peak_hold_until_b: Vec<f64>,
  cached_smooth_b: Vec<f64>,
  cached_peak_b: Vec<f64>,
  has_secondary: bool,
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
      analysis_average_sec: MultiResBank::analysis_average_sec_for_smoothing_percent(50.0),
      min_hz,
      max_hz,
      cached_centers: Vec::new(),
      cached_smooth: Vec::new(),
      cached_peak: Vec::new(),
      bank_b: None,
      smooth_db_b: Vec::new(),
      peak_db_b: Vec::new(),
      peak_hold_until_b: Vec::new(),
      cached_smooth_b: Vec::new(),
      cached_peak_b: Vec::new(),
      has_secondary: false,
    }
  }

  pub fn smoothing_times_ms_for_percent(percent: f64) -> (f64, f64) {
    let p = percent.clamp(0.0, 100.0);
    if p <= 0.0 {
      return (0.0, 0.0);
    }
    let normalized = p / 100.0;
    let exponent = (15.0_f64.log10() / 200.0_f64.log10()).ln() / 0.5_f64.ln();
    let release_ms = 10.0 * 200.0_f64.powf(normalized.powf(exponent));
    let attack_ms = release_ms * 0.2;
    (attack_ms, release_ms)
  }

  pub fn set_display_controls(&mut self, smoothing_percent: f64, tilt_db_per_octave: f64) {
    let (attack_ms, release_ms) = Self::smoothing_times_ms_for_percent(smoothing_percent);
    let analysis_average_sec =
      MultiResBank::analysis_average_sec_for_smoothing_percent(smoothing_percent);
    self.attack_ms = attack_ms;
    self.release_ms = release_ms;
    self.tilt_db_per_octave = tilt_db_per_octave.clamp(0.0, 6.0);
    self.analysis_average_sec = analysis_average_sec;
    self.bank.set_analysis_average_sec(analysis_average_sec);
    if let Some(bank_b) = self.bank_b.as_mut() {
      bank_b.set_analysis_average_sec(analysis_average_sec);
    }
  }

  /// Returns the most recently computed `(centers_hz, smooth_db, peak_db)` slices.
  pub fn last_output(&self) -> (&[f64], &[f64], &[f64]) {
    (&self.cached_centers, &self.cached_smooth, &self.cached_peak)
  }

  fn post_process_for(&self, bank: &MultiResBank) -> Vec<f64> {
    let centers = bank.grid_freqs();
    let raw = bank.psd_db_row(CAL_OFFSET_DB);
    let log_pivot = SLOPE_PIVOT_HZ.log2();
    let mut shaped = Vec::with_capacity(raw.len());
    for (i, &db) in raw.iter().enumerate() {
      let f = centers[i];
      let oct = f.log2() - log_pivot;
      shaped.push(db + weighting_db(f, &self.weighting) + self.tilt_db_per_octave * oct);
    }
    shaped
  }

  fn post_process(&self) -> Vec<f64> {
    self.post_process_for(&self.bank)
  }

  fn reset_primary_bank_for_input_channels(&mut self, ch: usize) {
    if self.last_input_channels != ch {
      self.bank = MultiResBank::new(self.sample_rate, self.min_hz, self.max_hz);
      self
        .bank
        .set_analysis_average_sec(self.analysis_average_sec);
      self.last_input_channels = ch;
      self.smooth_db.clear();
      self.peak_db.clear();
    }
  }

  fn finish_primary_push(&mut self, now_sec: f64) -> Option<(Vec<f64>, Vec<f64>)> {
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
    apply_envelope(
      &incoming,
      &mut self.smooth_db,
      &mut self.peak_db,
      &mut self.peak_hold_until,
      now_sec,
      delta_sec,
      self.attack_ms,
      self.release_ms,
      self.peak_hold_sec,
      self.peak_decay_db_per_sec,
    );
    Some((self.smooth_db.clone(), self.peak_db.clone()))
  }

  /// Returns `(smooth_db, peak_db)` for SVG paths on the frontend, or `None` until the bank is ready.
  #[cfg(test)]
  pub fn push_interleaved(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    now_sec: f64,
  ) -> Option<(Vec<f64>, Vec<f64>)> {
    let ch = channels.max(1) as usize;
    self.reset_primary_bank_for_input_channels(ch);
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
    self.finish_primary_push(now_sec)
  }

  pub fn push_mono_duplex(&mut self, mono: &[f32], now_sec: f64) -> Option<(Vec<f64>, Vec<f64>)> {
    self.reset_primary_bank_for_input_channels(2);
    for &s in mono {
      self.bank.push_sample(s);
    }
    self.finish_primary_push(now_sec)
  }

  /// Spectrum analysis on a specific channel pair or single channel.
  /// Returns `Option<(smooth_db, peak_db)>` — same shape as `push_interleaved`.
  pub fn push_selected(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    now_sec: f64,
    sel: SpectrumChannelSel,
  ) -> Option<(Vec<f64>, Vec<f64>)> {
    let ch = channels.max(1) as usize;
    self.reset_primary_bank_for_input_channels(2);
    let frames = interleaved.len() / ch;
    for i in 0..frames {
      let base = i * ch;
      let s = match sel {
        SpectrumChannelSel::Pair(x, y) => {
          let xi = (x as usize).min(ch - 1);
          let yi = (y as usize).min(ch - 1);
          0.5 * (interleaved[base + xi] + interleaved[base + yi])
        }
        SpectrumChannelSel::Single(c) => {
          let ci = (c as usize).min(ch - 1);
          interleaved[base + ci]
        }
      };
      self.bank.push_sample(s);
    }
    self.finish_primary_push(now_sec)
  }

  /// Drive the spectrum for a selected pair under a given view.
  /// Combined/Single → one curve. Lr/Ms → primary + secondary curve.
  pub fn push_pair(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    now_sec: f64,
    sel: SpectrumChannelSel,
    view: SpectrumView,
  ) {
    let ch = channels.max(1) as usize;
    let two_curve = matches!(sel, SpectrumChannelSel::Pair(_, _))
      && matches!(view, SpectrumView::Lr | SpectrumView::Ms);

    if !two_curve {
      let out = if ch == 1 {
        self.push_mono_duplex(interleaved, now_sec)
      } else {
        self.push_selected(interleaved, channels, now_sec, sel)
      };
      if let Some((sm, pk)) = out {
        self.cached_centers = self.band_centers();
        self.cached_smooth = sm;
        self.cached_peak = pk;
      }
      self.has_secondary = false;
      self.cached_smooth_b.clear();
      self.cached_peak_b.clear();
      return;
    }

    let (xi, yi) = match sel {
      SpectrumChannelSel::Pair(x, y) => ((x as usize).min(ch - 1), (y as usize).min(ch - 1)),
      SpectrumChannelSel::Single(c) => {
        let ci = (c as usize).min(ch - 1);
        (ci, ci)
      }
    };

    if self.last_input_channels != ch {
      self.bank = MultiResBank::new(self.sample_rate, self.min_hz, self.max_hz);
      self
        .bank
        .set_analysis_average_sec(self.analysis_average_sec);
      self.last_input_channels = ch;
      self.smooth_db.clear();
      self.peak_db.clear();
      self.bank_b = None;
    }
    if self.bank_b.is_none() {
      self.bank_b = Some(MultiResBank::new(
        self.sample_rate,
        self.min_hz,
        self.max_hz,
      ));
      if let Some(bank_b) = self.bank_b.as_mut() {
        bank_b.set_analysis_average_sec(self.analysis_average_sec);
      }
      self.smooth_db_b.clear();
      self.peak_db_b.clear();
    }

    let frames = interleaved.len() / ch;
    for i in 0..frames {
      let base = i * ch;
      let x = interleaved[base + xi];
      let y = interleaved[base + yi];
      let (a, b) = match view {
        SpectrumView::Lr => (x, y),
        SpectrumView::Ms => (0.5 * (x + y), 0.5 * (x - y)),
        SpectrumView::Combined => unreachable!(),
      };
      self.bank.push_sample(a);
      if let Some(bb) = self.bank_b.as_mut() {
        bb.push_sample(b);
      }
    }

    let bank_b_ready = self.bank_b.as_ref().map(|b| b.ready()).unwrap_or(false);
    if !self.bank.ready() || !bank_b_ready {
      return;
    }

    let delta_sec = if self.last_time_sec > 0.0 {
      (now_sec - self.last_time_sec).clamp(1.0 / 240.0, 0.25)
    } else {
      1.0 / 60.0
    };
    self.last_time_sec = now_sec;

    let inc_a = self.post_process_for(&self.bank);
    let inc_b = self.post_process_for(self.bank_b.as_ref().unwrap());
    apply_envelope(
      &inc_a,
      &mut self.smooth_db,
      &mut self.peak_db,
      &mut self.peak_hold_until,
      now_sec,
      delta_sec,
      self.attack_ms,
      self.release_ms,
      self.peak_hold_sec,
      self.peak_decay_db_per_sec,
    );
    apply_envelope(
      &inc_b,
      &mut self.smooth_db_b,
      &mut self.peak_db_b,
      &mut self.peak_hold_until_b,
      now_sec,
      delta_sec,
      self.attack_ms,
      self.release_ms,
      self.peak_hold_sec,
      self.peak_decay_db_per_sec,
    );

    self.cached_centers = self.band_centers();
    self.cached_smooth = self.smooth_db.clone();
    self.cached_peak = self.peak_db.clone();
    self.cached_smooth_b = self.smooth_db_b.clone();
    self.cached_peak_b = self.peak_db_b.clone();
    self.has_secondary = true;
  }

  /// Secondary `(smooth_db, peak_db)` when the current view emits two curves, else `None`.
  pub fn last_output_secondary(&self) -> Option<(&[f64], &[f64])> {
    if self.has_secondary {
      Some((&self.cached_smooth_b, &self.cached_peak_b))
    } else {
      None
    }
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
    self.push_pair(
      ctx.interleaved,
      ctx.channels,
      ctx.now_sec,
      ctx.spectrum_channel,
      ctx.spectrum_view,
    );
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
  fn full_scale_sine_reads_near_zero_dbfs() {
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    let frames = 16384 * 6;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = s;
    }
    let mut out = None;
    for _ in 0..2 {
      out = m.push_interleaved(&pcm, 2, 1.0);
    }
    let (smooth, _) = out.expect("output");
    let peak = smooth.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    assert!(
      (peak - 0.0).abs() < 3.0,
      "full-scale 1 kHz sine should display near 0 dBFS, got {peak}"
    );
  }

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
    assert!(
      m.peak_hold_sec >= 1.0,
      "peak hold should be enabled by default, got {}",
      m.peak_hold_sec
    );
    assert!(
      m.peak_decay_db_per_sec > 0.0 && m.peak_decay_db_per_sec <= 10.0,
      "decay should be gentle, got {}",
      m.peak_decay_db_per_sec
    );
  }

  #[test]
  fn slope_pivots_at_1khz_not_inflated() {
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    // full-scale (0 dBFS) 1 kHz sine on both channels
    let frames = 16384 * 6;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = s;
    }
    let mut out = None;
    for _ in 0..2 {
      out = m.push_interleaved(&pcm, 2, 1.0);
    }
    let (smooth, _) = out.expect("output");
    let centers = m.band_centers();
    let val_near = |t: f64| {
      let (i, _) = centers
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| (**a - t).abs().partial_cmp(&(**b - t).abs()).unwrap())
        .unwrap();
      smooth[i]
    };
    let peak1k = val_near(1000.0);
    // With the slope pivoting at 1 kHz, a 0 dBFS 1 kHz tone sits near 0 dB — NOT inflated to
    // ~+25 dB the way a 20 Hz-anchored slope does. Lower bound is loose because 1/24-octave
    // smoothing spreads a pure tone's energy and lowers its displayed peak.
    assert!(
      peak1k < 5.0,
      "1 kHz peak inflated by slope: {peak1k} (pivot not at 1 kHz?)"
    );
    assert!(peak1k > -25.0, "1 kHz peak unexpectedly low: {peak1k}");
  }

  #[test]
  fn combined_view_has_no_secondary() {
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    let frames = 16384 * 4;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = s;
    }
    for _ in 0..2 {
      m.push_pair(
        &pcm,
        2,
        1.0,
        SpectrumChannelSel::Pair(0, 1),
        SpectrumView::Combined,
      );
    }
    assert!(m.last_output_secondary().is_none());
  }

  #[test]
  fn ms_view_side_is_silent_for_mono_signal() {
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    let frames = 16384 * 6;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = s;
    }
    for _ in 0..2 {
      m.push_pair(
        &pcm,
        2,
        1.0,
        SpectrumChannelSel::Pair(0, 1),
        SpectrumView::Ms,
      );
    }
    let (centers, m_smooth, _) = m.last_output();
    let (s_smooth, _) = m.last_output_secondary().expect("ms has a secondary curve");
    assert_eq!(s_smooth.len(), centers.len());
    let m_peak = m_smooth.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let s_peak = s_smooth.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    assert!(
      m_peak > s_peak + 40.0,
      "M should dominate S for a centered signal: M={m_peak} S={s_peak}"
    );
  }

  #[test]
  fn ms_mid_matches_combined() {
    let sr = 48000.0;
    let frames = 16384 * 6;
    let mut pcm = vec![0.0_f32; frames * 2];
    let mut x: u32 = 0x1234_5678;
    for i in 0..frames {
      x = x.wrapping_mul(1664525).wrapping_add(1013904223);
      let l = ((x >> 8) as f32 / 8_388_608.0) - 1.0;
      x = x.wrapping_mul(1664525).wrapping_add(1013904223);
      let r = ((x >> 8) as f32 / 8_388_608.0) - 1.0;
      pcm[i * 2] = l;
      pcm[i * 2 + 1] = r;
    }
    let mut comb = SpectrumMeter::new(sr);
    let mut ms = SpectrumMeter::new(sr);
    for _ in 0..3 {
      comb.push_pair(
        &pcm,
        2,
        1.0,
        SpectrumChannelSel::Pair(0, 1),
        SpectrumView::Combined,
      );
      ms.push_pair(
        &pcm,
        2,
        1.0,
        SpectrumChannelSel::Pair(0, 1),
        SpectrumView::Ms,
      );
    }
    let (_, comb_smooth, _) = comb.last_output();
    let (_, mid_smooth, _) = ms.last_output();
    assert_eq!(comb_smooth.len(), mid_smooth.len());
    for (a, b) in comb_smooth.iter().zip(mid_smooth.iter()) {
      assert!((a - b).abs() < 1e-6, "M must equal Combined: {a} vs {b}");
    }
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

  #[test]
  fn smoothing_percent_50_matches_current_attack_release() {
    let (attack_ms, release_ms) = SpectrumMeter::smoothing_times_ms_for_percent(50.0);
    assert!(
      (attack_ms - 30.0).abs() < 0.1,
      "50% smoothing should preserve current 30ms attack, got {attack_ms}"
    );
    assert!(
      (release_ms - 150.0).abs() < 0.1,
      "50% smoothing should preserve current 150ms release, got {release_ms}"
    );
  }

  #[test]
  fn smoothing_percent_100_is_extra_slow() {
    let (attack_ms, release_ms) = SpectrumMeter::smoothing_times_ms_for_percent(100.0);
    assert!(
      (attack_ms - 400.0).abs() < 1.0,
      "100% smoothing should use about 400ms attack, got {attack_ms}"
    );
    assert!(
      (release_ms - 2000.0).abs() < 1.0,
      "100% smoothing should use about 2000ms release, got {release_ms}"
    );
  }

  #[test]
  fn zero_tilt_disables_default_slope() {
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    m.set_display_controls(75.0, 0.0);
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
    let delta = val_near(10000.0) - val_near(100.0);
    assert!(
      delta < 10.0,
      "0 dB/oct tilt should not apply the default +4.5 dB/oct slope: delta={delta}"
    );
  }

  #[test]
  fn zero_smoothing_bypasses_hidden_analysis_average() {
    let sr = 48000.0;
    let hz = 8000.0;
    let mut m = SpectrumMeter::new(sr);
    m.set_display_controls(0.0, 4.5);

    let tone_frames = 16384 * 8;
    let mut tone = vec![0.0_f32; tone_frames * 2];
    for i in 0..tone_frames {
      let s = (2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32;
      tone[i * 2] = s;
      tone[i * 2 + 1] = s;
    }
    let (steady, _) = m.push_interleaved(&tone, 2, 1.0).expect("tone output");

    let silence_frames = (sr * 0.100) as usize;
    let silence = vec![0.0_f32; silence_frames * 2];
    let (after, _) = m
      .push_interleaved(&silence, 2, 1.1)
      .expect("silence output");

    let centers = m.band_centers();
    let val_near = |db: &[f64], target: f64| {
      let (i, _) = centers
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
          (**a - target)
            .abs()
            .partial_cmp(&(**b - target).abs())
            .unwrap()
        })
        .unwrap();
      db[i]
    };
    let steady_db = val_near(&steady, hz);
    let after_db = val_near(&after, hz);

    assert!(
      after_db < steady_db - 20.0,
      "0% smoothing should not retain a hidden analysis average: steady={steady_db}, after={after_db}"
    );
  }

  #[test]
  fn push_pcm_ms_populates_secondary() {
    use crate::dsp::meter::{Meter, PcmContext};
    use crate::engine::ChannelLayoutSetting;
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    let frames = 16384 * 6;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      // hard-panned to L so S has energy
      pcm[i * 2] = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
    }
    for _ in 0..2 {
      let ctx = PcmContext {
        interleaved: &pcm,
        channels: 2,
        now_sec: 1.0,
        channel_layout: ChannelLayoutSetting::Auto,
        loudness_weights: None,
        vectorscope_pair: (0, 1),
        spectrum_channel: SpectrumChannelSel::Pair(0, 1),
        spectrum_view: SpectrumView::Ms,
        dialogue_gating: false,
        dialogue_vad_engine: crate::dsp::speech::VadEngineKind::default(),
      };
      m.push_pcm(&ctx);
    }
    assert!(m.last_output_secondary().is_some());
  }
}
