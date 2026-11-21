//! FFmpeg channel layouts reported by ffprobe, and the PLVS roles they describe.
//!
//! Decoding must keep the source layout. `-ac <n>` asks ffmpeg for the default layout of that
//! channel count, so a source whose layout is not that default (quad, LCR, 7.0, 5.1.2, 7.1.2,
//! 7.1 wide, ...) is rematrixed before metering, and a custom channel order fails to decode.
//! Passing the probed layout back with `-ch_layout` keeps every channel where it was.

/// Named layouts of the bundled FFmpeg 7.1 (`ffmpeg -layouts`), in FFmpeg channel order.
const NAMED_LAYOUTS: &[(&str, &str)] = &[
  ("mono", "FC"),
  ("stereo", "FL+FR"),
  ("2.1", "FL+FR+LFE"),
  ("3.0", "FL+FR+FC"),
  ("3.0(back)", "FL+FR+BC"),
  ("4.0", "FL+FR+FC+BC"),
  ("quad", "FL+FR+BL+BR"),
  ("quad(side)", "FL+FR+SL+SR"),
  ("3.1", "FL+FR+FC+LFE"),
  ("5.0", "FL+FR+FC+BL+BR"),
  ("5.0(side)", "FL+FR+FC+SL+SR"),
  ("4.1", "FL+FR+FC+LFE+BC"),
  ("5.1", "FL+FR+FC+LFE+BL+BR"),
  ("5.1(side)", "FL+FR+FC+LFE+SL+SR"),
  ("6.0", "FL+FR+FC+BC+SL+SR"),
  ("6.0(front)", "FL+FR+FLC+FRC+SL+SR"),
  ("3.1.2", "FL+FR+FC+LFE+TFL+TFR"),
  ("hexagonal", "FL+FR+FC+BL+BR+BC"),
  ("6.1", "FL+FR+FC+LFE+BC+SL+SR"),
  ("6.1(back)", "FL+FR+FC+LFE+BL+BR+BC"),
  ("6.1(front)", "FL+FR+LFE+FLC+FRC+SL+SR"),
  ("7.0", "FL+FR+FC+BL+BR+SL+SR"),
  ("7.0(front)", "FL+FR+FC+FLC+FRC+SL+SR"),
  ("7.1", "FL+FR+FC+LFE+BL+BR+SL+SR"),
  ("7.1(wide)", "FL+FR+FC+LFE+BL+BR+FLC+FRC"),
  ("7.1(wide-side)", "FL+FR+FC+LFE+FLC+FRC+SL+SR"),
  ("5.1.2", "FL+FR+FC+LFE+BL+BR+TFL+TFR"),
  ("octagonal", "FL+FR+FC+BL+BR+BC+SL+SR"),
  ("cube", "FL+FR+BL+BR+TFL+TFR+TBL+TBR"),
  ("5.1.4", "FL+FR+FC+LFE+BL+BR+TFL+TFR+TBL+TBR"),
  ("7.1.2", "FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR"),
  ("7.1.4", "FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR+TBL+TBR"),
  ("7.2.3", "FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR+TBC+LFE2"),
  ("9.1.4", "FL+FR+FC+LFE+BL+BR+FLC+FRC+SL+SR+TFL+TFR+TBL+TBR"),
  (
    "hexadecagonal",
    "FL+FR+FC+BL+BR+BC+SL+SR+TFL+TFC+TFR+TBL+TBC+TBR+WL+WR",
  ),
  ("downmix", "DL+DR"),
  (
    "22.2",
    "FL+FR+FC+LFE+BL+BR+FLC+FRC+BC+SL+SR+TC+TFL+TFC+TFR+TBL+TBC+TBR+LFE2+TSL+TSR+BFC+BFL+BFR",
  ),
];

/// A layout ffprobe could not describe: empty, `unknown`, or `<n> channels` with no order.
fn is_unspecified(layout: &str) -> bool {
  let layout = layout.trim();
  layout.is_empty()
    || layout == "unknown"
    || layout
      .strip_suffix(" channels")
      .is_some_and(|count| count.parse::<u32>().is_ok())
}

/// The value to pass to `-ch_layout` so ffmpeg keeps the source layout, or `None` when the source
/// has no described layout and `-ac` is the only way to fix the channel count.
pub fn decode_layout(layout: Option<&str>) -> Option<&str> {
  layout
    .map(str::trim)
    .filter(|layout| !is_unspecified(layout))
}

/// FFmpeg channel names in stream order: a named layout, `<n> channels (A+B+...)`, or `A+B+...`.
fn channel_names(layout: &str) -> Option<Vec<&str>> {
  let layout = layout.trim();
  if let Some((_, decomposition)) = NAMED_LAYOUTS.iter().find(|(name, _)| *name == layout) {
    return Some(decomposition.split('+').collect());
  }
  let list = match layout.find('(') {
    Some(open) if layout.ends_with(')') && layout[..open].trim_end().ends_with("channels") => {
      &layout[open + 1..layout.len() - 1]
    }
    Some(_) => return None,
    None => layout,
  };
  let names: Vec<&str> = list.split('+').map(str::trim).collect();
  names
    .iter()
    .all(|name| !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric()))
    .then_some(names)
}

/// PLVS roles for a probed layout, in stream order. `None` when the layout is unspecified, does
/// not match the channel count, or contains a channel PLVS has no role for; the caller then keeps
/// its count-based behaviour instead of measuring with a partly guessed layout.
pub fn roles_for_layout(layout: Option<&str>, channels: u16) -> Option<Vec<String>> {
  let names = channel_names(decode_layout(layout)?)?;
  if names.len() != usize::from(channels) {
    return None;
  }
  // As with WAVE masks, the back pair is the surround pair unless side surrounds are present.
  let has_sides = names.iter().any(|name| matches!(*name, "SL" | "SR"));
  names
    .iter()
    .map(|name| {
      let role = match *name {
        "FC" if channels == 1 => "M",
        "FL" => "L",
        "FR" => "R",
        "FC" => "C",
        "LFE" | "LFE2" => "LFE",
        "BL" if has_sides => "Lb",
        "BR" if has_sides => "Rb",
        "BL" | "SL" => "Ls",
        "BR" | "SR" => "Rs",
        "FLC" => "Lc",
        "FRC" => "Rc",
        "BC" => "Cs",
        "WL" => "Lw",
        "WR" => "Rw",
        "TFL" => "Ltf",
        "TFR" => "Rtf",
        "TSL" => "Ltm",
        "TSR" => "Rtm",
        "TBL" => "Ltr",
        "TBR" => "Rtr",
        _ => return None,
      };
      Some(role.to_string())
    })
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::dsp::channel_layouts::{layout_id_for_roles, roles_for_layout as table_roles};

  fn roles(layout: &str, channels: u16) -> Option<Vec<String>> {
    roles_for_layout(Some(layout), channels)
  }

  #[test]
  fn unspecified_layouts_keep_the_channel_count_fallback() {
    for layout in ["", "unknown", "8 channels", " 12 channels "] {
      assert_eq!(decode_layout(Some(layout)), None, "{layout:?}");
      assert_eq!(roles(layout, 8), None, "{layout:?}");
    }
    assert_eq!(decode_layout(None), None);
    assert_eq!(decode_layout(Some("7.1(wide)")), Some("7.1(wide)"));
    assert_eq!(
      decode_layout(Some("8 channels (FL+FR+FC+LFE+SL+SR+BL+BR)")),
      Some("8 channels (FL+FR+FC+LFE+SL+SR+BL+BR)")
    );
  }

  #[test]
  fn every_plvs_standard_layout_is_recognised_from_its_ffmpeg_name() {
    for (ffmpeg, plvs) in [
      ("mono", "mono"),
      ("stereo", "stereo"),
      ("3.0", "lcr"),
      ("quad", "quad"),
      ("5.0", "5.0"),
      ("5.0(side)", "5.0"),
      ("5.1", "5.1"),
      ("5.1(side)", "5.1"),
      ("7.0", "7.0"),
      ("7.1", "7.1"),
      ("7.1(wide)", "7.1-wide"),
      ("5.1.2", "5.1.2"),
      ("5.1.4", "5.1.4"),
      ("7.1.2", "7.1.2"),
      ("7.1.4", "7.1.4"),
    ] {
      let expected = table_roles(plvs).unwrap().len();
      let mapped = roles(ffmpeg, expected as u16).unwrap_or_else(|| panic!("{ffmpeg}"));
      assert_eq!(layout_id_for_roles(&mapped), Some(plvs), "{ffmpeg}");
    }
  }

  #[test]
  fn non_default_orders_and_custom_orders_map_by_channel_name() {
    // quad(side) and 6.0 are not table layouts, but every role is known.
    assert_eq!(roles("quad(side)", 4).unwrap(), ["L", "R", "Ls", "Rs"]);
    assert_eq!(roles("6.0", 6).unwrap(), ["L", "R", "C", "Cs", "Ls", "Rs"]);
    assert_eq!(
      roles("8 channels (FL+FR+FC+LFE+SL+SR+BL+BR)", 8).unwrap(),
      ["L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb"]
    );
    assert_eq!(
      roles("FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR+TBL+TBR+WL+WR", 14).unwrap(),
      ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr", "Lw", "Rw"]
    );
  }

  #[test]
  fn unsupported_channels_or_a_count_mismatch_return_none() {
    assert_eq!(roles("7.2.3", 12), None, "TBC has no PLVS role");
    assert_eq!(roles("22.2", 24), None);
    assert_eq!(roles("downmix", 2), None);
    assert_eq!(roles("7.1", 6), None);
    assert_eq!(roles("not a layout", 2), None);
    assert_eq!(roles("8 channels (FL+FR", 2), None);
  }
}
