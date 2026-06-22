use crate::ipc::types::FileAudioTrackMetadata;

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
