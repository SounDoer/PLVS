//! Global application state (engine, device selection, etc.).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::audio::capture::AudioCaptureSession;
use crate::dsp::speech::VadEngineKind;
use crate::file_analysis::session::FileAnalysisSession;
use crate::ipc::types::{AnalysisRequests, FrameSubscribers};

/// Session-local counters for the native-to-WebView frame bridge. These are diagnostic only: they
/// observe the existing backpressure policy without changing when a frame is sent or dropped.
#[derive(Default)]
pub struct UiFrameDiagnosticsCounters {
  sent_frames: AtomicU64,
  dropped_frames: AtomicU64,
  audio_dropped_chunks: AtomicU64,
  max_inflight_frames: AtomicU64,
}

impl UiFrameDiagnosticsCounters {
  pub fn reset(&self) {
    self.sent_frames.store(0, Ordering::Relaxed);
    self.dropped_frames.store(0, Ordering::Relaxed);
    self.audio_dropped_chunks.store(0, Ordering::Relaxed);
    self.max_inflight_frames.store(0, Ordering::Relaxed);
  }

  pub fn record_sent(&self, sent_frames: u64, acked_frames: u64) {
    self.sent_frames.store(sent_frames, Ordering::Relaxed);
    self
      .max_inflight_frames
      .fetch_max(sent_frames.saturating_sub(acked_frames), Ordering::Relaxed);
  }

  pub fn record_dropped(&self) {
    self.dropped_frames.fetch_add(1, Ordering::Relaxed);
  }

  pub fn record_audio_dropped_chunks(&self, count: u64) {
    self
      .audio_dropped_chunks
      .fetch_add(count, Ordering::Relaxed);
  }

  pub fn snapshot(
    &self,
    acked_frames: u64,
    inflight_limit: u64,
  ) -> crate::ipc::types::UiFrameDiagnostics {
    let sent_frames = self.sent_frames.load(Ordering::Relaxed);
    crate::ipc::types::UiFrameDiagnostics {
      sent_frames,
      dropped_frames: self.dropped_frames.load(Ordering::Relaxed),
      audio_dropped_chunks: self.audio_dropped_chunks.load(Ordering::Relaxed),
      current_inflight_frames: sent_frames.saturating_sub(acked_frames),
      max_inflight_frames: self.max_inflight_frames.load(Ordering::Relaxed),
      inflight_limit,
    }
  }
}

/// The single active engine source. PLVS runs at most one of these at a time; switching sources
/// replaces this value, which stops the previous source through its `Drop`. Modeling the source as
/// one enum (instead of two independent `Option`s) makes the "only one active source" invariant
/// hold by construction rather than by remembering to clear the other slot.
#[derive(Default)]
pub enum EngineSource {
  #[default]
  Stopped,
  Live(Box<dyn AudioCaptureSession>),
  // The session is held only so its `Drop` stops the file-analysis worker when the source is
  // replaced; it is never read back out, hence the `dead_code` allow on the field.
  File(#[allow(dead_code)] FileAnalysisSession),
}

pub struct AppState {
  pub source: Mutex<EngineSource>,
  /// `Some` while the native engine is running; stores the primary UI frame channel.
  pub frame_subscribers: Mutex<Option<FrameSubscribers>>,
  /// Highest frame `seq` the UI has acknowledged (via `ack_frames`). The capture bridge compares
  /// it against frames sent to bound the unacked backlog on the backpressure-free UI Channel.
  pub frame_ack_seq: Arc<AtomicU64>,
  /// Diagnostic-only counters for frames successfully sent to or dropped before the primary UI.
  pub ui_frame_diagnostics: Arc<UiFrameDiagnosticsCounters>,
  /// Active per-instance analysis requests requested by the workspace UI.
  pub analysis_requests: Arc<Mutex<AnalysisRequests>>,
  /// Dynamic loudness energy weights from user channel-role overrides.
  pub loudness_weights: Arc<Mutex<Option<Vec<f64>>>>,
  /// Dialogue gating enabled flag. Updated by UI.
  pub dialogue_gating_enabled: Arc<Mutex<bool>>,
  /// VAD engine used by dialogue-gated stats.
  pub dialogue_vad_engine: Arc<Mutex<VadEngineKind>>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      source: Mutex::new(EngineSource::Stopped),
      frame_subscribers: Mutex::new(None),
      frame_ack_seq: Arc::new(AtomicU64::new(0)),
      ui_frame_diagnostics: Arc::new(UiFrameDiagnosticsCounters::default()),
      analysis_requests: Arc::new(Mutex::new(AnalysisRequests::default())),
      loudness_weights: Arc::new(Mutex::new(None)),
      dialogue_gating_enabled: Arc::new(Mutex::new(false)),
      dialogue_vad_engine: Arc::new(Mutex::new(VadEngineKind::default())),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::UiFrameDiagnosticsCounters;

  #[test]
  fn diagnostics_distinguish_sent_dropped_and_acknowledged_frames() {
    let counters = UiFrameDiagnosticsCounters::default();
    counters.record_sent(120, 0);
    counters.record_dropped();
    counters.record_dropped();
    counters.record_audio_dropped_chunks(3);

    let stalled = counters.snapshot(0, 120);
    assert_eq!(stalled.sent_frames, 120);
    assert_eq!(stalled.dropped_frames, 2);
    assert_eq!(stalled.audio_dropped_chunks, 3);
    assert_eq!(stalled.current_inflight_frames, 120);
    assert_eq!(stalled.max_inflight_frames, 120);
    assert_eq!(stalled.inflight_limit, 120);

    let caught_up = counters.snapshot(120, 120);
    assert_eq!(caught_up.current_inflight_frames, 0);
    assert_eq!(caught_up.max_inflight_frames, 120);
  }

  #[test]
  fn diagnostics_reset_for_a_fresh_session() {
    let counters = UiFrameDiagnosticsCounters::default();
    counters.record_sent(12, 3);
    counters.record_dropped();
    counters.reset();

    assert_eq!(
      counters.snapshot(0, 120),
      crate::ipc::types::UiFrameDiagnostics {
        sent_frames: 0,
        dropped_frames: 0,
        audio_dropped_chunks: 0,
        current_inflight_frames: 0,
        max_inflight_frames: 0,
        inflight_limit: 120,
      }
    );
  }
}
