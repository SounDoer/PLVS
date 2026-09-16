//! Channel roles and standard layouts, loaded from the shared table in `shared/channel-layouts.json`.
//!
//! The frontend reads the same file through `src/math/channelLayoutTable.js`, so a weight or a
//! layout order exists exactly once in the repository.
//!
//! `channel_weights.rs` reads the standard rows from here; the frontend reads the JSON directly.
//! `layout_id_for_roles` has no caller yet — it is consumed by the manual layout picker (Task 5).

use serde::Deserialize;
use std::sync::OnceLock;

// Re-exported for this module's own tests, which assert weights against the BS.1770-5 reference
// value; production code reads weights from the table instead.
#[allow(unused_imports)]
pub(crate) use super::gating::SURROUND_LOUDNESS_WEIGHT;

pub const CHANNEL_LAYOUTS_JSON: &str = include_str!("../../../shared/channel-layouts.json");

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RoleEntry {
  pub id: String,
  // Consumed once the manual layout picker UI (Task 5) renders role labels.
  #[allow(dead_code)]
  pub label: String,
  pub weight: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct LayoutEntry {
  pub id: String,
  // Consumed once the manual layout picker UI (Task 5) renders layout names.
  #[allow(dead_code)]
  pub name: String,
  pub roles: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ChannelLayoutTable {
  roles: Vec<RoleEntry>,
  layouts: Vec<LayoutEntry>,
}

fn table() -> &'static ChannelLayoutTable {
  static TABLE: OnceLock<ChannelLayoutTable> = OnceLock::new();
  TABLE.get_or_init(|| {
    serde_json::from_str(CHANNEL_LAYOUTS_JSON).expect("shared/channel-layouts.json is valid")
  })
}

pub(crate) fn roles() -> &'static [RoleEntry] {
  &table().roles
}

pub(crate) fn layouts() -> &'static [LayoutEntry] {
  &table().layouts
}

/// Energy multiplier for a role id, or `None` when the id is not in the table.
pub(crate) fn role_weight(role: &str) -> Option<f64> {
  roles().iter().find(|r| r.id == role).map(|r| r.weight)
}

/// Ordered roles of a layout id.
// Exercised by this module's tests and by `channel_weights.rs`'s cross-check test; no production
// call site yet.
#[allow(dead_code)]
pub(crate) fn roles_for_layout(layout_id: &str) -> Option<&'static [String]> {
  layouts()
    .iter()
    .find(|l| l.id == layout_id)
    .map(|l| l.roles.as_slice())
}

/// The layout whose roles equal `roles`, in order.
// Consumed once the manual layout picker UI (Task 5) maps a chosen role list back to an id.
#[allow(dead_code)]
pub(crate) fn layout_id_for_roles(roles: &[String]) -> Option<&'static str> {
  layouts()
    .iter()
    .find(|l| l.roles == roles)
    .map(|l| l.id.as_str())
}

/// Layouts with exactly `channels` channels, in table order.
pub(crate) fn layouts_for_channel_count(channels: usize) -> Vec<&'static LayoutEntry> {
  layouts()
    .iter()
    .filter(|l| l.roles.len() == channels)
    .collect()
}

/// Weights for a role list; `None` if any role is unknown.
pub(crate) fn weights_for_roles(roles: &[String]) -> Option<Vec<f64>> {
  roles.iter().map(|r| role_weight(r)).collect()
}

/// Weights for a layout id, computed once and kept for the process lifetime so hot callers can
/// hold a `'static` slice instead of allocating a row per audio chunk.
pub(crate) fn static_weights_for_layout(layout_id: &str) -> Option<&'static [f64]> {
  static ROWS: OnceLock<Vec<(String, Vec<f64>)>> = OnceLock::new();
  let rows = ROWS.get_or_init(|| {
    layouts()
      .iter()
      .filter_map(|l| weights_for_roles(&l.roles).map(|w| (l.id.clone(), w)))
      .collect()
  });
  rows
    .iter()
    .find(|(id, _)| id == layout_id)
    .map(|(_, weights)| weights.as_slice())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn every_layout_role_exists_and_weights_follow_bs1770_5() {
    for layout in layouts() {
      for role in &layout.roles {
        let weight = role_weight(role).unwrap_or_else(|| panic!("unknown role {role}"));
        let expected = match role.as_str() {
          "LFE" => 0.0,
          "Ls" | "Rs" | "Lw" | "Rw" => SURROUND_LOUDNESS_WEIGHT,
          _ => 1.0,
        };
        assert_eq!(weight, expected, "{} role {role}", layout.id);
      }
    }
  }

  #[test]
  fn layout_ids_and_channel_counts() {
    let seen: Vec<(&str, usize)> = layouts()
      .iter()
      .map(|l| (l.id.as_str(), l.roles.len()))
      .collect();
    assert_eq!(
      seen,
      vec![
        ("mono", 1),
        ("stereo", 2),
        ("lcr", 3),
        ("quad", 4),
        ("5.0", 5),
        ("5.1", 6),
        ("7.0", 7),
        ("7.1", 8),
        ("5.1.2", 8),
        ("5.1.4", 10),
        ("7.1.2", 10),
        ("7.1.4", 12),
        ("9.1.6", 16),
      ]
    );
  }

  #[test]
  fn nine_one_six_puts_the_surround_weight_only_on_sides_and_wides() {
    let roles = roles_for_layout("9.1.6").expect("9.1.6");
    let weighted: Vec<&str> = roles
      .iter()
      .filter(|r| role_weight(r) == Some(SURROUND_LOUDNESS_WEIGHT))
      .map(|r| r.as_str())
      .collect();
    assert_eq!(weighted, vec!["Lw", "Rw", "Ls", "Rs"]);
  }

  #[test]
  fn layout_id_for_roles_matches_exactly_or_returns_none() {
    let mut roles = roles_for_layout("7.1.4").expect("7.1.4").to_vec();
    assert_eq!(layout_id_for_roles(&roles), Some("7.1.4"));
    roles.swap(4, 6);
    assert_eq!(layout_id_for_roles(&roles), None);
  }

  #[test]
  fn eight_channels_offers_seven_one_before_five_one_two() {
    let ids: Vec<&str> = layouts_for_channel_count(8)
      .iter()
      .map(|l| l.id.as_str())
      .collect();
    assert_eq!(ids, vec!["7.1", "5.1.2"]);
  }

  #[test]
  fn weights_for_roles_rejects_an_unknown_role() {
    assert_eq!(
      weights_for_roles(&["L".to_string(), "Nope".to_string()]),
      None
    );
  }
}
