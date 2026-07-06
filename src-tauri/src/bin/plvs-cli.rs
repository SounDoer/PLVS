use std::process::ExitCode;

use app_lib::doctor::{run_doctor, DoctorStatus};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CliCommand {
  DoctorJson,
}

fn parse_args(args: &[String]) -> Result<CliCommand, String> {
  match args {
    [command, flag] if command == "doctor" && flag == "--json" => Ok(CliCommand::DoctorJson),
    [command, ..] if command == "doctor" => {
      Err("The doctor command currently requires --json.".to_string())
    }
    [command, ..] => Err(format!("Unknown command: {command}")),
    [] => Err("Missing command. Try: plvs-cli doctor --json".to_string()),
  }
}

fn main() -> ExitCode {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let command = match parse_args(&args) {
    Ok(command) => command,
    Err(err) => {
      eprintln!("{err}");
      return ExitCode::from(2);
    }
  };

  match command {
    CliCommand::DoctorJson => {
      let report = run_doctor();
      match serde_json::to_string(&report) {
        Ok(json) => println!("{json}"),
        Err(err) => {
          eprintln!("Failed to serialize doctor report: {err}");
          return ExitCode::from(2);
        }
      }

      match report.status {
        DoctorStatus::Error => ExitCode::from(1),
        DoctorStatus::Ok | DoctorStatus::Warning | DoctorStatus::Skipped => ExitCode::SUCCESS,
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
  }

  #[test]
  fn parses_doctor_json() {
    assert_eq!(
      parse_args(&args(&["doctor", "--json"])),
      Ok(CliCommand::DoctorJson)
    );
  }

  #[test]
  fn rejects_doctor_without_json() {
    assert!(parse_args(&args(&["doctor"])).is_err());
  }

  #[test]
  fn rejects_unknown_command() {
    assert!(parse_args(&args(&["analyze", "mix.wav", "--json"])).is_err());
  }
}
