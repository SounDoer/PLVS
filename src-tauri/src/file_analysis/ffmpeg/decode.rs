/// Build the ffmpeg argument vector that decodes one audio track to interleaved f32le on stdout.
/// `track_index` is the absolute ffprobe stream index. Sample rate / channels are forced to the
/// source values so metering sees the native stream (no resample, no downmix).
pub fn build_decode_args(
  path: &str,
  track_index: u32,
  channels: u16,
  sample_rate: u32,
) -> Vec<String> {
  vec![
    "-nostdin".into(),
    "-loglevel".into(),
    "error".into(),
    "-progress".into(),
    "pipe:2".into(),
    "-i".into(),
    path.into(),
    "-map".into(),
    format!("0:{track_index}"),
    "-vn".into(),
    "-ac".into(),
    channels.to_string(),
    "-ar".into(),
    sample_rate.to_string(),
    "-f".into(),
    "f32le".into(),
    "pipe:1".into(),
  ]
}

/// Parse a single `-progress` line, returning decoded media time in microseconds for `out_time_us`.
/// Other keys (including the misleadingly-named `out_time_ms`) return `None`.
pub fn parse_out_time_us(line: &str) -> Option<u64> {
  line.trim().strip_prefix("out_time_us=")?.parse().ok()
}

/// Convert a little-endian f32 byte slice to samples, dropping any trailing partial sample. The
/// caller is responsible for carrying the remainder bytes (`len % 4`) into the next read.
pub fn bytes_to_f32_le(bytes: &[u8]) -> Vec<f32> {
  bytes
    .chunks_exact(4)
    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn builds_decode_args_for_selected_track() {
    let args = build_decode_args("/m/clip.mkv", 1, 6, 48_000);
    let joined = args.join(" ");
    assert!(joined.contains("-map 0:1"), "got: {joined}");
    assert!(joined.contains("-vn"));
    assert!(joined.contains("-ac 6"));
    assert!(joined.contains("-ar 48000"));
    assert!(joined.contains("-f f32le"));
    assert!(joined.ends_with("pipe:1"));
    assert!(joined.contains("-progress pipe:2"));
  }

  #[test]
  fn parses_out_time_us_progress() {
    assert_eq!(parse_out_time_us("out_time_us=1500000"), Some(1_500_000));
    assert_eq!(parse_out_time_us("out_time_ms=1500"), None);
    assert_eq!(parse_out_time_us("frame=10"), None);
  }

  #[test]
  fn converts_le_bytes_to_f32() {
    // 1.0_f32 little-endian = 00 00 80 3F ; -1.0 = 00 00 80 BF
    let bytes = [0x00, 0x00, 0x80, 0x3F, 0x00, 0x00, 0x80, 0xBF];
    assert_eq!(bytes_to_f32_le(&bytes), vec![1.0, -1.0]);
  }

  #[test]
  fn ignores_trailing_partial_sample() {
    // 5 bytes: one full f32 + 1 leftover byte the caller must carry over.
    let bytes = [0x00, 0x00, 0x80, 0x3F, 0xAB];
    assert_eq!(bytes_to_f32_le(&bytes), vec![1.0]);
  }
}
