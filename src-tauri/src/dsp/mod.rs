//! DSP: PCM → meters (Peak, LUFS, FFT, correlation).

pub mod channel_sel;
pub mod dialogue;
pub mod filters;
pub mod gating;
pub mod loudness;
pub mod meter;
pub mod paths;
pub mod peak;
pub mod spectrum;
pub mod spectrum_bank;
pub mod speech;
pub mod summary_meter;
pub mod vectorscope;

pub use channel_sel::{SpectrumChannelSel, SpectrumView};
pub use loudness::LoudnessMeter;
pub use meter::{Meter, PcmContext};
pub use spectrum::SpectrumMeter;
pub use spectrum_bank::OctaveSmoothing;
pub use vectorscope::VectorscopeMeter;
