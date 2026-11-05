//! Native speaker metadata, kept separate from user selections and physical channel counts.
//! Queries run on the consumer thread, never on an audio callback.

pub(crate) type LayoutReader = Box<dyn FnMut() -> Option<Vec<String>> + Send>;

#[cfg(any(target_os = "macos", test))]
pub(crate) fn apple_roles(labels: &[u32]) -> Vec<String> {
  labels
    .iter()
    .map(|label| {
      match label {
        1 => "L",
        2 => "R",
        3 => "C",
        4 | 37 | 62 => "LFE",
        5 | 10 | 55 => "Ls",
        6 | 11 | 56 => "Rs",
        9 | 44 => "Cs",
        33 | 63 => "Lb",
        34 | 64 => "Rb",
        35 => "Lw",
        36 => "Rw",
        13 => "Ltf",
        15 => "Rtf",
        49 => "Ltm",
        51 => "Rtm",
        16 | 52 => "Ltr",
        18 | 54 => "Rtr",
        42 => "M",
        _ => "generic",
      }
      .to_string()
    })
    .collect()
}

#[cfg(any(target_os = "windows", test))]
pub(crate) fn wave_roles(mask: u32, channels: u16) -> Option<Vec<String>> {
  if mask == 0 || mask.count_ones() > u32::from(channels) {
    return None;
  }
  let side_surrounds = mask & 0x600 != 0;
  let mut roles: Vec<String> = (0..32)
    .filter(|bit| mask & (1 << bit) != 0)
    .map(|bit| {
      match bit {
        0 => "L",
        1 => "R",
        2 if channels == 1 => "M",
        2 => "C",
        3 => "LFE",
        4 if side_surrounds => "Lb",
        5 if side_surrounds => "Rb",
        4 | 9 => "Ls",
        5 | 10 => "Rs",
        8 => "Cs",
        12 => "Ltf",
        14 => "Rtf",
        15 => "Ltr",
        17 => "Rtr",
        _ => "generic",
      }
      .to_string()
    })
    .collect();
  roles.resize(usize::from(channels), "generic".to_string());
  Some(roles)
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn native_roles_preserve_order_and_unknown_channels() {
    assert_eq!(
      apple_roles(&[2, 1, u32::MAX, 0, 100]),
      ["R", "L", "generic", "generic", "generic"]
    );
    assert_eq!(
      wave_roles(0x3, 4).unwrap(),
      ["L", "R", "generic", "generic"]
    );
    assert_eq!(
      wave_roles(0x3f, 6).unwrap(),
      ["L", "R", "C", "LFE", "Ls", "Rs"]
    );
    assert_eq!(
      wave_roles(0x63f, 8).unwrap(),
      ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"]
    );
    assert!(wave_roles(0, 2).is_none());
    assert!(wave_roles(0x3f, 2).is_none());
  }
}
