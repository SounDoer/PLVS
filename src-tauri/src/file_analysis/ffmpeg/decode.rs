/// Build the ffmpeg argument vector that decodes one audio track to interleaved f32le on stdout.
/// `track_index` is the absolute ffprobe stream index. Sample rate and channel layout are forced
/// to the source values so metering sees the native stream (no resample, no rematrix). A probed
/// layout is passed back with `-ch_layout`; `-ac` alone would select FFmpeg's default layout for
/// the count and rematrix any other one. See `layout.rs`.
pub fn build_decode_args(
  path: &str,
  track_index: u32,
  channels: u16,
  channel_layout: Option<&str>,
  sample_rate: u32,
) -> Vec<String> {
  let (layout_flag, layout_value) = match super::layout::decode_layout(channel_layout) {
    Some(layout) => ("-ch_layout", layout.to_string()),
    None => ("-ac", channels.to_string()),
  };
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
    layout_flag.into(),
    layout_value,
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
pub fn bytes_to_f32_le_into(bytes: &[u8], out: &mut Vec<f32>) {
  out.clear();
  out.reserve(bytes.len() / 4);
  out.extend(
    bytes
      .as_chunks::<4>()
      .0
      .iter()
      .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])),
  );
}

#[cfg(test)]
fn bytes_to_f32_le(bytes: &[u8]) -> Vec<f32> {
  let mut out = Vec::with_capacity(bytes.len() / 4);
  bytes_to_f32_le_into(bytes, &mut out);
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn builds_decode_args_for_selected_track() {
    let args = build_decode_args("/m/clip.mkv", 1, 6, None, 48_000);
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
  fn keeps_a_probed_layout_instead_of_selecting_the_default_for_the_count() {
    let args = build_decode_args("/m/clip.wav", 0, 8, Some("7.1(wide)"), 48_000);
    let at = args.iter().position(|arg| arg == "-ch_layout").unwrap();
    assert_eq!(args[at + 1], "7.1(wide)");
    assert!(!args.iter().any(|arg| arg == "-ac"));

    let custom = "8 channels (FL+FR+FC+LFE+SL+SR+BL+BR)";
    let args = build_decode_args("/m/clip.mov", 0, 8, Some(custom), 48_000);
    assert!(
      args.iter().any(|arg| arg == custom),
      "passed as one argument"
    );

    for unspecified in [None, Some("unknown"), Some("8 channels")] {
      let args = build_decode_args("/m/clip.wav", 0, 8, unspecified, 48_000);
      assert!(args.join(" ").contains("-ac 8"), "{unspecified:?}");
      assert!(!args.iter().any(|arg| arg == "-ch_layout"));
    }
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

  #[test]
  fn converts_into_reused_buffer() {
    let bytes = [0x00, 0x00, 0x80, 0x3F, 0x00, 0x00, 0x80, 0xBF];
    let mut out = vec![99.0];
    bytes_to_f32_le_into(&bytes, &mut out);
    assert_eq!(out, vec![1.0, -1.0]);
  }
}
