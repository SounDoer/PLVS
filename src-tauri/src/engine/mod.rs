//! Orchestrates capture → DSP → IPC throttling.

mod file_timeline;
pub mod meter_pipeline;
mod waveform_accumulator;

pub use meter_pipeline::MeterPipeline;
