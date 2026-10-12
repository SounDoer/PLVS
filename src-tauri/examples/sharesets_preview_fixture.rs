use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
  let mut args = std::env::args().skip(1);
  let Some(audio_path) = args.next() else {
    eprintln!("Usage: sharesets_preview_fixture <audio-path> <analysis-requests-path>");
    return ExitCode::from(2);
  };
  let Some(requests_path) = args.next() else {
    eprintln!(
      "Usage: sharesets_preview_fixture <audio-path> <analysis-requests-path> [stereo|5.1]"
    );
    return ExitCode::from(2);
  };
  let layout_id = args.next().unwrap_or_else(|| "stereo".to_string());
  if args.next().is_some() {
    eprintln!(
      "Usage: sharesets_preview_fixture <audio-path> <analysis-requests-path> [stereo|5.1]"
    );
    return ExitCode::from(2);
  }
  let layout = match app_lib::sharesets_preview_fixture::PreviewFixtureLayout::from_id(&layout_id) {
    Ok(layout) => layout,
    Err(error) => {
      eprintln!("{error}");
      return ExitCode::from(2);
    }
  };
  let requests = match std::fs::read(&requests_path)
    .map_err(|error| error.to_string())
    .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|error| error.to_string()))
  {
    Ok(requests) => requests,
    Err(error) => {
      eprintln!("Unable to read analysis requests from {requests_path}: {error}");
      return ExitCode::from(1);
    }
  };
  match app_lib::sharesets_preview_fixture::generate_sharesets_preview_fixture(
    Path::new(&audio_path),
    requests,
    layout,
  ) {
    Ok(fixture) => match serde_json::to_string_pretty(&fixture) {
      Ok(json) => {
        println!("{json}");
        ExitCode::SUCCESS
      }
      Err(error) => {
        eprintln!("Unable to encode Sharesets preview fixture: {error}");
        ExitCode::from(1)
      }
    },
    Err(error) => {
      eprintln!("{error}");
      ExitCode::from(1)
    }
  }
}
