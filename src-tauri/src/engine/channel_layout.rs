//! User-selected channel layout preset for interpreting multichannel PCM.

use serde::{Deserialize, Serialize};

/// Layout preset selected in UI Settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChannelLayoutSetting {
  #[default]
  Auto,
  Stereo,
  /// 5.1 (FL, FR, C, LFE, SL, SR).
  #[serde(rename = "5.1")]
  Surround51,
}

impl ChannelLayoutSetting {
  pub fn from_str_lossy(s: &str) -> Self {
    match s.trim().to_ascii_lowercase().as_str() {
      "stereo" => Self::Stereo,
      "5.1" | "5_1" | "surround51" | "surround-5.1" | "surround_5.1" => Self::Surround51,
      _ => Self::Auto,
    }
  }

  pub fn as_str(&self) -> &'static str {
    match self {
      Self::Auto => "auto",
      Self::Stereo => "stereo",
      Self::Surround51 => "5.1",
    }
  }
}
