//! PCM → meters; drives `AudioFramePayload` / slow loudness emit rates.

use std::collections::VecDeque;
use std::time::Instant;

use crate::dsp::loudness::LoudnessBlock;
use crate::dsp::paths::spectrum_paths_from_bands;
use crate::dsp::peak::{
  sample_peak_db_interleaved, sample_peak_db_mono, sample_peak_db_per_channel_interleaved,
};
use crate::dsp::{LoudnessMeter, SpectrumEngine, VectorscopeState};
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::{
  AudioFramePayload, LoudnessSlowPayload, MeterHistoryBuf, MeterHistoryEntry,
};

const VS_CAP: usize = 4096;
const FRAME_EMIT_MS: u128 = 16;
const SLOW_EMIT_MS: u128 = 500;
/// Match `useAudioEngine.js` HIST_PUSH_MS / `App.jsx` HIST_SAMPLE_SEC cadence (~10 Hz).
const HIST_EMIT_MS: u128 = 95;
const HIST_RING_CAP: usize = 36_000;

fn loudness_layout_meta(channels: u16, channel_layout: ChannelLayoutSetting) -> (String, bool) {
  let ch = channels.max(1);
  match channel_layout {
    ChannelLayoutSetting::Stereo => ("stereo".to_string(), true),
    ChannelLayoutSetting::Surround51 => {
      if ch >= 6 {
        ("5.1".to_string(), true)
      } else {
        ("stereo".to_string(), false)
      }
    }
    ChannelLayoutSetting::Auto => {
      if ch <= 2 {
        ("stereo".to_string(), true)
      } else {
        ("unknown".to_string(), false)
      }
    }
  }
}

pub struct MeterPipeline {
  channels: u16,
  loudness: LoudnessMeter,
  spectrum: SpectrumEngine,
  vs: VectorscopeState,
  vs_l: VecDeque<f32>,
  vs_r: VecDeque<f32>,
  /// Flattened L/R for [`VectorscopeState::process`] (avoids O(n) `remove(0)` on the live ring).
  vs_flat_l: Vec<f32>,
  vs_flat_r: Vec<f32>,
  mono_scratch: Vec<f32>,
  last_loudness: Option<LoudnessBlock>,
  m_max: f64,
  st_max: f64,
  tp_max_db: f64,
  sample_peak_max_l: f64,
  sample_peak_max_r: f64,
  meter_history: MeterHistoryBuf,
  t0: Instant,
  last_frame_emit: Instant,
  last_slow_emit: Instant,
  last_spectrum_smooth: Vec<f64>,
  last_spectrum_peak: Vec<f64>,
  last_band_centers: Vec<f64>,
  last_hist_emit: Instant,
  pending_loudness_hist: Option<(f64, f64)>,
}

impl MeterPipeline {
  pub fn new(sample_rate: u32, channels: u16, meter_history: MeterHistoryBuf) -> Self {
    let sr = sample_rate as f64;
    Self {
      channels,
      loudness: LoudnessMeter::new(sr),
      spectrum: SpectrumEngine::new(sr),
      vs: VectorscopeState::new(),
      vs_l: VecDeque::with_capacity(VS_CAP),
      vs_r: VecDeque::with_capacity(VS_CAP),
      vs_flat_l: Vec::with_capacity(VS_CAP),
      vs_flat_r: Vec::with_capacity(VS_CAP),
      mono_scratch: Vec::new(),
      last_loudness: None,
      m_max: f64::NEG_INFINITY,
      st_max: f64::NEG_INFINITY,
      tp_max_db: f64::NEG_INFINITY,
      sample_peak_max_l: f64::NEG_INFINITY,
      sample_peak_max_r: f64::NEG_INFINITY,
      meter_history,
      t0: Instant::now(),
      last_frame_emit: Instant::now(),
      last_slow_emit: Instant::now(),
      last_spectrum_smooth: Vec::new(),
      last_spectrum_peak: Vec::new(),
      last_band_centers: Vec::new(),
      last_hist_emit: Instant::now() - std::time::Duration::from_millis(200),
      pending_loudness_hist: None,
    }
  }

  /// Clears shared history deque, peak maxima, loudness/spectrum/vectorscope DSP state (UI Clear).
  pub fn clear_peak_and_history(&mut self) {
    if let Ok(mut g) = self.meter_history.lock() {
      g.clear();
    }
    self.pending_loudness_hist = None;
    self.last_hist_emit = Instant::now() - std::time::Duration::from_millis(200);
    self.m_max = f64::NEG_INFINITY;
    self.st_max = f64::NEG_INFINITY;
    self.tp_max_db = f64::NEG_INFINITY;
    self.sample_peak_max_l = f64::NEG_INFINITY;
    self.sample_peak_max_r = f64::NEG_INFINITY;
    self.loudness.reset();
    self.spectrum.reset();
    self.vs.reset();
    self.vs_l.clear();
    self.vs_r.clear();
    self.last_loudness = None;
    self.last_band_centers.clear();
    self.last_spectrum_smooth.clear();
    self.last_spectrum_peak.clear();
  }

  fn feed_vs_mono(&mut self, mono: &[f32]) {
    for &s in mono {
      self.push_vs_pair(s, s);
    }
  }

  fn feed_vs_interleaved(&mut self, interleaved: &[f32], channels: u16, pair_x: u16, pair_y: u16) {
    let ch = channels.max(1) as usize;
    let frames = interleaved.len() / ch;
    let x = (pair_x as usize).min(ch.saturating_sub(1));
    let y = (pair_y as usize).min(ch.saturating_sub(1));
    for i in 0..frames {
      let l = interleaved[i * ch + x];
      let r = interleaved[i * ch + y];
      self.push_vs_pair(l, r);
    }
  }

  fn push_vs_pair(&mut self, l: f32, r: f32) {
    self.vs_l.push_back(l);
    self.vs_r.push_back(r);
    while self.vs_l.len() > VS_CAP {
      self.vs_l.pop_front();
      self.vs_r.pop_front();
    }
  }

  /// Process one PCM chunk from capture. Returns `(frame, slow)` when ready to send on IPC.
  pub fn push_pcm_f32(
    &mut self,
    interleaved: &[f32],
    vectorscope_pair: (u16, u16),
    channel_layout: ChannelLayoutSetting,
  ) -> (Option<AudioFramePayload>, Option<LoudnessSlowPayload>) {
    let now_sec = self.t0.elapsed().as_secs_f64();
    let ch = self.channels.max(1);
    let (pair_x, pair_y) = vectorscope_pair;
    let (loudness_layout, loudness_layout_known) = loudness_layout_meta(ch, channel_layout);

    if ch == 1 {
      self.mono_scratch.clear();
      self.mono_scratch.extend_from_slice(interleaved);
      let m = self.loudness.push_mono_duplex(&self.mono_scratch);
      if let Some(ref lb) = m {
        self.apply_loudness_block(lb);
      }
      self.feed_vs_mono(interleaved);
      if let Some((sm, pk)) = self.spectrum.push_mono_duplex(interleaved, now_sec) {
        self.last_band_centers = self.spectrum.band_centers();
        self.last_spectrum_smooth = sm;
        self.last_spectrum_peak = pk;
      }
    } else {
      if let Some(lb) = self
        .loudness
        .push_interleaved_multichannel(interleaved, self.channels, channel_layout)
      {
        self.apply_loudness_block(&lb);
      }
      self.feed_vs_interleaved(interleaved, self.channels, pair_x, pair_y);
      if let Some((sm, pk)) = self
        .spectrum
        .push_interleaved(interleaved, self.channels, now_sec)
      {
        self.last_band_centers = self.spectrum.band_centers();
        self.last_spectrum_smooth = sm;
        self.last_spectrum_peak = pk;
      }
    }

    let (sl, sr) = if ch == 1 {
      sample_peak_db_mono(interleaved)
    } else {
      sample_peak_db_interleaved(interleaved, self.channels)
    };

    if sl.is_finite() {
      self.sample_peak_max_l = self.sample_peak_max_l.max(sl);
    }
    if sr.is_finite() {
      self.sample_peak_max_r = self.sample_peak_max_r.max(sr);
    }

    let mut slow_out = None;
    if self.last_slow_emit.elapsed().as_millis() >= SLOW_EMIT_MS {
      self.last_slow_emit = Instant::now();
      let integ = self
        .last_loudness
        .as_ref()
        .map(|l| l.integrated)
        .filter(|v| v.is_finite());
      let integrated = integ.filter(|&v| v > -120.0);
      let st = self
        .last_loudness
        .as_ref()
        .map(|l| l.short_term)
        .unwrap_or(f64::NEG_INFINITY);
      let tp = self
        .last_loudness
        .as_ref()
        .map(|l| l.true_peak)
        .unwrap_or(f64::NEG_INFINITY);
      let psr = if tp.is_finite() && st.is_finite() {
        Some(tp - st)
      } else {
        None
      };
      let integ_plr = integrated.unwrap_or(f64::NEG_INFINITY);
      let plr = if tp.is_finite() && integ_plr.is_finite() {
        Some(tp - integ_plr)
      } else {
        None
      };
      slow_out = Some(LoudnessSlowPayload {
        lufs_integrated: integrated,
        lufs_m_max: self.m_max,
        lufs_st_max: self.st_max,
        lra: self.last_loudness.as_ref().map(|l| l.lra).unwrap_or(0.0),
        psr,
        plr,
      });
    }

    let force_frame = self.pending_loudness_hist.is_some();
    if !force_frame && self.last_frame_emit.elapsed().as_millis() < FRAME_EMIT_MS {
      return (None, slow_out);
    }
    self.last_frame_emit = Instant::now();

    let lb = self.last_loudness.clone();
    let (lm, lst, integ, lra, tpl, tpr, _tpg) = match &lb {
      Some(l) => (
        l.momentary,
        l.short_term,
        l.integrated,
        l.lra,
        l.true_peak_l,
        l.true_peak_r,
        l.true_peak,
      ),
      None => (
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
        0.0,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
      ),
    };

    let (corr, vpath) = if !self.vs_l.is_empty() {
      self.vs_flat_l.clear();
      self.vs_flat_r.clear();
      self.vs_flat_l.extend(self.vs_l.iter().copied());
      self.vs_flat_r.extend(self.vs_r.iter().copied());
      self.vs.process(&self.vs_flat_l, &self.vs_flat_r)
    } else {
      (0.0, String::new())
    };

    let centers = &self.last_band_centers;
    let smooth = &self.last_spectrum_smooth;
    let peak = &self.last_spectrum_peak;
    let (spath, spk) = if !centers.is_empty() && smooth.len() == centers.len() {
      let pk = if peak.len() == centers.len() {
        peak.as_slice()
      } else {
        smooth.as_slice()
      };
      spectrum_paths_from_bands(centers, smooth, pk, false)
    } else {
      (String::new(), String::new())
    };

    let peak_db = sample_peak_db_per_channel_interleaved(interleaved, ch);
    let peak_hold_db = peak_db.clone();

    let loudness_hist_tick = if let Some((m, st)) = self.pending_loudness_hist.take() {
      let entry = MeterHistoryEntry {
        lufs_momentary: m,
        lufs_short_term: st,
        integrated: integ,
        lra,
        true_peak_l: tpl,
        true_peak_r: tpr,
        true_peak_max_dbtp: self.tp_max_db,
        sample_l_db: sl,
        sample_r_db: sr,
        sample_peak_max_l: self.sample_peak_max_l,
        sample_peak_max_r: self.sample_peak_max_r,
        correlation: corr,
        vectorscope_path: vpath.clone(),
        vectorscope_pair_x: pair_x,
        vectorscope_pair_y: pair_y,
        spectrum_path: spath.clone(),
        spectrum_peak_path: spk.clone(),
        spectrum_band_centers_hz: centers.clone(),
        spectrum_smooth_db: smooth.clone(),
        loudness_layout: loudness_layout.clone(),
        loudness_layout_known,
      };
      if let Ok(mut g) = self.meter_history.lock() {
        while g.len() >= HIST_RING_CAP {
          g.pop_front();
        }
        g.push_back(entry.clone());
      }
      Some(entry)
    } else {
      None
    };

    let frame = AudioFramePayload {
      peak_db,
      peak_hold_db,
      true_peak_max_dbtp: self.tp_max_db,
      lufs_momentary: lm,
      lufs_short_term: lst,
      integrated: integ,
      lra,
      true_peak_l: tpl,
      true_peak_r: tpr,
      sample_l_db: sl,
      sample_r_db: sr,
      correlation: corr,
      vectorscope_path: vpath,
      vectorscope_pair_x: pair_x,
      vectorscope_pair_y: pair_y,
      spectrum_path: spath,
      spectrum_peak_path: spk,
      spectrum_band_centers_hz: centers.clone(),
      spectrum_smooth_db: smooth.clone(),
      loudness_layout,
      loudness_layout_known,
      timestamp_ms: self.t0.elapsed().as_millis() as u64,
      loudness_hist_tick,
    };
    (Some(frame), slow_out)
  }

  fn apply_loudness_block(&mut self, lb: &LoudnessBlock) {
    if lb.momentary.is_finite() {
      self.m_max = self.m_max.max(lb.momentary);
    }
    if lb.short_term.is_finite() {
      self.st_max = self.st_max.max(lb.short_term);
    }
    if lb.true_peak.is_finite() {
      self.tp_max_db = self.tp_max_db.max(lb.true_peak);
    }
    self.last_loudness = Some(lb.clone());
    // Keep appending history during digital silence (M/S are -inf from zero energy) so the chart
    // and snapshot ring continue to advance while capture is running.
    let now = Instant::now();
    if now.duration_since(self.last_hist_emit).as_millis() < HIST_EMIT_MS {
      return;
    }
    self.last_hist_emit = now;
    self.pending_loudness_hist = Some((lb.momentary, lb.short_term));
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::VecDeque;
  use std::sync::{Arc, Mutex};

  fn dummy_history() -> MeterHistoryBuf {
    Arc::new(Mutex::new(VecDeque::new()))
  }

  #[test]
  fn vectorscope_pair_selects_requested_channels() {
    // 3 channels, 2 frames:
    // frame0: [0.1, 0.2, 0.3]
    // frame1: [1.1, 1.2, 1.3]
    let pcm = vec![0.1_f32, 0.2, 0.3, 1.1, 1.2, 1.3];
    let mut p = MeterPipeline::new(48_000, 3, dummy_history());
    let _ = p.push_pcm_f32(&pcm, (2, 0), crate::engine::ChannelLayoutSetting::Auto);
    // Last pushed sample should be from frame1 ch2 (L) and ch0 (R).
    assert_eq!(p.vs_l.back().copied().unwrap_or_default(), 1.3);
    assert_eq!(p.vs_r.back().copied().unwrap_or_default(), 1.1);
  }

  #[test]
  fn loudness_layout_meta_marks_unknown_for_auto_multichannel() {
    let (s, known) = loudness_layout_meta(6, ChannelLayoutSetting::Auto);
    assert_eq!(s, "unknown");
    assert!(!known);
  }

  #[test]
  fn loudness_layout_meta_marks_51_for_manual_51() {
    let (s, known) = loudness_layout_meta(6, ChannelLayoutSetting::Surround51);
    assert_eq!(s, "5.1");
    assert!(known);
  }

  #[test]
  fn loudness_layout_meta_downgrades_manual_51_when_channels_too_low() {
    let (s, known) = loudness_layout_meta(2, ChannelLayoutSetting::Surround51);
    assert_eq!(s, "stereo");
    assert!(!known);
  }
}
