# PLVS CLI Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `plvs-cli capture --device <substring> --seconds <n> [--every <n>] --json`, which runs the real live-capture path headlessly and emits assertable metrics — closing the capture layer's zero-coverage gap.

**Architecture:** One surgical extraction, then a Tauri-free consumer. `run_capture_worker` currently hardcodes its `audio_rx` consumer to `run_meter_pipeline_bridge_thread` (the only Tauri-coupled point in the capture path). Task 1 parameterizes that consumer without behavior change; the GUI passes the existing bridge, the CLI passes a `SummaryMeter` loop. Device resolution, sample-format conversion, the buffer pool, and drop accounting are **shared, never reimplemented** — they are the code under test. This mirrors `file_analysis`, where `summary.rs` (zero Tauri) serves `analyze` alongside the Tauri-coupled `session.rs`.

**Tech Stack:** Rust 2021, cpal 0.18, serde/serde_json, existing `dsp::summary_meter::SummaryMeter`.

**Spec:** `docs/superpowers/specs/2026-07-16-cli-capture-design.md`

**Gate per commit:** `npm run check`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| Modify `src-tauri/src/audio/cpal_backend.rs` | Extract `run_capture_stream` + `CaptureStreamArgs`; `run_capture_worker` becomes a thin GUI-consumer wrapper |
| Modify `src-tauri/src/audio/device_enum.rs` | Add pure `match_device_substring` + thin `resolve_device_id_by_substring` |
| Create `src-tauri/src/audio/capture_summary.rs` | Tauri-free live capture → `SummaryMeter`; the live twin of `file_analysis::summary` |
| Modify `src-tauri/src/audio/mod.rs` | Register `capture_summary` |
| Create `src-tauri/src/cli_capture.rs` | JSON report types + `run_capture`; mirrors `cli_analyze.rs` |
| Modify `src-tauri/src/lib.rs` | Register `cli_capture` |
| Modify `src-tauri/src/cli_main.rs` | Arg parsing, dispatch, help topic |

**Not touched: `plvs-agent.json` / `scripts/generate-agent-discovery.mjs`.** The
manifest advertises only the CLI's path and the `doctor` health-check invocation;
it does not enumerate commands (`analyze` is absent from it too). The help topic in
Task 5 is the entire discovery surface for `capture`.

**Testability note.** Opening an audio device is impossible in CI, so nothing that touches cpal is unit-tested. Every task below therefore isolates a **pure** function (substring matching, report building, arg parsing) that *is* tested, and keeps the device-touching code as a thin uncovered shell. Task 7 is the manual on-machine verification that the whole thing actually works.

---

### Task 1: Parameterize the capture consumer (refactor, no behavior change)

**Files:** Modify `src-tauri/src/audio/cpal_backend.rs`

This is a pure extraction. There is no new test: the guard is that the existing suite stays green and the GUI still meters. Do not change any behavior.

- [ ] **Step 1: Add `CaptureStreamArgs` and `run_capture_stream` above `run_capture_worker`** (i.e. just before the current `fn run_capture_worker(args: RunCaptureArgs)` at ~line 454). This is the existing body of `run_capture_worker` with the bridge call replaced by an injected consumer:

```rust
/// Device-facing half of live capture, free of Tauri. Opens the stream, feeds
/// pooled PCM into a queue, and hands the queue to `consumer` on its own thread.
/// The GUI passes the meter/IPC bridge; the CLI passes a `SummaryMeter` loop.
/// Blocks until `stop_rx` fires, then tears the stream down and joins `consumer`.
pub(crate) struct CaptureStreamArgs {
  pub(crate) device_id: String,
  pub(crate) device: cpal::Device,
  pub(crate) supported: cpal::SupportedStreamConfig,
  pub(crate) sample_rate: u32,
  pub(crate) channels: u16,
  pub(crate) stop_rx: std::sync::mpsc::Receiver<()>,
  pub(crate) dropped_chunks: Arc<AtomicU64>,
}

pub(crate) fn run_capture_stream<C>(args: CaptureStreamArgs, consumer: C) -> Result<(), String>
where
  C: FnOnce(std::sync::mpsc::Receiver<Vec<f32>>, PcmBufferPool, u32, u16) + Send + 'static,
{
  let CaptureStreamArgs {
    device_id: _device_id,
    device,
    supported,
    sample_rate,
    channels,
    stop_rx,
    dropped_chunks,
  } = args;
  let dropped_for_callbacks = dropped_chunks;
  let stream_config = StreamConfig {
    channels,
    sample_rate: supported.sample_rate(),
    buffer_size: cpal::BufferSize::Default,
  };

  // On Windows, create a silence output stream for loopback devices to keep
  // the audio engine active when no other audio is playing.
  #[cfg(target_os = "windows")]
  let device_id = _device_id;
  #[cfg(target_os = "windows")]
  let _silence_stream = if is_loopback_capture(&device_id) {
    create_silence_stream(&device, &stream_config)
  } else {
    None
  };

  let pcm_pool = PcmBufferPool::new(
    PCM_QUEUE_CAP,
    pooled_pcm_buffer_capacity(sample_rate, channels),
  );
  let consumer_pool = pcm_pool.clone();
  let (audio_tx, audio_rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(PCM_QUEUE_CAP);

  let consumer_thread = std::thread::spawn(move || {
    consumer(audio_rx, consumer_pool, sample_rate, channels);
  });

  let stream = match supported.sample_format() {
    SampleFormat::F32 => {
      let tx = audio_tx.clone();
      let dropped = dropped_for_callbacks.clone();
      let pool = pcm_pool.clone();
      device
        .build_input_stream(
          stream_config,
          move |data: &[f32], _: &cpal::InputCallbackInfo| {
            if let Some(buffer) = copy_f32_pcm_to_pooled_buffer(&pool, data, &dropped) {
              send_pcm_buffer_or_count_drop(&tx, &pool, buffer, &dropped);
            }
          },
          |e| log::error!("cpal stream error: {e}"),
          None,
        )
        .map_err(|e| e.to_string())?
    }
    SampleFormat::I16 => {
      let tx = audio_tx.clone();
      let dropped = dropped_for_callbacks.clone();
      let pool = pcm_pool.clone();
      device
        .build_input_stream(
          stream_config,
          move |data: &[i16], _: &cpal::InputCallbackInfo| {
            if let Some(buffer) = copy_i16_pcm_to_pooled_buffer(&pool, data, &dropped) {
              send_pcm_buffer_or_count_drop(&tx, &pool, buffer, &dropped);
            }
          },
          |e| log::error!("cpal stream error: {e}"),
          None,
        )
        .map_err(|e| e.to_string())?
    }
    SampleFormat::U16 => {
      let tx = audio_tx.clone();
      let dropped = dropped_for_callbacks.clone();
      let pool = pcm_pool.clone();
      device
        .build_input_stream(
          stream_config,
          move |data: &[u16], _: &cpal::InputCallbackInfo| {
            if let Some(buffer) = copy_u16_pcm_to_pooled_buffer(&pool, data, &dropped) {
              send_pcm_buffer_or_count_drop(&tx, &pool, buffer, &dropped);
            }
          },
          |e| log::error!("cpal stream error: {e}"),
          None,
        )
        .map_err(|e| e.to_string())?
    }
    f => {
      return Err(format!("Unsupported sample format: {f:?}"));
    }
  };

  stream.play().map_err(|e| e.to_string())?;
  let _ = stop_rx.recv();
  drop(stream);
  drop(audio_tx);
  let _ = consumer_thread.join();
  Ok(())
}
```

- [ ] **Step 2: Replace the whole body of `run_capture_worker`** with a wrapper that supplies the GUI consumer. Delete the old body (the `StreamConfig`, silence stream, pool, channel, bridge spawn, `match supported.sample_format()`, and teardown lines) — all of it now lives in `run_capture_stream`:

```rust
fn run_capture_worker(args: RunCaptureArgs) -> Result<(), String> {
  let RunCaptureArgs {
    device_id,
    device,
    supported,
    sample_rate,
    channels,
    frame_subscribers,
    app,
    stop_rx,
    clear_peak_history,
    reset_tp_max,
    channel_layout,
    loudness_weights,
    dialogue_gating,
    dialogue_vad_engine,
    dropped_chunks,
  } = args;
  let bridge_dropped = dropped_chunks.clone();

  run_capture_stream(
    CaptureStreamArgs {
      device_id,
      device,
      supported,
      sample_rate,
      channels,
      stop_rx,
      dropped_chunks,
    },
    move |audio_rx, pool, sample_rate, channels| {
      run_meter_pipeline_bridge_thread(
        audio_rx,
        sample_rate,
        channels,
        frame_subscribers,
        app,
        clear_peak_history,
        reset_tp_max,
        channel_layout,
        loudness_weights,
        dialogue_gating,
        dialogue_vad_engine,
        bridge_dropped,
        pool,
      );
    },
  )
}
```

- [ ] **Step 3: Verify no behavior change**

Run: `npm run check`
Expected: PASS. In particular `cargo clippy -D warnings` must be clean — if it flags the unused `_device_id` binding on non-Windows, keep the existing `#[cfg(target_os = "windows")] let device_id = _device_id;` shape exactly as the original had it.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/audio/cpal_backend.rs
git commit -m "refactor(audio): parameterize the capture stream consumer" -m "run_capture_worker hardcoded run_meter_pipeline_bridge_thread as its audio_rx consumer, which is the single point where the capture path touches Tauri. Extracting run_capture_stream lets a non-Tauri consumer drive the same device resolution, sample-format conversion, buffer pool, and drop accounting. No behavior change; the GUI passes the same bridge as before." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Resolve a device by label substring

**Files:** Modify `src-tauri/src/audio/device_enum.rs`

- [ ] **Step 1: Write the failing tests** at the bottom of `device_enum.rs`:

```rust
#[cfg(test)]
mod substring_tests {
  use super::match_device_substring;
  use crate::audio::device::DeviceInfo;

  fn device(id: &str, label: &str) -> DeviceInfo {
    DeviceInfo {
      id: id.to_string(),
      label: label.to_string(),
      is_system_output_monitor: false,
      is_loopback: false,
      default_sample_rate: 48000,
      channels: 2,
      core_audio_output_uid: None,
    }
  }

  fn fixture() -> Vec<DeviceInfo> {
    vec![
      device("lb-1", "CABLE Input (VB-Audio Virtual Cable)"),
      device("cap-1", "Microphone (Realtek High Definition Audio)"),
      device("cap-2", "CABLE Output (VB-Audio Virtual Cable)"),
    ]
  }

  #[test]
  fn matches_one_device_case_insensitively() {
    assert_eq!(
      match_device_substring(&fixture(), "cable output"),
      Ok("cap-2".to_string())
    );
  }

  #[test]
  fn rejects_ambiguous_substring_and_lists_the_candidates() {
    // VB-Cable installs as both an output (loopback) and an input row, so a bare
    // "CABLE" is genuinely ambiguous and must never silently pick one.
    let err = match_device_substring(&fixture(), "CABLE").unwrap_err();
    assert!(err.contains("matches 2 devices"), "unexpected: {err}");
    assert!(err.contains("CABLE Input (VB-Audio Virtual Cable)"), "unexpected: {err}");
    assert!(err.contains("CABLE Output (VB-Audio Virtual Cable)"), "unexpected: {err}");
  }

  #[test]
  fn reports_available_devices_when_nothing_matches() {
    let err = match_device_substring(&fixture(), "vb-cable").unwrap_err();
    assert!(err.contains("No capture device matches \"vb-cable\""), "unexpected: {err}");
    assert!(err.contains("Microphone (Realtek High Definition Audio)"), "unexpected: {err}");
  }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml substring_tests`
Expected: FAIL — `cannot find function match_device_substring`

- [ ] **Step 3: Implement** — add to `device_enum.rs`, after `build_device_list`:

```rust
fn format_device_lines(devices: &[DeviceInfo]) -> String {
  devices
    .iter()
    .map(|d| format!("  - {}", d.label))
    .collect::<Vec<_>>()
    .join("\n")
}

/// Resolve a case-insensitive label substring to exactly one device id.
/// Ambiguity is an error on purpose: VB-Cable installs as two rows ("CABLE
/// Input" and "CABLE Output"), so silently picking one would capture the wrong
/// end of the loop.
pub fn match_device_substring(devices: &[DeviceInfo], needle: &str) -> Result<String, String> {
  let needle_lower = needle.to_lowercase();
  let matches: Vec<&DeviceInfo> = devices
    .iter()
    .filter(|d| d.label.to_lowercase().contains(&needle_lower))
    .collect();

  match matches.len() {
    1 => Ok(matches[0].id.clone()),
    0 => Err(format!(
      "No capture device matches \"{needle}\". Available:\n{}",
      format_device_lines(devices)
    )),
    n => {
      let owned: Vec<DeviceInfo> = matches.into_iter().cloned().collect();
      Err(format!(
        "\"{needle}\" matches {n} devices. Be more specific:\n{}",
        format_device_lines(&owned)
      ))
    }
  }
}

/// Live wrapper: enumerate real devices, then resolve `needle` against them.
pub fn resolve_device_id_by_substring(needle: &str) -> Result<String, String> {
  let devices = build_device_list()?;
  match_device_substring(&devices, needle)
}
```

`DeviceInfo` must derive `Clone` for `cloned()` above. Check `src-tauri/src/audio/device.rs`; if it does not, add `Clone` to its derive list.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml substring_tests`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/audio/device_enum.rs src-tauri/src/audio/device.rs
git commit -m "feat(audio): resolve a capture device by label substring" -m "Lets a caller name a device without knowing its full label, resolving to the existing stable lb-*/cap-* id rather than introducing a parallel selector. Ambiguity is an error: VB-Cable installs as both CABLE Input and CABLE Output, so silently picking one would capture the wrong end of the loop. The zero-match error lists available devices, which is why no separate devices command is needed." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Tauri-free capture to summary

**Files:** Create `src-tauri/src/audio/capture_summary.rs`; Modify `src-tauri/src/audio/mod.rs`

No unit test: every line here needs a real device. The pure report shaping is tested in Task 4; this file is the thin device-touching shell, verified manually in Task 7.

- [ ] **Step 1: Create `src-tauri/src/audio/capture_summary.rs`**

```rust
//! Live capture to summary metrics, free of Tauri — the live twin of
//! `file_analysis::summary`. Shares device resolution, sample-format conversion,
//! the buffer pool, and drop accounting with the GUI path via
//! `cpal_backend::run_capture_stream`; only the consumer differs.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::audio::cpal_backend::{run_capture_stream, CaptureStreamArgs};
use crate::audio::device_enum::{preview_device, resolve_device};
use crate::dsp::summary_meter::SummaryMeter;

/// One periodic reading emitted while `--every` is active.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureSample {
  pub t_seconds: u64,
  pub integrated_lufs: f64,
  pub dropped_chunks: u64,
}

/// Everything one `capture` run observed.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureRun {
  pub device_label: String,
  pub device_id: String,
  pub sample_rate_hz: u32,
  pub channel_count: u16,
  pub captured_ms: u64,
  pub integrated_lufs: f64,
  pub sample_peak_max_l_db: f64,
  pub sample_peak_max_r_db: f64,
  pub dropped_chunks: u64,
}

/// Capture `device_id` for `seconds`, invoking `on_sample` every `every` seconds
/// when set. Blocks for the full duration.
pub fn capture_device_to_summary(
  device_id: &str,
  seconds: u64,
  every: Option<u64>,
  mut on_sample: impl FnMut(CaptureSample),
) -> Result<CaptureRun, String> {
  let (device_label, _key, _rate, _ch) = preview_device(device_id)?;
  let (device, supported) = resolve_device(device_id)?;
  let sample_rate = supported.sample_rate();
  let channels = supported.channels();

  let dropped_chunks = Arc::new(AtomicU64::new(0));
  let dropped_for_report = dropped_chunks.clone();
  let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
  let (result_tx, result_rx) = std::sync::mpsc::channel::<(f64, f64, f64)>();
  let (sample_tx, sample_rx) = std::sync::mpsc::channel::<CaptureSample>();

  let consumer_dropped = dropped_chunks.clone();
  let consumer = move |audio_rx: std::sync::mpsc::Receiver<Vec<f32>>,
                       pool: crate::audio::cpal_backend::PcmBufferPool,
                       sample_rate: u32,
                       channels: u16| {
    let mut meter = SummaryMeter::new(sample_rate, channels);
    let mut next_sample_at = every;
    let started = std::time::Instant::now();

    while let Ok(pcm) = audio_rx.recv() {
      meter.push_interleaved(&pcm);
      pool.recycle(pcm);

      if let (Some(interval), Some(due)) = (every, next_sample_at) {
        let elapsed = started.elapsed().as_secs();
        if elapsed >= due {
          // finish() borrows, so interim readings cost no DSP change.
          let metrics = meter.finish();
          let _ = sample_tx.send(CaptureSample {
            t_seconds: due,
            integrated_lufs: metrics.integrated_lufs,
            dropped_chunks: consumer_dropped.load(Ordering::Relaxed),
          });
          next_sample_at = Some(due + interval);
        }
      }
    }

    let metrics = meter.finish();
    let _ = result_tx.send((
      metrics.integrated_lufs,
      metrics.sample_peak_max_l_db,
      metrics.sample_peak_max_r_db,
    ));
  };

  let stream_args = CaptureStreamArgs {
    device_id: device_id.to_string(),
    device,
    supported,
    sample_rate,
    channels,
    stop_rx,
    dropped_chunks,
  };

  let capture_thread = std::thread::spawn(move || run_capture_stream(stream_args, consumer));

  // Drain sample lines while the capture runs; stop it once the duration elapses.
  let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
  while std::time::Instant::now() < deadline {
    match sample_rx.recv_timeout(Duration::from_millis(200)) {
      Ok(sample) => on_sample(sample),
      Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
      Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
    }
  }
  let _ = stop_tx.send(());

  capture_thread
    .join()
    .map_err(|_| "Capture thread panicked".to_string())??;

  while let Ok(sample) = sample_rx.try_recv() {
    on_sample(sample);
  }

  let (integrated_lufs, sample_peak_max_l_db, sample_peak_max_r_db) = result_rx
    .recv()
    .map_err(|_| "Capture produced no metrics".to_string())?;

  Ok(CaptureRun {
    device_label,
    device_id: device_id.to_string(),
    sample_rate_hz: sample_rate,
    channel_count: channels,
    captured_ms: seconds * 1000,
    integrated_lufs,
    sample_peak_max_l_db,
    sample_peak_max_r_db,
    dropped_chunks: dropped_for_report.load(Ordering::Relaxed),
  })
}
```

- [ ] **Step 2: Register the module** in `src-tauri/src/audio/mod.rs` — add after the `pub mod capture;` line:

```rust
pub mod capture_summary;
```

- [ ] **Step 3: Make the shared pieces reachable.** `run_capture_stream`, `CaptureStreamArgs`, and `PcmBufferPool` are `pub(crate)` in `cpal_backend.rs`, and `capture_summary` is inside the same crate, so no visibility change is needed. Confirm with:

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles. If `PcmBufferPool` is not nameable from `capture_summary`, widen only that item to `pub(crate)` — do not make it `pub`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/audio/capture_summary.rs src-tauri/src/audio/mod.rs
git commit -m "feat(audio): add Tauri-free live capture to summary metrics" -m "The live twin of file_analysis::summary: drives SummaryMeter over the same shared dsp primitives while reusing the GUI's device resolution, sample-format conversion, buffer pool, and drop accounting through run_capture_stream. Reimplementing those would test the copy rather than the code users run, which is the whole point of the command." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: CLI report types

**Files:** Create `src-tauri/src/cli_capture.rs`; Modify `src-tauri/src/lib.rs`

Mirrors `cli_analyze.rs` exactly: same envelope, same `camelCase`, same status enum, non-finite → `null`.

- [ ] **Step 1: Write the failing test.** Create `src-tauri/src/cli_capture.rs` containing only:

```rust
#[cfg(test)]
mod tests {
  use super::*;
  use crate::audio::capture_summary::CaptureRun;

  fn run() -> CaptureRun {
    CaptureRun {
      device_label: "CABLE Output (VB-Audio Virtual Cable)".to_string(),
      device_id: "cap-2".to_string(),
      sample_rate_hz: 48000,
      channel_count: 2,
      captured_ms: 10000,
      integrated_lufs: -20.02,
      sample_peak_max_l_db: -20.01,
      sample_peak_max_r_db: -26.03,
      dropped_chunks: 0,
    }
  }

  #[test]
  fn success_report_uses_the_analyze_envelope() {
    let report = success_report(run());
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["command"], "capture");
    assert_eq!(json["status"], "ok");
    assert_eq!(json["app"]["name"], "PLVS");
    assert_eq!(json["source"]["deviceId"], "cap-2");
    assert_eq!(json["source"]["sampleRateHz"], 48000);
    assert_eq!(json["summary"]["integratedLufs"], -20.02);
    assert_eq!(json["health"]["droppedChunks"], 0);
  }

  #[test]
  fn non_finite_metrics_serialize_as_null() {
    let mut r = run();
    r.integrated_lufs = f64::NEG_INFINITY;
    let json = serde_json::to_value(&success_report(r)).unwrap();
    assert!(json["summary"]["integratedLufs"].is_null());
  }

  #[test]
  fn error_report_keeps_the_envelope_and_reports_the_message() {
    let report = error_report("cap-2", "device vanished".to_string());
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["command"], "capture");
    assert_eq!(json["status"], "error");
    assert_eq!(json["error"]["message"], "device vanished");
  }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cli_capture`
Expected: FAIL — unresolved module / `success_report` not found

- [ ] **Step 3: Implement** — put this **above** the `#[cfg(test)] mod tests` block in `cli_capture.rs`:

```rust
use serde::Serialize;

use crate::audio::capture_summary::{capture_device_to_summary, CaptureRun, CaptureSample};
use crate::audio::device_enum::resolve_device_id_by_substring;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliCaptureStatus {
  Ok,
  Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum CliCaptureReport {
  Success(Box<CliCaptureSuccessReport>),
  Error(Box<CliCaptureErrorReport>),
}

impl CliCaptureReport {
  pub fn status(&self) -> CliCaptureStatus {
    match self {
      CliCaptureReport::Success(_) => CliCaptureStatus::Ok,
      CliCaptureReport::Error(_) => CliCaptureStatus::Error,
    }
  }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureSuccessReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliCaptureStatus,
  pub app: CliCaptureApp,
  pub source: CliCaptureSource,
  pub summary: CliCaptureSummary,
  pub health: CliCaptureHealth,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureErrorReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliCaptureStatus,
  pub app: CliCaptureApp,
  pub source: CliCaptureErrorSource,
  pub error: CliCaptureError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureApp {
  pub name: String,
  pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureSource {
  pub device_name: String,
  pub device_id: String,
  pub sample_rate_hz: u32,
  pub channel_count: u16,
  pub captured_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureErrorSource {
  pub device_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureSummary {
  pub integrated_lufs: Option<f64>,
  pub sample_peak_max_l_db: Option<f64>,
  pub sample_peak_max_r_db: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureHealth {
  pub dropped_chunks: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureError {
  pub message: String,
}

/// One periodic JSONL line. Distinguishable from the final report by `t`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCaptureSampleLine {
  pub t: u64,
  pub integrated_lufs: Option<f64>,
  pub dropped_chunks: u64,
}

fn app() -> CliCaptureApp {
  CliCaptureApp {
    name: "PLVS".to_string(),
    version: env!("CARGO_PKG_VERSION").to_string(),
  }
}

/// Non-finite metrics become `null`, matching `analyze`.
fn finite(value: f64) -> Option<f64> {
  if value.is_finite() {
    Some(value)
  } else {
    None
  }
}

pub fn sample_line(sample: &CaptureSample) -> CliCaptureSampleLine {
  CliCaptureSampleLine {
    t: sample.t_seconds,
    integrated_lufs: finite(sample.integrated_lufs),
    dropped_chunks: sample.dropped_chunks,
  }
}

pub fn success_report(run: CaptureRun) -> CliCaptureReport {
  CliCaptureReport::Success(Box::new(CliCaptureSuccessReport {
    schema_version: 1,
    command: "capture".to_string(),
    status: CliCaptureStatus::Ok,
    app: app(),
    source: CliCaptureSource {
      device_name: run.device_label,
      device_id: run.device_id,
      sample_rate_hz: run.sample_rate_hz,
      channel_count: run.channel_count,
      captured_ms: run.captured_ms,
    },
    summary: CliCaptureSummary {
      integrated_lufs: finite(run.integrated_lufs),
      sample_peak_max_l_db: finite(run.sample_peak_max_l_db),
      sample_peak_max_r_db: finite(run.sample_peak_max_r_db),
    },
    health: CliCaptureHealth {
      dropped_chunks: run.dropped_chunks,
    },
  }))
}

pub fn error_report(device_id: &str, message: String) -> CliCaptureReport {
  CliCaptureReport::Error(Box::new(CliCaptureErrorReport {
    schema_version: 1,
    command: "capture".to_string(),
    status: CliCaptureStatus::Error,
    app: app(),
    source: CliCaptureErrorSource {
      device_id: device_id.to_string(),
    },
    error: CliCaptureError { message },
  }))
}

/// Resolve the device, run the capture, and emit sample lines through `on_sample`.
/// Substring resolution failures are usage errors and surface as `Err` (exit 2);
/// a capture that starts and then fails yields an error *report* (exit 1).
pub fn run_capture(
  device_substring: Option<&str>,
  seconds: u64,
  every: Option<u64>,
  on_sample: impl FnMut(CaptureSample),
) -> Result<CliCaptureReport, String> {
  let device_id = match device_substring {
    Some(needle) => resolve_device_id_by_substring(needle)?,
    None => "default".to_string(),
  };

  match capture_device_to_summary(&device_id, seconds, every, on_sample) {
    Ok(run) => Ok(success_report(run)),
    Err(message) => Ok(error_report(&device_id, message)),
  }
}
```

- [ ] **Step 4: Register the module** in `src-tauri/src/lib.rs`, next to the existing `mod cli_analyze;` / `pub mod cli_analyze;` declaration — match whatever visibility the neighbouring `cli_*` modules use:

```rust
pub mod cli_capture;
```

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cli_capture`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/cli_capture.rs src-tauri/src/lib.rs
git commit -m "feat(cli): add capture JSON report types" -m "Mirrors cli_analyze's envelope, camelCase vocabulary, status enum, and non-finite-to-null rule so an agent that learned analyze already knows capture. Fields are limited to those with a caller today: the release smoke gate and the soak run." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Parse and dispatch `capture`

**Files:** Modify `src-tauri/src/cli_main.rs`

- [ ] **Step 1: Write the failing tests.** Add to the existing `#[cfg(test)]` module in `cli_main.rs` (alongside the current `parse_args` tests):

```rust
  #[test]
  fn parses_capture_with_device_and_seconds() {
    assert_eq!(
      parse_args(&args(&["capture", "--device", "CABLE Output", "--seconds", "10", "--json"])),
      Ok(CliCommand::CaptureJson {
        device: Some("CABLE Output".to_string()),
        seconds: 10,
        every: None,
        out: None,
      })
    );
  }

  #[test]
  fn parses_capture_with_every_and_out() {
    assert_eq!(
      parse_args(&args(&[
        "capture", "--seconds", "14400", "--every", "10", "--json", "--out", "soak.jsonl"
      ])),
      Ok(CliCommand::CaptureJson {
        device: None,
        seconds: 14400,
        every: Some(10),
        out: Some("soak.jsonl".to_string()),
      })
    );
  }

  #[test]
  fn capture_requires_json_and_seconds() {
    assert!(parse_args(&args(&["capture", "--seconds", "10"])).is_err());
    assert!(parse_args(&args(&["capture", "--json"])).is_err());
  }

  #[test]
  fn capture_rejects_zero_and_unparsable_durations() {
    assert!(parse_args(&args(&["capture", "--seconds", "0", "--json"])).is_err());
    assert!(parse_args(&args(&["capture", "--seconds", "ten", "--json"])).is_err());
    assert!(parse_args(&args(&["capture", "--seconds", "10", "--every", "0", "--json"])).is_err());
  }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib cli_main`
Expected: FAIL — no variant `CaptureJson`

- [ ] **Step 3: Add the command variant** to the `CliCommand` enum (after `AnalyzeBatchJson`):

```rust
  CaptureJson {
    device: Option<String>,
    seconds: u64,
    every: Option<u64>,
    out: Option<String>,
  },
```

- [ ] **Step 4: Add the parser.** Add `Capture` to `HelpTopic`, add the dispatch arm in `parse_args` next to the `analyze` arm:

```rust
    [command, rest @ ..] if command == "capture" => parse_capture_args(rest),
```

and add `"capture" => Ok(CliCommand::Help(HelpTopic::Capture)),` to `parse_help_topic`. Then add:

```rust
fn parse_capture_args(rest: &[String]) -> Result<CliCommand, String> {
  if rest.iter().any(|a| is_help_flag(a)) {
    return Ok(CliCommand::Help(HelpTopic::Capture));
  }

  let mut device: Option<String> = None;
  let mut seconds: Option<u64> = None;
  let mut every: Option<u64> = None;
  let mut out: Option<String> = None;
  let mut json = false;
  let mut i = 0;

  while i < rest.len() {
    match rest[i].as_str() {
      "--json" => {
        json = true;
        i += 1;
      }
      "--device" => {
        let value = rest.get(i + 1).ok_or("Missing value for --device")?;
        device = Some(value.clone());
        i += 2;
      }
      "--seconds" => {
        let value = rest.get(i + 1).ok_or("Missing value for --seconds")?;
        let parsed: u64 = value
          .parse()
          .map_err(|_| "The --seconds value must be a positive integer".to_string())?;
        if parsed == 0 {
          return Err("The --seconds value must be greater than zero".to_string());
        }
        seconds = Some(parsed);
        i += 2;
      }
      "--every" => {
        let value = rest.get(i + 1).ok_or("Missing value for --every")?;
        let parsed: u64 = value
          .parse()
          .map_err(|_| "The --every value must be a positive integer".to_string())?;
        if parsed == 0 {
          return Err("The --every value must be greater than zero".to_string());
        }
        every = Some(parsed);
        i += 2;
      }
      "--out" => {
        let value = rest.get(i + 1).ok_or("Missing value for --out")?;
        out = Some(value.clone());
        i += 2;
      }
      other => {
        return Err(format!("Unknown capture argument: {other}"));
      }
    }
  }

  if !json {
    return Err("The capture command currently requires --json.".to_string());
  }
  let seconds = seconds.ok_or("Usage: plvs-cli capture [--device <substring>] --seconds <n> [--every <n>] --json [--out <file>]")?;
  if let Some(interval) = every {
    if interval > seconds {
      return Err("The --every value must not exceed --seconds".to_string());
    }
  }

  Ok(CliCommand::CaptureJson {
    device,
    seconds,
    every,
    out,
  })
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib cli_main`
Expected: PASS

- [ ] **Step 6: Add the dispatch arm** in `run()`, after the `CliCommand::AnalyzeJson` arm. Sample lines go to stdout as they arrive; the final report is the last line, so `--out` collects the whole stream:

```rust
    CliCommand::CaptureJson {
      device,
      seconds,
      every,
      out,
    } => {
      let mut lines: Vec<String> = Vec::new();
      let streaming = every.is_some();
      let report = {
        let mut on_sample = |sample: crate::audio::capture_summary::CaptureSample| {
          if let Ok(line) = serde_json::to_string(&crate::cli_capture::sample_line(&sample)) {
            println!("{line}");
            lines.push(line);
          }
        };
        match crate::cli_capture::run_capture(device.as_deref(), seconds, every, &mut on_sample) {
          Ok(report) => report,
          Err(err) => {
            eprintln!("{err}");
            return ExitCode::from(2);
          }
        }
      };

      let status = report.status();
      let json = match serde_json::to_string(&report) {
        Ok(json) => json,
        Err(err) => {
          eprintln!("Failed to serialize capture report: {err}");
          return ExitCode::from(2);
        }
      };

      if streaming {
        // The stream already went to stdout line by line; --out gets all of it.
        println!("{json}");
        lines.push(json);
        if let Some(path) = out.as_deref() {
          if let Err(err) = fs::write(path, format!("{}\n", lines.join("\n"))) {
            eprintln!("Failed to write {path}: {err}");
            return ExitCode::from(2);
          }
        }
      } else if let Err(err) = emit_json(&json, out.as_deref(), "capture") {
        eprintln!("{err}");
        return ExitCode::from(2);
      }

      match status {
        crate::cli_capture::CliCaptureStatus::Ok => ExitCode::SUCCESS,
        crate::cli_capture::CliCaptureStatus::Error => ExitCode::from(1),
      }
    }
```

- [ ] **Step 7: Add the help text.** In `help_text`, add the `HelpTopic::Capture` arm and add a `capture` line to the root topic's command list:

```rust
    HelpTopic::Capture => {
      "PLVS CLI - capture\n\nUsage:\n  plvs-cli capture [--device <substring>] --seconds <n> [--every <n>] --json [--out <file>]\n\nCaptures live audio from a device without launching the desktop UI and reports\ndelivery metrics. JSON is written to stdout. With --out, the same output is also\nwritten to a file.\n\n--device matches a case-insensitive substring of the device label; it must match\nexactly one device. Omit it to use the default device. With no match, the error\nlists the available devices.\n\n--every <n> emits one JSON line every n seconds (JSONL) instead of a single\nreport; the final line is the same report the non-streaming mode prints.\n\nExit codes:\n  0  capture completed successfully\n  1  capture completed with an error report\n  2  invalid usage or CLI failure before a valid report"
    }
```

- [ ] **Step 8: Full gate**

Run: `npm run check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/cli_main.rs
git commit -m "feat(cli): wire up the capture command" -m "Adds parsing, dispatch, and a help topic for capture, following the same flag shape and 0/1/2 exit-code contract as the other CLI commands. --every switches output to JSONL and is named to be self-announcing; --sample-interval was rejected because sample is already bound to PCM samples in this CLI's vocabulary." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Manual on-machine verification

**Files:** none

No CI runner has a sound card, so this is the only step that proves the command works. It needs VB-Cable installed.

- [ ] **Step 1: Build the CLI**

Run: `cargo build --manifest-path src-tauri/Cargo.toml --release`

- [ ] **Step 2: Verify device discovery via the error path**

Run: `./src-tauri/target/release/plvs-cli.exe capture --device "definitely-not-a-device" --seconds 5 --json`
Expected: exit code 2; stderr lists real devices including both `CABLE Input …` and `CABLE Output …`.

- [ ] **Step 3: Verify ambiguity is rejected**

Run: `./src-tauri/target/release/plvs-cli.exe capture --device "CABLE" --seconds 5 --json`
Expected: exit code 2; error says it matches 2 devices.

- [ ] **Step 4: Generate an asymmetric test signal.** 1 kHz sine, 60 s, 48 kHz stereo, with L at -20 dBFS peak and R at -26 dBFS peak. The asymmetry is the point: equal-weight channels make an L/R swap invisible to integrated loudness (`dsp/loudness.rs` weighs FL and FR at `1.0`), so per-channel peaks are the only canary for a channel-map bug.

**Do not use ffmpeg for this.** The bundled sidecar is a trimmed build with no `volume` filter — `-filter_complex "volume=..."` fails with `No such filter: 'volume'`. Synthesize the WAV directly instead:

```js
// make-signal.mjs — run: node make-signal.mjs "%TEMP%\plvs-smoke-signal.wav"
import { writeFileSync } from "node:fs";

const SAMPLE_RATE = 48000;
const SECONDS = 60;
const FREQ = 1000;
const AMP_L = 10 ** (-20 / 20); // -20 dBFS peak
const AMP_R = 10 ** (-26 / 20); // -26 dBFS peak

const frames = SAMPLE_RATE * SECONDS;
const dataBytes = frames * 2 * 2; // stereo, 16-bit
const buf = Buffer.alloc(44 + dataBytes);

buf.write("RIFF", 0);
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(2, 22); // channels
buf.writeUInt32LE(SAMPLE_RATE, 24);
buf.writeUInt32LE(SAMPLE_RATE * 2 * 2, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(dataBytes, 40);

for (let i = 0; i < frames; i++) {
  const phase = (2 * Math.PI * FREQ * i) / SAMPLE_RATE;
  buf.writeInt16LE(Math.round(Math.sin(phase) * AMP_L * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.sin(phase) * AMP_R * 32767), 44 + i * 4 + 2);
}

writeFileSync(process.argv[2], buf);
```

- [ ] **Step 5: Establish ground truth from the file path.** Do NOT assert against hand-computed numbers. Measure the same file through `analyze` — the already-trusted path — and require `capture` to agree with it:

Run: `./src-tauri/target/release/plvs-cli.exe analyze "$env:TEMP\plvs-smoke-signal.wav" --json`

Measured 2026-07-16 for the signal above:

| Field | Value |
|-------|-------|
| `integratedLufs` | **-22.03** |
| `samplePeakMaxLDb` | -19.9995 |
| `samplePeakMaxRDb` | -26.0015 |

**Note `integratedLufs` is -22.03, not -20.** A -20 dBFS *peak* sine has ~-23 dBFS RMS, and integrated loudness sums K-weighted energy across both channels — peak level and integrated loudness are different quantities. An earlier draft of this plan expected ≈ -20 and would have sent you hunting a bug that isn't there.

- [ ] **Step 6: Play the signal into VB-Cable and capture it.** Do **not** change the system default playback device: point one player at VB-Cable's endpoint instead, so everything else keeps using the normal device and nothing is audible.

Find VB-Cable's render endpoint id (read-only registry lookup):

```powershell
$base = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render"
Get-ChildItem $base | ForEach-Object {
  $name = (Get-ItemProperty (Join-Path $_.PSPath "Properties"))."{a45c254e-df1c-4efd-8020-67d146a850e0},2"
  if ($name -eq "CABLE Input") { "{0.0.0.00000000}.{$($_.PSChildName)}" }
}
```

Start VLC looping the signal into that endpoint only. VLC's `directsound` output wants a GUID and rejects a device *name* (`bad device GUID`); `mmdevice` takes the endpoint id:

```powershell
$devId = '{0.0.0.00000000}.{<guid-from-above>}'
$argStr = '--intf dummy --no-video --loop --aout=mmdevice --mmdevice-audio-device="' + $devId + '" "' + $env:TEMP + '\plvs-smoke-signal.wav"'
Start-Process "C:\Program Files\VideoLAN\VLC\vlc.exe" -ArgumentList $argStr -WindowStyle Hidden
```

Pass the whole thing as ONE argument string — an `-ArgumentList` array splits the device id and label on spaces, and VLC then tries to open the fragments as filenames.

Then capture, and stop VLC afterwards (`Get-Process vlc | Stop-Process -Force`):

Run: `./src-tauri/target/release/plvs-cli.exe capture --device "CABLE Output" --seconds 10 --json`

Measured 2026-07-16 — `capture` against the Step 5 `analyze` ground truth:

| Field | `analyze` (truth) | `capture` (live) | Delta |
|-------|-------------------|------------------|-------|
| `samplePeakMaxLDb` | -19.999469871546843 | -19.999469871546843 | **0 — bit-identical** |
| `samplePeakMaxRDb` | -26.00153564352592 | -26.00153564352592 | **0 — bit-identical** |
| `integratedLufs` | -22.0306 | -22.0329 | 0.0024 dB |

Also: `sampleRateHz` 48000, `channelCount` 2, `health.droppedChunks` 0, exit 0.

Bit-identical peaks are the real result: the capture layer hands over the PCM unaltered — no resampling, no gain, no channel swap. The 0.0024 dB integrated delta is expected and not error — `capture` integrates a 10 s window of the looping file while `analyze` integrates all 60 s.

Assertion tolerances for a future automated gate: peaks ±0.2 dB, integrated ±0.5 dB.

**If L and R come back swapped or equal, stop — that is the channel-map bug this command exists to find.** Report it rather than adjusting the assertion.

Set VB-Cable's format to 48 kHz / 2 channels in the Windows sound control panel first. If `sampleRateHz` comes back as something else, that is test-rig drift, not a code bug — fix the rig.

Note this machine exposes **three** rows matching `CABLE` (`CABLE In 16ch`, `CABLE Input`, `CABLE Output`), so the ambiguity rejection in Step 3 is load-bearing, not decorative.

- [ ] **Step 7: Verify streaming mode**

Run: `./src-tauri/target/release/plvs-cli.exe capture --device "CABLE Output" --seconds 30 --every 10 --json --out soak-check.jsonl`

Expected: sample lines at `t` = 10 and 20, then a final report line; `soak-check.jsonl` holds the whole stream.

**A `t` = 30 line may or may not appear — both are correct.** The consumer's clock and the caller's deadline start within microseconds of each other, so emitting the last sample requires a PCM chunk (~1 per 100 ms) to land in the window before the stop takes effect. It is a race, deliberately left alone: no caller reads the final sample (the soak reads the trend, the smoke gate does not use `--every`, and the final report already carries the end-state value), so making it deterministic would add synchronization for nobody. Do not "fix" a missing `t` = 30.

- [ ] **Step 8: Verify the GUI still meters.** Launch the app (`npm run desktop`), start capture on any device, confirm the meters move. This is what guards the Task 1 refactor.

- [ ] **Step 9: Commit nothing.** This task produces no code. Record the observed numbers in the PR / commit description of Task 5 if anything surprised you.

---

## Known Imprecision

`source.capturedMs` is reported as `seconds * 1000`, but the duration timer starts
before the device finishes opening, so the real captured span is slightly shorter.
This is accepted rather than fixed: no caller asserts on `capturedMs` — the smoke
gate asserts loudness and peaks, the soak reads the `t` series — and threading a
true elapsed count out of the consumer would add plumbing for a field nobody reads.
If a caller ever needs it exact, take it from the consumer's own clock.

---

## Follow-on (not in this plan)

- **Release smoke gate** — the `plvs-release` step that runs this command against an installed RC and asserts the numbers. Needs its own spec.
- **Soak** — `capture --seconds 14400 --every 10` plus external RSS sampling (`Get-Process plvs | Select-Object WorkingSet64`), triggered after commits touching `audio/`, `dsp/`, or `engine/`. Not a release gate. Needs its own spec.
- **macOS** — `audio/macos/` has its own capture path and is not covered by this command; the author develops on Windows.
