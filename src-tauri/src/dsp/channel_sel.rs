/// Which channel(s) to use for spectrum analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpectrumChannelSel {
  /// Average of two channels (0-based indices). Default: (0, 1) = L+R.
  Pair(u16, u16),
  /// Single channel (0-based index).
  Single(u16),
}

impl Default for SpectrumChannelSel {
  fn default() -> Self {
    Self::Pair(0, 1)
  }
}

/// How a selected channel pair is rendered in the spectrum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpectrumView {
  /// Two channels averaged into one curve (default; identical to the historical behaviour).
  Combined,
  /// The two raw channels overlaid as two curves.
  Lr,
  /// Mid = (x+y)/2 and Side = (x−y)/2 overlaid as two curves.
  Ms,
}

impl Default for SpectrumView {
  fn default() -> Self {
    Self::Combined
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn spectrum_view_default_is_combined() {
    assert_eq!(SpectrumView::default(), SpectrumView::Combined);
  }
}
