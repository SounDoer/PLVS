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
  /// 7.1 (FL, FR, C, LFE, BL, BR, SL, SR).
  #[serde(rename = "7.1")]
  Surround71,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn default_is_auto() {
    assert_eq!(ChannelLayoutSetting::default(), ChannelLayoutSetting::Auto);
  }
}
