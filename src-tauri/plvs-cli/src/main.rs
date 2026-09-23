//! Thin forwarder for the agent-facing CLI. The actual implementation lives in
//! the main `plvs` binary behind the internal `--cli` flag (`src/cli_main.rs`).
//! This package deliberately stays independent from the application crate and
//! its Tauri, audio, and DSP dependency graph.

use std::ffi::OsString;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::{Command, ExitCode, ExitStatus, Stdio};
use std::thread;

fn forwarded_arguments(user_arguments: impl IntoIterator<Item = OsString>) -> Vec<OsString> {
  std::iter::once(OsString::from("--cli"))
    // The host owns the CLI implementation and discovery identity. Pass the forwarder's
    // independently compiled identity first so a stale adjacent host cannot route a development
    // command to an installed release app (or the reverse).
    .chain(std::iter::once(OsString::from(env!("PLVS_APP_ID"))))
    .chain(user_arguments)
    .collect()
}

fn compatibility_arguments(user_arguments: impl IntoIterator<Item = OsString>) -> Vec<OsString> {
  let arguments: Vec<OsString> = user_arguments.into_iter().collect();
  let mut compatible = Vec::with_capacity(arguments.len());
  let mut index = 0;
  while index < arguments.len() {
    if arguments[index] == "--instance"
      && arguments
        .get(index + 1)
        .is_some_and(|value| value == "legacy")
    {
      index += 2;
    } else {
      compatible.push(arguments[index].clone());
      index += 1;
    }
  }
  compatible
}

fn legacy_instances_response(inspect_stdout: &[u8], json: bool) -> Result<Vec<u8>, String> {
  let inspect = std::str::from_utf8(inspect_stdout)
    .map_err(|error| format!("Unable to decode the old PLVS inspection response: {error}"))?;
  if inspect.contains("\"appNotRunning\"") || inspect.contains("\"agentControlDisabled\"") {
    if !json {
      return Ok(b"No running PLVS instances.\n".to_vec());
    }
    return Ok(b"{\"schemaVersion\":1,\"ok\":true,\"result\":{\"instances\":[]}}".to_vec());
  }
  if !inspect.contains("\"ok\":true") && !inspect.contains("\"ok\": true") {
    return Err("The old PLVS application did not return an inspection result.".to_string());
  }
  let display_name = env!("PLVS_APP_NAME");
  let capture_status =
    if inspect.contains("\"state\":\"running\"") || inspect.contains("\"state\": \"running\"") {
      "running"
    } else {
      "stopped"
    };
  if !json {
    return Ok(
      format!(
        "INSTANCE ID\tSOURCE\tSTATUS\tVISIBLE\nlegacy\t{display_name}\t{capture_status}\ttrue\n"
      )
      .into_bytes(),
    );
  }
  Ok(format!(
    "{{\"schemaVersion\":1,\"ok\":true,\"result\":{{\"instances\":[{{\"instanceId\":\"legacy\",\"workspaceId\":\"default\",\"displayName\":\"{display_name}\",\"captureStatus\":\"{capture_status}\",\"visible\":true,\"focusSequence\":0}}]}}}}"
  )
  .into_bytes())
}

fn instances_output_format(arguments: &[OsString]) -> Option<bool> {
  match arguments {
    [command, flag] if command == "instances" && flag == "--json" => Some(true),
    [command, format, value]
      if command == "instances" && format == "--format" && value == "text" =>
    {
      Some(false)
    }
    _ => None,
  }
}

fn process_exit_code(status: ExitStatus) -> ExitCode {
  match status.code() {
    Some(code) if (0..=255).contains(&code) => ExitCode::from(code as u8),
    _ => ExitCode::from(2),
  }
}

fn relay_output(stdout: &[u8], stderr: &[u8]) {
  let _ = io::stdout().write_all(stdout);
  let _ = io::stderr().write_all(stderr);
}

fn run_instances_with_legacy_fallback(
  host: &PathBuf,
  arguments: &[OsString],
  json: bool,
) -> ExitCode {
  let current = match Command::new(host)
    .args(forwarded_arguments(arguments.iter().cloned()))
    .output()
  {
    Ok(output) => output,
    Err(error) => {
      eprintln!("Failed to launch {}: {error}", host.display());
      return ExitCode::from(2);
    }
  };
  if current.status.code() != Some(3) {
    relay_output(&current.stdout, &current.stderr);
    return process_exit_code(current.status);
  }

  let inspect = match Command::new(host)
    .args(forwarded_arguments(["inspect".into(), "--json".into()]))
    .output()
  {
    Ok(output) => output,
    Err(_) => {
      relay_output(&current.stdout, &current.stderr);
      return process_exit_code(current.status);
    }
  };
  if let Ok(response) = legacy_instances_response(&inspect.stdout, json) {
    let _ = io::stdout().write_all(&response);
    if !response.ends_with(b"\n") {
      let _ = io::stdout().write_all(b"\n");
    }
    return ExitCode::SUCCESS;
  }

  relay_output(&current.stdout, &current.stderr);
  process_exit_code(current.status)
}

fn host_binary_path() -> Result<PathBuf, String> {
  let own_path =
    std::env::current_exe().map_err(|err| format!("Failed to locate plvs-cli: {err}"))?;
  let dir = own_path
    .parent()
    .ok_or_else(|| "plvs-cli has no parent directory".to_string())?;
  let name = if cfg!(windows) { "plvs.exe" } else { "plvs" };
  let host = dir.join(name);
  if !host.is_file() {
    return Err(format!(
      "The PLVS application binary was not found next to plvs-cli: {}",
      host.display()
    ));
  }
  Ok(host)
}

fn main() -> ExitCode {
  let host = match host_binary_path() {
    Ok(path) => path,
    Err(err) => {
      eprintln!("{err}");
      return ExitCode::from(2);
    }
  };

  let user_arguments = compatibility_arguments(std::env::args_os().skip(1));
  if let Some(json) = instances_output_format(&user_arguments) {
    return run_instances_with_legacy_fallback(&host, &user_arguments, json);
  }

  // Pipe the host's stdout/stderr and relay them ourselves: a GUI-subsystem
  // process cannot write to inherited console handles, so output would vanish
  // when plvs-cli is invoked from an interactive terminal. Relaying through
  // this console-subsystem process works for terminals and pipes alike.
  // The host's exit code is forwarded unchanged.
  let mut child = match Command::new(&host)
    .args(forwarded_arguments(user_arguments))
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
  {
    Ok(child) => child,
    Err(err) => {
      eprintln!("Failed to launch {}: {err}", host.display());
      return ExitCode::from(2);
    }
  };

  let mut child_stdout = child.stdout.take().expect("stdout was piped");
  let mut child_stderr = child.stderr.take().expect("stderr was piped");
  let stdout_relay = thread::spawn(move || {
    let _ = io::copy(&mut child_stdout, &mut io::stdout());
  });
  let stderr_relay = thread::spawn(move || {
    let _ = io::copy(&mut child_stderr, &mut io::stderr());
  });

  let status = child.wait();
  let _ = stdout_relay.join();
  let _ = stderr_relay.join();

  match status {
    Ok(status) => process_exit_code(status),
    Err(err) => {
      eprintln!("Failed to wait for {}: {err}", host.display());
      ExitCode::from(2)
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn forwards_its_compiled_identity_before_the_public_command() {
    let arguments = forwarded_arguments([OsString::from("capabilities"), OsString::from("--json")]);

    assert_eq!(arguments[0], "--cli");
    assert_eq!(arguments[1], env!("PLVS_APP_ID"));
    assert_eq!(arguments[2], "capabilities");
    assert_eq!(arguments[3], "--json");
  }

  #[test]
  fn strips_the_synthetic_legacy_selector_before_forwarding_to_an_old_host() {
    let arguments = compatibility_arguments([
      OsString::from("--instance"),
      OsString::from("legacy"),
      OsString::from("inspect"),
      OsString::from("--json"),
    ]);

    assert_eq!(
      arguments,
      [OsString::from("inspect"), OsString::from("--json")]
    );
  }

  #[test]
  fn represents_a_running_old_application_as_one_synthetic_instance() {
    let inspect = br#"{
      "schemaVersion": 1,
      "ok": true,
      "result": {
        "app": { "name": "PLVS Dev" },
        "device": { "selection": { "resolved": { "label": "Studio Output" } } },
        "transport": { "live": { "state": "running" } }
      }
    }"#;

    let response = legacy_instances_response(inspect, true).unwrap();
    let response = String::from_utf8(response).unwrap();
    assert!(response.contains("\"instanceId\":\"legacy\""));
    assert!(response.contains("\"workspaceId\":\"default\""));
    assert!(response.contains(&format!("\"displayName\":\"{}\"", env!("PLVS_APP_NAME"))));
    assert!(response.contains("\"captureStatus\":\"running\""));
  }

  #[test]
  fn represents_an_unavailable_old_application_as_no_live_instances() {
    let inspect = br#"{
      "schemaVersion": 1,
      "ok": false,
      "error": { "code": "appNotRunning", "message": "PLVS is not running." }
    }"#;

    let response = legacy_instances_response(inspect, true).unwrap();
    assert_eq!(
      String::from_utf8(response).unwrap(),
      "{\"schemaVersion\":1,\"ok\":true,\"result\":{\"instances\":[]}}"
    );
  }

  #[test]
  fn recognizes_only_the_two_public_instance_listing_forms_for_legacy_fallback() {
    assert_eq!(
      instances_output_format(&["instances".into(), "--json".into()]),
      Some(true)
    );
    assert_eq!(
      instances_output_format(&["instances".into(), "--format".into(), "text".into()]),
      Some(false)
    );
    assert_eq!(instances_output_format(&["instances".into()]), None);
    assert_eq!(
      instances_output_format(&["inspect".into(), "--json".into()]),
      None
    );
  }
}
