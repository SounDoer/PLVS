use serde_json::{Map, Value};

/// Top-level store key, a sibling of `windowBounds` rather than a member of `plvs:settings`.
/// `profile.rs` copies `plvs:settings` wholesale between machines; a permission must not travel
/// with an imported configuration, and staying out of both `DOMAIN_KEYS` and `SIBLING_KEYS` is
/// what keeps it out.
pub const ENABLED_KEY: &str = "agentControlEnabled";

/// Development builds keep the behaviour they have today — Agent Control on, no setup step.
/// Release builds start off, including on upgrade from a version that had no such setting.
pub fn default_enabled() -> bool {
  cfg!(feature = "dev-identity")
}

pub fn enabled_from_store_map(map: &Map<String, Value>) -> bool {
  match map.get(ENABLED_KEY) {
    Some(Value::Bool(value)) => *value,
    _ => default_enabled(),
  }
}

/// Read the flag straight off disk. Used by `plvs-cli`, which has no `AppHandle`.
pub fn read_enabled_from_disk() -> bool {
  let Ok(path) = crate::profile::store_file_path() else {
    return default_enabled();
  };
  let Ok(map) = crate::profile::read_store_map(&path) else {
    return default_enabled();
  };
  enabled_from_store_map(&map)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::{json, Map};

  #[test]
  fn reads_the_persisted_flag_when_present() {
    let mut map = Map::new();
    map.insert(ENABLED_KEY.into(), json!(true));
    assert!(enabled_from_store_map(&map));

    map.insert(ENABLED_KEY.into(), json!(false));
    assert!(!enabled_from_store_map(&map));
  }

  #[test]
  fn falls_back_to_the_build_default_when_absent_or_malformed() {
    let mut map = Map::new();
    assert_eq!(enabled_from_store_map(&map), default_enabled());

    map.insert(ENABLED_KEY.into(), json!("yes"));
    assert_eq!(enabled_from_store_map(&map), default_enabled());
  }

  #[cfg(feature = "dev-identity")]
  #[test]
  fn development_builds_default_to_enabled() {
    assert!(default_enabled());
  }

  #[cfg(not(feature = "dev-identity"))]
  #[test]
  fn release_builds_default_to_disabled() {
    assert!(!default_enabled());
  }
}
