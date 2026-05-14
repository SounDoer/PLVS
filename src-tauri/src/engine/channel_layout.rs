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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn from_str_lossy_known_variants() {
    assert_eq!(
      ChannelLayoutSetting::from_str_lossy("stereo"),
      ChannelLayoutSetting::Stereo
    );
    assert_eq!(
      ChannelLayoutSetting::from_str_lossy("5.1"),
      ChannelLayoutSetting::Surround51
    );
    assert_eq!(
      ChannelLayoutSetting::from_str_lossy("surround51"),
      ChannelLayoutSetting::Surround51
    );
    assert_eq!(
      ChannelLayoutSetting::from_str_lossy("surround-5.1"),
      ChannelLayoutSetting::Surround51
    );
  }

  #[test]
  fn from_str_lossy_unknown_falls_back_to_auto() {
    assert_eq!(
      ChannelLayoutSetting::from_str_lossy(""),
      ChannelLayoutSetting::Auto
    );
    assert_eq!(
      ChannelLayoutSetting::from_str_lossy("mono"),
      ChannelLayoutSetting::Auto
    );
    assert_eq!(
      ChannelLayoutSetting::from_str_lossy("7.1"),
      ChannelLayoutSetting::Auto
    );
  }

  #[test]
  fn from_str_lossy_is_case_insensitive() {
    assert_eq!(
      ChannelLayoutSetting::from_str_lossy("STEREO"),
      ChannelLayoutSetting::Stereo
    );
    assert_eq!(
      ChannelLayoutSetting::from_str_lossy("AUTO"),
      ChannelLayoutSetting::Auto
    );
  }

  #[test]
  fn as_str_round_trips() {
    assert_eq!(ChannelLayoutSetting::Auto.as_str(), "auto");
    assert_eq!(ChannelLayoutSetting::Stereo.as_str(), "stereo");
    assert_eq!(ChannelLayoutSetting::Surround51.as_str(), "5.1");
  }

  #[test]
  fn default_is_auto() {
    assert_eq!(ChannelLayoutSetting::default(), ChannelLayoutSetting::Auto);
  }
}
