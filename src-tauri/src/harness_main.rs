use std::process::ExitCode;

pub fn run(args: &[String]) -> ExitCode {
  if args
    .first()
    .is_some_and(|command| command == "dialogue-benchmark")
  {
    return match crate::dialogue_benchmark::parse_and_run(&args[1..]) {
      Ok(()) => ExitCode::SUCCESS,
      Err(error) => {
        eprintln!("{error}");
        ExitCode::from(2)
      }
    };
  }
  crate::cli_main::run_harness(args)
}
