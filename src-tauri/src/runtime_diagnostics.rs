use std::{path::Path, process::ExitCode};

use serde_json::json;

pub fn run(args: &[String]) -> ExitCode {
  let Some(root) = parse_test_identity_root(args) else {
    eprintln!("runtime diagnostics require --test-identity-root <path>");
    return ExitCode::from(2);
  };

  let identity = match crate::runtime_identity::RuntimeIdentity::new_default() {
    Ok(identity) => identity,
    Err(error) => {
      eprintln!("{error}");
      return ExitCode::from(1);
    }
  };
  // Integration diagnostics receive explicit roots instead of rewriting APPDATA, HOME or XDG
  // process globals. Packaged builds reject this mode in main.rs.
  let config_dir = root.join("config").join(env!("PLVS_APP_ID"));
  let data_dir = root.join("data").join(env!("PLVS_APP_ID"));

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
