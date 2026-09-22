use std::{path::Path, process::ExitCode};

use serde_json::json;

pub fn run(args: &[String]) -> ExitCode {
  let Some(root) = parse_test_identity_root(args) else {
    eprintln!("runtime diagnostics require --test-identity-root <path>");
    return ExitCode::from(2);
  };

  apply_test_identity_root(root);
  let identity = match crate::runtime_identity::RuntimeIdentity::new_default() {
    Ok(identity) => identity,
    Err(error) => {
      eprintln!("{error}");
      return ExitCode::from(1);
    }
  };
  let Some(config_dir) = crate::doctor::resolve_config_dir() else {
    eprintln!("unable to resolve isolated config directory");
    return ExitCode::from(1);
  };
  let Some(data_dir) = crate::doctor::resolve_data_dir() else {
    eprintln!("unable to resolve isolated data directory");
    return ExitCode::from(1);
  };

  println!(
    "{}",
    json!({
      "appIdentifier": env!("PLVS_APP_ID"),
      "instanceId": identity.instance_id(),
      "workspaceId": identity.workspace_id(),
      "configDir": config_dir,
      "dataDir": data_dir,
    })
  );
  ExitCode::SUCCESS
}

fn parse_test_identity_root(args: &[String]) -> Option<&Path> {
  let [flag, path] = args else {
    return None;
  };
  (flag == "--test-identity-root").then(|| Path::new(path))
}

fn apply_test_identity_root(root: &Path) {
  #[cfg(windows)]
  {
    std::env::set_var("APPDATA", root.join("config"));
    std::env::set_var("LOCALAPPDATA", root.join("data"));
  }

  #[cfg(target_os = "macos")]
  std::env::set_var("HOME", root);

  #[cfg(all(not(windows), not(target_os = "macos")))]
  {
    std::env::set_var("XDG_CONFIG_HOME", root.join("config"));
    std::env::set_var("XDG_DATA_HOME", root.join("data"));
  }
}
