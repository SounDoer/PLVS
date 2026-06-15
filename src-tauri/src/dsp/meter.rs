//! Shared `Meter` trait and `PcmContext` for all DSP metering modules.

use crate::dsp::channel_sel::{SpectrumChannelSel, SpectrumView};
use crate::engine::ChannelLayoutSetting;

/// Context passed to every meter's [`Meter::push_pcm`] call.
pub struct PcmContext<'a> {
  pub interleaved: &'a [f32],
  pub channels: u16,
  pub now_sec: f64,
  pub channel_layout: ChannelLayoutSetting,
  pub loudness_weights: Option<Vec<f64>>,
  pub vectorscope_pair: (u16, u16),
  pub spectrum_channel: SpectrumChannelSel,
  pub spectrum_view: SpectrumView,
  /// When true, run the speech-activity sidechain and populate the dialogue-gated readouts.
  pub dialogue_gating: bool,
}

/// Uniform contract for DSP meters: ingest PCM and reset state.
///
/// Adding a new meter type requires only implementing this trait in a new file;
/// the pipeline calls `push_pcm` + `reset` without knowing each meter's internals.
pub trait Meter: Send {
  fn push_pcm(&mut self, ctx: &PcmContext<'_>);
  fn reset(&mut self);
}
