use std::fs::File;
use std::path::Path;

use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::ipc::types::{FileAnalysisProbeResult, FileAudioTrackMetadata};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TrackCandidate {
  pub index: u32,
  pub codec: String,
  pub sample_rate_hz: Option<u32>,
  pub channels: Option<u16>,
  pub language: Option<String>,
  pub decodable: bool,
}

pub(crate) fn select_first_decodable_track(
  tracks: &[TrackCandidate],
) -> Result<FileAudioTrackMetadata, String> {
  tracks
    .iter()
    .find(|track| track.decodable)
    .map(|track| FileAudioTrackMetadata {
      index: track.index,
      codec: track.codec.clone(),
      sample_rate_hz: track.sample_rate_hz,
      channels: track.channels,
      language: track.language.clone(),
    })
    .ok_or_else(|| "No decodable audio track found".to_string())
}

/// Pure duration helper, kept separate so it is testable without symphonia types.
pub(crate) fn duration_ms_from_frames(n_frames: u64, sample_rate_hz: u32) -> Option<u64> {
  if sample_rate_hz == 0 {
    return None;
  }
  Some(((n_frames as f64 / sample_rate_hz as f64) * 1000.0).round() as u64)
}

fn file_name_from_path(path: &Path) -> String {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("Untitled media")
    .to_string()
}

fn hint_from_path(path: &Path) -> Hint {
  let mut hint = Hint::new();
  if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
    hint.with_extension(ext);
  }
  hint
}

fn codec_label(codec: symphonia::core::codecs::CodecType) -> String {
  format!("{codec:?}").to_lowercase()
}

fn track_candidate_from_symphonia(
  index: usize,
  track: &symphonia::core::formats::Track,
) -> TrackCandidate {
  let params = &track.codec_params;
  let decodable = params.codec != CODEC_TYPE_NULL
    && symphonia::default::get_codecs()
      .make(params, &DecoderOptions::default())
      .is_ok();
  TrackCandidate {
    index: index as u32,
    codec: codec_label(params.codec),
    sample_rate_hz: params.sample_rate,
    channels: params.channels.map(|channels| channels.count() as u16),
    language: track.language.clone(),
    decodable,
  }
}

/// Duration of a symphonia track in milliseconds, preferring the container time base and
/// falling back to frame-count / sample-rate. Returns `None` when neither is available.
fn duration_ms_from_symphonia(track: &symphonia::core::formats::Track) -> Option<u64> {
  let params = &track.codec_params;
  let n_frames = params.n_frames?;
  if let Some(time_base) = params.time_base {
    let time = time_base.calc_time(n_frames);
    return Some(((time.seconds as f64 + time.frac) * 1000.0).round() as u64);
  }
  duration_ms_from_frames(n_frames, params.sample_rate?)
}

pub fn probe_file(path: impl AsRef<Path>) -> Result<FileAnalysisProbeResult, String> {
  let path = path.as_ref();
  let file = File::open(path).map_err(|err| format!("Unable to open media file: {err}"))?;
  let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
  let hint = hint_from_path(path);
  let probed = symphonia::default::get_probe()
    .format(
      &hint,
      mss,
      &FormatOptions::default(),
      &MetadataOptions::default(),
    )
    .map_err(|err| format!("Unsupported or unreadable media file: {err}"))?;

  let container = Some(
    std::any::type_name_of_val(probed.format.as_ref())
      .rsplit("::")
      .next()
      .unwrap_or("unknown")
      .trim_end_matches("Reader")
      .to_lowercase(),
  );
  let tracks: Vec<TrackCandidate> = probed
    .format
    .tracks()
    .iter()
    .enumerate()
    .map(|(index, track)| track_candidate_from_symphonia(index, track))
    .collect();
  let selected_track = select_first_decodable_track(&tracks)?;
  let duration_ms = probed
    .format
    .tracks()
    .get(selected_track.index as usize)
    .and_then(duration_ms_from_symphonia);

  Ok(FileAnalysisProbeResult {
    path: path.to_string_lossy().to_string(),
    file_name: file_name_from_path(path),
    container,
    duration_ms,
    selected_track,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn candidate(index: u32, codec: &str, decodable: bool) -> TrackCandidate {
    TrackCandidate {
      index,
      codec: codec.to_string(),
      sample_rate_hz: Some(48_000),
      channels: Some(2),
      language: None,
      decodable,
    }
  }

  #[test]
  fn selects_first_decodable_track() {
    let tracks = vec![
      candidate(0, "video", false),
      candidate(1, "aac", true),
      candidate(2, "pcm", true),
    ];

    let selected = select_first_decodable_track(&tracks).expect("track");

    assert_eq!(selected.index, 1);
    assert_eq!(selected.codec, "aac");
    assert_eq!(selected.sample_rate_hz, Some(48_000));
    assert_eq!(selected.channels, Some(2));
  }

  #[test]
  fn skips_non_decodable_video_track_before_audio() {
    let tracks = vec![candidate(0, "video", false), candidate(1, "aac", true)];

    let selected = select_first_decodable_track(&tracks).expect("track");

    // The worker must later reuse this same index, never a plain "first non-null codec" rule
    // that could pick the video track.
    assert_eq!(selected.index, 1);
  }

  #[test]
  fn returns_visible_error_when_no_track_is_decodable() {
    let tracks = vec![candidate(0, "video", false), candidate(1, "unknown", false)];

    let err = select_first_decodable_track(&tracks).expect_err("error");

    assert_eq!(err, "No decodable audio track found");
  }

  #[test]
  fn computes_duration_from_frames_and_rate() {
    assert_eq!(duration_ms_from_frames(48_000, 48_000), Some(1_000));
    assert_eq!(duration_ms_from_frames(0, 48_000), Some(0));
    assert_eq!(duration_ms_from_frames(48_000, 0), None);
  }
}
