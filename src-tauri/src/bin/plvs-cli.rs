//! Thin forwarder for the agent-facing CLI. The actual implementation lives in
//! the main `plvs` binary behind the internal `--cli` flag (src/cli_main.rs);
//! this keeps the `plvs-cli` executable name, path, and usage stable for the
//! agent discovery surface (plvs-agent.json, registry CliPath, PATH toggle)
//! while the engine (ONNX runtime, VAD models, DSP) ships only once.
//!
//! IMPORTANT: this binary must not reference `app_lib`, or the full engine gets
//! statically linked right back into it.

use std::ffi::OsString;
use std::io;
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
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

  // Pipe the host's stdout/stderr and relay them ourselves: a GUI-subsystem
  // process cannot write to inherited console handles, so output would vanish
  // when plvs-cli is invoked from an interactive terminal. Relaying through
  // this console-subsystem process works for terminals and pipes alike.
  // The host's exit code is forwarded unchanged.
  let mut child = match Command::new(&host)
    .args(forwarded_arguments(std::env::args_os().skip(1)))
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
    Ok(status) => match status.code() {
      Some(code) if (0..=255).contains(&code) => ExitCode::from(code as u8),
      _ => ExitCode::from(2),
    },
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
}
