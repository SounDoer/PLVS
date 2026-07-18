use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::dsp::summary_meter::SummaryMeter;
use crate::file_analysis::ffmpeg::decode::{build_decode_args, bytes_to_f32_le_into};
use crate::file_analysis::probe::probe_media_file;
use crate::file_analysis::types::{FileAnalysisProbeResult, FileAnalysisSummaryMetrics};
use crate::sidecar::locate_sidecar;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone)]
pub struct FileAnalysisSummaryRun {
  pub probe: FileAnalysisProbeResult,
  pub decoded_frames: u64,
  pub summary: FileAnalysisSummaryMetrics,
}

pub(crate) struct SummaryPcmChunker {
  channels: usize,
  chunk_samples: usize,
  pending: Vec<f32>,
  decoded_frames: u64,
}

impl SummaryPcmChunker {
  pub(crate) fn new(sample_rate: u32, channels: u16) -> Self {
    let channels = channels.max(1) as usize;
    Self {
      channels,
      chunk_samples: (sample_rate as usize / 10).max(1) * channels,
      pending: Vec::new(),
      decoded_frames: 0,
    }
  }

  pub(crate) fn decoded_frames(&self) -> u64 {
    self.decoded_frames
  }

  pub(crate) fn push_pcm(&mut self, meter: &mut SummaryMeter, pcm: &[f32]) {
    self.pending.extend_from_slice(pcm);
    self.drain_ready_chunks(meter);
  }

  pub(crate) fn flush(&mut self, meter: &mut SummaryMeter) {
    if self.pending.is_empty() {
      return;
    }
    let usable_samples = self.pending.len() - (self.pending.len() % self.channels);
    if usable_samples == 0 {
      self.pending.clear();
      return;
    }
    let chunk = self.pending[..usable_samples].to_vec();
    self.pending.clear();
    self.push_chunk(meter, &chunk);
  }

  fn drain_ready_chunks(&mut self, meter: &mut SummaryMeter) {
    let mut consumed = 0_usize;
    while self.pending.len().saturating_sub(consumed) >= self.chunk_samples {
      let end = consumed + self.chunk_samples;
      let chunk = self.pending[consumed..end].to_vec();
      self.push_chunk(meter, &chunk);
      consumed = end;
    }
    if consumed > 0 {
      self.pending.drain(..consumed);
    }
  }

  fn push_chunk(&mut self, meter: &mut SummaryMeter, chunk: &[f32]) {
    self.decoded_frames += (chunk.len() / self.channels) as u64;
    meter.push_interleaved(chunk);
  }
}

pub fn analyze_file_to_summary(path: &str) -> Result<FileAnalysisSummaryRun, String> {
  analyze_file_track_to_summary(path, None)
}

pub fn analyze_file_track_to_summary(
  path: &str,
  track_index: Option<u32>,
) -> Result<FileAnalysisSummaryRun, String> {
  let media_probe = probe_media_file(Path::new(path))?;
  let selected_track = match track_index {
    Some(index) => media_probe
      .audio_tracks
      .iter()
      .find(|track| track.index == index)
      .cloned()
      .ok_or_else(|| format!("Audio track index {index} was not found in media file"))?,
    None => media_probe
      .audio_tracks
      .first()
      .cloned()
      .ok_or_else(|| "No audio track found in media file".to_string())?,
  };
  let probe = FileAnalysisProbeResult {
    path: media_probe.path,
    file_name: media_probe.file_name,
    container: media_probe.container,
    duration_ms: media_probe.duration_ms,
    selected_track,
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
  let mut stderr = child.stderr.take().ok_or("ffmpeg stderr unavailable")?;
  let stderr_thread = thread::spawn(move || {
    let mut sink = Vec::new();
    let _ = stderr.read_to_end(&mut sink);
  });

  let mut meter = SummaryMeter::new(sample_rate, channels);
  let mut pcm_chunker = SummaryPcmChunker::new(sample_rate, channels);
  let mut carry: Vec<u8> = Vec::new();
  let mut pcm: Vec<f32> = Vec::new();
  let mut read_buf = [0_u8; 64 * 1024];

  loop {
    let n = stdout
      .read(&mut read_buf)
      .map_err(|err| format!("Unable to read decoded audio: {err}"))?;
    if n == 0 {
      break;
    }

    carry.extend_from_slice(&read_buf[..n]);
    let usable = carry.len() - (carry.len() % 4);
    bytes_to_f32_le_into(&carry[..usable], &mut pcm);
    carry.drain(..usable);
    if pcm.is_empty() {
      continue;
    }

    pcm_chunker.push_pcm(&mut meter, &pcm);
  }

  let status = child
    .wait()
    .map_err(|err| format!("ffmpeg did not exit cleanly: {err}"))?;
  let _ = stderr_thread.join();
  if !status.success() {
    return Err("ffmpeg failed to decode the audio track".to_string());
  }

  pcm_chunker.flush(&mut meter);

  let metrics = meter.finish();
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
    dialogue_integrated: f64::NEG_INFINITY,
    dialogue_lra: 0.0,
  };

  Ok(FileAnalysisSummaryRun {
    probe,
    decoded_frames: pcm_chunker.decoded_frames(),
    summary,
  })
}
