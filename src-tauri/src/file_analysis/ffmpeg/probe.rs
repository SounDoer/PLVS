use serde::Deserialize;

use crate::file_analysis::types::{FileAnalysisProbeResult, FileAudioTrackMetadata};

#[derive(Deserialize)]
struct ProbeRoot {
  #[serde(default)]
  streams: Vec<ProbeStream>,
  #[serde(default)]
  format: ProbeFormat,
}

#[derive(Deserialize)]
struct ProbeStream {
  index: u32,
  codec_type: String,
  #[serde(default)]
  codec_name: String,
  #[serde(default)]
  sample_rate: Option<String>,
  #[serde(default)]
  channels: Option<u16>,
  #[serde(default)]
  tags: Option<ProbeTags>,
}

#[derive(Deserialize, Default)]
struct ProbeFormat {
  #[serde(default)]
  format_name: Option<String>,
  #[serde(default)]
  duration: Option<String>,
}

#[derive(Deserialize)]
struct ProbeTags {
  #[serde(default)]
  language: Option<String>,
}

/// Parse `ffprobe -print_format json -show_streams -show_format` output into the UI metadata shape.
/// Selects the first audio stream; its absolute `index` is reused verbatim by the decoder's
/// `-map 0:<index>`.
pub fn parse_ffprobe_json(
  json: &str,
  path: &str,
  file_name: &str,
) -> Result<FileAnalysisProbeResult, String> {
  let root: ProbeRoot =
    serde_json::from_str(json).map_err(|err| format!("Unable to read media metadata: {err}"))?;

  let audio = root
    .streams
    .iter()
    .find(|s| s.codec_type == "audio")
    .ok_or_else(|| "No audio track found in media file".to_string())?;

  let sample_rate_hz = audio
    .sample_rate
    .as_deref()
    .and_then(|s| s.parse::<u32>().ok());
  let language = audio.tags.as_ref().and_then(|t| t.language.clone());
  let container = root
    .format
    .format_name
    .as_deref()
    .and_then(|name| name.split(',').next())
    .map(|s| s.to_string());
  let duration_ms = root
    .format
    .duration
    .as_deref()
    .and_then(|d| d.parse::<f64>().ok())
    .map(|secs| (secs * 1000.0).round() as u64);

  Ok(FileAnalysisProbeResult {
    path: path.to_string(),
    file_name: file_name.to_string(),
    container,
    duration_ms,
    selected_track: FileAudioTrackMetadata {
      index: audio.index,
      codec: audio.codec_name.clone(),
      sample_rate_hz,
      channels: audio.channels,
      language,
    },
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  const SAMPLE: &str = r#"{
    "streams": [
      {"index": 0, "codec_type": "video", "codec_name": "h264"},
      {"index": 1, "codec_type": "audio", "codec_name": "ac3",
       "sample_rate": "48000", "channels": 6, "tags": {"language": "eng"}}
    ],
    "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "180.5"}
  }"#;

  #[test]
  fn parses_first_audio_stream_metadata() {
    let result = parse_ffprobe_json(SAMPLE, "/m/clip.mkv", "clip.mkv").expect("parse");
    assert_eq!(result.file_name, "clip.mkv");
    assert_eq!(result.container.as_deref(), Some("mov"));
    assert_eq!(result.duration_ms, Some(180_500));
    assert_eq!(result.selected_track.index, 1);
    assert_eq!(result.selected_track.codec, "ac3");
    assert_eq!(result.selected_track.sample_rate_hz, Some(48_000));
    assert_eq!(result.selected_track.channels, Some(6));
    assert_eq!(result.selected_track.language.as_deref(), Some("eng"));
  }

  #[test]
  fn errors_when_no_audio_stream() {
    let json = r#"{"streams":[{"index":0,"codec_type":"video","codec_name":"h264"}],"format":{}}"#;
    let err = parse_ffprobe_json(json, "/m/x.mp4", "x.mp4").expect_err("no audio");
    assert_eq!(err, "No audio track found in media file");
  }
}
