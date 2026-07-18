use std::path::Path;
use std::process::Command;

use crate::file_analysis::ffmpeg::locate::locate_sidecar;
use crate::file_analysis::ffmpeg::probe::parse_ffprobe_media_json;
use crate::file_analysis::types::{FileAnalysisMediaProbeResult, FileAnalysisProbeResult};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn file_name_from_path(path: &Path) -> String {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("Untitled media")
    .to_string()
}

pub fn probe_file(path: impl AsRef<Path>) -> Result<FileAnalysisProbeResult, String> {
  let media = probe_media_file(path)?;
  let selected_track = media
    .audio_tracks
    .first()
    .cloned()
    .ok_or_else(|| "No audio track found in media file".to_string())?;
  Ok(FileAnalysisProbeResult {
    path: media.path,
    file_name: media.file_name,
    container: media.container,
    duration_ms: media.duration_ms,
    selected_track,
  })
}

pub fn probe_media_file(path: impl AsRef<Path>) -> Result<FileAnalysisMediaProbeResult, String> {
  let path = path.as_ref();
  let path_str = path.to_string_lossy().to_string();
  let ffprobe = locate_sidecar("ffprobe");

  let mut command = Command::new(&ffprobe);
  command
    .args([
      "-v",
      "quiet",
      "-select_streams",
      "a",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
    ])
    .arg(&path_str);
  #[cfg(windows)]
  command.creation_flags(CREATE_NO_WINDOW);

  let output = command
    .output()
    .map_err(|err| format!("FFmpeg component missing or unrunnable: {err}"))?;

  if !output.status.success() {
    return Err("Unsupported or unreadable media file".to_string());
  }

  let json = String::from_utf8_lossy(&output.stdout);
  parse_ffprobe_media_json(&json, &path_str, &file_name_from_path(path))
}
