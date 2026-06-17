//! Global application state (engine, device selection, etc.).

use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use crate::audio::capture::AudioCaptureSession;
use crate::dsp::SpectrumChannelSel;
use crate::ipc::types::FrameSubscribers;

pub struct AppState {
  pub capture: Mutex<Option<Box<dyn AudioCaptureSession>>>,
  /// `Some` while the native engine is running; stores the primary UI frame channel.
  pub frame_subscribers: Mutex<Option<FrameSubscribers>>,
  /// Highest frame `seq` the UI has acknowledged (via `ack_frames`). The capture bridge compares
  /// it against frames sent to bound the unacked backlog on the backpressure-free UI Channel.
  pub frame_ack_seq: Arc<AtomicU64>,
  /// Selected vectorscope XY channel pair (0-based). Updated by UI.
  pub vectorscope_pair: Arc<Mutex<(u16, u16)>>,
  /// Selected channel(s) for spectrum analysis. Updated by UI; applied on the capture thread.
  pub spectrum_channel: Arc<Mutex<SpectrumChannelSel>>,
  /// Selected spectrum view mode (Combined/Lr/Ms). Updated by UI; applied on the capture thread.
  pub spectrum_view: Arc<Mutex<crate::dsp::SpectrumView>>,
  /// Dynamic loudness energy weights from user channel-role overrides.
  pub loudness_weights: Arc<Mutex<Option<Vec<f64>>>>,
  /// Dialogue gating enabled flag. Updated by UI.
  pub dialogue_gating_enabled: Arc<Mutex<bool>>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      capture: Mutex::new(None),
      frame_subscribers: Mutex::new(None),
      frame_ack_seq: Arc::new(AtomicU64::new(0)),
      vectorscope_pair: Arc::new(Mutex::new((0, 1))),
      spectrum_channel: Arc::new(Mutex::new(SpectrumChannelSel::default())),
      spectrum_view: Arc::new(Mutex::new(crate::dsp::SpectrumView::default())),
      loudness_weights: Arc::new(Mutex::new(None)),
      dialogue_gating_enabled: Arc::new(Mutex::new(false)),
    }
  }
}
