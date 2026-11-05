//! Live capture to summary metrics, free of Tauri — the live twin of
//! `file_analysis::summary`. Shares device resolution, sample-format conversion,
//! the buffer pool, and drop accounting with the GUI path via
//! `cpal_backend::run_capture_stream`; only the consumer differs.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::audio::cpal_backend::{
  run_capture_stream, CaptureStreamArgs, PcmBufferPool, PcmDeliveryQueue,
};
use crate::audio::device_enum::{device_list_label, resolve_device};
use crate::dsp::summary_meter::SummaryMeter;

/// One periodic reading emitted while `--every` is active.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureSample {
  pub t_seconds: u64,
  pub integrated_lufs: f64,
  pub lra: f64,
  pub m_max_lufs: f64,
  pub st_max_lufs: f64,
  pub true_peak_max_dbtp: f64,
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
  pub loudness_layout: &'static str,
  pub loudness_layout_known: bool,
  pub dropped_chunks: u64,
}

/// Capture `device_id` for `seconds`, invoking `on_sample` every `every` seconds
/// when set. Blocks for the full duration.
pub fn capture_device_to_summary_with_layout(
  device_id: &str,
  seconds: u64,
  every: Option<u64>,
  layout_id: Option<&str>,
  mut on_sample: impl FnMut(CaptureSample),
) -> Result<CaptureRun, String> {
  // One resolution only: taking the label from this device avoids a second
  // enumeration that could disagree if the device list changes underneath us.
  let (device, supported) = resolve_device(device_id)?;
  let device_label = device_list_label(&device)?;
  let sample_rate = supported.sample_rate();
  let raw_channels = supported.channels();
  let output = device_id.is_empty()
    || device_id == "default"
    || super::device_id::is_stable_loopback_id(device_id)
    || super::device_id::parse_legacy_output_index(device_id).is_some();
  let native_layout = super::source_layout::device_layout(&device, raw_channels, output);
  let plan = if output {
    super::source_layout::MonitoringPlan::require_system_scope(raw_channels, native_layout)?
  } else {
    super::source_layout::MonitoringPlan::new(raw_channels, native_layout)
  };
  let channels = plan.channels();
  #[cfg(feature = "capture-harness")]
  let evidence = super::capture_evidence::EvidenceRecorder::from_env(sample_rate, channels)?;
  let meter = match layout_id {
    Some(layout_id) => SummaryMeter::new_with_layout(sample_rate, channels, layout_id)?,
    None => match plan.roles.as_ref() {
      Some(roles) => SummaryMeter::new_with_roles(sample_rate, channels, roles)?,
      None => SummaryMeter::new(sample_rate, channels),
    },
  };
  // A zero interval would pin every reading at t=0 and emit one per chunk.
  let every = every.filter(|interval| *interval > 0);

  let dropped_chunks = Arc::new(AtomicU64::new(0));
  let dropped_for_report = dropped_chunks.clone();
  let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
  let (result_tx, result_rx) = std::sync::mpsc::channel::<Result<_, String>>();
  let (sample_tx, sample_rx) = std::sync::mpsc::channel::<CaptureSample>();

  let consumer_dropped = dropped_chunks.clone();
  let consumer =
    move |delivery: PcmDeliveryQueue, pool: PcmBufferPool, _sample_rate: u32, _channels: u16| {
      let mut meter = meter;
      let mut projected = Vec::new();
      #[cfg(feature = "capture-harness")]
      let mut evidence = evidence;
      #[cfg(feature = "capture-harness")]
      let mut evidence_error = None;
      let mut next_sample_at = every;
      let started = std::time::Instant::now();

      while let Some(pcm) = delivery.pop_until_stopped() {
        let samples = plan.pcm(&pcm, &mut projected);
        meter.push_interleaved(samples);
        #[cfg(feature = "capture-harness")]
        if evidence_error.is_none() {
          if let Some(recorder) = evidence.as_mut() {
            evidence_error = recorder
              .observe(
                samples,
                meter.evidence_true_peak_max(),
                started.elapsed().as_secs_f64(),
              )
              .err();
          }
        }
        // Mirrors the GUI consumer: the buffer belongs to the pool, not to us.
        pool.recycle(pcm);

        if let (Some(interval), Some(due)) = (every, next_sample_at) {
          if started.elapsed().as_secs() >= due {
            // finish() borrows, so interim readings cost no DSP change.
            let metrics = meter.finish();
            let _ = sample_tx.send(CaptureSample {
              t_seconds: due,
              integrated_lufs: metrics.integrated_lufs,
              lra: metrics.lra,
              m_max_lufs: metrics.m_max_lufs,
              st_max_lufs: metrics.st_max_lufs,
              true_peak_max_dbtp: metrics.true_peak_max_dbtp,
              dropped_chunks: consumer_dropped.load(Ordering::Relaxed),
            });
            // Stays on the requested grid; a late chunk only delays a reading to
            // the next chunk (~100 ms) rather than skipping its t value.
            next_sample_at = Some(due + interval);
          }
        }
      }

      let metrics = meter.finish();
      #[cfg(feature = "capture-harness")]
      if let Some(recorder) = evidence {
        let result = recorder.finish();
        if let Some(error) = evidence_error.or_else(|| result.err()) {
          let _ = result_tx.send(Err(format!("Capture evidence failed: {error}")));
          return;
        }
      }
      let _ = result_tx.send(Ok(metrics));
    };

  let stream_args = CaptureStreamArgs {
    device_id: device_id.to_string(),
    device,
    supported,
    sample_rate,
    channels: raw_channels,
    stop_rx,
    dropped_chunks,
    stream_error: None,
    #[cfg(target_os = "linux")]
    measured_pcm: None,
    #[cfg(target_os = "linux")]
    monitoring_plan: None,
  };

  let capture_thread = std::thread::spawn(move || run_capture_stream(stream_args, consumer));

  // Drain sample lines while the capture runs; stop it once the duration elapses.
  let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
  // The consumer's clock starts only once the device is open, after this one, so
  // the last grid reading falls due just past the deadline. Keep the stream up
  // briefly for it instead of stopping a few hundred ms early and losing it.
  let last_due = every.map(|interval| seconds / interval * interval);
  let grace_deadline = deadline + Duration::from_secs(5);
  let mut last_seen = 0;
  loop {
    let now = std::time::Instant::now();
    let awaiting_last = last_due.is_some_and(|due| last_seen < due);
    if now >= grace_deadline || (now >= deadline && !awaiting_last) {
      break;
    }
    match sample_rx.recv_timeout(Duration::from_millis(200)) {
      Ok(sample) => {
        last_seen = sample.t_seconds;
        on_sample(sample);
      }
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
    .map_err(|_| "Capture produced no metrics".to_string())??;

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
    loudness_layout: metrics.loudness_layout,
    loudness_layout_known: metrics.loudness_layout_known,
    dropped_chunks: dropped_for_report.load(Ordering::Relaxed),
  })
}
