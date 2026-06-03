/// Which channel(s) to use for spectrum analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
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
