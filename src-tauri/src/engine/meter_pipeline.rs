//! PCM → meters; drives `AudioFramePayload` / slow loudness emit rates.

use std::time::Instant;

use crate::dsp::loudness::LoudnessBlock;
use crate::dsp::paths::spectrum_paths_from_bands;
use crate::dsp::peak::{
  sample_peak_db_interleaved, sample_peak_db_mono, sample_peak_db_per_channel_interleaved,
};
use crate::dsp::{
  LoudnessMeter, Meter, PcmContext, SpectrumChannelSel, SpectrumMeter, VectorscopeMeter,
};
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::{
  AudioFramePayload, LoudnessSlowPayload, MeterHistoryBuf, MeterHistoryEntry,
};

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
    ChannelLayoutSetting::Surround71 => {
      if ch >= 8 {
        ("7.1".to_string(), true)
      } else {
        ("stereo".to_string(), false)
      }
    }
    ChannelLayoutSetting::Auto => match ch {
      1 => ("mono".to_string(), true),
      2 => ("stereo".to_string(), true),
      6 => ("5.1".to_string(), true),
      8 => ("7.1".to_string(), true),
      _ => ("unknown".to_string(), false),
    },
  }
}

pub struct MeterPipeline {
  channels: u16,
  loudness: LoudnessMeter,
  spectrum: SpectrumMeter,
  vectorscope: VectorscopeMeter,
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
  last_hist_emit: Instant,
  pending_loudness_hist: Option<(f64, f64)>,
}

impl MeterPipeline {
  pub fn new(sample_rate: u32, channels: u16, meter_history: MeterHistoryBuf) -> Self {
    let sr = sample_rate as f64;
    Self {
      channels,
      loudness: LoudnessMeter::new(sr),
      spectrum: SpectrumMeter::new(sr),
      vectorscope: VectorscopeMeter::new(),
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
    self.vectorscope.reset();
    self.last_loudness = None;
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

    // Resolve effective layout for auto mode before passing to DSP.
    let effective_layout = match channel_layout {
      ChannelLayoutSetting::Auto => match ch {
        6 => ChannelLayoutSetting::Surround51,
        8 => ChannelLayoutSetting::Surround71,
        _ => channel_layout,
      },
      other => other,
    };

    let (loudness_layout, loudness_layout_known) = loudness_layout_meta(ch, effective_layout);

    // --- PCM intake: uniform push through Meter trait ---
    let ctx = PcmContext {
      interleaved,
      channels: ch,
      now_sec,
      channel_layout: effective_layout,
      vectorscope_pair,
      spectrum_channel: SpectrumChannelSel::default(),
    };
    self.loudness.push_pcm(&ctx);
    self.spectrum.push_pcm(&ctx);
    self.vectorscope.push_pcm(&ctx);

    // --- Apply loudness block if a new one arrived ---
    if let Some(lb) = self.loudness.take_block() {
      self.apply_loudness_block(&lb);
    }

    // --- Sample peak (stereo L/R for history + slow payload) ---
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

    // --- Slow loudness emit ---
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

    // --- Assemble frame ---
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

    let (corr, vpath) = self.vectorscope.get_output();

    let (centers, smooth, peak) = self.spectrum.last_output();
    let (spath, spk) = if !centers.is_empty() && smooth.len() == centers.len() {
      let pk = if peak.len() == centers.len() {
        peak
      } else {
        smooth
      };
      spectrum_paths_from_bands(centers, smooth, pk, false)
    } else {
      (String::new(), String::new())
    };
    let centers = centers.to_vec();
    let smooth = smooth.to_vec();

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
      spectrum_band_centers_hz: centers,
      spectrum_smooth_db: smooth,
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
    // Last pushed sample should be from frame1 ch2 (L) and ch0 (R) in the vectorscope ring.
    assert_eq!(p.vectorscope.vs_l.back().copied().unwrap_or_default(), 1.3);
    assert_eq!(p.vectorscope.vs_r.back().copied().unwrap_or_default(), 1.1);
  }

  #[test]
  fn loudness_layout_meta_detects_51_for_auto_multichannel() {
    let (s, known) = loudness_layout_meta(6, ChannelLayoutSetting::Auto);
    assert_eq!(s, "5.1");
    assert!(known);
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

  #[test]
  fn loudness_layout_meta_marks_71_for_manual_71() {
    let (s, known) = loudness_layout_meta(8, ChannelLayoutSetting::Surround71);
    assert_eq!(s, "7.1");
    assert!(known);
  }

  #[test]
  fn loudness_layout_meta_downgrades_manual_71_when_channels_too_low() {
    let (s, known) = loudness_layout_meta(6, ChannelLayoutSetting::Surround71);
    assert_eq!(s, "stereo");
    assert!(!known);
  }

  #[test]
  fn loudness_layout_meta_downgrades_manual_71_at_boundary() {
    let (s, known) = loudness_layout_meta(7, ChannelLayoutSetting::Surround71);
    assert_eq!(s, "stereo");
    assert!(!known);
  }

  #[test]
  fn auto_layout_meta_1ch_is_mono() {
    assert_eq!(
      loudness_layout_meta(1, ChannelLayoutSetting::Auto),
      ("mono".to_string(), true)
    );
  }

  #[test]
  fn auto_layout_meta_2ch_is_stereo() {
    assert_eq!(
      loudness_layout_meta(2, ChannelLayoutSetting::Auto),
      ("stereo".to_string(), true)
    );
  }

  #[test]
  fn auto_layout_meta_6ch_is_51() {
    assert_eq!(
      loudness_layout_meta(6, ChannelLayoutSetting::Auto),
      ("5.1".to_string(), true)
    );
  }

  #[test]
  fn auto_layout_meta_8ch_is_71() {
    assert_eq!(
      loudness_layout_meta(8, ChannelLayoutSetting::Auto),
      ("7.1".to_string(), true)
    );
  }

  #[test]
  fn auto_layout_meta_3ch_is_unknown() {
    assert_eq!(
      loudness_layout_meta(3, ChannelLayoutSetting::Auto),
      ("unknown".to_string(), false)
    );
  }

  #[test]
  fn manual_71_on_6ch_falls_back() {
    assert_eq!(
      loudness_layout_meta(6, ChannelLayoutSetting::Surround71),
      ("stereo".to_string(), false)
    );
  }

  #[test]
  fn auto_mode_6ch_uses_51_loudness_layout() {
    let sr = 48000_u32;
    let channels = 6_u16;
    let hist: MeterHistoryBuf = Arc::new(Mutex::new(VecDeque::new()));
    let mut pipeline = MeterPipeline::new(sr, channels, hist);

    // Feed enough PCM to guarantee a frame is emitted (~400ms at 16ms per frame = ~25 frames)
    let frames_per_chunk = sr as usize / 10; // 100ms chunks
    let channels_usize = channels as usize;
    let mut pcm = vec![0.0_f32; frames_per_chunk * channels_usize];
    for i in 0..frames_per_chunk {
      let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr as f64).sin() as f32;
      for c in 0..channels_usize {
        pcm[i * channels_usize + c] = s;
      }
    }

    let mut loudness_layout_seen = None;
    for _ in 0..5 {
      if let (Some(f), _) = pipeline.push_pcm_f32(&pcm, (0, 1), ChannelLayoutSetting::Auto) {
        loudness_layout_seen = Some(f.loudness_layout.clone());
        break;
      }
    }

    assert_eq!(
      loudness_layout_seen.as_deref(),
      Some("5.1"),
      "auto mode with 6ch should report 5.1 loudness layout"
    );
  }
}
