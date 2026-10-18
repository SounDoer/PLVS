use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use tauri::AppHandle;

use super::super::artifacts::{ArtifactStore, PendingArtifact};
use super::super::linux::{capture_visible_frame, recording_frame_rgba};
use super::super::platform::{CssRect, CssViewport};
use super::audio::{AudioPacket, AudioTimeline, SilenceReason, AAC_BITRATE, OUTPUT_SAMPLE_RATE};
use super::session::RecordingSessionControl;
use super::state::{RecordingAudioSource, RecordingRegistry, StopReason, MAX_ARTIFACT_BYTES};
use crate::audio::MeasuredPcmReceiver;

const AUDIO_PIPE_FD: libc::c_int = 3;
const AUDIO_SETTLEMENT_FRAMES: u64 = 4_800;

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
  audio_silence_reason: Arc<Mutex<SilenceReason>>,
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

  fn update_audio_silence_reason(&self, reason: SilenceReason) -> Result<(), &'static str> {
    *self
      .audio_silence_reason
      .lock()
      .map_err(|_| "stateUnavailable")? = reason;
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
  audio_source: RecordingAudioSource,
  audio_origin_ns: u64,
  audio_receiver: Option<MeasuredPcmReceiver>,
  initial_audio_silence_reason: SilenceReason,
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
    audio_silence_reason: Arc::new(Mutex::new(initial_audio_silence_reason)),
  };
  let worker_session = session.clone();
  let startup_session = session.clone();
  let (startup_sender, startup_receiver) = std::sync::mpsc::sync_channel(1);
  let spawned = std::thread::Builder::new()
    .name("visual-recording-linux".into())
    .spawn(move || {
      let startup = start_ffmpeg(
        width,
        height,
        fps,
        audio_source == RecordingAudioSource::MeasuredSource,
        pending.path(),
      )
      .and_then(|(mut child, audio_input)| {
        let stdin = child
          .stdin
          .take()
          .ok_or_else(|| "FFmpeg did not provide a video input pipe.".to_owned())?;
        let stderr = child
          .stderr
          .take()
          .ok_or_else(|| "FFmpeg did not provide a diagnostic pipe.".to_owned())?;
        Ok((child, stdin, stderr, audio_input))
      });
      let (child, stdin, stderr, audio_input) = match startup {
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
        audio_origin_ns,
        audio_receiver,
        audio_input,
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
  has_audio: bool,
  output: &std::path::Path,
) -> Result<(Child, Option<File>), String> {
  let ffmpeg = crate::sidecar::locate_sidecar("ffmpeg");
  let audio_pipe = has_audio.then(create_audio_pipe).transpose()?;
  let mut command = Command::new(&ffmpeg);
  command.args([
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
  ]);
  if let Some((audio_read, audio_write)) = audio_pipe.as_ref() {
    command.args([
      "-f",
      "s16le",
      "-ar",
      &OUTPUT_SAMPLE_RATE.to_string(),
      "-ac",
      "2",
      "-i",
      &format!("pipe:{AUDIO_PIPE_FD}"),
    ]);
    let audio_read_fd = audio_read.as_raw_fd();
    let audio_write_fd = audio_write.as_raw_fd();
    // SAFETY: the closure calls only async-signal-safe libc functions between fork and exec. The
    // parent owns both descriptors until spawn returns; the child duplicates only the read end to
    // the stable FFmpeg input descriptor and closes its copy of the write end.
    unsafe {
      command.pre_exec(move || {
        if audio_read_fd == AUDIO_PIPE_FD {
          if libc::fcntl(AUDIO_PIPE_FD, libc::F_SETFD, 0) == -1 {
            return Err(std::io::Error::last_os_error());
          }
        } else {
          if libc::dup2(audio_read_fd, AUDIO_PIPE_FD) == -1 {
            return Err(std::io::Error::last_os_error());
          }
          libc::close(audio_read_fd);
        }
        libc::close(audio_write_fd);
        Ok(())
      });
    }
  }
  command.args([
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
  ]);
  if has_audio {
    command.args(["-c:a", "aac", "-b:a", &AAC_BITRATE.to_string()]);
  } else {
    command.arg("-an");
  }
  command
    .args(["-movflags", "+faststart", "-f", "mp4"])
    .arg(output)
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
  let child = command.spawn().map_err(|error| {
    format!(
      "The Linux H.264 encoder could not start at {}: {error}",
      ffmpeg.display()
    )
  })?;
  let audio_input = audio_pipe.map(|(audio_read, audio_write)| {
    drop(audio_read);
    File::from(audio_write)
  });
  Ok((child, audio_input))
}

fn create_audio_pipe() -> Result<(OwnedFd, OwnedFd), String> {
  let mut descriptors = [-1; 2];
  // SAFETY: pipe2 initializes both descriptors on success. They are immediately wrapped in
  // OwnedFd, so every parent-side return path closes them exactly once.
  if unsafe { libc::pipe2(descriptors.as_mut_ptr(), libc::O_CLOEXEC) } == -1 {
    return Err(format!(
      "The Linux audio pipe could not be created: {}",
      std::io::Error::last_os_error()
    ));
  }
  // SAFETY: successful pipe2 returned two new, independently owned file descriptors.
  Ok(unsafe {
    (
      OwnedFd::from_raw_fd(descriptors[0]),
      OwnedFd::from_raw_fd(descriptors[1]),
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
  audio_origin_ns: u64,
  audio_receiver: Option<MeasuredPcmReceiver>,
  audio_input: Option<File>,
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
  let audio_target_frames = Arc::new(AtomicU64::new(0));
  let audio_worker = match (audio_receiver, audio_input) {
    (Some(receiver), Some(input)) => {
      let worker_recording_id = session.recording_id.clone();
      let worker_stop = Arc::clone(&session.stop_requested);
      let worker_target = Arc::clone(&audio_target_frames);
      let worker_reason = Arc::clone(&session.audio_silence_reason);
      let worker_registry = registry.clone();
      Some(
        std::thread::Builder::new()
          .name("visual-recording-linux-audio".into())
          .spawn(move || {
            run_audio_worker(
              worker_recording_id,
              audio_origin_ns,
              receiver,
              input,
              worker_stop,
              worker_target,
              worker_reason,
              worker_registry,
            )
          }),
      )
    }
    (None, None) => None,
    _ => {
      registry.fail(
        &session.recording_id,
        "The Linux measured-source audio pipe was incomplete.",
      );
      session.finished.store(true, Ordering::Release);
      return;
    }
  };
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
      audio_target_frames.store(
        submitted_frames.saturating_mul(u64::from(OUTPUT_SAMPLE_RATE)) / u64::from(fps),
        Ordering::Release,
      );
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
  session.stop_requested.store(true, Ordering::Release);
  if let Some(worker) = audio_worker {
    match worker {
      Ok(worker) => match worker.join() {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
          terminal_error.get_or_insert(error);
        }
        Err(_) => {
          terminal_error
            .get_or_insert_with(|| "The Linux measured-source audio worker panicked.".to_owned());
        }
      },
      Err(error) => {
        terminal_error.get_or_insert_with(|| {
          format!("The Linux measured-source audio worker could not start: {error}")
        });
      }
    }
  }
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

#[allow(clippy::too_many_arguments)]
fn run_audio_worker(
  recording_id: String,
  audio_origin_ns: u64,
  receiver: MeasuredPcmReceiver,
  mut output: File,
  stop_requested: Arc<AtomicBool>,
  audio_target_frames: Arc<AtomicU64>,
  audio_silence_reason: Arc<Mutex<SilenceReason>>,
  registry: RecordingRegistry,
) -> Result<(), String> {
  let mut timeline = AudioTimeline::new(audio_origin_ns);
  let mut deferred = None;
  loop {
    let target = audio_target_frames.load(Ordering::Acquire);
    let stopping = stop_requested.load(Ordering::Acquire);
    let boundary = if stopping {
      target
    } else {
      target.saturating_sub(AUDIO_SETTLEMENT_FRAMES)
    };
    let reason = audio_silence_reason
      .lock()
      .map(|reason| *reason)
      .unwrap_or(SilenceReason::LiveRestart);
    while let Some(frame) = deferred.take().or_else(|| receiver.try_recv()) {
      let start_frame = frame
        .timestamp_ns
        .saturating_sub(timeline.origin_ns())
        .saturating_mul(u64::from(OUTPUT_SAMPLE_RATE))
        / 1_000_000_000;
      if start_frame >= boundary {
        deferred = Some(frame);
        break;
      }
      let packets = timeline.ingest(&frame, reason);
      receiver.recycle(frame);
      write_audio_packets(&mut output, packets)?;
    }
    write_audio_packets(&mut output, timeline.insert_silence_to(boundary, reason))?;
    registry.update_audio(
      &recording_id,
      timeline.silent_duration_ms(),
      timeline.interruptions().to_vec(),
    );
    if stopping {
      if let Some(frame) = deferred.take() {
        receiver.recycle(frame);
      }
      output
        .flush()
        .map_err(|error| format!("FFmpeg stopped accepting measured-source audio: {error}"))?;
      return Ok(());
    }
    std::thread::sleep(Duration::from_millis(5));
  }
}

fn write_audio_packets(output: &mut File, packets: Vec<AudioPacket>) -> Result<(), String> {
  for packet in packets {
    let mut bytes = Vec::with_capacity(packet.samples.len().saturating_mul(2));
    for sample in packet.samples {
      bytes.extend_from_slice(&sample.to_le_bytes());
    }
    output
      .write_all(&bytes)
      .map_err(|error| format!("FFmpeg stopped accepting measured-source audio: {error}"))?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{Read, Seek, SeekFrom};

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
      audio_silence_reason: Arc::new(Mutex::new(SilenceReason::LiveStopped)),
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

  #[test]
  fn measured_audio_packets_are_written_as_little_endian_pcm() {
    let mut output = tempfile::tempfile().expect("temporary PCM output");
    write_audio_packets(
      &mut output,
      vec![AudioPacket {
        start_frame: 0,
        samples: vec![i16::MIN, -1, 0, 1, i16::MAX],
      }],
    )
    .expect("write PCM");
    output.seek(SeekFrom::Start(0)).expect("rewind PCM");
    let mut bytes = Vec::new();
    output.read_to_end(&mut bytes).expect("read PCM");
    assert_eq!(
      bytes,
      vec![0x00, 0x80, 0xff, 0xff, 0x00, 0x00, 0x01, 0x00, 0xff, 0x7f]
    );
  }
}
