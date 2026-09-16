//! Standard channel layouts inferred from channel count, with ITU-R BS.1770-5 loudness weights.
//!
//! Channel order is the native WAVE (`KSAUDIO_SPEAKER_*`) order, which is also ffmpeg's native
//! layout order, so WASAPI capture and file decode agree. Weights follow BS.1770-5 Annex 3
//! Table 5: 1.41 for the surround pair between 60° and 120° azimuth (`Ls/Rs`), 1.00 for front,
//! back (±135°, `Lb/Rb`) and every other position, 0 for LFE.
//!
//! Labels name the weighting role, not the WAVE speaker bit: `Ls/Rs` is the 1.41 surround pair
//! (≈110° in 5.x, ±90° side in 7.x) even where the device mask calls it BACK_LEFT/BACK_RIGHT.

use super::channel_layouts::{first_layout_for_channel_count, static_weights_for_layout};

/// Layout name for a channel count, or `None` when the count has no single standard layout.
/// 8 channels is 7.1 or 5.1.2; the count alone never decides, so auto detection keeps the first
/// table entry (7.1), which is the pre-B1 behaviour. Counts above 8 are `None` — see this
/// function's callers for the `Ch 1–2` degradation that follows.
///
/// Called on every audio chunk in Auto mode (via `standard_loudness_weights`), so this and
/// `first_layout_for_channel_count` must stay allocation-free.
pub(crate) fn standard_layout_name(channels: u16) -> Option<&'static str> {
  match channels {
    1..=8 => first_layout_for_channel_count(channels as usize).map(|l| l.id.as_str()),
    _ => None,
  }
}

/// Per-channel loudness weights for 3–8 channels. Mono and stereo keep their dedicated paths.
/// The returned slice is cached, so this is allocation-free for per-chunk callers.
pub(crate) fn standard_loudness_weights(channels: u16) -> Option<&'static [f64]> {
  if !(3..=8).contains(&channels) {
    return None;
  }
  static_weights_for_layout(standard_layout_name(channels)?)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::dsp::channel_layouts::role_weight;

  #[test]
  fn weights_follow_bs1770_5_table_5() {
    let s = role_weight("Ls").expect("Ls role");
    assert_eq!(standard_loudness_weights(3), Some(&[1.0, 1.0, 1.0][..]));
    assert_eq!(standard_loudness_weights(4), Some(&[1.0, 1.0, s, s][..]));
    assert_eq!(
      standard_loudness_weights(5),
      Some(&[1.0, 1.0, 1.0, s, s][..])
    );
    assert_eq!(
      standard_loudness_weights(6),
      Some(&[1.0, 1.0, 1.0, 0.0, s, s][..])
    );
    // Back surrounds sit at ±135°, outside the 60°–120° band, so BS.1770-5 gives them 1.00.
    assert_eq!(
      standard_loudness_weights(7),
      Some(&[1.0, 1.0, 1.0, 1.0, 1.0, s, s][..])
    );
    assert_eq!(
      standard_loudness_weights(8),
      Some(&[1.0, 1.0, 1.0, 0.0, 1.0, 1.0, s, s][..])
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
    let s = role_weight("Ls").expect("Ls role");
    assert!((10.0 * s.log10() - 1.5).abs() < 1e-12);
  }

  #[test]
  fn standard_rows_come_from_the_shared_table() {
    for channels in 1..=8_u16 {
      let name = standard_layout_name(channels).expect("name for 1..=8");
      let roles = crate::dsp::channel_layouts::roles_for_layout(name).expect("layout in table");
      assert_eq!(roles.len(), channels as usize, "{channels} channels");
      if channels >= 3 {
        let expected = crate::dsp::channel_layouts::weights_for_roles(roles).expect("weights");
        assert_eq!(standard_loudness_weights(channels), Some(&expected[..]));
        // The row is cached, so repeated calls hand out the same slice rather than a new one.
        assert!(std::ptr::eq(
          standard_loudness_weights(channels).unwrap(),
          standard_loudness_weights(channels).unwrap()
        ));
      }
    }
  }
}
