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
  AudioFramePayload, LoudnessSlowPayload, MeterHistoryEntry, VisualHistEntry,
};

const FRAME_EMIT_MS: u128 = 16;
const SLOW_EMIT_MS: u128 = 500;
/// Match `useAudioEngine.js` HIST_PUSH_MS / `App.jsx` HIST_SAMPLE_SEC cadence (~10 Hz).
const HIST_EMIT_MS: u128 = 95;
const VISUAL_EMIT_MS: u128 = 40;
const VS_HISTORY_POINTS: usize = 200;

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
      5 => ("5.0".to_string(), true),
      6 => ("5.1".to_string(), true),
      7 => ("7.0".to_string(), true),
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
  last_spectrum_channel: SpectrumChannelSel,
  last_loudness_weights: Option<Vec<f64>>,
  last_loudness: Option<LoudnessBlock>,
  m_max: f64,
  st_max: f64,
  tp_max_db: f64,
  sample_peak_max_l: f64,
  sample_peak_max_r: f64,
  t0: Instant,
  last_frame_emit: Instant,
  last_slow_emit: Instant,
  last_hist_emit: Instant,
  pending_loudness_hist: Option<(f64, f64)>,
  /// Running per-channel min since last history tick. Sentinel INFINITY = no samples seen yet.
  /// Reset is coupled to `pending_loudness_hist`: the span may exceed `HIST_EMIT_MS` at stream
  /// start if no loudness block has been produced yet.
  waveform_min_acc: Vec<f32>,
  /// Running per-channel max since last history tick. Sentinel NEG_INFINITY = no samples seen yet.
  waveform_max_acc: Vec<f32>,
  last_visual_emit: Instant,
  /// Running per-channel min since last visual tick. Sentinel INFINITY = no samples seen yet.
  visual_waveform_min_acc: Vec<f32>,
  /// Running per-channel max since last visual tick.
  visual_waveform_max_acc: Vec<f32>,
  last_dialogue_gating: bool,
}

impl MeterPipeline {
  pub fn new(sample_rate: u32, channels: u16) -> Self {
    let sr = sample_rate as f64;
    let pipeline = Self {
      channels,
      loudness: LoudnessMeter::new(sr),
      spectrum: SpectrumMeter::new(sr),
      vectorscope: VectorscopeMeter::new(),
      last_spectrum_channel: SpectrumChannelSel::default(),
      last_loudness_weights: None,
      last_loudness: None,
      m_max: f64::NEG_INFINITY,
      st_max: f64::NEG_INFINITY,
      tp_max_db: f64::NEG_INFINITY,
      sample_peak_max_l: f64::NEG_INFINITY,
      sample_peak_max_r: f64::NEG_INFINITY,
      t0: Instant::now(),
      last_frame_emit: Instant::now(),
      last_slow_emit: Instant::now(),
      last_hist_emit: Instant::now() - std::time::Duration::from_millis(200),
      pending_loudness_hist: None,
      waveform_min_acc: vec![f32::INFINITY; channels.max(1) as usize],
      waveform_max_acc: vec![f32::NEG_INFINITY; channels.max(1) as usize],
      last_visual_emit: Instant::now() - std::time::Duration::from_millis(200),
      visual_waveform_min_acc: vec![f32::INFINITY; channels.max(1) as usize],
      visual_waveform_max_acc: vec![f32::NEG_INFINITY; channels.max(1) as usize],
      last_dialogue_gating: false,
    };
    debug_assert_eq!(
      pipeline.waveform_min_acc.len(),
      pipeline.waveform_max_acc.len(),
      "waveform accumulators must be same length"
    );
    pipeline
  }

  /// Clears peak maxima, loudness/spectrum/vectorscope DSP state, and history accumulators (UI Clear).
  pub fn clear_peak_and_history(&mut self) {
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
    self.waveform_min_acc.fill(f32::INFINITY);
    self.waveform_max_acc.fill(f32::NEG_INFINITY);
    self.visual_waveform_min_acc.fill(f32::INFINITY);
    self.visual_waveform_max_acc.fill(f32::NEG_INFINITY);
    self.last_visual_emit = Instant::now() - std::time::Duration::from_millis(200);
  }

  /// Process one PCM chunk from capture. Returns `(frame, slow)` when ready to send on IPC.
  pub fn push_pcm_f32(
    &mut self,
    interleaved: &[f32],
    vectorscope_pair: (u16, u16),
    channel_layout: ChannelLayoutSetting,
    spectrum_channel: SpectrumChannelSel,
    loudness_weights: Option<Vec<f64>>,
    dialogue_gating: bool,
  ) -> (Option<AudioFramePayload>, Option<LoudnessSlowPayload>) {
    let now_sec = self.t0.elapsed().as_secs_f64();
    let ch = self.channels.max(1);
    let (pair_x, pair_y) = vectorscope_pair;

    if dialogue_gating != self.last_dialogue_gating {
      self.loudness.reset_dialogue();
      self.last_dialogue_gating = dialogue_gating;
    }

    // Resolve effective layout for auto mode before passing to DSP.
    let effective_layout = match channel_layout {
      ChannelLayoutSetting::Auto => match ch {
        6 => ChannelLayoutSetting::Surround51,
        8 => ChannelLayoutSetting::Surround71,
        _ => channel_layout,
      },
      other => other,
    };

    let dynamic_loudness_active = loudness_weights
      .as_ref()
      .is_some_and(|weights| weights.len() == ch as usize);

    if loudness_weights != self.last_loudness_weights {
      self.loudness.reset();
      self.last_loudness = None;
      self.pending_loudness_hist = None;
      self.m_max = f64::NEG_INFINITY;
      self.st_max = f64::NEG_INFINITY;
      self.last_loudness_weights = loudness_weights.clone();
    }

    let (loudness_layout, loudness_layout_known) = if dynamic_loudness_active {
      ("custom".to_string(), true)
    } else {
      loudness_layout_meta(ch, effective_layout)
    };

    if spectrum_channel != self.last_spectrum_channel {
      self.spectrum.reset();
      self.last_spectrum_channel = spectrum_channel;
    }

    // --- PCM intake: uniform push through Meter trait ---
    let ctx = PcmContext {
      interleaved,
      channels: ch,
      now_sec,
      channel_layout: effective_layout,
      loudness_weights,
      vectorscope_pair,
      spectrum_channel,
      dialogue_gating,
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

    // --- Accumulate per-channel waveform min/max for the next history tick ---
    let ch_usize = ch as usize;
    let frames_count = interleaved.len() / ch_usize;
    for f in 0..frames_count {
      let base = f * ch_usize;
      for c in 0..ch_usize {
        if c < self.waveform_min_acc.len() {
          let s = interleaved[base + c];
          if s < self.waveform_min_acc[c] {
            self.waveform_min_acc[c] = s;
          }
          if s > self.waveform_max_acc[c] {
            self.waveform_max_acc[c] = s;
          }
        }
        if c < self.visual_waveform_min_acc.len() {
          let s = interleaved[base + c];
          if s < self.visual_waveform_min_acc[c] {
            self.visual_waveform_min_acc[c] = s;
          }
          if s > self.visual_waveform_max_acc[c] {
            self.visual_waveform_max_acc[c] = s;
          }
        }
      }
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
      let waveform_min: Vec<f32> = self
        .waveform_min_acc
        .iter()
        .map(|&v| if v == f32::INFINITY { 0.0 } else { v })
        .collect();
      let waveform_max: Vec<f32> = self
        .waveform_max_acc
        .iter()
        .map(|&v| if v == f32::NEG_INFINITY { 0.0 } else { v })
        .collect();
      self.waveform_min_acc.fill(f32::INFINITY);
      self.waveform_max_acc.fill(f32::NEG_INFINITY);
      let entry = MeterHistoryEntry {
        timestamp_ms: self.t0.elapsed().as_millis() as u64,
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
        vectorscope_pair_x: pair_x,
        vectorscope_pair_y: pair_y,
        spectrum_band_centers_hz: centers.clone(),
        spectrum_smooth_db: smooth.clone(),
        loudness_layout: loudness_layout.clone(),
        loudness_layout_known,
        waveform_min,
        waveform_max,
      };
      Some(entry)
    } else {
      None
    };

    let visual_hist_tick = {
      let now = Instant::now();
      if now.duration_since(self.last_visual_emit).as_millis() >= VISUAL_EMIT_MS {
        self.last_visual_emit = now;

        let visual_waveform_min: Vec<f32> = self
          .visual_waveform_min_acc
          .iter()
          .map(|&v| if v.is_finite() { v } else { 0.0 })
          .collect();
        let visual_waveform_max: Vec<f32> = self
          .visual_waveform_max_acc
          .iter()
          .map(|&v| if v.is_finite() { v } else { 0.0 })
          .collect();
        self.visual_waveform_min_acc.fill(f32::INFINITY);
        self.visual_waveform_max_acc.fill(f32::NEG_INFINITY);

        let (visual_corr, vs_pairs) = self.vectorscope.get_history_pairs(VS_HISTORY_POINTS);

        Some(VisualHistEntry {
          timestamp_ms: self.t0.elapsed().as_millis() as u64,
          waveform_min: visual_waveform_min,
          waveform_max: visual_waveform_max,
          spectrum_smooth_db: smooth.clone(),
          vectorscope_pairs: vs_pairs,
          correlation: visual_corr,
        })
      } else {
        None
      }
    };

    let dialogue_integrated = lb
      .as_ref()
      .map(|l| l.dialogue_integrated)
      .unwrap_or(f64::NEG_INFINITY);
    let dialogue_percent = lb.as_ref().map(|l| l.dialogue_percent).unwrap_or(0.0);
    let dialogue_lra = lb.as_ref().map(|l| l.dialogue_lra).unwrap_or(0.0);

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
      visual_hist_tick,
      dialogue_integrated,
      dialogue_percent,
      dialogue_lra,
      dialogue_active_now: self.last_dialogue_gating && self.loudness.speech_now(),
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
  use crate::dsp::SpectrumChannelSel;

  fn tone_on_channel(frames: usize, channels: usize, sr: f64, hz: f64, ch: usize) -> Vec<f32> {
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32;
      pcm[i * channels + ch] = s;
    }
    pcm
  }

  #[test]
  fn changing_spectrum_channel_resets_frequency_meter() {
    let sr = 48_000_u32;
    let channels = 6_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);
    let pcm_lr = tone_on_channel(4096 * 8, channels as usize, sr as f64, 1000.0, 0);
    let pcm_c_short = tone_on_channel(256, channels as usize, sr as f64, 500.0, 2);

    let _ = pipeline.push_pcm_f32(
      &pcm_lr,
      (0, 1),
      ChannelLayoutSetting::Auto,
      SpectrumChannelSel::Pair(0, 1),
      None,
      false,
    );
    let (_, before_change, _) = pipeline.spectrum.last_output();
    assert!(
      !before_change.is_empty(),
      "spectrum should produce output before the channel change"
    );

    let _ = pipeline.push_pcm_f32(
      &pcm_c_short,
      (0, 1),
      ChannelLayoutSetting::Auto,
      SpectrumChannelSel::Single(2),
      None,
      false,
    );
    let (_, immediately_after_change, _) = pipeline.spectrum.last_output();
    assert!(
      immediately_after_change.is_empty(),
      "spectrum output should be reset immediately after selecting a new channel"
    );
  }

  #[test]
  fn vectorscope_pair_selects_requested_channels() {
    // 3 channels, 2 frames:
    // frame0: [0.1, 0.2, 0.3]
    // frame1: [1.1, 1.2, 1.3]
    let pcm = vec![0.1_f32, 0.2, 0.3, 1.1, 1.2, 1.3];
    let mut p = MeterPipeline::new(48_000, 3);
    let _ = p.push_pcm_f32(
      &pcm,
      (2, 0),
      crate::engine::ChannelLayoutSetting::Auto,
      crate::dsp::SpectrumChannelSel::default(),
      None,
      false,
    );
    // Last pushed sample should be from frame1 ch2 (L) and ch0 (R) in the vectorscope ring.
    assert_eq!(p.vectorscope.vs_l.back().copied().unwrap_or_default(), 1.3);
    assert_eq!(p.vectorscope.vs_r.back().copied().unwrap_or_default(), 1.1);
  }

  #[test]
  fn dynamic_loudness_weights_report_custom_layout() {
    let sr = 48_000_u32;
    let channels = 3_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);
    let frames = 4_800usize;
    let pcm = vec![0.1_f32; frames * channels as usize];
    let (frame, _) = pipeline.push_pcm_f32(
      &pcm,
      (0, 1),
      ChannelLayoutSetting::Auto,
      SpectrumChannelSel::default(),
      Some(vec![1.0, 1.0, 0.0]),
      false,
    );
    let frame = frame.expect("100ms chunk should emit a frame");
    assert_eq!(frame.loudness_layout, "custom");
    assert!(frame.loudness_layout_known);
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
  fn auto_layout_meta_5ch_is_50() {
    assert_eq!(
      loudness_layout_meta(5, ChannelLayoutSetting::Auto),
      ("5.0".to_string(), true)
    );
  }

  #[test]
  fn auto_layout_meta_7ch_is_70() {
    assert_eq!(
      loudness_layout_meta(7, ChannelLayoutSetting::Auto),
      ("7.0".to_string(), true)
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
  fn history_entry_captures_waveform_min_max_per_channel() {
    let sr = 48_000_u32;
    let channels = 2_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);

    // 200ms of a 100Hz sine on L, inverted on R, amplitude 0.7
    let frames = sr as usize / 5;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 100.0 * i as f64 / sr as f64).sin() as f32 * 0.7;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = -s;
    }

    // Feed 5 × 200ms = 1s to guarantee history ticks are emitted on the frame stream
    let mut entries = Vec::new();
    for _ in 0..5 {
      let (frame, _) = pipeline.push_pcm_f32(
        &pcm,
        (0, 1),
        ChannelLayoutSetting::Auto,
        SpectrumChannelSel::default(),
        None,
        false,
      );
      if let Some(tick) = frame.and_then(|f| f.loudness_hist_tick) {
        entries.push(tick);
      }
    }

    assert!(!entries.is_empty(), "must emit at least one history entry");
    let e = &entries[0];
    assert_eq!(
      e.waveform_min.len(),
      2,
      "waveform_min length == channel count"
    );
    assert_eq!(
      e.waveform_max.len(),
      2,
      "waveform_max length == channel count"
    );
    assert!(
      e.waveform_max[0] > 0.5,
      "L max should capture positive peaks, got {}",
      e.waveform_max[0]
    );
    assert!(
      e.waveform_min[0] < -0.5,
      "L min should capture negative troughs, got {}",
      e.waveform_min[0]
    );
    assert!(e.waveform_max[1] > 0.5, "R max, got {}", e.waveform_max[1]);
    assert!(e.waveform_min[1] < -0.5, "R min, got {}", e.waveform_min[1]);
  }

  #[test]
  fn dialogue_percent_resets_when_gating_toggles_off_then_on() {
    let sr = 48_000_u32;
    let mut p = MeterPipeline::new(sr, 2);
    let frames = sr as usize / 10;
    let tone: Vec<f32> = (0..frames)
      .flat_map(|i| {
        let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr as f64).sin() as f32 * 0.5;
        [s, s]
      })
      .collect();
    let _ = p.push_pcm_f32(
      &tone,
      (0, 1),
      ChannelLayoutSetting::Auto,
      SpectrumChannelSel::default(),
      None,
      true,
    );
    let _ = p.push_pcm_f32(
      &tone,
      (0, 1),
      ChannelLayoutSetting::Auto,
      SpectrumChannelSel::default(),
      None,
      false,
    );
    let (frame, _) = p.push_pcm_f32(
      &tone,
      (0, 1),
      ChannelLayoutSetting::Auto,
      SpectrumChannelSel::default(),
      None,
      true,
    );
    let block = frame.expect("frame");
    assert_eq!(block.dialogue_percent, 0.0);
    assert!(!block.dialogue_integrated.is_finite());
  }

  #[test]
  fn frame_payload_has_dialogue_active_now_default_false_on_silence() {
    let sr = 48_000_u32;
    let mut p = MeterPipeline::new(sr, 2);
    let frames = sr as usize / 10;
    let silence = vec![0.0_f32; frames * 2];
    let mut seen = false;
    for _ in 0..3 {
      if let (Some(f), _) = p.push_pcm_f32(&silence, (0, 1), ChannelLayoutSetting::Auto, SpectrumChannelSel::default(), None, true) {
        assert!(!f.dialogue_active_now, "silence must not be active speech");
        assert_eq!(f.dialogue_lra, 0.0, "no speech yet → dialogue lra 0.0");
        seen = true;
      }
    }
    assert!(seen, "a frame should be emitted");
  }

  #[test]
  fn auto_mode_6ch_uses_51_loudness_layout() {
    let sr = 48000_u32;
    let channels = 6_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);

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
      if let (Some(f), _) = pipeline.push_pcm_f32(
        &pcm,
        (0, 1),
        ChannelLayoutSetting::Auto,
        crate::dsp::SpectrumChannelSel::default(),
        None,
        false,
      ) {
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
