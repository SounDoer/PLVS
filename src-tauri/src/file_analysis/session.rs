use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

use tauri::{AppHandle, Emitter, Manager};

use crate::dsp::speech::VadEngineKind;
use crate::engine::{ChannelLayoutSetting, MeterPipeline};
use crate::file_analysis::ffmpeg::decode::{build_decode_args, bytes_to_f32_le, parse_out_time_us};
use crate::file_analysis::ffmpeg::locate::locate_sidecar;
use crate::file_analysis::probe::probe_file;
use crate::ipc::types::{
  AnalysisRequests, AudioFramePayload, FileAnalysisCompletedPayload, FileAnalysisErrorPayload,
  FileAnalysisProgressPayload, FileAnalysisSummaryMetrics, FrameSubscribers,
};

/// Config read once at worker start. Mid-analysis chip changes do not retune the current run.
struct WorkerConfig {
  requests: AnalysisRequests,
  loudness_weights: Option<Vec<f64>>,
  dialogue_gating: bool,
  dialogue_vad_engine: VadEngineKind,
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
  let dialogue_vad_engine = state
    .as_ref()
    .and_then(|s| s.dialogue_vad_engine.lock().ok().map(|g| *g))
    .unwrap_or_default();
  WorkerConfig {
    requests,
    loudness_weights,
    dialogue_gating,
    dialogue_vad_engine,
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
}

impl Drop for FileAnalysisSession {
  fn drop(&mut self) {
    let _ = self.stop_tx.send(());
    if let Some(worker) = self.worker.take() {
      let _ = worker.join();
    }
  }
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

/// Decode `path` via the ffmpeg sidecar and feed PCM to the metering pipeline. Returns `Ok(None)`
/// when cancelled before completion, `Ok(Some((decoded_frames, summary)))` at end of stream.
fn analyze_file_core(
  path: &str,
  config: &WorkerConfig,
  mut on_frame: impl FnMut(AudioFramePayload) -> Result<(), String>,
  mut on_progress: impl FnMut(FileAnalysisProgressPayload),
  should_stop: impl Fn() -> bool,
) -> Result<Option<(u64, FileAnalysisSummaryMetrics)>, String> {
  let probe = probe_file(Path::new(path))?;
  let track = &probe.selected_track;
  let sample_rate = track
    .sample_rate_hz
    .ok_or_else(|| "Selected audio track has no sample rate".to_string())?;
  let channels = track
    .channels
    .ok_or_else(|| "Selected audio track has no channel count".to_string())?;
  let duration_ms = probe.duration_ms;

  let ffmpeg = locate_sidecar("ffmpeg");
  let args = build_decode_args(path, track.index, channels, sample_rate);
  let mut child = Command::new(&ffmpeg)
    .args(&args)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::null())
    .spawn()
    .map_err(|err| format!("FFmpeg component missing or unrunnable: {err}"))?;

  let mut stdout = child.stdout.take().ok_or("ffmpeg stdout unavailable")?;
  let stderr = child.stderr.take().ok_or("ffmpeg stderr unavailable")?;

  // Progress: a reader thread parses `-progress` lines (out_time_us) off stderr and posts the
  // latest media-time microseconds. The main loop reads it without blocking decode.
  let latest_us = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
  let progress_us = latest_us.clone();
  let stderr_thread = thread::spawn(move || {
    use std::io::BufRead;
    let reader = std::io::BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
      if let Some(us) = parse_out_time_us(&line) {
        progress_us.store(us, std::sync::atomic::Ordering::Relaxed);
      }
    }
  });

  let mut pipeline = MeterPipeline::new_for_file(sample_rate, channels);
  let mut decoded_frames = 0_u64;
  let mut last_progress_emit_frames = 0_u64;
  let mut carry: Vec<u8> = Vec::new();
  let mut read_buf = [0_u8; 64 * 1024];

  loop {
    if should_stop() {
      let _ = child.kill();
      let _ = child.wait();
      let _ = stderr_thread.join();
      return Ok(None);
    }
    let n = stdout
      .read(&mut read_buf)
      .map_err(|err| format!("Unable to read decoded audio: {err}"))?;
    if n == 0 {
      break;
    }

    // Stitch any byte that straddles two reads onto the front of this chunk.
    carry.extend_from_slice(&read_buf[..n]);
    let usable = carry.len() - (carry.len() % 4);
    let pcm = bytes_to_f32_le(&carry[..usable]);
    carry.drain(..usable);
    if pcm.is_empty() {
      continue;
    }

    decoded_frames += (pcm.len() / channels.max(1) as usize) as u64;
    let media_time_ms = ((decoded_frames as f64 / sample_rate as f64) * 1000.0).round() as u64;
    if let Some(frame) = pipeline.push_pcm_f32_with_requests_at_media_time(
      &pcm,
      ChannelLayoutSetting::Auto,
      &config.requests,
      config.loudness_weights.clone(),
      config.dialogue_gating,
      config.dialogue_vad_engine,
      media_time_ms,
    ) {
      on_frame(frame)?;
    }

    if decoded_frames - last_progress_emit_frames >= sample_rate as u64 {
      last_progress_emit_frames = decoded_frames;
      let out_us = latest_us.load(std::sync::atomic::Ordering::Relaxed);
      let progress = duration_ms
        .filter(|d| *d > 0)
        .map(|d| ((out_us as f64 / 1000.0) / d as f64).clamp(0.0, 1.0));
      on_progress(FileAnalysisProgressPayload {
        path: path.to_string(),
        decoded_frames,
        total_frames: None,
        progress,
      });
    }
  }

  let status = child
    .wait()
    .map_err(|err| format!("ffmpeg did not exit cleanly: {err}"))?;
  let _ = stderr_thread.join();
  if !status.success() {
    return Err("ffmpeg failed to decode the audio track".to_string());
  }

  if let Some(frame) = pipeline.flush_file_batch(&config.requests) {
    on_frame(frame)?;
  }

  let metrics = pipeline.summary_metrics();
  let summary = FileAnalysisSummaryMetrics {
    duration_ms,
    sample_rate_hz: sample_rate,
    channels,
    integrated_lufs: metrics.integrated_lufs,
    lra: metrics.lra,
    true_peak_max_dbtp: metrics.true_peak_max_dbtp,
    sample_peak_max_l_db: metrics.sample_peak_max_l_db,
    sample_peak_max_r_db: metrics.sample_peak_max_r_db,
    dialogue_integrated: metrics.dialogue_integrated,
  };
  Ok(Some((decoded_frames, summary)))
}

fn run_file_worker(
  path: String,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  stop_rx: Receiver<()>,
) -> Result<(), String> {
  let config = snapshot_config(&app);
  let mut seq = 0_u64;
  let outcome = analyze_file_core(
    &path,
    &config,
    |mut frame| {
      seq += 1;
      frame.seq = seq;
      send_frame(&frame_subscribers, frame)
    },
    |progress| {
      let _ = app.emit("file-analysis-progress", progress);
    },
    || stop_rx.try_recv().is_ok(),
  )?;

  if let Some((decoded_frames, summary)) = outcome {
    let _ = app.emit(
      "file-analysis-completed",
      FileAnalysisCompletedPayload {
        path,
        decoded_frames,
        summary,
      },
    );
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::f64::consts::PI;
  use std::sync::atomic::{AtomicU32, Ordering};

  /// Write a minimal PCM16 little-endian WAV so ffmpeg can probe/decode a deterministic fixture
  /// without checking a binary asset into the repo.
  fn write_pcm16_wav(path: &Path, sample_rate: u32, channels: u16, samples: &[i16]) {
    let bytes_per_sample = 2_u32;
    let block_align = channels as u32 * bytes_per_sample;
    let byte_rate = sample_rate * block_align;
    let data_len = samples.len() as u32 * bytes_per_sample;
    let mut buf = Vec::with_capacity(44 + data_len as usize);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_len).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16_u32.to_le_bytes());
    buf.extend_from_slice(&1_u16.to_le_bytes());
    buf.extend_from_slice(&channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&(block_align as u16).to_le_bytes());
    buf.extend_from_slice(&16_u16.to_le_bytes());
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
      buf.extend_from_slice(&sample.to_le_bytes());
    }
    std::fs::write(path, buf).expect("write wav fixture");
  }

  /// Temp WAV fixture that cleans itself up on drop.
  struct TempWav {
    path: std::path::PathBuf,
  }

  impl TempWav {
    fn new(name: &str, sample_rate: u32, channels: u16, samples: &[i16]) -> Self {
      static COUNTER: AtomicU32 = AtomicU32::new(0);
      let id = COUNTER.fetch_add(1, Ordering::Relaxed);
      let mut path = std::env::temp_dir();
      path.push(format!("plvs_{}_{}_{}.wav", name, std::process::id(), id));
      write_pcm16_wav(&path, sample_rate, channels, samples);
      Self { path }
    }

    fn path_str(&self) -> String {
      self.path.to_string_lossy().to_string()
    }
  }

  impl Drop for TempWav {
    fn drop(&mut self) {
      let _ = std::fs::remove_file(&self.path);
    }
  }

  fn default_config() -> WorkerConfig {
    WorkerConfig {
      requests: AnalysisRequests::default(),
      loudness_weights: None,
      dialogue_gating: false,
      dialogue_vad_engine: VadEngineKind::default(),
    }
  }

  fn sine_stereo(sample_rate: u32, frames: usize, amplitude: f64, hz: f64) -> Vec<i16> {
    let mut samples = Vec::with_capacity(frames * 2);
    for n in 0..frames {
      let phase = 2.0 * PI * hz * n as f64 / sample_rate as f64;
      let value = (amplitude * phase.sin() * i16::MAX as f64) as i16;
      samples.push(value);
      samples.push(value);
    }
    samples
  }

  #[test]
  fn analyzes_wav_fixture_end_to_end() {
    if !crate::file_analysis::ffmpeg::locate::locate_sidecar("ffmpeg").exists() {
      eprintln!("skipping: ffmpeg sidecar not present");
      return;
    }

    let sr = 48_000_u32;
    let frames = sr as usize; // one second
    let fixture = TempWav::new("sine", sr, 2, &sine_stereo(sr, frames, 0.5, 1_000.0));

    let mut frames_emitted = 0_u32;
    let outcome = analyze_file_core(
      &fixture.path_str(),
      &default_config(),
      |_frame| {
        frames_emitted += 1;
        Ok(())
      },
      |_progress| {},
      || false,
    )
    .expect("analysis should succeed");

    let (decoded_frames, summary) = outcome.expect("completed run, not cancelled");
    assert_eq!(decoded_frames, frames as u64);
    assert_eq!(summary.sample_rate_hz, sr);
    assert_eq!(summary.channels, 2);
    assert_eq!(summary.duration_ms, Some(1_000));
    assert!(frames_emitted > 0, "should emit at least one UI frame");
    // A 0.5 linear-amplitude signal peaks near -6 dBFS.
    assert!(
      summary.sample_peak_max_l_db > -7.0 && summary.sample_peak_max_l_db < -5.0,
      "unexpected sample peak {}",
      summary.sample_peak_max_l_db
    );
    assert!(summary.integrated_lufs.is_finite());
  }

  #[test]
  fn cancellation_returns_without_summary() {
    if !crate::file_analysis::ffmpeg::locate::locate_sidecar("ffmpeg").exists() {
      eprintln!("skipping: ffmpeg sidecar not present");
      return;
    }

    let sr = 48_000_u32;
    let fixture = TempWav::new("cancel", sr, 2, &sine_stereo(sr, sr as usize, 0.5, 1_000.0));

    let outcome = analyze_file_core(
      &fixture.path_str(),
      &default_config(),
      |_frame| Ok(()),
      |_progress| {},
      || true, // cancel before the first packet
    )
    .expect("analysis should succeed");

    assert!(
      outcome.is_none(),
      "a cancelled run must not produce a summary"
    );
  }

  #[test]
  fn missing_file_reports_visible_error() {
    if !crate::file_analysis::ffmpeg::locate::locate_sidecar("ffmpeg").exists() {
      eprintln!("skipping: ffmpeg sidecar not present");
      return;
    }

    let err = analyze_file_core(
      "definitely/not/a/real/path.wav",
      &default_config(),
      |_frame| Ok(()),
      |_progress| {},
      || false,
    )
    .expect_err("missing file should error");
    assert!(
      err.contains("Unsupported or unreadable media file") || err.contains("No audio track"),
      "got: {err}"
    );
  }
}
