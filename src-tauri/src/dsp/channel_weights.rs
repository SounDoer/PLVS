//! Standard channel layouts inferred from channel count, with ITU-R BS.1770-5 loudness weights.
//!
//! Channel order is the native WAVE (`KSAUDIO_SPEAKER_*`) order, which is also ffmpeg's native
//! layout order, so WASAPI capture and file decode agree. Weights follow BS.1770-5 Annex 3
//! Table 5: 1.41 for the surround pair between 60° and 120° azimuth (`Ls/Rs`), 1.00 for front,
//! back (±135°, `Lb/Rb`) and every other position, 0 for LFE.
//!
//! Labels name the weighting role, not the WAVE speaker bit: `Ls/Rs` is the 1.41 surround pair
//! (≈110° in 5.x, ±90° side in 7.x) even where the device mask calls it BACK_LEFT/BACK_RIGHT.

use super::gating::SURROUND_LOUDNESS_WEIGHT as S;

/// Layout name reported for a channel count, or `None` when the count has no standard layout.
// Consumed by the loudness meters in the next commits.
#[allow(dead_code)]
pub(crate) fn standard_layout_name(channels: u16) -> Option<&'static str> {
  match channels {
    1 => Some("mono"),
    2 => Some("stereo"),
    3 => Some("lcr"),
    4 => Some("quad"),
    5 => Some("5.0"),
    6 => Some("5.1"),
    7 => Some("7.0"),
    8 => Some("7.1"),
    _ => None,
  }
}

/// Per-channel loudness weights for 3–8 channels. Mono and stereo keep their dedicated paths.
pub(crate) fn standard_loudness_weights(channels: u16) -> Option<&'static [f64]> {
  match channels {
    // L R C
    3 => Some(&[1.0, 1.0, 1.0]),
    // L R Ls Rs
    4 => Some(&[1.0, 1.0, S, S]),
    // L R C Ls Rs
    5 => Some(&[1.0, 1.0, 1.0, S, S]),
    // L R C LFE Ls Rs
    6 => Some(&[1.0, 1.0, 1.0, 0.0, S, S]),
    // L R C Lb Rb Ls Rs
    7 => Some(&[1.0, 1.0, 1.0, 1.0, 1.0, S, S]),
    // L R C LFE Lb Rb Ls Rs
    8 => Some(&[1.0, 1.0, 1.0, 0.0, 1.0, 1.0, S, S]),
    _ => None,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn weights_follow_bs1770_5_table_5() {
    assert_eq!(standard_loudness_weights(3), Some(&[1.0, 1.0, 1.0][..]));
    assert_eq!(standard_loudness_weights(4), Some(&[1.0, 1.0, S, S][..]));
    assert_eq!(
      standard_loudness_weights(5),
      Some(&[1.0, 1.0, 1.0, S, S][..])
    );
    assert_eq!(
      standard_loudness_weights(6),
      Some(&[1.0, 1.0, 1.0, 0.0, S, S][..])
    );
    // Back surrounds sit at ±135°, outside the 60°–120° band, so BS.1770-5 gives them 1.00.
    assert_eq!(
      standard_loudness_weights(7),
      Some(&[1.0, 1.0, 1.0, 1.0, 1.0, S, S][..])
    );
    assert_eq!(
      standard_loudness_weights(8),
      Some(&[1.0, 1.0, 1.0, 0.0, 1.0, 1.0, S, S][..])
    );
  }

  #[test]
  fn every_weight_row_has_one_weight_per_channel() {
    for channels in 3..=8_u16 {
      let weights = standard_loudness_weights(channels).expect("row for 3..=8");
      assert_eq!(weights.len(), channels as usize, "{channels} channels");
    }
  }

  #[test]
  fn counts_without_a_standard_layout_have_no_name_or_weights() {
    for channels in [0_u16, 9, 10, 12, 16, 24] {
      assert_eq!(standard_layout_name(channels), None, "{channels} channels");
      assert_eq!(
        standard_loudness_weights(channels),
        None,
        "{channels} channels"
      );
    }
    assert_eq!(standard_loudness_weights(1), None);
    assert_eq!(standard_loudness_weights(2), None);
  }

  #[test]
  fn layout_names_by_channel_count() {
    let names: Vec<_> = (1..=8_u16)
      .map(|ch| standard_layout_name(ch).unwrap())
      .collect();
    assert_eq!(
      names,
      ["mono", "stereo", "lcr", "quad", "5.0", "5.1", "7.0", "7.1"]
    );
  }

  #[test]
  fn surround_weight_is_plus_one_and_a_half_db() {
    assert!((10.0 * S.log10() - 1.5).abs() < 1e-12);
  }
}
