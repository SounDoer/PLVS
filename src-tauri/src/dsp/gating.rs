//! BS.1770 / EBU R128 gating math shared by the live meter (`loudness.rs`) and
//! the file-analysis summary meter (`summary_meter.rs`). Pure functions only —
//! any correction here applies to both paths at once.

pub(crate) fn lufs_from_mean_squares(m0: f64, m1: f64) -> f64 {
  let s = m0 + m1;
  if s <= 0.0 {
    f64::NEG_INFINITY
  } else {
    -0.691 + 10.0 * s.log10()
  }
}

struct OrderNode {
  key: f64,
  priority: u64,
  own_count: usize,
  own_sum0: f64,
  own_sum1: f64,
  count: usize,
  sum0: f64,
  sum1: f64,
  left: Option<Box<OrderNode>>,
  right: Option<Box<OrderNode>>,
}

impl OrderNode {
  fn new(key: f64, sum0: f64, sum1: f64) -> Self {
    Self::new_weighted(key, sum0, sum1, 1)
  }

  fn new_weighted(key: f64, sum0: f64, sum1: f64, weight: usize) -> Self {
    let mut priority = key.to_bits().wrapping_add(0x9e3779b97f4a7c15);
    priority = (priority ^ (priority >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    priority = (priority ^ (priority >> 27)).wrapping_mul(0x94d049bb133111eb);
    priority ^= priority >> 31;
    Self {
      key,
      priority,
      own_count: weight,
      own_sum0: sum0,
      own_sum1: sum1,
      count: weight,
      sum0,
      sum1,
      left: None,
      right: None,
    }
  }

  fn refresh(&mut self) {
    self.count = self.own_count;
    self.sum0 = self.own_sum0;
    self.sum1 = self.own_sum1;
    for child in [&self.left, &self.right].into_iter().flatten() {
      self.count += child.count;
      self.sum0 += child.sum0;
      self.sum1 += child.sum1;
    }
  }
}

#[derive(Default)]
struct ExactOrderTree {
  root: Option<Box<OrderNode>>,
}

impl ExactOrderTree {
  fn insert(&mut self, key: f64, sum0: f64, sum1: f64) {
    insert_node(&mut self.root, key, sum0, sum1);
  }

  fn insert_weighted(&mut self, key: f64, weight: usize) {
    if weight > 0 {
      insert_weighted_node(&mut self.root, key, weight);
    }
  }

  fn totals(&self) -> (usize, f64, f64) {
    self
      .root
      .as_ref()
      .map(|node| (node.count, node.sum0, node.sum1))
      .unwrap_or((0, 0.0, 0.0))
  }

  fn totals_above(&self, threshold: f64) -> (usize, f64, f64) {
    totals_above(&self.root, threshold)
  }

  fn count_at_or_below(&self, threshold: f64) -> usize {
    let total = self.totals().0;
    total - self.totals_above(threshold).0
  }

  fn kth(&self, index: usize) -> Option<f64> {
    kth(&self.root, index)
  }
}

fn insert_weighted_node(root: &mut Option<Box<OrderNode>>, key: f64, weight: usize) {
  let Some(node) = root.as_mut() else {
    *root = Some(Box::new(OrderNode::new_weighted(key, 0.0, 0.0, weight)));
    return;
  };
  match key.total_cmp(&node.key) {
    std::cmp::Ordering::Equal => node.own_count += weight,
    std::cmp::Ordering::Less => {
      insert_weighted_node(&mut node.left, key, weight);
      if node
        .left
        .as_ref()
        .is_some_and(|left| left.priority < node.priority)
      {
        rotate_right(root);
      }
    }
    std::cmp::Ordering::Greater => {
      insert_weighted_node(&mut node.right, key, weight);
      if node
        .right
        .as_ref()
        .is_some_and(|right| right.priority < node.priority)
      {
        rotate_left(root);
      }
    }
  }
  if let Some(node) = root.as_mut() {
    node.refresh();
  }
}

fn insert_node(root: &mut Option<Box<OrderNode>>, key: f64, sum0: f64, sum1: f64) {
  let Some(node) = root.as_mut() else {
    *root = Some(Box::new(OrderNode::new(key, sum0, sum1)));
    return;
  };
  match key.total_cmp(&node.key) {
    std::cmp::Ordering::Equal => {
      node.own_count += 1;
      node.own_sum0 += sum0;
      node.own_sum1 += sum1;
    }
    std::cmp::Ordering::Less => {
      insert_node(&mut node.left, key, sum0, sum1);
      if node
        .left
        .as_ref()
        .is_some_and(|left| left.priority < node.priority)
      {
        rotate_right(root);
      }
    }
    std::cmp::Ordering::Greater => {
      insert_node(&mut node.right, key, sum0, sum1);
      if node
        .right
        .as_ref()
        .is_some_and(|right| right.priority < node.priority)
      {
        rotate_left(root);
      }
    }
  }
  if let Some(node) = root.as_mut() {
    node.refresh();
  }
}

fn rotate_right(root: &mut Option<Box<OrderNode>>) {
  let mut old_root = root.take().expect("rotation root");
  let mut new_root = old_root.left.take().expect("rotation child");
  old_root.left = new_root.right.take();
  old_root.refresh();
  new_root.right = Some(old_root);
  new_root.refresh();
  *root = Some(new_root);
}

fn rotate_left(root: &mut Option<Box<OrderNode>>) {
  let mut old_root = root.take().expect("rotation root");
  let mut new_root = old_root.right.take().expect("rotation child");
  old_root.right = new_root.left.take();
  old_root.refresh();
  new_root.left = Some(old_root);
  new_root.refresh();
  *root = Some(new_root);
}

fn totals_above(root: &Option<Box<OrderNode>>, threshold: f64) -> (usize, f64, f64) {
  let Some(node) = root else {
    return (0, 0.0, 0.0);
  };
  if node.key <= threshold {
    return totals_above(&node.right, threshold);
  }
  let (left_count, left_sum0, left_sum1) = totals_above(&node.left, threshold);
  let (right_count, right_sum0, right_sum1) = node
    .right
    .as_ref()
    .map(|right| (right.count, right.sum0, right.sum1))
    .unwrap_or((0, 0.0, 0.0));
  (
    left_count + node.own_count + right_count,
    left_sum0 + node.own_sum0 + right_sum0,
    left_sum1 + node.own_sum1 + right_sum1,
  )
}

fn kth(root: &Option<Box<OrderNode>>, index: usize) -> Option<f64> {
  let node = root.as_ref()?;
  let left_count = node.left.as_ref().map(|left| left.count).unwrap_or(0);
  if index < left_count {
    kth(&node.left, index)
  } else if index < left_count + node.own_count {
    Some(node.key)
  } else {
    kth(&node.right, index - left_count - node.own_count)
  }
}

/// Exact session accumulator with logarithmic expected update/query cost and no duration cutoff.
pub(crate) struct IntegratedAccumulator {
  recent: [[f64; 2]; 4],
  recent_head: usize,
  block_count: usize,
  tree: ExactOrderTree,
}

impl IntegratedAccumulator {
  pub(crate) fn new() -> Self {
    Self {
      recent: [[0.0; 2]; 4],
      recent_head: 0,
      block_count: 0,
      tree: ExactOrderTree::default(),
    }
  }

  pub(crate) fn push(&mut self, block: [f64; 2]) {
    self.recent[self.recent_head] = block;
    self.recent_head = (self.recent_head + 1) % 4;
    self.block_count += 1;
    let gating_block = if self.block_count < 4 {
      block
    } else {
      if self.block_count == 4 {
        self.tree = ExactOrderTree::default();
      }
      let sum = self
        .recent
        .iter()
        .fold([0.0, 0.0], |acc, item| [acc[0] + item[0], acc[1] + item[1]]);
      [sum[0] / 4.0, sum[1] / 4.0]
    };
    let loudness = lufs_from_mean_squares(gating_block[0], gating_block[1]);
    if loudness > -70.0 {
      self.tree.insert(loudness, gating_block[0], gating_block[1]);
    }
  }

  pub(crate) fn value(&self) -> f64 {
    let (absolute_count, absolute_sum0, absolute_sum1) = self.tree.totals();
    if absolute_count == 0 {
      return f64::NEG_INFINITY;
    }
    let relative_gate = lufs_from_mean_squares(
      absolute_sum0 / absolute_count as f64,
      absolute_sum1 / absolute_count as f64,
    ) - 10.0;
    let (count, sum0, sum1) = self.tree.totals_above(relative_gate);
    if count == 0 {
      f64::NEG_INFINITY
    } else {
      lufs_from_mean_squares(sum0 / count as f64, sum1 / count as f64)
    }
  }
}

pub(crate) struct LraAccumulator {
  tree: ExactOrderTree,
}

/// Exact duration-weighted percentile range without the EBU LRA relative gate.
pub(crate) struct WeightedRangeAccumulator {
  tree: ExactOrderTree,
}

impl WeightedRangeAccumulator {
  pub(crate) fn new() -> Self {
    Self {
      tree: ExactOrderTree::default(),
    }
  }

  pub(crate) fn push(&mut self, loudness: f64, weight: usize) {
    if loudness.is_finite() {
      self.tree.insert_weighted(loudness, weight);
    }
  }

  pub(crate) fn value(&self) -> f64 {
    let count = self.tree.totals().0;
    if count == 0 {
      return f64::NEG_INFINITY;
    }
    let p95 = self
      .tree
      .kth(((count as f64 * 0.95).floor() as usize).min(count - 1))
      .expect("weighted p95 index");
    let p10 = self
      .tree
      .kth((count as f64 * 0.1).floor() as usize)
      .expect("weighted p10 index");
    (p95 - p10).max(0.0)
  }
}

impl LraAccumulator {
  pub(crate) fn new() -> Self {
    Self {
      tree: ExactOrderTree::default(),
    }
  }

  pub(crate) fn push(&mut self, loudness: f64) {
    if loudness.is_finite() && loudness > -70.0 {
      self
        .tree
        .insert(loudness, 10_f64.powf(loudness / 10.0), 0.0);
    }
  }

  pub(crate) fn value(&self) -> f64 {
    let (absolute_count, energy_sum, _) = self.tree.totals();
    if absolute_count < 2 {
      return 0.0;
    }
    let relative_gate = 10.0 * (energy_sum / absolute_count as f64).log10() - 20.0;
    let count = self.tree.totals_above(relative_gate).0;
    if count < 2 {
      return 0.0;
    }
    let offset = self.tree.count_at_or_below(relative_gate);
    let p95 = self
      .tree
      .kth(offset + ((count as f64 * 0.95).floor() as usize).min(count - 1))
      .expect("p95 index");
    let p10 = self
      .tree
      .kth(offset + (count as f64 * 0.1).floor() as usize)
      .expect("p10 index");
    (p95 - p10).max(0.0)
  }
}

/// EBU R128 loudness range (LRA) over a set of short-term loudness values (LUFS):
/// −70 absolute gate, then a relative gate at mean − 20 LU, then p95 − p10. `0.0` when
/// there are too few qualifying samples.
#[cfg(test)]
pub(crate) fn gated_lra(short_terms: &[f64]) -> f64 {
  let absolute_gated: Vec<f64> = short_terms
    .iter()
    .copied()
    .filter(|l| l.is_finite() && *l > -70.0)
    .collect();
  if absolute_gated.len() < 2 {
    return 0.0;
  }
  let mean: f64 = absolute_gated
    .iter()
    .map(|l| 10_f64.powf(l / 10.0))
    .sum::<f64>()
    / absolute_gated.len() as f64;
  let gr = 10.0 * mean.log10() - 20.0;
  let mut relative_gated: Vec<f64> = absolute_gated.into_iter().filter(|l| *l > gr).collect();
  if relative_gated.len() < 2 {
    return 0.0;
  }
  let p95_index =
    ((relative_gated.len() as f64 * 0.95).floor() as usize).min(relative_gated.len() - 1);
  let p10_index = (relative_gated.len() as f64 * 0.1).floor() as usize;
  let p95 = *relative_gated
    .select_nth_unstable_by(p95_index, f64::total_cmp)
    .1;
  let p10 = *relative_gated
    .select_nth_unstable_by(p10_index, f64::total_cmp)
    .1;
  (p95 - p10).max(0.0)
}

/// Visit BS.1770 gating blocks (400 ms, 75% overlap → one per 100 ms step) without allocating a
/// second whole-session vector. Inputs shorter than 400 ms pass through as partial startup blocks.
#[cfg(test)]
fn for_each_gating_block(sub: &[[f64; 2]], mut visit: impl FnMut([f64; 2])) {
  if sub.len() < 4 {
    for block in sub {
      visit(*block);
    }
    return;
  }
  for j in 3..sub.len() {
    let mut s0 = 0.0;
    let mut s1 = 0.0;
    for b in &sub[j - 3..=j] {
      s0 += b[0];
      s1 += b[1];
    }
    visit([s0 / 4.0, s1 / 4.0]);
  }
}

/// BS.1770 two-pass gated integrated loudness from a series of 100 ms sub-block mean-squares.
/// Sub-blocks are first combined into 400 ms gating blocks (75% overlap) per the standard, then:
/// first pass: −70 LUFS absolute gate to compute a relative threshold (mean − 10 LU);
/// second pass: keep blocks above both gates and average. `NEG_INFINITY` if none qualify.
#[cfg(test)]
pub(crate) fn gated_integrated_lufs(sub_blocks: &[[f64; 2]]) -> f64 {
  if sub_blocks.is_empty() {
    return f64::NEG_INFINITY;
  }
  let mut s0 = 0.0;
  let mut s1 = 0.0;
  let mut n = 0_usize;
  for_each_gating_block(sub_blocks, |x| {
    if lufs_from_mean_squares(x[0], x[1]) > -70.0 {
      s0 += x[0];
      s1 += x[1];
      n += 1;
    }
  });
  if n == 0 {
    return f64::NEG_INFINITY;
  }
  let ga = -0.691 + 10.0 * ((s0 / n as f64) + (s1 / n as f64)).log10() - 10.0;
  s0 = 0.0;
  s1 = 0.0;
  n = 0;
  for_each_gating_block(sub_blocks, |x| {
    let l = lufs_from_mean_squares(x[0], x[1]);
    if l > -70.0 && l > ga {
      s0 += x[0];
      s1 += x[1];
      n += 1;
    }
  });
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
    let mut g = Vec::new();
    for_each_gating_block(&sub, |block| g.push(block));
    // j=3: mean([1,1,1,5])=2 ; j=4: mean([1,1,5,9])=4
    assert_eq!(g, vec![[2.0, 2.0], [4.0, 4.0]]);
  }

  #[test]
  fn gating_blocks_passthrough_when_shorter_than_400ms() {
    let sub = [[1.0, 1.0], [2.0, 2.0]];
    let mut blocks = Vec::new();
    for_each_gating_block(&sub, |block| blocks.push(block));
    assert_eq!(blocks, sub.to_vec());
  }

  #[test]
  fn integrated_unchanged_for_steady_signal_after_400ms_windowing() {
    // A uniform sub-block series: 400ms windowing must not change the integrated value.
    let steady = vec![[0.01_f64, 0.01]; 50];
    let direct = lufs_from_mean_squares(0.01, 0.01);
    assert!((gated_integrated_lufs(&steady) - direct).abs() < 1e-9);
  }

  #[test]
  fn whole_program_metrics_include_material_before_the_former_one_hour_boundary() {
    fn ms_for_lufs(lufs: f64) -> [f64; 2] {
      let combined = 10_f64.powf((lufs + 0.691) / 10.0);
      [combined / 2.0, combined / 2.0]
    }

    let early = ms_for_lufs(-20.0);
    let late = ms_for_lufs(-14.0);
    let mut integrated = vec![early; 36_000];
    integrated.extend(std::iter::repeat_n(late, 36_000));
    let full_integrated = gated_integrated_lufs(&integrated);
    let former_rolling_integrated = gated_integrated_lufs(&integrated[36_000..]);

    assert!(
      full_integrated < former_rolling_integrated - 0.5,
      "whole-program Integrated must retain the first hour: full={full_integrated}, rolling={former_rolling_integrated}"
    );

    let mut short_terms = vec![-20.0; 36_000];
    short_terms.extend(std::iter::repeat_n(-14.0, 36_000));
    let full_lra = gated_lra(&short_terms);
    let former_rolling_lra = gated_lra(&short_terms[36_000..]);

    assert!(
      full_lra > former_rolling_lra + 5.0,
      "whole-program LRA must retain the first hour: full={full_lra}, rolling={former_rolling_lra}"
    );
  }

  #[test]
  fn incremental_accumulators_match_the_batch_definitions() {
    let blocks = [
      [0.001, 0.002],
      [0.003, 0.001],
      [0.002, 0.004],
      [0.008, 0.002],
      [0.000_001, 0.000_001],
      [0.006, 0.003],
    ];
    let short_terms = [-30.0, -24.0, -18.0, -72.0, -12.0, -20.0];
    let mut integrated = IntegratedAccumulator::new();
    let mut lra = LraAccumulator::new();

    for index in 0..blocks.len() {
      integrated.push(blocks[index]);
      lra.push(short_terms[index]);
      assert!(
        (integrated.value() - gated_integrated_lufs(&blocks[..=index])).abs() < 1e-10,
        "Integrated diverged at prefix {index}"
      );
      assert!(
        (lra.value() - gated_lra(&short_terms[..=index])).abs() < 1e-10,
        "LRA diverged at prefix {index}"
      );
    }
  }

  #[test]
  fn incremental_accumulators_keep_the_first_hour_after_two_hours() {
    let mut integrated = IntegratedAccumulator::new();
    let mut lra = LraAccumulator::new();
    for index in 0..72_000 {
      let loudness = if index < 36_000 { -20.0 } else { -14.0 };
      let combined = 10_f64.powf((loudness + 0.691) / 10.0);
      integrated.push([combined / 2.0, combined / 2.0]);
      lra.push(loudness);
      let _ = integrated.value();
      let _ = lra.value();
    }

    assert!(integrated.value() < -15.0);
    assert!(lra.value() > 5.0);
  }

  #[test]
  fn weighted_range_matches_an_expanded_reference_distribution() {
    let observations = [(-30.0, 1_usize), (-24.0, 3), (-18.0, 6), (-8.0, 1)];
    let mut accumulator = WeightedRangeAccumulator::new();
    let mut expanded = Vec::new();
    for (value, weight) in observations {
      accumulator.push(value, weight);
      expanded.extend(std::iter::repeat_n(value, weight));
    }
    expanded.sort_by(f64::total_cmp);
    let p10 = expanded[((expanded.len() as f64 * 0.1).floor() as usize).min(expanded.len() - 1)];
    let p95 = expanded[((expanded.len() as f64 * 0.95).floor() as usize).min(expanded.len() - 1)];

    assert_eq!(accumulator.value(), p95 - p10);
  }

  #[test]
  fn weighted_range_has_no_relative_gate() {
    let mut accumulator = WeightedRangeAccumulator::new();
    accumulator.push(-55.0, 3);
    accumulator.push(-20.0, 18);

    assert_eq!(accumulator.value(), 35.0);
  }
}
