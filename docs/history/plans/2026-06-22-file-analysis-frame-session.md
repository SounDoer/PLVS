# File Analysis Frame Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cancellable file-analysis engine session that decodes local media audio into interleaved `f32` PCM, emits existing `AudioFramePayload` frames to the frontend, reports a real progress percentage, and emits an authoritative whole-file summary on completion.

**Architecture:** Build on the backend probe plan. Add a `FileAnalysisSession` held in `AppState`, plus `file_analysis_start` / `file_analysis_stop` commands. The first frame-session slice reuses the existing `MeterPipeline::push_pcm_f32_with_requests` path and Channel frame shape, so existing panels can receive data before the separate media-time/history plan refines timestamps and long-file behavior.

Key decisions baked into this slice:

- The worker selects its decode track with the **same** shared `select_first_decodable_track` rule the probe uses (reusing the probe-selected index), so a non-null video track is never decoded by mistake.
- The worker runs the format probe **once** itself; `FileAnalysisSession::start` no longer re-probes (the frontend already probed for UI metadata/duration before calling start).
- The worker reads analysis requests, loudness weights, and dialogue gating **once** as a snapshot at start, instead of locking shared state on every decoded packet. Mid-analysis chip changes apply on the next `REANALYZE`.
- Progress is a real `decoded_frames / total_frames` fraction (total from the selected track frame count).
- Completion carries an authoritative summary read from the final pipeline state, not from the last UI frame.

**Tech Stack:** Rust 2021, Tauri 2 Channel/Event, `symphonia`, std threads/channels/atomics, existing `MeterPipeline`, existing frontend IPC wrapper pattern.

**Spec:** `docs/superpowers/specs/2026-06-22-file-analysis-mode-design.md`

---

## File Structure

Create:

- `src-tauri/src/file_analysis/session.rs` — `FileAnalysisSession`, decode worker, cancellation, progress/completion/error events.
- `src-tauri/src/file_analysis/decode.rs` — reusable decode loop helpers that convert Symphonia buffers to interleaved `f32`.

Modify:

- `src-tauri/src/file_analysis/mod.rs` — export `decode` and `session`.
- `src-tauri/src/file_analysis/probe.rs` — make `TrackCandidate` and `track_candidate_from_symphonia` `pub(crate)` so the worker reuses the exact same track-candidate construction and selection.
- `src-tauri/src/state.rs` — add a `file_analysis` session slot.
- `src-tauri/src/ipc/types.rs` — add file-analysis progress/completion/error event payloads (progress carries `total_frames`; completion carries `FileAnalysisSummaryMetrics`).
- `src-tauri/src/engine/meter_pipeline.rs` — add a read-only `summary_metrics()` accessor returning final cumulative loudness/peak values (no timestamp behavior change).
- `src-tauri/src/ipc/commands.rs` — add `file_analysis_start` and `file_analysis_stop`.
- `src-tauri/src/lib.rs` — register commands.
- `src/ipc/commands.js` — add `startFileAnalysis` and `stopFileAnalysis` wrappers.
- `src/App.toolbar.test.js` — guard frontend IPC wrapper presence.

Do not modify in this plan:

- `MeterPipeline` timestamp internals (media-time is the next plan; only a read-only summary accessor is added here);
- `FrameIntake` history capacity semantics;
- drag/drop and picker UI;
- summary display beyond emitting the backend completion payload.

---

### Task 1: Add File Session Slot To App State

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/file_analysis/mod.rs`

- [ ] **Step 1: Add module export**

Update `src-tauri/src/file_analysis/mod.rs`:

```rust
pub mod decode;
pub mod probe;
pub mod session;
```

- [ ] **Step 2: Add state field**

In `src-tauri/src/state.rs`, add this import:

```rust
use crate::file_analysis::session::FileAnalysisSession;
```

Change `AppState` to include:

```rust
pub file_analysis: Mutex<Option<FileAnalysisSession>>,
```

Set the default:

```rust
file_analysis: Mutex::new(None),
```

The field should sit beside `capture` because both are mutually exclusive engine sources.

- [ ] **Step 3: Create placeholder-free session type**

Create `src-tauri/src/file_analysis/session.rs`:

```rust
use std::sync::mpsc::Sender;
use std::thread::JoinHandle;

pub struct FileAnalysisSession {
  stop_tx: Sender<()>,
  worker: Option<JoinHandle<()>>,
}

impl FileAnalysisSession {
  pub fn new(stop_tx: Sender<()>, worker: JoinHandle<()>) -> Self {
    Self {
      stop_tx,
      worker: Some(worker),
    }
  }

  pub fn stop(mut self) {
    let _ = self.stop_tx.send(());
    if let Some(worker) = self.worker.take() {
      let _ = worker.join();
    }
  }
}

impl Drop for FileAnalysisSession {
  fn drop(&mut self) {
    let _ = self.stop_tx.send(());
    if let Some(worker) = self.worker.take() {
      let _ = worker.join();
    }
  }
}
```

Create `src-tauri/src/file_analysis/decode.rs`:

```rust
pub fn module_loaded_for_file_analysis_decode() -> bool {
  true
}
```

This stub is intentionally tiny so the state slot compiles before the decode loop exists.

- [ ] **Step 4: Run compile check**

Run:

```bash
cd src-tauri
cargo check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/file_analysis/mod.rs src-tauri/src/file_analysis/session.rs src-tauri/src/file_analysis/decode.rs
git commit -m "feat(file): add file analysis session state"
```

---

### Task 2: Add PCM Decode Helpers

**Files:**
- Modify: `src-tauri/src/file_analysis/decode.rs`

- [ ] **Step 1: Add conversion tests**

Replace `src-tauri/src/file_analysis/decode.rs` with:

```rust
pub fn interleave_planar_f32(channels: &[Vec<f32>]) -> Result<Vec<f32>, String> {
  if channels.is_empty() {
    return Err("decoded audio buffer has no channels".to_string());
  }
  let frames = channels[0].len();
  if channels.iter().any(|channel| channel.len() != frames) {
    return Err("decoded audio channels have inconsistent lengths".to_string());
  }
  let mut out = Vec::with_capacity(frames * channels.len());
  for frame in 0..frames {
    for channel in channels {
      out.push(channel[frame]);
    }
  }
  Ok(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn interleaves_planar_f32_channels() {
    let left = vec![0.1, 0.2, 0.3];
    let right = vec![1.1, 1.2, 1.3];

    let interleaved = interleave_planar_f32(&[left, right]).expect("pcm");

    assert_eq!(interleaved, vec![0.1, 1.1, 0.2, 1.2, 0.3, 1.3]);
  }

  #[test]
  fn rejects_empty_channel_set() {
    let err = interleave_planar_f32(&[]).expect_err("error");
    assert_eq!(err, "decoded audio buffer has no channels");
  }

  #[test]
  fn rejects_inconsistent_channel_lengths() {
    let err = interleave_planar_f32(&[vec![0.0, 0.1], vec![1.0]]).expect_err("error");
    assert_eq!(err, "decoded audio channels have inconsistent lengths");
  }
}
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd src-tauri
cargo test file_analysis::decode
```

Expected: PASS.

- [ ] **Step 3: Add Symphonia audio buffer conversion**

Extend `src-tauri/src/file_analysis/decode.rs` below `interleave_planar_f32`:

```rust
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::conv::IntoSample;

pub fn audio_buffer_ref_to_interleaved_f32(buffer: AudioBufferRef<'_>) -> Result<Vec<f32>, String> {
  match buffer {
    AudioBufferRef::F32(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).to_vec())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::U8(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| sample.into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::U16(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| sample.into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::U24(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| sample.into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::U32(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| sample.into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::S8(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| sample.into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::S16(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| sample.into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::S24(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| sample.into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::S32(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| sample.into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::F64(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| sample.into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
  }
}
```

If the installed `symphonia` version exposes a different sample conversion trait path, adjust only the import and conversion call while keeping `audio_buffer_ref_to_interleaved_f32` as the public helper.

- [ ] **Step 4: Run compile and focused tests**

Run:

```bash
cd src-tauri
cargo test file_analysis::decode
cargo check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/file_analysis/decode.rs
git commit -m "feat(file): convert decoded audio to interleaved pcm"
```

---

### Task 3: Add File Analysis Event Payloads

**Files:**
- Modify: `src-tauri/src/ipc/types.rs`

- [ ] **Step 1: Add event types**

Append after `FileAnalysisProbeResult`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysisProgressPayload {
  pub path: String,
  pub decoded_frames: u64,
  /// Total decodable frames for the selected track, when known from the container.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub total_frames: Option<u64>,
  /// Real progress fraction in `0.0..=1.0`, `None` only when total frames are unknown.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub progress: Option<f64>,
}

/// Authoritative whole-file delivery metrics, read from the final pipeline state on completion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysisSummaryMetrics {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub duration_ms: Option<u64>,
  pub sample_rate_hz: u32,
  pub channels: u16,
  pub integrated_lufs: f64,
  pub lra: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_peak_max_l_db: f64,
  pub sample_peak_max_r_db: f64,
  /// Dialogue-gated integrated loudness; `NEG_INFINITY` when gating was off.
  pub dialogue_integrated: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysisCompletedPayload {
  pub path: String,
  pub decoded_frames: u64,
  pub summary: FileAnalysisSummaryMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysisErrorPayload {
  pub path: String,
  pub message: String,
}
```

- [ ] **Step 2: Run compile check**

Run:

```bash
cd src-tauri
cargo check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ipc/types.rs
git commit -m "feat(ipc): add file analysis session events"
```

---

### Task 4: Implement File Decode Worker

**Files:**
- Modify: `src-tauri/src/file_analysis/probe.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src-tauri/src/file_analysis/session.rs`

- [ ] **Step 0a: Expose shared track-candidate helpers**

In `src-tauri/src/file_analysis/probe.rs`, change `TrackCandidate` and
`track_candidate_from_symphonia` from private to `pub(crate)` so the worker
builds candidates and selects the track with the exact same logic as the probe:

```rust
pub(crate) struct TrackCandidate { /* unchanged fields */ }

pub(crate) fn track_candidate_from_symphonia(
  index: usize,
  track: &symphonia::core::formats::Track,
) -> TrackCandidate { /* unchanged body */ }
```

- [ ] **Step 0b: Add a read-only pipeline summary accessor**

In `src-tauri/src/engine/meter_pipeline.rs`, add an accessor that returns the
current cumulative metrics from existing pipeline state (no new computation, no
timestamp behavior change):

```rust
pub struct PipelineSummary {
  pub integrated_lufs: f64,
  pub lra: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_peak_max_l_db: f64,
  pub sample_peak_max_r_db: f64,
  pub dialogue_integrated: f64,
}

impl MeterPipeline {
  pub fn summary_metrics(&self) -> PipelineSummary {
    PipelineSummary {
      integrated_lufs: self.loudness.integrated(),
      lra: self.loudness.lra(),
      true_peak_max_dbtp: self.true_peak_max_dbtp(),
      sample_peak_max_l_db: self.sample_peak_max_l,
      sample_peak_max_r_db: self.sample_peak_max_r,
      dialogue_integrated: self.loudness.dialogue_integrated(),
    }
  }
}
```

Use whatever the existing field/accessor names are for integrated/LRA/true-peak
in this repo; the point is that the values come straight from the pipeline's
final state after the last PCM push, so they are authoritative for the whole
file regardless of which UI frames were throttled.

- [ ] **Step 1: Add start function and worker loop**

Replace `src-tauri/src/file_analysis/session.rs` with:

```rust
use std::fs::File;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::{AppHandle, Emitter, Manager};

use crate::engine::{ChannelLayoutSetting, MeterPipeline};
use crate::file_analysis::decode::audio_buffer_ref_to_interleaved_f32;
use crate::file_analysis::probe::{select_first_decodable_track, track_candidate_from_symphonia};
use crate::ipc::types::{
  AnalysisRequests, AudioFramePayload, FileAnalysisCompletedPayload, FileAnalysisErrorPayload,
  FileAnalysisProgressPayload, FileAnalysisSummaryMetrics, FrameSubscribers,
};

/// Config read once at worker start. Mid-analysis chip changes do not retune the current run.
struct WorkerConfig {
  requests: AnalysisRequests,
  loudness_weights: Option<Vec<f64>>,
  dialogue_gating: bool,
}

fn snapshot_config(app: &AppHandle) -> WorkerConfig {
  let state = app.try_state::<crate::state::AppState>();
  let requests = state
    .as_ref()
    .and_then(|s| s.analysis_requests.lock().ok().map(|g| g.clone()))
    .unwrap_or_default();
  let loudness_weights = state
    .as_ref()
    .and_then(|s| s.loudness_weights.lock().ok().map(|g| g.clone()))
    .unwrap_or(None);
  let dialogue_gating = state
    .as_ref()
    .and_then(|s| s.dialogue_gating_enabled.lock().ok().map(|g| *g))
    .unwrap_or(false);
  WorkerConfig {
    requests,
    loudness_weights,
    dialogue_gating,
  }
}

pub struct FileAnalysisSession {
  stop_tx: Sender<()>,
  worker: Option<JoinHandle<()>>,
}

impl FileAnalysisSession {
  pub fn new(stop_tx: Sender<()>, worker: JoinHandle<()>) -> Self {
    Self {
      stop_tx,
      worker: Some(worker),
    }
  }

  pub fn start(
    path: String,
    frame_subscribers: FrameSubscribers,
    app: AppHandle,
  ) -> Result<Self, String> {
    // The frontend already probed this path for UI metadata/duration; the worker probes once
    // itself for the decode reader, so we do not re-probe here.
    let (stop_tx, stop_rx) = mpsc::channel();
    let worker_path = path.clone();
    let worker = thread::Builder::new()
      .name("file-analysis-worker".into())
      .spawn(move || {
        if let Err(message) =
          run_file_worker(worker_path.clone(), frame_subscribers, app.clone(), stop_rx)
        {
          let _ = app.emit(
            "file-analysis-error",
            FileAnalysisErrorPayload {
              path: worker_path,
              message,
            },
          );
        }
      })
      .map_err(|err| format!("Unable to start file analysis worker: {err}"))?;

    Ok(Self::new(stop_tx, worker))
  }

  pub fn stop(mut self) {
    let _ = self.stop_tx.send(());
    if let Some(worker) = self.worker.take() {
      let _ = worker.join();
    }
  }
}

impl Drop for FileAnalysisSession {
  fn drop(&mut self) {
    let _ = self.stop_tx.send(());
    if let Some(worker) = self.worker.take() {
      let _ = worker.join();
    }
  }
}

fn hint_from_path(path: &str) -> Hint {
  let mut hint = Hint::new();
  if let Some(ext) = PathBuf::from(path).extension().and_then(|value| value.to_str()) {
    hint.with_extension(ext);
  }
  hint
}

fn send_frame(
  frame_subscribers: &FrameSubscribers,
  frame: AudioFramePayload,
) -> Result<(), String> {
  let mut map = frame_subscribers
    .lock()
    .map_err(|_| "frame subscriber map poisoned".to_string())?;
  match map.get_mut("main") {
    Some(tx) => tx
      .send(frame)
      .map_err(|_| "file analysis frame subscriber disconnected".to_string()),
    None => Err("file analysis frame subscriber missing".to_string()),
  }
}

fn run_file_worker(
  path: String,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  stop_rx: Receiver<()>,
) -> Result<(), String> {
  let file = File::open(&path).map_err(|err| format!("Unable to open media file: {err}"))?;
  let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
  let probed = symphonia::default::get_probe()
    .format(
      &hint_from_path(&path),
      mss,
      &FormatOptions::default(),
      &MetadataOptions::default(),
    )
    .map_err(|err| format!("Unsupported or unreadable media file: {err}"))?;

  let mut format = probed.format;

  // Reuse the shared selection rule so the worker decodes exactly the track the probe reported,
  // never a non-null video track.
  let candidates: Vec<_> = format
    .tracks()
    .iter()
    .enumerate()
    .map(|(index, track)| track_candidate_from_symphonia(index, track))
    .collect();
  let selected = select_first_decodable_track(&candidates)?;
  let track = format
    .tracks()
    .get(selected.index as usize)
    .ok_or_else(|| "Selected audio track is missing".to_string())?
    .clone();
  let track_id = track.id;
  let sample_rate = track
    .codec_params
    .sample_rate
    .ok_or_else(|| "Selected audio track has no sample rate".to_string())?;
  let channels = track
    .codec_params
    .channels
    .map(|c| c.count() as u16)
    .ok_or_else(|| "Selected audio track has no channel count".to_string())?;
  let total_frames = track.codec_params.n_frames;

  let mut decoder = symphonia::default::get_codecs()
    .make(&track.codec_params, &DecoderOptions::default())
    .map_err(|err| format!("Unsupported audio codec: {err}"))?;

  let config = snapshot_config(&app);
  let mut pipeline = MeterPipeline::new(sample_rate, channels);
  let mut seq = 0_u64;
  let mut decoded_frames = 0_u64;
  let mut last_progress_emit_frames = 0_u64;

  loop {
    if stop_rx.try_recv().is_ok() {
      // User cancellation: stop without emitting a completion/summary event. The frontend's
      // stop handler transitions the session back to a non-analyzing state.
      return Ok(());
    }
    let packet = match format.next_packet() {
      Ok(packet) => packet,
      Err(SymphoniaError::IoError(_)) => break,
      Err(err) => return Err(format!("Unable to read media packet: {err}")),
    };
    if packet.track_id() != track_id {
      continue;
    }
    let decoded = match decoder.decode(&packet) {
      Ok(decoded) => decoded,
      Err(SymphoniaError::DecodeError(_)) => continue,
      Err(err) => return Err(format!("Unable to decode audio packet: {err}")),
    };
    let pcm = audio_buffer_ref_to_interleaved_f32(decoded)?;
    decoded_frames += (pcm.len() / channels.max(1) as usize) as u64;
    if let Some(mut frame) = pipeline.push_pcm_f32_with_requests(
      &pcm,
      ChannelLayoutSetting::Auto,
      &config.requests,
      config.loudness_weights.clone(),
      config.dialogue_gating,
    ) {
      seq += 1;
      frame.seq = seq;
      send_frame(&frame_subscribers, frame)?;
    }
    // Emit progress about once per second of decoded media.
    if decoded_frames - last_progress_emit_frames >= sample_rate as u64 {
      last_progress_emit_frames = decoded_frames;
      let progress = total_frames
        .filter(|total| *total > 0)
        .map(|total| (decoded_frames as f64 / total as f64).clamp(0.0, 1.0));
      let _ = app.emit(
        "file-analysis-progress",
        FileAnalysisProgressPayload {
          path: path.clone(),
          decoded_frames,
          total_frames,
          progress,
        },
      );
    }
  }

  // Authoritative whole-file metrics come from final pipeline state, not the last UI frame.
  let metrics = pipeline.summary_metrics();
  let duration_ms = total_frames.and_then(|n| {
    if sample_rate == 0 {
      None
    } else {
      Some(((n as f64 / sample_rate as f64) * 1000.0).round() as u64)
    }
  });
  let _ = app.emit(
    "file-analysis-completed",
    FileAnalysisCompletedPayload {
      path,
      decoded_frames,
      summary: FileAnalysisSummaryMetrics {
        duration_ms,
        sample_rate_hz: sample_rate,
        channels,
        integrated_lufs: metrics.integrated_lufs,
        lra: metrics.lra,
        true_peak_max_dbtp: metrics.true_peak_max_dbtp,
        sample_peak_max_l_db: metrics.sample_peak_max_l_db,
        sample_peak_max_r_db: metrics.sample_peak_max_r_db,
        dialogue_integrated: metrics.dialogue_integrated,
      },
    },
  );
  Ok(())
}
```

The worker reuses `select_first_decodable_track` on the same candidate list the
probe builds, decodes that exact track, snapshots config once, emits a real
progress fraction, and emits an authoritative summary from `summary_metrics()`
only on natural end-of-stream. A user `STOP` returns early without a completion
event; whatever partial history already streamed stays scrubbable.

- [ ] **Step 2: Run compile check**

Run:

```bash
cd src-tauri
cargo check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/file_analysis/session.rs
git commit -m "feat(file): run local file analysis worker"
```

---

### Task 5: Add Start/Stop IPC Commands

**Files:**
- Modify: `src-tauri/src/ipc/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `file_analysis_start` command**

In `src-tauri/src/ipc/commands.rs`, add:

```rust
#[tauri::command]
pub fn file_analysis_start(
  app: AppHandle,
  path: String,
  on_frame: tauri::ipc::Channel<AudioFramePayload>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  {
    let mut capture = state
      .inner()
      .capture
      .lock()
      .map_err(|_| "state lock poisoned".to_string())?;
    *capture = None;
  }
  {
    let mut file = state
      .inner()
      .file_analysis
      .lock()
      .map_err(|_| "file analysis state lock poisoned".to_string())?;
    *file = None;
  }
  state
    .inner()
    .frame_ack_seq
    .store(0, std::sync::atomic::Ordering::Relaxed);
  let pool: FrameSubscribers = Arc::new(std::sync::Mutex::new(HashMap::new()));
  {
    let mut p = pool
      .lock()
      .map_err(|_| "frame subscriber map poisoned".to_string())?;
    p.insert("main".to_string(), on_frame);
  }
  {
    let mut slot = state
      .inner()
      .frame_subscribers
      .lock()
      .map_err(|_| "frame subscribers lock poisoned".to_string())?;
    *slot = Some(pool.clone());
  }
  let session = crate::file_analysis::session::FileAnalysisSession::start(path, pool, app)?;
  let mut file = state
    .inner()
    .file_analysis
    .lock()
    .map_err(|_| "file analysis state lock poisoned".to_string())?;
  *file = Some(session);
  Ok(())
}
```

- [ ] **Step 2: Add `file_analysis_stop` command**

In `src-tauri/src/ipc/commands.rs`, add:

```rust
#[tauri::command]
pub fn file_analysis_stop(state: State<'_, AppState>) -> Result<(), String> {
  let mut file = state
    .inner()
    .file_analysis
    .lock()
    .map_err(|_| "file analysis state lock poisoned".to_string())?;
  *file = None;
  let mut subscribers = state
    .inner()
    .frame_subscribers
    .lock()
    .map_err(|_| "frame subscribers lock poisoned".to_string())?;
  *subscribers = None;
  Ok(())
}
```

- [ ] **Step 3: Register commands**

In `src-tauri/src/lib.rs`, add both commands to `generate_handler!` near `file_analysis_probe`:

```rust
ipc::commands::file_analysis_start,
ipc::commands::file_analysis_stop,
```

- [ ] **Step 4: Run compile check**

Run:

```bash
cd src-tauri
cargo check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/commands.rs src-tauri/src/lib.rs
git commit -m "feat(ipc): start and stop file analysis sessions"
```

---

### Task 6: Add Frontend IPC Wrappers

**Files:**
- Modify: `src/ipc/commands.js`
- Modify: `src/App.toolbar.test.js`

- [ ] **Step 1: Add wrapper assertions**

Append to `src/App.toolbar.test.js`:

```js
  it("exposes file analysis start and stop through frontend IPC wrappers", () => {
    const commandsSource = readFileSync(join(currentDir, "ipc", "commands.js"), "utf8");
    expect(commandsSource).toContain("export async function startFileAnalysis({ path, onFrame })");
    expect(commandsSource).toContain('await invoke("file_analysis_start", { path, onFrame: onAudio });');
    expect(commandsSource).toContain("export function stopFileAnalysis()");
    expect(commandsSource).toContain('return invoke("file_analysis_stop");');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/App.toolbar.test.js
```

Expected: FAIL because wrappers do not exist.

- [ ] **Step 3: Add wrappers**

Append to `src/ipc/commands.js`:

```js
/** @param {{ path: string; onFrame: (payload: object) => void }} opts */
export async function startFileAnalysis({ path, onFrame }) {
  const onAudio = new Channel();
  onAudio.onmessage = (msg) => {
    const p = msg && typeof msg === "object" && "message" in msg ? msg.message : msg;
    if (p && typeof p === "object") onFrame(p);
  };
  await invoke("file_analysis_start", { path, onFrame: onAudio });
  return onAudio;
}

export function stopFileAnalysis() {
  return invoke("file_analysis_stop");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/App.toolbar.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/commands.js src/App.toolbar.test.js
git commit -m "feat(ipc): add file analysis session wrappers"
```

---

### Task 7: Verification

**Files:**
- No planned file edits.

- [ ] **Step 1: Run Rust checks**

Run:

```bash
cd src-tauri
cargo test file_analysis
cargo check
```

Expected: PASS.

- [ ] **Step 2: Run frontend IPC tests**

Run:

```bash
npx vitest run src/App.toolbar.test.js
```

Expected: PASS.

- [ ] **Step 3: Confirm scope stayed narrow**

Run:

```bash
git diff --stat HEAD
```

Expected changed areas are limited to:

```txt
src-tauri/src/file_analysis/
src-tauri/src/state.rs
src-tauri/src/ipc/
src-tauri/src/lib.rs
src/ipc/commands.js
src/App.toolbar.test.js
```

No panel component should be changed in this plan.

---

## Self-Review

Spec coverage:

- Covers cancellable file session (STOP returns early, no false completion event).
- Covers decode-to-PCM and reuse of `AudioFramePayload`.
- Covers the worker reusing the shared `select_first_decodable_track` rule and the probe-selected track index (no separate "first non-null codec" rule).
- Covers a single worker-side probe; `start` no longer re-probes.
- Covers a one-time config snapshot (analysis requests / loudness weights / dialogue gating) instead of per-packet locking.
- Covers a real progress fraction from `decoded_frames / total_frames`.
- Covers an authoritative completion summary read from `summary_metrics()` (final pipeline state).
- Covers start/stop IPC wrappers and mutual exclusion by stopping existing capture when file analysis starts.
- Leaves media-time timestamps, batched history ticks, bounded long-file history, drag/drop, picker, and summary UI for later plans.

Placeholder scan:

- No placeholder markers or unnamed implementation steps.

Type consistency:

- Rust commands are `file_analysis_start` and `file_analysis_stop`.
- Frontend wrappers are `startFileAnalysis({ path, onFrame })` and `stopFileAnalysis()`.
- Session state slot is `AppState.file_analysis`.
- Completion payload carries `FileAnalysisSummaryMetrics`; progress carries `total_frames` + `progress`.
