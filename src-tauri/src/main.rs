// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
  // Internal CLI mode, invoked by the thin plvs-cli forwarder (bin/plvs-cli.rs).
  // Must be checked before Tauri starts so no window is ever created. Output goes
  // to the stdio handles inherited from the forwarder; the GUI subsystem only
  // means no console of our own is allocated.
  let mut args = std::env::args();
  args.next(); // executable path
  if args.next().as_deref() == Some("--cli") {
    let rest: Vec<String> = args.collect();
    return app_lib::cli_main::run(&rest);
  }

  app_lib::run();
  ExitCode::SUCCESS
}
