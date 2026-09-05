use std::process::ExitCode;

pub fn run(args: &[String]) -> ExitCode {
  crate::cli_main::run_harness(args)
}
