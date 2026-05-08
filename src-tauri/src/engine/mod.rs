//! Orchestrates capture → DSP → IPC throttling.

pub mod channel_layout;
pub mod meter_pipeline;

pub use channel_layout::ChannelLayoutSetting;
pub use meter_pipeline::MeterPipeline;
