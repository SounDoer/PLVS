use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
  let mut args = std::env::args().skip(1);
  let Some(audio_path) = args.next() else {
    eprintln!("Usage: community_preview_fixture <audio-path>");
    return ExitCode::from(2);
  };
  if args.next().is_some() {
    eprintln!("Usage: community_preview_fixture <audio-path>");
    return ExitCode::from(2);
  }
  match app_lib::community_preview_fixture::generate_community_preview_fixture(Path::new(
    &audio_path,
  )) {
    Ok(fixture) => match serde_json::to_string_pretty(&fixture) {
      Ok(json) => {
        println!("{json}");
        ExitCode::SUCCESS
      }
      Err(error) => {
        eprintln!("Unable to encode Community preview fixture: {error}");
        ExitCode::from(1)
      }
    },
    Err(error) => {
      eprintln!("{error}");
      ExitCode::from(1)
    }
  }
}
