const DEFAULT_WORKSPACE_ID: &str = "default";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeIdentity {
  instance_id: String,
  workspace_id: String,
}

impl RuntimeIdentity {
  pub fn new_default() -> Result<Self, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| format!("runtime instance identity: {error}"))?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    Ok(Self {
      instance_id: format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
      ),
      workspace_id: DEFAULT_WORKSPACE_ID.to_string(),
    })
  }

  pub fn instance_id(&self) -> &str {
    &self.instance_id
  }

  pub fn workspace_id(&self) -> &str {
    &self.workspace_id
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn each_process_run_gets_a_distinct_instance_id() {
    let first = RuntimeIdentity::new_default().expect("first runtime identity");
    let second = RuntimeIdentity::new_default().expect("second runtime identity");

    assert_ne!(first.instance_id(), second.instance_id());
  }

  #[test]
  fn the_initial_workbench_uses_the_stable_default_workspace() {
    let identity = RuntimeIdentity::new_default().expect("runtime identity");

    assert_eq!(identity.workspace_id(), "default");
  }
}
