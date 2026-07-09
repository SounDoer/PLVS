//! PCM 鈫?meters; drives the `AudioFramePayload` emit rate.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use crate::dsp::loudness::LoudnessBlock;
use crate::dsp::paths::spectrum_paths_from_bands;
use crate::dsp::peak::{
  sample_peak_db_interleaved, sample_peak_db_mono, sample_peak_db_per_channel_interleaved,
  RmsWindow,
};
use crate::dsp::speech::VadEngineKind;
use crate::dsp::{
  LoudnessMeter, Meter, PcmContext, SpectrumChannelSel, SpectrumMeter, SpectrumView,
  VectorscopeMeter,
};
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::{
  AnalysisRequests, AudioFramePayload, MeterHistoryEntry, SpectrumAnalysisChannel,
  SpectrumFrameResult, SpectrumVisualEntry, VectorscopeFrameResult, VectorscopeVisualEntry,
  VisualHistEntry,
};

const FRAME_EMIT_MS: u128 = 16;
/// Match `useAudioEngine.js` HIST_PUSH_MS / `App.jsx` HIST_SAMPLE_SEC cadence (~10 Hz).
const HIST_EMIT_MS: u128 = 95;
const VISUAL_EMIT_MS: u128 = 40;
const VS_HISTORY_POINTS: usize = 200;
/// PCM samples per waveform sub-block. ~19 sub-blocks per ~100ms tick @48kHz.
const SUBBLOCK_SAMPLES: usize = 256;
const RMS_WINDOW_MS: u32 = 400;

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

fn spectrum_result_from_meter(meter: &SpectrumMeter) -> SpectrumFrameResult {
  let (centers, smooth, peak) = meter.last_output();
  let (path, peak_path) = if !centers.is_empty() && smooth.len() == centers.len() {
    let pk = if peak.len() == centers.len() {
      peak
    } else {
      smooth
    };
    spectrum_paths_from_bands(centers, smooth, pk, true)
  } else {
    (String::new(), String::new())
  };
  let (path_b, peak_path_b, smooth_db_b, peak_db_b): (String, String, Vec<f64>, Vec<f64>) =
    match meter.last_output_secondary() {
      Some((smooth_b, peak_b)) if smooth_b.len() == centers.len() && !centers.is_empty() => {
        let pkb = if peak_b.len() == centers.len() {
          peak_b
        } else {
          smooth_b
        };
        let (path_b, peak_path_b) = spectrum_paths_from_bands(centers, smooth_b, pkb, true);
        (path_b, peak_path_b, smooth_b.to_vec(), pkb.to_vec())
      }
      _ => (String::new(), String::new(), Vec::new(), Vec::new()),
    };

  SpectrumFrameResult {
    path,
    peak_path,
    path_b,
    peak_path_b,
    band_centers_hz: centers.to_vec(),
    smooth_db: smooth.to_vec(),
    peak_db: peak.to_vec(),
    smooth_db_b,
    peak_db_b,
  }
}

fn spectrum_request_selection(
  request: &crate::ipc::types::SpectrumAnalysisRequest,
) -> (SpectrumChannelSel, SpectrumView) {
  let channel = match &request.channel {
    SpectrumAnalysisChannel::Pair { x, y } => SpectrumChannelSel::Pair(*x, *y),
    SpectrumAnalysisChannel::Single { ch } => SpectrumChannelSel::Single(*ch),
  };
  let view = match request.view.as_str() {
    "lr" => SpectrumView::Lr,
    "ms" => SpectrumView::Ms,
    _ => SpectrumView::Combined,
  };
  (channel, view)
}

pub struct MeterPipeline {
  sample_rate: f64,
  channels: u16,
  loudness: LoudnessMeter,
  spectrum_by_key: HashMap<String, SpectrumMeter>,
  vectorscope_by_key: HashMap<String, VectorscopeMeter>,
  last_loudness_weights: Option<Vec<f64>>,
  last_loudness: Option<LoudnessBlock>,
  m_max: f64,
  st_max: f64,
  tp_max_db: f64,
  sample_peak_max_l: f64,
  sample_peak_max_r: f64,
  rms_window: RmsWindow,
  t0: Instant,
  last_frame_emit: Instant,
  last_hist_emit: Instant,
  pending_loudness_hist: Option<(f64, f64)>,
  /// Running per-channel min since last history tick. Sentinel INFINITY = no samples seen yet.
  /// Reset is coupled to `pending_loudness_hist`: the span may exceed `HIST_EMIT_MS` at stream
  /// start if no loudness block has been produced yet.
  waveform_min_acc: Vec<f32>,
  /// Running per-channel max since last history tick. Sentinel NEG_INFINITY = no samples seen yet.
  waveform_max_acc: Vec<f32>,
  /// Flat row-major sub-block (min, max) pairs accumulated since the last history tick:
  /// [min_ch0, max_ch0, ...] per completed sub-block. Reused across ticks (taken on emit).
  waveform_sub_acc: Vec<f32>,
  /// Sample counter within the in-progress sub-block (0..SUBBLOCK_SAMPLES).
  waveform_sub_idx: usize,
  /// Running per-channel (min, max) for the in-progress sub-block, flat, len = 2 * channels.
  waveform_sub_cur: Vec<f32>,
  last_visual_emit: Instant,
  /// Running per-channel min since last visual tick. Sentinel INFINITY = no samples seen yet.
  visual_waveform_min_acc: Vec<f32>,
  /// Running per-channel max since last visual tick.
  visual_waveform_max_acc: Vec<f32>,
  last_dialogue_gating: bool,
  last_dialogue_vad_engine: VadEngineKind,
  /// Whether this pipeline instance was created for offline file analysis.
  file_timing: bool,
  /// When set (during `push_pcm_f32_with_requests_at_media_time`), overrides all emitted
  /// timestamps with the supplied media time.
  current_media_time_ms: Option<u64>,
  /// File mode: queued (momentary_lufs, short_term_lufs, media_time_ms) between frame emits.
  pending_file_loudness_queue: Vec<(f64, f64, u64, Vec<f64>)>,
  /// File mode: queued visual tick media timestamps between frame emits.
  pending_file_visual_queue: Vec<u64>,
  /// File mode: media time (ms) of the last queued loudness tick; gates tick cadence by media time
  /// instead of wall clock (offline decode runs far faster than real time). `None` = none queued yet.
  last_hist_media_ms: Option<u64>,
  /// File mode: media time (ms) of the last queued visual tick. See `last_hist_media_ms`.
  last_visual_media_ms: Option<u64>,
}

pub struct PipelineSummary {
  pub integrated_lufs: f64,
  pub lra: f64,
  pub m_max_lufs: f64,
  pub st_max_lufs: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_peak_max_l_db: f64,
  pub sample_peak_max_r_db: f64,
  pub dialogue_integrated: f64,
  pub dialogue_lra: f64,
}

impl MeterPipeline {
  pub fn new(sample_rate: u32, channels: u16) -> Self {
    let sr = sample_rate as f64;
    let pipeline = Self {
      sample_rate: sr,
      channels,
      loudness: LoudnessMeter::new(sr),
      spectrum_by_key: HashMap::new(),
      vectorscope_by_key: HashMap::new(),
      last_loudness_weights: None,
      last_loudness: None,
      m_max: f64::NEG_INFINITY,
      st_max: f64::NEG_INFINITY,
      tp_max_db: f64::NEG_INFINITY,
      sample_peak_max_l: f64::NEG_INFINITY,
      sample_peak_max_r: f64::NEG_INFINITY,
      rms_window: RmsWindow::new(sample_rate, channels, RMS_WINDOW_MS),
      t0: Instant::now(),
      last_frame_emit: Instant::now(),
      last_hist_emit: Instant::now() - std::time::Duration::from_millis(200),
      pending_loudness_hist: None,
      waveform_min_acc: vec![f32::INFINITY; channels.max(1) as usize],
      waveform_max_acc: vec![f32::NEG_INFINITY; channels.max(1) as usize],
      waveform_sub_acc: Vec::new(),
      waveform_sub_idx: 0,
      waveform_sub_cur: {
        let ch = channels.max(1) as usize;
        let mut v = vec![0.0_f32; 2 * ch];
        for c in 0..ch {
          v[2 * c] = f32::INFINITY;
          v[2 * c + 1] = f32::NEG_INFINITY;
        }
        v
      },
      last_visual_emit: Instant::now() - std::time::Duration::from_millis(200),
      visual_waveform_min_acc: vec![f32::INFINITY; channels.max(1) as usize],
      visual_waveform_max_acc: vec![f32::NEG_INFINITY; channels.max(1) as usize],
      last_dialogue_gating: false,
      last_dialogue_vad_engine: VadEngineKind::default(),
      file_timing: false,
      current_media_time_ms: None,
      pending_file_loudness_queue: Vec::new(),
      pending_file_visual_queue: Vec::new(),
      last_hist_media_ms: None,
      last_visual_media_ms: None,
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
    self.t0 = Instant::now();
    self.last_hist_emit = Instant::now() - std::time::Duration::from_millis(200);
    self.m_max = f64::NEG_INFINITY;
    self.st_max = f64::NEG_INFINITY;
    self.tp_max_db = f64::NEG_INFINITY;
    self.sample_peak_max_l = f64::NEG_INFINITY;
    self.sample_peak_max_r = f64::NEG_INFINITY;
    self.rms_window.reset();
    self.loudness.reset();
    for meter in self.spectrum_by_key.values_mut() {
      meter.reset();
    }
    for meter in self.vectorscope_by_key.values_mut() {
      meter.reset();
    }
    self.last_loudness = None;
    self.waveform_min_acc.fill(f32::INFINITY);
    self.waveform_max_acc.fill(f32::NEG_INFINITY);
    self.waveform_sub_acc.clear();
    self.waveform_sub_idx = 0;
    for c in 0..(self.channels.max(1) as usize) {
      self.waveform_sub_cur[2 * c] = f32::INFINITY;
      self.waveform_sub_cur[2 * c + 1] = f32::NEG_INFINITY;
    }
    self.visual_waveform_min_acc.fill(f32::INFINITY);
    self.visual_waveform_max_acc.fill(f32::NEG_INFINITY);
    self.last_visual_emit = Instant::now() - std::time::Duration::from_millis(200);
    self.last_hist_media_ms = None;
    self.last_visual_media_ms = None;
  }

  /// Resets only the session True Peak Max hold, leaving momentary/short-term/sample-peak
  /// maxima and history accumulators untouched (per-metric reset, e.g. click on the TP Max
  /// marker).
  pub fn reset_true_peak_max(&mut self) {
    self.tp_max_db = f64::NEG_INFINITY;
  }

  /// Create a pipeline configured for offline file analysis. Timestamps on emitted frames and
  /// history ticks are driven by the caller-supplied media time rather than wall-clock elapsed.
  pub fn new_for_file(sample_rate: u32, channels: u16) -> Self {
    let mut pipeline = Self::new(sample_rate, channels);
    pipeline.file_timing = true;
    // Pre-expire the frame emit timer so the first push can emit a frame immediately,
    // even before 16 ms of wall-clock time has elapsed (offline decoding is faster than real-time).
    pipeline.last_frame_emit =
      Instant::now() - std::time::Duration::from_millis(FRAME_EMIT_MS as u64 + 1);
    pipeline
  }

  // File mode overrides only the emitted/stored timestamps with media time. The DSP's internal
  // `now_sec` (used for Spectrum temporal smoothing and peak-hold decay) intentionally stays
  // wall-clock: in file mode it advances slower than media time, so those visual decays look
  // under-decayed/"frozen". That is acceptable because the authoritative metrics (integrated
  // loudness, LRA, true/sample peak) are sample-driven and unaffected by decode speed. Do not
  // retime `now_sec` to media time in this slice.
  fn timestamp_ms(&self) -> u64 {
    self
      .current_media_time_ms
      .unwrap_or_else(|| self.t0.elapsed().as_millis() as u64)
  }

  pub fn summary_metrics(&self) -> PipelineSummary {
    let (integrated_lufs, lra, dialogue_integrated, dialogue_lra) = match &self.last_loudness {
      Some(l) => (l.integrated, l.lra, l.dialogue_integrated, l.dialogue_lra),
      None => (f64::NEG_INFINITY, 0.0, f64::NEG_INFINITY, 0.0),
    };
    PipelineSummary {
      integrated_lufs,
      lra,
      m_max_lufs: self.m_max,
      st_max_lufs: self.st_max,
      true_peak_max_dbtp: self.tp_max_db,
      sample_peak_max_l_db: self.sample_peak_max_l,
      sample_peak_max_r_db: self.sample_peak_max_r,
      dialogue_integrated,
      dialogue_lra,
    }
  }

  pub fn push_pcm_f32_with_requests(
    &mut self,
    interleaved: &[f32],
    channel_layout: ChannelLayoutSetting,
    analysis_requests: &AnalysisRequests,
    loudness_weights: Option<Vec<f64>>,
    dialogue_gating: bool,
    dialogue_vad_engine: VadEngineKind,
  ) -> Option<AudioFramePayload> {
    let now_sec = self.t0.elapsed().as_secs_f64();
    let ch = self.channels.max(1);
    let effective_layout = match channel_layout {
      ChannelLayoutSetting::Auto => match ch {
        6 => ChannelLayoutSetting::Surround51,
        8 => ChannelLayoutSetting::Surround71,
        _ => channel_layout,
      },
      other => other,
    };

    let active_spectrum_keys: HashSet<&str> = analysis_requests
      .spectrum
      .iter()
      .map(|request| request.key.as_str())
      .collect();
    self
      .spectrum_by_key
      .retain(|key, _| active_spectrum_keys.contains(key.as_str()));
    let active_vectorscope_keys: HashSet<&str> = analysis_requests
      .vectorscope
      .iter()
      .map(|request| request.key.as_str())
      .collect();
    self
      .vectorscope_by_key
      .retain(|key, _| active_vectorscope_keys.contains(key.as_str()));

    let mut spectrum_results_by_key = HashMap::new();
    for request in &analysis_requests.spectrum {
      let (spectrum_channel, spectrum_view) = spectrum_request_selection(request);
      let meter = self
        .spectrum_by_key
        .entry(request.key.clone())
        .or_insert_with(|| SpectrumMeter::new(self.sample_rate));
      meter.set_display_controls(request.smoothing_percent, request.tilt_db_per_octave);
      let ctx = PcmContext {
        interleaved,
        channels: ch,
        now_sec,
        channel_layout: effective_layout,
        loudness_weights: loudness_weights.clone(),
        vectorscope_pair: (0, 1),
        spectrum_channel,
        spectrum_view,
        dialogue_gating,
        dialogue_vad_engine,
      };
      meter.push_pcm(&ctx);
      spectrum_results_by_key.insert(request.key.clone(), spectrum_result_from_meter(meter));
    }

    let mut vectorscope_results_by_key = HashMap::new();
    for request in &analysis_requests.vectorscope {
      let meter = self
        .vectorscope_by_key
        .entry(request.key.clone())
        .or_default();
      let ctx = PcmContext {
        interleaved,
        channels: ch,
        now_sec,
        channel_layout: effective_layout,
        loudness_weights: loudness_weights.clone(),
        vectorscope_pair: (request.x, request.y),
        spectrum_channel: SpectrumChannelSel::default(),
        spectrum_view: SpectrumView::default(),
        dialogue_gating,
        dialogue_vad_engine,
      };
      meter.push_pcm(&ctx);
      let (metrics, path) = meter.get_output();
      vectorscope_results_by_key.insert(
        request.key.clone(),
        VectorscopeFrameResult {
          path,
          correlation: metrics.correlation,
          side_to_mid_db: metrics.side_to_mid_db,
          mid_energy: metrics.mid_energy,
          side_energy: metrics.side_energy,
          pair_x: request.x,
          pair_y: request.y,
        },
      );
    }

    let vectorscope_pair = analysis_requests
      .vectorscope
      .first()
      .map(|request| (request.x, request.y));
    let primary_vectorscope_summary = analysis_requests.vectorscope.first().and_then(|request| {
      vectorscope_results_by_key.get(&request.key).map(|result| {
        (
          result.pair_x,
          result.pair_y,
          result.correlation,
          result.side_to_mid_db,
        )
      })
    });
    let mut frame = self.push_pcm_f32_optional(
      interleaved,
      channel_layout,
      primary_vectorscope_summary
        .or_else(|| vectorscope_pair.map(|(x, y)| (x, y, 0.0, f64::NEG_INFINITY))),
      loudness_weights,
      dialogue_gating,
      dialogue_vad_engine,
    )?;
    frame.spectrum_results_by_key = spectrum_results_by_key;
    frame.vectorscope_results_by_key = vectorscope_results_by_key;

    // When this frame carries a visual history tick, attach per-request-key samples so the
    // frontend can keep request-keyed snapshot history. Only active request keys are emitted;
    // retention of inactive keys is the frontend's responsibility (it never deletes a key ring
    // until Clear).
    // Build the per-key samples once from the current meter snapshots, then stamp them onto the
    // visual history carrier. Live mode carries a single `visual_hist_tick`; file mode carries a
    // `visual_hist_batch` whose entries share this frame's snapshot (coarse but present 鈥?same as the
    // non-keyed `spectrum_smooth_db`). Without this, request-keyed panels (Spectrogram, and scrubbed
    // Spectrum/Vectorscope) have no history in file mode.
    let spectrum_by_key: Vec<(String, SpectrumVisualEntry)> = analysis_requests
      .spectrum
      .iter()
      .filter_map(|request| {
        self.spectrum_by_key.get(&request.key).map(|meter| {
          let (centers, smooth, _peak) = meter.last_output();
          let smooth_db_b = meter
            .last_output_secondary()
            .map(|(smooth_b, _)| smooth_b.to_vec())
            .unwrap_or_default();
          (
            request.key.clone(),
            SpectrumVisualEntry {
              band_centers_hz: centers.to_vec(),
              smooth_db: smooth.to_vec(),
              smooth_db_b,
            },
          )
        })
      })
      .collect();
    let vectorscope_by_key: Vec<(String, VectorscopeVisualEntry)> = analysis_requests
      .vectorscope
      .iter()
      .filter_map(|request| {
        self.vectorscope_by_key.get_mut(&request.key).map(|meter| {
          let (metrics, pairs) = meter.get_history_pairs(VS_HISTORY_POINTS);
          (
            request.key.clone(),
            VectorscopeVisualEntry {
              pairs,
              correlation: metrics.correlation,
              side_to_mid_db: metrics.side_to_mid_db,
              mid_energy: metrics.mid_energy,
              side_energy: metrics.side_energy,
            },
          )
        })
      })
      .collect();

    if let Some(entry) = frame.visual_hist_tick.as_mut() {
      entry.spectrum_by_key = spectrum_by_key.iter().cloned().collect();
      entry.vectorscope_by_key = vectorscope_by_key.iter().cloned().collect();
    }
    if !frame.visual_hist_batch.is_empty()
      && (!spectrum_by_key.is_empty() || !vectorscope_by_key.is_empty())
    {
      for entry in frame.visual_hist_batch.iter_mut() {
        entry.spectrum_by_key = spectrum_by_key.iter().cloned().collect();
        entry.vectorscope_by_key = vectorscope_by_key.iter().cloned().collect();
      }
    }

    Some(frame)
  }

  /// File-analysis variant: sets the current media time before pushing PCM so all emitted
  /// timestamps (frame, loudness history, visual history) reflect the decoded position.
  #[allow(clippy::too_many_arguments)]
  pub fn push_pcm_f32_with_requests_at_media_time(
    &mut self,
    interleaved: &[f32],
    channel_layout: ChannelLayoutSetting,
    analysis_requests: &AnalysisRequests,
    loudness_weights: Option<Vec<f64>>,
    dialogue_gating: bool,
    dialogue_vad_engine: VadEngineKind,
    media_time_ms: u64,
  ) -> Option<AudioFramePayload> {
    self.current_media_time_ms = Some(media_time_ms);
    let frame = self.push_pcm_f32_with_requests(
      interleaved,
      channel_layout,
      analysis_requests,
      loudness_weights,
      dialogue_gating,
      dialogue_vad_engine,
    );
    self.current_media_time_ms = None;
    frame
  }

  /// Drain any buffered file-mode history ticks into a final frame after end-of-stream.
  /// Returns `None` if not in file mode or if both queues are empty.
  ///
  /// Takes the live `analysis_requests` so the flushed frame carries real per-request-key
  /// spectrum/vectorscope results (each meter's retained last_output). Passing empty requests here
  /// would clear `spectrum_results_by_key`/`vectorscope_results_by_key`, leaving the post-completion
  /// "latest" view blank for the request-keyed Spectrum/Vectorscope panels.
  pub fn flush_file_batch(
    &mut self,
    analysis_requests: &AnalysisRequests,
  ) -> Option<AudioFramePayload> {
    if !self.file_timing {
      return None;
    }
    if self.pending_file_loudness_queue.is_empty() && self.pending_file_visual_queue.is_empty() {
      return None;
    }
    // Force the wall-clock throttle to expire so the next push assembles and emits a frame.
    self.last_frame_emit =
      Instant::now() - std::time::Duration::from_millis(FRAME_EMIT_MS as u64 + 1);
    // Push empty PCM through the normal path; DSP state is unchanged (no samples), so each meter's
    // last_output is retained, and the frame assembly code drains both batch queues into the payload.
    self.push_pcm_f32_with_requests(
      &[],
      ChannelLayoutSetting::Auto,
      analysis_requests,
      self.last_loudness_weights.clone(),
      self.last_dialogue_gating,
      self.last_dialogue_vad_engine,
    )
  }

  #[allow(clippy::too_many_arguments)]
  fn push_pcm_f32_optional(
    &mut self,
    interleaved: &[f32],
    channel_layout: ChannelLayoutSetting,
    vectorscope_summary: Option<(u16, u16, f64, f64)>,
    loudness_weights: Option<Vec<f64>>,
    dialogue_gating: bool,
    dialogue_vad_engine: VadEngineKind,
  ) -> Option<AudioFramePayload> {
    let now_sec = self.t0.elapsed().as_secs_f64();
    let ch = self.channels.max(1);
    let (pair_x, pair_y) = vectorscope_summary
      .map(|(x, y, _, _)| (x, y))
      .unwrap_or((0, 1));

    if dialogue_gating != self.last_dialogue_gating {
      self.loudness.reset_dialogue();
      self.last_dialogue_gating = dialogue_gating;
    }
    if dialogue_vad_engine != self.last_dialogue_vad_engine {
      self.loudness.reset_dialogue();
      self.last_dialogue_vad_engine = dialogue_vad_engine;
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

    // --- PCM intake: uniform push through Meter trait ---
    let ctx = PcmContext {
      interleaved,
      channels: ch,
      now_sec,
      channel_layout: effective_layout,
      loudness_weights,
      vectorscope_pair: (pair_x, pair_y),
      spectrum_channel: SpectrumChannelSel::default(),
      spectrum_view: SpectrumView::default(),
      dialogue_gating,
      dialogue_vad_engine,
    };
    self.loudness.push_pcm(&ctx);
    self.rms_window.push_interleaved(interleaved, ch);

    // --- Apply loudness block if a new one arrived ---
    if let Some(lb) = self.loudness.take_block() {
      self.apply_loudness_block(&lb);
    }

    // --- Sample peak (stereo L/R for history) ---
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
      for c in 0..ch_usize {
        if 2 * c + 1 < self.waveform_sub_cur.len() {
          let s = interleaved[base + c];
          if s < self.waveform_sub_cur[2 * c] {
            self.waveform_sub_cur[2 * c] = s;
          }
          if s > self.waveform_sub_cur[2 * c + 1] {
            self.waveform_sub_cur[2 * c + 1] = s;
          }
        }
      }
      self.waveform_sub_idx += 1;
      if self.waveform_sub_idx >= SUBBLOCK_SAMPLES {
        self
          .waveform_sub_acc
          .extend_from_slice(&self.waveform_sub_cur);
        for c in 0..ch_usize {
          self.waveform_sub_cur[2 * c] = f32::INFINITY;
          self.waveform_sub_cur[2 * c + 1] = f32::NEG_INFINITY;
        }
        self.waveform_sub_idx = 0;
      }
    }

    // In file mode, queue visual ticks instead of emitting them inline. Gate by MEDIA time, not wall
    // clock (offline decode runs far faster than real time; see apply_loudness_block). The batch is
    // drained when the frame throttle allows a frame to be emitted.
    if self.file_timing {
      let ts = self.timestamp_ms();
      let advanced = match self.last_visual_media_ms {
        Some(last) => ts.saturating_sub(last) >= VISUAL_EMIT_MS as u64,
        None => true,
      };
      if advanced {
        self.last_visual_media_ms = Some(ts);
        self.pending_file_visual_queue.push(ts);
      }
    }

    // In file mode, pending_loudness_hist is never set (ticks go to pending_file_loudness_queue),
    // so force_frame is always false. The wall-clock throttle governs emit cadence.
    let force_frame = !self.file_timing && self.pending_loudness_hist.is_some();
    if !force_frame && self.last_frame_emit.elapsed().as_millis() < FRAME_EMIT_MS {
      return None;
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

    // Top-level correlation is the shared scalar read by stats/snapshots. In request-keyed mode it
    // is derived from the first vectorscope request instead of recomputing a legacy vectorscope.
    let corr = vectorscope_summary
      .map(|(_, _, correlation, _)| correlation)
      .unwrap_or(0.0);
    let side_to_mid_db = vectorscope_summary
      .map(|(_, _, _, side_to_mid_db)| side_to_mid_db)
      .unwrap_or(f64::NEG_INFINITY);

    let peak_db = sample_peak_db_per_channel_interleaved(interleaved, ch);
    let rms_db = self.rms_window.db_per_channel();
    let peak_hold_db = peak_db.clone();

    let dialogue_integrated = lb
      .as_ref()
      .map(|l| l.dialogue_integrated)
      .unwrap_or(f64::NEG_INFINITY);
    let dialogue_percent = lb.as_ref().map(|l| l.dialogue_percent).unwrap_or(0.0);
    let dialogue_lra = lb.as_ref().map(|l| l.dialogue_lra).unwrap_or(0.0);

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
      // Flush the final incomplete sub-block so no samples are lost.
      if self.waveform_sub_idx > 0 {
        self
          .waveform_sub_acc
          .extend_from_slice(&self.waveform_sub_cur);
        for c in 0..ch_usize {
          self.waveform_sub_cur[2 * c] = f32::INFINITY;
          self.waveform_sub_cur[2 * c + 1] = f32::NEG_INFINITY;
        }
        self.waveform_sub_idx = 0;
      }
      let stride = 2 * ch_usize;
      let waveform_sub_count = self.waveform_sub_acc.len().checked_div(stride).unwrap_or(0) as u32;
      let mut waveform_sub_pairs = std::mem::take(&mut self.waveform_sub_acc);
      for v in waveform_sub_pairs.iter_mut() {
        if !v.is_finite() {
          *v = 0.0;
        }
      }
      let entry = MeterHistoryEntry {
        timestamp_ms: self.timestamp_ms(),
        rms_db: rms_db.clone(),
        lufs_momentary: m,
        lufs_short_term: st,
        lufs_m_max: self.m_max,
        lufs_st_max: self.st_max,
        integrated: integ,
        lra,
        dialogue_integrated,
        dialogue_percent,
        dialogue_lra,
        dialogue_active_now: self.last_dialogue_gating && self.loudness.speech_now(),
        true_peak_l: tpl,
        true_peak_r: tpr,
        true_peak_max_dbtp: self.tp_max_db,
        sample_l_db: sl,
        sample_r_db: sr,
        sample_peak_max_l: self.sample_peak_max_l,
        sample_peak_max_r: self.sample_peak_max_r,
        correlation: corr,
        side_to_mid_db,
        vectorscope_pair_x: pair_x,
        vectorscope_pair_y: pair_y,
        loudness_layout: loudness_layout.clone(),
        loudness_layout_known,
        waveform_min,
        waveform_max,
        waveform_sub_pairs,
        waveform_sub_count,
      };
      Some(entry)
    } else {
      None
    };

    let visual_hist_tick = {
      let now = Instant::now();
      // In file mode, visual ticks were already queued into pending_file_visual_queue above.
      if !self.file_timing
        && now.duration_since(self.last_visual_emit).as_millis() >= VISUAL_EMIT_MS
      {
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

        let visual_corr = vectorscope_summary
          .map(|(_, _, correlation, _)| correlation)
          .unwrap_or(0.0);
        let visual_side_to_mid_db = vectorscope_summary
          .map(|(_, _, _, side_to_mid_db)| side_to_mid_db)
          .unwrap_or(f64::NEG_INFINITY);

        Some(VisualHistEntry {
          timestamp_ms: self.timestamp_ms(),
          waveform_min: visual_waveform_min,
          waveform_max: visual_waveform_max,
          correlation: visual_corr,
          side_to_mid_db: visual_side_to_mid_db,
          spectrum_by_key: HashMap::new(),
          vectorscope_by_key: HashMap::new(),
        })
      } else {
        None
      }
    };

    // File mode: drain queued loudness and visual ticks into per-frame batches.
    // Each entry keeps the media-time timestamp that was stamped when it was queued.
    let (loudness_hist_batch, visual_hist_batch) = if self.file_timing {
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
      if self.waveform_sub_idx > 0 {
        self
          .waveform_sub_acc
          .extend_from_slice(&self.waveform_sub_cur);
        for c in 0..ch_usize {
          self.waveform_sub_cur[2 * c] = f32::INFINITY;
          self.waveform_sub_cur[2 * c + 1] = f32::NEG_INFINITY;
        }
        self.waveform_sub_idx = 0;
      }
      let stride = 2 * ch_usize;
      let waveform_sub_count = self.waveform_sub_acc.len().checked_div(stride).unwrap_or(0) as u32;
      let mut waveform_sub_pairs = std::mem::take(&mut self.waveform_sub_acc);
      for v in waveform_sub_pairs.iter_mut() {
        if !v.is_finite() {
          *v = 0.0;
        }
      }

      let mut loudness_batch = Vec::new();
      for (m, st, ts, rms_db_for_tick) in std::mem::take(&mut self.pending_file_loudness_queue) {
        loudness_batch.push(MeterHistoryEntry {
          timestamp_ms: ts,
          rms_db: rms_db_for_tick,
          lufs_momentary: m,
          lufs_short_term: st,
          lufs_m_max: self.m_max,
          lufs_st_max: self.st_max,
          integrated: integ,
          lra,
          dialogue_integrated,
          dialogue_percent,
          dialogue_lra,
          dialogue_active_now: self.last_dialogue_gating && self.loudness.speech_now(),
          true_peak_l: tpl,
          true_peak_r: tpr,
          true_peak_max_dbtp: self.tp_max_db,
          sample_l_db: sl,
          sample_r_db: sr,
          sample_peak_max_l: self.sample_peak_max_l,
          sample_peak_max_r: self.sample_peak_max_r,
          correlation: corr,
          side_to_mid_db,
          vectorscope_pair_x: pair_x,
          vectorscope_pair_y: pair_y,
          loudness_layout: loudness_layout.clone(),
          loudness_layout_known,
          waveform_min: waveform_min.clone(),
          waveform_max: waveform_max.clone(),
          waveform_sub_pairs: waveform_sub_pairs.clone(),
          waveform_sub_count,
        });
      }

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
      let visual_corr = vectorscope_summary
        .map(|(_, _, correlation, _)| correlation)
        .unwrap_or(0.0);
      let visual_side_to_mid_db = vectorscope_summary
        .map(|(_, _, _, side_to_mid_db)| side_to_mid_db)
        .unwrap_or(f64::NEG_INFINITY);
      let mut visual_batch = Vec::new();
      for ts in std::mem::take(&mut self.pending_file_visual_queue) {
        visual_batch.push(VisualHistEntry {
          timestamp_ms: ts,
          waveform_min: visual_waveform_min.clone(),
          waveform_max: visual_waveform_max.clone(),
          correlation: visual_corr,
          side_to_mid_db: visual_side_to_mid_db,
          spectrum_by_key: HashMap::new(),
          vectorscope_by_key: HashMap::new(),
        });
      }
      if !visual_batch.is_empty() {
        self.visual_waveform_min_acc.fill(f32::INFINITY);
        self.visual_waveform_max_acc.fill(f32::NEG_INFINITY);
      }

      (loudness_batch, visual_batch)
    } else {
      (Vec::new(), Vec::new())
    };

    let frame = AudioFramePayload {
      peak_db,
      rms_db,
      peak_hold_db,
      true_peak_max_dbtp: self.tp_max_db,
      lufs_momentary: lm,
      lufs_short_term: lst,
      lufs_m_max: self.m_max,
      lufs_st_max: self.st_max,
      integrated: integ,
      lra,
      true_peak_l: tpl,
      true_peak_r: tpr,
      sample_l_db: sl,
      sample_r_db: sr,
      correlation: corr,
      side_to_mid_db,
      vectorscope_pair_x: pair_x,
      vectorscope_pair_y: pair_y,
      spectrum_results_by_key: HashMap::new(),
      vectorscope_results_by_key: HashMap::new(),
      loudness_layout,
      loudness_layout_known,
      timestamp_ms: self.timestamp_ms(),
      // Assigned by the capture bridge when the frame is actually sent (see run_meter_pipeline_bridge_thread).
      seq: 0,
      loudness_hist_tick,
      visual_hist_tick,
      dialogue_integrated,
      dialogue_percent,
      dialogue_lra,
      dialogue_active_now: self.last_dialogue_gating && self.loudness.speech_now(),
      loudness_hist_batch,
      visual_hist_batch,
    };
    Some(frame)
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
    if self.file_timing {
      // Offline file analysis decodes far faster than real time, so gate history ticks by MEDIA
      // time, not wall clock -- otherwise the whole file collapses into a couple of wall-clock
      // windows and almost every tick is dropped. Queue the tick without forcing a frame; the batch
      // is drained when the frame throttle next allows a frame (or on flush_file_batch).
      let ts = self.timestamp_ms();
      let advanced = match self.last_hist_media_ms {
        Some(last) => ts.saturating_sub(last) >= HIST_EMIT_MS as u64,
        None => true,
      };
      if !advanced {
        return;
      }
      self.last_hist_media_ms = Some(ts);
      self.pending_file_loudness_queue.push((
        lb.momentary,
        lb.short_term,
        ts,
        self.rms_window.db_per_channel(),
      ));
      return;
    }
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

  #[test]
  fn file_mode_frame_uses_supplied_media_time() {
    let sr = 48_000_u32;
    let channels = 2_u16;
    let mut pipeline = MeterPipeline::new_for_file(sr, channels);
    let pcm = vec![0.1_f32; (sr as usize / 10) * channels as usize];
    let requests = AnalysisRequests::default();

    let frame = pipeline
      .push_pcm_f32_with_requests_at_media_time(
        &pcm,
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
        12_345,
      )
      .expect("file frame");

    assert_eq!(frame.timestamp_ms, 12_345);
    // In file mode, loudness ticks go into loudness_hist_batch, not loudness_hist_tick.
    assert!(
      frame.loudness_hist_tick.is_none(),
      "file mode uses batch, not singular tick"
    );
    // The batch carries the accumulated tick with the correct media timestamp.
    assert_eq!(
      frame.loudness_hist_batch.first().map(|e| e.timestamp_ms),
      Some(12_345)
    );
  }

  #[test]
  fn file_mode_history_ticks_track_media_time_not_wall_clock() {
    // Offline decode runs in a tight loop where wall clock barely advances. History ticks must be
    // produced at the media-time cadence and not collapsed into one or two wall-clock windows.
    // Most pushes return None (16 ms frame throttle), so ticks accumulate in the queue and are
    // drained by flush_file_batch -- exactly the real worker's path.
    let sr = 48_000_u32;
    let channels = 2_u16;
    let mut pipeline = MeterPipeline::new_for_file(sr, channels);
    let requests = AnalysisRequests::default();
    let chunk = vec![0.1_f32; (sr as usize / 10) * channels as usize]; // 100 ms of audio

    let chunks = 20_usize;
    let mut loudness_ticks = 0_usize;
    let mut visual_ticks = 0_usize;
    let mut last_ts = 0_u64;
    let tally = |frame: &AudioFramePayload, last_ts: &mut u64| {
      for entry in &frame.loudness_hist_batch {
        assert!(
          entry.timestamp_ms >= *last_ts,
          "tick timestamps must be non-decreasing"
        );
        *last_ts = entry.timestamp_ms;
      }
    };

    for i in 1..=chunks {
      let media_time_ms = (i as u64) * 100;
      if let Some(frame) = pipeline.push_pcm_f32_with_requests_at_media_time(
        &chunk,
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
        media_time_ms,
      ) {
        tally(&frame, &mut last_ts);
        loudness_ticks += frame.loudness_hist_batch.len();
        visual_ticks += frame.visual_hist_batch.len();
      }
    }
    if let Some(frame) = pipeline.flush_file_batch(&requests) {
      tally(&frame, &mut last_ts);
      loudness_ticks += frame.loudness_hist_batch.len();
      visual_ticks += frame.visual_hist_batch.len();
    }

    // ~one tick per 100 ms of media over a 2 s span. Wall-clock gating would yield only 1-2.
    assert!(
      loudness_ticks >= 10,
      "expected many media-time loudness ticks, got {loudness_ticks}"
    );
    assert!(
      visual_ticks >= 10,
      "expected many media-time visual ticks, got {visual_ticks}"
    );
    assert!(
      last_ts >= 1_000,
      "ticks should span most of the media timeline, last={last_ts}"
    );
  }

  fn tone_on_channel(frames: usize, channels: usize, sr: f64, hz: f64, ch: usize) -> Vec<f32> {
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32;
      pcm[i * channels + ch] = s;
    }
    pcm
  }

  fn push_pcm_no_requests(
    pipeline: &mut MeterPipeline,
    interleaved: &[f32],
    channel_layout: ChannelLayoutSetting,
    loudness_weights: Option<Vec<f64>>,
    dialogue_gating: bool,
  ) -> Option<AudioFramePayload> {
    pipeline.push_pcm_f32_with_requests(
      interleaved,
      channel_layout,
      &AnalysisRequests::default(),
      loudness_weights,
      dialogue_gating,
      VadEngineKind::default(),
    )
  }

  #[test]
  fn clear_peak_and_history_resets_live_timestamp_origin() {
    let mut pipeline = MeterPipeline::new(48_000, 2);
    pipeline.t0 = Instant::now() - std::time::Duration::from_secs(3_600);

    assert!(pipeline.timestamp_ms() >= 3_600_000);

    pipeline.clear_peak_and_history();

    assert!(pipeline.timestamp_ms() < 1_000);
  }

  #[test]
  fn changing_spectrum_channel_resets_frequency_meter() {
    use crate::ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};

    let sr = 48_000_u32;
    let channels = 6_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);
    let pcm_lr = tone_on_channel(4096 * 8, channels as usize, sr as f64, 1000.0, 0);
    let pcm_c_short = tone_on_channel(256, channels as usize, sr as f64, 500.0, 2);
    let lr_key = "spectrum:pair:0:1:combined:sm50:tilt450".to_string();
    let c_key = "spectrum:single:2:combined:sm50:tilt450".to_string();
    let requests_lr = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: lr_key.clone(),
        channel: SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
        view: "combined".to_string(),
        smoothing_percent: 50.0,
        tilt_db_per_octave: 4.5,
      }],
      vectorscope: vec![],
    };
    let requests_c = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: c_key.clone(),
        channel: SpectrumAnalysisChannel::Single { ch: 2 },
        view: "combined".to_string(),
        smoothing_percent: 50.0,
        tilt_db_per_octave: 4.5,
      }],
      vectorscope: vec![],
    };

    let _ = pipeline.push_pcm_f32_with_requests(
      &pcm_lr,
      ChannelLayoutSetting::Auto,
      &requests_lr,
      None,
      false,
      VadEngineKind::default(),
    );
    let (_, before_change, _) = pipeline
      .spectrum_by_key
      .get(&lr_key)
      .expect("L/R spectrum meter")
      .last_output();
    assert!(
      !before_change.is_empty(),
      "spectrum should produce output before the channel change"
    );

    let _ = pipeline.push_pcm_f32_with_requests(
      &pcm_c_short,
      ChannelLayoutSetting::Auto,
      &requests_c,
      None,
      false,
      VadEngineKind::default(),
    );
    assert!(
      !pipeline.spectrum_by_key.contains_key(&lr_key),
      "inactive L/R spectrum meter should be pruned after the request key changes"
    );
    let (_, immediately_after_change, _) = pipeline
      .spectrum_by_key
      .get(&c_key)
      .expect("C spectrum meter")
      .last_output();
    assert!(
      immediately_after_change.is_empty(),
      "spectrum output should be reset immediately after selecting a new channel"
    );
  }

  #[test]
  fn vectorscope_pair_selects_requested_channels() {
    use crate::ipc::types::VectorscopeAnalysisRequest;

    // 3 channels, 2 frames:
    // frame0: [0.1, 0.2, 0.3]
    // frame1: [1.1, 1.2, 1.3]
    let pcm = vec![0.1_f32, 0.2, 0.3, 1.1, 1.2, 1.3];
    let mut p = MeterPipeline::new(48_000, 3);
    let key = "vectorscope:pair:2:0".to_string();
    let requests = AnalysisRequests {
      spectrum: vec![],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: key.clone(),
        x: 2,
        y: 0,
      }],
    };
    let _ = p.push_pcm_f32_with_requests(
      &pcm,
      crate::engine::ChannelLayoutSetting::Auto,
      &requests,
      None,
      false,
      VadEngineKind::default(),
    );
    let meter = p.vectorscope_by_key.get(&key).expect("vectorscope meter");
    // Last pushed sample should be from frame1 ch2 (L) and ch0 (R) in the vectorscope ring.
    assert_eq!(meter.vs_l.back().copied().unwrap_or_default(), 1.3);
    assert_eq!(meter.vs_r.back().copied().unwrap_or_default(), 1.1);
  }

  #[test]
  fn empty_analysis_requests_skip_optional_spectrum_and_vectorscope_work() {
    let sr = 48_000_u32;
    let channels = 2_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);
    let frames = sr as usize / 10;
    let pcm: Vec<f32> = (0..frames)
      .flat_map(|i| {
        let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr as f64).sin() as f32;
        [s, s]
      })
      .collect();

    let frame = pipeline
      .push_pcm_f32_with_requests(
        &pcm,
        ChannelLayoutSetting::Auto,
        &AnalysisRequests::default(),
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("100ms chunk should emit a frame");

    assert!(frame.spectrum_results_by_key.is_empty());
    assert!(frame.vectorscope_results_by_key.is_empty());
    assert_eq!(frame.correlation, 0.0);
  }

  #[test]
  fn inactive_keyed_analysis_meters_are_pruned() {
    use crate::ipc::types::{
      SpectrumAnalysisChannel, SpectrumAnalysisRequest, VectorscopeAnalysisRequest,
    };

    let sr = 48_000_u32;
    let channels = 2_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);
    let frames = 4096 * 2;
    let pcm = tone_on_channel(frames, channels as usize, sr as f64, 1000.0, 0);
    let requests_a = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: "spectrum:single:0:combined:sm50:tilt450".to_string(),
        channel: SpectrumAnalysisChannel::Single { ch: 0 },
        view: "combined".to_string(),
        smoothing_percent: 50.0,
        tilt_db_per_octave: 4.5,
      }],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:0:1".to_string(),
        x: 0,
        y: 1,
      }],
    };
    let requests_b = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: "spectrum:single:0:combined:sm25:tilt450".to_string(),
        channel: SpectrumAnalysisChannel::Single { ch: 0 },
        view: "combined".to_string(),
        smoothing_percent: 25.0,
        tilt_db_per_octave: 4.5,
      }],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:1:0".to_string(),
        x: 1,
        y: 0,
      }],
    };

    let _ = pipeline.push_pcm_f32_with_requests(
      &pcm,
      ChannelLayoutSetting::Auto,
      &requests_a,
      None,
      false,
      VadEngineKind::default(),
    );
    assert!(pipeline
      .spectrum_by_key
      .contains_key("spectrum:single:0:combined:sm50:tilt450"));
    assert!(pipeline
      .vectorscope_by_key
      .contains_key("vectorscope:pair:0:1"));

    let _ = pipeline.push_pcm_f32_with_requests(
      &pcm,
      ChannelLayoutSetting::Auto,
      &requests_b,
      None,
      false,
      VadEngineKind::default(),
    );

    assert_eq!(pipeline.spectrum_by_key.len(), 1);
    assert!(pipeline
      .spectrum_by_key
      .contains_key("spectrum:single:0:combined:sm25:tilt450"));
    assert!(!pipeline
      .spectrum_by_key
      .contains_key("spectrum:single:0:combined:sm50:tilt450"));
    assert_eq!(pipeline.vectorscope_by_key.len(), 1);
    assert!(pipeline
      .vectorscope_by_key
      .contains_key("vectorscope:pair:1:0"));
    assert!(!pipeline
      .vectorscope_by_key
      .contains_key("vectorscope:pair:0:1"));
  }

  #[test]
  fn keyed_analysis_requests_emit_multiple_live_results() {
    use crate::ipc::types::{
      SpectrumAnalysisChannel, SpectrumAnalysisRequest, VectorscopeAnalysisRequest,
    };

    let sr = 48_000_u32;
    let channels = 3_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);
    let frames = 4096 * 8;
    let pcm_a = tone_on_channel(frames, channels as usize, sr as f64, 1000.0, 0);
    let pcm_b = tone_on_channel(frames, channels as usize, sr as f64, 500.0, 1);
    let pcm: Vec<f32> = pcm_a.iter().zip(pcm_b.iter()).map(|(a, b)| a + b).collect();
    let requests = AnalysisRequests {
      spectrum: vec![
        SpectrumAnalysisRequest {
          key: "spectrum:single:0:combined:sm50:tilt450".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 0 },
          view: "combined".to_string(),
          smoothing_percent: 50.0,
          tilt_db_per_octave: 4.5,
        },
        SpectrumAnalysisRequest {
          key: "spectrum:single:1:combined:sm50:tilt450".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 1 },
          view: "combined".to_string(),
          smoothing_percent: 50.0,
          tilt_db_per_octave: 4.5,
        },
      ],
      vectorscope: vec![
        VectorscopeAnalysisRequest {
          key: "vectorscope:pair:0:1".to_string(),
          x: 0,
          y: 1,
        },
        VectorscopeAnalysisRequest {
          key: "vectorscope:pair:1:2".to_string(),
          x: 1,
          y: 2,
        },
      ],
    };

    let mut frame = None;
    for _ in 0..4 {
      pipeline.last_frame_emit =
        Instant::now() - std::time::Duration::from_millis(FRAME_EMIT_MS as u64 + 1);
      frame = pipeline.push_pcm_f32_with_requests(
        &pcm,
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      );
    }
    let frame = frame.expect("frame");

    assert_eq!(frame.spectrum_results_by_key.len(), 2);
    assert_eq!(frame.vectorscope_results_by_key.len(), 2);
    assert!(frame
      .spectrum_results_by_key
      .get("spectrum:single:0:combined:sm50:tilt450")
      .is_some_and(|result| !result.smooth_db.is_empty()));
    assert!(frame
      .spectrum_results_by_key
      .get("spectrum:single:1:combined:sm50:tilt450")
      .is_some_and(|result| !result.smooth_db.is_empty()));
    assert!(frame
      .vectorscope_results_by_key
      .get("vectorscope:pair:0:1")
      .is_some_and(|result| !result.path.is_empty()));
    assert!(frame
      .vectorscope_results_by_key
      .get("vectorscope:pair:1:2")
      .is_some_and(|result| !result.path.is_empty()));
  }

  #[test]
  fn keyed_analysis_requests_emit_request_keyed_visual_history() {
    use crate::ipc::types::{
      SpectrumAnalysisChannel, SpectrumAnalysisRequest, VectorscopeAnalysisRequest,
    };

    let sr = 48_000_u32;
    let channels = 3_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);
    let frames = 4096 * 8;
    let pcm_a = tone_on_channel(frames, channels as usize, sr as f64, 1000.0, 0);
    let pcm_b = tone_on_channel(frames, channels as usize, sr as f64, 500.0, 1);
    let pcm: Vec<f32> = pcm_a.iter().zip(pcm_b.iter()).map(|(a, b)| a + b).collect();
    let requests = AnalysisRequests {
      spectrum: vec![
        SpectrumAnalysisRequest {
          key: "spectrum:single:0:combined:sm50:tilt450".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 0 },
          view: "combined".to_string(),
          smoothing_percent: 50.0,
          tilt_db_per_octave: 4.5,
        },
        SpectrumAnalysisRequest {
          key: "spectrum:single:1:combined:sm50:tilt450".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 1 },
          view: "combined".to_string(),
          smoothing_percent: 50.0,
          tilt_db_per_octave: 4.5,
        },
      ],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:0:1".to_string(),
        x: 0,
        y: 1,
      }],
    };

    let mut frame = None;
    for _ in 0..6 {
      pipeline.last_frame_emit =
        Instant::now() - std::time::Duration::from_millis(FRAME_EMIT_MS as u64 + 1);
      // Force a visual tick on each push so the final frame carries a visual hist entry.
      pipeline.last_visual_emit =
        Instant::now() - std::time::Duration::from_millis(VISUAL_EMIT_MS as u64 + 1);
      frame = pipeline.push_pcm_f32_with_requests(
        &pcm,
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      );
    }
    let frame = frame.expect("frame");
    let visual = frame.visual_hist_tick.expect("visual hist tick");

    assert_eq!(visual.spectrum_by_key.len(), 2);
    assert!(visual
      .spectrum_by_key
      .get("spectrum:single:0:combined:sm50:tilt450")
      .is_some_and(|entry| !entry.smooth_db.is_empty()));
    assert!(visual
      .spectrum_by_key
      .get("spectrum:single:1:combined:sm50:tilt450")
      .is_some_and(|entry| !entry.smooth_db.is_empty()));
    assert_eq!(visual.vectorscope_by_key.len(), 1);
    assert!(visual
      .vectorscope_by_key
      .get("vectorscope:pair:0:1")
      .is_some_and(|entry| !entry.pairs.is_empty()));
  }

  #[test]
  fn file_mode_visual_batch_carries_request_keyed_history() {
    // Regression: file mode emits visual_hist_batch (not visual_hist_tick), and the flush frame must
    // pass the real requests. Request-keyed panels (Spectrogram, scrubbed Spectrum/Vectorscope) need
    // per-key samples on every batch entry; otherwise they stay blank in file mode.
    use crate::ipc::types::{
      SpectrumAnalysisChannel, SpectrumAnalysisRequest, VectorscopeAnalysisRequest,
    };

    let sr = 48_000_u32;
    let channels = 2_u16;
    let mut pipeline = MeterPipeline::new_for_file(sr, channels);
    let frames = 4096 * 8;
    let pcm_a = tone_on_channel(frames, channels as usize, sr as f64, 1000.0, 0);
    let pcm_b = tone_on_channel(frames, channels as usize, sr as f64, 500.0, 1);
    let pcm: Vec<f32> = pcm_a.iter().zip(pcm_b.iter()).map(|(a, b)| a + b).collect();
    let requests = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: "spectrum:single:0:combined:sm50:tilt450".to_string(),
        channel: SpectrumAnalysisChannel::Single { ch: 0 },
        view: "combined".to_string(),
        smoothing_percent: 50.0,
        tilt_db_per_octave: 4.5,
      }],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:0:1".to_string(),
        x: 0,
        y: 1,
      }],
    };

    let chunk_ms = ((frames as f64 / sr as f64) * 1000.0) as u64;
    let mut spectrum_entries = 0_usize;
    let mut vectorscope_entries = 0_usize;
    let tally = |frame: &AudioFramePayload, sp: &mut usize, vs: &mut usize| {
      for entry in &frame.visual_hist_batch {
        if entry
          .spectrum_by_key
          .get("spectrum:single:0:combined:sm50:tilt450")
          .is_some_and(|e| !e.smooth_db.is_empty())
        {
          *sp += 1;
        }
        if entry
          .vectorscope_by_key
          .get("vectorscope:pair:0:1")
          .is_some_and(|e| !e.pairs.is_empty())
        {
          *vs += 1;
        }
      }
    };

    for i in 1..=6 {
      if let Some(frame) = pipeline.push_pcm_f32_with_requests_at_media_time(
        &pcm,
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
        (i as u64) * chunk_ms,
      ) {
        tally(&frame, &mut spectrum_entries, &mut vectorscope_entries);
      }
    }
    if let Some(frame) = pipeline.flush_file_batch(&requests) {
      tally(&frame, &mut spectrum_entries, &mut vectorscope_entries);
    }

    assert!(
      spectrum_entries > 0,
      "visual batch entries should carry per-key spectrum"
    );
    assert!(
      vectorscope_entries > 0,
      "visual batch entries should carry per-key vectorscope"
    );
  }

  #[test]
  fn dynamic_loudness_weights_report_custom_layout() {
    let sr = 48_000_u32;
    let channels = 3_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);
    let frames = 4_800usize;
    let pcm = vec![0.1_f32; frames * channels as usize];
    let frame = push_pcm_no_requests(
      &mut pipeline,
      &pcm,
      ChannelLayoutSetting::Auto,
      Some(vec![1.0, 1.0, 0.0]),
      false,
    );
    let frame = frame.expect("100ms chunk should emit a frame");
    assert_eq!(frame.loudness_layout, "custom");
    assert!(frame.loudness_layout_known);
  }

  #[test]
  fn frame_payload_carries_loudness_maxima() {
    let sr = 48_000_u32;
    let channels = 2_u16;
    let mut pipeline = MeterPipeline::new(sr, channels);
    let frames = 4_800usize;
    let sine = |amp: f32| -> Vec<f32> {
      (0..frames)
        .flat_map(|i| {
          let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr as f64).sin() as f32 * amp;
          [s, s]
        })
        .collect()
    };
    let quiet = sine(0.05);
    let louder = sine(0.2);

    let mut quiet_frame = None;
    for _ in 0..40 {
      pipeline.last_frame_emit =
        Instant::now() - std::time::Duration::from_millis(FRAME_EMIT_MS as u64 + 1);
      if let Some(frame) = push_pcm_no_requests(
        &mut pipeline,
        &quiet,
        ChannelLayoutSetting::Auto,
        None,
        false,
      ) {
        quiet_frame = Some(frame);
      }
    }
    let quiet_frame = quiet_frame.expect("quiet frame");
    assert!(quiet_frame.lufs_m_max.is_finite());
    assert!(quiet_frame.lufs_st_max.is_finite());

    let mut louder_frame = None;
    for _ in 0..40 {
      pipeline.last_frame_emit =
        Instant::now() - std::time::Duration::from_millis(FRAME_EMIT_MS as u64 + 1);
      if let Some(frame) = push_pcm_no_requests(
        &mut pipeline,
        &louder,
        ChannelLayoutSetting::Auto,
        None,
        false,
      ) {
        louder_frame = Some(frame);
      }
    }

    let frame = louder_frame.expect("louder frame");
    assert!(
      frame.lufs_m_max.is_finite(),
      "momentary max should be present on frame"
    );
    assert!(
      frame.lufs_st_max.is_finite(),
      "short-term max should be present on frame"
    );
    assert_eq!(frame.lufs_m_max, pipeline.m_max);
    assert_eq!(frame.lufs_st_max, pipeline.st_max);
    assert!(frame.lufs_m_max > quiet_frame.lufs_m_max);
    assert!(frame.lufs_st_max > quiet_frame.lufs_st_max);
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

    // Feed 5 脳 200ms = 1s to guarantee history ticks are emitted on the frame stream
    let mut entries = Vec::new();
    for _ in 0..5 {
      let frame =
        push_pcm_no_requests(&mut pipeline, &pcm, ChannelLayoutSetting::Auto, None, false);
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
  fn history_entry_captures_sub_block_pairs() {
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

    let mut entries = Vec::new();
    for _ in 0..5 {
      let frame =
        push_pcm_no_requests(&mut pipeline, &pcm, ChannelLayoutSetting::Auto, None, false);
      if let Some(tick) = frame.and_then(|f| f.loudness_hist_tick) {
        entries.push(tick);
      }
    }

    assert!(!entries.is_empty(), "must emit at least one history entry");
    let e = &entries[0];
    let stride = 2 * channels as usize;
    assert!(
      e.waveform_sub_count >= 10,
      "expected many sub-blocks, got {}",
      e.waveform_sub_count
    );
    assert_eq!(
      e.waveform_sub_pairs.len(),
      e.waveform_sub_count as usize * stride,
      "flat length == sub_count * 2 * channels"
    );
    // Every value must be finite (sentinels mapped to 0.0).
    assert!(e.waveform_sub_pairs.iter().all(|v| v.is_finite()));
    // Some sub-block on L must capture a positive peak near 0.7.
    let l_max = e
      .waveform_sub_pairs
      .chunks(stride)
      .map(|c| c[1])
      .fold(f32::NEG_INFINITY, f32::max);
    assert!(
      l_max > 0.5,
      "L sub-block max should capture the peak, got {l_max}"
    );
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
    let _ = push_pcm_no_requests(&mut p, &tone, ChannelLayoutSetting::Auto, None, true);
    let _ = push_pcm_no_requests(&mut p, &tone, ChannelLayoutSetting::Auto, None, false);
    p.last_frame_emit = Instant::now() - std::time::Duration::from_millis(FRAME_EMIT_MS as u64 + 1);
    let frame = push_pcm_no_requests(&mut p, &tone, ChannelLayoutSetting::Auto, None, true);
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
      if let Some(f) =
        push_pcm_no_requests(&mut p, &silence, ChannelLayoutSetting::Auto, None, true)
      {
        assert!(!f.dialogue_active_now, "silence must not be active speech");
        assert_eq!(f.dialogue_lra, 0.0, "no speech yet 鈫?dialogue lra 0.0");
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
      if let Some(f) =
        push_pcm_no_requests(&mut pipeline, &pcm, ChannelLayoutSetting::Auto, None, false)
      {
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
