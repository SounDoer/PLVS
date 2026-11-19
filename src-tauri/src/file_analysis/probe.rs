use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use super::process::FileProcess;

use crate::file_analysis::ffmpeg::locate::locate_sidecar;
use crate::file_analysis::ffmpeg::probe::parse_ffprobe_media_json;
use crate::file_analysis::types::{FileAnalysisMediaProbeResult, FileAnalysisProbeResult};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
pub(crate) struct FileProbes(Mutex<(u32, HashMap<u32, PendingProbe>)>);

#[derive(Default)]
struct PendingProbe {
  process: Arc<FileProcess>,
  started: bool,
}

impl FileProbes {
  pub(crate) fn reserve(&self) -> Result<u32, String> {
    let mut probes = self
      .0
      .lock()
      .map_err(|_| "File probe registry unavailable")?;
    let id = probes.0.checked_add(1).ok_or("File probe IDs exhausted")?;
    probes.0 = id;
    probes.1.insert(id, PendingProbe::default());
    Ok(id)
  }

  pub(crate) fn run(&self, id: u32, path: &Path) -> Result<FileAnalysisProbeResult, String> {
    let process = {
      let mut probes = self
        .0
        .lock()
        .map_err(|_| "File probe registry unavailable")?;
      let probe = probes.1.get_mut(&id).ok_or("Unknown File probe")?;
      if probe.started {
        return Err("File probe already started".into());
      }
      probe.started = true;
      Arc::clone(&probe.process)
    };
    let result = if process.is_cancelled() {
      Ok(None)
    } else {
      probe_file_with_process(path, || process.is_cancelled(), &process)
    };
    self
      .0
      .lock()
      .map_err(|_| "File probe registry unavailable")?
      .1
      .remove(&id);
    if process.is_cancelled() {
      return Err("File probing was cancelled".into());
    }
    result?.ok_or_else(|| "File probing was cancelled".to_string())
  }

  pub(crate) fn cancel(&self, id: u32) -> Result<(), String> {
    let process = self
      .0
      .lock()
      .map_err(|_| "File probe registry unavailable")?
      .1
      .get(&id)
      .map(|probe| Arc::clone(&probe.process));
    if let Some(process) = process {
      process.cancel();
    }
    Ok(())
  }
}

fn file_name_from_path(path: &Path) -> String {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("Untitled media")
    .to_string()
}

pub fn probe_file(path: impl AsRef<Path>) -> Result<FileAnalysisProbeResult, String> {
  probe_file_with_process(path, || false, &FileProcess::default())?
    .ok_or_else(|| "File probing was cancelled".to_string())
}

/// `Ok(None)` when `should_stop` cancels the source fingerprint read.
pub(super) fn probe_file_with_process(
  path: impl AsRef<Path>,
  should_stop: impl Fn() -> bool,
  process: &FileProcess,
) -> Result<Option<FileAnalysisProbeResult>, String> {
  let Some(media) = probe_identified_media_file_until(path, should_stop, process)? else {
    return Ok(None);
  };
  let selected_track = media
    .audio_tracks
    .iter()
    .find(|track| track.default_track)
    .or_else(|| media.audio_tracks.first())
    .cloned()
    .ok_or_else(|| "No audio track found in media file".to_string())?;
  Ok(Some(FileAnalysisProbeResult {
    path: media.path,
    file_name: media.file_name,
    container: media.container,
    duration_ms: media.duration_ms,
    selected_track,
    audio_tracks: media.audio_tracks,
    source_version: media.source_version,
  }))
}

/// Media metadata plus the full-content source fingerprint that binds a result to its source.
pub(crate) fn probe_identified_media_file(
  path: impl AsRef<Path>,
) -> Result<FileAnalysisMediaProbeResult, String> {
  probe_identified_media_file_until(path, || false, &FileProcess::default())?
    .ok_or_else(|| "File probing was cancelled".to_string())
}

fn probe_identified_media_file_until(
  path: impl AsRef<Path>,
  should_stop: impl Fn() -> bool,
  process: &FileProcess,
) -> Result<Option<FileAnalysisMediaProbeResult>, String> {
  let path = path.as_ref();
  let Some(source_version) = super::source_identity::identify_source_until(path, should_stop)?
  else {
    return Ok(None);
  };
  let mut media = probe_media_file_with_process(path, process)?;
  media.source_version = Some(source_version);
  Ok(Some(media))
}

/// Metadata only. Discovery (`plvs-cli probe`) does not read the whole file for a fingerprint.
pub fn probe_media_file(path: impl AsRef<Path>) -> Result<FileAnalysisMediaProbeResult, String> {
  probe_media_file_with_process(path.as_ref(), &FileProcess::default())
}

fn probe_media_file_with_process(
  path: &Path,
  process: &FileProcess,
) -> Result<FileAnalysisMediaProbeResult, String> {
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
    .arg(&path_str)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
  #[cfg(windows)]
  command.creation_flags(CREATE_NO_WINDOW);

  let mut child = process
    .spawn(&mut command)
    .map_err(|err| format!("FFmpeg component missing or unrunnable: {err}"))?;

  let mut output = Vec::new();
  child
    .stdout
    .take()
    .ok_or("ffprobe stdout unavailable")?
    .read_to_end(&mut output)
    .map_err(|err| format!("Unable to read media metadata: {err}"))?;
  if !child
    .wait()
    .map_err(|err| format!("ffprobe did not exit cleanly: {err}"))?
    .success()
  {
    return Err("Unsupported or unreadable media file".to_string());
  }

  let json = String::from_utf8_lossy(&output);
  parse_ffprobe_media_json(&json, &path_str, &file_name_from_path(path))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn cancellation_before_start_is_scoped_to_the_reserved_probe() {
    let probes = FileProbes::default();
    let cancelled = probes.reserve().unwrap();
    let other = probes.reserve().unwrap();
    probes.cancel(cancelled).unwrap();
    let missing_file = Path::new("plvs-test-missing-media");

    assert_eq!(
      probes.run(cancelled, missing_file).unwrap_err(),
      "File probing was cancelled"
    );
    probes.cancel(cancelled).unwrap();
    assert_eq!(
      probes.run(cancelled, missing_file).unwrap_err(),
      "Unknown File probe"
    );
    assert!(probes
      .run(other, missing_file)
      .unwrap_err()
      .starts_with("Source file unavailable"));
  }
}
