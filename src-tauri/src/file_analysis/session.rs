use std::fs::File;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::{AppHandle, Emitter, Manager};

use crate::engine::{ChannelLayoutSetting, MeterPipeline};
use crate::file_analysis::decode::audio_buffer_ref_to_interleaved_f32;
use crate::file_analysis::probe::{select_first_decodable_track, track_candidate_from_symphonia};
use crate::ipc::types::{
  AnalysisRequests, AudioFramePayload, FileAnalysisCompletedPayload, FileAnalysisErrorPayload,
  FileAnalysisProgressPayload, FileAnalysisSummaryMetrics, FrameSubscribers,
};

/// Config read once at worker start. Mid-analysis chip changes do not retune the current run.
struct WorkerConfig {
  requests: AnalysisRequests,
  loudness_weights: Option<Vec<f64>>,
  dialogue_gating: bool,
}

fn snapshot_config(app: &AppHandle) -> WorkerConfig {
  let state = app.try_state::<crate::state::AppState>();
  let requests = state
    .as_ref()
    .and_then(|s| s.analysis_requests.lock().ok().map(|g| g.clone()))
    .unwrap_or_default();
  let loudness_weights = state
    .as_ref()
    .and_then(|s| s.loudness_weights.lock().ok().map(|g| g.clone()))
    .unwrap_or(None);
  let dialogue_gating = state
    .as_ref()
    .and_then(|s| s.dialogue_gating_enabled.lock().ok().map(|g| *g))
    .unwrap_or(false);
  WorkerConfig {
    requests,
    loudness_weights,
    dialogue_gating,
  }
}

pub struct FileAnalysisSession {
  stop_tx: Sender<()>,
  worker: Option<JoinHandle<()>>,
}

impl FileAnalysisSession {
  pub fn new(stop_tx: Sender<()>, worker: JoinHandle<()>) -> Self {
    Self {
      stop_tx,
      worker: Some(worker),
    }
  }

  pub fn start(
    path: String,
    frame_subscribers: FrameSubscribers,
    app: AppHandle,
  ) -> Result<Self, String> {
    // The frontend already probed this path for UI metadata/duration; the worker probes once
    // itself for the decode reader, so we do not re-probe here.
    let (stop_tx, stop_rx) = mpsc::channel();
    let worker_path = path.clone();
    let worker = thread::Builder::new()
      .name("file-analysis-worker".into())
      .spawn(move || {
        if let Err(message) =
          run_file_worker(worker_path.clone(), frame_subscribers, app.clone(), stop_rx)
        {
          let _ = app.emit(
            "file-analysis-error",
            FileAnalysisErrorPayload {
              path: worker_path,
              message,
            },
          );
        }
      })
      .map_err(|err| format!("Unable to start file analysis worker: {err}"))?;

    Ok(Self::new(stop_tx, worker))
  }

  pub fn stop(mut self) {
    let _ = self.stop_tx.send(());
    if let Some(worker) = self.worker.take() {
      let _ = worker.join();
    }
  }
}

impl Drop for FileAnalysisSession {
  fn drop(&mut self) {
    let _ = self.stop_tx.send(());
    if let Some(worker) = self.worker.take() {
      let _ = worker.join();
    }
  }
}

fn hint_from_path(path: &str) -> Hint {
  let mut hint = Hint::new();
  if let Some(ext) = PathBuf::from(path)
    .extension()
    .and_then(|value| value.to_str())
  {
    hint.with_extension(ext);
  }
  hint
}

fn send_frame(
  frame_subscribers: &FrameSubscribers,
  frame: AudioFramePayload,
) -> Result<(), String> {
  let mut map = frame_subscribers
    .lock()
    .map_err(|_| "frame subscriber map poisoned".to_string())?;
  match map.get_mut("main") {
    Some(tx) => tx
      .send(frame)
      .map_err(|_| "file analysis frame subscriber disconnected".to_string()),
    None => Err("file analysis frame subscriber missing".to_string()),
  }
}

fn run_file_worker(
  path: String,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  stop_rx: Receiver<()>,
) -> Result<(), String> {
  let file = File::open(&path).map_err(|err| format!("Unable to open media file: {err}"))?;
  let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
  let probed = symphonia::default::get_probe()
    .format(
      &hint_from_path(&path),
      mss,
      &FormatOptions::default(),
      &MetadataOptions::default(),
    )
    .map_err(|err| format!("Unsupported or unreadable media file: {err}"))?;

  let mut format = probed.format;

  // Reuse the shared selection rule so the worker decodes exactly the track the probe reported,
  // never a non-null video track.
  let candidates: Vec<_> = format
    .tracks()
    .iter()
    .enumerate()
    .map(|(index, track)| track_candidate_from_symphonia(index, track))
    .collect();
  let selected = select_first_decodable_track(&candidates)?;
  let track = format
    .tracks()
    .get(selected.index as usize)
    .ok_or_else(|| "Selected audio track is missing".to_string())?
    .clone();
  let track_id = track.id;
  let sample_rate = track
    .codec_params
    .sample_rate
    .ok_or_else(|| "Selected audio track has no sample rate".to_string())?;
  let channels = track
    .codec_params
    .channels
    .map(|c| c.count() as u16)
    .ok_or_else(|| "Selected audio track has no channel count".to_string())?;
  let total_frames = track.codec_params.n_frames;

  let mut decoder = symphonia::default::get_codecs()
    .make(&track.codec_params, &DecoderOptions::default())
    .map_err(|err| format!("Unsupported audio codec: {err}"))?;

  let config = snapshot_config(&app);
  let mut pipeline = MeterPipeline::new_for_file(sample_rate, channels);
  let mut seq = 0_u64;
  let mut decoded_frames = 0_u64;
  let mut last_progress_emit_frames = 0_u64;

  loop {
    if stop_rx.try_recv().is_ok() {
      // User cancellation: stop without emitting a completion/summary event. The frontend's
      // stop handler transitions the session back to a non-analyzing state.
      return Ok(());
    }
    let packet = match format.next_packet() {
      Ok(packet) => packet,
      Err(SymphoniaError::IoError(_)) => break,
      Err(err) => return Err(format!("Unable to read media packet: {err}")),
    };
    if packet.track_id() != track_id {
      continue;
    }
    let decoded = match decoder.decode(&packet) {
      Ok(decoded) => decoded,
      Err(SymphoniaError::DecodeError(_)) => continue,
      Err(err) => return Err(format!("Unable to decode audio packet: {err}")),
    };
    let pcm = audio_buffer_ref_to_interleaved_f32(decoded)?;
    decoded_frames += (pcm.len() / channels.max(1) as usize) as u64;
    let media_time_ms =
      ((decoded_frames as f64 / sample_rate as f64) * 1000.0).round() as u64;
    if let Some(mut frame) = pipeline.push_pcm_f32_with_requests_at_media_time(
      &pcm,
      ChannelLayoutSetting::Auto,
      &config.requests,
      config.loudness_weights.clone(),
      config.dialogue_gating,
      media_time_ms,
    ) {
      seq += 1;
      frame.seq = seq;
      send_frame(&frame_subscribers, frame)?;
    }
    // Emit progress about once per second of decoded media.
    if decoded_frames - last_progress_emit_frames >= sample_rate as u64 {
      last_progress_emit_frames = decoded_frames;
      let progress = total_frames
        .filter(|total| *total > 0)
        .map(|total| (decoded_frames as f64 / total as f64).clamp(0.0, 1.0));
      let _ = app.emit(
        "file-analysis-progress",
        FileAnalysisProgressPayload {
          path: path.clone(),
          decoded_frames,
          total_frames,
          progress,
        },
      );
    }
  }

  // Flush any buffered history ticks from the tail of the file before emitting completion.
  if let Some(mut frame) = pipeline.flush_file_batch() {
    seq += 1;
    frame.seq = seq;
    send_frame(&frame_subscribers, frame)?;
  }

  // Authoritative whole-file metrics come from final pipeline state, not the last UI frame.
  let metrics = pipeline.summary_metrics();
  let duration_ms = total_frames.and_then(|n| {
    if sample_rate == 0 {
      None
    } else {
      Some(((n as f64 / sample_rate as f64) * 1000.0).round() as u64)
    }
  });
  let _ = app.emit(
    "file-analysis-completed",
    FileAnalysisCompletedPayload {
      path,
      decoded_frames,
      summary: FileAnalysisSummaryMetrics {
        duration_ms,
        sample_rate_hz: sample_rate,
        channels,
        integrated_lufs: metrics.integrated_lufs,
        lra: metrics.lra,
        true_peak_max_dbtp: metrics.true_peak_max_dbtp,
        sample_peak_max_l_db: metrics.sample_peak_max_l_db,
        sample_peak_max_r_db: metrics.sample_peak_max_r_db,
        dialogue_integrated: metrics.dialogue_integrated,
      },
    },
  );
  Ok(())
}
