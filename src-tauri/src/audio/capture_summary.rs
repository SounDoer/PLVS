//! Live capture to summary metrics, free of Tauri — the live twin of
//! `file_analysis::summary`. Shares device resolution, sample-format conversion,
//! the buffer pool, and drop accounting with the GUI path via
//! `cpal_backend::run_capture_stream`; only the consumer differs.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::audio::cpal_backend::{run_capture_stream, CaptureStreamArgs, PcmBufferPool};
use crate::audio::device_enum::{device_list_label, resolve_device};
use crate::dsp::summary_meter::SummaryMeter;

/// One periodic reading emitted while `--every` is active.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureSample {
  pub t_seconds: u64,
  pub integrated_lufs: f64,
  pub dropped_chunks: u64,
}

/// Everything one `capture` run observed.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureRun {
  pub device_label: String,
  pub device_id: String,
  pub sample_rate_hz: u32,
  pub channel_count: u16,
  pub captured_ms: u64,
  pub integrated_lufs: f64,
  pub lra: f64,
  pub m_max_lufs: f64,
  pub st_max_lufs: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_peak_max_l_db: f64,
  pub sample_peak_max_r_db: f64,
  pub dropped_chunks: u64,
}

/// Capture `device_id` for `seconds`, invoking `on_sample` every `every` seconds
/// when set. Blocks for the full duration.
pub fn capture_device_to_summary(
  device_id: &str,
  seconds: u64,
  every: Option<u64>,
  mut on_sample: impl FnMut(CaptureSample),
) -> Result<CaptureRun, String> {
  // One resolution only: taking the label from this device avoids a second
  // enumeration that could disagree if the device list changes underneath us.
  let (device, supported) = resolve_device(device_id)?;
  let device_label = device_list_label(&device)?;
  let sample_rate = supported.sample_rate();
  let channels = supported.channels();
  // A zero interval would pin every reading at t=0 and emit one per chunk.
  let every = every.filter(|interval| *interval > 0);

  let dropped_chunks = Arc::new(AtomicU64::new(0));
  let dropped_for_report = dropped_chunks.clone();
  let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
  let (result_tx, result_rx) = std::sync::mpsc::channel();
  let (sample_tx, sample_rx) = std::sync::mpsc::channel::<CaptureSample>();

  let consumer_dropped = dropped_chunks.clone();
  let consumer = move |audio_rx: std::sync::mpsc::Receiver<Vec<f32>>,
                       pool: PcmBufferPool,
                       sample_rate: u32,
                       channels: u16| {
    let mut meter = SummaryMeter::new(sample_rate, channels);
    let mut next_sample_at = every;
    let started = std::time::Instant::now();

    while let Ok(pcm) = audio_rx.recv() {
      meter.push_interleaved(&pcm);
      // Mirrors the GUI consumer: the buffer belongs to the pool, not to us.
      pool.recycle(pcm);

      if let (Some(interval), Some(due)) = (every, next_sample_at) {
        if started.elapsed().as_secs() >= due {
          // finish() borrows, so interim readings cost no DSP change.
          let metrics = meter.finish();
          let _ = sample_tx.send(CaptureSample {
            t_seconds: due,
            integrated_lufs: metrics.integrated_lufs,
            dropped_chunks: consumer_dropped.load(Ordering::Relaxed),
          });
          // Stays on the requested grid; a late chunk only delays a reading to
          // the next chunk (~100 ms) rather than skipping its t value.
          next_sample_at = Some(due + interval);
        }
      }
    }

    let metrics = meter.finish();
    let _ = result_tx.send(metrics);
  };

  let stream_args = CaptureStreamArgs {
    device_id: device_id.to_string(),
    device,
    supported,
    sample_rate,
    channels,
    stop_rx,
    dropped_chunks,
  };

  let capture_thread = std::thread::spawn(move || run_capture_stream(stream_args, consumer));

  // Drain sample lines while the capture runs; stop it once the duration elapses.
  let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
  while std::time::Instant::now() < deadline {
    match sample_rx.recv_timeout(Duration::from_millis(200)) {
      Ok(sample) => on_sample(sample),
      Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
      Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
    }
  }
  let _ = stop_tx.send(());

  capture_thread
    .join()
    .map_err(|_| "Capture thread panicked".to_string())??;

  while let Ok(sample) = sample_rx.try_recv() {
    on_sample(sample);
  }

  let metrics = result_rx
    .recv()
    .map_err(|_| "Capture produced no metrics".to_string())?;

  Ok(CaptureRun {
    device_label,
    device_id: device_id.to_string(),
    sample_rate_hz: sample_rate,
    channel_count: channels,
    captured_ms: seconds * 1000,
    integrated_lufs: metrics.integrated_lufs,
    lra: metrics.lra,
    m_max_lufs: metrics.m_max_lufs,
    st_max_lufs: metrics.st_max_lufs,
    true_peak_max_dbtp: metrics.true_peak_max_dbtp,
    sample_peak_max_l_db: metrics.sample_peak_max_l_db,
    sample_peak_max_r_db: metrics.sample_peak_max_r_db,
    dropped_chunks: dropped_for_report.load(Ordering::Relaxed),
  })
}
