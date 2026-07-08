//! BS.1770 / EBU R128 gating math shared by the live meter (`loudness.rs`) and
//! the file-analysis summary meter (`summary_meter.rs`). Pure functions only —
//! any correction here applies to both paths at once.

pub(crate) const IBL_CAP: usize = 36_000;
pub(crate) const STH_CAP: usize = 36_000;
pub(crate) const SURROUND_LOUDNESS_WEIGHT: f64 = 1.412_537_544_622_754_4;

pub(crate) fn lufs_from_mean_squares(m0: f64, m1: f64) -> f64 {
  let s = m0 + m1;
  if s <= 0.0 {
    f64::NEG_INFINITY
  } else {
    -0.691 + 10.0 * s.log10()
  }
}

/// EBU R128 loudness range (LRA) over a set of short-term loudness values (LUFS):
/// −70 absolute gate, then a relative gate at mean − 20 LU, then p95 − p10. `0.0` when
/// there are too few qualifying samples.
pub(crate) fn gated_lra(short_terms: &[f64]) -> f64 {
  let h: Vec<f64> = short_terms
    .iter()
    .copied()
    .filter(|l| l.is_finite() && *l > -70.0)
    .collect();
  if h.len() < 2 {
    return 0.0;
  }
  let mean: f64 = h.iter().map(|l| 10_f64.powf(l / 10.0)).sum::<f64>() / h.len() as f64;
  let gr = 10.0 * mean.log10() - 20.0;
  let mut r: Vec<f64> = h.into_iter().filter(|l| *l > gr).collect();
  if r.len() < 2 {
    return 0.0;
  }
  r.sort_by(|a, b| a.partial_cmp(b).unwrap());
  let p95 = r[(r.len() as f64 * 0.95).floor() as usize].min(r[r.len() - 1]);
  let p10 = r[(r.len() as f64 * 0.1).floor() as usize];
  (p95 - p10).max(0.0)
}

/// Form BS.1770 gating blocks (400 ms, 75% overlap → one per 100 ms step) from a series of
/// 100 ms sub-block mean-squares: each gating block is the mean of 4 consecutive sub-blocks.
/// Inputs shorter than 400 ms are returned as-is (too short for a full gating block).
fn gating_blocks_400ms(sub: &[[f64; 2]]) -> Vec<[f64; 2]> {
  if sub.len() < 4 {
    return sub.to_vec();
  }
  let mut out = Vec::with_capacity(sub.len() - 3);
  for j in 3..sub.len() {
    let mut s0 = 0.0;
    let mut s1 = 0.0;
    for b in &sub[j - 3..=j] {
      s0 += b[0];
      s1 += b[1];
    }
    out.push([s0 / 4.0, s1 / 4.0]);
  }
  out
}

/// BS.1770 two-pass gated integrated loudness from a series of 100 ms sub-block mean-squares.
/// Sub-blocks are first combined into 400 ms gating blocks (75% overlap) per the standard, then:
/// first pass: −70 LUFS absolute gate to compute a relative threshold (mean − 10 LU);
/// second pass: keep blocks above both gates and average. `NEG_INFINITY` if none qualify.
pub(crate) fn gated_integrated_lufs(sub_blocks: &[[f64; 2]]) -> f64 {
  let blocks = gating_blocks_400ms(sub_blocks);
  let blocks = blocks.as_slice();
  if blocks.is_empty() {
    return f64::NEG_INFINITY;
  }
  let mut s0 = 0.0;
  let mut s1 = 0.0;
  let mut n = 0_usize;
  for x in blocks {
    if lufs_from_mean_squares(x[0], x[1]) > -70.0 {
      s0 += x[0];
      s1 += x[1];
      n += 1;
    }
  }
  if n == 0 {
    return f64::NEG_INFINITY;
  }
  let ga = -0.691 + 10.0 * ((s0 / n as f64) + (s1 / n as f64)).log10() - 10.0;
  s0 = 0.0;
  s1 = 0.0;
  n = 0;
  for x in blocks {
    let l = lufs_from_mean_squares(x[0], x[1]);
    if l > -70.0 && l > ga {
      s0 += x[0];
      s1 += x[1];
      n += 1;
    }
  }
  if n == 0 {
    f64::NEG_INFINITY
  } else {
    -0.691 + 10.0 * ((s0 / n as f64) + (s1 / n as f64)).log10()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn gating_blocks_are_400ms_running_mean_of_four() {
    // 100ms sub-blocks → 400ms gating blocks = mean of 4 consecutive, one per step.
    let sub = [[1.0, 1.0], [1.0, 1.0], [1.0, 1.0], [5.0, 5.0], [9.0, 9.0]];
    let g = gating_blocks_400ms(&sub);
    // j=3: mean([1,1,1,5])=2 ; j=4: mean([1,1,5,9])=4
    assert_eq!(g, vec![[2.0, 2.0], [4.0, 4.0]]);
  }

  #[test]
  fn gating_blocks_passthrough_when_shorter_than_400ms() {
    let sub = [[1.0, 1.0], [2.0, 2.0]];
    assert_eq!(gating_blocks_400ms(&sub), sub.to_vec());
  }

  #[test]
  fn integrated_unchanged_for_steady_signal_after_400ms_windowing() {
    // A uniform sub-block series: 400ms windowing must not change the integrated value.
    let steady = vec![[0.01_f64, 0.01]; 50];
    let direct = lufs_from_mean_squares(0.01, 0.01);
    assert!((gated_integrated_lufs(&steady) - direct).abs() < 1e-9);
  }
}
