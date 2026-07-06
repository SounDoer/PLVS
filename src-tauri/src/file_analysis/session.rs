use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::dsp::speech::VadEngineKind;
use crate::engine::{ChannelLayoutSetting, MeterPipeline};
use crate::file_analysis::ffmpeg::decode::{
  build_decode_args, bytes_to_f32_le_into, parse_out_time_us,
};
use crate::file_analysis::ffmpeg::locate::locate_sidecar;
use crate::file_analysis::probe::probe_file;
use crate::ipc::types::{
  AnalysisRequests, AudioFramePayload, FileAnalysisCompletedPayload, FileAnalysisErrorPayload,
  FileAnalysisProbeResult, FileAnalysisProgressPayload, FileAnalysisSummaryMetrics,
  FrameSubscribers,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Config read once at worker start. Mid-analysis chip changes do not retune the current run.
struct WorkerConfig {
  requests: AnalysisRequests,
  loudness_weights: Option<Vec<f64>>,
  dialogue_gating: bool,
  dialogue_vad_engine: VadEngineKind,
}

fn file_pipeline_chunk_frames(sample_rate: u32) -> usize {
  (sample_rate as usize / 10).max(1)
}

struct FilePcmHistoryChunker {
  channels: usize,
  sample_rate: u32,
  chunk_samples: usize,
  pending: Vec<f32>,
  decoded_frames: u64,
}

impl FilePcmHistoryChunker {
  fn new(sample_rate: u32, channels: u16) -> Self {
    let channels = channels.max(1) as usize;
    Self {
      channels,
      sample_rate,
      chunk_samples: file_pipeline_chunk_frames(sample_rate) * channels,
      pending: Vec::new(),
      decoded_frames: 0,
    }
  }

  fn decoded_frames(&self) -> u64 {
    self.decoded_frames
  }

  #[allow(clippy::too_many_arguments)]
  fn push_pcm(
    &mut self,
    pipeline: &mut MeterPipeline,
    pcm: &[f32],
    config: &WorkerConfig,
    on_frame: &mut impl FnMut(AudioFramePayload) -> Result<(), String>,
  ) -> Result<(), String> {
    self.pending.extend_from_slice(pcm);
    self.drain_ready_chunks(pipeline, config, on_frame)
  }

  fn flush(
    &mut self,
    pipeline: &mut MeterPipeline,
    config: &WorkerConfig,
    on_frame: &mut impl FnMut(AudioFramePayload) -> Result<(), String>,
  ) -> Result<(), String> {
    if self.pending.is_empty() {
      return Ok(());
    }
    let usable_samples = self.pending.len() - (self.pending.len() % self.channels);
    if usable_samples == 0 {
      self.pending.clear();
      return Ok(());
    }
    let chunk = self.pending[..usable_samples].to_vec();
    self.pending.clear();
    self.push_chunk(pipeline, &chunk, config, on_frame)
  }

  fn drain_ready_chunks(
    &mut self,
    pipeline: &mut MeterPipeline,
    config: &WorkerConfig,
    on_frame: &mut impl FnMut(AudioFramePayload) -> Result<(), String>,
  ) -> Result<(), String> {
    let mut consumed = 0_usize;
    while self.pending.len().saturating_sub(consumed) >= self.chunk_samples {
      let end = consumed + self.chunk_samples;
      let chunk = self.pending[consumed..end].to_vec();
      self.push_chunk(pipeline, &chunk, config, on_frame)?;
      consumed = end;
    }
    if consumed > 0 {
      self.pending.drain(..consumed);
    }
    Ok(())
  }

  fn push_chunk(
    &mut self,
    pipeline: &mut MeterPipeline,
    chunk: &[f32],
    config: &WorkerConfig,
    on_frame: &mut impl FnMut(AudioFramePayload) -> Result<(), String>,
  ) -> Result<(), String> {
    self.decoded_frames += (chunk.len() / self.channels) as u64;
    let media_time_ms =
      ((self.decoded_frames as f64 / self.sample_rate as f64) * 1000.0).round() as u64;
    if let Some(frame) = pipeline.push_pcm_f32_with_requests_at_media_time(
      chunk,
      ChannelLayoutSetting::Auto,
      &config.requests,
      config.loudness_weights.clone(),
      config.dialogue_gating,
      config.dialogue_vad_engine,
      media_time_ms,
    ) {
      on_frame(frame)?;
    }
    Ok(())
  }
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
    probe: Option<FileAnalysisProbeResult>,
    frame_subscribers: FrameSubscribers,
    app: AppHandle,
  ) -> Result<Self, String> {
    // The frontend normally passes the just-probed metadata so the worker can start ffmpeg without
    // launching ffprobe a second time. If unavailable or stale, the worker falls back internally.
    let (stop_tx, stop_rx) = mpsc::channel();
    let worker_path = path.clone();
    let worker = thread::Builder::new()
      .name("file-analysis-worker".into())
      .spawn(move || {
        if let Err(message) = run_file_worker(
          worker_path.clone(),
          probe,
          frame_subscribers,
          app.clone(),
          stop_rx,
        ) {
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
  probe: Option<&FileAnalysisProbeResult>,
  config: &WorkerConfig,
  mut on_frame: impl FnMut(AudioFramePayload) -> Result<(), String>,
  mut on_progress: impl FnMut(FileAnalysisProgressPayload),
  should_stop: impl Fn() -> bool,
) -> Result<Option<(u64, FileAnalysisSummaryMetrics)>, String> {
  let probe = match probe {
    Some(probe) if probe.path == path => probe.clone(),
    _ => probe_file(Path::new(path))?,
  };
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
  let mut command = Command::new(&ffmpeg);
  command
    .args(&args)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::null());
  #[cfg(windows)]
  command.creation_flags(CREATE_NO_WINDOW);

  let mut child = command
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
  let mut last_progress_emit_frames = 0_u64;
  let mut pcm_chunker = FilePcmHistoryChunker::new(sample_rate, channels);
  let mut carry: Vec<u8> = Vec::new();
  let mut pcm: Vec<f32> = Vec::new();
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
    bytes_to_f32_le_into(&carry[..usable], &mut pcm);
    carry.drain(..usable);
    if pcm.is_empty() {
      continue;
    }

    pcm_chunker.push_pcm(&mut pipeline, &pcm, config, &mut on_frame)?;

    if pcm_chunker.decoded_frames() - last_progress_emit_frames >= sample_rate as u64 {
      last_progress_emit_frames = pcm_chunker.decoded_frames();
      let out_us = latest_us.load(std::sync::atomic::Ordering::Relaxed);
      let progress = duration_ms
        .filter(|d| *d > 0)
        .map(|d| ((out_us as f64 / 1000.0) / d as f64).clamp(0.0, 1.0));
      on_progress(FileAnalysisProgressPayload {
        path: path.to_string(),
        decoded_frames: pcm_chunker.decoded_frames(),
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

  pcm_chunker.flush(&mut pipeline, config, &mut on_frame)?;

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
    m_max_lufs: metrics.m_max_lufs,
    st_max_lufs: metrics.st_max_lufs,
    true_peak_max_dbtp: metrics.true_peak_max_dbtp,
    sample_peak_max_l_db: metrics.sample_peak_max_l_db,
    sample_peak_max_r_db: metrics.sample_peak_max_r_db,
    dialogue_integrated: metrics.dialogue_integrated,
    dialogue_lra: metrics.dialogue_lra,
  };
  Ok(Some((pcm_chunker.decoded_frames(), summary)))
}

fn run_file_worker(
  path: String,
  probe: Option<FileAnalysisProbeResult>,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  stop_rx: Receiver<()>,
) -> Result<(), String> {
  let config = snapshot_config(&app);
  let mut seq = 0_u64;
  let outcome = analyze_file_core(
    &path,
    probe.as_ref(),
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

  fn sine_stereo_f32(sample_rate: u32, frames: usize, amplitude: f64, hz: f64) -> Vec<f32> {
    let mut samples = Vec::with_capacity(frames * 2);
    for n in 0..frames {
      let phase = 2.0 * PI * hz * n as f64 / sample_rate as f64;
      let value = (amplitude * phase.sin()) as f32;
      samples.push(value);
      samples.push(value);
    }
    samples
  }

  #[test]
  fn file_pcm_chunker_keeps_history_at_ten_hz_for_ffmpeg_read_chunks() {
    let sr = 48_000_u32;
    let channels = 2_u16;
    let frames = sr as usize * 2;
    let pcm = sine_stereo_f32(sr, frames, 0.25, 440.0);
    let mut pipeline = MeterPipeline::new_for_file(sr, channels);
    let mut chunker = FilePcmHistoryChunker::new(sr, channels);
    let config = default_config();
    let mut loudness_ticks = 0_usize;
    let mut visual_ticks = 0_usize;
    let mut last_ts = 0_u64;
    let mut on_frame = |frame: AudioFramePayload| {
      for entry in &frame.loudness_hist_batch {
        assert!(
          entry.timestamp_ms >= last_ts,
          "history timestamps must be non-decreasing"
        );
        last_ts = entry.timestamp_ms;
      }
      loudness_ticks += frame.loudness_hist_batch.len();
      visual_ticks += frame.visual_hist_batch.len();
      Ok(())
    };

    // Matches the worker's 64 KiB stdout reads: 16,384 f32 samples = ~170 ms stereo @ 48 kHz.
    for chunk in pcm.chunks((64 * 1024) / 4) {
      chunker
        .push_pcm(&mut pipeline, chunk, &config, &mut on_frame)
        .expect("push pcm");
    }
    chunker
      .flush(&mut pipeline, &config, &mut on_frame)
      .expect("flush pcm");
    if let Some(frame) = pipeline.flush_file_batch(&config.requests) {
      on_frame(frame).expect("flush frame");
    }

    assert_eq!(chunker.decoded_frames(), frames as u64);
    assert!(
      loudness_ticks >= 19,
      "2s file-mode history should be ~20 loudness ticks, got {loudness_ticks}"
    );
    assert!(
      visual_ticks >= 19,
      "2s file-mode history should be ~20 visual ticks, got {visual_ticks}"
    );
    assert!(
      last_ts >= 1_900,
      "ticks should span the full media timeline, last={last_ts}"
    );
  }

  /// Drive the chunker over `pcm` split into `chunk_samples`-sized source reads, then flush.
  /// Returns (decoded_frames, loudness_ticks, visual_ticks, last_timestamp_ms).
  fn run_chunker(
    pcm: &[f32],
    sr: u32,
    channels: u16,
    chunk_samples: usize,
  ) -> (u64, usize, usize, u64) {
    let mut pipeline = MeterPipeline::new_for_file(sr, channels);
    let mut chunker = FilePcmHistoryChunker::new(sr, channels);
    let config = default_config();
    let mut loudness_ticks = 0_usize;
    let mut visual_ticks = 0_usize;
    let mut last_ts = 0_u64;
    {
      let mut on_frame = |frame: AudioFramePayload| {
        loudness_ticks += frame.loudness_hist_batch.len();
        visual_ticks += frame.visual_hist_batch.len();
        if let Some(entry) = frame.loudness_hist_batch.last() {
          last_ts = entry.timestamp_ms;
        }
        Ok(())
      };
      for chunk in pcm.chunks(chunk_samples.max(1)) {
        chunker
          .push_pcm(&mut pipeline, chunk, &config, &mut on_frame)
          .expect("push pcm");
      }
      chunker
        .flush(&mut pipeline, &config, &mut on_frame)
        .expect("flush pcm");
      if let Some(frame) = pipeline.flush_file_batch(&config.requests) {
        on_frame(frame).expect("flush frame");
      }
    }
    (
      chunker.decoded_frames(),
      loudness_ticks,
      visual_ticks,
      last_ts,
    )
  }

  #[test]
  fn file_pcm_chunker_history_row_count_is_chunk_size_invariant() {
    // The cadence contract: source read size may change CPU batching, never history duration.
    let sr = 48_000_u32;
    let channels = 2_u16;
    let frames = sr as usize * 2; // exactly 2 s
    let pcm = sine_stereo_f32(sr, frames, 0.25, 440.0);

    // 64 KiB ffmpeg-style reads (~170 ms) vs tiny 32-frame reads (~0.67 ms).
    let big = run_chunker(&pcm, sr, channels, (64 * 1024) / 4);
    let small = run_chunker(&pcm, sr, channels, 32 * channels as usize);

    assert_eq!(big.0, frames as u64, "big-chunk decoded frame count");
    assert_eq!(
      big.0, small.0,
      "decoded frame count must not depend on source chunk size"
    );
    assert_eq!(
      big.1, small.1,
      "main history row count must not depend on source chunk size ({} vs {})",
      big.1, small.1
    );
    assert_eq!(
      big.2, small.2,
      "visual history row count must not depend on source chunk size"
    );
  }

  #[test]
  fn file_pcm_chunker_partial_tail_preserves_decoded_duration() {
    // A sub-100 ms tail must count toward decoded duration but must not create a partial main row.
    let sr = 48_000_u32;
    let channels = 2_u16;
    let period = sr as usize / 10; // 4800 frames = 100 ms
    let frames = sr as usize * 2 + period / 2; // 2 s + 50 ms tail
    let pcm = sine_stereo_f32(sr, frames, 0.25, 440.0);

    let (decoded, loudness_ticks, _visual_ticks, last_ts) =
      run_chunker(&pcm, sr, channels, (64 * 1024) / 4);

    assert_eq!(
      decoded, frames as u64,
      "tail must be counted in decoded frames"
    );
    assert_eq!(
      loudness_ticks, 20,
      "the 50 ms tail must not close a 21st main block, got {loudness_ticks}"
    );
    assert!(
      last_ts <= frames as u64 * 1000 / sr as u64,
      "last history timestamp must stay within media duration, got {last_ts}"
    );
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
      None,
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
    assert!(summary.m_max_lufs.is_finite());
    assert!(summary.st_max_lufs.is_finite());
    assert_eq!(summary.dialogue_lra, 0.0);
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
      None,
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
      None,
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
