use std::path::Path;
use std::process::Command;

use crate::file_analysis::ffmpeg::locate::locate_sidecar;
use crate::file_analysis::ffmpeg::probe::parse_ffprobe_json;
use crate::ipc::types::FileAnalysisProbeResult;

fn file_name_from_path(path: &Path) -> String {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("Untitled media")
    .to_string()
}

pub fn probe_file(path: impl AsRef<Path>) -> Result<FileAnalysisProbeResult, String> {
  let path = path.as_ref();
  let path_str = path.to_string_lossy().to_string();
  let ffprobe = locate_sidecar("ffprobe");

  let output = Command::new(&ffprobe)
    .args([
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
    ])
    .arg(&path_str)
    .output()
    .map_err(|err| format!("FFmpeg component missing or unrunnable: {err}"))?;

  if !output.status.success() {
    return Err("Unsupported or unreadable media file".to_string());
  }

  let json = String::from_utf8_lossy(&output.stdout);
  parse_ffprobe_json(&json, &path_str, &file_name_from_path(path))
}
