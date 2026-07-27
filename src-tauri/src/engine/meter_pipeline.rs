//! PCM 鈫?meters; drives the `AudioFramePayload` emit rate.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use crate::dsp::loudness::LoudnessBlock;
use crate::dsp::paths::spectrum_paths_from_bands;
use crate::dsp::peak::{
  sample_peak_db_interleaved, sample_peak_db_mono, sample_peak_db_per_channel_interleaved,
  RmsWindow,
};
#[cfg(test)]
use crate::dsp::shared_spectral_engine::{RuntimeConsumerSnapshot, SpectralCheckpointTime};
use crate::dsp::shared_spectral_engine::{SharedSpectralRuntime, SpectralDspTime};
use crate::dsp::speech::VadEngineKind;
use crate::dsp::{
  LoudnessMeter, Meter, PcmContext, SpectrumChannelSel, SpectrumView, VectorscopeMeter,
};
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::{
  AnalysisRequests, AudioFramePayload, MeterHistoryEntry, SpectrumFrameResult, SpectrumVisualEntry,
  StereoMapFrameResult, StereoMapVisualEntry, VectorscopeFrameResult, VectorscopeVisualEntry,
  VisualHistEntry,
};

const FRAME_EMIT_MS: u128 = 16;
/// Match `useAudioEngine.js` HIST_PUSH_MS / `App.jsx` HIST_SAMPLE_SEC cadence (~10 Hz).
const HIST_EMIT_MS: u128 = 95;
const VISUAL_EMIT_MS: u128 = 40;
const VS_HISTORY_POINTS: usize = 100;
/// PCM samples per waveform sub-block. ~19 sub-blocks per ~100ms tick @48kHz.
const SUBBLOCK_SAMPLES: usize = 256;

fn instant_ago(duration: Duration) -> Instant {
  let now = Instant::now();
  now.checked_sub(duration).unwrap_or(now)
}
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

fn spectrum_payload_from_shared_output(
  output: Option<crate::dsp::SpectralOutput<'_>>,
) -> (SpectrumFrameResult, SpectrumVisualEntry) {
  let Some(output) = output else {
    return (
      SpectrumFrameResult::default(),
      SpectrumVisualEntry::default(),
    );
  };
  let (path, peak_path) =
    spectrum_paths_from_bands(output.centers_hz, output.smooth_db, output.peak_db, true);
  let (path_b, peak_path_b, smooth_db_b, peak_db_b) = output
    .secondary
    .map(|secondary| {
      let (path, peak_path) = spectrum_paths_from_bands(
        output.centers_hz,
        secondary.smooth_db,
        secondary.peak_db,
        true,
      );
      (
        path,
        peak_path,
        secondary.smooth_db.to_vec(),
        secondary.peak_db.to_vec(),
      )
    })
    .unwrap_or_default();
  let band_centers_hz = output.centers_hz.to_vec();
  let smooth_db = output.smooth_db.to_vec();
  let result = SpectrumFrameResult {
    path,
    peak_path,
    path_b,
    peak_path_b,
    band_centers_hz,
    smooth_db,
    peak_db: output.peak_db.to_vec(),
    smooth_db_b,
    peak_db_b,
  };
  let visual = SpectrumVisualEntry {
    band_centers_hz: result.band_centers_hz.clone(),
    smooth_db: result.smooth_db.clone(),
    smooth_db_b: result.smooth_db_b.clone(),
  };
  (result, visual)
}

fn stereo_map_result_from_shared_output(
  output: &crate::dsp::stereo_map::StereoMapPrimitiveRow,
) -> StereoMapFrameResult {
  StereoMapFrameResult {
    band_centers_hz: output.band_centers_hz.clone(),
    pl: output.pl.clone(),
    pr: output.pr.clone(),
    c: output.c.clone(),
  }
}

fn stereo_map_visual_from_result(result: &StereoMapFrameResult) -> StereoMapVisualEntry {
  StereoMapVisualEntry {
    band_centers_hz: result.band_centers_hz.clone(),
    pl: result.pl.clone(),
    pr: result.pr.clone(),
    c: result.c.clone(),
  }
}

fn stereo_map_visual_from_shared_output(
  output: &crate::dsp::stereo_map::StereoMapPrimitiveRow,
) -> StereoMapVisualEntry {
  StereoMapVisualEntry {
    band_centers_hz: output.band_centers_hz.clone(),
    pl: output.pl.clone(),
    pr: output.pr.clone(),
    c: output.c.clone(),
  }
}

struct PendingFileVisualCheckpoint {
  timestamp_ms: u64,
  stereo_map_by_key: HashMap<String, StereoMapVisualEntry>,
}

pub struct MeterPipeline {
  channels: u16,
  loudness: LoudnessMeter,
  shared_spectral_runtime: SharedSpectralRuntime,
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
  /// Last supplied file position, retained so end-of-stream flushes stay on the media timeline.
  last_file_media_time_ms: Option<u64>,
  /// File mode: queued (momentary_lufs, short_term_lufs, media_time_ms) between frame emits.
  pending_file_loudness_queue: Vec<(f64, f64, u64, Vec<f64>)>,
  /// File mode: queued visual checkpoints and their request-keyed Stereo Map snapshots.
  pending_file_visual_queue: Vec<PendingFileVisualCheckpoint>,
  /// File mode: media time (ms) of the last queued loudness tick; gates tick cadence by media time
  /// instead of wall clock (offline decode runs far faster than real time). `None` = none queued yet.
  last_hist_media_ms: Option<u64>,
  /// File mode: media time (ms) of the last queued visual tick. See `last_hist_media_ms`.
  last_visual_media_ms: Option<u64>,
  #[cfg(test)]
  shared_spectral_last_dsp_time_sec: HashMap<String, f64>,
  #[cfg(test)]
  shared_spectral_file_attempts: HashMap<String, Vec<(u64, bool)>>,
  #[cfg(test)]
  shared_spectral_output_checkpoints: HashMap<String, Vec<u64>>,
  #[cfg(test)]
  shared_spectral_cached_snapshots: HashMap<String, RuntimeConsumerSnapshot>,
  #[cfg(test)]
  dsp_time_override: Option<SpectralDspTime>,
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
      channels,
      loudness: LoudnessMeter::new(sr),
      shared_spectral_runtime: SharedSpectralRuntime::new(sr),
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
      last_hist_emit: instant_ago(Duration::from_millis(200)),
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
      last_visual_emit: instant_ago(Duration::from_millis(200)),
      visual_waveform_min_acc: vec![f32::INFINITY; channels.max(1) as usize],
      visual_waveform_max_acc: vec![f32::NEG_INFINITY; channels.max(1) as usize],
      last_dialogue_gating: false,
      last_dialogue_vad_engine: VadEngineKind::default(),
      file_timing: false,
      current_media_time_ms: None,
      last_file_media_time_ms: None,
      pending_file_loudness_queue: Vec::new(),
      pending_file_visual_queue: Vec::new(),
      last_hist_media_ms: None,
      last_visual_media_ms: None,
      #[cfg(test)]
      shared_spectral_last_dsp_time_sec: HashMap::new(),
      #[cfg(test)]
      shared_spectral_file_attempts: HashMap::new(),
      #[cfg(test)]
      shared_spectral_output_checkpoints: HashMap::new(),
      #[cfg(test)]
      shared_spectral_cached_snapshots: HashMap::new(),
      #[cfg(test)]
      dsp_time_override: None,
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
    self.last_hist_emit = instant_ago(Duration::from_millis(200));
    self.m_max = f64::NEG_INFINITY;
    self.st_max = f64::NEG_INFINITY;
    self.tp_max_db = f64::NEG_INFINITY;
    self.sample_peak_max_l = f64::NEG_INFINITY;
    self.sample_peak_max_r = f64::NEG_INFINITY;
    self.rms_window.reset();
    self.loudness.reset();
    self.shared_spectral_runtime.reset();
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
    self.last_visual_emit = instant_ago(Duration::from_millis(200));
    self.pending_file_loudness_queue.clear();
    self.pending_file_visual_queue.clear();
    self.last_hist_media_ms = None;
    self.last_visual_media_ms = None;
    self.last_file_media_time_ms = None;
    #[cfg(test)]
    {
      self.shared_spectral_last_dsp_time_sec.clear();
      self.shared_spectral_file_attempts.clear();
      self.shared_spectral_output_checkpoints.clear();
      self.shared_spectral_cached_snapshots.clear();
    }
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
    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
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
      .or(self.last_file_media_time_ms.filter(|_| self.file_timing))
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
    #[cfg(test)]
    let now_sec = self
      .dsp_time_override
      .map(SpectralDspTime::as_seconds)
      .unwrap_or(now_sec);
    let ch = self.channels.max(1);
    let effective_layout = match channel_layout {
      ChannelLayoutSetting::Auto => match ch {
        6 => ChannelLayoutSetting::Surround51,
        8 => ChannelLayoutSetting::Surround71,
        _ => channel_layout,
      },
      other => other,
    };
    let spectral_plan =
      crate::engine::spectral_plan::plan_analysis_requests(self.channels, analysis_requests);
    self.shared_spectral_runtime.update_plan(spectral_plan);
    self
      .shared_spectral_runtime
      .push_interleaved(interleaved, self.channels);

    let active_vectorscope_keys: HashSet<&str> = analysis_requests
      .vectorscope
      .iter()
      .map(|request| request.key.as_str())
      .collect();
    self
      .vectorscope_by_key
      .retain(|key, _| active_vectorscope_keys.contains(key.as_str()));

    let mut spectrum_results_by_key = HashMap::new();
    let mut spectrum_by_key = Vec::with_capacity(analysis_requests.spectrum.len());
    let dsp_time = SpectralDspTime::from_monotonic_seconds(now_sec);
    for request in &analysis_requests.spectrum {
      let output = self
        .shared_spectral_runtime
        .consumer_output_at_dsp_time(&request.key, dsp_time);
      let (result, visual) = spectrum_payload_from_shared_output(output);
      spectrum_results_by_key.insert(request.key.clone(), result);
      spectrum_by_key.push((request.key.clone(), visual));

      #[cfg(test)]
      {
        let snapshot = self
          .shared_spectral_runtime
          .consumer_snapshot_after_output_for_test(&request.key);
        let output_present = snapshot
          .as_ref()
          .is_some_and(|snapshot| snapshot.output_present);
        if output_present {
          self
            .shared_spectral_last_dsp_time_sec
            .insert(request.key.clone(), dsp_time.as_seconds());
        }
        if let Some(snapshot) = snapshot {
          self
            .shared_spectral_cached_snapshots
            .insert(request.key.clone(), snapshot);
        }
        if self.file_timing && !interleaved.is_empty() {
          let timestamp_ms =
            SpectralCheckpointTime::from_media_millis(self.timestamp_ms()).as_millis();
          self
            .shared_spectral_file_attempts
            .entry(request.key.clone())
            .or_default()
            .push((timestamp_ms, output_present));
          if output_present {
            self
              .shared_spectral_output_checkpoints
              .entry(request.key.clone())
              .or_default()
              .push(timestamp_ms);
          }
        }
      }
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
      analysis_requests,
      primary_vectorscope_summary
        .or_else(|| vectorscope_pair.map(|(x, y)| (x, y, 0.0, f64::NEG_INFINITY))),
      loudness_weights,
      dialogue_gating,
      dialogue_vad_engine,
    )?;
    frame.spectrum_results_by_key = spectrum_results_by_key;
    frame.vectorscope_results_by_key = vectorscope_results_by_key;
    // The runtime lends its persistent row; clone it only after a frame has passed the emit gate.
    frame.stereo_map_results_by_key = analysis_requests
      .stereo_map
      .iter()
      .filter_map(|request| {
        self
          .shared_spectral_runtime
          .stereo_map_output(&request.key)
          .map(|output| {
            (
              request.key.clone(),
              stereo_map_result_from_shared_output(output),
            )
          })
      })
      .collect();

    // When this frame carries a visual history tick, attach per-request-key samples so the
    // frontend can keep request-keyed snapshot history. Only active request keys are emitted;
    // retention of inactive keys is the frontend's responsibility (it never deletes a key ring
    // until Clear).
    // Build the per-key samples once from the current meter snapshots, then stamp them onto the
    // visual history carrier. Live mode carries a single `visual_hist_tick`; file mode carries a
    // `visual_hist_batch` whose entries share this frame's snapshot (coarse but present 鈥?same as the
    // non-keyed `spectrum_smooth_db`). Without this, request-keyed panels (Spectrogram, and scrubbed
    // Spectrum/Vectorscope) have no history in file mode.
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
    // Visual rows have their own cadence, so do not duplicate the large primitive arrays for
    // ordinary live frames that carry no visual checkpoint.
    let stereo_map_by_key = if frame.visual_hist_tick.is_some() {
      analysis_requests
        .stereo_map
        .iter()
        .filter_map(|request| {
          frame
            .stereo_map_results_by_key
            .get(&request.key)
            .map(|result| (request.key.clone(), stereo_map_visual_from_result(result)))
        })
        .collect::<Vec<_>>()
    } else {
      Vec::new()
    };

    if let Some(entry) = frame.visual_hist_tick.as_mut() {
      entry.spectrum_by_key = spectrum_by_key.iter().cloned().collect();
      entry.vectorscope_by_key = vectorscope_by_key.iter().cloned().collect();
      entry.stereo_map_by_key = stereo_map_by_key.iter().cloned().collect();
    }
    if !frame.visual_hist_batch.is_empty()
      && (!spectrum_by_key.is_empty()
        || !vectorscope_by_key.is_empty()
        || !stereo_map_by_key.is_empty())
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
    self.last_file_media_time_ms = Some(media_time_ms);
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
    self.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
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
    analysis_requests: &AnalysisRequests,
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
        let stereo_map_by_key = analysis_requests
          .stereo_map
          .iter()
          .filter_map(|request| {
            self
              .shared_spectral_runtime
              .stereo_map_output(&request.key)
              .map(|output| {
                (
                  request.key.clone(),
                  stereo_map_visual_from_shared_output(output),
                )
              })
          })
          .collect();
        self
          .pending_file_visual_queue
          .push(PendingFileVisualCheckpoint {
            timestamp_ms: ts,
            stereo_map_by_key,
          });
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
          stereo_map_by_key: HashMap::new(),
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
      for checkpoint in std::mem::take(&mut self.pending_file_visual_queue) {
        visual_batch.push(VisualHistEntry {
          timestamp_ms: checkpoint.timestamp_ms,
          waveform_min: visual_waveform_min.clone(),
          waveform_max: visual_waveform_max.clone(),
          correlation: visual_corr,
          side_to_mid_db: visual_side_to_mid_db,
          spectrum_by_key: HashMap::new(),
          vectorscope_by_key: HashMap::new(),
          stereo_map_by_key: checkpoint.stereo_map_by_key,
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
      stereo_map_results_by_key: HashMap::new(),
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
impl MeterPipeline {
  fn spectral_plan_for_test(
    &self,
    analysis_requests: &AnalysisRequests,
  ) -> crate::engine::spectral_plan::SpectralPlan {
    crate::engine::spectral_plan::plan_analysis_requests(self.channels, analysis_requests)
  }

  pub(crate) fn push_shared_runtime_for_test(
    &mut self,
    interleaved: &[f32],
    analysis_requests: &AnalysisRequests,
    dsp_time: SpectralDspTime,
  ) {
    self.push_shared_runtime_at_times_for_test(interleaved, analysis_requests, dsp_time, None);
  }

  fn push_shared_runtime_at_times_for_test(
    &mut self,
    interleaved: &[f32],
    analysis_requests: &AnalysisRequests,
    dsp_time: SpectralDspTime,
    checkpoint_time: Option<SpectralCheckpointTime>,
  ) {
    let plan = self.spectral_plan_for_test(analysis_requests);
    self.shared_spectral_runtime.update_plan(plan);
    self
      .shared_spectral_runtime
      .push_interleaved(interleaved, self.channels);
    for request in &analysis_requests.spectrum {
      let snapshot = self
        .shared_spectral_runtime
        .consumer_snapshot_at_dsp_time_for_test(&request.key, dsp_time);
      let output_present = snapshot
        .as_ref()
        .is_some_and(|snapshot| snapshot.output_present);
      if output_present {
        self
          .shared_spectral_last_dsp_time_sec
          .insert(request.key.clone(), dsp_time.as_seconds());
      }
      if let Some(snapshot) = snapshot {
        self
          .shared_spectral_cached_snapshots
          .insert(request.key.clone(), snapshot);
      }
      if let Some(checkpoint_time) = checkpoint_time.filter(|_| !interleaved.is_empty()) {
        let timestamp_ms = checkpoint_time.as_millis();
        self
          .shared_spectral_file_attempts
          .entry(request.key.clone())
          .or_default()
          .push((timestamp_ms, output_present));
        if output_present {
          self
            .shared_spectral_output_checkpoints
            .entry(request.key.clone())
            .or_default()
            .push(timestamp_ms);
        }
      }
    }
  }

  pub(crate) fn shared_runtime_snapshot_for_test(
    &mut self,
    key: &str,
    now_sec: f64,
  ) -> Option<crate::dsp::shared_spectral_engine::RuntimeConsumerSnapshot> {
    self
      .shared_spectral_runtime
      .consumer_snapshot_for_test(key, now_sec)
  }

  pub(crate) fn shared_runtime_sample_clock_for_test(&self) -> u64 {
    self.shared_spectral_runtime.sample_clock_for_test()
  }

  fn stereo_map_consume_counts_for_test(&self, key: &str) -> Option<[u64; 3]> {
    self
      .shared_spectral_runtime
      .stereo_map_consume_counts_for_test(key)
  }

  pub(crate) fn shared_runtime_last_output_dsp_time_for_test(&self, key: &str) -> Option<f64> {
    self.shared_spectral_last_dsp_time_sec.get(key).copied()
  }

  pub(crate) fn shared_runtime_cached_snapshot_for_test(
    &self,
    key: &str,
  ) -> Option<RuntimeConsumerSnapshot> {
    self.shared_spectral_cached_snapshots.get(key).cloned()
  }

  pub(crate) fn set_dsp_time_for_test(&mut self, dsp_time: SpectralDspTime) {
    self.dsp_time_override = Some(dsp_time);
  }

  pub(crate) fn set_file_media_time_for_test(&mut self, media_time_ms: u64) {
    debug_assert!(self.file_timing);
    self.current_media_time_ms = Some(media_time_ms);
    self.last_file_media_time_ms = Some(media_time_ms);
  }

  pub(crate) fn shared_runtime_file_attempts_for_test(&self, key: &str) -> Vec<(u64, bool)> {
    self
      .shared_spectral_file_attempts
      .get(key)
      .cloned()
      .unwrap_or_default()
  }

  pub(crate) fn shared_runtime_output_checkpoints_for_test(&self, key: &str) -> Vec<u64> {
    self
      .shared_spectral_output_checkpoints
      .get(key)
      .cloned()
      .unwrap_or_default()
  }

  fn shared_runtime_lifecycle_for_test(
    &self,
  ) -> crate::dsp::shared_spectral_engine::RuntimeLifecycleSnapshot {
    self.shared_spectral_runtime.lifecycle_snapshot_for_test()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn planner_inspection_uses_current_spectrum_requests_and_pipeline_channel_count() {
    use crate::engine::spectral_plan::TransformStreamId;
    use crate::ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};

    let pipeline = MeterPipeline::new(48_000, 2);
    let requests = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: "active-single".to_string(),
        channel: SpectrumAnalysisChannel::Single { ch: 99 },
        view: "combined".to_string(),
        speed_percent: 50.0,
        tilt_db_per_octave: 4.5,
        octave_smoothing: "off".to_string(),
      }],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };

    let active_plan = pipeline.spectral_plan_for_test(&requests);
    assert_eq!(
      active_plan.streams,
      vec![TransformStreamId::Physical(1)],
      "selection must clamp to this pipeline's channel count"
    );
    assert_eq!(active_plan.consumers.len(), 1);
    assert_eq!(active_plan.consumers[0].request_key, "active-single");

    let empty_plan = pipeline.spectral_plan_for_test(&AnalysisRequests::default());
    assert!(empty_plan.streams.is_empty());
    assert!(empty_plan.consumers.is_empty());
    assert!(!empty_plan
      .consumers
      .iter()
      .any(|binding| binding.request_key == "active-single"));
  }

  fn combined_request(key: &str) -> crate::ipc::types::SpectrumAnalysisRequest {
    crate::ipc::types::SpectrumAnalysisRequest {
      key: key.to_string(),
      channel: crate::ipc::types::SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
      view: "combined".to_string(),
      speed_percent: 50.0,
      tilt_db_per_octave: 4.5,
      octave_smoothing: "off".to_string(),
    }
  }

  fn stereo_map_request(key: &str) -> crate::ipc::types::StereoMapAnalysisRequest {
    crate::ipc::types::StereoMapAnalysisRequest {
      key: key.to_string(),
      pair: crate::ipc::types::StereoMapAnalysisPair {
        first: 0,
        second: 1,
      },
      speed_percent: 50.0,
      octave_smoothing: "off".to_string(),
    }
  }

  fn deterministic_stereo(frames: usize, start_clock: u64) -> Vec<f32> {
    let sample = |clock: u64, seed: u32| {
      let mut value = (clock as u32).wrapping_add(seed);
      value ^= value >> 16;
      value = value.wrapping_mul(0x7FEB_352D);
      value ^= value >> 15;
      value = value.wrapping_mul(0x846C_A68B);
      value ^= value >> 16;
      (value as f32 / u32::MAX as f32) * 2.0 - 1.0
    };
    (0..frames)
      .flat_map(|offset| {
        let clock = start_clock + offset as u64;
        [sample(clock, 0x1234_5678), sample(clock, 0x8765_4321)]
      })
      .collect()
  }

  fn assert_visible_rows_close(actual: &[f64], expected: &[f64], checkpoint: &str, row: &str) {
    // Same route-specific bound as `spectrum_differential`: physical-pair Combined combines
    // already-rounded complex f32 bins, while the direct stream combines f32 PCM before FFT.
    const DIRECT_TO_PHYSICAL_TOLERANCE_DB: f64 = 0.0225;
    assert_eq!(actual.len(), expected.len(), "{checkpoint} {row} shape");
    for (index, (&actual, &expected)) in actual.iter().zip(expected).enumerate() {
      assert!(
        (actual - expected).abs() <= DIRECT_TO_PHYSICAL_TOLERANCE_DB,
        "{checkpoint} {row}[{index}]: actual={actual}, expected={expected}"
      );
    }
  }

  fn assert_visible_checkpoint(
    runtime: &mut SharedSpectralRuntime,
    reference: &mut SharedSpectralRuntime,
    clock: u64,
    expected_identity: Option<u64>,
    expected_state_epoch: Option<u64>,
    previous_last_time: f64,
    checkpoint: &str,
  ) -> (u64, u64, f64) {
    let now_sec = clock as f64 / 48_000.0;
    let actual = runtime
      .consumer_snapshot_for_test("combined", now_sec)
      .unwrap_or_else(|| panic!("{checkpoint}: transitioning output is blank"));
    let expected = reference
      .consumer_snapshot_for_test("combined", now_sec)
      .unwrap_or_else(|| panic!("{checkpoint}: uninterrupted reference is blank"));

    assert_eq!(actual.request_key, "combined", "{checkpoint} request key");
    if let Some(identity) = expected_identity {
      assert_eq!(actual.identity, identity, "{checkpoint} consumer identity");
    }
    if let Some(epoch) = expected_state_epoch {
      assert_eq!(
        actual.state.state_epoch, epoch,
        "{checkpoint} consumer DSP state was recreated"
      );
    }
    assert!(actual.output_present, "{checkpoint} output presence");
    assert_eq!(
      actual.centers_hz.len(),
      actual.smooth_db.len(),
      "{checkpoint} smooth/grid shape"
    );
    assert_eq!(
      actual.centers_hz.len(),
      actual.peak_db.len(),
      "{checkpoint} peak/grid shape"
    );
    assert!(!actual.centers_hz.is_empty(), "{checkpoint} empty grid");
    assert_eq!(
      actual.centers_hz, expected.centers_hz,
      "{checkpoint} frequency grid"
    );
    assert_visible_rows_close(&actual.smooth_db, &expected.smooth_db, checkpoint, "smooth");
    assert_visible_rows_close(&actual.peak_db, &expected.peak_db, checkpoint, "peak");

    assert_eq!(
      actual.state.ema_initialized, [true; 3],
      "{checkpoint} all resolution EMAs"
    );
    assert!(
      actual.state.envelope_last_time > previous_last_time,
      "{checkpoint} envelope time did not advance: previous={}, current={}",
      previous_last_time,
      actual.state.envelope_last_time
    );
    assert_eq!(
      actual.state.envelope_last_time, now_sec,
      "{checkpoint} envelope time"
    );
    assert_eq!(
      actual.state.peak_hold_len,
      actual.peak_db.len(),
      "{checkpoint} peak hold shape"
    );
    assert!(
      actual.state.peak_hold_max_until >= now_sec,
      "{checkpoint} peak hold was not armed"
    );
    assert_eq!(
      actual.state.peak_hold_max_until, expected.state.peak_hold_max_until,
      "{checkpoint} peak hold diverged from uninterrupted state"
    );

    (
      actual.identity,
      actual.state.state_epoch,
      actual.state.envelope_last_time,
    )
  }

  fn push_both_to_clock(
    runtime: &mut SharedSpectralRuntime,
    reference: &mut SharedSpectralRuntime,
    from_clock: &mut u64,
    to_clock: u64,
  ) {
    assert!(to_clock >= *from_clock);
    let pcm = deterministic_stereo((to_clock - *from_clock) as usize, *from_clock);
    runtime.push_interleaved(&pcm, 2);
    reference.push_interleaved(&pcm, 2);
    *from_clock = to_clock;
  }

  #[test]
  fn shared_runtime_request_changes_start_new_keys_at_activation_and_preserve_unchanged_state() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::engine::spectral_plan::plan_spectral_requests;
    use crate::ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};

    let unchanged = combined_request("unchanged");
    let added = SpectrumAnalysisRequest {
      key: "added".to_string(),
      channel: SpectrumAnalysisChannel::Single { ch: 0 },
      ..unchanged.clone()
    };
    let mut runtime = SharedSpectralRuntime::new(48_000.0);
    runtime.update_plan(plan_spectral_requests(
      2,
      std::slice::from_ref(&unchanged),
      &[],
    ));
    runtime.push_interleaved(&deterministic_stereo(FFT_BIG, 0), 2);
    let before = runtime
      .consumer_snapshot_for_test("unchanged", 1.0)
      .expect("warmed unchanged consumer");

    runtime.update_plan(plan_spectral_requests(
      2,
      &[unchanged.clone(), added.clone()],
      &[],
    ));
    runtime.push_interleaved(&deterministic_stereo(FFT_BIG - 1, FFT_BIG as u64), 2);
    let during = runtime
      .consumer_snapshot_for_test("unchanged", 1.5)
      .expect("unchanged output survives");
    assert_eq!(during.identity, before.identity);
    assert_eq!(during.state.state_epoch, before.state.state_epoch);
    assert!(
      runtime
        .consumer_snapshot_for_test("added", 1.5)
        .is_some_and(|snapshot| !snapshot.output_present),
      "a late key must not backfill from pre-activation PCM"
    );

    runtime.push_interleaved(&deterministic_stereo(1, (FFT_BIG * 2 - 1) as u64), 2);
    assert!(runtime
      .consumer_snapshot_for_test("added", 2.0)
      .is_some_and(|snapshot| snapshot.output_present));
    let removed_counts = runtime.consumer_counts_for_test("unchanged").unwrap();
    runtime.update_plan(plan_spectral_requests(2, std::slice::from_ref(&added), &[]));
    runtime.push_interleaved(&deterministic_stereo(FFT_BIG, (FFT_BIG * 2) as u64), 2);
    assert_eq!(runtime.consumer_identity_for_test("unchanged"), None);
    assert_eq!(
      runtime.removed_consumer_counts_for_test("unchanged"),
      Some(removed_counts),
      "removed consumers must stop immediately"
    );
  }

  #[test]
  fn pipeline_clear_restarts_shared_runtime_warmup_and_is_repeatable_when_empty() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::engine::spectral_plan::{ProjectionKind, TransformStreamId};
    use crate::ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};

    let combined = combined_request("combined");
    let secondary = SpectrumAnalysisRequest {
      key: "secondary".to_string(),
      channel: SpectrumAnalysisChannel::Pair { x: 2, y: 3 },
      view: "lr".to_string(),
      ..combined.clone()
    };
    let pair_need = SpectrumAnalysisRequest {
      key: "pair-need".to_string(),
      channel: SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
      view: "lr".to_string(),
      ..combined.clone()
    };
    let initial_requests = AnalysisRequests {
      spectrum: vec![combined.clone(), secondary.clone()],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let transition_requests = AnalysisRequests {
      spectrum: vec![combined, secondary, pair_need],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let pcm = vec![0.25_f32; FFT_BIG * 4];
    let mut pipeline = MeterPipeline::new(48_000, 4);
    pipeline.push_shared_runtime_for_test(
      &pcm,
      &initial_requests,
      SpectralDspTime::from_monotonic_seconds(1.0),
    );
    pipeline.push_shared_runtime_for_test(
      &[],
      &transition_requests,
      SpectralDspTime::from_monotonic_seconds(1.1),
    );

    let before_primary = pipeline
      .shared_runtime_snapshot_for_test("combined", 1.0)
      .expect("warmed shared consumer");
    let before_secondary = pipeline
      .shared_runtime_snapshot_for_test("secondary", 1.0)
      .expect("warmed secondary consumer");
    for state in [
      &before_primary.state.primary,
      before_secondary
        .state
        .secondary
        .as_ref()
        .expect("L/R secondary state"),
    ] {
      assert_eq!(state.ema_initialized, [true; 3]);
      assert!(state.psd.iter().all(|data| !data.is_empty()));
      assert!(!state.smooth_db.is_empty());
      assert!(!state.peak_db.is_empty());
      assert!(!state.peak_hold_until.is_empty());
      assert!(state.envelope_last_time > 0.0);
    }
    assert!(before_primary.output_present);
    assert!(!before_primary.smooth_db.is_empty());
    assert!(!before_primary.peak_db.is_empty());
    let lifecycle_before = pipeline.shared_runtime_lifecycle_for_test();
    assert_eq!(lifecycle_before.transition_count, 1);
    assert!(lifecycle_before.total_fft_count > 0);
    assert_eq!(lifecycle_before.sample_clock, FFT_BIG as u64);
    assert!(lifecycle_before.streams.iter().any(|stream| {
      stream.stream_id
        == TransformStreamId::Projection {
          first: 0,
          second: 1,
          kind: ProjectionKind::Combined,
        }
        && stream.all_three_ready
    }));
    assert!(lifecycle_before
      .streams
      .iter()
      .any(|stream| stream.stream_id == TransformStreamId::Physical(0) && !stream.all_three_ready));

    pipeline.clear_peak_and_history();
    pipeline.clear_peak_and_history();
    let cleared_primary = pipeline
      .shared_runtime_snapshot_for_test("combined", 0.0)
      .expect("clear retains active request configuration");
    let cleared_secondary = pipeline
      .shared_runtime_snapshot_for_test("secondary", 0.0)
      .expect("clear retains secondary request");
    assert_ne!(
      cleared_primary.state.state_epoch,
      before_primary.state.state_epoch
    );
    for state in [
      &cleared_primary.state.primary,
      cleared_secondary
        .state
        .secondary
        .as_ref()
        .expect("rebuilt L/R secondary state"),
    ] {
      assert_eq!(state.ema_initialized, [false; 3]);
      assert!(state.psd.iter().all(Vec::is_empty));
      assert!(state.smooth_db.is_empty());
      assert!(state.peak_db.is_empty());
      assert!(state.peak_hold_until.is_empty());
      assert_eq!(state.envelope_last_time, 0.0);
    }
    assert!(!cleared_primary.output_present);
    assert!(cleared_primary.smooth_db.is_empty());
    assert!(cleared_primary.peak_db.is_empty());
    let lifecycle_cleared = pipeline.shared_runtime_lifecycle_for_test();
    assert_eq!(lifecycle_cleared.transition_count, 0);
    assert_eq!(lifecycle_cleared.total_fft_count, 0);
    assert_eq!(lifecycle_cleared.sample_clock, 0);
    assert_eq!(
      lifecycle_cleared
        .streams
        .iter()
        .map(|stream| stream.stream_id)
        .collect::<Vec<_>>(),
      vec![
        TransformStreamId::Physical(0),
        TransformStreamId::Physical(1),
        TransformStreamId::Physical(2),
        TransformStreamId::Physical(3),
      ]
    );
    assert!(lifecycle_cleared
      .streams
      .iter()
      .all(|stream| !stream.all_three_ready && stream.fft_count == 0));

    pipeline.push_shared_runtime_for_test(
      &vec![0.25; (FFT_BIG - 1) * 4],
      &transition_requests,
      SpectralDspTime::from_monotonic_seconds(0.5),
    );
    for key in ["combined", "secondary", "pair-need"] {
      assert!(
        !pipeline
          .shared_runtime_snapshot_for_test(key, 0.5)
          .unwrap()
          .output_present,
        "{key} leaked stale output during rewarm"
      );
    }
    pipeline.push_shared_runtime_for_test(
      &[0.25; 4],
      &transition_requests,
      SpectralDspTime::from_monotonic_seconds(0.6),
    );
    for key in ["combined", "secondary", "pair-need"] {
      assert!(
        pipeline
          .shared_runtime_snapshot_for_test(key, 0.6)
          .unwrap()
          .output_present
      );
    }

    pipeline.push_shared_runtime_for_test(
      &[],
      &AnalysisRequests::default(),
      SpectralDspTime::from_monotonic_seconds(0.7),
    );
    pipeline.clear_peak_and_history();
    pipeline.clear_peak_and_history();
    let empty = pipeline.shared_runtime_lifecycle_for_test();
    assert!(empty.streams.is_empty());
    assert_eq!(empty.transition_count, 0);
    assert_eq!(empty.sample_clock, 0);
    assert_eq!(empty.total_fft_count, 0);
    pipeline.push_shared_runtime_for_test(
      &vec![0.25; FFT_BIG * 4],
      &AnalysisRequests::default(),
      SpectralDspTime::from_monotonic_seconds(1.0),
    );
    let empty_after_push = pipeline.shared_runtime_lifecycle_for_test();
    assert_eq!(empty_after_push.total_fft_count, 0);
    assert_eq!(empty_after_push.sample_clock, FFT_BIG as u64);
  }

  #[test]
  fn shared_runtime_rebuild_discards_old_sample_rate_grid_and_channel_state() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::engine::spectral_plan::{plan_spectral_requests, TransformStreamId};
    use crate::ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};

    let request = SpectrumAnalysisRequest {
      key: "selected".to_string(),
      channel: SpectrumAnalysisChannel::Single { ch: 99 },
      ..combined_request("selected")
    };
    let mut runtime = SharedSpectralRuntime::new(48_000.0);
    runtime.update_plan(plan_spectral_requests(
      2,
      std::slice::from_ref(&request),
      &[],
    ));
    runtime.push_interleaved(&deterministic_stereo(FFT_BIG, 0), 2);
    let old = runtime
      .consumer_snapshot_for_test("selected", 1.0)
      .expect("old output");
    assert!(old.output_present);
    assert!(old.centers_hz.last().copied().unwrap_or_default() > 10_000.0);

    runtime.rebuild(16_000.0);
    runtime.update_plan(plan_spectral_requests(
      1,
      std::slice::from_ref(&request),
      &[],
    ));
    assert_eq!(
      runtime.streams_for_test(),
      vec![TransformStreamId::Physical(0)]
    );
    let rebuilt = runtime
      .consumer_snapshot_for_test("selected", 0.0)
      .expect("rebuilt consumer");
    assert_ne!(rebuilt.identity, old.identity);
    assert_ne!(rebuilt.state.state_epoch, old.state.state_epoch);
    assert!(!rebuilt.output_present);
    assert_eq!(runtime.sample_clock_for_test(), 0);

    runtime.push_interleaved(&vec![0.0; FFT_BIG], 1);
    let new = runtime
      .consumer_snapshot_for_test("selected", 2.1)
      .expect("new output");
    assert!(new.output_present);
    assert_eq!(new.sample_rate, 16_000.0);
    assert_eq!(new.centers_hz.len(), new.smooth_db.len());
    assert_eq!(new.centers_hz.len(), new.peak_db.len());
  }

  #[test]
  fn topology_transition_visible_output_matches_uninterrupted_direct_reference_both_directions() {
    use crate::dsp::spectrum_bank::{FFT_BIG, FFT_MID, FFT_SMALL};
    use crate::engine::spectral_plan::{
      plan_spectral_requests, ConsumerInput, FuturePairNeed, ProjectionKind, TransformStreamId,
    };

    let request = combined_request("combined");
    let direct_plan = plan_spectral_requests(2, std::slice::from_ref(&request), &[]);
    let physical_plan = plan_spectral_requests(
      2,
      std::slice::from_ref(&request),
      &[FuturePairNeed::new(0, 1)],
    );
    let projection = TransformStreamId::Projection {
      first: 0,
      second: 1,
      kind: ProjectionKind::Combined,
    };
    let direct_input = ConsumerInput::Single(projection);
    let physical_input = ConsumerInput::Pair {
      first: TransformStreamId::Physical(0),
      second: TransformStreamId::Physical(1),
    };
    let mut runtime = SharedSpectralRuntime::new(48_000.0);
    let mut reference = SharedSpectralRuntime::new(48_000.0);
    runtime.update_plan(direct_plan.clone());
    reference.update_plan(direct_plan.clone());
    let mut clock = 0;

    push_both_to_clock(&mut runtime, &mut reference, &mut clock, FFT_BIG as u64);
    let (identity, state_epoch, mut last_time) = assert_visible_checkpoint(
      &mut runtime,
      &mut reference,
      clock,
      None,
      None,
      0.0,
      "initial readiness",
    );

    runtime.update_plan(physical_plan.clone());
    runtime.update_plan(physical_plan);
    assert_eq!(runtime.transition_generation_for_test("combined"), Some(1));
    for checkpoint in (FFT_BIG as u64 + 2048..FFT_BIG as u64 * 2).step_by(2048) {
      push_both_to_clock(&mut runtime, &mut reference, &mut clock, checkpoint);
      (_, _, last_time) = assert_visible_checkpoint(
        &mut runtime,
        &mut reference,
        clock,
        Some(identity),
        Some(state_epoch),
        last_time,
        &format!("forward warmup {clock}"),
      );
      assert_eq!(
        runtime.consumer_active_input_for_test("combined"),
        Some(direct_input),
        "forward warmup source"
      );
    }
    let forward_boundary = FFT_BIG as u64 * 2;
    push_both_to_clock(
      &mut runtime,
      &mut reference,
      &mut clock,
      forward_boundary - 1,
    );
    (_, _, last_time) = assert_visible_checkpoint(
      &mut runtime,
      &mut reference,
      clock,
      Some(identity),
      Some(state_epoch),
      last_time,
      "forward final warmup",
    );
    let before_forward = runtime.consumer_counts_for_test("combined").unwrap();
    push_both_to_clock(&mut runtime, &mut reference, &mut clock, forward_boundary);
    (_, _, last_time) = assert_visible_checkpoint(
      &mut runtime,
      &mut reference,
      clock,
      Some(identity),
      Some(state_epoch),
      last_time,
      "forward exact handoff",
    );
    assert_eq!(
      runtime.consumer_active_input_for_test("combined"),
      Some(physical_input)
    );
    let after_forward = runtime.consumer_counts_for_test("combined").unwrap();
    assert_eq!(
      after_forward,
      [
        before_forward[0] + 1,
        before_forward[1] + 1,
        before_forward[2] + 1,
      ]
    );
    for checkpoint in [forward_boundary + 2048, forward_boundary + 4096] {
      push_both_to_clock(&mut runtime, &mut reference, &mut clock, checkpoint);
      (_, _, last_time) = assert_visible_checkpoint(
        &mut runtime,
        &mut reference,
        clock,
        Some(identity),
        Some(state_epoch),
        last_time,
        &format!("forward post-handoff {clock}"),
      );
    }

    runtime.update_plan(direct_plan.clone());
    runtime.update_plan(direct_plan);
    assert_eq!(
      runtime.transition_generation_for_test("combined"),
      Some(2),
      "inverse no-op update must not restart transition"
    );
    let inverse_boundary = (clock + FFT_BIG as u64).div_ceil(2048) * 2048;
    for checkpoint in (clock + 2048..inverse_boundary).step_by(2048) {
      push_both_to_clock(&mut runtime, &mut reference, &mut clock, checkpoint);
      (_, _, last_time) = assert_visible_checkpoint(
        &mut runtime,
        &mut reference,
        clock,
        Some(identity),
        Some(state_epoch),
        last_time,
        &format!("inverse warmup {clock}"),
      );
      assert_eq!(
        runtime.consumer_active_input_for_test("combined"),
        Some(physical_input),
        "inverse warmup source"
      );
    }
    push_both_to_clock(
      &mut runtime,
      &mut reference,
      &mut clock,
      inverse_boundary - 1,
    );
    (_, _, last_time) = assert_visible_checkpoint(
      &mut runtime,
      &mut reference,
      clock,
      Some(identity),
      Some(state_epoch),
      last_time,
      "inverse final warmup",
    );
    let before_inverse = runtime.consumer_counts_for_test("combined").unwrap();
    push_both_to_clock(&mut runtime, &mut reference, &mut clock, inverse_boundary);
    let after_inverse = runtime.consumer_counts_for_test("combined").unwrap();
    assert_eq!(
      after_inverse,
      [
        before_inverse[0] + 1,
        before_inverse[1] + 1,
        before_inverse[2] + 1,
      ],
      "inverse boundary must consume each target resolution exactly once"
    );
    (_, _, last_time) = assert_visible_checkpoint(
      &mut runtime,
      &mut reference,
      clock,
      Some(identity),
      Some(state_epoch),
      last_time,
      "inverse exact handoff",
    );
    assert_eq!(
      runtime.consumer_active_input_for_test("combined"),
      Some(direct_input)
    );
    let physical_fft_counts = [FFT_BIG, FFT_MID, FFT_SMALL].map(|fft_size| {
      [
        runtime.fft_count_for_test(TransformStreamId::Physical(0), fft_size),
        runtime.fft_count_for_test(TransformStreamId::Physical(1), fft_size),
      ]
    });
    assert!(!runtime.contains_stream_for_test(TransformStreamId::Physical(0)));
    assert!(!runtime.contains_stream_for_test(TransformStreamId::Physical(1)));
    for checkpoint in [inverse_boundary + 2048, inverse_boundary + 4096] {
      push_both_to_clock(&mut runtime, &mut reference, &mut clock, checkpoint);
      (_, _, last_time) = assert_visible_checkpoint(
        &mut runtime,
        &mut reference,
        clock,
        Some(identity),
        Some(state_epoch),
        last_time,
        &format!("inverse post-handoff {clock}"),
      );
    }
    assert_eq!(
      [FFT_BIG, FFT_MID, FFT_SMALL].map(|fft_size| {
        [
          runtime.fft_count_for_test(TransformStreamId::Physical(0), fft_size),
          runtime.fft_count_for_test(TransformStreamId::Physical(1), fft_size),
        ]
      }),
      physical_fft_counts,
      "retired physical FFT work must freeze after inverse handoff"
    );
  }

  #[test]
  fn topology_transition_overlaps_and_hands_combined_consumer_both_directions() {
    use crate::dsp::spectrum_bank::{FFT_BIG, FFT_MID, FFT_SMALL};
    use crate::engine::spectral_plan::{
      plan_spectral_requests, ConsumerInput, FuturePairNeed, ProjectionKind, TransformStreamId,
    };

    let projection = TransformStreamId::Projection {
      first: 0,
      second: 1,
      kind: ProjectionKind::Combined,
    };
    let physical_input = ConsumerInput::Pair {
      first: TransformStreamId::Physical(0),
      second: TransformStreamId::Physical(1),
    };
    let direct_input = ConsumerInput::Single(projection);
    let request = combined_request("combined");
    let direct_plan = plan_spectral_requests(2, std::slice::from_ref(&request), &[]);
    let physical_plan = plan_spectral_requests(
      2,
      std::slice::from_ref(&request),
      &[FuturePairNeed::new(0, 1)],
    );
    let mut runtime = SharedSpectralRuntime::new(48_000.0);

    runtime.update_plan(direct_plan.clone());
    runtime.push_interleaved(&deterministic_stereo(FFT_BIG, 0), 2);
    let initial = runtime
      .consumer_snapshot_for_test("combined", 1.0)
      .expect("warmed direct consumer");
    assert_eq!(initial.active_input, direct_input);
    assert!(initial.output_present);
    assert!(initial.peak_max.is_finite());

    runtime.update_plan(physical_plan);
    runtime.update_plan(plan_spectral_requests(
      2,
      std::slice::from_ref(&request),
      &[FuturePairNeed::new(0, 1)],
    ));
    assert_eq!(
      runtime.consumer_identity_for_test("combined"),
      Some(initial.identity),
      "no-op plan updates must not recreate the keyed consumer"
    );
    assert_eq!(runtime.transition_generation_for_test("combined"), Some(1));
    assert_eq!(
      runtime.streams_for_test(),
      vec![
        TransformStreamId::Physical(0),
        TransformStreamId::Physical(1),
        projection,
      ],
      "active projection and warming physical streams must overlap"
    );

    let add_boundary = (FFT_BIG * 2) as u64;
    runtime.push_interleaved(&deterministic_stereo(FFT_BIG - 1, FFT_BIG as u64), 2);
    let before_add_switch = runtime
      .consumer_snapshot_for_test("combined", 1.05)
      .expect("old source remains publishable while target warms");
    assert_eq!(before_add_switch.active_input, direct_input);
    assert!(before_add_switch.output_present);
    assert!(
      runtime.consumer_counts_for_test("combined").unwrap()[1..]
        .iter()
        .any(|&count| count > initial.consume_counts[1]),
      "the unchanged consumer must keep receiving its active projection"
    );
    assert!(
      runtime.stream_all_three_ready_for_test(TransformStreamId::Physical(0)) == Some(false),
      "internal small/mid warmup is not handoff eligibility"
    );

    runtime.push_interleaved(&deterministic_stereo(1, add_boundary - 1), 2);
    let after_add_switch = runtime
      .consumer_snapshot_for_test("combined", 1.1)
      .expect("switch boundary must emit a valid output");
    assert_eq!(after_add_switch.identity, initial.identity);
    assert_eq!(after_add_switch.active_input, physical_input);
    assert_eq!(after_add_switch.last_switch_clock, Some(add_boundary));
    assert_eq!(
      after_add_switch.consume_counts,
      [
        before_add_switch.consume_counts[0] + 1,
        before_add_switch.consume_counts[1] + 1,
        before_add_switch.consume_counts[2] + 1,
      ],
      "the common boundary must consume exactly one target frame per resolution"
    );
    assert!(!runtime.contains_stream_for_test(projection));
    let projection_counts =
      [FFT_BIG, FFT_MID, FFT_SMALL].map(|size| runtime.fft_count_for_test(projection, size));
    runtime.push_interleaved(&deterministic_stereo(FFT_BIG / 8, add_boundary), 2);
    assert_eq!(
      [FFT_BIG, FFT_MID, FFT_SMALL].map(|size| runtime.fft_count_for_test(projection, size)),
      projection_counts,
      "retired projection FFT work must stop after handoff"
    );

    runtime.update_plan(direct_plan.clone());
    assert!(runtime.contains_stream_for_test(projection));
    assert!(runtime.contains_stream_for_test(TransformStreamId::Physical(0)));
    assert!(runtime.contains_stream_for_test(TransformStreamId::Physical(1)));
    let remove_started = runtime.sample_clock_for_test();
    let remove_boundary = (remove_started + FFT_BIG as u64).div_ceil(2048) * 2048;
    runtime.push_interleaved(
      &deterministic_stereo(
        (remove_boundary - remove_started - 1) as usize,
        remove_started,
      ),
      2,
    );
    assert_eq!(
      runtime
        .consumer_snapshot_for_test("combined", 1.15)
        .unwrap()
        .active_input,
      physical_input,
      "physical source must remain active while projection warms"
    );
    runtime.push_interleaved(&deterministic_stereo(1, remove_boundary - 1), 2);
    let after_remove_switch = runtime
      .consumer_snapshot_for_test("combined", 1.2)
      .expect("inverse switch boundary output");
    assert_eq!(after_remove_switch.identity, initial.identity);
    assert_eq!(after_remove_switch.active_input, direct_input);
    assert_eq!(
      after_remove_switch.last_switch_clock,
      Some(remove_boundary),
      "inverse handoff must also use the all-resolution common boundary"
    );
    assert!(!runtime.contains_stream_for_test(TransformStreamId::Physical(0)));
    assert!(!runtime.contains_stream_for_test(TransformStreamId::Physical(1)));
  }

  #[test]
  fn topology_transition_prunes_removed_keys_but_keeps_still_needed_physical_streams() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::engine::spectral_plan::{plan_spectral_requests, TransformStreamId};
    use crate::ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};

    let combined = combined_request("combined");
    let lr = SpectrumAnalysisRequest {
      key: "lr".to_string(),
      channel: SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
      view: "lr".to_string(),
      ..combined.clone()
    };
    let left = SpectrumAnalysisRequest {
      key: "left".to_string(),
      channel: SpectrumAnalysisChannel::Single { ch: 0 },
      ..combined.clone()
    };
    let mut runtime = SharedSpectralRuntime::new(48_000.0);
    runtime.update_plan(plan_spectral_requests(
      2,
      &[combined.clone(), lr.clone()],
      &[],
    ));
    runtime.push_interleaved(&deterministic_stereo(FFT_BIG, 0), 2);
    let combined_identity = runtime.consumer_identity_for_test("combined");
    let lr_counts = runtime.consumer_counts_for_test("lr").unwrap();

    runtime.update_plan(plan_spectral_requests(
      2,
      &[combined.clone(), left.clone()],
      &[],
    ));
    assert_eq!(
      runtime.consumer_identity_for_test("combined"),
      combined_identity
    );
    assert_eq!(runtime.consumer_identity_for_test("lr"), None);
    runtime.push_interleaved(&deterministic_stereo(FFT_BIG, FFT_BIG as u64), 2);
    assert_eq!(
      runtime.removed_consumer_counts_for_test("lr"),
      Some(lr_counts),
      "removed keys must stop accumulation immediately"
    );
    assert!(
      runtime.contains_stream_for_test(TransformStreamId::Physical(0)),
      "a stream still needed by another consumer must survive handoff pruning"
    );
    assert!(
      !runtime.contains_stream_for_test(TransformStreamId::Physical(1)),
      "only the unneeded half of the retired pair should be pruned"
    );

    runtime.update_plan(plan_spectral_requests(2, &[combined, left, lr], &[]));
    assert!(runtime.contains_stream_for_test(TransformStreamId::Physical(0)));
    assert!(runtime.contains_stream_for_test(TransformStreamId::Physical(1)));
    assert_eq!(
      runtime.transition_generation_for_test("combined"),
      Some(2),
      "returning to a still-required physical topology starts one new transition"
    );
  }

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
    pipeline.t0 = instant_ago(Duration::from_millis(200));

    assert!(pipeline.timestamp_ms() >= 100);

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
    let lr_key = "spectrum:pair:0:1:combined:sp50:tilt450:smoff".to_string();
    let c_key = "spectrum:single:2:combined:sp50:tilt450:smoff".to_string();
    let requests_lr = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: lr_key.clone(),
        channel: SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
        view: "combined".to_string(),
        speed_percent: 50.0,
        tilt_db_per_octave: 4.5,
        octave_smoothing: "off".to_string(),
      }],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let requests_c = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: c_key.clone(),
        channel: SpectrumAnalysisChannel::Single { ch: 2 },
        view: "combined".to_string(),
        speed_percent: 50.0,
        tilt_db_per_octave: 4.5,
        octave_smoothing: "off".to_string(),
      }],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };

    let _ = pipeline.push_pcm_f32_with_requests(
      &pcm_lr,
      ChannelLayoutSetting::Auto,
      &requests_lr,
      None,
      false,
      VadEngineKind::default(),
    );
    let before_change = pipeline
      .shared_runtime_cached_snapshot_for_test(&lr_key)
      .expect("L/R spectrum consumer");
    assert!(
      before_change.output_present,
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
      pipeline
        .shared_spectral_runtime
        .consumer_identity_for_test(&lr_key)
        .is_none(),
      "inactive L/R spectrum consumer should be pruned after the request key changes"
    );
    let immediately_after_change = pipeline
      .shared_runtime_cached_snapshot_for_test(&c_key)
      .expect("C spectrum consumer");
    assert!(
      !immediately_after_change.output_present,
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
      stereo_map: Vec::new(),
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
    assert_eq!(
      pipeline.shared_runtime_lifecycle_for_test().total_fft_count,
      0
    );
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
        key: "spectrum:single:0:combined:sp50:tilt450:smoff".to_string(),
        channel: SpectrumAnalysisChannel::Single { ch: 0 },
        view: "combined".to_string(),
        speed_percent: 50.0,
        tilt_db_per_octave: 4.5,
        octave_smoothing: "off".to_string(),
      }],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:0:1".to_string(),
        x: 0,
        y: 1,
      }],
      stereo_map: Vec::new(),
    };
    let requests_b = AnalysisRequests {
      spectrum: vec![SpectrumAnalysisRequest {
        key: "spectrum:single:0:combined:sp25:tilt450:smoff".to_string(),
        channel: SpectrumAnalysisChannel::Single { ch: 0 },
        view: "combined".to_string(),
        speed_percent: 25.0,
        tilt_db_per_octave: 4.5,
        octave_smoothing: "off".to_string(),
      }],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:1:0".to_string(),
        x: 1,
        y: 0,
      }],
      stereo_map: Vec::new(),
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
      .shared_spectral_runtime
      .consumer_identity_for_test("spectrum:single:0:combined:sp50:tilt450:smoff")
      .is_some());
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

    assert!(pipeline
      .shared_spectral_runtime
      .consumer_identity_for_test("spectrum:single:0:combined:sp25:tilt450:smoff")
      .is_some());
    assert!(pipeline
      .shared_spectral_runtime
      .consumer_identity_for_test("spectrum:single:0:combined:sp50:tilt450:smoff")
      .is_none());
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
          key: "spectrum:single:0:combined:sp50:tilt450:smoff".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 0 },
          view: "combined".to_string(),
          speed_percent: 50.0,
          tilt_db_per_octave: 4.5,
          octave_smoothing: "off".to_string(),
        },
        SpectrumAnalysisRequest {
          key: "spectrum:single:1:combined:sp50:tilt450:smoff".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 1 },
          view: "combined".to_string(),
          speed_percent: 50.0,
          tilt_db_per_octave: 4.5,
          octave_smoothing: "off".to_string(),
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
      stereo_map: Vec::new(),
    };

    let mut frame = None;
    for _ in 0..4 {
      pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
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
      .get("spectrum:single:0:combined:sp50:tilt450:smoff")
      .is_some_and(|result| !result.smooth_db.is_empty()));
    assert!(frame
      .spectrum_results_by_key
      .get("spectrum:single:1:combined:sp50:tilt450:smoff")
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
          key: "spectrum:single:0:combined:sp50:tilt450:smoff".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 0 },
          view: "combined".to_string(),
          speed_percent: 50.0,
          tilt_db_per_octave: 4.5,
          octave_smoothing: "off".to_string(),
        },
        SpectrumAnalysisRequest {
          key: "spectrum:single:1:combined:sp50:tilt450:smoff".to_string(),
          channel: SpectrumAnalysisChannel::Single { ch: 1 },
          view: "combined".to_string(),
          speed_percent: 50.0,
          tilt_db_per_octave: 4.5,
          octave_smoothing: "off".to_string(),
        },
      ],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:0:1".to_string(),
        x: 0,
        y: 1,
      }],
      stereo_map: Vec::new(),
    };

    let mut frame = None;
    for _ in 0..6 {
      pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
      // Force a visual tick on each push so the final frame carries a visual hist entry.
      pipeline.last_visual_emit = instant_ago(Duration::from_millis(VISUAL_EMIT_MS as u64 + 1));
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
      .get("spectrum:single:0:combined:sp50:tilt450:smoff")
      .is_some_and(|entry| !entry.smooth_db.is_empty()));
    assert!(visual
      .spectrum_by_key
      .get("spectrum:single:1:combined:sp50:tilt450:smoff")
      .is_some_and(|entry| !entry.smooth_db.is_empty()));
    assert_eq!(visual.vectorscope_by_key.len(), 1);
    assert!(visual
      .vectorscope_by_key
      .get("vectorscope:pair:0:1")
      .is_some_and(|entry| !entry.pairs.is_empty()));
    assert_eq!(
      visual
        .vectorscope_by_key
        .get("vectorscope:pair:0:1")
        .map(|entry| entry.pairs.len()),
      Some(VS_HISTORY_POINTS * 2)
    );
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
        key: "spectrum:single:0:combined:sp50:tilt450:smoff".to_string(),
        channel: SpectrumAnalysisChannel::Single { ch: 0 },
        view: "combined".to_string(),
        speed_percent: 50.0,
        tilt_db_per_octave: 4.5,
        octave_smoothing: "off".to_string(),
      }],
      vectorscope: vec![VectorscopeAnalysisRequest {
        key: "vectorscope:pair:0:1".to_string(),
        x: 0,
        y: 1,
      }],
      stereo_map: Vec::new(),
    };

    let chunk_ms = ((frames as f64 / sr as f64) * 1000.0) as u64;
    let mut spectrum_entries = 0_usize;
    let mut vectorscope_entries = 0_usize;
    let tally = |frame: &AudioFramePayload, sp: &mut usize, vs: &mut usize| {
      for entry in &frame.visual_hist_batch {
        if entry
          .spectrum_by_key
          .get("spectrum:single:0:combined:sp50:tilt450:smoff")
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

  fn spectrum_request(
    key: &str,
    channel: crate::ipc::types::SpectrumAnalysisChannel,
    view: &str,
  ) -> crate::ipc::types::SpectrumAnalysisRequest {
    crate::ipc::types::SpectrumAnalysisRequest {
      key: key.to_string(),
      channel,
      view: view.to_string(),
      speed_percent: 50.0,
      tilt_db_per_octave: 4.5,
      octave_smoothing: "1/6".to_string(),
    }
  }

  fn legacy_spectrum_result(
    request: &crate::ipc::types::SpectrumAnalysisRequest,
    sample_rate: f64,
    channels: u16,
    pcm: &[f32],
    now_sec: f64,
  ) -> (SpectrumFrameResult, SpectrumVisualEntry) {
    let mut meter = legacy_meter_for_request(request, sample_rate);
    push_legacy_meter(&mut meter, request, channels, pcm, now_sec);
    legacy_payload_from_meter(&meter)
  }

  fn legacy_meter_for_request(
    request: &crate::ipc::types::SpectrumAnalysisRequest,
    sample_rate: f64,
  ) -> crate::dsp::SpectrumMeter {
    use crate::dsp::{OctaveSmoothing, SpectrumMeter};

    let mut meter = SpectrumMeter::new(sample_rate);
    let smoothing = match request.octave_smoothing.as_str() {
      "1/12" => OctaveSmoothing::OneTwelfth,
      "1/6" => OctaveSmoothing::OneSixth,
      "1/3" => OctaveSmoothing::OneThird,
      _ => OctaveSmoothing::Off,
    };
    meter.set_display_controls(request.speed_percent, request.tilt_db_per_octave, smoothing);
    meter
  }

  fn push_legacy_meter(
    meter: &mut crate::dsp::SpectrumMeter,
    request: &crate::ipc::types::SpectrumAnalysisRequest,
    channels: u16,
    pcm: &[f32],
    now_sec: f64,
  ) {
    use crate::ipc::types::SpectrumAnalysisChannel;

    let selection = match request.channel {
      SpectrumAnalysisChannel::Pair { x, y } => SpectrumChannelSel::Pair(x, y),
      SpectrumAnalysisChannel::Single { ch } => SpectrumChannelSel::Single(ch),
    };
    let view = match request.view.as_str() {
      "lr" => SpectrumView::Lr,
      "ms" => SpectrumView::Ms,
      _ => SpectrumView::Combined,
    };
    meter.push_pair(pcm, channels, now_sec, selection, view);
  }

  fn legacy_payload_from_meter(
    meter: &crate::dsp::SpectrumMeter,
  ) -> (SpectrumFrameResult, SpectrumVisualEntry) {
    let (centers, smooth, peak) = meter.last_output();
    let (path, peak_path) = if centers.is_empty() {
      (String::new(), String::new())
    } else {
      spectrum_paths_from_bands(centers, smooth, peak, true)
    };
    let (path_b, peak_path_b, smooth_db_b, peak_db_b) = meter
      .last_output_secondary()
      .map(|(smooth_b, peak_b)| {
        let (path_b, peak_path_b) = spectrum_paths_from_bands(centers, smooth_b, peak_b, true);
        (path_b, peak_path_b, smooth_b.to_vec(), peak_b.to_vec())
      })
      .unwrap_or_default();
    let result = SpectrumFrameResult {
      path,
      peak_path,
      path_b,
      peak_path_b,
      band_centers_hz: centers.to_vec(),
      smooth_db: smooth.to_vec(),
      peak_db: peak.to_vec(),
      smooth_db_b,
      peak_db_b,
    };
    let visual = SpectrumVisualEntry {
      band_centers_hz: result.band_centers_hz.clone(),
      smooth_db: result.smooth_db.clone(),
      smooth_db_b: result.smooth_db_b.clone(),
    };
    (result, visual)
  }

  fn assert_rows_with_route_tolerance(
    actual: &[f64],
    expected: &[f64],
    tolerance_db: f64,
    label: &str,
  ) {
    assert_eq!(actual.len(), expected.len(), "{label} length");
    if tolerance_db == 0.0 {
      assert_eq!(actual, expected, "{label} exact rows");
      return;
    }
    for (index, (&actual, &expected)) in actual.iter().zip(expected).enumerate() {
      assert!(
        (actual - expected).abs() <= tolerance_db,
        "{label}[{index}]: actual={actual}, expected={expected}, tolerance={tolerance_db}"
      );
    }
  }

  fn svg_points(path: &str) -> Vec<(f64, f64)> {
    let tokens: Vec<_> = path.split_whitespace().collect();
    assert_eq!(tokens.len() % 3, 0, "invalid SVG token count: {path}");
    tokens
      .chunks_exact(3)
      .map(|chunk| {
        assert!(matches!(chunk[0], "M" | "L"), "invalid SVG command");
        (
          chunk[1].parse().expect("SVG x coordinate"),
          chunk[2].parse().expect("SVG y coordinate"),
        )
      })
      .collect()
  }

  fn assert_svg_with_route_tolerance(actual: &str, expected: &str, tolerance_db: f64, label: &str) {
    if tolerance_db == 0.0 {
      assert_eq!(actual, expected, "{label} exact SVG");
      return;
    }
    let actual = svg_points(actual);
    let expected = svg_points(expected);
    assert_eq!(actual.len(), expected.len(), "{label} SVG point count");
    // The 100 dB plot spans 246 viewBox pixels; include 0.01 formatting quantization.
    let y_tolerance = tolerance_db * 2.46 + 0.011;
    for (index, ((actual_x, actual_y), (expected_x, expected_y))) in
      actual.iter().zip(&expected).enumerate()
    {
      assert!(
        (actual_x - expected_x).abs() <= 0.001,
        "{label}[{index}] x: {actual_x} vs {expected_x}"
      );
      assert!(
        (actual_y - expected_y).abs() <= y_tolerance,
        "{label}[{index}] y: {actual_y} vs {expected_y}, tolerance={y_tolerance}"
      );
    }
  }

  fn assert_result_matches_legacy(
    actual: &SpectrumFrameResult,
    legacy: &SpectrumFrameResult,
    tolerance_db: f64,
    label: &str,
  ) {
    assert_eq!(
      actual.band_centers_hz, legacy.band_centers_hz,
      "{label} centers"
    );
    assert_eq!(actual.smooth_db.len(), actual.band_centers_hz.len());
    assert_eq!(actual.peak_db.len(), actual.band_centers_hz.len());
    assert_eq!(actual.smooth_db_b.len(), legacy.smooth_db_b.len());
    assert_eq!(actual.peak_db_b.len(), legacy.peak_db_b.len());
    assert_rows_with_route_tolerance(
      &actual.smooth_db,
      &legacy.smooth_db,
      tolerance_db,
      &format!("{label} smooth"),
    );
    assert_rows_with_route_tolerance(
      &actual.peak_db,
      &legacy.peak_db,
      tolerance_db,
      &format!("{label} peak"),
    );
    assert_rows_with_route_tolerance(
      &actual.smooth_db_b,
      &legacy.smooth_db_b,
      tolerance_db,
      &format!("{label} smooth-b"),
    );
    assert_rows_with_route_tolerance(
      &actual.peak_db_b,
      &legacy.peak_db_b,
      tolerance_db,
      &format!("{label} peak-b"),
    );
    for (name, actual_path, legacy_path) in [
      ("path", &actual.path, &legacy.path),
      ("peak-path", &actual.peak_path, &legacy.peak_path),
      ("path-b", &actual.path_b, &legacy.path_b),
      ("peak-path-b", &actual.peak_path_b, &legacy.peak_path_b),
    ] {
      assert_eq!(
        actual_path.is_empty(),
        legacy_path.is_empty(),
        "{label} {name} presence"
      );
      assert_svg_with_route_tolerance(
        actual_path,
        legacy_path,
        tolerance_db,
        &format!("{label} {name}"),
      );
    }
  }

  fn assert_visual_matches_legacy(
    actual: &SpectrumVisualEntry,
    legacy: &SpectrumVisualEntry,
    tolerance_db: f64,
    label: &str,
  ) {
    assert_eq!(
      actual.band_centers_hz, legacy.band_centers_hz,
      "{label} visual centers"
    );
    assert_rows_with_route_tolerance(
      &actual.smooth_db,
      &legacy.smooth_db,
      tolerance_db,
      &format!("{label} visual smooth"),
    );
    assert_rows_with_route_tolerance(
      &actual.smooth_db_b,
      &legacy.smooth_db_b,
      tolerance_db,
      &format!("{label} visual smooth-b"),
    );
  }

  fn assert_legacy_payload_map(
    frame: &AudioFramePayload,
    legacy: &HashMap<String, (SpectrumFrameResult, SpectrumVisualEntry, f64)>,
  ) {
    let mut actual_keys: Vec<_> = frame
      .spectrum_results_by_key
      .keys()
      .map(String::as_str)
      .collect();
    actual_keys.sort_unstable();
    let mut expected_keys: Vec<_> = legacy.keys().map(String::as_str).collect();
    expected_keys.sort_unstable();
    assert_eq!(actual_keys, expected_keys, "exact result-key membership");

    for key in expected_keys {
      let result = &frame.spectrum_results_by_key[key];
      let (legacy_result, _, tolerance_db) = &legacy[key];
      assert_result_matches_legacy(result, legacy_result, *tolerance_db, key);
    }
  }

  fn payload_parity_sample_rates() -> &'static [u32] {
    &[16_000, 22_050, 44_100, 48_000, 96_000]
  }

  #[test]
  fn production_payload_parity_matrix_covers_representative_sample_rates() {
    assert_eq!(
      payload_parity_sample_rates(),
      &[16_000, 22_050, 44_100, 48_000, 96_000]
    );
  }

  #[test]
  fn production_spectrum_payload_matches_legacy_single_direct_physical_lr_and_ms() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::dsp::SpectrumMeter;
    use crate::ipc::types::SpectrumAnalysisChannel;

    for &sample_rate in payload_parity_sample_rates() {
      let fixture_frames = ((sample_rate as f64 * 1.1).ceil() as usize).max(FFT_BIG);
      let pcm = deterministic_stereo(fixture_frames, 0);
      let readiness_split = (FFT_BIG - 1) * 2;
      let cases = [
        AnalysisRequests {
          spectrum: vec![spectrum_request(
            "direct",
            SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
            "combined",
          )],
          vectorscope: vec![],
          stereo_map: Vec::new(),
        },
        AnalysisRequests {
          spectrum: vec![
            spectrum_request(
              "single",
              SpectrumAnalysisChannel::Single { ch: 0 },
              "combined",
            ),
            spectrum_request(
              "physical-combined",
              SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
              "combined",
            ),
            spectrum_request("lr", SpectrumAnalysisChannel::Pair { x: 0, y: 1 }, "lr"),
            spectrum_request("ms", SpectrumAnalysisChannel::Pair { x: 0, y: 1 }, "ms"),
          ],
          vectorscope: vec![],
          stereo_map: Vec::new(),
        },
      ];

      for requests in cases {
        let mut pipeline = MeterPipeline::new(sample_rate, 2);
        let mut legacy_meters: HashMap<String, (SpectrumMeter, f64)> = requests
          .spectrum
          .iter()
          .map(|request| {
            let tolerance = if matches!(request.key.as_str(), "physical-combined" | "ms") {
              0.0225
            } else {
              0.0
            };
            (
              request.key.clone(),
              (
                legacy_meter_for_request(request, sample_rate as f64),
                tolerance,
              ),
            )
          })
          .collect();

        pipeline.set_dsp_time_for_test(SpectralDspTime::from_monotonic_seconds(0.9));
        for request in &requests.spectrum {
          push_legacy_meter(
            &mut legacy_meters.get_mut(&request.key).unwrap().0,
            request,
            2,
            &pcm[..readiness_split],
            0.9,
          );
        }
        pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
        let pending = pipeline
          .push_pcm_f32_with_requests(
            &pcm[..readiness_split],
            ChannelLayoutSetting::Auto,
            &requests,
            None,
            false,
            VadEngineKind::default(),
          )
          .expect("pending spectrum frame");
        let pending_legacy: HashMap<_, _> = legacy_meters
          .iter()
          .map(|(key, (meter, tolerance))| {
            let (result, visual) = legacy_payload_from_meter(meter);
            (key.clone(), (result, visual, *tolerance))
          })
          .collect();
        assert_legacy_payload_map(&pending, &pending_legacy);

        pipeline.set_dsp_time_for_test(SpectralDspTime::from_monotonic_seconds(1.0));
        for request in &requests.spectrum {
          push_legacy_meter(
            &mut legacy_meters.get_mut(&request.key).unwrap().0,
            request,
            2,
            &pcm[readiness_split..],
            1.0,
          );
        }
        pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
        pipeline.last_visual_emit = instant_ago(Duration::from_millis(VISUAL_EMIT_MS as u64 + 1));
        let frame = pipeline
          .push_pcm_f32_with_requests(
            &pcm[readiness_split..],
            ChannelLayoutSetting::Auto,
            &requests,
            None,
            false,
            VadEngineKind::default(),
          )
          .expect("warmed spectrum frame");
        let legacy: HashMap<_, _> = legacy_meters
          .iter()
          .map(|(key, (meter, tolerance))| {
            let (result, visual) = legacy_payload_from_meter(meter);
            (key.clone(), (result, visual, *tolerance))
          })
          .collect();

        assert_legacy_payload_map(&frame, &legacy);
        let visual = frame.visual_hist_tick.as_ref().expect("live visual tick");
        let mut visual_keys: Vec<_> = visual.spectrum_by_key.keys().map(String::as_str).collect();
        visual_keys.sort_unstable();
        let mut sorted_expected: Vec<_> = legacy.keys().map(String::as_str).collect();
        sorted_expected.sort_unstable();
        assert_eq!(visual_keys, sorted_expected, "exact visual-key membership");
        assert_eq!(visual.timestamp_ms, frame.timestamp_ms);
        for key in sorted_expected {
          let (_, legacy_visual, tolerance_db) = &legacy[key];
          assert_visual_matches_legacy(
            &visual.spectrum_by_key[key],
            legacy_visual,
            *tolerance_db,
            &format!("{sample_rate} Hz {key}"),
          );
        }
      }
    }
  }

  #[test]
  fn legacy_payload_comparison_rejects_path_and_visual_mutations() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::ipc::types::SpectrumAnalysisChannel;

    let request = spectrum_request(
      "single",
      SpectrumAnalysisChannel::Single { ch: 0 },
      "combined",
    );
    let pcm = deterministic_stereo(FFT_BIG, 0);
    let (legacy_result, legacy_visual) = legacy_spectrum_result(&request, 48_000.0, 2, &pcm, 1.0);

    let mut altered_path = legacy_result.clone();
    altered_path.path.push_str(" L 0.00 0.00");
    assert!(
      std::panic::catch_unwind(|| {
        assert_result_matches_legacy(&altered_path, &legacy_result, 0.0, "path mutation");
      })
      .is_err(),
      "an altered legacy path must be rejected"
    );

    let mut altered_visual = legacy_visual.clone();
    altered_visual.smooth_db[0] += 1.0;
    assert!(
      std::panic::catch_unwind(|| {
        assert_visual_matches_legacy(&altered_visual, &legacy_visual, 0.0, "visual mutation");
      })
      .is_err(),
      "an altered legacy visual row must be rejected"
    );
  }

  #[test]
  fn production_and_legacy_readiness_match_at_low_rate_window_boundary() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::dsp::{OctaveSmoothing, SpectrumMeter};
    use crate::ipc::types::SpectrumAnalysisChannel;

    let sample_rate = 16_000_u32;
    let request = spectrum_request(
      "single",
      SpectrumAnalysisChannel::Single { ch: 0 },
      "combined",
    );
    let requests = AnalysisRequests {
      spectrum: vec![request],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let pcm = deterministic_stereo(FFT_BIG, 0);
    let split = (FFT_BIG - 1) * 2;
    let mut legacy = SpectrumMeter::new(sample_rate as f64);
    legacy.set_display_controls(50.0, 4.5, OctaveSmoothing::OneSixth);
    let mut pipeline = MeterPipeline::new(sample_rate, 2);
    pipeline.set_dsp_time_for_test(SpectralDspTime::from_monotonic_seconds(1.0));

    legacy.push_pair(
      &pcm[..split],
      2,
      1.0,
      SpectrumChannelSel::Single(0),
      SpectrumView::Combined,
    );
    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let pending = pipeline
      .push_pcm_f32_with_requests(
        &pcm[..split],
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("pending frame");
    assert!(legacy.last_output().0.is_empty());
    assert!(pending.spectrum_results_by_key["single"]
      .band_centers_hz
      .is_empty());

    legacy.push_pair(
      &pcm[split..],
      2,
      1.1,
      SpectrumChannelSel::Single(0),
      SpectrumView::Combined,
    );
    pipeline.set_dsp_time_for_test(SpectralDspTime::from_monotonic_seconds(1.1));
    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let ready = pipeline
      .push_pcm_f32_with_requests(
        &pcm[split..],
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("ready frame");
    let (legacy_centers, legacy_smooth, legacy_peak) = legacy.last_output();
    let actual = &ready.spectrum_results_by_key["single"];
    assert_eq!(actual.band_centers_hz, legacy_centers);
    assert_eq!(actual.smooth_db, legacy_smooth);
    assert_eq!(actual.peak_db, legacy_peak);
  }

  #[test]
  fn file_visual_batch_matches_legacy_rows_timestamps_and_cadence() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::dsp::{OctaveSmoothing, SpectrumMeter};
    use crate::ipc::types::SpectrumAnalysisChannel;

    let request = spectrum_request(
      "direct",
      SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
      "combined",
    );
    let requests = AnalysisRequests {
      spectrum: vec![request.clone()],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let chunk_frames = FFT_BIG / 4;
    let mut pipeline = MeterPipeline::new_for_file(48_000, 2);
    let mut legacy = SpectrumMeter::new(48_000.0);
    legacy.set_display_controls(50.0, 4.5, OctaveSmoothing::OneSixth);
    let mut timestamps = Vec::new();
    let mut clock = 0_u64;

    for chunk_index in 1..=6_u64 {
      let pcm = deterministic_stereo(chunk_frames, clock);
      clock += chunk_frames as u64;
      let now_sec = chunk_index as f64 * 0.1;
      legacy.push_pair(
        &pcm,
        2,
        now_sec,
        SpectrumChannelSel::Pair(0, 1),
        SpectrumView::Combined,
      );
      let (_, legacy_visual) = legacy_payload_from_meter(&legacy);
      pipeline.set_dsp_time_for_test(SpectralDspTime::from_monotonic_seconds(now_sec));
      pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
      let frame = pipeline
        .push_pcm_f32_with_requests_at_media_time(
          &pcm,
          ChannelLayoutSetting::Auto,
          &requests,
          None,
          false,
          VadEngineKind::default(),
          chunk_index * 100,
        )
        .expect("forced file frame");
      for entry in &frame.visual_hist_batch {
        timestamps.push(entry.timestamp_ms);
        assert_visual_matches_legacy(
          &entry.spectrum_by_key["direct"],
          &legacy_visual,
          0.0,
          "file direct visual",
        );
      }
    }

    assert_eq!(timestamps, vec![100, 200, 300, 400, 500, 600]);
  }

  #[test]
  fn file_stereo_map_batch_preserves_each_checkpoint_snapshot_without_future_backfill() {
    let mut request = stereo_map_request("batched");
    request.speed_percent = 0.0;
    let requests = AnalysisRequests {
      spectrum: Vec::new(),
      vectorscope: Vec::new(),
      stereo_map: vec![request],
    };
    let chunk_frames = 4_800_usize;
    let mut pipeline = MeterPipeline::new_for_file(48_000, 2);

    for checkpoint in 1..=5_u64 {
      let pcm = if checkpoint < 5 {
        deterministic_stereo(chunk_frames, (checkpoint - 1) * chunk_frames as u64)
      } else {
        vec![0.0_f32; chunk_frames * 2]
      };
      // Deterministically hold every checkpoint in one pending batch, independent of machine speed.
      pipeline.last_frame_emit = Instant::now()
        .checked_add(Duration::from_secs(60))
        .expect("future throttle instant");
      assert!(pipeline
        .push_pcm_f32_with_requests_at_media_time(
          &pcm,
          ChannelLayoutSetting::Auto,
          &requests,
          None,
          false,
          VadEngineKind::default(),
          checkpoint * 100,
        )
        .is_none());
    }

    let batch = pipeline
      .flush_file_batch(&requests)
      .expect("forced drain of five visual checkpoints")
      .visual_hist_batch;
    assert_eq!(
      batch
        .iter()
        .map(|entry| entry.timestamp_ms)
        .collect::<Vec<_>>(),
      vec![100, 200, 300, 400, 500]
    );
    assert!(
      batch[..3]
        .iter()
        .all(|entry| !entry.stereo_map_by_key.contains_key("batched")),
      "warmup checkpoints must not receive a future ready row"
    );
    let early = &batch[3].stereo_map_by_key["batched"];
    let later = &batch[4].stereo_map_by_key["batched"];
    assert!(!early.band_centers_hz.is_empty());
    assert_eq!(early.band_centers_hz.len(), early.pl.len());
    assert_eq!(early.pl.len(), early.pr.len());
    assert_eq!(early.pr.len(), early.c.len());
    assert_ne!(
      early.pl, later.pl,
      "each timestamp must retain the row captured at that checkpoint"
    );

    pipeline.last_frame_emit = Instant::now()
      .checked_add(Duration::from_secs(60))
      .expect("future throttle instant");
    assert!(pipeline
      .push_pcm_f32_with_requests_at_media_time(
        &deterministic_stereo(chunk_frames, chunk_frames as u64 * 5),
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
        600,
      )
      .is_none());
    pipeline.clear_peak_and_history();

    for checkpoint in 7..=10_u64 {
      pipeline.last_frame_emit = Instant::now()
        .checked_add(Duration::from_secs(60))
        .expect("future throttle instant");
      assert!(pipeline
        .push_pcm_f32_with_requests_at_media_time(
          &deterministic_stereo(chunk_frames, (checkpoint - 1) * chunk_frames as u64,),
          ChannelLayoutSetting::Auto,
          &requests,
          None,
          false,
          VadEngineKind::default(),
          checkpoint * 100,
        )
        .is_none());
    }
    let after_clear = pipeline
      .flush_file_batch(&requests)
      .expect("post-Clear visual checkpoints")
      .visual_hist_batch;
    assert_eq!(
      after_clear
        .iter()
        .map(|entry| entry.timestamp_ms)
        .collect::<Vec<_>>(),
      vec![700, 800, 900, 1_000],
      "Clear must discard every pre-Clear pending checkpoint"
    );
    assert!(after_clear[..3]
      .iter()
      .all(|entry| entry.stereo_map_by_key.is_empty()));
    assert!(after_clear[3].stereo_map_by_key.contains_key("batched"));

    pipeline.last_frame_emit = Instant::now()
      .checked_add(Duration::from_secs(60))
      .expect("future throttle instant");
    assert!(pipeline
      .push_pcm_f32_with_requests_at_media_time(
        &deterministic_stereo(chunk_frames, chunk_frames as u64 * 10),
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
        1_100,
      )
      .is_none());
    let inactive = AnalysisRequests::default();
    pipeline.last_frame_emit = Instant::now()
      .checked_add(Duration::from_secs(60))
      .expect("future throttle instant");
    assert!(pipeline
      .push_pcm_f32_with_requests_at_media_time(
        &deterministic_stereo(chunk_frames, chunk_frames as u64 * 11),
        ChannelLayoutSetting::Auto,
        &inactive,
        None,
        false,
        VadEngineKind::default(),
        1_200,
      )
      .is_none());
    let after_remove = pipeline
      .flush_file_batch(&inactive)
      .expect("active then removed checkpoints")
      .visual_hist_batch;
    assert!(after_remove[0].stereo_map_by_key.contains_key("batched"));
    assert!(
      after_remove[1].stereo_map_by_key.is_empty(),
      "removed key must be absent from its own checkpoint without erasing earlier rows"
    );
  }

  #[test]
  fn production_spectrum_grid_matches_legacy_at_every_supported_rate() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::ipc::types::SpectrumAnalysisChannel;

    for &sample_rate in payload_parity_sample_rates() {
      let request = spectrum_request(
        "single",
        SpectrumAnalysisChannel::Single { ch: 0 },
        "combined",
      );
      let requests = AnalysisRequests {
        spectrum: vec![request.clone()],
        vectorscope: vec![],
        stereo_map: Vec::new(),
      };
      let pcm = deterministic_stereo(FFT_BIG, 0);
      let (_, legacy_visual) = legacy_spectrum_result(&request, sample_rate as f64, 2, &pcm, 1.0);
      let mut pipeline = MeterPipeline::new(sample_rate, 2);
      pipeline.set_dsp_time_for_test(SpectralDspTime::from_monotonic_seconds(1.0));
      pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
      let frame = pipeline
        .push_pcm_f32_with_requests(
          &pcm,
          ChannelLayoutSetting::Auto,
          &requests,
          None,
          false,
          VadEngineKind::default(),
        )
        .expect("low-rate production frame");
      let actual = &frame.spectrum_results_by_key["single"];

      assert_eq!(
        actual.band_centers_hz, legacy_visual.band_centers_hz,
        "{sample_rate} Hz exact centers"
      );
      assert_eq!(
        actual.smooth_db.len(),
        legacy_visual.smooth_db.len(),
        "{sample_rate} Hz row length"
      );
      let expected_max = 20_000.0_f64.min(sample_rate as f64 * 0.499);
      assert!(
        (actual.band_centers_hz.last().copied().unwrap() - expected_max).abs()
          <= expected_max * f64::EPSILON,
        "{sample_rate} Hz upper grid bound"
      );
    }
  }

  #[test]
  fn production_spectrum_prunes_old_key_without_stale_payload() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::ipc::types::SpectrumAnalysisChannel;

    let old = AnalysisRequests {
      spectrum: vec![spectrum_request(
        "old",
        SpectrumAnalysisChannel::Single { ch: 0 },
        "combined",
      )],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let new = AnalysisRequests {
      spectrum: vec![spectrum_request(
        "new",
        SpectrumAnalysisChannel::Single { ch: 1 },
        "combined",
      )],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let mut pipeline = MeterPipeline::new(48_000, 2);
    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let warmed = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(FFT_BIG, 0),
        ChannelLayoutSetting::Auto,
        &old,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("old frame");
    assert!(!warmed.spectrum_results_by_key["old"].smooth_db.is_empty());

    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let pending = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(FFT_BIG - 1, FFT_BIG as u64),
        ChannelLayoutSetting::Auto,
        &new,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("new pending frame");
    assert_eq!(
      pending.spectrum_results_by_key.keys().collect::<Vec<_>>(),
      vec![&"new".to_string()]
    );
    let pending_result = &pending.spectrum_results_by_key["new"];
    assert!(pending_result.smooth_db.is_empty());
    assert!(pending_result.band_centers_hz.is_empty());
    assert!(pending_result.path.is_empty());
    assert!(pending_result.peak_path.is_empty());
    assert!(pending_result.path_b.is_empty());
    assert!(pending_result.peak_path_b.is_empty());
  }

  #[test]
  fn production_pipeline_has_no_per_key_spectrum_fft_owner() {
    let source = include_str!("meter_pipeline.rs");
    let legacy_field = ["spectrum_by_key:", " HashMap<String, SpectrumMeter>"].concat();
    assert!(
      !source.contains(&legacy_field),
      "production MeterPipeline still owns one legacy FFT bank per request key"
    );
    assert!(
      source.contains("shared_spectral_runtime: SharedSpectralRuntime,")
        && !source.contains("#[cfg(test)]\n  shared_spectral_runtime: SharedSpectralRuntime,"),
      "the real MeterPipeline path must unconditionally own SharedSpectralRuntime"
    );
  }

  #[test]
  fn production_spectral_consumer_does_not_depend_on_legacy_meter() {
    let source = include_str!("../dsp/spectrum_consumer.rs");
    let production_source = source
      .split("#[cfg(test)]\nmod tests")
      .next()
      .expect("production source");
    let legacy_type = ["Spectrum", "Meter"].concat();
    assert!(
      !production_source.contains(&legacy_type),
      "production SpectralConsumer still imports or calls the legacy meter"
    );
  }

  #[test]
  fn production_pipeline_transforms_each_planned_stream_once_not_per_request() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::ipc::types::SpectrumAnalysisChannel;

    let first = spectrum_request(
      "first",
      SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
      "combined",
    );
    let second = spectrum_request(
      "second",
      SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
      "combined",
    );
    let single = AnalysisRequests {
      spectrum: vec![first.clone()],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let duplicate = AnalysisRequests {
      spectrum: vec![first, second],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let pcm = deterministic_stereo(FFT_BIG * 2, 0);
    let mut one_request = MeterPipeline::new(48_000, 2);
    let mut two_requests = MeterPipeline::new(48_000, 2);

    let _ = one_request.push_pcm_f32_with_requests(
      &pcm,
      ChannelLayoutSetting::Auto,
      &single,
      None,
      false,
      VadEngineKind::default(),
    );
    let _ = two_requests.push_pcm_f32_with_requests(
      &pcm,
      ChannelLayoutSetting::Auto,
      &duplicate,
      None,
      false,
      VadEngineKind::default(),
    );

    let one = one_request.shared_runtime_lifecycle_for_test();
    let two = two_requests.shared_runtime_lifecycle_for_test();
    assert_eq!(one.streams.len(), 1);
    assert_eq!(two.streams.len(), 1);
    assert!(one.total_fft_count > 0);
    assert_eq!(two.total_fft_count, one.total_fft_count);
    assert_eq!(two.streams[0].fft_count, one.streams[0].fft_count);
  }

  #[test]
  fn production_request_control_update_preserves_shared_consumer_state() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::ipc::types::SpectrumAnalysisChannel;

    let mut request = spectrum_request(
      "stable-key",
      SpectrumAnalysisChannel::Single { ch: 0 },
      "combined",
    );
    let mut pipeline = MeterPipeline::new(48_000, 2);
    let initial = AnalysisRequests {
      spectrum: vec![request.clone()],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let _ = pipeline.push_pcm_f32_with_requests(
      &deterministic_stereo(FFT_BIG, 0),
      ChannelLayoutSetting::Auto,
      &initial,
      None,
      false,
      VadEngineKind::default(),
    );
    let before = pipeline
      .shared_runtime_snapshot_for_test("stable-key", 1.0)
      .expect("warmed shared consumer");

    request.speed_percent = 75.0;
    request.tilt_db_per_octave = 2.0;
    request.octave_smoothing = "1/3".to_string();
    let updated = AnalysisRequests {
      spectrum: vec![request],
      vectorscope: vec![],
      stereo_map: Vec::new(),
    };
    let _ = pipeline.push_pcm_f32_with_requests(
      &deterministic_stereo(2048, FFT_BIG as u64),
      ChannelLayoutSetting::Auto,
      &updated,
      None,
      false,
      VadEngineKind::default(),
    );
    let after = pipeline
      .shared_runtime_snapshot_for_test("stable-key", 1.1)
      .expect("updated shared consumer");

    assert_eq!(after.identity, before.identity);
    assert_eq!(after.state.state_epoch, before.state.state_epoch);
    assert!(after
      .consume_counts
      .iter()
      .zip(before.consume_counts)
      .all(|(after, before)| after >= &before));
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
      pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
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
      pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
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
    p.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
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

  #[test]
  fn active_stereo_map_keys_emit_one_finite_equal_length_live_result_each() {
    use crate::dsp::spectrum_bank::FFT_BIG;
    use crate::ipc::types::{StereoMapAnalysisPair, StereoMapAnalysisRequest};

    let requests = AnalysisRequests {
      spectrum: Vec::new(),
      vectorscope: Vec::new(),
      stereo_map: ["first", "second"]
        .into_iter()
        .map(|key| StereoMapAnalysisRequest {
          key: key.to_string(),
          pair: StereoMapAnalysisPair {
            first: 0,
            second: 1,
          },
          speed_percent: 50.0,
          octave_smoothing: "off".to_string(),
        })
        .collect(),
    };
    let mut pipeline = MeterPipeline::new(48_000, 2);
    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let frame = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(FFT_BIG, 0),
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("warmed Stereo Map frame");

    assert_eq!(frame.stereo_map_results_by_key.len(), 2);
    for key in ["first", "second"] {
      let row = &frame.stereo_map_results_by_key[key];
      assert!(!row.band_centers_hz.is_empty());
      assert_eq!(row.band_centers_hz.len(), row.pl.len());
      assert_eq!(row.pl.len(), row.pr.len());
      assert_eq!(row.pr.len(), row.c.len());
      assert!(row.band_centers_hz.iter().all(|value| value.is_finite()));
      assert!(row.pl.iter().all(|value| value.is_finite()));
      assert!(row.pr.iter().all(|value| value.is_finite()));
      assert!(row.c.iter().all(|value| value.is_finite()));
    }
  }

  #[test]
  fn stereo_map_one_deduplicated_key_owns_one_consumer_and_removed_key_stops_immediately() {
    use crate::dsp::spectrum_bank::FFT_BIG;

    let active = AnalysisRequests {
      spectrum: Vec::new(),
      vectorscope: Vec::new(),
      // Duplicate frontend instances have already collapsed to this one keyed request.
      stereo_map: vec![stereo_map_request("shared-key")],
    };
    let inactive = AnalysisRequests::default();
    let mut pipeline = MeterPipeline::new(48_000, 2);
    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    pipeline.last_visual_emit = instant_ago(Duration::from_millis(VISUAL_EMIT_MS as u64 + 1));
    let initial_warmup = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(FFT_BIG - 1, 0),
        ChannelLayoutSetting::Auto,
        &active,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("initial warmup frame");
    assert!(!initial_warmup
      .stereo_map_results_by_key
      .contains_key("shared-key"));
    assert!(!initial_warmup
      .visual_hist_tick
      .expect("initial warmup visual")
      .stereo_map_by_key
      .contains_key("shared-key"));

    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let warmed = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(1, (FFT_BIG - 1) as u64),
        ChannelLayoutSetting::Auto,
        &active,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("warmed frame");
    assert_eq!(warmed.stereo_map_results_by_key.len(), 1);
    let consumed = pipeline
      .stereo_map_consume_counts_for_test("shared-key")
      .expect("one keyed consumer");
    assert!(consumed.iter().all(|count| *count > 0));

    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let removed = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(FFT_BIG, FFT_BIG as u64),
        ChannelLayoutSetting::Auto,
        &inactive,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("frame after removal");
    assert!(removed.stereo_map_results_by_key.is_empty());
    assert_eq!(
      pipeline.stereo_map_consume_counts_for_test("shared-key"),
      None,
      "removed key must be pruned before the next PCM push"
    );

    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    pipeline.last_visual_emit = instant_ago(Duration::from_millis(VISUAL_EMIT_MS as u64 + 1));
    let reactivated = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(FFT_BIG - 1, (FFT_BIG * 2) as u64),
        ChannelLayoutSetting::Auto,
        &active,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("reactivated frame");
    assert!(!reactivated
      .stereo_map_results_by_key
      .contains_key("shared-key"));
    assert!(!reactivated
      .visual_hist_tick
      .expect("reactivation warmup visual")
      .stereo_map_by_key
      .contains_key("shared-key"));
  }

  #[test]
  fn stereo_map_visual_rows_follow_live_forty_ms_gate() {
    use crate::dsp::spectrum_bank::FFT_BIG;

    let requests = AnalysisRequests {
      spectrum: Vec::new(),
      vectorscope: Vec::new(),
      stereo_map: vec![stereo_map_request("visual")],
    };
    let mut pipeline = MeterPipeline::new(48_000, 2);
    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    pipeline.last_visual_emit = instant_ago(Duration::from_millis(VISUAL_EMIT_MS as u64 + 1));
    let first = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(FFT_BIG, 0),
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("first live frame");
    let visual = first.visual_hist_tick.expect("40 ms visual checkpoint");
    assert_eq!(visual.stereo_map_by_key.len(), 1);
    assert!(!visual.stereo_map_by_key["visual"].pl.is_empty());

    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let before_gate = pipeline
      .push_pcm_f32_with_requests(
        &[],
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("forced live frame");
    assert!(
      before_gate.visual_hist_tick.is_none(),
      "frame cadence must not bypass the existing 40 ms visual gate"
    );
  }

  #[test]
  fn clear_resets_stereo_map_pair_accumulators_and_restarts_warmup() {
    use crate::dsp::spectrum_bank::FFT_BIG;

    let requests = AnalysisRequests {
      spectrum: Vec::new(),
      vectorscope: Vec::new(),
      stereo_map: vec![stereo_map_request("clearable")],
    };
    let mut pipeline = MeterPipeline::new(48_000, 2);
    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let warmed = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(FFT_BIG, 0),
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("warmed frame");
    assert!(!warmed.stereo_map_results_by_key["clearable"].pl.is_empty());

    pipeline.clear_peak_and_history();
    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    let warming = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(FFT_BIG - 1, FFT_BIG as u64),
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("post-clear frame");
    assert!(!warming.stereo_map_results_by_key.contains_key("clearable"));
    assert!(!warming
      .visual_hist_tick
      .expect("post-Clear warmup visual")
      .stereo_map_by_key
      .contains_key("clearable"));

    pipeline.last_frame_emit = instant_ago(Duration::from_millis(FRAME_EMIT_MS as u64 + 1));
    pipeline.last_visual_emit = instant_ago(Duration::from_millis(VISUAL_EMIT_MS as u64 + 1));
    let rewarmed = pipeline
      .push_pcm_f32_with_requests(
        &deterministic_stereo(1, (FFT_BIG * 2 - 1) as u64),
        ChannelLayoutSetting::Auto,
        &requests,
        None,
        false,
        VadEngineKind::default(),
      )
      .expect("rewarmed frame");
    let ready = &rewarmed.stereo_map_results_by_key["clearable"];
    assert!(!ready.band_centers_hz.is_empty());
    assert_eq!(ready.band_centers_hz.len(), ready.pl.len());
    assert_eq!(ready.pl.len(), ready.pr.len());
    assert_eq!(ready.pr.len(), ready.c.len());
    let visual = &rewarmed
      .visual_hist_tick
      .expect("ready post-Clear visual")
      .stereo_map_by_key["clearable"];
    assert_eq!(visual.band_centers_hz.len(), visual.pl.len());
    assert!(!visual.band_centers_hz.is_empty());
  }
}
