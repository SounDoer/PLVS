//! DSP: PCM → meters (Peak, LUFS, FFT, correlation).

pub mod channel_sel;
pub mod dialogue;
pub mod filters;
pub mod gating;
pub mod loudness;
pub mod meter;
pub mod paths;
pub mod peak;
pub mod shared_spectral_engine;
pub mod spectral_transform;
pub mod spectral_waveform;
pub mod spectrum;
pub mod spectrum_bank;
mod spectrum_consumer;
#[cfg(test)]
mod spectrum_differential;
#[cfg(test)]
mod spectrum_fixtures;
pub mod speech;
pub mod stereo_map;
pub mod summary_meter;
pub mod vectorscope;

pub use channel_sel::{SpectrumChannelSel, SpectrumView};
pub use loudness::LoudnessMeter;
pub use meter::{Meter, PcmContext};
#[cfg(test)]
pub use spectrum::SpectrumMeter;
pub use spectrum_bank::OctaveSmoothing;
pub(crate) use spectrum_consumer::SpectralOutput;
pub use vectorscope::VectorscopeMeter;
