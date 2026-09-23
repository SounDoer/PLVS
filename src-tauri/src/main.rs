// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
  // Internal CLI mode, invoked by the thin plvs-cli forwarder (bin/plvs-cli.rs).
  // The first forwarded argument is the forwarder's compiled app identity; the
  // host rejects a mismatch before parsing or executing the user's command.
  // This must be checked before Tauri starts so no window is ever created. Output
  // goes to the stdio handles inherited from the forwarder; the GUI subsystem
  // only means no console of our own is allocated.
  let mut args = std::env::args();
  args.next(); // executable path
  match args.next().as_deref() {
    Some("--cli") => {
      let expected_app_identifier = args.next().unwrap_or_default();
      let rest: Vec<String> = args.collect();
      return app_lib::cli_main::run_forwarded(&expected_app_identifier, &rest);
    }
    Some("--harness") => {
      #[cfg(feature = "capture-harness")]
      {
        let rest: Vec<String> = args.collect();
        return app_lib::harness_main::run(&rest);
      }
      #[cfg(not(feature = "capture-harness"))]
      {
        eprintln!("The capture harness is not available in this build.");
        return ExitCode::from(2);
      }
    }
    Some("--runtime-diagnostics") => {
      #[cfg(debug_assertions)]
      {
        let rest: Vec<String> = args.collect();
        return app_lib::runtime_diagnostics::run(&rest);
      }
      #[cfg(not(debug_assertions))]
      {
        eprintln!("Runtime diagnostics are not available in packaged builds.");
        return ExitCode::from(2);
      }
    }
    Some("--coordinator-test-host") => {
      #[cfg(debug_assertions)]
      {
        let rest: Vec<String> = args.collect();
        return app_lib::coordinator::run_test_host(&rest);
      }
      #[cfg(not(debug_assertions))]
      {
        eprintln!("Coordinator test hosting is not available in packaged builds.");
        return ExitCode::from(2);
      }
    }
    #[cfg(debug_assertions)]
    Some("--coordinator-role-test-host") => {
      let rest: Vec<String> = args.collect();
      return app_lib::coordinator::run_role_test_host(&rest);
    }
    Some("--instance-registry-test-host") => {
      #[cfg(debug_assertions)]
      {
        let rest: Vec<String> = args.collect();
        return app_lib::coordinator::run_registry_test_host(&rest);
      }
      #[cfg(not(debug_assertions))]
      {
        eprintln!("Instance registry test hosting is not available in packaged builds.");
        return ExitCode::from(2);
      }
    }
    Some("--workspace-lease-test-host") => {
      #[cfg(debug_assertions)]
      {
        let rest: Vec<String> = args.collect();
        return app_lib::persistence::run_lease_test_host(&rest);
      }
      #[cfg(not(debug_assertions))]
      {
        eprintln!("Workspace lease test hosting is not available in packaged builds.");
        return ExitCode::from(2);
      }
    }
    Some("--library-test-host") => {
      #[cfg(debug_assertions)]
      {
        let rest: Vec<String> = args.collect();
        return app_lib::persistence::run_library_test_host(&rest);
      }
      #[cfg(not(debug_assertions))]
      {
        eprintln!("Library test hosting is not available in packaged builds.");
        return ExitCode::from(2);
      }
    }
    _ => {}
  }

  app_lib::run();
  ExitCode::SUCCESS
}
