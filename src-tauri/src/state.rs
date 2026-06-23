//! Global application state (engine, device selection, etc.).

use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use crate::audio::capture::AudioCaptureSession;
use crate::file_analysis::session::FileAnalysisSession;
use crate::ipc::types::{AnalysisRequests, FrameSubscribers};

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
  /// Active per-instance analysis requests requested by the workspace UI.
  pub analysis_requests: Arc<Mutex<AnalysisRequests>>,
  /// Dynamic loudness energy weights from user channel-role overrides.
  pub loudness_weights: Arc<Mutex<Option<Vec<f64>>>>,
  /// Dialogue gating enabled flag. Updated by UI.
  pub dialogue_gating_enabled: Arc<Mutex<bool>>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      source: Mutex::new(EngineSource::Stopped),
      frame_subscribers: Mutex::new(None),
      frame_ack_seq: Arc::new(AtomicU64::new(0)),
      analysis_requests: Arc::new(Mutex::new(AnalysisRequests::default())),
      loudness_weights: Arc::new(Mutex::new(None)),
      dialogue_gating_enabled: Arc::new(Mutex::new(false)),
    }
  }
}
