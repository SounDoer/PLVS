pub const CLI_SCHEMA_VERSION: u32 = 1;

#[cfg(test)]
pub fn golden_fixture(id: &str) -> serde_json::Value {
  let fixtures: Vec<serde_json::Value> =
    serde_json::from_str(include_str!("../../shared/cli-v1-envelope-fixtures.json")).unwrap();
  fixtures
    .into_iter()
    .find(|fixture| fixture["id"] == id)
    .unwrap_or_else(|| panic!("missing CLI v1 fixture: {id}"))
}

#[cfg(test)]
mod tests {
  use std::collections::HashSet;

  use serde_json::Value;

  use super::{golden_fixture, CLI_SCHEMA_VERSION};

  #[test]
  fn golden_envelopes_cover_the_v1_contract() {
    let fixtures: Vec<Value> =
      serde_json::from_str(include_str!("../../shared/cli-v1-envelope-fixtures.json")).unwrap();
    let required = [
      "doctor.warning",
      "doctor.error",
      "error.unknownCommand",
      "query.capabilities",
      "query.appInspect",
      "mutation.panelDryRun",
      "action.transportLiveStart",
      "wait.changed",
      "wait.timeout",
    ];
    let mut ids = HashSet::new();

    for fixture in &fixtures {
      let id = fixture["id"].as_str().expect("fixture id");
      assert!(ids.insert(id), "duplicate fixture id: {id}");
      assert!(fixture["exitCode"].as_u64().is_some(), "{id}: exitCode");
      let envelope = &fixture["envelope"];
      assert_eq!(envelope["schemaVersion"], CLI_SCHEMA_VERSION, "{id}");
      let ok = envelope["ok"].as_bool().expect("ok must be boolean");
      assert_eq!(envelope.get("result").is_some(), ok, "{id}: result");
      assert_eq!(envelope.get("error").is_some(), !ok, "{id}: error");
    }

    for id in required {
      assert!(ids.contains(id), "missing fixture: {id}");
      assert_eq!(golden_fixture(id)["id"], id);
    }
  }
}
