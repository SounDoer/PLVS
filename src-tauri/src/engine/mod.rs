//! Orchestrates capture → DSP → IPC throttling.

pub mod channel_layout;
mod file_timeline;
pub mod meter_pipeline;
pub(crate) mod spectral_plan;
mod waveform_accumulator;

pub use channel_layout::ChannelLayoutSetting;
pub use meter_pipeline::MeterPipeline;
