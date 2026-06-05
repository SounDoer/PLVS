//! Global application state (engine, device selection, etc.).

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::audio::capture::AudioCaptureSession;
use crate::dsp::SpectrumChannelSel;
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::FrameSubscribers;
use crate::ipc::types::MeterHistoryBuf;

pub struct AppState {
  pub capture: Mutex<Option<Box<dyn AudioCaptureSession>>>,
  pub meter_history: MeterHistoryBuf,
  /// `Some` while the native engine is running; stores the primary UI frame channel.
  pub frame_subscribers: Mutex<Option<FrameSubscribers>>,
  /// Selected vectorscope XY channel pair (0-based). Updated by UI.
  pub vectorscope_pair: Arc<Mutex<(u16, u16)>>,
  /// User-selected channel layout preset. Updated by UI; applied on the capture thread.
  pub channel_layout: Arc<Mutex<ChannelLayoutSetting>>,
  /// Selected channel(s) for spectrum analysis. Updated by UI; applied on the capture thread.
  pub spectrum_channel: Arc<Mutex<SpectrumChannelSel>>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      capture: Mutex::new(None),
      meter_history: Arc::new(Mutex::new(VecDeque::new())),
      frame_subscribers: Mutex::new(None),
      vectorscope_pair: Arc::new(Mutex::new((0, 1))),
      channel_layout: Arc::new(Mutex::new(ChannelLayoutSetting::default())),
      spectrum_channel: Arc::new(Mutex::new(SpectrumChannelSel::default())),
    }
  }
}
