use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use tauri::AppHandle;

use super::super::artifacts::{ArtifactStore, PendingArtifact};
use super::super::linux::{capture_visible_frame, recording_frame_rgba};
use super::super::platform::{CssRect, CssViewport};
use super::audio::SilenceReason;
use super::session::RecordingSessionControl;
use super::state::{RecordingRegistry, StopReason, MAX_ARTIFACT_BYTES};

#[derive(Clone, Copy, Debug)]
pub struct RecordingGeometry {
  pub rect: CssRect,
  pub viewport: CssViewport,
}

#[derive(Clone)]
pub struct LinuxRecordingSession {
  recording_id: String,
  stop_requested: Arc<AtomicBool>,
  finished: Arc<AtomicBool>,
  geometry: Arc<Mutex<RecordingGeometry>>,
}

impl RecordingSessionControl for LinuxRecordingSession {
  fn recording_id(&self) -> &str {
    &self.recording_id
  }

  fn request_stop(&self, _reason: StopReason) {
    self.stop_requested.store(true, Ordering::Release);
  }

  fn update_geometry(&self, rect: CssRect, viewport: CssViewport) -> Result<(), &'static str> {
    let values = [
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      viewport.width,
      viewport.height,
    ];
    if values.iter().any(|value| !value.is_finite())
      || rect.width <= 0.0
      || rect.height <= 0.0
      || viewport.width <= 0.0
      || viewport.height <= 0.0
    {
      return Err("invalidGeometry");
    }
    *self.geometry.lock().map_err(|_| "stateUnavailable")? = RecordingGeometry { rect, viewport };
    Ok(())
  }

  fn update_audio_silence_reason(&self, _reason: SilenceReason) -> Result<(), &'static str> {
    Ok(())
  }

  fn is_finished(&self) -> bool {
    self.finished.load(Ordering::Acquire)
  }
}

#[allow(clippy::too_many_arguments)]
pub fn begin_recording(
  app: AppHandle,
  recording_id: String,
  width: u32,
  height: u32,
  fps: u32,
  geometry: RecordingGeometry,
  pending: PendingArtifact,
  store: ArtifactStore,
  registry: RecordingRegistry,
) -> Result<LinuxRecordingSession, String> {
  let first_frame = capture_visible_frame(&app, "main")
    .and_then(|frame| recording_frame_rgba(&frame, geometry.viewport, geometry.rect, width, height))
    .map_err(|error| error.to_string())?;

  let session = LinuxRecordingSession {
    recording_id: recording_id.clone(),
    stop_requested: Arc::new(AtomicBool::new(false)),
    finished: Arc::new(AtomicBool::new(false)),
    geometry: Arc::new(Mutex::new(geometry)),
  };
  let worker_session = session.clone();
  let startup_session = session.clone();
  let (startup_sender, startup_receiver) = std::sync::mpsc::sync_channel(1);
  let spawned = std::thread::Builder::new()
    .name("visual-recording-linux".into())
    .spawn(move || {
      let startup = start_ffmpeg(width, height, fps, pending.path()).and_then(|mut child| {
        let stdin = child
          .stdin
          .take()
          .ok_or_else(|| "FFmpeg did not provide a video input pipe.".to_owned())?;
        let stderr = child
          .stderr
          .take()
          .ok_or_else(|| "FFmpeg did not provide a diagnostic pipe.".to_owned())?;
        Ok((child, stdin, stderr))
      });
      let (child, stdin, stderr) = match startup {
        Ok(startup) => {
          let _ = startup_sender.send(Ok(()));
          startup
        }
        Err(error) => {
          let _ = startup_sender.send(Err(error.clone()));
          registry.fail(&worker_session.recording_id, error);
          worker_session.finished.store(true, Ordering::Release);
          return;
        }
      };
      run_recording(
        app,
        worker_session,
        width,
        height,
        fps,
        first_frame,
        child,
        stdin,
        stderr,
        pending,
        store,
        registry,
      );
    });
  if let Err(error) = spawned {
    return Err(format!(
      "The Linux recording worker could not start: {error}"
    ));
  }
  match startup_receiver.recv_timeout(Duration::from_secs(5)) {
    Ok(Ok(())) => Ok(session),
    Ok(Err(error)) => Err(error),
    Err(_) => {
      startup_session
        .stop_requested
        .store(true, Ordering::Release);
      Err("The Linux H.264 encoder did not start in time.".to_owned())
    }
  }
}

fn start_ffmpeg(
  width: u32,
  height: u32,
  fps: u32,
  output: &std::path::Path,
) -> Result<Child, String> {
  let ffmpeg = crate::sidecar::locate_sidecar("ffmpeg");
  Command::new(&ffmpeg)
    .args([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      &format!("{width}x{height}"),
      "-framerate",
      &fps.to_string(),
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
    ])
    .arg(output)
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| {
      format!(
        "The Linux H.264 encoder could not start at {}: {error}",
        ffmpeg.display()
      )
    })
}

#[allow(clippy::too_many_arguments)]
fn run_recording(
  app: AppHandle,
  session: LinuxRecordingSession,
  width: u32,
  height: u32,
  fps: u32,
  first_frame: Vec<u8>,
  mut child: Child,
  mut stdin: std::process::ChildStdin,
  mut stderr: std::process::ChildStderr,
  pending: PendingArtifact,
  store: ArtifactStore,
  registry: RecordingRegistry,
) {
  let diagnostics = Arc::new(Mutex::new(String::new()));
  let diagnostics_writer = Arc::clone(&diagnostics);
  let stderr_worker = std::thread::Builder::new()
    .name("visual-recording-linux-stderr".into())
    .spawn(move || {
      let mut text = String::new();
      let _ = stderr.read_to_string(&mut text);
      if let Ok(mut destination) = diagnostics_writer.lock() {
        *destination = text;
      }
    });

  registry.mark_recording(&session.recording_id);
  let started = Instant::now();
  let mut last_frame = first_frame;
  let mut submitted_frames = 0_u64;
  let mut consecutive_capture_failures = 0_u32;
  let mut terminal_error = None;

  while !session.stop_requested.load(Ordering::Acquire) {
    let due = Duration::from_secs_f64(submitted_frames as f64 / f64::from(fps));
    if let Some(wait) = due.checked_sub(started.elapsed()) {
      std::thread::sleep(wait.min(Duration::from_millis(20)));
      continue;
    }

    if submitted_frames > 0 {
      let geometry = match session.geometry.lock() {
        Ok(geometry) => *geometry,
        Err(_) => {
          terminal_error = Some("The Linux recording geometry became unavailable.".to_owned());
          registry.request_stop(&session.recording_id, StopReason::CaptureFailure);
          break;
        }
      };
      match capture_visible_frame(&app, "main").and_then(|frame| {
        recording_frame_rgba(&frame, geometry.viewport, geometry.rect, width, height)
      }) {
        Ok(frame) => {
          last_frame = frame;
          consecutive_capture_failures = 0;
        }
        Err(error) => {
          consecutive_capture_failures = consecutive_capture_failures.saturating_add(1);
          registry.add_dropped_frames(&session.recording_id, 1);
          if consecutive_capture_failures >= fps {
            if error.reason == "targetUnavailable" {
              registry.request_stop(&session.recording_id, StopReason::WindowLost);
            } else {
              terminal_error = Some(error.to_string());
              registry.request_stop(&session.recording_id, StopReason::CaptureFailure);
            }
            break;
          }
        }
      }
    }

    let elapsed_frames = (started.elapsed().as_secs_f64() * f64::from(fps)).floor() as u64 + 1;
    let frames_to_submit = elapsed_frames.saturating_sub(submitted_frames).max(1);
    if frames_to_submit > 1 {
      registry.add_dropped_frames(&session.recording_id, frames_to_submit - 1);
    }
    for _ in 0..frames_to_submit {
      if let Err(error) = stdin.write_all(&last_frame) {
        terminal_error = Some(format!("FFmpeg stopped accepting video frames: {error}"));
        registry.request_stop(&session.recording_id, StopReason::CaptureFailure);
        break;
      }
      submitted_frames = submitted_frames.saturating_add(1);
      let bytes = std::fs::metadata(pending.path())
        .map(|metadata| metadata.len())
        .unwrap_or(0);
      registry.add_frame(&session.recording_id, bytes, 0);
      if bytes >= MAX_ARTIFACT_BYTES {
        registry.request_stop(&session.recording_id, StopReason::SizeLimit);
        session.stop_requested.store(true, Ordering::Release);
        break;
      }
    }
    if terminal_error.is_some() {
      break;
    }
  }

  drop(stdin);
  let status = child.wait();
  if let Ok(worker) = stderr_worker {
    let _ = worker.join();
  }
  let diagnostic = diagnostics
    .lock()
    .map(|value| value.trim().to_owned())
    .unwrap_or_default();
  let encoder_error = match status {
    Ok(status) if status.success() => None,
    Ok(status) => Some(if diagnostic.is_empty() {
      format!("FFmpeg exited with status {status}.")
    } else {
      format!("FFmpeg exited with status {status}: {diagnostic}")
    }),
    Err(error) => Some(format!(
      "The Linux H.264 encoder could not be joined: {error}"
    )),
  };
  if let Some(error) = encoder_error {
    registry.fail(&session.recording_id, error);
    session.finished.store(true, Ordering::Release);
    return;
  }

  match store.publish_blocking(pending, width, height, SystemTime::now()) {
    Ok(artifact) => {
      if let Some(error) = terminal_error {
        registry.fail_with_artifact(&session.recording_id, error, artifact);
      } else {
        registry.complete(&session.recording_id, artifact);
      }
    }
    Err(error) => registry.fail(
      &session.recording_id,
      format!("The recording artifact could not be published: {error}"),
    ),
  }
  session.finished.store(true, Ordering::Release);
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn geometry_updates_reject_empty_or_non_finite_values() {
    let session = LinuxRecordingSession {
      recording_id: "rec-test".into(),
      stop_requested: Arc::new(AtomicBool::new(false)),
      finished: Arc::new(AtomicBool::new(false)),
      geometry: Arc::new(Mutex::new(RecordingGeometry {
        rect: CssRect {
          x: 0.0,
          y: 0.0,
          width: 10.0,
          height: 10.0,
        },
        viewport: CssViewport {
          width: 10.0,
          height: 10.0,
        },
      })),
    };
    assert_eq!(
      session.update_geometry(
        CssRect {
          x: 0.0,
          y: 0.0,
          width: 0.0,
          height: 10.0,
        },
        CssViewport {
          width: 10.0,
          height: 10.0,
        }
      ),
      Err("invalidGeometry")
    );
    assert_eq!(
      session.update_geometry(
        CssRect {
          x: f64::NAN,
          y: 0.0,
          width: 10.0,
          height: 10.0,
        },
        CssViewport {
          width: 10.0,
          height: 10.0,
        }
      ),
      Err("invalidGeometry")
    );
  }
}
