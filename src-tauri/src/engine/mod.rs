//! Orchestrates capture → DSP → IPC throttling.

mod file_timeline;
pub mod meter_pipeline;
pub(crate) mod spectral_plan;
mod waveform_accumulator;

pub use meter_pipeline::MeterPipeline;
